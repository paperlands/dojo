// Materializer — converts TurtleEvents into THREE.js scene objects.
// Consumes executor events directly (tuple positions, clean field names).
// Material cache (spec A3): one LineMaterial per (color, thickness) key —
// owned by the stage via createMaterialCache (render/line/material-cache.js).

import { GridHelper } from '../utils/three-entry.js'
import { followPosition } from './view.js'
import { ColorConverter } from '../utils/color.js'
import { Text } from '../utils/threetext.js'
import { createLabelPool } from './render/label-pool.js'
import { Line2 } from '../utils/three-addons/lines/Line2.js'
import { LineGeometry } from '../utils/three-addons/lines/LineGeometry.js'
import { GrowLine } from './render/line/GrowLine.js'

// Re-export so callers that already import materializer keep one door.
export { createMaterialCache } from './render/line/material-cache.js'

const LABEL_FONT = '/fonts/paperLang.ttf'

// A layer's label pool, wired to the vendored troika Text. The compositor owns
// one per layer and never imports the troika bundle itself. (id:label-reuse)
export function createLabels(group) {
    return createLabelPool(group, { createText: () => new Text(), font: LABEL_FONT })
}

// Materialize a single event into the scene.
// groups = { pathGroup, gridGroup }
// ctx    = { materials, shapist, labels, head, camera, controls, requestRender }
export function materialize(event, groups, ctx) {
    switch (event.type) {

    case "path":
        materializePath(event, groups.pathGroup, ctx.shapist, undefined, ctx.materials)
        break

    case "head":
        materializeHead(event, ctx)
        break

    case "view":
        materializeView(event, ctx)
        break

    case "label":
        materializeLabel(event, ctx)
        break

    case "grid":
        materializeGrid(event, groups.gridGroup)
        break

    case "wait":
        // Wait events are temporal markers — handled by the scheduler/compositor,
        // not the materializer. Head snapshot for wait is emitted separately.
        break
    }
}

// --- Internal materializers ---

function materializePath(event, pathGroup, shapist, sourceId, materials) {
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

        const material = materials.get(event.color, event.thickness)
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
// world/root layer) can reclaim this ink on rerun. Ink materials are
// vertex-coloured (id:child-ink); mono get() stays for filled/one-shot paths.
// (spec id:ft-d2 — GC)
function newRun(event, source, layer, materials) {
    const line = new GrowLine(materials.getInk(event.thickness))
    line.mesh._sourceId = source
    layer.group.add(line.mesh)
    return { runId: event.runId, source, line }
}

// Append a path event into its source's run in layer.trails. Returns the layer.
// materials — the stage-owned cache (spec A3); required for path strokes.
export function accumulateTrail(event, layer, materials) {
    if (!event.points || event.points.length === 0) return layer

    const source = event.sourceId != null ? event.sourceId : SELF_SOURCE

    // Filled polygons are standalone — close this source's open run, render apart.
    if (event.filled) {
        const open = layer.trails.get(source)
        if (open) { open.line.sync(); layer.trails.delete(source) }
        materializePath(event, layer.group, layer.shapist, source, materials)
        return layer
    }

    // A path event continues its source's open run iff it carries the same
    // stroke-run id (scheduler: thickness + join; colour is ink). GrowLine.append
    // joins from the run's last endpoint, skipping the shared start point.
    // id:ft-d7-deposit-runid, id:child-ink
    let tr = layer.trails.get(source)
    if (!(tr && tr.runId === event.runId)) {
        if (tr) tr.line.sync()        // close the prior run; its mesh stays in the group
        tr = newRun(event, source, layer, materials)
        layer.trails.set(source, tr)
    }
    tr.line.append(event.points, ColorConverter.toRGBArray(event.color))
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
        // Heading is layer-local (projectHead folds frame targeting in).
        // An empty place has no head until its body emits a visible pose.
        // Headless rendering must still leave the rest of the pass intact.
        ctx.head?.show?.()
        ctx.head?.update?.(pos, event.rotation, event.color, event.headSize)
    } else {
        ctx.head?.hide?.()
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

// A label is a write into the layer's pool, never a fresh Text: a rebuilt Text
// is blank until its async sync lands, so a label/erase cycle would blink at
// every transition. Reuse keeps the built geometry. (id:label-reuse)
function materializeLabel(event, ctx) {
    try {
        ctx.labels?.write(event, ctx.requestRender)
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
