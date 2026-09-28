import { Parser } from "./mafs/parse.js"
import { parseProgram, reparseProgram } from "./parse.js"
import { ailmentsFor, standingAilments } from "../weave/queries.js"  // buffer ailments (D022)
import { drainNamespace } from "./executor.js"
import { Evaluator } from "./mafs/evaluate.js"
import Render from "./render/index.js"
import { bridged } from "../bridged.js"
import { createStage } from "./stage.js"
import { SE3 } from "./se3.js"
import { createScheduler, metaRoot, sumCounts, frameWorldTransform, worldTransform } from "./scheduler.js"
import { bindWorld, constraintsOn } from "./laws/authored.js"
import { createCompositor } from "./compositor.js"
import { labInputs } from "./lab.js"
import { createFocus, resolveAddress } from "./focus.js"
import { hatchVerdict } from "./hatch.js"
import { createGesture } from "./laws/gesture.js"
import { exposed, pointCandidates } from "./laws/batch.js"
import { viewMapping } from "./laws/handle.js"
import { verdictFade, OUTCOME } from "./laws/outcome.js"
import { VERDICT_DECAY_MS } from "./laws/feel.js"
import { drawPin, drawTrace, drawRim, drawGhostMark, drawAxis, drawCurve, drawWish, drawSpoke } from "./laws/pin.js"
import { stateOf, axesOf, marksOf, heldIdentity, boundsOf } from "./laws/constraints.js"
import { unionBounds, viewDirection } from "./laws/fit.js"
import { hintsVisible, normalizeReveal, movedEnough } from "./laws/reveal.js"
import { createOverlay } from "./overlay.js"
import { worldProgress } from "./vitals.js"

// The witness whose gate this canvas keeps — one spelling, shared with the
// seating law (kernel/witness.js, light-ladders-hatch-resolution).
import { SELF } from "../kernel/witness.js"

const PROGRESS_FLOOR_MS = 100   // progress breath floor (~10/s)

// A world step for a projected direction. The facing gives the direction; this is
// only its yardstick, the same 20 the resting axes of a constraint use.
const FACING_STEP = 20


export class Turtle {
    constructor(canvas, options = {}) {
        this._caps = options.caps ?? null
        // The law seam: an injected admission/observation policy for this play.
        // Lab-only — no child-facing syntax, no second API. (id:laws-build-p0)
        this._law = options.law ?? null
        this.bridge = bridged("turtle")
        // View-only reveal state (id:laws-experiment-3-possibility). Reset on a
        // fresh play, a mode change and reset(); it never touches the world.
        this._reveal = normalizeReveal(options.reveal)
        this._hintsRevealed = false
        // Behaviour record only — never a reveal trigger.
        this._handMoves = { accepted: 0, displaced: 0 }

        const stage = createStage(canvas, this.bridge, options.instruments)
        this.stage = stage
        // The fit verb asks the turtle for the figure's extents; the stage
        // only moves the eye. One framing path for the shell and the probe.
        stage.fitTargets = () => this._fitTargets()
        this.renderstate = stage.renderstate

        // Render-on-demand: wake via requestRender, else stop.
        this.renderLoop = new Render.Loop(null, {
            onRender: (t) => this.onFrame(t),
            stopCondition: () => this._shouldStop()
        })
        stage.renderLoop = this.renderLoop
        // Let the stage (resize, camera bridge) wake the on-demand loop, and say
        // the reflect changed when a camera command asks for a fresh capture.
        stage.requestRender = () => this.requestRender()
        stage.reflectChanged = () => this.reflectChanged()

        this._renderRequested = false    // one-shot: render at least one more frame
        this._keepRendering = false      // set each frame: is there ongoing work?
        this._controlsActiveUntil = 0    // ms timestamp: keep rendering until damping settles
        this._lastRefusal = null
        this._ghost = null

        // Wake loop on camera interaction; settle window after release.
        this._onControlsActive = () => {
            this._controlsActiveUntil = performance.now() + 700
            this.requestRender()
        }
        for (const ev of ['start', 'change', 'end']) {
            stage.controls.addEventListener(ev, this._onControlsActive)
        }

        this.color = '#e77808'
        // Beat channel sink. Set by a host; read live at drain time. (id:host-beat)
        this.onBeat = null

        // Unified scheduler + compositor (lazy — created on first upsertAmbient)
        this.scheduler = null
        this.compositor = null
        // Light register (kindled + warm) outlives compositor dispose on empty
        // canvas — D006 must hold across the transition it was written for.
        this.focus = createFocus(null)
        // gate[self] — hatch permission for this canvas. One bit while only
        // self hatches here; reflectGate is the witness fence.
        this._hatchMine = true

        // Hatch stamps only; reflect_changed? is the question. (D025 R3)
        this._lastReflectChange = 0
        this._lastHatchAt = 0
        this._firstDrawAt = 0
        this._walking = false   // last frame's phase, to catch the run's end
        this._snapOwed = false  // keep asked: hatch after the next render

        this._heartbeatTimer = null
        this._onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                // Nothing changed while hidden — just wake the loop and let the
                // verdict find whatever change went unhatched.
                this.requestRender()
                this._scheduleHeartbeat()
            } else {
                this._stopHeartbeat()
            }
        }

        document.addEventListener('visibilitychange', this._onVisibilityChange)
        this._scheduleHeartbeat()
        this.renderLoop.requestRestart()
    }

    requestRender() {
        this._renderRequested = true
        this.renderLoop.ensureRunning()
    }

    // Loop stop predicate (checked at the top of each frame). Stop only when no
    // render was explicitly requested and the last frame found nothing ongoing.
    _shouldStop() {
        return !this._renderRequested && !this._keepRendering
    }

    // Keepalive: re-publish the reflect within the server's 10-min cache. Saying
    // it changed IS the force — a cache about to forget would learn something.
    _scheduleHeartbeat() {
        if (this._heartbeatTimer) return
        const delay = 5 * 60_000 + Math.random() * 60_000
        this._heartbeatTimer = setTimeout(() => {
            this._heartbeatTimer = null
            if (document.visibilityState === 'visible') {
                this.reflectChanged()
                this._scheduleHeartbeat()
            }
        }, delay)
    }

    _stopHeartbeat() {
        clearTimeout(this._heartbeatTimer)
        this._heartbeatTimer = null
    }

    dispose() {
        this._stopHeartbeat()
        document.removeEventListener('visibilitychange', this._onVisibilityChange)
        for (const ev of ['start', 'change', 'end']) {
            this.stage.controls.removeEventListener(ev, this._onControlsActive)
        }
        this._handle?.dispose()
        this._handle = null
        this._overlay?.dispose()
        this._overlay = null
        // Dispose compositor/stage on remount — canvas outlives the hook.
        // Light register dies with the turtle (not with the compositor).
        this.compositor?.dispose()
        // Ending the canvas ends its pending admissions too. Dropping only the
        // scheduler reference leaves a parked frame alive for a late Promise.
        for (const key of this.scheduler?.root.children.keys() ?? []) this.scheduler.removeChild(key)
        this.compositor = null
        this.scheduler = null
        this.focus.bind(null)
        this.onBeat = null
        this.stage.dispose()
    }

    // Compose the compositor's reframe with the stage's camera once, so the
    // drawn mark and the gesture's ray/plane share one frame.
    // (id:laws-decl-interface)
    _view() {
        return viewMapping(this.compositor?.viewReframe?.() ?? null, this.stage)
    }

    // The one description of a point: free / headed / pinned / unresolved, with
    // its normals, degrees of freedom and the exact locus. (id:laws-decl-point-agent)
    _stateOf(frame) {
        const scheduler = this.scheduler
        const headed = frame.generator != null || frame.actorState != null
        const laws = scheduler.laws.active()
        const ctx = bindWorld((id) => scheduler.registry.get(id), {
            writerId: frame.id,
            positionOf: (f) => frameWorldTransform(f).position,
            poseOf: (f) => worldTransform(f),
            heldOf: (id) => heldIdentity(scheduler.registry.get(id), laws, scheduler.registry),
        })
        return stateOf({
            at: frameWorldTransform(frame).position,
            headed,
            exposed: exposed(frame),
            isPlace: frame.isPlace === true,
            error: frame.error ?? null,
            // A failed attempt's hold is not an offer. The pin still draws (its
            // previous state), but it is not touchable until an edit releases it.
            // (id:laws-activation-verdicts)
            unresolved: frame.unresolved ?? frame.held ?? null,
            constraints: constraintsOn(frame.id, laws, ctx),
        })
    }

    // Frame the figure: every exposed place, plus the true radius of each
    // bounded locus it names. A bounded mark is framed by the eye, never
    // enlarged for it. (id:laws-freedom)
    _fitTargets() {
        const scheduler = this.scheduler
        if (!scheduler) return null
        const spheres = []
        let primary = null
        for (const frame of scheduler.registry.values()) {
            if (frame === scheduler.root || frame.isLens || !exposed(frame)) continue
            spheres.push({ center: frameWorldTransform(frame).position, radius: 0 })
            const state = this._stateOf(frame)
            const bounds = boundsOf(state.locus, state.at)
            if (bounds) spheres.push(bounds)
            // The direction comes from the largest bounded mark, so a circle reads
            // as a curve rather than a point on the sight line.
            if (bounds && state.locus?.normal && bounds.radius > (primary?.radius ?? -1)) {
                primary = { normal: state.locus.normal, radius: bounds.radius }
            }
        }
        const bounds = unionBounds(spheres)
        return bounds ? { bounds, dir: viewDirection(primary?.normal ?? null) } : null
    }

    // The shell verb and the probe call share this one path: frame, don't enlarge.
    fit({ dir = null } = {}) {
        const target = this._fitTargets()
        if (!target) return null
        return this.stage.fitTo(target.bounds, { dir: dir ?? target.dir })
    }

    // The gesture's one question, answered by the same state the view draws.
    _touchable(frame) {
        return this._stateOf(frame).interaction.offered
    }

    // An unanchored `let A` can be touched. Once A has a walking head, the
    // marker observes its accepted position but never takes the pointer.
    // (id:laws-place-head-frame)
    _drawPins() {
        const overlay = this._overlay
        if (!overlay) return
        overlay.begin()
        const view = this._view()
        const scheduler = this.scheduler
        if (!scheduler) return
        // A run can attach a head or remove a point without another pointer move.
        if (this._heldFrame && (!this._touchable(this._heldFrame)
            || scheduler.registry.get(this._heldFrame.id) !== this._heldFrame)) {
            this._handle?.cancel()
        }
        const now = performance.now()
        if (this._ghost && now - this._ghost.at >= VERDICT_DECAY_MS) this._ghost = null
        // Where a constrained point MAY go — its locus, the axis it rests on, and
        // the surface's coordinate curves through it. All world geometry, so a
        // camera turn carries them with the world. (id:laws-freedom)
        const facing = view.facing()
        const eye = view.eye()
        const cp = { x: eye[0], y: eye[1], z: eye[2] }
        // Every law-derived hint is drawn only when the reveal control allows.
        const showHints = this._hintsVisible()
        for (const frame of scheduler.registry.values()) {
            if (!showHints || frame === scheduler.root || !exposed(frame)) continue
            const state = this._stateOf(frame)
            if (state.tag !== 'free') continue
            const at = state.at
            // Display scale: world units per pixel at this point's depth. The pitch
            // of an UNBOUNDED mark (a plane patch, an axis) follows the camera; a
            // BOUNDED locus (a circle, a sphere) never does. (id:laws-freedom)
            const dist = Math.hypot(at[0] - cp.x, at[1] - cp.y, at[2] - cp.z)
            const fov = ((this.stage.camera?.fov ?? 60) * Math.PI) / 180
            const perPixel = (2 * dist * Math.tan(fov / 2)) / (overlay.height || 600)
            const shade = (worlds) => {
                const pts = worlds.map((p) => {
                    const s = view.project(p)
                    return s ? { x: s.x, y: s.y,
                        depth: Math.hypot(p[0] - cp.x, p[1] - cp.y, p[2] - cp.z) } : null
                })
                const ds = pts.filter(Boolean).map((p) => p.depth)
                const min = Math.min(...ds), max = Math.max(...ds)
                for (const p of pts) if (p) p.t = max > min ? (p.depth - min) / (max - min) : 0
                return pts
            }
            // The named freedom, derived from the locus. (id:laws-freedom)
            const marks = marksOf(state.locus, { at, size: perPixel * 90, viewDir: facing, eye })
            for (const c of marks.curves) drawCurve(overlay.ctx, shade(c))
            for (const tr of marks.traces) drawTrace(overlay.ctx, tr.map((p) => view.project(p)))
            for (const [a, b] of marks.axes) drawAxis(overlay.ctx, view.project(a), view.project(b), { strong: false })
            for (const p of marks.ghosts) {
                if (Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]) <= 1e-6) continue
                const s = view.project(p)
                if (s) drawGhostMark(overlay.ctx, s.x, s.y)
            }
            for (const ring of marks.rings) drawRim(overlay.ctx, ring.map((p) => view.project(p)))
            for (const [a, b] of marks.spokes) drawSpoke(overlay.ctx, view.project(a), view.project(b))
            // the resting axis: the constraint normal, through the point
            const axes = axesOf(state)
            // A radius spoke already names the direction; only a locus without one
            // (a plane, a line) needs the resting normal drawn. (id:laws-freedom)
            if (axes && marks.spokes.length === 0) {
                const scale = perPixel * 60
                const along = (d) => [at[0] + d[0] * scale, at[1] + d[1] * scale, at[2] + d[2] * scale]
                drawAxis(overlay.ctx, view.project(along(axes.normal.map((n) => -n))),
                    view.project(along(axes.normal)), { strong: true })
            }
        }
        for (const frame of scheduler.registry.values()) {
            if (frame === scheduler.root || !exposed(frame)) continue
            const world = frameWorldTransform(frame)
            const at = view.project(world.position)
            if (!at) continue
            // The place's inherited heading: a declaration is seated at the walk's
            // reached pose, facing forward (seatPlace), and a world transform is frozen
            // at the parent's birth origin, so this arm is the facing the place was
            // born with — any direction in space, not the paper's north. Forward is
            // the turtle's +X, turned by the place's own world rotation; the
            // projection is what makes it a screen direction.
            const [fx, fy, fz] = world.rotation.rotateVec(FACING_STEP, 0, 0)
            const facing = view.project([
                world.position[0] + fx, world.position[1] + fy, world.position[2] + fz,
            ])
            const touchable = this._touchable(frame)
            const held = touchable && this._heldFrame === frame
            const readout = held && this.lastReadout?.point === frame.name ? this.lastReadout : null
            const ghost = this._ghost?.point === frame.name
                ? { text: this._ghost.text, fade: verdictFade(now - this._ghost.at) } : null
            drawPin(overlay.ctx, {
                cx: at.x, cy: at.y, width: overlay.width, name: frame.name,
                ink: this.color,
                withHead: this.compositor?.visibleHeadFor(frame.id) ?? false,
                touchable, held, accepted: frame.transform.deref().position,
                facing: facing ? { x: facing.x - at.x, y: facing.y - at.y } : null,
                outcome: readout?.outcome,
                ghost: held ? null : ghost,
            })
            // The wish and where it landed: a light tether when the projection
            // absorbed part of the pointer's wish. A projection is a lawful
            // response; only an obstruction earns refusal language. (id:laws-freedom)
            if (held && readout && readout.requested && readout.outcome === OUTCOME.accepted) {
                const wish = view.project(SE3.apply(worldTransform(frame), readout.requested))
                if (wish) drawWish(overlay.ctx, at, wish)
            }
        }
    }

    _ensureHandle() {
        if (this._handle || !this.scheduler) return
        const scheduler = this.scheduler
        const stage = this.stage
        const canvas = stage.canvas
        const controls = stage.controls
        let captured = null
        let damping = null
        const handle = createGesture({
            candidates: () => pointCandidates(scheduler.registry.values(), frame => this._touchable(frame))
                .map(frame => ({ name: frame.name, frame })),
            canTouch: frame => this._touchable(frame),
            anchorOf: frame => frameWorldTransform(frame),
            birthOf: frame => worldTransform(frame),
            registered: frame => scheduler.registry.get(frame.id) === frame,
            requestMotion: (frame, pose, revision) => scheduler.requestMotion(frame, pose, revision),
            onAccepted: ({ from, to }) => this._recordAcceptedHandMove(from, to),
            revision: () => scheduler.motionRevision,
            wake: () => this.requestRender(),
            project: world => this._view().project(world),
            rayAt: (x, y) => this._view().rayAt(x, y),
            facing: () => this._view().facing(),
            // A sphere's hand rides its camera-plane disk; a cone its own polar.
            // (id:laws-decl-anchor)
            locusOf: frame => this._stateOf(frame).locus,
            // Slight stickiness at the ball's own landmarks: the paper it rests on.
            // (id:laws-decl-anchor)
            detents: { paper: true, poles: true },
            capture: ({ pointerId }) => {
                captured = pointerId
                try { canvas.setPointerCapture?.(pointerId) } catch { /* browser may not own it */ }
                damping = controls.enableDamping
                controls.enableDamping = false
            },
            release: ({ pointerId }) => {
                if (captured === pointerId) {
                    try { canvas.releasePointerCapture?.(pointerId) } catch { /* never held */ }
                    captured = null
                }
                if (damping !== null) { controls.enableDamping = damping; damping = null }
            },
            setControls: enabled => { controls.enabled = enabled },
            controlsEnabled: () => controls.enabled,
            onReadout: line => {
                this.lastReadout = line
                if (line.outcome === 'accepted') {
                    this._lastRefusal = null
                    this._ghost = null
                } else if (line.outcome && this._heldFrame) {
                    this._lastRefusal = { point: line.point, text: line.outcome }
                }
                this.requestRender()
            },
        })
        const down = event => {
            if (event.target !== canvas) return
            const answer = handle.pointerDown({ pointerId: event.pointerId, x: event.clientX, y: event.clientY })
            if (!answer.claimed) return
            event.stopImmediatePropagation()
            event.preventDefault()
            this._heldFrame = answer.frame
            this._lastRefusal = null
            this._ghost = null
            this.requestRender()
        }
        const move = event => {
            if (event.target !== canvas && captured !== event.pointerId) return
            const answer = handle.pointerMove({ pointerId: event.pointerId, x: event.clientX, y: event.clientY })
            if (answer.cancelled) this._heldFrame = null
        }
        const end = event => {
            if (captured !== event.pointerId) return
            handle.pointerUp({ pointerId: event.pointerId })
            this._heldFrame = null
            if (this._lastRefusal) {
                this._ghost = { ...this._lastRefusal, at: performance.now() }
                this._lastRefusal = null
            }
            this.requestRender()
        }
        const cancel = event => {
            if (captured !== event.pointerId) return
            handle.pointerCancel({ pointerId: event.pointerId })
            this._heldFrame = null
            this.requestRender()
        }
        window.addEventListener('pointerdown', down, { capture: true })
        window.addEventListener('pointermove', move, { capture: true })
        window.addEventListener('pointerup', end, { capture: true })
        window.addEventListener('pointercancel', cancel, { capture: true })
        canvas.addEventListener('lostpointercapture', cancel)
        this._handle = {
            cancel: () => {
                if (captured !== null) handle.pointerCancel({ pointerId: captured })
                this._heldFrame = null
                this._lastRefusal = null
                this._ghost = null
            },
            dispose: () => {
                window.removeEventListener('pointerdown', down, { capture: true })
                window.removeEventListener('pointermove', move, { capture: true })
                window.removeEventListener('pointerup', end, { capture: true })
                window.removeEventListener('pointercancel', cancel, { capture: true })
                canvas.removeEventListener('lostpointercapture', cancel)
                handle.dispose()
            },
        }
    }

    _ensureScheduler() {
        if (this.scheduler) return
        this.scheduler = createScheduler(metaRoot(), {
            // The stage holds no `when` of its own. (id:mailbox-listens-for)
            rootHears: [],
            createDeps: () => ({
                mathParser: new Parser(),
                mathEvaluator: new Evaluator()
            }),
            execOpts: { ...(this._caps ?? {}), color: this.color },
            // onShout carries the emitter's name; routing is read-side.
            onShout: (sourceName, msg, payload) => {
                this._onShout?.(sourceName, msg, payload)
            },
            // createScheduler reads the seam at the top level, not from execOpts;
            // only the permitted laboratory inputs pass. (id:laws-decl-lab)
            ...labInputs(this._law),
        })
        this.focus.bind(this.scheduler)
        // Live stage for STAGE_CONTRACT verbs; cadence + orbit target via opts
        // (not stage fields — renderLoop used to leak frameInterval that way).
        // focus is turtle-owned — compositor only reads/projects it.
        // The overlay never takes input; only a free point claims a canvas touch.
        this._overlay ||= createOverlay({ onResize: () => this.requestRender(), space: this.stage.space })
        this._ensureHandle()
        this.compositor = createCompositor(this.scheduler,
            this.stage,
            {
                focus: this.focus,
                onBeat: (beat) => this.onBeat?.(beat),
                createHead: (parent) => new Render.Head(parent),
                createShapist: (parent) => new Render.Shape(parent, {
                    layerMethod: 'renderOrder',
                    polygonOffset: { factor: -0.1, units: -1 }
                }),
                frameMs: this.renderLoop.frameInterval,
                controls: this.stage.controls,
            }
        )
        // kindled left as register holds — set by first draw() / focusAmbient
        this.stage.head.hide()
    }

    onFrame(t) {
        this._renderRequested = false
        let controlsChanged = false
        const now = performance.now()
        const walking = !!this.scheduler && !this.scheduler.done

        if (this.compositor) {
            try {
                this.compositor.advance(t)
            } catch (error) {
                console.error('Compositor advance error:', error)
            }

            controlsChanged = this.stage.controls.update()
            this.stage.renderer.render(this.stage.scene, this.stage.camera)

            const rec = this.stage.recorder
            if (rec?.isRecording) rec.captureFrame()

            this._firstDrawAt ||= now
            // Still-edge is hatch news; a never-done loop hatches once.
            if (this._walking && !walking) this._lastReflectChange = now
            this._walking = walking
        } else {
            // No ambients — idle render (orbit controls, stage head)
            const { head, camera, controls, renderer, scene } = this.stage
            const scaleFactor = camera.position.distanceTo(head.position()) / 250
            head.scale(scaleFactor)
            controlsChanged = controls.update()
            renderer.render(scene, camera)
        }

        // The overlay is an instrument: a draw fault must not freeze the world.
        try {
            this._drawPins()
        } catch (error) {
            console.error('overlay draw error:', error)
        }

        // Only hatchVerdict decides hatch; owed keeps the loop awake.
        // mine = gate[self] — foreign witness cells never answer here.
        const verdict = hatchVerdict({
            now,
            present: !!this.compositor,
            mine: this._hatchMine,
            walking,
            changedAt: this._lastReflectChange,
            lastHatchAt: this._lastHatchAt,
            firstDrawAt: this._firstDrawAt,
        })
        // A keep reads THIS frame's buffer — hatch after render, never
        // from the click (drawing buffer is already presented and cleared).
        if (this._snapOwed) {
            this._snapOwed = false
            this.hatch()
        } else if (verdict.reason) {
            this.hatch()
        }

        // Keep loop while walking, recording, camera settling, or hatch owed.
        const recording = !!this.stage.recorder?.isRecording
        const controlsSettling = now < this._controlsActiveUntil
        // Snap and in-flight readback must keep the loop awake too — otherwise
        // a quiet canvas can sleep before the owed hatch runs.
        this._keepRendering = walking || recording || controlsChanged || controlsSettling
            || verdict.owed || this._snapOwed || this.stage.hatching || !!this._ghost

        this._sayProgress(now)
    }

    // Clock not payload — reader pulls the world. Phase/run edges always speak
    // so a tiny run's sun still rises. (id:output-ledger-r2-progress)
    _sayProgress(now) {
        if (!this.onProgress) return
        const p = worldProgress(this.scheduler)
        const edge = p.phase !== this._lastProgressPhase || p.run !== this._lastProgressRun
        if (!edge && now - (this._lastProgressAt || 0) < PROGRESS_FLOOR_MS) return
        this._lastProgressPhase = p.phase
        this._lastProgressRun = p.run
        this._lastProgressAt = now
        this.onProgress(p)
    }

    // The picture, when this capture finishes. In-flight joins; stamp only a start.
    hatch() {
        const joining = this.stage.hatching
        const pending = this.stage.hatch(this.bridge)
        if (!joining) this._lastHatchAt = performance.now()
        return pending
    }

    // A keep is intention, not a hatch beat. Same GPU path; the verdict
    // does not gate it. Borrows hatch's picture; onFrame starts the work
    // after render (drawing buffer is live only then).
    snap() {
        this._snapOwed = true
        this.requestRender()
        return this.stage.picture()
    }

    // Verdict alone hatches. (D025 R3/R4)
    reflectChanged() {
        this._lastReflectChange = performance.now()
        this.requestRender()
    }

    // Attention is reflect news too. (D025 R4)
    attentionMoved() {
        this.reflectChanged()
    }

    // --- Multi-ambient API ---

    // Rehearse once per vocab text. (id:cmp-vet)
    rehearseVocab(vocab, vocabNodes = null) {
        this._vocabCache ??= new Map()
        if (this._vocabCache.has(vocab)) return this._vocabCache.get(vocab)
        let ns = null
        try {
            const deps = { mathParser: new Parser(), mathEvaluator: new Evaluator() }
            ns = drainNamespace(vocabNodes ?? parseProgram(vocab), deps)
            // No absolute span from a re-parsed vocab string; drop it.
            if (!vocabNodes && ns?.error?.span) ns.error = { ...ns.error, span: null }
        } catch (error) {
            // The drain is total; this is the impossible path (a broken dep).
            ns = { functions: null, userspace: null, error }
        }
        if (this._vocabCache.size >= 32) this._vocabCache.clear()
        this._vocabCache.set(vocab, ns)
        return ns
    }

    // One ailments list for walk and rehearsal wounds.
    get ailments() {
        return standingAilments({
            frames: this.scheduler?.errors,
            seats: this._seatFaults?.values(),
            rehearsals: this._rehearsalDiagnostics?.values(),
        })
    }

    // hatch:false = passive seat (no snapshot/reflect).
    // vocab = phase ancestors (D019); fresh:true forces restart. (id:cmp-become-seed)
    upsertAmbient(key, displayName, code, { hatch = true, vocab = null, nodes = null, vocabNodes = null, fresh = false } = {}) {
        try {
            // Live node slices when present; green tree reuses otherwise. (id:cmp-green-tree)
            let instructions = nodes
            if (!instructions) {
                this._parseMemo ??= new Map()
                const held = this._parseMemo.get(key)
                instructions = reparseProgram(code, held?.text ?? null, held?.ast ?? null)
                this._parseMemo.set(key, { text: code, ast: instructions })
            }
            this._ensureScheduler()
            // `fresh` is the NEW PLAY door (D011, id:cmp-become-seed): reset the reveal
            // origin before seating, so an origin-anchored seat plays from its start.
            // An edit (fresh=false) keeps the play's clock and re-seats in place.
            if (fresh) this.compositor?.beginPlay()

            const ns = vocab ? this.rehearseVocab(vocab, vocabNodes) : null
            // Phase diagnostic under seat key, ancestor's span.
            this._rehearsalDiagnostics ??= new Map()
            if (ns?.error) {
                this._rehearsalDiagnostics.set(key, {
                    address: key, name: displayName, message: ns.error.message,
                    span: ns.error.span ?? null, kind: 'rehearsal',
                })
            } else {
                this._rehearsalDiagnostics.delete(key)
            }
            // Slice the seat so a big program cannot swallow a keystroke
            // (id:output-ledger-r2-pacer). Hold = same frame back (id:cmp-become-seed).
            const before = this.scheduler.root.children.get(key)
            const seat = this.scheduler.withSlice(this.compositor?.budgetMs ?? 4, () =>
                this.scheduler.hotSwapChild(key, {
                    name: displayName,
                    code: { ast: instructions, functions: ns?.functions ?? null },
                    style: { color: this.color },
                    env: ns?.userspace?.size ? { userspace: ns.userspace } : null
                }, { fresh }))
            // A new play is a new seat: the reveal starts hidden again. A
            // green-tree reuse (seat === before) keeps what this play revealed.
            if (seat !== before) this._hintsRevealed = false

            if (hatch) this._hatchMine = true
            this._seatFaults?.delete(key)

            if (before && seat === before) {
                return { success: true, commandCount: sumCounts(seat) }
            }

            this.compositor.flush()
            this._lastReflectChange = performance.now()

            const wounds = ailmentsFor(this.scheduler.errors, key)
            if (wounds.length > 0) {
                this.renderstate.meta = { state: "error", message: null, diagnostics: wounds }
                this.requestRender()
                return { success: false, wounds }
            }

            this.renderstate.meta = { state: "success", message: null, diagnostics: [] }
            this.requestRender()
            // This seat's count — not the world's sum across places.
            return { success: true, commandCount: seat ? sumCounts(seat) : 0 }
        } catch (error) {
            console.error(error)
            // Throw is a wound in the same shape.
            const wound = {
                message: error.message,
                span: error.span ?? null,
                kind: error.kind ?? "walk",
                address: key,
            }
            // Hold pre-frame throws so ailments still see them.
            ;(this._seatFaults ??= new Map()).set(key, wound)
            this.renderstate.meta = { state: "error", message: null, diagnostics: [wound] }
            return { success: false, wounds: [wound] }
        }
    }

    // Reflect gate once per transition, scoped by witness (D022;
    // light-ladders-hatch-resolution).
    //
    // The problem: a foreign batch naming its witness could close the author's
    // reflect. ONLY SELF MAY WRITE SELF'S GATE. One bit, one name — a Map for
    // the second witness arrives with the second witness, not before.
    reflectGate(open, { witness = SELF } = {}) {
        if (witness !== SELF) return
        this._hatchMine = !!open
    }

    // Standing tree for plain-tab keys (id:cmp-standing-primitives).
    // Memo keyed by canvas SEAT (Cut 1 Slot = place:node) — caller asks with
    // the seat; pageLaw.seatOf answers it. Guessing bare-then-each-place was
    // the same missing-index disease ailmentsFor had.
    programFor(seat) {
        if (!this._parseMemo || seat == null) return null
        return this._parseMemo.get(seat)?.ast ?? null
    }

    removeAmbient(key) {
        this._parseMemo?.delete(key)
        this._rehearsalDiagnostics?.delete(key)
        this._seatFaults?.delete(key)
        if (!this.scheduler) return
        this._lastReflectChange = performance.now()

        // Address only — callers pass the key they registered with. (The old
        // name-scan fallback is gone: one register, no second lookup space.)
        this.scheduler.removeChild(key)

        // If no children left, tear down compositor/scheduler and show idle head.
        // Light register (kindled + warm) survives — rebound on next seat.
        if (this.scheduler.root.children.size === 0) {
            this._handle?.dispose()
            this._handle = null
            this._heldFrame = null
            this._lastRefusal = null
            this._ghost = null
            this.compositor.dispose()
            this.compositor = null
            this.scheduler = null
            this.focus.bind(null)
            this.stage.head.show()
            this.stage.head.reset()
        }

        this.requestRender()
    }

    // THE ONE LIGHT WRITER — register, then projection, never one without the
    // other. Two writers once: this (from the law's total) and focusAmbient,
    // which moved kindled and projected nothing — a portal walk pointed the
    // camera at one figure while a different one stayed bright.
    //
    // `total` is the law's `light` verbatim. Degree numbers are the caller's;
    // no appearance policy lives on the turtle.
    light(total, degree) {
        this.focus.light = total ?? {}
        this.compositor?.projectLight(degree)
        this.requestRender()
    }

    // Resolve a name / nested address to the canonical address, for a caller
    // who holds a word and needs the register's coordinate.
    addressOf(ref) {
        return resolveAddress(this.scheduler, ref)
    }

    // Tab key whose subtree owns a display name.
    tabKeyForAmbient(name) {
        if (!this.scheduler?.root) return null
        const defines = (frame) => {
            if (frame.name === name) return true
            for (const child of frame.children?.values() ?? []) {
                if (defines(child)) return true
            }
            return false
        }
        for (const [key, tab] of this.scheduler.root.children) {
            if (defines(tab)) return key
        }
        return null
    }

    // View-only reveal control (id:laws-experiment-3-possibility). Visible shows
    // every law-derived hint at once; Delayed withholds them together until one
    // accepted hand move has landed. Drawing only — no geometry, no law, no
    // eligibility and no motion revision.
    get reveal() {
        return this._reveal
    }

    setReveal(mode) {
        const next = normalizeReveal(mode)
        if (next !== this._reveal) {
            this._reveal = next
            this._hintsRevealed = false
            this.requestRender()
        }
        return this._reveal
    }

    _hintsVisible() {
        return hintsVisible(this._reveal, this._hintsRevealed)
    }

    // The facilitator's view-only reveal. Delayed keeps the hints hidden no
    // matter how many moves land; this one action shows them, and nothing else
    // changes. The condition stays 'delayed' — visibility and condition are
    // different facts.
    revealNow() {
        if (!this._hintsRevealed) {
            this._hintsRevealed = true
            this.requestRender()
        }
        return this._hintsVisible()
    }

    get hintsRevealed() {
        return this._hintsRevealed
    }

    get handMoves() {
        return { ...this._handMoves }
    }

    // Behaviour recording only. An accepted move is counted, and a real
    // displacement is told from a request the law absorbs in place; neither
    // opens the reveal gate. Visibility opens only through revealNow().
    _recordAcceptedHandMove(from, to) {
        this._handMoves.accepted += 1
        if (movedEnough(from, to)) this._handMoves.displaced += 1
    }

    reset() {
        if (this.scheduler) {
            this._handle?.dispose()
            this._handle = null
            this._heldFrame = null
            this._lastRefusal = null
            this._hintsRevealed = false
            this._ghost = null
            // Remove all children
            for (const name of [...this.scheduler.root.children.keys()]) {
                this.scheduler.removeChild(name)
            }
            this.compositor.dispose()
            this.compositor = null
            this.scheduler = null
            this.focus.bind(null)
        }
        // Blank canvas clears light + gate: a new life, not a mid-session empty.
        this.focus.light = {}
        this._hatchMine = true
        // A blank canvas is a new life: it has never drawn, so first light is
        // owed again — measured from the next draw, not from this moment.
        this._lastReflectChange = performance.now()
        this._lastHatchAt = 0
        this._firstDrawAt = 0

        this.stage.head.show()
        this.stage.head.reset()
        this.renderstate.snapshot = { save: false }
        this.renderstate.meta = { state: null, message: null, commands: [], diagnostics: [] }
        this.renderLoop.requestRestart()
    }
}
