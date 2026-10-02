// Materializer — converts TurtleEvents into THREE.js scene objects.
// Consumes executor events directly (tuple positions, clean field names).
// Material cache (spec A3): one LineMaterial per (color, thickness) key —
// owned by the stage via createMaterialCache (render/line/material-cache.js).

import {
    BufferGeometry,
    Float32BufferAttribute,
    GridHelper,
    Group,
    Mesh,
    MeshBasicMaterial,
    Vector3,
} from '../utils/three-entry.js'
import { followPosition } from './view.js'
import { ColorConverter } from '../utils/color.js'
// troika is imported by the browser entry (render/index.js) and injected as a
// factory; this module stays importable without the vendored bundle so the
// compositor can be held by `node --test`. (id:label-reuse, compositor_stage_test)
import { createLabelPool } from './render/label-pool.js'
import { Line2 } from '../utils/three-addons/lines/Line2.js'
import { LineGeometry } from '../utils/three-addons/lines/LineGeometry.js'
import { GrowLine } from './render/line/GrowLine.js'

// Re-export so callers that already import materializer keep one door.
export { createMaterialCache } from './render/line/material-cache.js'

const LABEL_FONT = '/fonts/paperLang.ttf'

// A layer's label pool, wired to the vendored troika Text. The compositor owns
// one per layer and never imports the troika bundle itself. (id:label-reuse)
export function createLabels(group, opts = {}) {
    if (typeof opts.createText !== "function") {
        throw new TypeError("createLabels: opts.createText is required (the stage owns the Text constructor)")
    }
    return createLabelPool(group, { createText: opts.createText, font: opts.font ?? LABEL_FONT })
}

// WHAT THE RENDERER DRAWS — one row per kind, so the vocabulary is a LIST a reader (and
// a witness) can see, not a switch body. A kind absent here is deliberately not drawn:
// `error`, `beat`, `notice`, `clear` and the temporal markers are the compositor's or
// the scheduler's business, and the compositor's own drain says so. Adding a drawn kind
// is an edit HERE. (See test/js/notation/event_vocabulary_test.mjs.)
// A row takes (event, groups, ctx, frame) and answers nothing.
export const MATERIALIZERS = {
    path: (event, groups, ctx) => materializePath(event, groups.pathGroup, ctx.shapist, undefined, ctx.materials),
    head: (event, _groups, ctx) => materializeHead(event, ctx),
    vector: (event, _groups, ctx) => materializeVector(event, _groups, ctx),
    view: (event, _groups, ctx) => materializeView(event, ctx),
    label: (event, _groups, ctx) => materializeLabel(event, ctx),
    grid: (event, groups) => materializeGrid(event, groups.gridGroup),
    // A temporal marker: the scheduler advances the clock and the compositor takes the
    // beat. Drawing nothing is the row's whole content.
    wait: () => {},
}

// Materialize a single event into the scene.
// groups = { pathGroup, gridGroup }
// ctx    = { materials, shapist, labels, head, camera, controls, requestRender }
export function materialize(event, groups, ctx, frame = null) {
    MATERIALIZERS[event.type]?.(event, groups, ctx, frame)
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

    // A camera is only followed when there is something to follow THROUGH. `controls`
    // may be absent (no stage controls, a targetless stub, a headless rehearsal), and a
    // missing target must cost the follow, never the whole compositor pass — this threw
    // `can't access property "x", … is undefined` out of `advance`, froze the figure and
    // left one console line. (Fixed 2026-10-02; reproduced: a targetless controls +
    // `desire: 'track'`.)
    const eye = ctx.camera?.position ?? null
    const target = ctx.controls?.target ?? null
    if (ctx.camera && eye && target) {
        switch (ctx.camera.desire) {
        case 'track': {
            // Follow off the target, not the head mesh — the head respawns on
            // every re-eval, which walked the camera per edit. (view.js followPosition)
            const next = followPosition([eye.x, eye.y, eye.z], [target.x, target.y, target.z], pos)
            eye.set(next[0], next[1], next[2])
            target.set(pos[0], pos[1], pos[2])
            break
        }
        case 'pan':
            target.set(pos[0], pos[1], pos[2])
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

// A VECTOR is an object, not deposited ink: a straight line from the frame it was
// declared in to the point it reaches, with an ARROWHEAD at the tip. Keyed, so an
// update REPLACES the line — the vector is what it is now. (id:notation-coordinate-vector)
const ARROW_SEGMENTS = 12
const ARROW_RADIUS = 0.45
const _up = new Vector3(0, 1, 0)
const _dir = new Vector3()

// A unit cone, tip at +y — built by hand like the head's own geometry, because the
// three entry's export list is deliberate. (id:notation-coordinate-vector)
function arrowGeometry() {
    const positions = []
    for (let i = 0; i < ARROW_SEGMENTS; i++) {
        const a = (i / ARROW_SEGMENTS) * Math.PI * 2
        const b = ((i + 1) / ARROW_SEGMENTS) * Math.PI * 2
        positions.push(0, 0.5, 0,
            ARROW_RADIUS * Math.cos(a), -0.5, ARROW_RADIUS * Math.sin(a),
            ARROW_RADIUS * Math.cos(b), -0.5, ARROW_RADIUS * Math.sin(b))
    }
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return geometry
}

// The arrowhead sits at the tip and points along the segment. The compositor scales it
// per frame, exactly as it scales a head, so its on-screen size is invariant.
function placeArrow(head, from, to) {
    if (!head) return
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2]
    const len = Math.hypot(dx, dy, dz)
    head.visible = len > 1e-9
    if (!head.visible) return
    head.position.set(to[0], to[1], to[2])
    head.quaternion.setFromUnitVectors(_up, _dir.set(dx / len, dy / len, dz / len))
}

function materializeVector(event, groups, ctx) {
    const store = ctx.vectors
    if (!store || !event.from || !event.to) return
    const geometry = new LineGeometry()
    geometry.setPositions(new Float32Array([...event.from, ...event.to]))
    let entry = store.get(event.name)
    if (!entry) {
        const line = new Line2(geometry, ctx.materials?.get(event.color, event.thickness))
        line.computeLineDistances()
        groups.pathGroup?.add?.(line)
        const head = new Group()
        const cone = new Mesh(arrowGeometry(), new MeshBasicMaterial({ color: event.color }))
        cone.position.y = -0.5          // the cone's tip lands on the group's origin
        head.add(cone)
        groups.pathGroup?.add?.(head)
        entry = { line, head, event }
        store.set(event.name, entry)
    } else {
        const stale = entry.line.geometry
        entry.line.geometry = geometry
        entry.line.computeLineDistances()
        stale?.dispose?.()
        entry.event = event
    }
    placeArrow(entry.head, event.from, event.to)
    // The NAME is not deposited ink and not layer geometry: a declared object's
    // identifying name is screen-space, drawn by the overlay beside the pin's own
    // (id:laws-decl-interface). The entry keeps the event so the overlay can project
    // the tip; the arrow stays world geometry. (id:notation-coordinate-vector)
    ctx.requestRender?.()
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
