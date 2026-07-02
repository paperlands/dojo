// =============================================================================
// INNER SHELL — the canvas surface (data-target="core"): turtle, rendering,
// scene-bridge subscription, buffer/tab wiring. The rich program.
// Named adapters travel WHOLE: signals (S) from nerve/store.js, the scene/
// camera bridges from bridged.js — subscribed and pushed, never reconstructed.
// key-is-address stays loud: every canvas mount keys on the addr through
// turtle.upsertAmbient(addr, …) (gw-t-node-address). Built over the shared
// core: bootShell hands it { term, cm6 }; wireRegistry writes the registry once.
// =============================================================================

import { Turtle } from "../../turtling/turtle.js"
import { cameraBridge, sceneBridge } from "../../bridged.js"
import { temporal } from "../../utils/temporal.js"
import { printAST } from "../../turtling/parse.js"
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

    function parseErrorLine(message) {
        const m = message.match(/at line (\d+)/)
        return m ? parseInt(m[1], 10) : null
    }

    const debouncedRender = temporal.debounce(({ id, name, content }) => {
        nerveInstance?.run()
        const result = renderCommand(id, name, content);
        if (result.success) {
            nerveInstance?.push(S.output("☀︎", result.commandCount))
        } else {
            const line = parseErrorLine(result.error)
            nerveInstance?.push(S.error("error", result.error, line ? { line } : null))
        }
        // Sync tab indicators: draw is exclusive for a tab outside the
        // active group, but a shift+click sister group survives edits
        // and re-selection of its members — mirror whatever stands.
        term.clearAllTabActive()
        for (const key of turtle._localKeys) {
            term.setTabActive(key)
        }
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

    // Draft execution state: addrs whose canvas slot is currently owned
    // by a reviewer's live draft, plus the friend's last code/name per
    // addr (to revert the slot when the draft stops).
    const draftControlled = new Set()
    const lastFriendCode = new Map()
    const friendNames = new Map()

    // Scene bridge: handle focus/remove/fork from outer shell
    const sceneUnsub = sceneBridge.sub(([type, payload]) => {
        switch (type) {
        case 'focus': {
            // 'world' = sentinel: outer shell releasing focus → restore core tab
            const isWorld = payload.ambientId === 'world'
            let targetName = payload.ambientId
            if (isWorld) targetName = term.currentBufferName()
            if (!targetName) break

            const prev = turtle.compositor?.focusedName
            // Dim previous single ambient (covers outer→outer transitions)
            if (prev && prev !== targetName) {
                turtle.setAmbientOpacity(prev, 0.4)
            }

            // Core shell group: all active local tabs share focus.
            // Dim them when focusing outer, restore when returning to 'world'.
            const localOpacity = isWorld ? 1.0 : 0.4
            for (const key of turtle._localKeys) {
                const info = term.getBufferInfo(key)
                if (info) turtle.setAmbientOpacity(info.name, localOpacity)
            }

            turtle.focusAmbient(targetName)
            turtle.setAmbientOpacity(targetName, 1.0)
            turtle.requestRender()
            break
        }
        case 'remove': {
            turtle.removeAmbient(payload.ambientId)
            // Forget this addr's draft bookkeeping — otherwise a later
            // re-watch of the same friend is blocked by a stale
            // draftControlled entry (seeOuterShell early-returns on it),
            // or silently revived by a lingering lastFriendCode.
            draftControlled.delete(payload.ambientId)
            lastFriendCode.delete(payload.ambientId)
            friendNames.delete(payload.ambientId)
            const activeName = term.currentBufferName()
            if (activeName) {
                turtle.focusAmbient(activeName)
                turtle.setAmbientOpacity(activeName, 1.0)
            }
            turtle.requestRender()
            term.clearMerge()
            break
        }
        case 'fork':
            term.forkBuffer(payload)
            term.shell?.focus()
            break
        case 'ambient': {
            // A live draft from the outer review surface — run the
            // reviewer's intervention as this addr's ambient. Mark it
            // controlled so the friend's own updates don't clobber it.
            draftControlled.add(payload.addr)
            turtle.upsertAmbient(payload.addr, payload.name, payload.code)
            turtle.setAmbientOpacity(payload.name, 1.0)
            turtle.requestRender()
            break
        }
        case 'ambientStop': {
            // Draft frozen/ended — hand the slot back to the friend's code.
            draftControlled.delete(payload.addr)
            const code = lastFriendCode.get(payload.addr)
            // Reverting to the friend's code is passive — no hatch.
            if (code != null) turtle.upsertAmbient(payload.addr, friendNames.get(payload.addr) || payload.addr, code, { hatch: false })
            turtle.requestRender()
            break
        }
        }
    });

    // Remote code rendering: inner shell handles seeOuterShell directly.
    // While an addr is draft-controlled, the running draft owns the
    // canvas slot — record the friend's code (for revert) but don't
    // overwrite the intervention with it.
    const onSeeOuterShell = (payload) => {
        if (!payload?.addr) return
        if (payload.state === "success" && payload.commands) {
            const code = printAST(payload.commands)
            const name = payload.origin_name || payload.addr
            lastFriendCode.set(payload.addr, code)
            friendNames.set(payload.addr, name)
            if (draftControlled.has(payload.addr)) return
            // Passive watch: render the friend but never hatch — their
            // drawing must not be reflected to the server as the user's.
            turtle.upsertAmbient(payload.addr, name, code, { hatch: false })
            const isFocused = turtle.compositor?.focusedName === name
            turtle.setAmbientOpacity(name, isFocused ? 1.0 : 0.4)
            if (payload.buffer_id) {
                term.updateMergeOriginal(code, payload.addr, payload.buffer_id)
            }
        }
    };

    const onOpBuffer = (event) => {
        if (event.op === 'activate') {
            // Shift+click: toggle tab's ambient (add if absent, remove if present)
            // On add, all local ambients restart in sync.
            const info = term.getBufferInfo(event.target);
            if (info) {
                turtle.toggleAmbient(event.target, info.name, info.content,
                    (key) => term.getBufferInfo(key));
                term.clearAllTabActive()
                for (const key of turtle._localKeys) {
                    term.setTabActive(key)
                }
            }
            return;
        }
        if (event.op === 'close') {
            const targetId = event.target || term.currentBufferId();
            const hadBuffer = !!term.getBufferInfo(targetId);
            term.opBufferHandler(event);
            if (hadBuffer && !term.getBufferInfo(targetId)) {
                turtle.removeAmbient(targetId);
                const activeName = term.currentBufferName();
                if (activeName) turtle.focusAmbient(activeName);
                term.clearAllTabActive()
                for (const key of turtle._localKeys) {
                    term.setTabActive(key)
                }
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
            () => hook._profilerDetach?.(),
            sceneUnsub,
        ],
    };
}
