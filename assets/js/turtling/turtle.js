import { Parser } from "./mafs/parse.js"
import { parseProgram, reparseProgram, collectErrors } from "./parse.js"
import { drainNamespace } from "./executor.js"
import { Evaluator } from "./mafs/evaluate.js"
import Render from "./render/index.js"
import { bridged } from "../bridged.js"
import { createStage } from "./stage.js"
import { createScheduler, metaRoot } from "./scheduler.js"
import { createCompositor } from "./compositor.js"
import { resolveAddress } from "./focus.js"

// --- Turtle ---

export class Turtle {
    constructor(canvas) {
        this.bridge = bridged("turtle")

        const stage = createStage(canvas, this.bridge)
        this.stage = stage
        this.renderstate = stage.renderstate

        // Render-on-demand: the loop stops itself when nothing is changing and
        // is woken by requestRender(). Without this it rendered at 60fps for the
        // page's whole life — a finished static drawing burned full WebGL frames
        // forever (the dominant persistent-CPU cost on low-compute clients).
        this.renderLoop = new Render.Loop(null, {
            onRender: (t) => this.onFrame(t),
            stopCondition: () => this._shouldStop()
        })
        stage.renderLoop = this.renderLoop
        // Let the stage (resize, camera bridge) wake the on-demand loop.
        stage.requestRender = () => this.requestRender()

        this._renderRequested = false    // one-shot: render at least one more frame
        this._keepRendering = false      // set each frame: is there ongoing work?
        this._controlsActiveUntil = 0    // ms timestamp: keep rendering until damping settles

        // Wake the loop on camera interaction; extend a settle window so inertial
        // damping completes after the user releases (controls.update() also keeps
        // it alive while it reports change, but the window is robust on its own).
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
        this._snapshotPending = false
        // Hatch gate: when the canvas is driven by passive outershell content
        // (watching a friend, or reverting to their code) this is true and the
        // onFrame hatch is suppressed — a friend's drawing must never be
        // hatched/reflected as the user's own. Only own edits and live drafts
        // refresh the snapshot. See upsertAmbient({ hatch }).
        this._hatchSuppressed = false
        this._localKeys = new Set()  // buffer IDs of locally-rendered tab ambients

        // Dirty marker: stamped on every draw/edit/removal. hatch() stamps
        // _lastHatchTime, so a drawing is "dirty" while _lastContentChange is
        // newer than the last hatch. eagerHatch skips when nothing changed.
        this._lastHatchTime = 0
        this._lastContentChange = 0

        this._heartbeatTimer = null
        this._onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                this.eagerHatch()
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

    // Keepalive: re-publish the snapshot  within the server's 10-min cache
    _scheduleHeartbeat() {
        if (this._heartbeatTimer) return
        const delay = 5 * 60_000 + Math.random() * 60_000
        this._heartbeatTimer = setTimeout(() => {
            this._heartbeatTimer = null
            if (document.visibilityState === 'visible') {
                this.eagerHatch(0, { force: true })
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
        // Free the render stack. The canvas is phx-update="ignore" and outlives
        // the hook, so a fresh Turtle is built on it each remount — without this
        // the old compositor's GPU layers and the stage (renderer/loop/controls/
        // cameraBridge) leak per remount, exhausting WebGL contexts over reconnects.
        this.compositor?.dispose()
        this.compositor = null
        this.scheduler = null
        this.stage.dispose()
    }

    // Lazy init: one scheduler (meta-root) + one compositor for the lifetime.
    _ensureScheduler() {
        if (this.scheduler) return
        this.scheduler = createScheduler(metaRoot(), {
            createDeps: () => ({
                mathParser: new Parser(),
                mathEvaluator: new Evaluator()
            }),
            execOpts: { color: this.color },
            // Pass the EMITTER's own name — its signal address. (Was the globally
            // focused ambient, which mis-addressed every shout to whatever panel
            // had focus.) Routing to a panel is a read-side concern, by source.
            onShout: (sourceName, msg, payload) => {
                this._onShout?.(sourceName, msg, payload)
            }
        })
        this.compositor = createCompositor(this.scheduler,
            { camera: this.stage.camera, controls: this.stage.controls },
            {
                scene: this.stage.scene,
                renderer: this.stage.renderer,
                recorder: this.stage.recorder,
                renderstate: this.renderstate,
                hatch: () => this.hatch(),
                // Let async materializers (troika Text builds glyphs off-thread)
                // wake the render-on-demand loop once their geometry is ready,
                // else a label finishing after the loop idles out never draws.
                requestRender: () => this.requestRender(),
                // The render loop's vsync cadence — lets the compositor distinguish a
                // slow/throttled frame from a render-on-demand idle-out (id:eye/rerun).
                frameInterval: this.renderLoop.frameInterval
            },
            {
                createHead: (parent) => new Render.Head(parent),
                createShapist: (parent) => new Render.Shape(parent, {
                    layerMethod: 'renderOrder',
                    polygonOffset: { factor: -0.1, units: -1 }
                })
            }
        )
        // focusedAddress left null — set by first draw() call
        this.stage.head.hide()
    }

    onFrame(t) {
        this._renderRequested = false
        let controlsChanged = false

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

            if (this.renderstate.snapshot.frame == null && t > 500 && !this._hatchSuppressed) {
                this.hatch()
            } else if (this.scheduler.done && !this._snapshotPending && !this._hatchSuppressed) {
                // Re-captures ride the done transition: a run's final state is
                // captured once; eagerHatch (visibility/heartbeat) re-arms it.
                if (this.hatch()) this._snapshotPending = true
            }
        } else {
            // No ambients — idle render (orbit controls, stage head)
            const { head, camera, controls, renderer, scene } = this.stage
            const scaleFactor = camera.position.distanceTo(head.position()) / 250
            head.scale(scaleFactor)
            controlsChanged = controls.update()
            renderer.render(scene, camera)
        }

        // Decide whether the loop should keep running. Keep going while a program
        // animates, while recording, while the camera is still moving/damping, or
        // until the first thumbnail snapshot is captured; otherwise idle out.
        const animating = !!this.scheduler && !this.scheduler.done
        const recording = this.stage.recorder.isRecording
        // Only the compositor branch can hatch — don't pin the idle loop on.
        // A suppressed hatch must not pin the on-demand loop: with snapshot.frame
        // left null (we never capture for foreign content) this would spin forever.
        const needHatch = !!this.compositor && this.renderstate.snapshot.frame == null && !this._hatchSuppressed
        const controlsSettling = performance.now() < this._controlsActiveUntil
        this._keepRendering = animating || recording || controlsChanged || controlsSettling || needHatch
    }

    // Returns false when the stage swallowed the capture (one already in
    // flight) — callers re-arm rather than count it as a hatch.
    hatch() {
        if (this.stage.hatch(this.bridge) === false) return false
        this._lastHatchTime = performance.now()
        return true
    }

    eagerHatch(cooldown = 8_000, { force = false } = {}) {
        if (!this.compositor) return
        if (performance.now() - this._lastHatchTime < cooldown) return
        // Skip redundant re-publishes of an unchanged drawing. The periodic
        // keepalive passes force:true to refresh the server-side cache TTL.
        if (!force && this._lastContentChange <= this._lastHatchTime) return
        this._snapshotPending = false
        this.requestRender()
    }

    // --- Multi-ambient API ---

    // The rehearsal (Decision 019): a cell's section vocabulary is its
    // ancestors' code, run lazily from t=0 by the one executor semantics
    // (drainNamespace — headless, waits fast-forward, no sibling
    // negotiation, loud budget). Content-keyed cache: same vocabulary, one
    // rehearsal; an edit is new content and rehearses fresh. The KEY stays
    // the printed vocab (identity law: content hash is the cross-eval
    // predicate); the DRAIN runs the live node slices when the seam ships
    // them — no re-parse (id:cmp-vet wound 1).
    rehearseVocab(vocab, vocabNodes = null) {
        this._vocabCache ??= new Map()
        if (this._vocabCache.has(vocab)) return this._vocabCache.get(vocab)
        let ns = null
        try {
            const deps = { mathParser: new Parser(), mathEvaluator: new Evaluator() }
            const drained = drainNamespace(vocabNodes ?? parseProgram(vocab), deps)
            if (drained.error) console.warn('vocab rehearsal failed:', drained.error.message)
            else ns = drained
        } catch (error) {
            console.warn('vocab rehearsal failed:', error.message)
        }
        if (this._vocabCache.size >= 32) this._vocabCache.clear()
        this._vocabCache.set(vocab, ns)
        return ns
    }

    // hatch:false renders without refreshing the snapshot/thumbnail or reflecting
    // to the server — for passive outershell content (a watched friend, or a
    // reverted draft). Own edits and live drafts leave it default (true).
    //
    // vocab: a weave cell's section vocabulary (Decision 019) — the
    // ancestors' code (sectionCells derives it from the one AST), rehearsed
    // here and seeded into the fork spec the same way `as name do` inherits:
    // a COPY per seat, never shared.
    upsertAmbient(key, displayName, code, { hatch = true, vocab = null, nodes = null, vocabNodes = null } = {}) {
        try {
            // The seam ships live node slices when it has them (a page's
            // cells are slices of the ONE buffer tree); the code string
            // remains the content key and the socket projection. When
            // structure didn't travel, the green tree reuses the key's
            // previous parse (id:cmp-green-tree) — an edit to one block
            // keeps every other block's node objects.
            let instructions = nodes
            if (!instructions) {
                this._parseMemo ??= new Map()
                const held = this._parseMemo.get(key)
                instructions = reparseProgram(code, held?.text ?? null, held?.ast ?? null)
                this._parseMemo.set(key, { text: code, ast: instructions })
            }
            this._ensureScheduler()

            const ns = vocab ? this.rehearseVocab(vocab, vocabNodes) : null
            this.scheduler.hotSwapChild(key, {
                name: displayName,
                code: { ast: instructions, functions: ns?.functions ?? null },
                style: { color: this.color },
                env: ns?.userspace?.size ? { userspace: ns.userspace } : null
            })

            this._hatchSuppressed = !hatch
            if (hatch) {
                // Fresh run: re-arm the done-capture. The snapshot is NOT
                // cleared — nulling it re-armed a full-canvas readback on the
                // very next frame, i.e. once per keystroke under the live
                // re-eval (the typing-lag root cause).
                this._snapshotPending = false
            }

            this.compositor.flush()
            this._lastContentChange = performance.now()

            const errors = this.scheduler.errors
            if (errors.length > 0) {
                this.renderstate.meta = { state: "error", message: errors[0].message, source: code, commands: instructions }
                this.requestRender()
                // Walk errors ride structured (id:cmp-runtime-provenance):
                // span-true, born on the erring node — no message archaeology.
                return { success: false, error: errors[0].message, errorSpan: errors[0].span ?? null }
            }

            this.renderstate.meta = { state: "success", commands: instructions }
            this.requestRender()
            // The healthy parts live (D020): a parse-error node never fails
            // the run — the world drew. The structured errors ride the result
            // (span-true lines, no message archaeology) for any surface to speak.
            const parseErrors = collectErrors(instructions)
            const result = { success: true, commandCount: this.scheduler.commandCount }
            if (parseErrors.length) result.parseErrors = parseErrors
            return result
        } catch (error) {
            console.error(error)
            this.renderstate.meta = { state: "error", message: error.message, source: code }
            return { success: false, error: error.message }
        }
    }

    removeAmbient(key) {
        this._localKeys.delete(key)
        this._parseMemo?.delete(key)
        if (!this.scheduler) return
        this._lastContentChange = performance.now()

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

    // Focus by address (registration key / nested path) or by display name —
    // a name resolves THROUGH the address (one register + a name view), so
    // focus survives re-eval and rename and never collides across tabs.
    focusAmbient(ref) {
        if (this.compositor) {
            this.compositor.focusedAddress = resolveAddress(this.scheduler, ref)
        }
    }

    setAmbientOpacity(name, opacity) {
        if (this.compositor) {
            this.compositor.setOpacityByName(name, opacity)
        }
    }

    // The tab (root-child key === buffer id) whose subtree defines an ambient by
    // display name: a top-level tab named `name`, or the tab whose code spawned
    // `as name do …`. Returns null if not found (e.g. a remote peer's addr key).
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

    // Toggle a tab's ambient: shift+click adds if absent, removes if present.
    // On add, re-upserts ALL local ambients so they restart in sync.
    // resolveBuffer(key) → { name, content } provides sibling code for restart.
    toggleAmbient(id, name, code, resolveBuffer) {
        this._ensureScheduler()
        if (this.scheduler.root.children.has(id)) {
            this.removeAmbient(id)
        } else {
            this._localKeys.add(id)
            for (const key of this._localKeys) {
                const info = key === id ? { name, content: code } : resolveBuffer?.(key)
                if (info) this.upsertAmbient(key, info.name, info.content)
            }
        }
        this.requestRender()
    }

    // --- Backward-compatible API ---

    draw(id, name, code) {
        this._ensureScheduler()
        // Exclusive only when entering a tab OUTSIDE the active group: switching
        // to a fresh tab replaces the previous drawing. A tab already in
        // _localKeys (sisters brought alive via shift+click → toggleAmbient)
        // keeps its sisters running — editing or re-selecting one member must
        // not collapse the group; only that member's ambient is re-upserted.
        if (!this._localKeys.has(id)) {
            for (const key of this._localKeys) {
                if (key !== id) this.removeAmbient(key)
            }
            this._localKeys.clear()
            this._localKeys.add(id)
        }
        // Upsert first so the frame exists, then focus by its key directly.
        const result = this.upsertAmbient(id, name, code)
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
        this._snapshotPending = false
        this._lastContentChange = performance.now()

        this.stage.head.show()
        this.stage.head.reset()
        this.renderstate.snapshot = { frame: null, save: false }
        this.renderstate.meta = { state: null, message: null, commands: [] }
        this.renderLoop.requestRestart()
    }
}
