import { Parser } from "./mafs/parse.js"
import { parseProgram, reparseProgram } from "./parse.js"
import { ailmentsFor, standingAilments } from "../weave/queries.js"  // buffer ailments (D022)
import { drainNamespace } from "./executor.js"
import { Evaluator } from "./mafs/evaluate.js"
import Render from "./render/index.js"
import { bridged } from "../bridged.js"
import { createStage } from "./stage.js"
import { createScheduler, metaRoot } from "./scheduler.js"
import { createCompositor } from "./compositor.js"
import { resolveAddress } from "./focus.js"
import { hatchVerdict } from "./hatch.js"
import { worldProgress } from "./vitals.js"

const PROGRESS_FLOOR_MS = 100   // progress breath floor (~10/s)

export class Turtle {
    constructor(canvas) {
        this.bridge = bridged("turtle")

        const stage = createStage(canvas, this.bridge)
        this.stage = stage
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

        // Wake loop on camera interaction; settle window after release.
        this._onControlsActive = () => {
            this._controlsActiveUntil = performance.now() + 700
            this.requestRender()
        }
        for (const ev of ['start', 'change', 'end']) {
            stage.controls.addEventListener(ev, this._onControlsActive)
        }

        this.color = '#e77808'

        // Unified scheduler + compositor (lazy — created on first upsertAmbient)
        this.scheduler = null
        this.compositor = null
        // Suppresses hatch while canvas shows passive content (watched friend,
        // reverted draft); this seat may only OPEN it, never close it (D022).
        this._hatchSuppressed = false
        this._localKeys = new Set()  // buffer IDs of locally-rendered tab ambients

        // Hatch stamps only; reflect_changed? is the question. (D025 R3)
        this._lastReflectChange = 0
        this._lastHatchAt = 0
        this._firstDrawAt = 0
        this._walking = false   // last frame's phase, to catch the run's end

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
        // Dispose compositor/stage on remount — canvas outlives the hook.
        this.compositor?.dispose()
        this.compositor = null
        this.scheduler = null
        this.stage.dispose()
    }

    // Lazy init: one scheduler (meta-root) + one compositor for the lifetime.
    _ensureScheduler() {
        if (this.scheduler) return
        this.scheduler = createScheduler(metaRoot(), {
            // The stage holds no `when` of its own. (id:mailbox-listens-for)
            rootHears: [],
            createDeps: () => ({
                mathParser: new Parser(),
                mathEvaluator: new Evaluator()
            }),
            execOpts: { color: this.color },
            // onShout carries the emitter's name; routing is read-side.
            onShout: (sourceName, msg, payload) => {
                this._onShout?.(sourceName, msg, payload)
            }
        })
        // Live stage for STAGE_CONTRACT verbs; cadence + orbit target via opts
        // (not stage fields — renderLoop used to leak frameInterval that way).
        this.compositor = createCompositor(this.scheduler,
            this.stage,
            {
                createHead: (parent) => new Render.Head(parent),
                createShapist: (parent) => new Render.Shape(parent, {
                    layerMethod: 'renderOrder',
                    polygonOffset: { factor: -0.1, units: -1 }
                }),
                frameMs: this.renderLoop.frameInterval,
                controls: this.stage.controls,
            }
        )
        // focusedAddress left null — set by first draw() call
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

            if (this.stage.recorder.isRecording) {
                this.stage.recorder.captureFrame()
            }

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

        // Only hatchVerdict decides hatch; owed keeps the loop awake.
        const verdict = hatchVerdict({
            now,
            present: !!this.compositor,
            mine: !this._hatchSuppressed,
            walking,
            changedAt: this._lastReflectChange,
            lastHatchAt: this._lastHatchAt,
            firstDrawAt: this._firstDrawAt,
        })
        if (verdict.reason) this.hatch()

        // Keep loop while walking, recording, camera settling, or hatch owed.
        const recording = this.stage.recorder.isRecording
        const controlsSettling = now < this._controlsActiveUntil
        this._keepRendering = walking || recording || controlsChanged || controlsSettling || verdict.owed

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

    // false = readback in flight; retry next frame.
    hatch() {
        if (this.stage.hatch(this.bridge) === false) return false
        this._lastHatchAt = performance.now()
        return true
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
            // A keystroke seats a world INLINE, so the seating gets a slice of
            // its own — without one a big program builds all of itself between
            // two letters. The slice closes with the call, so nothing downstream
            // inherits a spent deadline. (id:output-ledger-r2-pacer)
            this.scheduler.withSlice(this.compositor?.budgetMs ?? 4, () =>
                this.scheduler.hotSwapChild(key, {
                    name: displayName,
                    code: { ast: instructions, functions: ns?.functions ?? null },
                    style: { color: this.color },
                    env: ns?.userspace?.size ? { userspace: ns.userspace } : null
                }, { fresh }))

            // Only OPEN the gate here on real content — closing is reflectGate's alone (D022).
            if (hatch) this._hatchSuppressed = false

            this.compositor.flush()
            // Any seat changes the reflect; gate only opens for the child.
            this._lastReflectChange = performance.now()

            // Own-address faults only on the child's reflect. (D022)
            this._seatFaults?.delete(key)

            const wounds = ailmentsFor(this.scheduler.errors, key)
            if (wounds.length > 0) {
                // Wounds carry frame key on diagnostics — one channel.
                this.renderstate.meta = { state: "error", message: null, diagnostics: wounds }
                this.requestRender()
                return { success: false, wounds }
            }

            // Turtle owns walk fault; document is asked at the shell. (D022)
            this.renderstate.meta = { state: "success", message: null, diagnostics: [] }
            this.requestRender()
            return { success: true, commandCount: this.scheduler.commandCount }
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

    // Reflect gate once per transition. (D022)
    reflectGate(open) {
        this._hatchSuppressed = !open
    }

    // Standing tree for plain-tab keys. (id:cmp-standing-primitives)
    programFor(key) {
        return this._parseMemo?.get(key)?.ast ?? null
    }

    removeAmbient(key) {
        this._localKeys.delete(key)
        this._parseMemo?.delete(key)
        this._rehearsalDiagnostics?.delete(key)
        this._seatFaults?.delete(key)
        if (!this.scheduler) return
        this._lastReflectChange = performance.now()

        // Address only — callers pass the key they registered with. (The old
        // name-scan fallback is gone: one register, no second lookup space.)
        this.scheduler.removeChild(key)

        // If no children left, tear down scheduler and show idle head
        if (this.scheduler.root.children.size === 0) {
            this.compositor.dispose()
            this.compositor = null
            this.scheduler = null
            this.stage.head.show()
            this.stage.head.reset()
        }

        this.requestRender()
    }

    // Focus by address or name-through-address.
    focusAmbient(ref) {
        if (this.compositor) {
            this.compositor.focusedAddress = resolveAddress(this.scheduler, ref)
        }
    }

    // Degree/focus share the address register. (D006)
    setAmbientOpacity(ref, opacity) {
        if (this.compositor) {
            this.compositor.setOpacityByAddress(resolveAddress(this.scheduler, ref), opacity)
        }
    }

    // Resolve ref → address for all appearance/focus callers.
    addressOf(ref) {
        return resolveAddress(this.scheduler, ref)
    }

    isAmbientFocused(ref) {
        const address = this.addressOf(ref)
        return address != null && this.compositor?.focusedAddress === address
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

    // Toggle ambient; add restarts the local group in sync.
    toggleAmbient(id, name, code, resolveBuffer) {
        this._ensureScheduler()
        if (this.scheduler.root.children.has(id)) {
            this.removeAmbient(id)
        } else {
            this._localKeys.add(id)
            for (const key of this._localKeys) {
                const info = key === id ? { name, content: code } : resolveBuffer?.(key)
                // fresh: the group restart is a deliberate gesture — sisters
                // re-run in sync even when their code didn't change.
                if (info) this.upsertAmbient(key, info.name, info.content, { fresh: true })
            }
        }
        this.requestRender()
    }

    // --- Backward-compatible API ---

    draw(id, name, code, nodes = null) {
        this._ensureScheduler()
        // Outside the sister group, seat is exclusive.
        if (!this._localKeys.has(id)) {
            for (const key of this._localKeys) {
                if (key !== id) this.removeAmbient(key)
            }
            this._localKeys.clear()
            this._localKeys.add(id)
        }
        // Upsert then focus by key; nodes = live parse when present.
        const result = this.upsertAmbient(id, name, code, { nodes })
        this.focusAmbient(id)
        return result
    }

    reset() {
        if (this.scheduler) {
            // Remove all children
            for (const name of [...this.scheduler.root.children.keys()]) {
                this.scheduler.removeChild(name)
            }
            this.compositor.dispose()
            this.compositor = null
            this.scheduler = null
        }
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
