// =============================================================================
// OUTER SHELL — the read-only code-review surface (data-target="outer").
// A claimant projection over the ONE shared nerve + a draft/fork surface.
// Interactive moves (focus, remove, fork, live ambient) travel WHOLE as named
// scene adapters (bridged.js) — this surface never reconstructs a payload shape.
// Built over the shared core: bootShell hands it { term, cm6 }; wireRegistry
// writes the DOM registry once.
// =============================================================================

import { scene } from "../../bridged.js"
import { temporal } from "../../utils/temporal.js"
import { printAST } from "../../turtling/parse.js"
import { mountReach } from "../../editor/reach.js"
import { publishDiagnostics } from "../../editor/diagnostics.js"
import { nerveInstance } from "../nerve.js"
import { signals as S } from "../../nerve/store.js"
import { listeners, wireRegistry } from "./core.js"

// The surface as data: the lifecycle machine registers these event names
// synchronously at mounted() — the initial seeOuterShell/outerSignal ride the
// SAME reply that mounts this panel (shell_live.ex "seeTurtle") and would be
// lost to any listener added after the first await. mount() returns the
// matching handlers once the substrate stands.
export const outer = {
    events: ["seeOuterShell", "outerSignal", "outerLive"],
    mount: mountOuter,
};

function mountOuter(hook, { term, cm6 }) {
    // Outer shell: read-only code viewer + bridge publisher.
    // Rendering is handled by the inner shell via seeOuterShell.
    // Interactive events (focus, remove, fork) go through scene bridge.
    let outerAddr = null;
    let outerName = null;
    let outerBufferId = null;
    let prevAddr = null;
    let prevName = null;

    term.outer();
    wireRegistry(hook.el, term, cm6);
    const envEl = hook.el.closest('#outerenv');

    // A claimant projection over the ONE shared nerve: while open, this
    // panel claims the watched friend's address (their name), so their
    // signals — ambient shouts AND server status — route here instead of
    // the local corner. Navigation targets the outer editor. The friend's
    // ambient shouts arrive via the core turtle's _onShout (source = their
    // name); no separate relay channel. retarget() follows disciple swaps.
    const remoteNerveEl = document.getElementById('outer-nerve');
    const outerProj = remoteNerveEl && nerveInstance
        ? nerveInstance.project(remoteNerveEl, {
            pushEvent: (e, p) => hook.pushEvent(e, p),
            targets: { editorView: () => hook.el.__cm },
        })
        : null;

    // While drafting, a body flag tells the core shell's global
    // "type-anywhere-to-focus" capture to stand down — so typing here
    // can never jump focus to the core editor, even if a re-render or
    // the merge view's async DOM briefly blurs us.
    // Live = your draft is running on the canvas (you've intervened);
    // frozen = you're only editing text against a snapshot.
    let draftLive = false;

    // Run the current draft as the friend's ambient on the canvas, so an
    // intervention on broken code actually executes. Their code keeps
    // streaming into the merge baseline (the diff reference) separately.
    const runDraft = () => {
        if (!outerAddr) return;
        scene.ambient(outerAddr, outerName || 'friend', term.getValue());
    };
    const stopDraftRun = () => {
        if (outerAddr) scene.ambientStop(outerAddr);
    };

    const enterDraft = () => {
        // The friend's diagnostics are not the child's — the ink clears as the
        // draft opens, and returns on the next watch push.
        publishDiagnostics(cm6, term.shell, []);
        term.beginDraft({ addr: outerAddr, buffer_id: outerBufferId });
        if (envEl) envEl.dataset.outerState = 'draft';   // yellow wash (terminal-owned transition)
    };
    const leaveDraft = () => {
        stopDraftRun();
        draftLive = false;
        term.endDraft();
        if (envEl) envEl.dataset.outerState = 'ok';      // next seeOuterShell re-colors
    };

    // Type-to-draft: the first edit-intent keystroke turns the read-only
    // review surface editable. CAPTURE phase is essential — we flip
    // read-only off *before* CM6's own keydown/input handlers run, so
    // CM6 then applies this very keystroke natively (char, newline, tab,
    // delete — all of it). No preventDefault, no lossy manual replay.
    // Self-guards via term.drafting(): once drafting, CM6 owns the keys.
    const onDraftKey = (e) => {
        if (term.drafting()) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!(e.key.length === 1 || ['Enter', 'Backspace', 'Delete', 'Tab'].includes(e.key))) return;
        if (!outerAddr) return;

        enterDraft();
        hook.pushEvent("outerDraft", {});
    };
    term.shell.dom.addEventListener('keydown', onDraftKey, true);

    // The shared reach organ (editor/reach.js, the cell shape rule
    // id:gw-cell). It publishes while DRAFTING too: a draft is the child's own
    // page under the same law, so the ladder must walk under his cursor here
    // exactly as on his own tab.
    const reach = mountReach(term.shell, {
        gate: () => !!outerAddr,
        publish: (line) => scene.attend(outerAddr, line),
    });

    // Where the ladder landed, back to THIS organ — spoken only when that is
    // not where it pointed (a fresh page; a shorter split clamped the place).
    const reachUnsub = scene.sub({
        landed: ({ addr, line }) => { if (addr === outerAddr) reach.reset(line) },
    });

    // Go live → run the draft; go frozen → stop running (revert to their code).
    const onOuterLive = ({ live }) => {
        draftLive = !!live;
        if (draftLive) runDraft();
        else stopDraftRun();
    };

    // Re-run the draft as you edit it, but only while live.
    const runDraftPaced = temporal.pace(runDraft, 60);
    const draftEditUnsub = term.bridge.sub(() => {
        if (term.drafting() && draftLive) runDraftPaced();
    });

    // A RUNTIME diagnostic breaks at its CELL, not across the page. `state` no
    // longer reddens the whole panel when one cell of their page dies (that
    // would be the cascade, and it would falsely offer "recall last good"); the
    // death arrives addressed, so the nerve names the cell that died and the
    // healthy siblings keep their light. Spoken once per diagnostic: a friend hatches
    // on every keystroke, and a standing diagnostic is one fact, not a drumbeat.
    let spoken = new Set();
    // Where a diagnostic lives, in the author's own outline: the phase whose sisters
    // it stands among, then its line. The breadcrumb is derived from the diagnostic's
    // LINE — attention is the address (D021) — so it names a phase truly,
    // including one that owns no cell yet, where a `#cellN` ordinal could only
    // ever count fences.
    const placeOf = (w) => [
        (w.phase ?? []).join(" › ") || null,
        w.span?.line ? `line ${w.span.line}` : null,
    ].filter(Boolean).join(" · ");
    const speakDiagnostics = (found) => {
        const live = new Set();
        for (const w of found ?? []) {
            if (w.kind !== "walk" && w.kind !== "rehearsal") continue;   // parse wounds are ink, not shouts
            const at = `${w.kind}:${w.address ?? "?"}:${w.message}:${w.span?.line ?? "?"}`;
            live.add(at);
            if (spoken.has(at)) continue;
            const place = placeOf(w);
            nerveInstance?.push(S.remote(outerName || "friend",
                place ? `${place} — ${w.message}` : w.message, null, "error"));
        }
        spoken = live;   // a healed wound may speak again if it returns
    };

    const onSeeOuterShell = (payload) => {
        // Disciple switch: drop stale draft + ambient. Remove by the addr
        // the ambient was REGISTERED under (upsertAmbient keys on addr) —
        // passing the display name relied on a deleted name-scan fallback
        // and silently skipped the draft bookkeeping cleanup (which is
        // keyed by addr) in the inner shell's remove handler.
        if (payload?.addr && payload.addr !== prevAddr) {
            if (prevAddr) scene.remove(prevAddr);
            if (term.drafting()) leaveDraft();
            prevAddr = payload.addr;
            spoken.clear();  // another's wounds are not this one's
            reach.reset();   // a fresh page opens at its first cell, already lit
        }

        if (payload?.addr) outerAddr = payload.addr;
        if (payload?.origin_name) outerName = payload.origin_name;

        if (outerName && outerName !== prevName) {
            scene.focus(outerName);
            outerProj?.retarget(outerName);   // claim this friend's signals
            prevName = outerName;
        }
        if (payload?.buffer_id) outerBufferId = payload.buffer_id;

        const view = payload?.view ?? 'watch';
        const errored = payload?.state === 'error';
        // The tree is the source, in EVERY state (D022): it always builds and
        // holds the friend's broken line verbatim (D020), so an errored
        // friend's page still reads as a page. The string is the honest
        // degrade for a peer that sent no tree, never the error path's default.
        const source = payload?.commands?.length
            ? printAST(payload.commands)
            : (payload?.source ?? '');

        if (view === 'draft') {
            // Live baseline: stream the friend's code into the merge original.
            if (payload?.stream) term.streamOrigin(source);
        } else {
            term.changeouter(source);
        }

        // The diagnostics, span-true, wherever they nest — a parse error inside the
        // third cell of the friend's page inks the third cell's line here.
        // Republished whole each push, LSP-style: an empty answer clears the
        // ink. The outer surface's truth arrives on the wire, not from the
        // local world cell. Withheld while drafting: the visible doc is then
        // the CHILD'S draft, and the friend's line 12 is not his line 12 — no
        // true place, no ink.
        if (!term.drafting()) publishDiagnostics(cm6, term.shell, payload?.diagnostics ?? []);
        speakDiagnostics(payload?.diagnostics);

        if (envEl) {
            envEl.dataset.outerState = view === 'draft' ? 'draft' : (errored ? 'error' : 'ok');
        }
    };

    // Friend's execution status → the remote nerve below their code.
    // A separate event from seeOuterShell so it flows even in a frozen
    // draft, where the editor push is withheld.
    const onOuterSignal = ({ state, message, name }) => {
        const who = name || 'friend';
        if (state === 'success') {
            nerveInstance?.push(S.remote(who, '☀︎', null, 'output'));
        } else if (state === 'error' && message) {
            nerveInstance?.push(S.remote(who, 'error', message, 'error'));
        }
    };

    // Keep-as-fork: deliberate promotion of the draft into a coreshell
    // tab (delegated — #outer-fork mounts/unmounts with the draft view).
    const outerEl = hook.el.closest('.outershell') || hook.el;
    const onDelegatedClick = (e) => {
        if (!e.target.closest('#outer-fork')) return;
        const source = term.getValue();
        if (!source || !outerAddr) return;
        scene.fork({
            source,
            name: outerName || 'friend',
            addr: outerAddr,
            buffer_id: outerBufferId,
            time: Date.now(),
            offset: term.shell?.state?.selection?.main?.head ?? 0,
        });
    };
    outerEl.addEventListener('click', onDelegatedClick);

    // Focus switching via scene bridge
    const activateOuter = () => {
        if (outerName) scene.focus(outerName);
    };

    const restoreInner = () => {
        scene.focus('world');
    };

    const onOuterClick = () => activateOuter();
    const onGlobalFocus = (e) => {
        if (!outerEl.contains(e.target)) restoreInner();
    };

    outerEl.addEventListener('mousedown', onOuterClick);
    document.addEventListener('focusin', onGlobalFocus);

    return {
        events: {
            seeOuterShell: onSeeOuterShell,
            outerSignal: onOuterSignal,
            outerLive: onOuterLive,
        },
        cleanup: [
            listeners.theme(theme => term.setOption('theme', theme)).mount(),
            // Authoritative teardown: drop this addr from the canvas entirely.
            // NOT stopDraftRun() — ambientStop *reverts* to the friend's code
            // (panel stays open); on close we want the slot gone. Firing it
            // here re-added the ambient milliseconds after removing it.
            () => { if (outerAddr) scene.remove(outerAddr); },
            () => term.shell?.dom.removeEventListener('keydown', onDraftKey, true),
            reach.cleanup,
            reachUnsub,
            draftEditUnsub,
            () => outerProj?.destroy(),
            () => outerEl.removeEventListener('click', onDelegatedClick),
            () => { outerEl.removeEventListener('mousedown', onOuterClick);
                    document.removeEventListener('focusin', onGlobalFocus); },
        ],
    };
}
