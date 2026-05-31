// Materializer — converts TurtleEvents into THREE.js scene objects.
// Consumes executor events directly (tuple positions, clean field names).
// Material cache (spec A3): one LineMaterial per (color, thickness) key.

import * as THREE from '../utils/three.core.min.js'
import { ColorConverter } from '../utils/color.js'
import { Text } from '../utils/threetext'
import { Line2 } from './render/line/Line2.js'
import { LineMaterial } from './render/line/LineMaterial.js'
import { LineGeometry } from './render/line/LineGeometry.js'
import { GrowLine } from './render/line/GrowLine.js'

// --- Material cache (spec A3) ---
// Keyed by (color, thickness). Typical program uses 1-5 unique combinations.
// Reuse eliminates duplicate GPU uniform buffers and reduces WebGL state switches.
const materialCache = new Map()

// Read-only introspection for the profiler overlay (non-behavioral).
export function materialCacheSize() {
    return materialCache.size
}

// Dispose every cached material and empty the cache. Called on turtle.reset()/
// compositor.dispose() — the cache is module-global and otherwise lives for the
// whole page, so without this it leaks one LineMaterial (+ GPU uniform buffers)
// per unique (color, thickness) for the session's lifetime.
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
//
// `wait` breaks the stroke every temporal boundary, so an animated
// `loop do fw 1 wait end` emits one path event per tick. Naively that is one
// Line2 mesh per event → tens of thousands of meshes/draw-calls for a long
// animation (the dominant cost on complex programs). But consecutive flushes of
// a continuous pen-down trail share an endpoint, so they form ONE polyline.
//
// We accumulate contiguous path events into a single GROWING fat-line per source
// (GrowLine): the new segments are appended to a persistent dynamic buffer rather
// than rebuilt each frame. A discontinuity (new stroke-run id) closes the current
// run — its mesh stays in the layer — and starts a new one. Filled polygons remain
// standalone. (spec id:ft-d8-append-geometry)
//
// A layer is multi-tenant: its own pen plus any frame-targeted children that deposit
// ink into it (`as child target do`). Each depositor's run is keyed by
// `event.sourceId`, so sources never clobber each other and each grows independently.
// Trail state (`layer.trails`, a Map<sourceKey, run>) is owned by the caller
// (compositor), reset on clear. A run = { runId, source, line: GrowLine }.
// (spec id:ft-d2-per-source-trails)

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

    // One contiguity rule for every pen — own and projected alike: a path event
    // continues the source's open run iff it carries the same stroke-run id, which
    // the scheduler assigned from the source's local geometry + style.
    // (spec id:ft-d7-deposit-runid). GrowLine.append joins from the run's last
    // endpoint, so the shared start point is skipped automatically.
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
            const deltaMovement = new THREE.Vector3(pos[0], pos[1], pos[2])
            deltaMovement.sub(ctx.head.position())
            ctx.camera.position.add(deltaMovement)
            ctx.controls.target.set(pos[0], pos[1], pos[2])
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

// Materialize a `view` event — the camera codomain of Output (sibling of
// materializeHead). A Lens emits no turtle mesh and does NOT drive the camera
// here: the eye is an ordinary ambient whose pose reframes the world at the model
// layer (compositor.updateGroupPositions premultiplies non-eye layers by E⁻¹), so
// the live orbit camera renders as effective camera E·C. All this leaf does is
// keep the eye invisible and carry the E2 `fov` lens param. The eye's pose is read
// live in the compositor from frameWorldTransform; nothing is set on the camera
// pose here (no controls fight). (specs/eye-ambient.org id:eye-lens-primitive, id:eye-coordinates)
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
    const gridHelper = new THREE.GridHelper(
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
