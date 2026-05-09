// Materializer — converts TurtleEvents into THREE.js scene objects.
// Consumes executor events directly (tuple positions, clean field names).
// No timeline, no intermediate data structures.

import * as THREE from '../utils/three.core.min.js'
import { ColorConverter } from '../utils/color.js'
import { Text } from '../utils/threetext'
import { Line2 } from './render/line/Line2.js'
import { LineMaterial } from './render/line/LineMaterial.js'
import { LineGeometry } from './render/line/LineGeometry.js'

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
        clearGroups(groups)
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

        // Flatten [x,y,z] tuples to position array
        const positions = new Float32Array(event.points.length * 3)
        for (let i = 0; i < event.points.length; i++) {
            const p = event.points[i]
            positions[i * 3] = p[0]
            positions[i * 3 + 1] = p[1]
            positions[i * 3 + 2] = p[2]
        }

        const geometry = new LineGeometry()
        geometry.setPositions(positions)

        const material = new LineMaterial({
            color: event.color || 0xe77808,
            linewidth: event.thickness || 2,
            vertexColors: false,
            dashed: false,
        })
        material.resolution.set(window.innerWidth, window.innerHeight)

        const mesh = new Line2(geometry, material)
        pathGroup.add(mesh)

        if (event.filled && shapist) {
            // shapist expects {x,y,z} objects for polygon triangulation
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

function clearGroups(groups) {
    groups.pathGroup.clear()
    groups.glyphGroup.clear()
    groups.gridGroup.clear()
    if (groups.glyphGroup.elements) {
        groups.glyphGroup.elements.forEach(text => text.dispose())
        groups.glyphGroup.elements = []
    }
}
