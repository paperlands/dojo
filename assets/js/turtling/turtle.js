import { Parser } from "./mafs/parse.js"
import { parseProgram, reparseProgram } from "./parse.js"
// The ONE address-ownership rule — reflect the document (D022): which standing
// walk ailments belong to a buffer's own subtree. It lives with the query it
// serves; the import points DOWN-stream only (weave/queries.js reads
// turtling/parse.js and nothing else), so spelling the rule twice is what would
// cost us, not this.
import { ailmentsFor, standingAilments } from "../weave/queries.js"
import { drainNamespace } from "./executor.js"
import { Evaluator } from "./mafs/evaluate.js"
import Render from "./render/index.js"
import { bridged } from "../bridged.js"
import { createStage } from "./stage.js"
import { createScheduler, metaRoot } from "./scheduler.js"
import { createCompositor } from "./compositor.js"
import { resolveAddress } from "./focus.js"
import { hatchVerdict } from "./hatch.js"

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
        // Let the stage (resize, camera bridge) wake the on-demand loop, and say
        // the reflect changed when a camera command asks for a fresh capture.
        stage.requestRender = () => this.requestRender()
        stage.reflectChanged = () => this.reflectChanged()

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
        // Hatch gate: when the canvas is driven by passive outershell content
        // (watching a friend, or reverting to their code) this is true and the
        // hatch is suppressed — a friend's drawing must never be hatched/
        // reflected as the user's own. Only own edits and live drafts refresh
        // the snapshot. A seat may only OPEN this gate; closing it is the
        // batch's word (reflectGate) — see D022.
        this._hatchSuppressed = false
        this._localKeys = new Set()  // buffer IDs of locally-rendered tab ambients

        // THE THREE STAMPS THE VERDICT READS (hatch.js). Nothing else in this
        // class decides when to hatch; these say what the world did, and
        // hatchVerdict alone says what follows.
        //
        // _lastReflectChange — when the reflect last changed: a draw, an edit, a
        // removal, a walking frame, a moved cursor, the keepalive. ONE QUESTION,
        // TWO ENDS (D025 R3): this stamp and the server's `reflect_changed?` are
        // the same sentence — would the watcher learn something new?
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
            // THE RUN'S LAST WORD. A figure that has stopped moving is a change
            // no glimpse taken mid-walk can carry — and it is the only thing a
            // walking program says after it starts, which is why a loop that
            // never reaches `done` hatches once and then holds its peace.
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

        // THE ONE QUESTION (hatch.js) — no other place in this class decides to
        // hatch. `reason` says hatch now; `owed` says one is still coming, so the
        // loop may not idle out while a floor runs or the stage is still reading back.
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

        // Keep the loop running while a program animates, while recording, while
        // the camera is still moving/damping, or until the owed hatch lands.
        const recording = this.stage.recorder.isRecording
        const controlsSettling = now < this._controlsActiveUntil
        this._keepRendering = walking || recording || controlsChanged || controlsSettling || verdict.owed
    }

    // Hatch. The stage swallows it (false) while a readback is still in flight;
    // nothing is stamped then, so the reflect stays changed and the verdict says
    // hatch again next frame — the retry needs no flag of its own.
    hatch() {
        if (this.stage.hatch(this.bridge) === false) return false
        this._lastHatchAt = performance.now()
        return true
    }

    // THE ONE VERB — the client's half of `reflect_changed?` (D025 R3). Say the
    // reflect changed; the verdict alone decides whether that becomes a hatch.
    // Everything that used to reach for the shutter — the done edge, a moved
    // cursor, the keepalive, a save request — says this instead.
    //
    // A caller may say what changed; a caller may not hatch. That is the whole
    // discipline: no second wire path (D025 R4), no back door past the gate (a
    // followed PROGRAM still never hatches its previews, D023), and no second
    // rate limiter — the beat lives in hatch.js and nowhere else.
    reflectChanged() {
        this._lastReflectChange = performance.now()
        this.requestRender()
    }

    // The reflect's COORDINATE moved while its canvas stands still — a reader
    // who scrolls or steps between cells and types nothing (D025 R4). The
    // attention rides the reflect it belongs to, or it does not ride: the
    // redundant capture of an identical canvas is the price of no second wire,
    // bounded by the settled floor. Do not decouple the message from the hatch
    // to save it — that decoupling IS the second wire.
    attentionMoved() {
        this.reflectChanged()
    }

    // --- Multi-ambient API ---

    // The rehearsal (Decision 019): a cell's phase vocabulary is its
    // ancestors' code, run lazily from t=0 by the one executor semantics
    // (drainNamespace — headless, waits fast-forward, no sibling
    // negotiation, loud budget). Content-keyed cache: same vocabulary, one
    // rehearsal; an edit is new content and rehearses fresh. The KEY stays
    // the printed vocab (identity law: content hash is the cross-eval
    // predicate); the DRAIN runs the live node slices when the seam ships
    // them — no re-parse (id:cmp-vet diagnostic 1).
    // A wounded rehearsal is KEPT, not discarded: the definitions that
    // registered before the fault still stand (drainNamespace), so a broken
    // line in a phase no longer strips its whole vocabulary from every cell
    // beneath it. The error rides back on the answer — span-true on the
    // ANCESTOR's own line — instead of vanishing into a console warning; the
    // caller records it so the ink lands where the diagnostic was born, never on the
    // descendant that merely inherited the silence.
    rehearseVocab(vocab, vocabNodes = null) {
        this._vocabCache ??= new Map()
        if (this._vocabCache.has(vocab)) return this._vocabCache.get(vocab)
        let ns = null
        try {
            const deps = { mathParser: new Parser(), mathEvaluator: new Evaluator() }
            ns = drainNamespace(vocabNodes ?? parseProgram(vocab), deps)
            // THE SKIP-LAW, upheld at its source: only the live node slices carry
            // absolute buffer lines. Re-parsing the vocab STRING yields spans
            // relative to that slice — a number that looks true and points at
            // the wrong line. Drop it rather than ink a lie; the diagnostic still
            // speaks, it just declines to name a place it does not know.
            if (!vocabNodes && ns?.error?.span) ns.error = { ...ns.error, span: null }
        } catch (error) {
            // The drain is total; this is the impossible path (a broken dep).
            ns = { functions: null, userspace: null, error }
        }
        if (this._vocabCache.size >= 32) this._vocabCache.clear()
        this._vocabCache.set(vocab, ns)
        return ns
    }

    // EVERY standing diagnostic the canvas holds, in ONE shape and one list: the
    // frames' walk faults and the phases' rehearsal diagnostics. They are the same
    // fact — an addressed hurt with a true line — so they must not arrive as two
    // lists a reader has to know about and concatenate. The one address rule
    // (ailmentsFor) filters this; nothing downstream learns a second source.
    //
    // Deduped by where the diagnostic actually lives: many cells of a phase share
    // one vocabulary, and one broken line is one diagnostic, not one per reader.
    get ailments() {
        return standingAilments({
            frames: this.scheduler?.errors,
            seats: this._seatFaults?.values(),
            rehearsals: this._rehearsalDiagnostics?.values(),
        })
    }

    // hatch:false renders without refreshing the snapshot/thumbnail or reflecting
    // to the server — for passive outershell content (a watched friend, or a
    // reverted draft). Own edits and live drafts leave it default (true).
    //
    // vocab: a weave cell's phase vocabulary (Decision 019) — the
    // ancestors' code (phaseCells derives it from the one AST), rehearsed
    // here and seeded into the fork spec the same way `as name do` inherits:
    // a COPY per seat, never shared.
    // fresh:true forces a rebirth even when nothing changed — the explicit
    // restart gesture (toggle's group restart). The default seat is
    // idempotent: an unchanged seed leaves the standing frame running
    // (become stage 1, specs/compiler.org id:cmp-become-seed).
    upsertAmbient(key, displayName, code, { hatch = true, vocab = null, nodes = null, vocabNodes = null, fresh = false } = {}) {
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
            // The phase's diagnostic belongs to the phase, not to this seat: the
            // record is filed under the seat's key (so the address rule finds
            // it for this buffer) but carries the ancestor's own span, so the
            // ink lands on the line that actually broke.
            this._rehearsalDiagnostics ??= new Map()
            if (ns?.error) {
                this._rehearsalDiagnostics.set(key, {
                    address: key, name: displayName, message: ns.error.message,
                    span: ns.error.span ?? null, kind: 'rehearsal',
                })
            } else {
                this._rehearsalDiagnostics.delete(key)
            }
            this.scheduler.hotSwapChild(key, {
                name: displayName,
                code: { ast: instructions, functions: ns?.functions ?? null },
                style: { color: this.color },
                env: ns?.userspace?.size ? { userspace: ns.userspace } : null
            }, { fresh })

            // The gate is the BATCH's, not this seat's (D022): a page seats
            // many times per transition, and the last seat is a warm sibling
            // (hatch:false). Let a seat close the gate here and that sibling
            // silently stops the page reflecting at all. A seat only ever
            // OPENS it; closing is the batch's word, through reflectGate().
            if (hatch) this._hatchSuppressed = false

            this.compositor.flush()
            // A seat changes the reflect whether or not the gate opened for it:
            // while the gate is shut the verdict says nothing, and when it opens
            // the canvas is the child's, whatever stands on it.
            this._lastReflectChange = performance.now()

            // The child's OWN fault only (D022): scheduler.errors spans every
            // frame on the canvas, a watched friend's included, so reading it
            // whole reddens the child's reflect for a friend's broken code. The
            // address rule owns the filter; a page's cells ride `key#cellN`.
            // Seated clean — last time's throw is healed. Cleared at the same
            // site that sets it, so the pair cannot drift (cf. scheduler.js:534).
            this._seatFaults?.delete(key)

            const wounds = ailmentsFor(this.scheduler.errors, key)
            if (wounds.length > 0) {
                // THE TURTLE CARRIES WOUNDS, NEVER A SENTENCE. Each wound keeps
                // the key of the frame that died, so a watcher can isolate the
                // cells that hurt without running anything — a flattened
                // `message` leaves a receiver only a string to reprint.
                //
                // They ride `diagnostics`, the field the reflect already uses, so
                // there is ONE wound channel. The reflect's are these same wounds
                // LOCATED — an enrichment, never a second type.
                this.renderstate.meta = { state: "error", message: null, diagnostics: wounds }
                this.requestRender()
                return { success: false, wounds }
            }

            // The turtle publishes the FAULT it owns (walk). The DOCUMENT
            // (commands/source/diagnostics, including parse wounds) is asked for
            // at the query surface by the shell that holds the authored buffer
            // (D022 / id:cmp-query-cell) — never collected here as a second bag.
            // A parse-error node never fails the run (D020): the world drew.
            this.renderstate.meta = { state: "success", message: null, diagnostics: [] }
            this.requestRender()
            return { success: true, commandCount: this.scheduler.commandCount }
        } catch (error) {
            console.error(error)
            // A THROW IS A WOUND TOO, in the one shape. The message is one the
            // turtle was GIVEN, so it is quoted and rides the wound; the surface
            // says it through the view like any other.
            const wound = {
                message: error.message,
                span: error.span ?? null,
                kind: error.kind ?? "walk",
                address: key,
            }
            // HELD, not just returned: the scheduler's registry is frame
            // contexts and this throw never reached a frame, so standing here is
            // the only way it joins `ailments` and reaches every reader.
            ;(this._seatFaults ??= new Map()).set(key, wound)
            this.renderstate.meta = { state: "error", message: null, diagnostics: [wound] }
            return { success: false, wounds: [wound] }
        }
    }

    // The reflect gate, spoken once per transition (D022). `open` means the
    // canvas is the CHILD'S this batch — their edit or live draft — so the
    // snapshot may hatch and reflect. A batch of only passive seats (a watched
    // friend's push, a reverted draft) closes it; a batch with no seat at all
    // leaves it where it stands. One writer per transition, never N.
    reflectGate(open) {
        this._hatchSuppressed = !open
    }

    // The standing { text, ast } pair's tree for a plain-tab key — the
    // intra-session identity carrier (id:cmp-standing-primitives). The
    // diagnostics face reads it; a page's tree lives on the page record
    // (weave/page.js program(addr)), not here.
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

    // Focus by address (registration key / nested path) or by display name —
    // a name resolves THROUGH the address (one register + a name view), so
    // focus survives re-eval and rename and never collides across tabs.
    focusAmbient(ref) {
        if (this.compositor) {
            this.compositor.focusedAddress = resolveAddress(this.scheduler, ref)
        }
    }

    // Appearance rides the same register as focus (D006), so a `degree` can
    // name a program's first cell apart from the bare code that shares its
    // display name. `ref` is a registration key, a nested address, or a display
    // name — all resolve THROUGH the address, and an unknown ref dims nothing.
    setAmbientOpacity(ref, opacity) {
        if (this.compositor) {
            this.compositor.setOpacityByAddress(resolveAddress(this.scheduler, ref), opacity)
        }
    }

    // The address a caller's reference names, or null — the one resolution
    // every appearance/focus caller shares (so "is this the focused one?" is
    // asked address-true, never by a name two ambients can wear).
    addressOf(ref) {
        return resolveAddress(this.scheduler, ref)
    }

    isAmbientFocused(ref) {
        const address = this.addressOf(ref)
        return address != null && this.compositor?.focusedAddress === address
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
        // nodes: the caller's live parse, when it has one — the live-nodes
        // law (weave/page.js seatFrom). null is exactly today's behavior.
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
