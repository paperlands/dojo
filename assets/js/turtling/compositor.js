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
import { groupTransform } from "./scheduler.js"
import { SE3 } from "./se3.js"

// Create a compositor bound to a scheduler and stage infrastructure.
//
// stage   = { scene, renderer, recorder, renderstate, hatch }
// groups  = { pathGroup, gridGroup, glyphGroup }
// ctx     = { shapist, head, camera, controls }
// opts    = { createHead }
export function createCompositor(scheduler, groups, ctx, stage, opts = {}) {
    let snapshotPending = false
    let focused = true   // only focused compositor's head events track camera
    let epoch = null      // first real timestamp — rebases advance() to flush()'s 0-based timeline
    const createHead = opts.createHead || null

    // Per-ambient rendering state: { group, head }
    // Keyed by ambient.id (unique monotonic counter), so each ambient
    // gets exactly one layer. No generation tracking needed — unique IDs
    // mean a re-spawned ambient is a new entry, never a collision.
    const ambientLayers = new Map()

    function getOrCreateLayer(id) {
        const existing = ambientLayers.get(id)
        if (existing) return existing

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
            if (ambient === scheduler.root) {
                for (const event of events) {
                    if (event.type === 'error') continue
                    // Unfocused: render head but skip camera tracking
                    const effectiveCtx = (!focused && event.type === 'head')
                        ? { ...ctx, camera: null, controls: null }
                        : ctx
                    materialize(event, groups, effectiveCtx)
                }
            } else {
                const layer = getOrCreateLayer(id)
                for (const event of events) {
                    if (event.type === 'error') continue
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
                    } else if (event.type === 'clear') {
                        // Clear child layer but preserve its head mesh
                        const headGroup = layer.head?.turtleGroup
                        for (const child of [...layer.group.children]) {
                            if (child === headGroup) continue
                            child.traverse(c => {
                                if (c.geometry) c.geometry.dispose()
                                if (c.material) c.material.dispose()
                            })
                            layer.group.remove(child)
                        }
                        if (layer.group.elements) {
                            layer.group.elements.forEach(text => text.dispose?.())
                            layer.group.elements = []
                        }
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

    // Position child groups — inertial frame effect.
    // Frame-targeted children use relativeTransform (matching path projection).
    // Normal children use worldTransform (birth origin, sibling isolation).
    function updateGroupPositions() {
        for (const [id, ambient] of scheduler.registry) {
            if (ambient === scheduler.root) continue
            const layer = ambientLayers.get(id)
            if (!layer) continue

            const wt = groupTransform(ambient)
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

        get focused() { return focused },
        set focused(v) { focused = v },

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

        // Per-ambient work: tick generators, materialize, update positions, scale heads.
        // Does NOT render or handle recording/snapshots — caller coordinates that
        // when multiple compositors share one renderer.
        advance(t) {
            if (epoch === null) epoch = t
            if (!scheduler.done) {
                scheduler.tick(t - epoch)
                drainAndMaterialize()
                updateGroupPositions()
            }
            const scaleFactor = ctx.camera.position.distanceTo(ctx.head.position()) / 250
            ctx.head.scale(scaleFactor)
            scaleChildHeads()
        },

        // Called by the render loop every animation frame.
        // For single-compositor use — delegates to advance() then renders.
        frame(t) {
            try {
                this.advance(t)

                ctx.controls.update()
                stage.renderer.render(stage.scene, ctx.camera)

                if (stage.recorder.isRecording) {
                    stage.recorder.captureFrame()
                }

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

        // Propagate opacity to all child ambient layers.
        setOpacity(opacity) {
            for (const [id, layer] of ambientLayers) {
                layer.group.traverse(child => {
                    if (child.material) {
                        child.material.transparent = true
                        child.material.opacity = opacity
                    }
                })
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
