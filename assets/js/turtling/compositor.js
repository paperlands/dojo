// Drain ambient channels into per-layer groups each frame.

import {
    Group,
    Vector3,
} from '../utils/three-entry.js'
import { materialize, accumulateTrail, flushTrail } from "./materializer.js"
import { worldTransform, frameWorldTransform, visitPostOrder, findReferenceFrame, takeSync } from "./scheduler.js"
import { SE3 } from "./se3.js"
import { eyeCameraPose } from "./view.js"
import { rebaseEpoch, idleFloorMs } from "./timeline.js"
import { createFocus } from "./focus.js"
import { createPacer } from "./pacer.js"

// Clone shared materials; troika Text sets opacity direct.
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

// Verbs the compositor needs on stage. controls/frameMs ride in opts, not here.
export const STAGE_CONTRACT = Object.freeze([
    'scene',          // add/remove layers
    'camera',         // head scale; materializeHead may write desire
    'requestRender',  // wake on-demand loop when async geometry lands
    'viewOffset',     // hand reframe M, folded with eye E
    'materials',      // LineMaterial cache (spec A3); stage owns lifetime
])

// opts = { createHead, createShapist, frameMs, controls }
// controls = OrbitControls target for materializeHead only.
export function createCompositor(scheduler, stage, opts = {}) {
    for (const name of STAGE_CONTRACT) {
        if (!stage || !(name in stage)) {
            throw new TypeError(`compositor: stage is missing \`${name}\` (STAGE_CONTRACT)`)
        }
    }
    let epoch = null      // first real timestamp — rebases advance() to flush()'s 0-based timeline
    let lastWallT = null  // previous advance() wall timestamp, to detect idle-out gaps
    // Focus by address; logic in focus.js.
    const focus = createFocus(scheduler)
    const createHead = opts.createHead || null
    const createShapist = opts.createShapist || null
    // Orbit target for materializeHead; headless callers omit it.
    const controls = opts.controls ?? null
    // Timeslice budget lives with the frame loop (AIMD quantum). (id:output-ledger-r2-pacer)
    const pacer = opts.pacer || createPacer()
    let frameStart = null

    // Cadence is an opt (default 60 Hz) — not reached through stage.renderLoop.
    const FRAME_MS = opts.frameMs ?? (1000 / 60)
    const IDLE_GAP_MS = idleFloorMs(FRAME_MS)

    // Per-ambient rendering state: { group, head, shapist }
    // Keyed by ambient.id (unique monotonic counter).
    const ambientLayers = new Map()

    function getOrCreateLayer(id, makeHead = true) {
        const existing = ambientLayers.get(id)
        if (existing) return existing

        const group = new Group()
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

    // Dispose geometry; skip cache-owned materials.
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

    // Focused subtree for view routing; head uses stricter name match.
    const inFocusedSubtree = (ambient) => focus.inFocusedSubtree(ambient)

    function drainAndMaterialize() {
        let produced = false
        for (const [id, ambient] of scheduler.registry) {
            const events = ambient.channel.drain()
            // Two disciplines, one drain each: the channel keeps every event,
            // the slot keeps only the newest pose. (id:output-ledger-r2-slot)
            const poses = takeSync(ambient)
            if (events.length === 0 && poses.length === 0) continue

            // Root world frame: ink only. (id:ft-d4-world-root)
            const isRoot = ambient === scheduler.root
            const layer = getOrCreateLayer(id, !isRoot)

            // Lens tracks in focused subtree; pose is E⁻¹·world. (id:eye-coordinates)
            const camOn = ambient.isLens ? inFocusedSubtree(ambient) : focus.isFocused(ambient)
            const childCtx = {
                materials: stage.materials,
                shapist: layer.shapist,
                head: layer.head,
                camera: camOn ? stage.camera : null,
                controls: camOn ? controls : null,
                frame: ambient,
                // Wake render-on-demand when async geometry lands.
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
                    accumulateTrail(event, layer, stage.materials)
                } else {
                    materialize(event, childGroups, childCtx)
                }
            }
            // Poses land after the batch: the newest is where the turtle IS.
            for (const pose of poses) materialize(pose, childGroups, childCtx)
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

    // Skip compose when reframe is identity.
    function isIdentitySE3(t) {
        const r = t.rotation, p = t.position
        return Math.abs(r.w - 1) < 1e-9 &&
            Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9 && Math.abs(p[2]) < 1e-9
    }

    // Deepest focused lens → E⁻¹ world reframe; null if identity. (id:eye-d5)
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

    // View = (E·M)⁻¹; null when identity. Eye and hand share one seam.
    function viewReframe() {
        const eyeInv = focusedEyeReframe()
        const offset = stage.viewOffset()
        if (isIdentitySE3(offset)) return eyeInv
        const offsetInv = SE3.invert(offset)
        return eyeInv ? SE3.compose(offsetInv, eyeInv) : offsetInv
    }

    // Seat groups at worldTransform; skip the driving eye's layer.
    function updateGroupPositions() {
        const eyeInv = viewReframe()
        for (const [id, ambient] of scheduler.registry) {
            // The root/world layer (if any) positions at identity like any other
            // non-lens group; it only exists once something deposits into it.
            const layer = ambientLayers.get(id)
            if (!layer) continue

            // Frame-targeted head seats at target worldTransform. (id:ft-d5-head)
            let wt = worldTransform(ambient)
            if (ambient.targetFrame) {
                const target = findReferenceFrame(ambient, ambient.targetFrame)
                if (target) wt = worldTransform(target)
            }
            if (eyeInv && !ambient.isLens) wt = SE3.compose(eyeInv, wt)
            layer.group.position.set(wt.position[0], wt.position[1], wt.position[2])
            layer.group.quaternion.set(
                wt.rotation.x, wt.rotation.y,
                wt.rotation.z, wt.rotation.w
            )
        }
    }

    // GC ink from dead sources that outlived their layer. (id:ft-d2)
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

    // Drop dead ambient layers; reclaim their deposited ink.
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

    const _scratchHeadPos = new Vector3()
    const _headWorldPos = new Vector3()
    function scaleChildHeads() {
        for (const [id, layer] of ambientLayers) {
            if (!layer.head) continue
            const headPos = layer.head.position()
            const gp = layer.group.position

            // Frame-targeted heads orient by world velocity. (id:ft-d5-head)
            const ambient = scheduler.registry.get(id)
            if (ambient && ambient.targetFrame) {
                _headWorldPos.set(headPos.x, headPos.y, headPos.z)
                    .applyQuaternion(layer.group.quaternion).add(gp)
                layer.head.orientToWorld(_headWorldPos, layer.group.quaternion)
            }

            // Reuse one scratch vector — this runs per head per frame.
            _scratchHeadPos.set(gp.x + headPos.x, gp.y + headPos.y, gp.z + headPos.z)
            const dist = stage.camera.position.distanceTo(_scratchHeadPos)
            layer.head.scale(dist / 250)
        }
    }

    // Pump until rest / park-out / stall. Caller must arm the timeslice.
    function driveToRest() {
        const flushTime = scheduler.lastTickTime || 0
        let maxTicks = 10000  // rate backstop; truth bounds fire first (id:output-ledger-r2-bounds)
        while (maxTicks-- > 0) {
            const progress = scheduler.tick(flushTime)
            if (scheduler.done) break
            // Still building → yield the thread to rAF (preempt the pump).
            if (scheduler.building) { drainAndMaterialize(); break }
            if (!progress && !drainAndMaterialize()) break
        }
    }

    // Catch sim time to `now` inside the open slice, then materialize once.
    function driveOneFrame(now) {
        let budget = 64
        let progress
        do {
            progress = scheduler.tick(now)
        } while (progress && !scheduler.done && --budget > 0)
    }

    return {
        scheduler,

        get budgetMs() { return pacer.budgetMs },

        get focusedAddress() { return focus.address },
        set focusedAddress(v) { focus.address = v },

        // Display projection of focusedAddress — write only through that register.
        get focusedName() { return focus.name },

        // Own timeslice: never inherit a spent deadline (would park on first breath).
        flush() {
            scheduler.withSlice(pacer.budgetMs, driveToRest)
            drainAndMaterialize()  // one materialize pass after all ticks
            updateGroupPositions()
            cleanupOrphanedLayers()  // background tabs get no rAF
            return scheduler.done
        },

        // One display frame: tick generators under quantum, materialize, pose heads.
        // Does not call renderer.render() — caller coordinates that.
        advance(t) {
            // Idle-out: rebase sim epoch so time does not jump. (timeline.js)
            const rebased = rebaseEpoch(epoch, lastWallT, t, FRAME_MS, IDLE_GAP_MS)
            const idledOut = rebased !== epoch
            epoch = rebased
            lastWallT = t
            if (epoch === null) epoch = t
            const now = t - epoch
            scheduler.lastTickTime = now
            // Idle gap is not a slow device — skip AIMD, do not cut the quantum.
            if (frameStart !== null) {
                if (idledOut) pacer.skip()
                else pacer.observe(t - frameStart)
            }
            frameStart = t
            if (!scheduler.done) {
                scheduler.withSlice(pacer.budgetMs, () => driveOneFrame(now))
                drainAndMaterialize()
            }
            updateGroupPositions()
            cleanupOrphanedLayers()
            scaleChildHeads()
        },

        // Opacity by address, not display name. (D006)
        setOpacityByAddress(address, opacity) {
            if (address == null) return
            for (const ambient of scheduler.registry.values()) {
                if (ambient.address === address) {
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
            // Blank slate for the next compositor; stage still owns the cache
            // and will dispose it for real on remount (stage.dispose).
            stage.materials.clear()
        }
    }
}
