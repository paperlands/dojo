// Coreshell — my canvas (data-target="coreshell"): turtle, render, bridges, tabs.
// Page law is weave/page.js; this surface only performs. (gw-t-node-address)
// Adapters whole (S, scene/camera). bootShell + term-cell.register once.

import { Turtle } from "../../turtling/turtle.js"
import { publishCapture, currentDemand } from "../../turtling/capture.js"
import { Recorder } from "../../turtling/export/recorder.js"
import { registerStage } from "../../turtling/stage-cell.js"
import { cameraBridge, scene } from "../../bridged.js"
import { temporal } from "../../utils/temporal.js"
import { pageLaw, CORESHELL, OUTERSHELL, SELF, PEER } from "../../weave/page.js"
import { captureChoices, copyChoices } from "../../turtling/laws/hand_choices.js"
import { registerWorld, worldChanged } from "../../weave/world.js"
import { makeReflector } from "../../weave/reflect.js"
import { seatHealth } from "../../weave/seat-health.js"
import { readWounds } from "../../weave/wounds.js"
import { frameVitals, livingFamily, worldProgress } from "../../turtling/vitals.js"
import { mountReach } from "../../editor/reach.js"
import { mountDiagnosticsInk } from "../../editor/diagnostics.js"
import { nerve, nerveSeat } from "../nerve.js"
import { signals as S } from "../../nerve/store.js"
import { mountSun } from "../../nerve/sun.js"
import { commands, listeners, mutators } from "./core.js"
import { register, outerDrafting, putSource, getSource, get as getTerm } from "./term-cell.js"
import { selection } from "./selection-intent.js"
import { createCurrentAnnounce } from "./current-announce.js"
import { createArena } from "../../kernel/arena.js"
import { attach } from "../../kernel/attach.js"

import { safePush } from "../../adapter.js"
import { name, read } from "../../keep/entry.js"
import { createJournal } from "../../keep/journal.js"
import { createWire } from "../../keep/wire.js"
import { mintSnap } from "../../keep/kinds/snap.js"
import { adoptWork } from "../../keep/work.js"
import { REACH } from "../../keep/page.js"
import { askKeep, peerOf, registerDoor, registerKeeper, touched } from "../../keep/cell.js"
import { sessionName } from "./session-name.js"
import { forkRef, link, pullKeep, pullWork, pullLegacy } from "../../link.js"
import { fetchFragment, fragmentIndex } from "../../weave/fragments.js"
import { transpile } from "../../weave/parse.js"


// Events registered at mounted(); handlers returned once mount() stands.
export const inner = {
    events: ["seeOuterShell", "relayCamera", "selfkeepCanvas", "outerkeepCanvas",
             "writeShell", "syncShell", "opBuffer", "forkBuffer"],
    arrive: (name, payload) => selection()?.arrive(name, payload),
    mount: mountInner,
};

function mountInner(hook, { term, cm6 }) {
    // Order: bodies → organs → wiring → birth. Nothing publishes before birth.
    // Arena releases are reverse-of-creation — register where made.
    const arena = hook.arena.child();   // ownership begins at acquisition, not return

    // BODIES — editor first and silent so organs below read a live term.shell.
    const canvas = document.getElementById('core-canvas');
    // The shell is an application: the recorder (and its encoder) is an
    // instrument it opts into. A host that supplies none never loads it.
    const turtle = new Turtle(canvas, {
        instruments: { recorder: (c) => new Recorder(c, {}) },
        // View-only: ?reveal=delayed withholds the law hints until a move.
        reveal: link.read('reveal'),
    });
    arena.add(() => turtle.dispose());
    turtle.lendCut = () => {
        const seen = reflection()
        if (!seen || !owner) return null
        return { body: { ...seen, buffer_id: authored?.buffer_id ?? null }, claim: owner }
    }
    // The page routes camera controls. This stage is the subscriber's choice,
    // and the subscriber releases the route. An embedded hatch does not listen.
    const stopCamera = cameraBridge.sub((payload) => turtle.stage.command(payload))
    arena.add(stopCamera)
    // The shell owns the hand. An embedded hatch evaluates laws and does not listen.
    arena.add(turtle.attachHand())
    // Stage cell — the one address for the live turtle (gw-t-dom-registry).
    // Weave boot + revealAmbient read getStage(); no canvas.__turtle.
    arena.add(registerStage(turtle));

    term.inner();
    // Term cell — the one address for the coreshell Terminal (gw-t-dom-registry).
    arena.add(register("coreshell", term));

    // Profiler overlay — opt-in via ?perf=1. Lazy-imported so it adds
    // zero cost to normal sessions. Reports RAF idle-spin + GPU growth.
    // Probe port rides the same gate (light-ladders-probe-port) — read/poke only.
    if (link.read('perf') != null) {
        import('../../turtling/profile/overlay.js')
            .then(m => { if (arena.alive) arena.add(m.attachProfilerOverlay(turtle)); })
            .catch(err => console.warn('profiler overlay failed to load:', err));
        import('../../turtling/probe.js')
            .then(m => { if (arena.alive) arena.add(m.attachProbe(turtle, law, { authoredOf: () => authored?.addr ?? null })); })
            .catch(err => console.warn('probe failed to load:', err));
    }

    // ORGANS — before any listener. Routing is read-side (claimant panels).
    turtle._onShout = (source, msg, payload) => {
        nerve()?.push(S.shout(source, msg, payload))
    }

    const executeCommand  = commands.execute(term);
    const cameraCommand   = commands.camera(cameraBridge);
    const saveImage       = commands.saveImage();
    const saveRecording   = commands.saveRecording();

    const slider  = mutators.slider('slider');

    // Page law decides; this surface performs. Law holds its own orders (Cut 1).
    const law = pageLaw()
    // One admission for a provided capsule. undefined is "no news"; null is an
    // explicit materialized record with none; anything provided is copied or refused.
    const admitChoices = (raw) => {
        if (raw === undefined) return { ok: true, choices: undefined }
        if (raw === null) return { ok: true, choices: null }
        const choices = copyChoices(raw)
        return choices ? { ok: true, choices } : { ok: false }
    }
    const DEGREE = { kindled: 1.0, warm: 0.4 }  // gw-appearance → canvas opacity

    // One authored buffer at a time (D022) — child's edit/draft, never a seat
    // or friend push. Names a PLACE too: draft authors the addr the peer
    // pushes, so an addr alone cannot say whose figure the faults are.
    let authored = null
    let owner = getSource() ?? null
    let coreSourceRelease = null
    // A local accepted input is hatch news only for the authored seat; a foreign
    // watched-seat gesture never opens self's reflection gate.
    turtle._onHandInput = (seatKey) => {
        if (!authored) return
        // Exact membership in the page's own bindings; no private slot grammar here.
        if (law.bindingsOf(authored.addr, authored.place, SELF).some(({ slot }) => slot === seatKey)) {
            turtle.reflectChanged()
        }
    }
    const disown = (addr) => {
        if (authored?.addr === addr) authored = null
        if (owner?.addr === addr) owner = null
    }

    // Attention is the address (D021). Live caret when we hold the shell;
    // reached ledger otherwise. Cursor is the gate — when we hold it, we read it.
    const reached = new Map()
    const attentionOn = (addr) => (reached.has(addr) ? { line: reached.get(addr) } : null)

    // Own editor reach — same organ/seam as outershell (editor/reach.js).
    const innerReach = mountReach(term.shell, {
        gate: () => law.hasPage(term.currentBufferId()),
        publish: (line) => scene.attend(term.currentBufferId(), line),
    })
    arena.add(innerReach.cleanup)

    // Live caret for an addr whose editor we hold; null if elsewhere or tearing down.
    const cursorLine = (addr) => {
        if (addr !== term.currentBufferId()) return null
        const v = term.shell
        if (!v || v.destroyed) return null
        try { return v.state.doc.lineAt(v.state.selection.main.head).number }
        catch { return null }
    }

    // D021 cursor law for the outer owner: the claim names the subject, the
    // live editor names the line. No timer and no second coordinate.
    const outerCursorLine = () => {
        const outer = getTerm("outershell")
        const v = outer?.shell
        if (!v || v.destroyed) return null
        try { return v.state.doc.lineAt(v.state.selection.main.head).number }
        catch { return null }
    }

    const seatingAttention = (addr, place = CORESHELL) => {
        const line = place === OUTERSHELL ? outerCursorLine() : cursorLine(addr)
        if (line != null) return { line }
        return attentionOn(addr)
    }

    // Author's line for the wire — live caret when on screen, else ledger.
    const authoredAttention = () => {
        if (!authored) return null
        return seatingAttention(authored.addr, authored.place)
    }

    // Reflect law (weave/reflect.js) — surface lends bodies, names subject;
    // law decides. Lived inline once: the only test was a second copy.
    const reflector = makeReflector({
        tree: (addr, place) => law.tree(addr, place)
            ?? turtle.programFor(law.seatOf(addr, place)) ?? null,
        ailments: () => turtle.ailments,
        seatOf: (addr, place) => law.seatOf(addr, place),
    })
    const askDiagnostics = (addr, place = CORESHELL) => reflector.ask(addr, place)

    const reflection = () => {
        if (!authored || !owner || authored.claim !== owner) return null
        const seen = reflector.of({
            addr: authored.addr,
            place: authored.place,
            source: authored.text,
            attend: authoredAttention(),
        })
        if (!seen) return null
        // Held offer + resident effective choices; unvisited offered roots survive.
        const bindings = law.bindingsOf(authored.addr, authored.place, SELF)
        const choices = captureChoices(
            law.choicesOf(authored.addr, authored.place, SELF),
            bindings,
            (slot) => turtle.handLocalChoices(slot),
            (slot) => !!turtle.scheduler?.root?.children?.has(slot),
        )
        return choices ? { ...seen, choices } : seen
    }
    // Progress for ONE shell — one scheduler holds both places; unscoped read
    // gives two suns one number. null = the world.
    const progressAt = (place) =>
        worldProgress(turtle.scheduler, place ? law.slotsAt(place) : null)

    // World cell registrant (id:cmp-query-cell) — this surface owns turtle,
    // page law, scheduler reach; its faces are the contract. Faces read
    // CURRENT bodies at ask time: scheduler dies and is reborn; capture the
    // owner, ask for the body.
    arena.add(registerWorld({
        // Buffer's whole truth: tree parse errors ⊕ standing frame ailments,
        // at the asked PLACE so a sister never leaks ink.
        diagnostics: (addr, place) => askDiagnostics(addr, place),
        vitals: (name) => frameVitals(turtle.scheduler, name),
        family: (pattern) => livingFamily(turtle.scheduler, pattern),
        // Where self is looking — asked, so no surface keeps a boolean it
        // cannot release from here (id:light-ladders-place-axis).
        attentionAt: () => law.attentionAt(),
        progress: (place) => progressAt(place),
    }))

    // Engine says "moved"; weave decides who cares (turtling never imports weave).
    // Helios needs its own timer so the sun walks through quiet `wait`.
    // place rides: every helios says 'system', so address routing alone sent
    // every shell's sun here (id:nav-nerve-helios).
    const sun = mountSun({ read: () => progressAt(CORESHELL), place: CORESHELL, nerve })
    arena.add(sun.release)
    turtle.onProgress = () => {
        worldChanged()
        sun.tick()
    }

    // ONE APPLICATOR: gone → runs → light → hatch. Two loops, two assignments;
    // no dispatch, no flag inspection — the answer's shape carries the order
    // (light-ladders-cut3 / Phase E).
    //
    // Seats never open the gate (hatch:false); hatch total owns it. `witness`
    // scopes that write — only self may close self's reflect; a foreign batch
    // naming its witness cannot silence the author (Phase B).
    const perform = (ans, { witness = SELF } = {}) => {
        for (const key of ans.gone) turtle.removeAmbient(key)
        for (const r of ans.runs) {
            const options = {
                hatch: false,
                vocab: r.vocab ?? null,
                nodes: r.nodes ?? null,
                vocabNodes: r.vocabNodes ?? null,
            }
            // What a source record offered; undefined is "no record news", null is a
            // materialized record with no choices. (id:laws-construction-input)
            if (r.choices !== undefined) options.choices = r.choices
            turtle.upsertAmbient(r.slot, r.name, r.code, options)
        }
        turtle.light(ans.light, DEGREE)
        if (ans.hatch != null) turtle.reflectGate(ans.hatch, { witness })
    }

    // The law's other channel: where the ladder put attention, for the input
    // organ that addressed it. This surface's organ is here; another surface's
    // rides the bridge back, because only that surface holds it.
    const settle = (addr, at) => {
        if (!at) return
        if (addr === term.currentBufferId()) innerReach.reset(at.line)
        else scene.landed(addr, at.line)
    }

    // One door for every transition: perform, settle, breathe.
    // witness scopes the hatch gate — foreign seats cannot write gate[self].
    // Helios alone speaks the sun: a second ☀︎ push took the status slot from
    // the live walk (id:nav-nerve-helios).
    const enact = (addr, ans, { witness = SELF } = {}) => {
        perform(ans, { witness })
        settle(addr, ans.at)
        // Tiny runs settle in one tick and never breathe `building`.
        if (ans.runs.length) sun.tick()
        if (ans.gone.length || ans.runs.length) worldChanged()
    }

    // A hand landing here claims the light — dual of outer's activateOuter.
    // Not the canvas: one canvas draws both places, so a click on it names
    // neither (id:light-ladders-place-axis).
    const claimCore = () => {
        if (outerDrafting()) return   // the hand is in the other editor
        const addr = term.currentBufferId()
        if (addr == null) return
        enact(addr, law.attend(addr, cursorLine(addr), CORESHELL))
    }

    // Tab indicators mirror whatever stands — one source: law's place order.
    // library ~/ pages have no tab to light.
    const syncTabs = () => {
        term.clearAllTabActive()
        for (const addr of law.orderOf(CORESHELL)) term.setTabActive(addr)
    }

    // THIS SURFACE'S WOUNDS — one ask, one breath, every reader (weave/wounds.js).
    // Asked of the face directly: this surface IS the registrant; a room is
    // for asking what you did not put there. Coreshell buffers only — draft
    // lives in the other editor, so place is not in question here.
    const wounds = readWounds({ ask: () => askDiagnostics(term.currentBufferId(), CORESHELL) })
    arena.add(wounds.release)

    // WIRING — every organ above stands; from here the surface only listens.
    // Seat after quiet (not under keys). Hatch rests longer (BEAT.settled).
    // Render only the current owner claim; a committed claim is a no-op.
    const renderCore = ({ id, name, content, claim }) => {
        if (!claim || claim !== owner || authored?.claim === claim) return false
        const label = claim.name ?? name
        nerve()?.run()
        const origin = term.getBufferInfo?.(id)?.origin
        const admitted = admitChoices(origin && Object.hasOwn(origin, "choices") ? origin.choices : undefined)
        if (!admitted.ok) {
            console.warn("[weave] unreadable offered choices; source not seated")
            return false
        }
        enact(id, law.observe(id, {
            name: label, doc: content, witness: SELF, place: CORESHELL,
            attention: seatingAttention(id),
            // No origin choices materializes as explicit none; a local tab has no
            // record news at all. (id:laws-construction-input)
            choices: admitted.choices === undefined ? null : admitted.choices,
        }))
        authored = { addr: id, place: CORESHELL, name: label, text: content, buffer_id: claim.buffer_id ?? null, claim }
        syncTabs()
        announceCurrent.wake()
        return true
    }
    const applyMetadata = ({ id, name }) => {
        if (owner?.addr === id) owner.name = name
        if (authored?.addr === id) authored = { ...authored, name }
    }
    const quietRender = temporal.quiet(renderCore, 100)
    arena.add(quietRender.cancel)
    arena.add(term.sourceBridge.sub((claim) => {
        coreSourceRelease = putSource(claim)
        owner = claim
    }))
    arena.add(() => coreSourceRelease?.())
    arena.add(term.bridge.sub((payload) => {
        if (payload.metadata) applyMetadata(payload)
        else quietRender(payload)
    }))

    // A TAB SWITCH IS NEWS THE WORLD NEVER HEARS: the ask reads currentBufferId(),
    // this surface's own state, so it moves with no world breath behind it.
    // Seated from the standing editor, so the first breath is not a switch.
    let shown = term.currentBufferId()
    arena.add(term.bridge.sub(({ id }) => {
        if (id === shown) return
        shown = id
        wounds.changed()
    }));

    // Hatch carries no ask (id:kc-p-join).
    const pacedHatch = temporal.pace(
        (payload, claim) => {
            if (claim && claim !== owner) return
            safePush(hook, "hatchTurtle", {
                ...payload,
            })
        },
        200
    );

    // One demand for the owner's CURRENT document; the hatch sink carries it.
    const announceCurrent = createCurrentAnnounce({
        read: () => reflection(),
        send: (current) => {
            // The live demand carries the hand's own work and exact editing base.
            // An outer/peer draft has no local work/base to borrow.
            const own = authored?.place === CORESHELL
            return pacedHatch(
                currentDemand(
                    current,
                    authored?.buffer_id,
                    own ? term.currentWorkId?.() ?? null : null,
                    own ? term.currentBaseId?.() ?? null : null,
                ),
                authored?.claim ?? null,
            )
        },
    })
    arena.add(announceCurrent.release)
    arena.add(pacedHatch.cancel);

    // Journal door (id:kb-3-owner) + wire edge (id:kb-9).
    const journal = createJournal();
    arena.add(registerDoor(journal));
    arena.add(() => journal.close());

    const wireDoor = {
        root: () => journal.root(),
        roots: () => journal.roots(),
        local: (r, n, opts) => journal.local(r, n, opts),
        source: (id) => journal.source(id),
        image: (id) => journal.image(id),
        // The wire's auth fence: retained exact bytes, no unsigned fallback. (id:keep-auth-durable-proof)
        proof: (bytes) => journal.proof(bytes),
        share: async (id, shared) => {
            const out = await journal.share(id, shared)
            touched()
            return out
        },
    }
    const wire = createWire({ hook, door: wireDoor });

    // Join: snap now, one put, then announce. Identity recovery is the user's
    // decision: prepare a fresh stream, never mint. Every await is fenced by the
    // captured subject; a moved page keeps nothing. (id:keep-auth-write-guard)
    arena.add(registerKeeper(async (ask) => {
        const say = (msg) => nerve()?.push(S.system(msg))
        // Dirty owner: no reflection, so no snapshot. Never mint an empty body.
        const seen = reflection()
        if (!seen) {
            say("keep not confirmed — try again")
            return null
        }
        const claim = owner
        const captured = {
            workId: term.currentWorkId?.() ?? null,
            bufferId: term.currentBufferId?.() ?? null,
            baseId: term.currentBaseId?.() ?? null,
            value: term.getValue?.() ?? seen.source,
            projected: term.projecting?.() === true,
        }
        const contentNow = () => term.getValue?.() ?? seen.source
        const held = () =>
            arena.alive &&
            owner === claim &&
            (term.currentBufferId?.() ?? null) === captured.bufferId &&
            (term.currentWorkId?.() ?? null) === captured.workId &&
            (term.currentBaseId?.() ?? null) === captured.baseId &&
            contentNow() === captured.value &&
            (term.projecting?.() === true) === captured.projected
        // Base follows the REQUEST (river draft prev), else the core editor's
        // captured base. Never invent core ancestry for an outer source.
        const requestedBase = ask.prev ?? (claim.place === CORESHELL ? captured.baseId : null) ?? null
        // A prepared stream carries the requested reflection and its base; the
        // old buffer keeps its work binding for reading. No mint: a second Keep
        // returns the caption to the buffer this ask prepared. (id:keep-auth-write-guard)
        const prepare = (msg) => {
            const holder = term.getBufferInfo?.(captured.bufferId)
            const freshId = term.createBuffer?.(holder?.name ?? "", seen.source, null, null, requestedBase)
            if (freshId && (term.currentBufferId?.() ?? null) === freshId) say(msg)
            return freshId ? { prepared: { bufferId: freshId } } : null
        }

        let hand
        try {
            hand = await journal.hand()
        } catch {
            if (!held()) return { cancelled: true }
            say("keep unavailable — the journal did not answer")
            return null
        }
        if (!held()) return { cancelled: true }

        if (hand?.signing === "unavailable") {
            // No secure context: refuse plainly. A keygen offer here would lie.
            say("keep needs a secure context — no new hand was created")
            return null
        }

        const handRoot = typeof hand?.root === "string" && hand.root ? hand.root : null

        if (hand?.signing === "none" || hand?.signing === "keyless") {
            const wanted = confirmOnce(hand.signing === "keyless"
                ? "This journal's hand can't sign (its key is missing). Create a new hand for a new work? Old keeps stay readable."
                : "This journal has no signing hand. Create a new hand for a new work?")
            if (!wanted) {
                say("keep cancelled — nothing changed")
                return { cancelled: true }
            }
            if (!held()) return { cancelled: true }
            let seated = null
            try {
                seated = await journal.newHand({ expectedRoot: handRoot })
            } catch (e) {
                if (!held()) return { cancelled: true }
                say(e?.code === "stale-hand"
                    ? "the hand changed — keep again"
                    : "could not create a new hand — keep again")
                return null
            }
            // A usable key restored during generation is not a new hand: the
            // engine's CAS kept it, so keep the standing stream (no fork).
            const fresh = seated?.changed === true
            if (!held()) return { cancelled: true }
            if (!fresh) {
                say("hand available again — keep again")
                return { prepared: { bufferId: captured.bufferId } }
            }
            return prepare("new hand ready — keep again for the new work")
        }

        if (hand?.signing !== "ready" || !handRoot) {
            say("keep needs a hand — keep again")
            return null
        }

        let eligible = true
        if (captured.workId) {
            let origin = null
            try {
                origin = await journal.get(captured.workId)
            } catch {
                origin = null
            }
            if (!held()) return { cancelled: true }
            // Missing evidence is not proof — a real door throws here; read it
            // as unproven, never as an accusation.
            let proof = null
            if (typeof origin === "string") {
                try {
                    proof = await journal.proof(origin)
                } catch {
                    proof = null
                }
                if (!held()) return { cancelled: true }
            }
            let targetless = false
            let sameRoot = false
            try {
                targetless = read(origin).target == null
                sameRoot = read(origin).root === handRoot
            } catch { /* unreadable is not an origin */ }
            eligible = typeof origin === "string" && name(origin) === captured.workId &&
                targetless && sameRoot && proof != null
            if (!eligible) {
                // Foreign/unknown/unproven: a fresh null-work stream, old keep
                // stays readable. Silence here would be a silent fork.
                const fork = confirmOnce(
                    "This hand can’t continue the old work. Start a new work from this draft? The old work stays unchanged.")
                if (!fork) {
                    say("keep cancelled — nothing changed")
                    return { cancelled: true }
                }
                if (!held()) return { cancelled: true }
                return prepare("new work ready — keep again")
            }
        }

        ask = { ...ask, prev: requestedBase }
        const shot = await turtle.snap?.() ?? null
        if (!held()) return { cancelled: true }
        const path = shot && typeof shot === "object" ? shot.path ?? null : null
        const document = shot && typeof shot === "object" ? shot.body : null
        if (!document || typeof document.source !== "string") {
            say("no picture — not kept")
            return null
        }
        if (shot.claim !== claim || document.source !== seen.source) {
            say("no picture — not kept")
            return null
        }
        const ids = {
            work_id: eligible ? captured.workId : null,
            buffer_id: captured.bufferId,
            // Captured before the picture; the engine's birth-root check is last.
            root: handRoot,
        }
        let id
        try {
            id = await mintSnap(ask, document, ids, journal, path)
        } catch (e) {
            // Another tab replaced the hand under us. Never remint or retry.
            if (!arena.alive || !held()) return null
            say(e?.code === "needs-hand" ? "keep needs a hand — keep again"
                : e?.code === "stale-hand" ? "the hand changed — keep again"
                    : "keep not confirmed — try again")
            return null
        }
        if (!id) {
            if (arena.alive && held()) say("keep not confirmed — try again")
            return null
        }
        if (!arena.alive) return id
        // First keep is the work. Stash its name; later snaps set target.
        if (!captured.workId) term.adoptWork?.(id, captured.bufferId, null)
        if (claim.place === CORESHELL && !captured.projected && owner === claim) {
            term.adoptBase?.(id, captured.bufferId, ask.prev)
        }
        // The first keep adopts work/base; the live ghost must carry them now,
        // not only on the next unrelated edit.
        announceCurrent.sync()
        touched()
        void wire.announce()
        return id
    }));

    arena.add(turtle.bridge.sub(([event, payload]) => {
        switch (event) {
        case "saveRecord":
            if (payload.type === "video") saveRecording(payload.snapshot, null, payload.title);
            if (payload.type === "image") saveImage(payload.snapshot, payload.title);
            break;
        case "hatchTurtle": {
            publishCapture(payload, pacedHatch)
            break
        }
        }
    }));

    // The ink reads them; nothing is pushed into the editor but the breath
    // (id:cmp-first-surface). A thunk, not a body: the current view, each breath.
    arena.add(mountDiagnosticsInk(cm6, { view: () => term.shell, wounds }))

    // Seat base: pull standing health, never push (weave/seat-health.js —
    // same organ outershell mounts, other subject).
    const health = seatHealth({ wounds: wounds.read, subject: term.currentBufferId })
    // Lent for as long as THIS nerve is seated: it may mount after us and
    // may be replaced under us — attach owns both (kernel/attach.js).
    arena.add(attach(nerveSeat, (seated) => seated.health(health)))
    arena.add(wounds.watch(() => nerve()?.refresh()))

    // Scene moves from the outer surface — consumer dual of bridged.js
    // constructors: observe · attend · forget (+ restore). focus died with
    // the world sentinel; a click is attend (light-ladders-cut4).
    // Law decides; perform() executes.
    const onObserve = ({ addr, name, code, claim }) => {
        if (claim && claim !== owner) return
        if (claim && authored?.claim === claim && authored.addr === addr) return
        // Live draft — SELF at the friend's place, standing BESIDE their
        // record rather than on top of it. Both held; hers paints
        // (weave/page.js `paints`), theirs is the baseline she reverts to.
        // A NEW draft snapshots the painted peer's offered value; an existing draft
        // keeps its own. Later peer pushes never live-follow into it.
        const existing = law.bindingsOf(addr, OUTERSHELL, SELF).length > 0
        const inherited = existing ? undefined : law.choicesOf(addr, OUTERSHELL, PEER)
        const admitted = admitChoices(inherited)
        if (!admitted.ok) {
            console.warn("[weave] unreadable peer offer; draft not opened")
            return
        }
        enact(addr, law.observe(addr, {
            name, doc: code, witness: SELF, place: OUTERSHELL,
            attention: seatingAttention(addr, OUTERSHELL),
            choices: admitted.choices,
        }))
        authored = { addr, place: OUTERSHELL, name, text: code, buffer_id: null, claim: claim ?? null }
        announceCurrent.wake()
    }
    const onRestore = ({ addr, name, code }) => {
        // Leave draft: drop self's record; law hands the seat back to the
        // friend's held record WITH THEIR OWN BODY — including pushes that
        // arrived while drafting. Re-seating the peer from frozen text was
        // a second door onto the same fact, and a beat of blank canvas.
        if (owner?.place === OUTERSHELL) owner = null
        disown(addr)
        enact(addr, law.restore(addr, OUTERSHELL), { witness: PEER })
    }
    arena.add(scene.sub({
        // Outer's cheap ownership claim; it never renders.
        claim: (payload) => { owner = payload },
        // One ladder step: reached cell mounts and RUNS (lazy). Line held so
        // the next edit on this addr carries it (D021).
        //
        // Reflect's coordinate moved — watcher has news even with no typing
        // (D025 R4). Re-arm hatch only for the buffer being reflected:
        // another addr's reach changes nothing a friend can see.
        attend: ({ addr, line, witness, claim }) => {
            if (claim && claim !== owner) return
            reached.set(addr, line)
            // Witness is the claim: self's reach moves the light; theirs is
            // presence and never takes it from a hand in the other shell (P9).
            enact(addr, law.attend(addr, line, undefined, { witness }))
            if (authored?.addr === addr) turtle.attentionMoved()
        },
        remove: ({ ambientId }) => {
            // Forgotten whole — later re-watch starts clean.
            // Light total rides forget's answer — no ad-hoc focus fixup (Cut 3).
            disown(ambientId)
            reached.delete(ambientId)
            enact(ambientId, law.forget(ambientId))
            term.clearMerge()
        },
        fork: (payload) => {
            term.forkBuffer(payload)
            term.shell?.focus()
        },
        observe: onObserve,
        restore: onRestore,
    }));

    // Outer owns reader attention; this handler only seats peer code.
    // Fresh + attend.line → open on their cell (not ladder birth cell 0).
    // Later hatches → sticky order so body pushes don't re-aim intervene;
    // while following, outer onPeerLine moves attend on line changes.
    const onSeeOuterShell = (payload) => {
        if (selection()?.accepted(payload) === false) return
        if (!payload?.addr) return
        if (payload.state !== "success") return
        // Prefer standing tree; plain tabs often hatch commands:[] with source only.
        const doc = (Array.isArray(payload.commands) && payload.commands.length > 0)
            ? payload.commands
            : (typeof payload.source === "string" && payload.source.length > 0
                ? payload.source
                : null)
        if (doc == null) return
        const name = payload.origin_name || payload.addr
        const line = payload?.attend?.line
        const fresh = !law.orderOf(OUTERSHELL, PEER).includes(payload.addr)
        const attention = (fresh && line != null) ? { line } : null
        // Absent means "no news" on a held record; a source replacement with no
        // choices materializes as explicit none. (id:laws-construction-input)
        const admitted = admitChoices(payload.choices)
        if (!admitted.ok) {
            console.warn("[weave] unreadable peer choices; payload not seated")
            return
        }
        const choices = admitted.choices === undefined ? (fresh ? null : undefined) : admitted.choices
        const ans = law.observe(payload.addr, {
            name, doc, witness: PEER, place: OUTERSHELL, attention,
            choices,
        })
        enact(payload.addr, ans, { witness: PEER })
        const { source, merge } = ans
        // Update the peer baseline; light the coreshell merge only in watch view.
        // forkBuffer itself never enables merge — a fork without outer is
        // ordinary editing (terminal.mergeActive / id:la-fork).
        if (merge && payload.buffer_id) {
            term.updateMergeOriginal(source, payload.addr, payload.buffer_id)
        }
        term.resumeMerge()
    };

    const onOpBuffer = (event) => {
        if (event.op === 'activate') {
            // Shift+click: toggle tab ambient. Literate tab toggles its PAGE
            // (reach law) — never a whole-buffer ambient beside its cells; a
            // plain tab keeps the turtle's own toggle (sisters restart in sync).
            const info = term.getBufferInfo(event.target);
            if (info) {
                // Cut 1: membership is the weave's — pin/observe through the law only.
                const ans = law.toggle(event.target, info.name, info.content)
                enact(event.target, ans)
                syncTabs()
            }
            return;
        }
        if (event.op === 'close') {
            const targetId = event.target || term.currentBufferId();
            const hadBuffer = !!term.getBufferInfo(targetId);
            term.opBufferHandler(event);
            if (hadBuffer && !term.getBufferInfo(targetId)) {
                // forget answers post-removal light — no ad-hoc focus fixup (Cut 3).
                disown(targetId)
                reached.delete(targetId)
                enact(targetId, law.forget(targetId))
                syncTabs()
            }
            return;
        }
        if (event.op === 'rename') {
            const targetId = event.target;
            const oldName = term.getBufferInfo(targetId)?.name;
            term.opBufferHandler(event);
            const newName = term.getBufferInfo(targetId)?.name;
            if (oldName && newName && oldName !== newName) {
                const child = turtle.scheduler?.root.children.get(targetId);
                if (child) child.name = newName;
            }
            return;
        }
        term.opBufferHandler(event);
    };

    // mousedown is the gesture; focusin is the same claim by keyboard arrival.
    arena.on(term.shell.dom, 'mousedown', claimCore);
    arena.on(document, 'focusin', (e) => {
        if (term.shell?.dom?.contains(e.target)) claimCore()
    });

    // Editor listeners last, so they release FIRST: a keystroke or selection
    // landing mid-teardown must not reach organs already let go.
    arena.add(listeners.keyboard(term.shell, cm6).mount());
    arena.add(listeners.selection(term.selectionBridge).mount());
    arena.add(listeners.theme(theme => term.setOption('theme', theme)).mount());
    arena.add(slider.mount());
    arena.add(listeners.slider(term.shell, slider, cm6).mount());

    /** The aperture's gesture: keep the moment, and put a file on disk too. */
    const keepAndSave = (title) => {
        // turtle.snap sets _snapOwed; arming snapshot is for download on hatch finish.
        if (turtle.renderstate) {
            turtle.renderstate.snapshot = { save: true, title }
        }
        // The keeper owns the outcome and its one notice; preparation and
        // cancellation speak for themselves.
        void askKeep(title, {
            name: sessionName(),
            peer: peerOf(term),
        })
    }

    return {
        // BIRTH — the room is whole, so now it may speak. Buffer on screen
        // published once; every reader above hears it, none sooner.
        // Lifecycle machine calls this; it is a phase, not a trailing line.
        // announce is the same sentence reconnected will say (id:kb-9).
        birth: () => {
            // Rejoin before the first breath: the journal owns the origin id.
            void reclaimWork(journal, term).then(() => {
                if (!arena.alive) return
                if (!owner) term.triggerBridge()
            })
            // ?fork=<ref> forks the named thing or finds its buffer — after
            // birth, so every organ stands; idempotent, so a remount only
            // Mount is the whole enactment (id:la-law) — no nav listener race.
            const ref = link.read("fork");
            if (ref) {
                void forkRef(ref, {
                    door: journal,
                    term,
                    corpus: { index: fragmentIndex, fetch: fetchFragment, press: transpile },
                    pull: pullKeep,
                    pullWork,
                    pullLegacy,
                });
            }
            void wire.announce();
        },
        // The healer: clear the drain latch, then say birth's sentence again.
        reconnected: () => void wire.reconnected(),

        events: {
            seeOuterShell:  onSeeOuterShell,
            // Owner-ready: settle local edits, then read CURRENT once.
            syncShell:      () => {
                const commit = () => {
                    if (!owner) {
                        const announced = term.triggerBridge?.()
                        if (announced) renderCore(announced)
                        return
                    }
                    if (authored?.claim === owner) return
                    if (owner.place === OUTERSHELL) {
                        onObserve({ addr: owner.addr, name: owner.name, code: owner.text, claim: owner })
                    } else {
                        renderCore({ id: owner.addr, name: owner.name, content: owner.text, claim: owner })
                    }
                }
                announceCurrent.sync(commit)
            },
            relayCamera:    ({ command }) => cameraCommand(command),
            // Same ask fence as the river (id:kj-vet 6); file beside the keep.
            selfkeepCanvas:  ({ title })  => keepAndSave(title),
            outerkeepCanvas: ({ title })  => keepAndSave(title),
            writeShell:     executeCommand,
            opBuffer:       onOpBuffer,
            forkBuffer:     (forkData) => term.forkBuffer(forkData),
        },
        arena,
    };
}

// The page's own small consent (terminal.js precedent): absent/throw means no.
function confirmOnce(message) {
    try {
        return typeof globalThis.confirm === "function" && globalThis.confirm(message) === true
    } catch {
        return false
    }
}

// The log owns the origin id. Recover it onto the tab, or stay put.
async function reclaimWork(door, term) {
    try {
        const work = term.currentWorkId()
        const buf = term.currentBufferId()
        if (!door || !buf) return
        const listed = await door.list(await door.root(), REACH)
        const recovered = adoptWork(listed, buf, work)
        if (recovered && recovered !== work) term.adoptWork?.(recovered, buf)
    } catch {
        /* a shut door leaves the field as it is */
    }
}
