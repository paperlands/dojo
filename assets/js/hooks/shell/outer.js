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
import { setPeerCell } from "../../editor/code-cell-activation.js"
import { follow, haltFollow, mountChase } from "../../editor/peer-attention.js"
import { mountDiagnosticsInk } from "../../editor/diagnostics.js"
import { sayWound } from "../../weave/wound-view.js"
import { sayOnce } from "../../weave/voice.js"
import { announcements } from "../../weave/queries.js"
import { world, watchWorld } from "../../weave/world.js"
import { nerveInstance } from "../nerve.js"
import { signals as S } from "../../nerve/store.js"
import { listeners, wireRegistry } from "./core.js"
import { createArena } from "../../kernel/arena.js"

// The surface as data: the lifecycle machine registers these event names
// synchronously at mounted() — the initial seeOuterShell/outerSignal ride the
// SAME reply that mounts this panel (shell_live.ex "seeTurtle") and would be
// lost to any listener added after the first await. mount() returns the
// matching handlers once the substrate stands.
export const outer = {
    events: ["seeOuterShell", "outerAttend", "outerSignal", "outerLive"],
    mount: mountOuter,
};

function mountOuter(hook, { term, cm6 }) {
    // Outer shell: read-only code viewer + bridge publisher.
    // Rendering is handled by the inner shell via seeOuterShell.
    // Interactive events (focus, remove, fork) go through scene bridge.
    // One arena owns every long-lived listener on this surface.
    const arena = createArena();
    let outerAddr = null;
    let outerName = null;
    let outerBufferId = null;
    let prevAddr = null;
    let prevName = null;
    // WATCHER-LOCAL CONSENT (D023, D025 R7) — not a presence primitive and not a
    // second address. It selects WHOSE attention drives this view: the friend's
    // while true, the watcher's own the moment they move. Read in exactly one
    // place; a friend's page opens it, own input ends it, the firefly gives it back.
    let following = true;
    // The friend's last known line, so a push carrying only their typing is not
    // mistaken for them moving.
    let peerAt = null;
    // WHERE THE WATCHER WAS. The caret following writes is a display artifact —
    // it is how the friend's cell lights by the cursor law — but the INSERTION
    // POINT is wherever the watcher last put it. Stashed before the first follow
    // of a run, spent when a draft opens.
    let ownCaret = null;

    term.outer();
    arena.add(wireRegistry(hook.el, term, cm6, "outer"));
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
            targets: { editorView: () => term.shell },
        })
        : null;
    arena.add(() => outerProj?.destroy());

    // While drafting, a body flag tells the core shell's global
    // "type-anywhere-to-focus" capture to stand down — so typing here
    // can never jump focus to the core editor, even if a re-render or
    // the merge view's async DOM briefly blurs us.
    // Live = your draft is running on the canvas (you've intervened);
    // frozen = you're only editing text against a snapshot.
    let draftLive = false;

    // WHAT THE WIRE LAST SAID — the author's runtime, derived, never run here.
    // Held by reference so the ink can tell a repeat from news.
    let wireWounds = [];
    let wireErrored = false;

    // ==== THE ONE FENCE ======================================================
    // A surface speaks and inks whoever's runtime it is SHOWING, and this is the
    // only place that question is answered.
    //
    //   watching       theirs — derived from the author's state on the wire.
    //   drafting live  ours — this very text is what stands at `outerAddr`, so
    //                  the world cell is telling us about our own code.
    //   drafting frozen nothing ran. Their spans point into a document we are no
    //                  longer showing, and ours do not exist yet; a wound with no
    //                  true place is a lie, so this surface says nothing at all.
    //
    // The empty answer is ONE array, not a fresh literal: the ink tells a repeat
    // from news by identity, and a surface that is quiet should stay quiet.
    const NONE = [];
    const shownWounds = () =>
        !term.drafting() ? wireWounds
        : draftLive ? (world()?.diagnostics?.(outerAddr) ?? NONE)
        : NONE;

    // The ink: one writer for this editor, asking the fence each breath.
    const ink = mountDiagnosticsInk(cm6, { view: () => term.shell, ask: shownWounds });
    arena.add(ink);

    // The voice (weave/voice.js): said once while it stands. A friend hatches on
    // every keystroke, and a live draft re-runs as fast as it is typed.
    const hurt = sayOnce();
    const speak = () => hurt.say(announcements(shownWounds()), (w) =>
        nerveInstance?.push(S.remote(outerName || "friend", sayWound(w), null, "error")));

    // The wash, one writer. Drafting says DRAFTING — that is a fact about who
    // owns the text, orthogonal to its health; the wound speaks through the ink
    // and the nerve in either state.
    const paint = () => {
        if (envEl) envEl.dataset.outerState =
            term.drafting() ? 'draft' : (wireErrored ? 'error' : 'ok');
    };

    // The runtime changed under us — a live draft ran, or the child's own page
    // did. Ask again, both readers.
    const reask = () => { ink.refresh(); speak(); };
    arena.add(watchWorld(reask));
    // ========================================================================

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

    // Crossing between runtimes: the ledger and the ink both re-arm, because a
    // wound heard from the wire must not silence the identical wound from our
    // own run — nor the other way.
    const changedHands = () => { hurt.forget(); reask(); paint(); };

    const enterDraft = () => {
        // The watcher's place, given back before a single character lands.
        // Following moved the caret to show the friend's cell; it must not decide
        // where the watcher writes. Here, not in the keydown, because this is the
        // ONE door every draft entry passes through.
        if (ownCaret != null) {
            const { doc } = term.shell.state;
            term.shell.dispatch({ selection: { anchor: Math.min(ownCaret, doc.length) } });
            ownCaret = null;
        }
        term.beginDraft({ addr: outerAddr, buffer_id: outerBufferId });
        changedHands();   // the friend's diagnostics are not the child's
    };
    const leaveDraft = () => {
        stopDraftRun();
        draftLive = false;
        term.endDraft();
        changedHands();   // their last push is true again, at once
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
    arena.on(term.shell.dom, 'keydown', onDraftKey, true);

    // The shared reach organ (editor/reach.js, the cell shape rule
    // id:gw-cell). It publishes while DRAFTING too: a draft is the child's own
    // page under the same law, so the ladder walks under the cursor here exactly
    // as on the child's own tab.
    const reach = mountReach(term.shell, {
        gate: () => !!outerAddr,
        publish: (line) => scene.attend(outerAddr, line),
    });
    arena.add(reach.cleanup);

    // THE WATCHER'S FIRST INPUT ENDS IT (D023, D025 R5) — read off INPUT, never
    // off scroll or off a dispatch. Following writes the caret and the scroll,
    // so a publish or scroll listener fires for our own writing exactly as for
    // theirs: following would end on the very first line it followed. An event's
    // KIND is unambiguous — these four are the watcher's alone.
    //
    // Bound to `#outerenv`, the widest surface that input can land on: the panel
    // holds gestures the editor's box never sees, and the editor's bubble up.
    const endFollowing = (e) => {
        following = false;
        haltFollow(term.shell);   // an owned animation yields to a hand at once
        // A POINTER-DOWN PLACES A CARET; a wheel does not. So a click IS the new
        // insertion point and the stash is spent, while scrolling away leaves the
        // caret where following parked it — the stash still holds the last place
        // actually chosen.
        if (e?.type === 'mousedown') ownCaret = null;
    };
    const OWN_INPUT = ['wheel', 'touchmove', 'mousedown', 'keydown'];
    const inputEl = envEl ?? term.shell.scrollDOM;
    for (const kind of OWN_INPUT) {
        arena.on(inputEl, kind, endFollowing, { passive: true });
    }

    // The chase: the edge the friend was lost past, and the way back.
    const chase = mountChase(term.shell, {
        initials: () => outerName,
        onResume: (line) => {
            // Resuming is arriving — one way to reach a friend's line, so it
            // cannot drift from itself.
            following = true;
            follow(term.shell, line, { quiet: reach.pause });
            if (outerAddr && line != null) scene.attend(outerAddr, line);
        },
    });
    arena.add(chase.cleanup);

    // Where the ladder landed, back to THIS organ — spoken only when that is
    // not where it pointed (a fresh page; a shorter split clamped the place).
    arena.add(scene.sub({
        landed: ({ addr, line }) => { if (addr === outerAddr) reach.reset(line) },
    }));

    // Go live → run the draft; go frozen → stop running (revert to their code).
    // Live is the other half of the fence: frozen, nothing of ours has run, so
    // there is no runtime here to speak of.
    const onOuterLive = ({ live }) => {
        draftLive = !!live;
        if (draftLive) runDraft();
        else stopDraftRun();
        changedHands();
    };

    // Re-run the draft as you edit it, but only while live.
    const runDraftPaced = temporal.pace(runDraft, 60);
    arena.add(term.bridge.sub(() => {
        if (term.drafting() && draftLive) runDraftPaced();
    }));

    // WHERE THE FRIEND IS — the one act, however the line reached us.
    //
    // ONE LAW: only a line the document holds is news. The meta can name a line
    // a breath before the body arrives; refusing that name leaves peerAt behind
    // so the push that brings the body is still a move, and following completes.
    // Committing early made every later same-line push a no-op and froze the view.
    //
    // Same line, already held: re-measure the firefly (doc may have reshaped),
    // do not re-arrive — that is typing, and followTo is already a no-op when
    // centred, but the caret dispatch is not free on every keystroke.
    const applyAttend = (line) => {
        // Life first: a push with the line unchanged is the friend TYPING.
        // The viewport stays; the firefly burns.
        chase.stir();

        if (line != null) {
            const n = term.shell.state.doc.lines;
            if (line < 1 || line > n) return;   // name without body — wait
        }

        if (line === peerAt) {
            chase.update(line);                 // re-measure; no re-arrival
            return;
        }

        peerAt = line;
        setPeerCell(term.shell, line);
        chase.update(line);

        // THE ONE SITE THAT READS `following` (D025 R5). Arriving is ordinary
        // reading: `follow` lands the caret (cursor law); `scene.attend` hands
        // the same line to the page law. The two readers the reach already feeds.
        if (following && line != null) {
            // Kept before we move the caret — the FIRST follow of a run only.
            if (ownCaret == null) ownCaret = term.shell.state.selection.main.head;
            // `quiet` hushes the reach for the flight: it reads scroll.
            follow(term.shell, line, { quiet: reach.pause });
            if (outerAddr) scene.attend(outerAddr, line);
        }
    };

    // The friend's line alone, off the hatch META — no document, no Table fetch,
    // ~40 bytes. How a reader who MOVES and does not type crosses; no time gate,
    // so it arrives at the rate they move.
    const onOuterAttend = ({ addr, attend }) => {
        if (!outerAddr || addr !== outerAddr) return;
        if (term.drafting()) return;   // the visible doc is the draft; their line is not in it
        applyAttend(attend?.line ?? null);
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
            hurt.forget();   // another's wounds are not this one's
            wireWounds = NONE; // nor is another's runtime
            wireErrored = false;
            reach.reset();   // a fresh page opens at its first cell, already lit
            following = true; // and opening a friend's page IS asking to be shown
            peerAt = null;    // another's place is not this one's
            ownCaret = null;  // nor is one's own place in it
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

        // THE PEER'S CELL IS A PROPERTY OF THE DISPLAYED DOCUMENT (D025 R6), so it
        // is set where the document is set — in both branches, never as a
        // condition afterwards. A draft shows the child's own text, and the
        // friend's line 12 is not this document's line 12 (D021's bound).
        const attendLine = payload?.attend?.line ?? null;

        if (view === 'draft') {
            // Live baseline: stream the friend's code into the merge original.
            if (payload?.stream) term.streamOrigin(source);
            peerAt = null;
            setPeerCell(term.shell, null);
            chase.update(null);
        } else {
            term.changeouter(source);
            // ONLY WHEN THE FRIEND ACTUALLY MOVED. A push arrives for every
            // hatch, most of them typing with the line unchanged; following the
            // push instead of the MOVE re-centres the viewport on every
            // keystroke. The document changing is the friend's news; the line
            // changing is this organ's.
            applyAttend(attendLine);
        }

        // The author's runtime, arriving whole each push (LSP-style: an empty
        // answer clears), span-true wherever it nests. HELD, not applied — the
        // fence alone decides whether this surface is showing theirs or ours.
        wireWounds = payload?.diagnostics ?? NONE;
        wireErrored = errored;
        reask();
        paint();
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
    arena.on(outerEl, 'click', onDelegatedClick);

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

    arena.on(outerEl, 'mousedown', onOuterClick);
    arena.on(document, 'focusin', onGlobalFocus);
    arena.add(listeners.theme(theme => term.setOption('theme', theme)).mount());

    // Authoritative teardown: drop this addr from the canvas entirely. NOT
    // stopDraftRun() — ambientStop *reverts* to the friend's code (panel stays
    // open); on close we want the slot gone. Registered last so it releases
    // FIRST: the canvas learns the panel is gone before the panel comes apart.
    arena.add(() => { if (outerAddr) scene.remove(outerAddr); });

    return {
        events: {
            seeOuterShell: onSeeOuterShell,
            outerAttend: onOuterAttend,
            outerSignal: onOuterSignal,
            outerLive: onOuterLive,
        },
        arena,
    };
}
