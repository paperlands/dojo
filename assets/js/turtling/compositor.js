// Compositor — drains all ambient channels through materializer per frame.
// Phase 6: unified tree — all ambients are children of a meta-root.
//
// Every ambient gets its own THREE.Group, Head, and Shapist.
// The focused ambient's head tracks the camera; unfocused heads render
// without camera tracking (materializeHead already gates on ctx.camera).
//
// Each frame the compositor:
// 1. Ticks the scheduler (advance all ambient generators, fill channels)
// 2. Creates layers (group + head + shapist) for newly spawned ambients
// 3. Drains all ambient channels, materializing into per-ambient groups
// 4. Updates child group positions from worldTransform (inertial frames)
// 5. Cleans up layers for terminated ambients

import * as THREE from '../utils/three.core.min.js'
import { materialize } from "./materializer.js"
import { groupTransform } from "./scheduler.js"

// Create a compositor bound to a scheduler and stage infrastructure.
//
// ctx     = { camera, controls }
// stage   = { scene, renderer, recorder, renderstate, hatch }
// opts    = { createHead, createShapist }
export function createCompositor(scheduler, ctx, stage, opts = {}) {
    let epoch = null      // first real timestamp — rebases advance() to flush()'s 0-based timeline
    let focusedName = null
    const createHead = opts.createHead || null
    const createShapist = opts.createShapist || null

    // Per-ambient rendering state: { group, head, shapist }
    // Keyed by ambient.id (unique monotonic counter).
    const ambientLayers = new Map()

    function getOrCreateLayer(id) {
        const existing = ambientLayers.get(id)
        if (existing) return existing

        const group = new THREE.Group()
        group.elements = []   // for text disposal (materializeLabel)
        stage.scene.add(group)

        const head = createHead ? createHead(group) : null
        const shapist = createShapist ? createShapist(group) : null
        const layer = { group, head, shapist }
        ambientLayers.set(id, layer)
        return layer
    }

    // Clear a child layer's geometry/materials but preserve its head mesh.
    function clearChildLayer(layer) {
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
    }

    // Dispose a layer entirely: hide head, dispose shapist, remove from scene.
    function disposeLayer(id, layer) {
        if (layer.head) layer.head.hide()
        if (layer.shapist) layer.shapist.dispose()
        layer.group.traverse(c => {
            if (c.geometry) c.geometry.dispose()
            if (c.material) c.material.dispose()
        })
        if (layer.group.elements) {
            layer.group.elements.forEach(t => t.dispose?.())
        }
        stage.scene.remove(layer.group)
        ambientLayers.delete(id)
    }

    function drainAndMaterialize() {
        let produced = false
        for (const [id, ambient] of scheduler.registry) {
            if (ambient === scheduler.root) continue

            const events = ambient.channel.drain()
            if (events.length === 0) continue

            const layer = getOrCreateLayer(id)
            const isFocused = (ambient.name === focusedName)

            // Focused child gets full ctx (camera tracking + shapist).
            // Unfocused gets null camera — materializeHead gates on ctx.camera.
            const childCtx = {
                shapist: layer.shapist,
                head: layer.head,
                camera: isFocused ? ctx.camera : null,
                controls: isFocused ? ctx.controls : null
            }
            const childGroups = { pathGroup: layer.group, gridGroup: layer.group, glyphGroup: layer.group }

            for (const event of events) {
                if (event.type === 'error') continue
                if (event.type === 'clear') {
                    clearChildLayer(layer)
                } else {
                    materialize(event, childGroups, childCtx)
                }
            }
            produced = true
        }
        return produced
    }

    // Position child groups — inertial frame effect.
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

    // Remove layers for ambients no longer in the scheduler registry.
    function cleanupOrphanedLayers() {
        for (const [id, layer] of ambientLayers) {
            if (!scheduler.registry.has(id)) {
                disposeLayer(id, layer)
            }
        }
    }

    function scaleChildHeads() {
        for (const [id, layer] of ambientLayers) {
            if (!layer.head) continue
            const headPos = layer.head.position()
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

        get focusedName() { return focusedName },
        set focusedName(v) { focusedName = v },

        // Eagerly drain a batch program (no waits) during draw().
        // Uses scheduler.lastTickTime so new children's waits are
        // relative to the current timeline, not time 0.
        flush() {
            const flushTime = scheduler.lastTickTime || 0
            let maxTicks = 10000
            while (maxTicks-- > 0) {
                const progress = scheduler.tick(flushTime)
                drainAndMaterialize()
                if (scheduler.done || !progress) break
            }
            updateGroupPositions()
            return scheduler.done
        },

        // Per-frame work: tick generators, materialize, position, scale heads.
        // Does NOT render — caller coordinates renderer.render().
        advance(t) {
            if (epoch === null) epoch = t
            const now = t - epoch
            if (!scheduler.done) {
                let budget = 64
                let progress
                do {
                    progress = scheduler.tick(now)
                    if (progress) drainAndMaterialize()
                } while (progress && !scheduler.done && --budget > 0)
                updateGroupPositions()
            }
            cleanupOrphanedLayers()
            scaleChildHeads()
        },

        // Set opacity on a specific ambient's layer, found by name.
        setOpacityByName(name, opacity) {
            for (const [id, ambient] of scheduler.registry) {
                if (ambient.name === name) {
                    const layer = ambientLayers.get(id)
                    if (layer) {
                        layer.group.traverse(child => {
                            if (child.material) {
                                child.material.transparent = true
                                child.material.opacity = opacity
                            }
                        })
                    }
                    break
                }
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

        // Clean up all layers. Called on turtle.reset().
        dispose() {
            for (const [id, layer] of ambientLayers) {
                disposeLayer(id, layer)
            }
            ambientLayers.clear()
        }
    }
}
