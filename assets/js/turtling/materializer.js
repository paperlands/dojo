// Materializer — converts TurtleEvents into THREE.js scene objects.
// Consumes executor events directly (tuple positions, clean field names).
// Material cache (spec A3): one LineMaterial per (color, thickness) key.

import { GridHelper } from '../utils/three-entry.js'
import { followPosition } from './view.js'
import { ColorConverter } from '../utils/color.js'
import { Text } from '../utils/threetext.js'
import { Line2 } from '../utils/three-addons/lines/Line2.js'
import { LineMaterial } from '../utils/three-addons/lines/LineMaterial.js'
import { LineGeometry } from '../utils/three-addons/lines/LineGeometry.js'
import { GrowLine } from './render/line/GrowLine.js'

// --- Material cache (spec A3) ---
// Keyed by (color, thickness). Typical program uses 1-5 unique combinations.
// Reuse eliminates duplicate GPU uniform buffers and reduces WebGL state switches.
const materialCache = new Map()

// Read-only introspection for the profiler overlay (non-behavioral).
export function materialCacheSize() {
    return materialCache.size
}

// Cache is module-global and outlives without this — leaks one LineMaterial
// (+ GPU buffers) per (color,thickness) key for the page's life. Called on
// turtle.reset()/compositor.dispose().
export function clearMaterialCache() {
    for (const mat of materialCache.values()) mat.dispose()
    materialCache.clear()
}

// Keep cached LineMaterials' resolution uniform in sync with the canvas — line
// width is screen-space, so a stale resolution renders lines at the wrong width
// after a window resize.
export function updateMaterialResolution(width, height) {
    for (const mat of materialCache.values()) mat.resolution?.set(width, height)
}

function getOrCreateMaterial(color, thickness) {
    const key = `${color || 0xe77808}:${thickness || 2}`
    let mat = materialCache.get(key)
    if (!mat) {
        mat = new LineMaterial({
            color: color || 0xe77808,
            linewidth: thickness || 2,
            vertexColors: false,
            dashed: false,
        })
        mat.resolution.set(window.innerWidth, window.innerHeight)
        // Tag so layer teardown disposes per-mesh geometry but NOT this shared,
        // cache-owned material (disposing it would corrupt every other mesh that
        // shares the key). The cache owns disposal via clearMaterialCache().
        mat._cached = true
        materialCache.set(key, mat)
    }
    return mat
}

// Materialize a single event into the scene.
// groups = { pathGroup, gridGroup, glyphGroup }
// ctx    = { shapist, head, camera, controls }
export function materialize(event, groups, ctx) {
    switch (event.type) {

    case "path":
        materializePath(event, groups.pathGroup, ctx.shapist)
        break

    case "head":
        materializeHead(event, ctx)
        break

    case "view":
        materializeView(event, ctx)
        break

    case "label":
        materializeLabel(event, groups.glyphGroup, ctx)
        break

    case "grid":
        materializeGrid(event, groups.gridGroup)
        break

    case "clear":
        clearGroups(groups, ctx.head)
        break

    case "wait":
        // Wait events are temporal markers — handled by the scheduler/compositor,
        // not the materializer. Head snapshot for wait is emitted separately.
        break
    }
}

// Materialize all events from a drained executor (batch mode).
// For programs without waits — direct pipe, zero intermediate allocation.
export function materializeAll(events, groups, ctx) {
    for (const event of events) {
        materialize(event, groups, ctx)
    }
}

// --- Internal materializers ---

function materializePath(event, pathGroup, shapist, sourceId) {
    try {
        if (!event.points || event.points.length === 0) return

        const positions = new Float32Array(event.points.length * 3)
        for (let i = 0; i < event.points.length; i++) {
            const p = event.points[i]
            positions[i * 3] = p[0]
            positions[i * 3 + 1] = p[1]
            positions[i * 3 + 2] = p[2]
        }

        const geometry = new LineGeometry()
        geometry.setPositions(positions)

        const material = getOrCreateMaterial(event.color, event.thickness)
        const mesh = new Line2(geometry, material)
        // Source attribution for reclaim when a target layer outlives the depositor.
        if (sourceId !== undefined) mesh._sourceId = sourceId
        mesh.computeLineDistances()
        pathGroup.add(mesh)

        if (event.filled && shapist) {
            const polyPoints = event.points.map(p => ({ x: p[0], y: p[1], z: p[2] }))
            shapist.addPolygon(polyPoints, {
                color: event.color,
                forceTriangulation: true
            })
        }
    } catch (error) {
        console.warn('Error drawing path:', error)
    }
}

// --- Trail consolidation (draw-call collapse) ---
// Contiguous path events accumulate into one growing per-source polyline
// (GrowLine) instead of a mesh per event; a new stroke-run id closes the run
// and starts fresh. Keyed by event.sourceId so multi-tenant layers never
// clobber. id:ft-d8-append-geometry, id:ft-d2-per-source-trails

// The layer's own pen (untagged events) shares one slot; deposited ink is keyed
// by its source frame id.
const SELF_SOURCE = 'self'

// Start a fresh growable run for `source` and add its mesh to the layer. The mesh
// is tagged with its source so a target layer that OUTLIVES the source (the
// world/root layer) can reclaim this ink on rerun. (spec id:ft-d2 — GC)
function newRun(event, source, layer) {
    const line = new GrowLine(getOrCreateMaterial(event.color, event.thickness))
    line.mesh._sourceId = source
    layer.group.add(line.mesh)
    return { runId: event.runId, source, line }
}

// Append a path event into its source's run in layer.trails. Returns the layer.
export function accumulateTrail(event, layer) {
    if (!event.points || event.points.length === 0) return layer

    const source = event.sourceId != null ? event.sourceId : SELF_SOURCE

    // Filled polygons are standalone — close this source's open run, render apart.
    if (event.filled) {
        const open = layer.trails.get(source)
        if (open) { open.line.sync(); layer.trails.delete(source) }
        materializePath(event, layer.group, layer.shapist, source)
        return layer
    }

    // A path event continues its source's open run iff it carries the same
    // stroke-run id (scheduler-assigned from local geometry+style). GrowLine.append
    // joins from the run's last endpoint, skipping the shared start point. id:ft-d7-deposit-runid
    let tr = layer.trails.get(source)
    if (!(tr && tr.runId === event.runId)) {
        if (tr) tr.line.sync()        // close the prior run; its mesh stays in the group
        tr = newRun(event, source, layer)
        layer.trails.set(source, tr)
    }
    tr.line.append(event.points)
    return layer
}

// Push each open run's newly-appended segments to the GPU. Once per frame per layer
// (not per event). O(Δ), not O(N).
export function flushTrail(layer) {
    for (const run of layer.trails.values()) run.line.sync()
}

function materializeHead(event, ctx) {
    const pos = event.position

    if (ctx.camera) {
        switch (ctx.camera.desire) {
        case 'track': {
            // Follow off the target, not the head mesh — the head respawns on
            // every re-eval, which walked the camera per edit. (view.js followPosition)
            const c = ctx.camera.position, t = ctx.controls.target
            const next = followPosition([c.x, c.y, c.z], [t.x, t.y, t.z], pos)
            c.set(next[0], next[1], next[2])
            t.set(pos[0], pos[1], pos[2])
            break
        }
        case 'pan':
            ctx.controls.target.set(pos[0], pos[1], pos[2])
            break
        }
    }

    if (event.headSize) {
        // Frame-targeted heads get no heading here — the compositor orients them by
        // world velocity (Head.orientToWorld), since their local heading cancels the
        // rotating layer group. Normal heads show their heading. (spec id:ft-d5-head)
        const rotation = ctx.frame && ctx.frame.targetFrame ? null : event.rotation
        ctx.head.show()
        ctx.head.update(pos, rotation, event.color, event.headSize)
    } else {
        ctx.head.hide()
    }
}

// A Lens emits no mesh and never drives the camera — pose reframing happens at
// the model layer (compositor E⁻¹ premultiply). This leaf only hides the eye
// and carries the E2 fov param. id:eye-lens-primitive, id:eye-coordinates
function materializeView(event, ctx) {
    // An eye is never a visible turtle.
    ctx.head?.hide?.()

    if (!ctx.camera) return

    // Lens param (E2). Until then `fov` is undefined and the camera keeps its own.
    if (typeof event.fov === 'number' && event.fov > 0) {
        ctx.camera.fov = event.fov
        ctx.camera.updateProjectionMatrix()
    }
}

function materializeLabel(event, glyphGroup, ctx) {
    try {
        const newText = new Text()
        glyphGroup.add(newText)

        newText.text = event.text
        newText.fontSize = event.textSize
        newText.textAlign = 'center'
        newText.anchorX = 'center'
        newText.anchorY = '45%'
        newText.font = '/fonts/paperLang.ttf'
        newText.position.x = event.position[0]
        newText.position.y = event.position[1]
        newText.position.z = event.position[2]
        newText.quaternion.copy(event.rotation)
        newText.color = event.color
        // sync() builds glyph geometry off-thread (and fetches the font on first
        // load). The completion callback wakes the render-on-demand loop, which
        // has usually idled out by the time the text is ready — without it a
        // freshly-built label never gets a frame to draw into.
        newText.sync(() => ctx?.requestRender?.())
        glyphGroup.elements.push(newText)
    } catch (error) {
        console.warn('Error writing text:', error)
    }
}

function materializeGrid(event, gridGroup) {
    const gridHelper = new GridHelper(
        event.size,
        event.divisions,
        event.color,
        ColorConverter.toHex(ColorConverter.adjust(event.color, 0.25))
    )
    gridHelper.position.set(event.position[0], event.position[1], event.position[2])
    gridHelper.quaternion.copy(event.rotation)
    gridGroup.add(gridHelper)
}

function clearGroups(groups, head) {
    // Remove drawn content from pathGroup but preserve the head mesh.
    // hd (hide) is the intentional way to hide the head — erase should not.
    const headGroup = head?.turtleGroup
    for (const child of [...groups.pathGroup.children]) {
        if (child !== headGroup) groups.pathGroup.remove(child)
    }
    groups.gridGroup.clear()
    if (groups.glyphGroup.elements) {
        groups.glyphGroup.elements.forEach(text => text.dispose())
        groups.glyphGroup.elements = []
    }
    groups.glyphGroup.clear()
}
