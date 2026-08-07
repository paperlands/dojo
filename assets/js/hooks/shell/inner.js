// Coreshell — my canvas (data-target="coreshell"): turtle, render, bridges, tabs.
// Page law is weave/page.js; this surface only performs. (gw-t-node-address)
// Adapters whole (S, scene/camera). bootShell + term-cell.register once.

import { Turtle } from "../../turtling/turtle.js"
import { registerStage } from "../../turtling/stage-cell.js"
import { cameraBridge, scene } from "../../bridged.js"
import { temporal } from "../../utils/temporal.js"
import { pageLaw } from "../../weave/page.js"
import { registerWorld, worldChanged } from "../../weave/world.js"
import { diagnostics, ailmentsFor, verdict, primaryWound, announcements } from "../../weave/queries.js"
import { readWounds } from "../../weave/wounds.js"
import { sayWound } from "../../weave/wound-view.js"
import { frameVitals, livingFamily, worldProgress } from "../../turtling/vitals.js"
import { mountReach } from "../../editor/reach.js"
import { mountDiagnosticsInk } from "../../editor/diagnostics.js"
import { nerve, watchNerve } from "../nerve.js"
import { signals as S } from "../../nerve/store.js"
import { createHeliosWalk } from "../../nerve/helios.js"
import { commands, listeners, mutators } from "./core.js"
import { register } from "./term-cell.js"
import { createArena } from "../../kernel/arena.js"

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
    if (new URLSearchParams(location.search).has('perf')) {
        import('../../turtling/profile/overlay.js')
            .then(m => { if (arena.alive) arena.add(m.attachProfilerOverlay(turtle)); })
            .catch(err => console.warn('profiler overlay failed to load:', err));
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

    // Page law decides; this surface performs. localKeys names displaced ambients.
    const law = pageLaw({ localKeys: () => [...turtle._localKeys] })
    const DEGREE = { kindled: 1.0, warm: 0.4 }  // gw-appearance → canvas opacity

    // One authored buffer at a time (D022) — child's edit/draft, never a seat or friend push.
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

    // The buffer's STANDING TREE — a page's on the page record, a plain tab's in
    // the parse memo: the two lifecycles the { text, ast } pair rides.
    const treeFor = (key) => law.tree(key) ?? turtle.programFor(key) ?? null

    // The one diagnostics answer, asked not computed: the query joins the
    // tree's parse errors with the canvas's standing ailments and locates each
    // diagnostic by line. One call, every reader — ink, voice, wash, reflect.
    // TWO sources, and the second is already a union (turtle.ailments): nothing
    // downstream learns where a canvas fault came from.
    const askDiagnostics = (key) =>
        diagnostics(treeFor(key) ?? [], ailmentsFor(turtle.ailments, key), key)

    // What crosses the peer seam (D022): the authored buffer's WHOLE standing
    // tree, its diagnostics, and the verdict over them. Never a seat's
    // instruction slice — a page seats per cell, and the slice is not the page.
    // Asked at reflect time, so there is no writer to race; every part of the
    // answer comes from the query, so this surface only names its subject.
    //
    // THE ATTENTION RIDES, THE DOCUMENT DOES NOT MOVE (D025 R1, amended).
    // `attend` is a coordinate INTO the tree that crosses beside it — the
    // author's own line, untranslated, because the watcher holds the very same
    // document. No projection, no shift, no second coordinate space, and so
    // nothing that can land on the wrong text.
    //
    // What makes untranslated legal: `printAST` preserves LINE COUNT (the
    // healing marks `implicit`/`meadowCloseImplicit`/`info` exist for exactly
    // this), so the watcher's rendered text has the author's line numbering
    // even where it re-indents a body. Measured across empty meadows, blank
    // runs, unterminated cells, bare code beside cells, and comments. The one
    // known drift is D021's: `###\n\n###` prints as `###\n###`, so a document
    // with an EMPTY meadow holding blank lines shifts everything below it by
    // one. Named, not guessed at, and not repaired here.
    //
    // NOT `reflectPhase` here, and the reason is a bug that shipped: projecting
    // the tree by the inhabited phase drops every distant cell's BODY while
    // keeping its fences, so on the watcher each one seats with empty code and
    // its figure is wiped — and the gutted text becomes the merge baseline of a
    // CODE-REVIEW surface. A cursor move must not rewrite the friend's
    // document. The projection also saves nothing today: `source` rides whole
    // beside `commands` for the merge either way. It is a bandwidth question
    // for a later phase, and it cannot ship until "dormant" means NOT SEATED
    // rather than seated-with-nothing.
    //
    // attend:null is the identity — the document pointing nowhere — and it is
    // what `attentionOn` already returns off a buffer with no reach.
    const reflection = () => {
        if (!authored) return null
        const ast = treeFor(authored.addr)
        const found = ast ? askDiagnostics(authored.addr) : []
        // The verdict answers WHETHER and WHICH; the sentence is said HERE, at
        // the surface that ships it — so the server carries words it never has
        // to interpret (D022).
        const { state, wound } = verdict(found, authored.addr)
        return {
            source: authored.text,
            commands: ast ?? [],
            attend: authoredAttention(),
            diagnostics: found,
            state,
            message: wound ? sayWound(wound) : null,
        }
    }

    // The world cell's registrant (id:cmp-query-cell) — this surface owns the
    // turtle, the page law, and the scheduler reach, so its faces are the
    // contract. Every face reads the owner's CURRENT bodies at ask time —
    // the scheduler dies and is reborn; capture the owner, ask for the body.
    arena.add(registerWorld({
        // A buffer's whole truth: parse errors off its standing tree (a page's
        // tree on the page record, a plain tab's in the parse memo — the two
        // lifecycles the { text, ast } pair rides) ⊕ its frames' standing
        // walk ailments, filtered by address so a sibling tab never leaks ink.
        diagnostics: askDiagnostics,
        vitals: (name) => frameVitals(turtle.scheduler, name),
        family: (pattern) => livingFamily(turtle.scheduler, pattern),
    }))

    // Engine says "moved"; weave decides who cares (turtling never imports weave).
    // Helios pulls worldProgress — own timer so the sun walks through quiet `wait`.
    // Speaks on edges; this surface only forwards.
    const heliosWalk = createHeliosWalk({ read: () => worldProgress(turtle.scheduler) })
    let heliosTimer = null
    const tickHelios = () => {
        const view = heliosWalk.tick(performance.now())
        if (view) nerve()?.push(S.helios(view))
        if (heliosTimer == null && heliosWalk.isAnimating()) {
            heliosTimer = setTimeout(() => { heliosTimer = null; tickHelios() },
                                     heliosWalk.nextDelayMs())
        }
    }
    arena.add(() => { if (heliosTimer != null) clearTimeout(heliosTimer) })
    turtle.onProgress = () => {
        worldChanged()
        tickHelios()
    }

    // The handle for the current tab: its own frame if it has one (a plain tab,
    // a program's bare code), else the page's KINDLED cell — asked of the law,
    // never of a display name (D024: once cell 1 can be named, a name cannot
    // find the page). The kindled cell is what stands bright; answering the
    // first cell would dim a cell-2 figure the moment world-focus returned.
    const currentTabRef = () => {
        const key = term.currentBufferId()
        if (!key) return null
        return turtle.addressOf(key) ? key : law.pageKey(key)
    }

    // The one focus move both surfaces read: dim the previously bright ambient
    // and the local tabs, light the target. Focus and degree ride the ONE
    // register — one ambient address (D006) — keyed by address. `ref` is
    // whatever the caller holds (a key from the law, a friend's display name
    // from the outer shell) and resolves to an address before anything is lit
    // or dimmed.
    const focusOuter = ({ ref, world = false }) => {
        const target = turtle.addressOf(ref)
        const prev = turtle.compositor?.focusedAddress
        // Dim previous single ambient (covers outer→outer transitions)
        if (prev && prev !== target) {
            turtle.setAmbientOpacity(prev, DEGREE.warm)
        }

        // Core shell group: all active local tabs share focus. Dim them when
        // focusing outer, restore when returning to 'world' — by KEY, so a
        // program's bare code dims for its own cell instead of shadowing it.
        const localOpacity = world ? DEGREE.kindled : DEGREE.warm
        for (const k of turtle._localKeys) turtle.setAmbientOpacity(k, localOpacity)

        turtle.focusAmbient(ref)
        turtle.setAmbientOpacity(ref, DEGREE.kindled)
        turtle.requestRender()
    }

    // A transition's CANVAS consequences, in the turtle's own verbs. No policy
    // here: what this loop cannot do from the effect alone, the law was not
    // entitled to ask. Returns the result of the effect marked main.
    const perform = (effects) => {
        let main
        for (const e of effects) {
            switch (e.op) {
            case 'seat': {
                const result = turtle.upsertAmbient(e.key, e.name, e.code,
                    { hatch: e.hatch ?? true, vocab: e.vocab ?? null,
                      nodes: e.nodes ?? null, vocabNodes: e.vocabNodes ?? null })
                if (e.main) main = result
                break
            }
            case 'draw': {
                const result = turtle.draw(e.addr, e.name, e.code, e.nodes ?? null)
                if (e.main) main = result
                break
            }
            case 'remove':
                turtle.removeAmbient(e.key)
                break
            case 'focus': {
                // world = release: only this surface can name the current tab.
                if (e.world) {
                    const ref = currentTabRef()
                    if (ref) focusOuter({ ref, world: true })
                } else {
                    focusOuter({ ref: e.key })
                }
                break
            }
            case 'degree': {
                const focused = e.unlessFocused && turtle.isAmbientFocused(e.key)
                turtle.setAmbientOpacity(e.key, focused ? DEGREE.kindled : DEGREE[e.degree])
                break
            }
            }
        }
        // The gate is the batch's, spoken once (D022): any ACTIVE seat/draw in
        // this transition means the canvas is the child's, so the page still
        // reflects even when a passive warm sibling seats last. A batch that
        // runs nothing leaves the gate where it stands.
        const runs = effects.filter((e) => e.op === 'seat' || e.op === 'draw')
        if (runs.length) turtle.reflectGate(runs.some((e) => e.hatch !== false))
        if (effects.length) turtle.requestRender()
        return main
    }

    // The law's other channel: where the ladder landed, for the input organ
    // that addressed it. This surface's organ is here; another surface's rides
    // the bridge back, because only that surface holds it.
    const settle = (addr, landed) => {
        if (!landed) return
        if (addr === term.currentBufferId()) innerReach.reset(landed.line)
        else scene.landed(addr, landed.line)
    }

    // Run events only for the buffer this editor shows (child's own seat).
    // ☀︎ is an event; wound is health — different seat layers (D022).
    const report = (addr, result) => {
        if (addr !== term.currentBufferId()) return
        if (result.success && !primaryWound(askDiagnostics(addr), addr)) {
            nerve()?.push(S.output("☀︎", result.commandCount))
        }
        // Tiny runs finish in one tick — walk rises by run id, not phase edge.
        tickHelios()
    }

    // One door for every transition: perform, settle, report, breathe.
    const enact = (addr, ans) => {
        const main = perform(ans.effects)
        settle(addr, ans.landed)
        if (main) report(addr, main)
        if (ans.effects.length) worldChanged()
        return main
    }

    // Tab indicators mirror whatever stands: the shift+click sister group
    // (draw is exclusive outside it, the group survives edits) and any
    // local page's tab — library ~/ pages have no tab to light.
    const syncTabs = () => {
        term.clearAllTabActive()
        for (const key of turtle._localKeys) term.setTabActive(key)
        for (const addr of law.localPages()) term.setTabActive(addr)
    }

    // THIS SURFACE'S WOUNDS — one ask, one breath, every reader (weave/wounds.js).
    // Asked of the face directly, not through the cell: this surface IS the
    // registrant, and a room is for asking what you did not put there.
    const wounds = readWounds({ ask: () => askDiagnostics(term.currentBufferId()) })
    arena.add(wounds.release)

    // WIRING — every organ above stands; from here the surface only listens.
    const pacedRender = temporal.pace(({ id, name, content }) => {
        nerve()?.run()
        // The child's edit — this buffer is now the authored one (D022).
        authored = { addr: id, name, text: content }
        // The attention is the cursor THIS keystroke (or tab restore) landed
        // on, not a debounced echo: the reach publishes at 80 ms, this at 20.
        // Speaking and breathing ride enact, with every other door.
        enact(id, law.observe(id, {
            name, doc: content, own: true, attention: seatingAttention(id),
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

    // Seat base: pull standing health, never push. Ends when the document changes.
    const health = () => {
        const found = wounds.read()
        const w = primaryWound(found, term.currentBufferId())
        if (!w) return null
        return {
            msg: "*",
            payload: sayWound(w),
            ref: w.span?.line ? { line: w.span.line } : null,
            tally: announcements(found).length,
        }
    }
    // Lend on every nerve seating — nerve may mount after us (hooks/nerve.js).
    let releaseHealth = null
    const lendHealth = () => {
        const seated = nerve()
        if (!seated) return
        releaseHealth?.()
        releaseHealth = seated.health(health)
    }
    lendHealth()
    arena.add(watchNerve(lendHealth))
    arena.add(() => releaseHealth?.())
    arena.add(wounds.watch(() => nerve()?.refresh()))

    // Scene moves from the outer surface — the consumer-side dual of the
    // scene constructors (bridged.js): the same vocabulary, one handler per
    // named move; the law decides, perform() executes.
    arena.add(scene.sub({
        focus: ({ ambientId }) => {
            // 'world' = sentinel: outer shell releasing focus → restore core tab
            // (A friend arrives as a display NAME — the outer surface holds no
            // other handle; it resolves through the register like a key.)
            const isWorld = ambientId === 'world'
            const ref = isWorld ? currentTabRef() : ambientId
            if (ref) focusOuter({ ref, world: isWorld })
        },
        // One ladder step: the reached cell mounts and RUNS (lazy). The line
        // is held so the next edit on this addr carries it (D021).
        //
        // And the reflect's coordinate just moved, so the watcher has news even
        // though nothing was typed (D025 R4) — re-arm the existing hatch. Only
        // for the buffer being reflected: another addr's reach changes nothing
        // a friend can see, and asking would cost a photograph to learn so.
        attend: ({ addr, line }) => {
            reached.set(addr, line)
            enact(addr, law.attend(addr, line))
            if (authored?.addr === addr) turtle.attentionMoved()
        },
        remove: ({ ambientId }) => {
            // Forgotten whole, so a later re-watch starts clean.
            disown(ambientId)
            reached.delete(ambientId)
            enact(ambientId, law.forget(ambientId))
            const active = currentTabRef()
            if (active) {
                turtle.focusAmbient(active)
                turtle.setAmbientOpacity(active, DEGREE.kindled)
            }
            turtle.requestRender()
            term.clearMerge()
        },
        fork: (payload) => {
            term.forkBuffer(payload)
            term.shell?.focus()
        },
        // A live draft: the SAME call the core shell makes on the child's own
        // tab, so drafting on a friend's cell means what editing one's own cell
        // means. The child's while it runs, so the child's to reflect (D022).
        ambient: ({ addr, name, code }) => {
            authored = { addr, name, text: code }
            // A live draft's caret lives in the OUTER shell; this surface
            // only holds the ledger the outer reach / activateOuter fills.
            enact(addr, law.observe(addr, {
                name, doc: code, own: true, attention: attentionOn(addr),
            }))
        },
        // Draft frozen: the addr returns to the friend's last push, as a page.
        ambientStop: ({ addr }) => {
            disown(addr)
            enact(addr, law.restore(addr))
        },
    }));

    // Remote code rendering: inner shell handles seeOuterShell directly.
    // The friend's stream records into the slot ledger always; the law
    // decides whether the canvas changes (a running draft owns the slot;
    // a ~/ addr mounts as a page, first cell showing, siblings lazy).
    const onSeeOuterShell = (payload) => {
        if (!payload?.addr) return
        if (payload.state !== "success" || !payload.commands) return
        const name = payload.origin_name || payload.addr
        // The friend's tree crosses whole (D022); not the child's, so it never
        // hatches. attention stays null until the friend's line rides the
        // reflect.
        const ans = law.observe(payload.addr, {
            name, doc: payload.commands, own: false, attention: null,
        })
        enact(payload.addr, ans)
        const { source, merge } = ans
        if (merge && payload.buffer_id) {
            term.updateMergeOriginal(source, payload.addr, payload.buffer_id)
        }
    };

    const onOpBuffer = (event) => {
        if (event.op === 'activate') {
            // Shift+click: toggle tab's ambient (add if absent, remove if
            // present). A literate tab toggles its PAGE (the reach law) —
            // never a whole-buffer ambient beside its own cells; a plain tab
            // keeps the turtle's own toggle (sisters restart in sync).
            const info = term.getBufferInfo(event.target);
            if (info) {
                const { paged, ...ans } = law.toggle(event.target, info.name, info.content)
                enact(event.target, ans)
                if (!paged) {
                    turtle.toggleAmbient(event.target, info.name, info.content,
                        (key) => term.getBufferInfo(key));
                }
                syncTabs()
            }
            return;
        }
        if (event.op === 'close') {
            const targetId = event.target || term.currentBufferId();
            const hadBuffer = !!term.getBufferInfo(targetId);
            term.opBufferHandler(event);
            if (hadBuffer && !term.getBufferInfo(targetId)) {
                disown(targetId)
                reached.delete(targetId)
                enact(targetId, law.forget(targetId))
                const active = currentTabRef();
                if (active) turtle.focusAmbient(active);
                syncTabs()
                turtle.requestRender();
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

    // Editor listeners last, so they release FIRST: a keystroke or selection
    // landing mid-teardown must not reach organs already let go.
    arena.add(listeners.keyboard(term.shell, cm6).mount());
    arena.add(listeners.selection(term.selectionBridge, hook.pushEvent.bind(hook)).mount());
    arena.add(listeners.theme(theme => term.setOption('theme', theme)).mount());
    arena.add(slider.mount());
    arena.add(listeners.slider(term.shell, slider, cm6).mount());

    // BIRTH — the room is whole, so now it may speak. The buffer on screen is
    // published once, here, and the surface takes its first breath: every
    // reader above hears it, and none of them hears anything sooner.
    term.triggerBridge();

    return {
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
