// Coreshell — my canvas (data-target="coreshell"): turtle, render, bridges, tabs.
// Page law is weave/page.js; this surface only performs. (gw-t-node-address)
// Adapters whole (S, scene/camera). bootShell + term-cell.register once.

import { Turtle } from "../../turtling/turtle.js"
import { registerStage } from "../../turtling/stage-cell.js"
import { cameraBridge, scene } from "../../bridged.js"
import { temporal } from "../../utils/temporal.js"
import { pageLaw, CORESHELL, OUTERSHELL, SELF, PEER } from "../../weave/page.js"
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
import { register, outerDrafting } from "./term-cell.js"
import { createArena } from "../../kernel/arena.js"
import { attach } from "../../kernel/attach.js"

// Events registered at mounted(); handlers returned once mount() stands.
export const inner = {
    events: ["seeOuterShell", "relayCamera", "selfkeepCanvas", "writeShell",
             "opBuffer", "forkBuffer"],
    mount: mountInner,
};

function mountInner(hook, { term, cm6 }) {
    // Order: bodies → organs → wiring → birth. Nothing publishes before birth.
    // Arena releases are reverse-of-creation — register where made.
    const arena = createArena();

    // BODIES — editor first and silent so organs below read a live term.shell.
    const canvas = document.getElementById('core-canvas');
    const turtle = new Turtle(canvas);
    arena.add(() => turtle.dispose());
    // Stage cell — the one address for the live turtle (gw-t-dom-registry).
    // Weave boot + revealAmbient read getStage(); no canvas.__turtle.
    arena.add(registerStage(turtle));

    term.inner();
    // Term cell — the one address for the coreshell Terminal (gw-t-dom-registry).
    arena.add(register("coreshell", term));

    // Profiler overlay — opt-in via ?perf=1. Lazy-imported so it adds
    // zero cost to normal sessions. Reports RAF idle-spin + GPU growth.
    // Probe port rides the same gate (light-ladders-probe-port) — read/poke only.
    if (new URLSearchParams(location.search).has('perf')) {
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
    const DEGREE = { kindled: 1.0, warm: 0.4 }  // gw-appearance → canvas opacity

    // One authored buffer at a time (D022) — child's edit/draft, never a seat
    // or friend push. Names a PLACE too: draft authors the addr the peer
    // pushes, so an addr alone cannot say whose figure the faults are.
    let authored = null
    const disown = (addr) => { if (authored?.addr === addr) authored = null }

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

    const seatingAttention = (addr) => {
        const line = cursorLine(addr)
        if (line != null) return { line }
        return attentionOn(addr)
    }

    // Author's line for the wire — live caret when on screen, else ledger (outer draft).
    const authoredAttention = () => {
        if (!authored) return null
        return seatingAttention(authored.addr)
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

    // One authored buffer at a time (D022), so one subject for the reflect.
    const reflection = () => authored && reflector.of({
        addr: authored.addr,
        place: authored.place,
        source: authored.text,
        attend: authoredAttention(),
    })

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
            turtle.upsertAmbient(r.slot, r.name, r.code, {
                hatch: false,
                vocab: r.vocab ?? null,
                nodes: r.nodes ?? null,
                vocabNodes: r.vocabNodes ?? null,
            })
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
    const pacedRender = temporal.pace(({ id, name, content }) => {
        nerve()?.run()
        // The child's edit — this buffer is now the authored one (D022).
        authored = { addr: id, place: CORESHELL, name, text: content }
        // The attention is the cursor THIS keystroke (or tab restore) landed
        // on, not a debounced echo: the reach publishes at 80 ms, this at 20.
        // Speaking and breathing ride enact, with every other door.
        enact(id, law.observe(id, {
            name, doc: content, witness: SELF, place: CORESHELL,
            attention: seatingAttention(id),
        }))
        syncTabs()
    }, 20);
    // Drop pending trailing calls: a paced timer that fires after the surface
    // is gone would seat into a disposed turtle / push into a dead hook.
    arena.add(pacedRender.cancel);
    arena.add(term.bridge.sub(pacedRender));

    // A TAB SWITCH IS NEWS THE WORLD NEVER HEARS: the ask reads currentBufferId(),
    // this surface's own state, so it moves with no world breath behind it.
    // Seated from the standing editor, so the first breath is not a switch.
    let shown = term.currentBufferId()
    arena.add(term.bridge.sub(({ id }) => {
        if (id === shown) return
        shown = id
        wounds.changed()
    }));

    const pacedHatch = temporal.pace(
        (payload) => hook.pushEvent("hatchTurtle", {
            ...payload,
            buffer_id: term.currentBufferId(),
        }),
        200
    );
    arena.add(pacedHatch.cancel);

    arena.add(turtle.bridge.sub(([event, payload]) => {
        switch (event) {
        case "saveRecord":
            if (payload.type === "video") saveRecording(payload.snapshot);
            if (payload.type === "image") saveImage(payload.snapshot);
            break;
        case "hatchTurtle":
            // The reflect seam (D022): the turtle contributes what it owns —
            // the fault and the snapshot path; the DOCUMENT is asked for here,
            // where the authored buffer lives. Order matters: the reflection
            // is authoritative over any stale document field.
            pacedHatch({ ...payload, ...(reflection() ?? {}) });
            break;
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
    const onObserve = ({ addr, name, code }) => {
        // Live draft — SELF at the friend's place, standing BESIDE their
        // record rather than on top of it. Both held; hers paints
        // (weave/page.js `paints`), theirs is the baseline she reverts to.
        authored = { addr, place: OUTERSHELL, name, text: code }
        enact(addr, law.observe(addr, {
            name, doc: code, witness: SELF, place: OUTERSHELL,
            attention: attentionOn(addr),
        }))
    }
    const onRestore = ({ addr, name, code }) => {
        // Leave draft: drop self's record; law hands the seat back to the
        // friend's held record WITH THEIR OWN BODY — including pushes that
        // arrived while drafting. Re-seating the peer from frozen text was
        // a second door onto the same fact, and a beat of blank canvas.
        disown(addr)
        enact(addr, law.restore(addr, OUTERSHELL), { witness: PEER })
    }
    arena.add(scene.sub({
        // One ladder step: reached cell mounts and RUNS (lazy). Line held so
        // the next edit on this addr carries it (D021).
        //
        // Reflect's coordinate moved — watcher has news even with no typing
        // (D025 R4). Re-arm hatch only for the buffer being reflected:
        // another addr's reach changes nothing a friend can see.
        attend: ({ addr, line, witness }) => {
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

    // Peer body on the canvas. Outer owns follow/intervene; this only seats.
    // Fresh + attend.line → open on their cell (not ladder birth cell 0).
    // Later hatches → sticky order so body pushes don't re-aim intervene;
    // while following, outer onPeerLine moves attend on line changes.
    const onSeeOuterShell = (payload) => {
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
        const ans = law.observe(payload.addr, {
            name, doc, witness: PEER, place: OUTERSHELL, attention,
        })
        enact(payload.addr, ans, { witness: PEER })
        const { source, merge } = ans
        if (merge && payload.buffer_id) {
            term.updateMergeOriginal(source, payload.addr, payload.buffer_id)
        }
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
    arena.add(listeners.selection(term.selectionBridge, hook.pushEvent.bind(hook)).mount());
    arena.add(listeners.theme(theme => term.setOption('theme', theme)).mount());
    arena.add(slider.mount());
    arena.add(listeners.slider(term.shell, slider, cm6).mount());

    return {
        // BIRTH — the room is whole, so now it may speak. Buffer on screen
        // published once; every reader above hears it, none sooner.
        // Lifecycle machine calls this; it is a phase, not a trailing line.
        birth: () => term.triggerBridge(),

        events: {
            seeOuterShell:  onSeeOuterShell,
            relayCamera:    ({ command }) => cameraCommand(command),
            selfkeepCanvas: ({ title })   => cameraCommand("snap", { title }),
            writeShell:     executeCommand,
            opBuffer:       onOpBuffer,
            forkBuffer:     (forkData) => term.forkBuffer(forkData),
        },
        arena,
    };
}
