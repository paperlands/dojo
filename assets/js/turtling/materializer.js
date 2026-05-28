// Materializer — converts TurtleEvents into THREE.js scene objects.
// Consumes executor events directly (tuple positions, clean field names).
// Material cache (spec A3): one LineMaterial per (color, thickness) key.

import * as THREE from '../utils/three.core.min.js'
import { ColorConverter } from '../utils/color.js'
import { Text } from '../utils/threetext'
import { Line2 } from './render/line/Line2.js'
import { LineMaterial } from './render/line/LineMaterial.js'
import { LineGeometry } from './render/line/LineGeometry.js'

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

    case "label":
        materializeLabel(event, groups.glyphGroup)
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

function materializePath(event, pathGroup, shapist) {
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
// We accumulate contiguous, same-(color,thickness) path events into a single
// growing Line2 per layer. A style change or a discontinuity (jmp / pen-up)
// finalizes the current run (its mesh stays) and starts a new one. Filled
// polygons remain standalone. Trail state is owned by the caller (compositor),
// stored on `layer.trail`, and reset on clear.

const _samePoint = (a, b) =>
    a && b &&
    Math.abs(a[0] - b[0]) < 1e-6 &&
    Math.abs(a[1] - b[1]) < 1e-6 &&
    Math.abs(a[2] - b[2]) < 1e-6

// Append a path event into layer.trail (mutated in place). Returns the layer.
export function accumulateTrail(event, layer) {
    if (!event.points || event.points.length === 0) return layer

    // Filled polygons are standalone — finalize any open run, render separately.
    if (event.filled) {
        layer.trail = null
        materializePath(event, layer.group, layer.shapist)
        return layer
    }

    const key = `${event.color || 0xe77808}:${event.thickness || 2}`
    let tr = layer.trail
    const contiguous = tr && tr.key === key && _samePoint(tr.lastPoint, event.points[0])

    if (!contiguous) {
        // Start a new run. Any previous run keeps its (already-added) mesh.
        tr = layer.trail = { key, color: event.color, thickness: event.thickness, pts: [], mesh: null, lastPoint: null, dirty: true }
        for (const p of event.points) tr.pts.push(p[0], p[1], p[2])
    } else {
        // Skip the duplicated shared start point.
        for (let i = 1; i < event.points.length; i++) {
            const p = event.points[i]
            tr.pts.push(p[0], p[1], p[2])
        }
    }
    tr.lastPoint = event.points[event.points.length - 1]
    tr.dirty = true
    return layer
}

// Rebuild the current run's single mesh from accumulated points. Called once
// per frame per layer (not per event) by the compositor after draining.
export function flushTrail(layer) {
    const tr = layer.trail
    if (!tr || !tr.dirty || tr.pts.length < 6) return
    const positions = new Float32Array(tr.pts)
    const geometry = new LineGeometry()
    geometry.setPositions(positions)
    if (tr.mesh) {
        tr.mesh.geometry.dispose()
        tr.mesh.geometry = geometry
    } else {
        tr.mesh = new Line2(geometry, getOrCreateMaterial(tr.color, tr.thickness))
        layer.group.add(tr.mesh)
    }
    tr.mesh.computeLineDistances()
    tr.dirty = false
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
        ctx.head.show()
        ctx.head.update(pos, event.rotation, event.color, event.headSize)
    } else {
        ctx.head.hide()
    }
}

function materializeLabel(event, glyphGroup) {
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
        newText.sync()
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
