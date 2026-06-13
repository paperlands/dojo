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
import { worldTransform, frameWorldTransform, visitPostOrder } from "./scheduler.js"
import { SE3 } from "./se3.js"
import { eyeCameraPose } from "./view.js"
import { rebaseEpoch, idleFloorMs } from "./timeline.js"
import { createFocus } from "./focus.js"

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
    let lastWallT = null  // previous advance() wall timestamp, to detect idle-out gaps
    // Focus holds the frame's stable ADDRESS (frameAddress), never the display
    // name — focus survives re-eval and rename, and same-named sibling tabs
    // cannot steal it. Pure logic lives in focus.js (THREE-free, tested there).
    const focus = createFocus(scheduler)
    const createHead = opts.createHead || null
    const createShapist = opts.createShapist || null

    // Idle-gap detection (rerun lifecycle) lives in ./timeline.js so it can be
    // tested without THREE. frameInterval is threaded from the render loop
    // (Render.Loop, 1000/targetFPS); the idle floor derives from it.
    const FRAME_MS = opts.frameInterval || (1000 / 60)
    const IDLE_GAP_MS = idleFloorMs(FRAME_MS)

    // Per-ambient rendering state: { group, head, shapist }
    // Keyed by ambient.id (unique monotonic counter).
    const ambientLayers = new Map()

    function getOrCreateLayer(id, makeHead = true) {
        const existing = ambientLayers.get(id)
        if (existing) return existing

        const group = new THREE.Group()
        group.elements = []   // for text disposal (materializeLabel)
        stage.scene.add(group)

        // The world/root layer is a render surface for deposited ink only — no pen,
        // no turtle head. (spec id:ft-d4-world-root)
        const head = (createHead && makeHead) ? createHead(group) : null
        const shapist = createShapist ? createShapist(group) : null
        // trails: per-source consolidated polyline runs (materializer-owned state)
        const layer = { group, head, shapist, trails: new Map() }
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
        // The runs' meshes were just disposed with the group children.
        layer.trails.clear()
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

    // Is this ambient within the focused subtree? Generalizes the focused-name
    // match to descendants — a nested `eye` Lens drives the viewport when the
    // tab that owns it is focused, not only when its own name matches. Used for
    // view routing; the head/track path keeps the stricter name match below.
    const inFocusedSubtree = (ambient) => focus.inFocusedSubtree(ambient)

    function drainAndMaterialize() {
        let produced = false
        for (const [id, ambient] of scheduler.registry) {
            const events = ambient.channel.drain()
            if (events.length === 0) continue

            // The root IS the world frame: a render surface for ink deposited by
            // `as … world do`, drawn at identity with no turtle head.
            // (spec id:ft-d4-world-root)
            const isRoot = ambient === scheduler.root
            const layer = getOrCreateLayer(id, !isRoot)

            // Camera gating: a Lens drives the viewport when it's in the focused
            // subtree (the focused tab owns it, possibly via a nested eye); a
            // non-lens head tracks the camera only on a strict focus-name match.
            // Unfocused either way → null camera → no viewport effect. A focused
            // eye's view leaf only carries fov / hides the head; the camera POSE is
            // realized as a model-layer reframe in updateGroupPositions (world ←
            // E⁻¹·world), read live from the eye's world pose. (id:eye-coordinates)
            const camOn = ambient.isLens ? inFocusedSubtree(ambient) : focus.isFocused(ambient)
            const childCtx = {
                shapist: layer.shapist,
                head: layer.head,
                camera: camOn ? ctx.camera : null,
                controls: camOn ? ctx.controls : null,
                frame: ambient,
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

    // Depth of a frame from the root (root = 0). Used to pick the innermost lens.
    function frameDepth(frame) {
        let d = 0
        let f = frame
        while (f && f !== scheduler.root) { d++; f = f.parent }
        return d
    }

    // Is this transform the identity (within ε)? An empty/default eye reframes by
    // identity, so we can skip every per-layer compose and fall through to the
    // plain inertial path — the common case costs the same as having no eye.
    function isIdentitySE3(t) {
        const r = t.rotation, p = t.position
        return Math.abs(r.w - 1) < 1e-9 &&
            Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9 && Math.abs(p[2]) < 1e-9
    }

    // The focused eye's reframe: E⁻¹ where E = eye world pose in camera convention.
    // The camera IS the eye — rather than move the THREE camera (which would fight
    // OrbitControls and cannot express roll), we reframe the whole world by E⁻¹ at
    // the model layer, so the live orbit camera C renders as effective camera E·C.
    // An empty eye seeds to recenterPose ⇒ E = identity ⇒ E⁻¹ = identity. Returns
    // null when no focused lens drives OR when the reframe is identity (the default
    // eye), so callers skip the per-layer composes entirely.
    //
    // The camera is the DEEPEST focused lens. A camera tab is itself named `eye`
    // (a lens container), and the user's `as eye do …` spawns a lens INSIDE it —
    // two nested lenses. The innermost one is the camera the user actually drives;
    // the outer container sits empty at identity. (specs/eye-ambient.org id:eye-d5)
    function focusedEyeReframe() {
        if (!focus.address) return null
        let eye = null
        let deepest = -1
        for (const [id, ambient] of scheduler.registry) {
            if (ambient.isLens && inFocusedSubtree(ambient)) {
                const d = frameDepth(ambient)
                if (d > deepest) { deepest = d; eye = ambient }
            }
        }
        if (!eye) return null
        const eyeInv = SE3.invert(eyeCameraPose(frameWorldTransform(eye)))
        return isIdentitySE3(eyeInv) ? null : eyeInv
    }

    // Position child groups — inertial frame effect, optionally reframed by the
    // focused eye (world ← E⁻¹·world). The eye's own layer is skipped (it emits no
    // mesh; reframing it would place it at the camera origin to no effect).
    function updateGroupPositions() {
        const eyeInv = focusedEyeReframe()
        for (const [id, ambient] of scheduler.registry) {
            // The root/world layer (if any) positions at identity like any other
            // non-lens group; it only exists once something deposits into it.
            const layer = ambientLayers.get(id)
            if (!layer) continue

            let wt = worldTransform(ambient)
            if (eyeInv && !ambient.isLens) wt = SE3.compose(eyeInv, wt)
            layer.group.position.set(wt.position[0], wt.position[1], wt.position[2])
            layer.group.quaternion.set(
                wt.rotation.x, wt.rotation.y,
                wt.rotation.z, wt.rotation.w
            )
        }
    }

    // Reclaim ink a dead source frame deposited into THIS layer. Frame-targeted
    // children deposit into a target layer keyed by their source id; when the
    // source dies (rerun/re-eval) but the target OUTLIVES it — the world/root
    // layer never disposes — those runs would hang forever. (spec id:ft-d2 — GC)
    function reclaimDeposits(layer, deadIds) {
        // Open (still-tracked) runs.
        for (const [src, run] of layer.trails) {
            if (deadIds.has(src)) {
                if (run.line) { disposeMesh(run.line.mesh); layer.group.remove(run.line.mesh) }
                layer.trails.delete(src)
            }
        }
        // Finalized runs / filled deposits — anonymous group children tagged by source.
        for (const child of [...layer.group.children]) {
            if (child._sourceId !== undefined && deadIds.has(child._sourceId)) {
                child.traverse(disposeMesh)
                layer.group.remove(child)
            }
        }
    }

    // Remove layers for ambients no longer in the scheduler registry, then reclaim
    // any ink those dead frames deposited into layers that survive them.
    function cleanupOrphanedLayers() {
        let deadIds = null
        for (const [id, layer] of ambientLayers) {
            if (!scheduler.registry.has(id)) {
                (deadIds ||= new Set()).add(id)
                disposeLayer(id, layer)
            }
        }
        if (!deadIds) return
        for (const [, layer] of ambientLayers) {
            reclaimDeposits(layer, deadIds)
        }
    }

    const _scratchHeadPos = new THREE.Vector3()
    const _headWorldPos = new THREE.Vector3()
    function scaleChildHeads() {
        for (const [id, layer] of ambientLayers) {
            if (!layer.head) continue
            const headPos = layer.head.position()
            const gp = layer.group.position

            // Frame-targeted heads orient by world velocity (the visible ink's
            // tangent); normal heads already show their heading. Runs after
            // updateGroupPositions, so the layer pose is current. (spec id:ft-d5-head)
            const ambient = scheduler.registry.get(id)
            if (ambient && ambient.targetFrame) {
                _headWorldPos.set(headPos.x, headPos.y, headPos.z)
                    .applyQuaternion(layer.group.quaternion).add(gp)
                layer.head.orientToWorld(_headWorldPos, layer.group.quaternion)
            }

            // Reuse one scratch vector — this runs per head per frame.
            _scratchHeadPos.set(gp.x + headPos.x, gp.y + headPos.y, gp.z + headPos.z)
            const dist = ctx.camera.position.distanceTo(_scratchHeadPos)
            layer.head.scale(dist / 250)
        }
    }

    return {
        scheduler,

        get focusedAddress() { return focus.address },
        set focusedAddress(v) { focus.address = v },

        // The name view — display projection of the focused address. Read-only:
        // writers go through focusedAddress (one register, one write path).
        get focusedName() { return focus.name },

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
            // When the render-on-demand loop wakes after idling, the wall clock has
            // marched on but sim time must not. rebaseEpoch absorbs an idle-out gap
            // so `now` continues from where it paused instead of fast-forwarding the
            // animation — the rerun-after-idle "starts halfway" bug. (timeline.js)
            epoch = rebaseEpoch(epoch, lastWallT, t, FRAME_MS, IDLE_GAP_MS)
            lastWallT = t
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
            }
            // Reframe every frame, even when the scheduler is done: a focused eye's
            // model-layer reframe (world ← E⁻¹·world) must persist while the user
            // orbits a FINISHED batch program, and is recomputed live so a moving
            // eye (animation/mount) keeps tracking. Cheap: one E⁻¹ + N composes.
            updateGroupPositions()
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
