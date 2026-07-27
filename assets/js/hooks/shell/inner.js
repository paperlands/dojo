// =============================================================================
// INNER SHELL — the canvas surface (data-target="core"): turtle, rendering,
// scene-bridge subscription, buffer/tab wiring. The rich program.
// Named adapters travel WHOLE: signals (S) from nerve/store.js, the scene/
// camera bridges from bridged.js — subscribed and pushed, never reconstructed.
// key-is-address stays loud: every canvas mount keys on the addr through
// turtle.upsertAmbient(addr, …) (gw-t-node-address). Built over the shared
// core: bootShell hands it { term, cm6 }; wireRegistry writes the registry once.
//
// The page relation — which cells stand, warm, leave; who owns an addr's
// canvas slot — is the PAGE LAW (weave/page.js): pure decisions spoken in
// the turtle's own transition alphabet. This surface only performs them
// (perform() below); it holds no page or slot state of its own.
// =============================================================================

import { Turtle } from "../../turtling/turtle.js"
import { registerStage } from "../../turtling/stage-cell.js"
import { cameraBridge, scene } from "../../bridged.js"
import { temporal } from "../../utils/temporal.js"
import { pageLaw } from "../../weave/page.js"
import { registerWorld, worldChanged } from "../../weave/world.js"
import { diagnostics, ailmentsFor, verdict } from "../../weave/queries.js"
import { frameVitals, livingFamily } from "../../turtling/vitals.js"
import { mountReach } from "../../editor/reach.js"
import { mountDiagnosticsInk } from "../../editor/diagnostics.js"
import { nerveInstance } from "../nerve.js"
import { signals as S } from "../../nerve/store.js"
import { commands, listeners, mutators, wireRegistry } from "./core.js"

// The surface as data: the lifecycle machine registers these event names
// synchronously at mounted(), queues payloads through the boot seam, and
// drains them into the handlers mount() returns once the substrate stands.
export const inner = {
    events: ["seeOuterShell", "relayCamera", "selfkeepCanvas", "writeShell",
             "opBuffer", "forkBuffer"],
    mount: mountInner,
};

function mountInner(hook, { term, cm6 }) {
    // Inner shell: canvas, turtle, rendering, scene bridge subscription
    const canvas = document.getElementById('core-canvas');
    const turtle = new Turtle(canvas);
    // Stage cell — the one address for the live turtle (gw-t-dom-registry).
    // Weave boot + revealAmbient read getStage(); the dunder remains for
    // legacy sites until they migrate (write count held, new reads don't grow).
    const unregisterStage = registerStage(turtle);
    canvas.__turtle = turtle;

    // Profiler overlay — opt-in via ?perf=1. Lazy-imported so it adds
    // zero cost to normal sessions. Reports RAF idle-spin + GPU growth.
    if (new URLSearchParams(location.search).has('perf')) {
        import('../../turtling/profile/overlay.js')
            .then(m => { hook._profilerDetach = m.attachProfilerOverlay(turtle); })
            .catch(err => console.warn('profiler overlay failed to load:', err));
    }

    // _onShout must precede term.bridge.sub which triggers first render.
    // Push every shout into the one store, addressed by its source. The
    // friend's ambient shouts (source = their name) route to the claiming
    // outershell panel; your own ambients fall to the local residual —
    // routing is a read-side concern, not decided here.
    turtle._onShout = (source, msg, payload) => {
        nerveInstance?.push(S.shout(source, msg, payload))
    }

    const executeCommand  = commands.execute(term);
    const cameraCommand   = commands.camera(cameraBridge);
    const saveImage       = commands.saveImage();
    const saveRecording   = commands.saveRecording();

    const slider  = mutators.slider('slider');

    // The page law — every weave decision (pages, slots, ladder steps)
    // lives there; this surface performs. The two degrees the law speaks
    // (gw-appearance) map to canvas opacity here, once.
    // The law's one injected read: the child's page must NAME the whole-buffer
    // ambients it displaces, and only this surface holds them.
    const law = pageLaw({ localKeys: () => [...turtle._localKeys] })
    const DEGREE = { kindled: 1.0, warm: 0.4 }

    // The reflect subject — reflect the document (D022): exactly one buffer is
    // AUTHORED at a time, the one the child is writing. Moves on the child's
    // edit, entering/leaving a draft, forgetting an addr; never per seat,
    // never on a friend's push.
    let authored = null
    const disown = (addr) => { if (authored?.addr === addr) authored = null }

    // Where the reader is, per addr — attention is the address (D021). Both
    // reach organs publish through scene.attend, so one ledger serves every
    // observe, and a followed friend's line arrives through the same door.
    const reached = new Map()
    const attentionOn = (addr) => (reached.has(addr) ? { line: reached.get(addr) } : null)

    // WHERE THE AUTHOR IS, for the wire — his cursor's LINE, read live.
    //
    // Two readers of one cursor (D021's "two outputs, different laws, one
    // read"), not two attentions. The SEATING ladder wants a cell and reads
    // `reached`, which the reach publishes as a cell's opening fence and only
    // while the buffer is a page. The WIRE wants the line, and wants it in
    // every context: a line is TOTAL — every position in the document has one —
    // so it says where he is in prose, on bare code, between cells and inside
    // them alike. Reading `reached` here would have made a friend invisible in
    // every buffer that is not a page, and quantized him to a fence in the ones
    // that are.
    //
    // A live draft lives in the OUTER editor, which this surface does not hold;
    // there the ladder's own address is the best answer available.
    const authoredAttention = () => {
        if (!authored) return null
        if (authored.addr === term.currentBufferId()) {
            const v = term.shell
            if (v && !v.destroyed) {
                try { return { line: v.state.doc.lineAt(v.state.selection.main.head).number } }
                catch { /* mid-teardown — fall through to the ladder's address */ }
            }
        }
        return attentionOn(authored.addr)
    }

    // The buffer's STANDING TREE — a page's on the page record, a plain tab's in
    // the parse memo: the two lifecycles the { text, ast } pair rides.
    const treeFor = (key) => law.tree(key) ?? turtle.programFor(key) ?? null

    // The one diagnostics answer, asked not computed: the query joins the
    // tree's parse errors with the canvas's standing ailments and locates each
    // diagnostic by line. One call, two readers — the editor's ink and the reflect.
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
        return {
            source: authored.text,
            commands: ast ?? [],
            attend: authoredAttention(),
            diagnostics: found,
            ...verdict(found, authored.addr),
        }
    }

    // The world cell's registrant (id:cmp-query-cell) — this surface owns the
    // turtle, the page law, and the scheduler reach, so its faces are the
    // contract. Every face reads the owner's CURRENT bodies at ask time —
    // the scheduler dies and is reborn; capture the owner, ask for the body.
    const unregisterWorld = registerWorld({
        // A buffer's whole truth: parse errors off its standing tree (a page's
        // tree on the page record, a plain tab's in the parse memo — the two
        // lifecycles the { text, ast } pair rides) ⊕ its frames' standing
        // walk ailments, filtered by address so a sibling tab never leaks ink.
        diagnostics: askDiagnostics,
        vitals: (name) => frameVitals(turtle.scheduler, name),
        family: (pattern) => livingFamily(turtle.scheduler, pattern),
    })

    // The current tab, as the register knows it: the buffer's own ambient when
    // one stands (a plain tab, or a program's bare code), else the tab's NAME —
    // a page has no whole-buffer ambient, and its first cell wears that name.
    const currentTabRef = () => {
        const key = term.currentBufferId()
        return key && turtle.addressOf(key) ? key : term.currentBufferName()
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

    // A transition, whole: the canvas performs, the organ settles.
    const enact = (addr, ans) => {
        const main = perform(ans.effects)
        settle(addr, ans.landed)
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

    const pacedRender = temporal.pace(({ id, name, content }) => {
        nerveInstance?.run()
        // The child's edit — this buffer is now the authored one (D022).
        authored = { addr: id, name, text: content }
        // The attention is the cursor THIS keystroke landed on, not a
        // debounced echo: the reach publishes at 80 ms, this at 20.
        const result = enact(id, law.observe(id, {
            name, doc: content, own: true, attention: attentionOn(id),
        }))
        if (result?.success && result.parseErrors?.length) {
            // The healthy parts drew (D020); the broken line speaks with its
            // TRUE span — born structured, never regexed out of a message.
            const e = result.parseErrors[0]
            nerveInstance?.push(S.error("error", e.message, e.span ? { line: e.span.line } : null))
        } else if (result?.success) {
            nerveInstance?.push(S.output("☀︎", result.commandCount))
        } else if (result) {
            // Walk errors arrive span-true from the frame's catch
            // (id:cmp-runtime-provenance). Skip-law: no span, no line —
            // never regexed back out of a message.
            const line = result.errorSpan?.line ?? null
            nerveInstance?.push(S.error("error", result.error, line ? { line } : null))
        }
        syncTabs()
        // The breath — once per eval, after perform(): surfaces ask again.
        // It carries nothing; the S.* pushes above are the OTHER flow (the
        // HUD's projection of the same born fact), not a duplicate.
        worldChanged()
    }, 20);

    term.bridge.sub(pacedRender);

    const pacedHatch = temporal.pace(
        (payload) => hook.pushEvent("hatchTurtle", {
            ...payload,
            buffer_id: term.currentBufferId(),
        }),
        200
    );

    turtle.bridge.sub(([event, payload]) => {
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
    });
    term.inner();
    // Expose CM6 view on the textarea so nerve hook can scrollToLine.
    // Expose the terminal so the outer review surface can read your
    // fork content along a lineage (forkContent) to seed a draft.
    wireRegistry(hook.el, term, cm6);

    // The reach on the child's own editor — the same organ the outershell
    // mounts (editor/reach.js), publishing through the same scene.attend seam
    // into the same page law: one behaviour, both shells.
    const innerReach = mountReach(term.shell, {
        gate: () => law.hasPage(term.currentBufferId()),
        publish: (line) => scene.attend(term.currentBufferId(), line),
    })

    // The lint ink asks; nothing is pushed into the editor but the breath
    // (id:cmp-first-surface). Thunks, not bodies: the current view, the
    // current buffer's key, each ask.
    const unmountInk = mountDiagnosticsInk(cm6, {
        view: () => term.shell,
        key: () => term.currentBufferId(),
    })

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

    // Scene moves from the outer surface — the consumer-side dual of the
    // scene constructors (bridged.js): the same vocabulary, one handler per
    // named move; the law decides, perform() executes.
    const sceneUnsub = scene.sub({
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
        // tab, so drafting on a friend's cell means what editing his own cell
        // means. The child's while it runs, so the child's to reflect (D022).
        ambient: ({ addr, name, code }) => {
            authored = { addr, name, text: code }
            enact(addr, law.observe(addr, {
                name, doc: code, own: true, attention: attentionOn(addr),
            }))
        },
        // Draft frozen: the addr returns to the friend's last push, as a page.
        ambientStop: ({ addr }) => {
            disown(addr)
            enact(addr, law.restore(addr))
        },
    });

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

    return {
        events: {
            seeOuterShell:  onSeeOuterShell,
            relayCamera:    ({ command }) => cameraCommand(command),
            selfkeepCanvas: ({ title })   => cameraCommand("snap", { title }),
            writeShell:     executeCommand,
            opBuffer:       onOpBuffer,
            forkBuffer:     (forkData) => term.forkBuffer(forkData),
        },
        cleanup: [
            listeners.keyboard(term.shell, cm6).mount(),
            listeners.selection(term.selectionBridge, hook.pushEvent.bind(hook)).mount(),
            listeners.theme(theme => term.setOption('theme', theme)).mount(),
            slider.mount(),
            listeners.slider(term.shell, slider, cm6).mount(),
            () => turtle.dispose(),
            // Drop pending trailing calls: a paced timer that fires after the
            // surface is gone would seat into a disposed turtle / push into a
            // dead hook.
            () => { pacedRender.cancel(); pacedHatch.cancel(); },
            innerReach.cleanup,
            unmountInk,
            unregisterWorld,
            unregisterStage,
            () => hook._profilerDetach?.(),
            sceneUnsub,
        ],
    };
}
