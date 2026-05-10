// Compositor — drains all ambient channels through materializer per frame.
// Phase 5c: per-ambient THREE.Groups + Heads, inertial frame positioning.
//
// Each child ambient gets its own THREE.Group at scene root and its own
// Head mesh. Each frame the compositor:
// 1. Ticks the scheduler (advance all ambient generators, fill channels)
// 2. Creates groups/heads for newly spawned ambients
// 3. Drains all ambient channels, materializing into per-ambient groups
// 4. Updates child group positions from worldTransform (inertial frames)
// 5. Renders the scene
// 6. Manages head scale, snapshot, recording lifecycle

import * as THREE from '../utils/three.core.min.js'
import { materialize } from "./materializer.js"
import { worldTransform } from "./scheduler.js"

// Create a compositor bound to a scheduler and stage infrastructure.
//
// stage   = { scene, renderer, recorder, renderstate, hatch }
// groups  = { pathGroup, gridGroup, glyphGroup }
// ctx     = { shapist, head, camera, controls }
// opts    = { createHead }
export function createCompositor(scheduler, groups, ctx, stage, opts = {}) {
    let snapshotPending = false
    const createHead = opts.createHead || null

    // Per-ambient rendering state: { group: THREE.Group, head: Head }
    const ambientLayers = new Map()

    function getOrCreateLayer(id) {
        if (ambientLayers.has(id)) return ambientLayers.get(id)

        const group = new THREE.Group()
        group.elements = []   // for text disposal (materializeLabel)
        stage.scene.add(group)

        const head = createHead ? createHead(group) : null
        const layer = { group, head }
        ambientLayers.set(id, layer)
        return layer
    }

    function drainAndMaterialize() {
        let produced = false
        for (const [id, ambient] of scheduler.registry) {
            const events = ambient.channel.drain()
            if (events.length === 0) continue

            if (id === 'root') {
                for (const event of events) {
                    materialize(event, groups, ctx)
                }
            } else {
                const layer = getOrCreateLayer(id)
                for (const event of events) {
                    if (event.type === 'head' && layer.head) {
                        // Child head: update the child's own head mesh
                        if (event.headSize) {
                            layer.head.show()
                            layer.head.update(
                                event.position, event.rotation,
                                event.color, event.headSize
                            )
                        } else {
                            layer.head.hide()
                        }
                    } else if (event.type === 'head') {
                        // No head mesh for this child — skip
                    } else {
                        materialize(event,
                            { pathGroup: layer.group, gridGroup: layer.group, glyphGroup: layer.group },
                            { shapist: null, head: null, camera: null, controls: null }
                        )
                    }
                }
            }
            produced = true
        }
        return produced
    }

    // Position child groups from worldTransform — the inertial frame effect.
    // Called after ticking and materializing so atoms are current.
    function updateGroupPositions() {
        for (const [id, ambient] of scheduler.registry) {
            if (id === 'root') continue
            const layer = ambientLayers.get(id)
            if (!layer) continue

            const wt = worldTransform(ambient, scheduler.registry)
            layer.group.position.set(wt.position[0], wt.position[1], wt.position[2])
            layer.group.quaternion.set(
                wt.rotation.x, wt.rotation.y,
                wt.rotation.z, wt.rotation.w
            )
        }
    }

    function scaleChildHeads() {
        for (const [id, layer] of ambientLayers) {
            if (!layer.head) continue
            // Use same scale logic as root: distance from camera
            const headPos = layer.head.position()
            // Approximate world position: group offset + local head position
            const gp = layer.group.position
            const wx = gp.x + headPos.x
            const wy = gp.y + headPos.y
            const wz = gp.z + headPos.z
            const dist = ctx.camera.position.distanceTo(new THREE.Vector3(wx, wy, wz))
            layer.head.scale(dist / 250)
        }
    }

    return {
        scheduler,

        // Eagerly drain a batch program (no waits) during draw().
        // Loops until all ambients complete or a wait is encountered.
        // Returns true if the scheduler completed entirely.
        flush() {
            let maxTicks = 10000
            while (maxTicks-- > 0) {
                const progress = scheduler.tick(0)
                drainAndMaterialize()
                if (scheduler.done || !progress) break
            }
            updateGroupPositions()
            return scheduler.done
        },

        // Called by the render loop every animation frame.
        // `t` is milliseconds since the render loop started.
        frame(t) {
            try {
                // 1. Tick the scheduler — advances all ambient generators
                if (!scheduler.done) {
                    scheduler.tick(t)
                    drainAndMaterialize()
                    updateGroupPositions()
                }

                // 2. Head scale (distance-invariant sizing)
                const scaleFactor = ctx.camera.position.distanceTo(ctx.head.position()) / 250
                ctx.head.scale(scaleFactor)
                scaleChildHeads()

                // 3. Render
                ctx.controls.update()
                stage.renderer.render(stage.scene, ctx.camera)

                // 4. Recording
                if (stage.recorder.isRecording) {
                    stage.recorder.captureFrame()
                }

                // 5. Snapshot — after first meaningful content or when done
                if (stage.renderstate.snapshot.frame == null && t > 500) {
                    stage.hatch()
                }

                if (scheduler.done && !snapshotPending) {
                    snapshotPending = true
                    stage.hatch()
                }
            } catch (error) {
                console.error('Compositor frame error:', error)
            }
        },

        // Clean up child groups and heads. Called on turtle.reset().
        dispose() {
            for (const [id, layer] of ambientLayers) {
                if (layer.head) layer.head.hide()
                // Dispose geometries/materials in group
                layer.group.traverse(child => {
                    if (child.geometry) child.geometry.dispose()
                    if (child.material) child.material.dispose()
                })
                // Dispose text elements
                if (layer.group.elements) {
                    layer.group.elements.forEach(text => text.dispose?.())
                }
                stage.scene.remove(layer.group)
            }
            ambientLayers.clear()
        }
    }
}
