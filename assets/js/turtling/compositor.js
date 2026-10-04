// Drain ambient channels into per-layer groups each frame.

import {
    Group,
    Vector3,
} from '../utils/three-entry.js'
import { materialize, accumulateTrail, flushTrail, createLabels } from "./materializer.js"
import { exposed } from "./laws/batch.js"
import { worldTransform, frameWorldTransform, visitPostOrder, findReferenceFrame, takeSync } from "./scheduler.js"
import { SE3 } from "./se3.js"
import { eyeCameraPose } from "./view.js"
import { rebaseEpoch, idleFloorMs } from "./timeline.js"
import { createPacer } from "./pacer.js"

// Clone shared materials; troika Text sets opacity direct.
function setGroupOpacity(group, opacity) {
    // Lines/fills: transparent only when opacity < 1 — full-bright with
    // transparent:true loses depth write and trails vanish (sister ambient
    // looks like a lone head). Text is different: SDF edges *are* alpha, so
    // transparent must stay on or the soft step hard-cuts (torn outline).
    const seeThrough = opacity < 1
    group.traverse(child => {
        if (child.material) {
            if (typeof child.text === 'string') {
                const mats = Array.isArray(child.material)
                    ? child.material
                    : [child.material]
                for (const m of mats) {
                    if (!m) continue
                    m.transparent = true
                    m.opacity = opacity
                }
            } else {
                if (!child._ownMaterial) {
                    child.material = child.material.clone()
                    child._ownMaterial = true
                }
                child.material.transparent = seeThrough
                child.material.opacity = opacity
                child.material.depthWrite = !seeThrough
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

// opts = { focus, createHead, createShapist, frameMs, controls }
// focus = turtle-owned light register (kindled + warm). Compositor reads and
// projects opacity — never owns or destroys it (light-ladders Phase B).
// controls = OrbitControls target for materializeHead only.
export function createCompositor(scheduler, stage, opts = {}) {
    for (const name of STAGE_CONTRACT) {
        if (!stage || !(name in stage)) {
            throw new TypeError(`compositor: stage is missing \`${name}\` (STAGE_CONTRACT)`)
        }
    }
    let epoch = null      // first real timestamp — rebases advance() to flush()'s 0-based timeline
    let lastWallT = null  // previous advance() wall timestamp, to detect idle-out gaps
    let lastNow = null     // previous normalized wall time, for the elapsed allowance
    let H = 0              // the reveal horizon (logical work authorized), not a scheduler clock
    // The reveal horizon: how much logical work live execution authorizes. It advances by the
    // normalized wall allowance only when the scheduler is settled through it; a discarded
    // allowance never becomes debt. (id:render-construction-cadence)
    // Light register lives on the turtle so it outlives empty-canvas dispose.
    const focus = opts.focus
    if (!focus) {
        throw new TypeError('compositor: opts.focus is required (turtle-owned register)')
    }
    const createHead = opts.createHead || null
    const createShapist = opts.createShapist || null
    // The stage owns the Text constructor; the compositor never imports troika,
    // so `node --test` can hold the real object. (id:label-reuse)
    // Orbit target for materializeHead, handed in by the turtle as `opts.controls`; a
    // headless caller omits it. A missing target now costs the camera follow, not the
    // pass. (id:label-reuse, corrected 2026-10-02)
    const controls = opts.controls ?? null
    // The beat channel: one callback, emitted where the playhead consumes it.
    const onBeat = opts.onBeat ?? null
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
        if (existing) {
            // A place may have been painted before `as A` gave it a walking head.
            // Add that head when its first visible pose arrives, without replacing ink.
            if (makeHead && !existing.head && createHead) existing.head = createHead(existing.group)
            return existing
        }

        const group = new Group()
        const labels = createLabels(group, { createText: opts.createText })   // pooled Texts; erase hides, never disposes
        stage.scene.add(group)

        // The world/root layer is a render surface for deposited ink only — no pen,
        // no turtle head. (spec id:ft-d4-world-root)
        const head = (createHead && makeHead) ? createHead(group) : null
        const shapist = createShapist ? createShapist(group) : null
        // trails: per-source consolidated polyline runs (materializer-owned state)
        const layer = { group, head, shapist, labels, trails: new Map(), vectors: new Map() }
        ambientLayers.set(id, layer)
        return layer
    }

    // Dispose geometry; skip cache-owned materials.
    function disposeMesh(c) {
        if (c.geometry) c.geometry.dispose()
        if (c.material && !c.material._cached) c.material.dispose()
    }

    // Clear a child layer's geometry/materials but preserve its head mesh.
    function clearChildLayer(layer, { keepLabels = false } = {}) {
        const headGroup = layer.head?.turtleGroup
        for (const child of [...layer.group.children]) {
            if (child === headGroup || child._label) continue
            child.traverse(disposeMesh)
            layer.group.remove(child)
        }
        // A print that is about to be rewritten must not blink: hide() blanks
        // the glyphs for a frame, rewrite() keeps them. (id:label-reuse)
        if (keepLabels) layer.labels.rewrite()
        else layer.labels.hide()
        layer.trails.clear()
        layer.vectors.clear()
    }

    // Retract one displayed object: its geometry AND its name leave together. The
    // name is not a pooled label, so nothing else holds it; the layer's vector map
    // is the only owner. (id:notation-coordinate-vector, id:laws-ordered-replacement)
    function removeVector(layer, name) {
        const entry = layer.vectors?.get(name)
        if (!entry) return
        for (const obj of [entry.line, entry.head]) {
            if (!obj) continue
            obj.traverse?.(disposeMesh)
            obj.parent?.remove?.(obj)
        }
        layer.vectors.delete(name)
    }

    // Dispose a layer entirely: hide head, dispose shapist, remove from scene.
    function disposeLayer(id, layer) {
        if (layer.head) layer.head.hide()
        if (layer.shapist) layer.shapist.dispose()
        layer.labels.dispose()          // pooled Text geometry + materials
        layer.group.traverse(disposeMesh)
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
            // A place is the positional view of this ambient, not a substitute for
            // its head. The pin is projected by Turtle; a body that emits a visible
            // head keeps its heading cue and its ink in this very same layer.
            // An empty `let A` has only the pin until `as A` gives it a body.
            // (id:laws-affordance)
            const isRoot = ambient === scheduler.root
            const isPlace = !isRoot && exposed(ambient)
            if (events.length === 0 && poses.length === 0) continue

            // Root world frame: ink only. Existing ordinary heads stay ordinary;
            // a declared place earns its head when an actual visible pose arrives.
            const visibleHead = poses.some(p => p.type === 'head' && p.headSize)
                || events.some(e => e.type === 'head' && e.headSize)
            const layer = getOrCreateLayer(id, !isRoot && (!isPlace || visibleHead))

            // Lens tracks in focused subtree; pose is E⁻¹·world. (id:eye-coordinates)
            const camOn = ambient.isLens ? inFocusedSubtree(ambient) : focus.isFocused(ambient)
            const childCtx = {
                materials: stage.materials,
                shapist: layer.shapist,
                labels: layer.labels,
                head: layer.head,
                vectors: layer.vectors,
                camera: camOn ? stage.camera : null,
                controls: camOn ? controls : null,
                frame: ambient,
                // Wake render-on-demand when async geometry lands.
                requestRender: stage.requestRender
            }
            const childGroups = { pathGroup: layer.group, gridGroup: layer.group }

            // Only `label` is deposited ink; a vector's name lives in the overlay.
            const willPrint = events.some((e) => e.type === 'label')
            for (const event of events) {
                if (event.type === 'error') continue
                if (event.type === 'beat') { onBeat?.(event); continue }
                if (event.type === 'clear') {
                    clearChildLayer(layer, { keepLabels: willPrint })
                } else if (event.type === 'label') {
                    // `label` is ink that persists: a frame's labels APPEND to the
                    // layer's live set. They are replaced only by an explicit clear
                    materialize(event, childGroups, childCtx)
                } else if (event.type === 'path') {
                    accumulateTrail(event, layer, stage.materials)
                } else {
                    materialize(event, childGroups, childCtx)
                }
            }
            if (willPrint) layer.labels.trim()
            // Poses land after the batch: the newest is where the turtle IS.
            for (const pose of poses) {
                // The owner's retraction removes the WHOLE object, geometry and name,
                // at the same transition that retired the binding.
                // (id:notation-coordinate-vector, id:laws-ordered-replacement)
                if (pose.type === 'vector' && pose.removed) { removeVector(layer, pose.name); continue }
                materialize(pose, childGroups, childCtx)
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

    // Skip compose when reframe is identity.
    function isIdentitySE3(t) {
        const r = t.rotation, p = t.position
        return Math.abs(r.w - 1) < 1e-9 &&
            Math.abs(p[0]) < 1e-9 && Math.abs(p[1]) < 1e-9 && Math.abs(p[2]) < 1e-9
    }

    // Opacity by address, not display name (D006). A closure, not a method:
    // projectLight uses it, and `this` on a factory's returned object breaks
    // the moment a caller destructures.
    function setOpacityByAddress(address, opacity) {
        if (address == null) return
        for (const ambient of scheduler.registry.values()) {
            if (ambient.address === address) {
                visitPostOrder(ambient, (frame) => {
                    const layer = ambientLayers.get(frame.id)
                    if (layer) setGroupOpacity(layer.group, opacity)
                })
                break
            }
        }
    }

    // Deepest focused lens → E⁻¹ world reframe; null if identity. (id:eye-d5)
    function focusedEyeReframe() {
        if (!focus.kindled) return null
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
    // A layer's seat in the scene world: the frame's own world pose, or the target's
    // when the frame is head-targeted. The eye reframe is applied separately, so the
    // WebGL layer and the overlay's projection agree by construction. (id:laws-decl-interface)
    function seatedWorld(ambient) {
        let wt = worldTransform(ambient)
        if (ambient.targetFrame) {
            const target = findReferenceFrame(ambient, ambient.targetFrame)
            if (target) wt = worldTransform(target)
        }
        return wt
    }

    function updateGroupPositions() {
        const eyeInv = viewReframe()
        for (const [id, ambient] of scheduler.registry) {
            // The root/world layer (if any) positions at identity like any other
            // non-lens group; it only exists once something deposits into it.
            const layer = ambientLayers.get(id)
            if (!layer) continue

            let wt = seatedWorld(ambient)
            if (eyeInv && !ambient.isLens) wt = SE3.compose(eyeInv, wt)
            const p = layer.group.position, q = layer.group.quaternion
            const pos = wt.position, r = wt.rotation
            if (p.x === pos[0] && p.y === pos[1] && p.z === pos[2]
                && q.x === r.x && q.y === r.y && q.z === r.z && q.w === r.w) continue
            p.set(pos[0], pos[1], pos[2])
            q.set(r.x, r.y, r.z, r.w)
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

    // A vector's arrowhead: how big it stands on screen, in the head's own units.
    // (id:notation-coordinate-vector)
    const ARROW_ON_SCREEN = 8
    const _scratchHeadPos = new Vector3()
    function scaleChildHeads() {
        for (const [id, layer] of ambientLayers) {
            const gp = layer.group.position
            // A point handle keeps a constant on-screen size and faces the eye,
            // exactly as a head does — the same distance scale, the same frame. A
            // vector's arrowhead shares that scale, and gets it whether or not this
            // layer has a head: a layer without one still draws its vectors.
            // (id:notation-coordinate-vector)
            const headPos = layer.head?.position?.() ?? gp
            _scratchHeadPos.set(gp.x + headPos.x, gp.y + headPos.y, gp.z + headPos.z)
            const dist = stage.camera.position.distanceTo(_scratchHeadPos)
            for (const entry of layer.vectors?.values?.() ?? []) {
                entry.head?.scale?.setScalar(dist / 250 * ARROW_ON_SCREEN)
            }
            if (!layer.head) continue
            layer.head.scale(dist / 250)
        }
    }

    // Cross a spent slice toward instant closure, bounded by this backstop.
    // No-progress/no-drain may stop without a cut; the ceiling is not a time bound.
    // (id:render-construction-cadence-wait-regression)
    const MAX_OVERRUN_TICKS = 64

    function driveToRest(outOfTime, now = scheduler.lastTickTime || 0) {
        let left = MAX_OVERRUN_TICKS
        for (;;) {
            const progress = scheduler.tick(now)
            if (scheduler.done) break
            if (outOfTime() && !scheduler.atCut) {
                // Preempted mid-value: finish the instant and stop at its cut.
                if (--left <= 0) break
                // No progress and nothing to drain: another tick cannot help. Stop; the
                // next opportunity resumes. Stopping need not cut, advance or publish.
                // (id:render-construction-cadence)
                if (!progress && !drainAndMaterialize()) break
                continue
            }
            if (outOfTime()) break
            if (!progress && !drainAndMaterialize()) break
        }
    }
    return {
        scheduler,

        get budgetMs() { return pacer.budgetMs },

        // The shared register itself (kindled + warm). Read-only seam.
        get light() { return focus },

    // The pin shares the actual rendered head, not a guess from execution state.
    // An empty place keeps its bead; once A walks, the ring leaves its centre open.
    visibleHeadFor(id) { return !!ambientLayers.get(id)?.head?.turtleGroup?.visible },

        // Vector marks for the invariant overlay: a declared object's world segment, so
        // the overlay can place its NAME beyond the tip on screen while the arrow stays
        // world geometry. (id:notation-coordinate-vector, id:laws-decl-interface)
        vectorNames() {
            const out = []
            for (const [id, layer] of ambientLayers) {
                if (!layer.vectors || layer.vectors.size === 0) continue
                const ambient = scheduler.registry.get(id)
                if (!ambient) continue
                const wt = seatedWorld(ambient)
                for (const entry of layer.vectors.values()) {
                    const e = entry.event
                    if (!e?.from || !e?.to) continue
                    out.push({ name: e.name, color: e.color,
                        from: SE3.apply(wt, e.from), to: SE3.apply(wt, e.to) })
                }
            }
            return out
        },
        // The one world→scene mapping: eye and hand compose here, and the camera
        // draws the result. Markers and gestures both read it, so a drawn point
        // and its hit target cannot live in different frames. (id:laws-decl-interface)
        viewReframe,


        // Play-gauge: layer poses + head local + first mesh opacity (probe only).
        // Diagnostic: what the place's own layer holds, and whether each child is
        // actually visible. (id:laws-decl-handle)

        probeLayerFor(id) {
            const layer = ambientLayers.get(id)
            if (!layer) return null
            const meshInfo = (c) => ({
                type: c.type, visible: c.visible, renderOrder: c.renderOrder,
                parentIsGroup: c.parent === layer.group,
                groupInScene: stage.scene.children.includes(layer.group),
                instanceCount: c.geometry?.instanceCount ?? null,
                startCount: c.geometry?.attributes?.instanceStart?.count ?? null,
                boundingSphere: c.geometry?.boundingSphere
                    ? [c.geometry.boundingSphere.center.x, c.geometry.boundingSphere.center.y,
                       c.geometry.boundingSphere.center.z, c.geometry.boundingSphere.radius] : null,
                material: c.material ? {
                    type: c.material.type, visible: c.material.visible,
                    opacity: c.material.opacity, transparent: c.material.transparent,
                    linewidth: c.material.linewidth, resolution: c.material.resolution
                        ? [c.material.resolution.x, c.material.resolution.y] : null,
                    color: c.material.color?.getHex?.() ?? null,
                } : null,
            })
            return {
                groupInScene: stage.scene.children.includes(layer.group),
                children: layer.group.children.map(meshInfo),
                trails: [...layer.trails.keys()].map((k) => ({
                    key: String(k), segs: layer.trails.get(k).line?.segmentCount ?? null,
                    synced: layer.trails.get(k).line?._synced ?? null,
                    sameGeom: layer.trails.get(k).line
                        ? layer.trails.get(k).line.mesh.geometry === layer.trails.get(k).line.geometry : null,
                    geomInstanceCount: layer.trails.get(k).line?.geometry?.instanceCount ?? null,
                    hasLine: !!layer.trails.get(k).line,
                    meshVisible: layer.trails.get(k).line?.mesh?.visible ?? null,
                    groupHas: layer.trails.get(k).line?.mesh
                        ? layer.group.children.includes(layer.trails.get(k).line.mesh) : null,
                })),
                head: layer.head ? 'present' : null,
            }
        },

        probeLayers() {
            const out = []
            for (const [id, layer] of ambientLayers) {
                const ambient = scheduler.registry.get(id)
                const headPos = layer.head?.position?.()
                let opacity = null
                layer.group.traverse((c) => {
                    if (opacity == null && c.material && typeof c.material.opacity === "number"
                        && typeof c.text !== "string") {
                        opacity = c.material.opacity
                    }
                })
                out.push({
                    id,
                    address: ambient?.address ?? null,
                    name: ambient?.name ?? null,
                    group: {
                        pos: [layer.group.position.x, layer.group.position.y, layer.group.position.z],
                        quat: {
                            x: layer.group.quaternion.x, y: layer.group.quaternion.y,
                            z: layer.group.quaternion.z, w: layer.group.quaternion.w,
                        },
                    },
                    headLocal: headPos
                        ? [headPos.x, headPos.y, headPos.z]
                        : null,
                    headVisible: layer.head?.turtleGroup?.visible ?? null,
                    trailRuns: layer.trails?.size ?? 0,
                    childMeshes: layer.group.children.length,
                    opacity,
                })
            }
            return out
        },

        // Project register → material opacity. DEGREE is the caller's (no
        // policy here); turtle.light is the one writer of the register this reads.
        projectLight(degree = { kindled: 1.0, warm: 0.4 }) {
            const { kindled, warm } = focus.light
            for (const addr of warm) {
                if (addr !== kindled) setOpacityByAddress(addr, degree.warm)
            }
            setOpacityByAddress(kindled, degree.kindled)
        },

        // A NEW PLAY (D011): reset the reveal origin. `now = t − epoch` returns to 0
        // and the scheduler frontier clears, so a fresh seat at the axis origin plays
        // from its start. An EDIT must not call this — it re-seats in place.
        beginPlay() {
            epoch = null
            lastWallT = null
            H = 0            // a new play resets the horizon and its elapsed baseline together
            lastNow = null
            scheduler.lastTickTime = 0
        },

        // Own timeslice: never inherit a spent deadline (would park on first breath).
        flush() {
            scheduler.withSlice(pacer.budgetMs, driveToRest)
            // Capture is in the commit; build is here. Walk the seated answer
            // in this same pump so the show is not a frame behind the pose.
            // (id:laws-figure-eidos-cell, id:laws-figures-phase34-inplace)
            scheduler.readouts.drain()
            scheduler.withSlice(pacer.budgetMs, driveToRest)
            drainAndMaterialize()
            updateGroupPositions()
            cleanupOrphanedLayers()
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
            const allowance = lastNow === null ? 0 : Math.max(0, now - lastNow)
            lastNow = now
            // Drain at the current H FIRST: a readout rebuild re-seats work, so the gate
            // must see it before the allowance is spent. Construction stays outside
            // publication. (id:laws-figure-eidos-cell, id:render-construction-cadence)
            scheduler.readouts.drain()
            // Spend the normalized allowance only when no obligation remains through H;
            // otherwise discard it. Wall observation above is unaffected.
            if (scheduler.isSettledThrough(H)) H += allowance
            scheduler.lastTickTime = H
            // Idle gap is not a slow device — skip AIMD, do not cut the quantum.
            if (frameStart !== null) {
                if (idledOut) pacer.skip()
                else pacer.observe(t - frameStart)
            }
            frameStart = t
            scheduler.withSlice(pacer.budgetMs, (outOfTime) => driveToRest(outOfTime, H))
            drainAndMaterialize()
            updateGroupPositions()
            cleanupOrphanedLayers()
            scaleChildHeads()
        },

        // Opacity by address, not display name. (D006)
        setOpacityByAddress,

        // Propagate opacity to all child ambient layers.
        setOpacity(opacity) {
            for (const [id, layer] of ambientLayers) {
                setGroupOpacity(layer.group, opacity)
            }
        },

        // Clean up all layers. Called on turtle.reset() / empty canvas.
        // Does NOT touch the light register — that outlives this compositor.
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
