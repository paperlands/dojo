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
import { diagnostics, ailmentsFor } from "../../weave/queries.js"
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

    const renderCommand   = commands.render(turtle);
    const executeCommand  = commands.execute(term);
    const cameraCommand   = commands.camera(cameraBridge);
    const saveImage       = commands.saveImage();
    const saveRecording   = commands.saveRecording();

    const slider  = mutators.slider('slider');

    // The page law — every weave decision (pages, slots, ladder steps)
    // lives there; this surface performs. The two degrees the law speaks
    // (gw-appearance) map to canvas opacity here, once.
    const law = pageLaw()
    const DEGREE = { kindled: 1.0, warm: 0.4 }

    // The world cell's registrant (id:cmp-query-cell) — this surface owns the
    // turtle, the page law, and the scheduler reach, so its faces are the
    // contract. Every face reads the owner's CURRENT bodies at ask time —
    // the scheduler dies and is reborn; capture the owner, ask for the body.
    const unregisterWorld = registerWorld({
        // A buffer's whole truth: parse errors off its standing tree (a page's
        // tree on the page record, a plain tab's in the parse memo — the two
        // lifecycles the { text, ast } pair rides) ⊕ its frames' standing
        // walk ailments, filtered by address so a sibling tab never leaks ink.
        diagnostics: (key) => diagnostics(
            law.program(key) ?? turtle.programFor(key) ?? [],
            ailmentsFor(turtle.scheduler?.errors, key)),
        vitals: (name) => frameVitals(turtle.scheduler, name),
        family: (pattern) => livingFamily(turtle.scheduler, pattern),
    })

    // Perform a transition's consequences, in order, in the turtle's own
    // verbs. A seat is a run — the law already guarantees it never re-runs
    // what burns. Returns the result of the effect marked main (the draw
    // the nerve reports on).
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
                const result = renderCommand(e.addr, e.name, e.code)
                if (e.main) main = result
                break
            }
            case 'remove':
                turtle.removeAmbient(e.key)
                break
            case 'clearLocal':
                for (const key of [...turtle._localKeys]) turtle.removeAmbient(key)
                break
            case 'kindle':
                turtle.focusAmbient(e.key)
                break
            case 'focus': {
                // world = release: the light returns to her current tab.
                const name = e.world ? term.currentBufferName() : e.name
                if (name) focusOuter(name, !!e.world)
                break
            }
            case 'degree': {
                const focused = e.unlessFocused && turtle.compositor?.focusedName === e.name
                turtle.setAmbientOpacity(e.name, focused ? DEGREE.kindled : DEGREE[e.degree])
                break
            }
            case 'reach':
                innerReach.reset(e.index)
                break
            }
        }
        if (effects.length) turtle.requestRender()
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

    const debouncedRender = temporal.debounce(({ id, name, content }) => {
        nerveInstance?.run()
        // A literate tab (``` cells in a meadow) walks as a PAGE — the same
        // reach law the outershell drives, shared organ and shared ladder;
        // anything else draws whole, as ever, exclusive across kinds.
        const result = perform(law.edit(id, name, content))
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

    term.bridge.sub(debouncedRender);

    const debouncedHatch = temporal.debounce(
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
            debouncedHatch(payload);
            break;
        }
    });
    term.inner();
    // Expose CM6 view on the textarea so nerve hook can scrollToLine.
    // Expose the terminal so the outer review surface can read your
    // fork content along a lineage (forkContent) to seed a draft.
    wireRegistry(hook.el, term, cm6);

    // The reach on HER editor — the same organ the outershell mounts
    // (editor/reach.js), publishing through the same scene.cell seam into
    // the same page law: one behaviour, both shells.
    const innerReach = mountReach(term.shell, {
        gate: () => law.hasPage(term.currentBufferId()),
        publish: (idx) => scene.cell(term.currentBufferId(), idx),
    })

    // The lint ink asks; nothing is pushed into the editor but the breath
    // (id:cmp-first-surface). Thunks, not bodies: the current view, the
    // current buffer's key, each ask.
    const unmountInk = mountDiagnosticsInk(cm6, {
        view: () => term.shell,
        key: () => term.currentBufferId(),
    })

    // The one focus move both surfaces read (gw-appearance law 1): dim the
    // previously bright ambient and the local tabs, light the target.
    const focusOuter = (targetName, isWorld = false) => {
        const prev = turtle.compositor?.focusedName
        // Dim previous single ambient (covers outer→outer transitions)
        if (prev && prev !== targetName) {
            turtle.setAmbientOpacity(prev, DEGREE.warm)
        }

        // Core shell group: all active local tabs share focus.
        // Dim them when focusing outer, restore when returning to 'world'.
        const localOpacity = isWorld ? DEGREE.kindled : DEGREE.warm
        for (const key of turtle._localKeys) {
            const info = term.getBufferInfo(key)
            if (info) turtle.setAmbientOpacity(info.name, localOpacity)
        }

        turtle.focusAmbient(targetName)
        turtle.setAmbientOpacity(targetName, DEGREE.kindled)
        turtle.requestRender()
    }

    // Scene moves from the outer surface — the consumer-side dual of the
    // scene constructors (bridged.js): the same vocabulary, one handler per
    // named move; the law decides, perform() executes.
    const sceneUnsub = scene.sub({
        focus: ({ ambientId }) => {
            // 'world' = sentinel: outer shell releasing focus → restore core tab
            const isWorld = ambientId === 'world'
            const targetName = isWorld ? term.currentBufferName() : ambientId
            if (targetName) focusOuter(targetName, isWorld)
        },
        // Shoot 1 on the canvas: one ladder step — the reached cell mounts
        // and RUNS (lazy); the law says what warms and what leaves.
        cell: ({ addr, index }) => perform(law.reach(addr, index)),
        remove: ({ ambientId }) => {
            // The law forgets the addr whole — cells, ambient, slot ledger —
            // so a later re-watch of the same friend starts clean.
            perform(law.forget(ambientId))
            const activeName = term.currentBufferName()
            if (activeName) {
                turtle.focusAmbient(activeName)
                turtle.setAmbientOpacity(activeName, DEGREE.kindled)
            }
            turtle.requestRender()
            term.clearMerge()
        },
        fork: (payload) => {
            term.forkBuffer(payload)
            term.shell?.focus()
        },
        // A live draft from the outer review surface — the reviewer's
        // intervention owns this addr's slot while it runs.
        ambient: ({ addr, name, code }) => perform(law.draftSeat(addr, name, code)),
        // Draft frozen/ended — the slot reverts to the friend's code.
        ambientStop: ({ addr }) => perform(law.draftStop(addr)),
    });

    // Remote code rendering: inner shell handles seeOuterShell directly.
    // The friend's stream records into the slot ledger always; the law
    // decides whether the canvas changes (a running draft owns the slot;
    // a ~/ addr mounts as a page, first cell showing, siblings lazy).
    const onSeeOuterShell = (payload) => {
        if (!payload?.addr) return
        if (payload.state !== "success" || !payload.commands) return
        const name = payload.origin_name || payload.addr
        const { effects, code, merge } = law.friendPush(payload.addr, name, payload.commands)
        perform(effects)
        if (merge && payload.buffer_id) {
            term.updateMergeOriginal(code, payload.addr, payload.buffer_id)
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
                const { effects, paged } = law.toggle(event.target, info.name, info.content)
                perform(effects)
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
                perform(law.forget(targetId))
                const activeName = term.currentBufferName();
                if (activeName) turtle.focusAmbient(activeName);
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
            innerReach.cleanup,
            unmountInk,
            unregisterWorld,
            unregisterStage,
            () => hook._profilerDetach?.(),
            sceneUnsub,
        ],
    };
}
