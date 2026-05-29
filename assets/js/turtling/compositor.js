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
import { materialize, accumulateTrail, flushTrail, clearMaterialCache } from "./materializer.js"
import { groupTransform, visitPostOrder } from "./scheduler.js"

// Set opacity on a group, cloning shared materials so the material cache isn't mutated.
// Troika Text meshes own a derived SDF material — cloning it severs the shader, so
// we set opacity directly on those without cloning.
function setGroupOpacity(group, opacity) {
    group.traverse(child => {
        if (child.material) {
            if (typeof child.text === 'string') {
                child.material.transparent = true
                child.material.opacity = opacity
            } else {
                if (!child._ownMaterial) {
                    child.material = child.material.clone()
                    child._ownMaterial = true
                }
                child.material.transparent = true
                child.material.opacity = opacity
            }
        }
    })
}

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
        // trail: current consolidated polyline run (materializer-owned state)
        const layer = { group, head, shapist, trail: null }
        ambientLayers.set(id, layer)
        return layer
    }

    // Dispose a mesh's geometry, and its material ONLY if not cache-owned.
    // Shared LineMaterials (materializer cache, _cached) are disposed wholesale
    // by clearMaterialCache(), never per-mesh — disposing one here would free a
    // GPU material still referenced by every other mesh sharing its key.
    function disposeMesh(c) {
        if (c.geometry) c.geometry.dispose()
        if (c.material && !c.material._cached) c.material.dispose()
    }

    // Clear a child layer's geometry/materials but preserve its head mesh.
    function clearChildLayer(layer) {
        const headGroup = layer.head?.turtleGroup
        for (const child of [...layer.group.children]) {
            if (child === headGroup) continue
            child.traverse(disposeMesh)
            layer.group.remove(child)
        }
        if (layer.group.elements) {
            layer.group.elements.forEach(text => text.dispose?.())
            layer.group.elements = []
        }
        // The current trail's mesh was just disposed with the group children.
        layer.trail = null
    }

    // Dispose a layer entirely: hide head, dispose shapist, remove from scene.
    function disposeLayer(id, layer) {
        if (layer.head) layer.head.hide()
        if (layer.shapist) layer.shapist.dispose()
        layer.group.traverse(disposeMesh)
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
                controls: isFocused ? ctx.controls : null,
                // Async materializers (troika Text) call this when their geometry
                // finishes building, to wake a render-on-demand loop that may have
                // already idled out.
                requestRender: stage.requestRender
            }
            const childGroups = { pathGroup: layer.group, gridGroup: layer.group, glyphGroup: layer.group }

            for (const event of events) {
                if (event.type === 'error') continue
                if (event.type === 'clear') {
                    clearChildLayer(layer)
                } else if (event.type === 'path') {
                    // Consolidate contiguous segments into one growing mesh
                    // instead of one mesh per event (draw-call collapse).
                    accumulateTrail(event, layer)
                } else {
                    materialize(event, childGroups, childCtx)
                }
            }
            // Rebuild the trail mesh once per frame, not per event.
            flushTrail(layer)
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

    const _scratchHeadPos = new THREE.Vector3()
    function scaleChildHeads() {
        for (const [id, layer] of ambientLayers) {
            if (!layer.head) continue
            const headPos = layer.head.position()
            const gp = layer.group.position
            // Reuse one scratch vector — this runs per head per frame.
            _scratchHeadPos.set(gp.x + headPos.x, gp.y + headPos.y, gp.z + headPos.z)
            const dist = ctx.camera.position.distanceTo(_scratchHeadPos)
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
                if (scheduler.done || !progress) break
            }
            // Drain once after all ticks — channels accumulate across ticks, so
            // we materialize the batch in a single pass (one trail rebuild, not N).
            drainAndMaterialize()
            updateGroupPositions()
            return scheduler.done
        },

        // Per-frame work: tick generators, materialize, position, scale heads.
        // Does NOT render — caller coordinates renderer.render().
        advance(t) {
            if (epoch === null) epoch = t
            const now = t - epoch
            scheduler.lastTickTime = now
            if (!scheduler.done) {
                // Catch sim time up to the wall clock by ticking until no frame
                // makes progress (each frame advances one wait-step per tick).
                // Channels accumulate events across these ticks...
                let budget = 64
                let progress
                do {
                    progress = scheduler.tick(now)
                } while (progress && !scheduler.done && --budget > 0)
                // ...so drain + materialize ONCE per frame. Previously this ran
                // per tick, rebuilding every trail mesh ~N× per frame (the heavy
                // catch-up cost). One pass = one trail rebuild per ambient.
                drainAndMaterialize()
                updateGroupPositions()
            }
            cleanupOrphanedLayers()
            scaleChildHeads()
        },

        // Set opacity on an ambient's layer and all its descendants.
        // Clones shared materials per-mesh to avoid mutating the material cache.
        setOpacityByName(name, opacity) {
            for (const [id, ambient] of scheduler.registry) {
                if (ambient.name === name) {
                    const applyOpacity = (frame) => {
                        const layer = ambientLayers.get(frame.id)
                        if (layer) setGroupOpacity(layer.group, opacity)
                    }
                    visitPostOrder(ambient, applyOpacity)
                    break
                }
            }
        },

        // Propagate opacity to all child ambient layers.
        setOpacity(opacity) {
            for (const [id, layer] of ambientLayers) {
                setGroupOpacity(layer.group, opacity)
            }
        },

        // Clean up all layers. Called on turtle.reset().
        dispose() {
            for (const [id, layer] of ambientLayers) {
                disposeLayer(id, layer)
            }
            ambientLayers.clear()
            // Reclaim the module-global material cache — nothing references it
            // once all layers are gone.
            clearMaterialCache()
        }
    }
}
