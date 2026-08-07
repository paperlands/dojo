// Outershell — friend's read-only surface (data-target="outershell"). Peer to coreshell.
// Claimant nerve projection + draft/fork. Adapters whole via bridged.js.

import { scene } from "../../bridged.js"
import { temporal } from "../../utils/temporal.js"
import { printAST } from "../../turtling/parse.js"
import { mountReach } from "../../editor/reach.js"
import { setPeerCell } from "../../editor/code-cell-activation.js"
import { follow, haltFollow, mountChase } from "../../editor/peer-attention.js"
import { mountDiagnosticsInk } from "../../editor/diagnostics.js"
import { sayWound } from "../../weave/wound-view.js"
import { announcements, verdict, primaryWound } from "../../weave/queries.js"
import { readWounds } from "../../weave/wounds.js"
import { world } from "../../weave/world.js"
import { nerve, watchNerve } from "../nerve.js"
import { listeners } from "./core.js"
import { register } from "./term-cell.js"
import { createArena } from "../../kernel/arena.js"

// Events at mounted() — seeOuterShell rides the same reply that mounts this
// panel (shell_live.ex "seeTurtle"); a post-await listener would miss it.
export const outer = {
    events: ["seeOuterShell", "outerAttend", "outerLive"],
    mount: mountOuter,
};

function mountOuter(hook, { term, cm6 }) {
    // Read-only viewer; canvas render is inner via seeOuterShell. Arena owns listeners.
    const arena = createArena();
    let outerAddr = null;
    let outerName = null;
    let outerBufferId = null;
    let prevAddr = null;
    let prevName = null;
    // Whose attention drives this view (D023, D025 R7): friend's while true;
    // own input ends it; firefly returns it. Not a presence primitive.
    let following = true;
    let peerAt = null;    // friend's last line — typing alone is not a move
    // Follow caret is display; insertion point is where the watcher last put it.
    let ownCaret = null;

    term.outer();
    arena.add(register("outershell", term));
    const envEl = hook.el.closest('#outerenv');

    // Claim friend's address on the shared nerve so their signals route here.
    // Health is seat base (pulled), not a signal. Claim when nerve arrives —
    // this panel mounts before #nerve-hud; a one-shot at mount loses the claim.
    // health() is deferred: seat asks only on refresh() (silent construct).
    const remoteNerveEl = document.getElementById('outer-nerve');
    let outerProj = null;
    const claimNerve = () => {
        if (outerProj || !remoteNerveEl) return;
        const seated = nerve();
        if (!seated) return;
        outerProj = seated.project(remoteNerveEl, {
            pushEvent: (e, p) => hook.pushEvent(e, p),
            targets: { editorView: () => term.shell },
            health: () => health(),
        });
        if (outerName) outerProj.retarget(outerName);
    };
    claimNerve();
    arena.add(watchNerve(claimNerve));
    arena.add(() => outerProj?.destroy());

    // While drafting, a body flag tells the core shell's global
    // "type-anywhere-to-focus" capture to stand down — so typing here
    // can never jump focus to the core editor, even if a re-render or
    // the merge view's async DOM briefly blurs us.
    // Live = your draft is running on the canvas (you've intervened);
    // frozen = you're only editing text against a snapshot.
    let draftLive = false;

    // Wire's last diagnostics list (by ref — ink diffs by identity). Never re-parsed.
    let wireWounds = [];

    // Whose runtime? One ask for ink, voice, wash (id:cmp-query-cell).
    // watching → wire; draft-live → world cell; draft-frozen → quiet (no true place).
    // NONE is one array so quiet stays quiet by identity.
    const NONE = [];
    const shownWounds = () =>
        !term.drafting() ? wireWounds
        : draftLive ? (world()?.diagnostics?.(outerAddr) ?? NONE)
        : NONE;

    const wounds = readWounds({ ask: shownWounds });
    arena.add(wounds.release);

    arena.add(mountDiagnosticsInk(cm6, { view: () => term.shell, wounds }));

    // Seat base for this panel — same law as coreshell, friend's wounds (R1).
    const lineRef = (w) => (w?.span?.line ? { line: w.span.line } : null)
    const health = () => {
        if (term.drafting() && !draftLive) return null  // frozen: nothing true to say (R6)
        const found = wounds.read()
        const w = primaryWound(found, outerAddr)
        if (!w) return null
        return {
            msg: "*", payload: sayWound(w),
            ref: lineRef(w), tally: announcements(found).length,
        }
    };
    const speak = () => outerProj?.refresh();

    // Wash from the same wound list. Read the DOM, never a ledger: LiveView
    // mergeAttrs resets data-* on phx-update="ignore" every patch.
    const paint = () => {
        if (!envEl) return
        const word = term.drafting() ? 'draft'
            : verdict(wounds.read(), outerAddr).state === 'error' ? 'error'
            : 'ok'
        if (envEl.dataset.outerState !== word) envEl.dataset.outerState = word
    };

    // Readers subscribe; they are not called. The fourth projection is one more
    // watch, not another site to find on every surface.
    arena.add(wounds.watch(speak));
    arena.add(wounds.watch(paint));

    // News the world cell never hears — a friend's push arriving, a draft going
    // live. reask() reaches EVERY reader, where a per-organ refresh reached one.
    const reask = () => wounds.changed();
    // ========================================================================

    // Run the current draft as the friend's ambient on the canvas, so an
    // intervention on broken code actually executes. Their code keeps
    // streaming into the merge baseline (the diff reference) separately.
    //
    // Seed the seating ledger from THIS caret before the ambient seats: the
    // reach publishes at 80 ms and a draft edit at 60 ms — without this, the
    // canvas can still run cell 1 while the outer light already sits in cell 2.
    const runDraft = () => {
        if (!outerAddr) return;
        if (term.shell && !term.shell.destroyed) {
            try {
                const line = term.shell.state.doc.lineAt(
                    term.shell.state.selection.main.head,
                ).number;
                scene.attend(outerAddr, line);
            } catch { /* mid-teardown — ambient still seats with whatever stands */ }
        }
        scene.ambient(outerAddr, outerName || 'friend', term.getValue());
    };
    const stopDraftRun = () => {
        if (outerAddr) scene.ambientStop(outerAddr);
    };

    // Crossing between runtimes: the ledger and the ink both re-arm, because a
    // wound heard from the wire must not silence the identical wound from our
    // own run — nor the other way.
    const changedHands = () => reask();   // the key carries the subject, so it re-arms itself

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
            wireWounds = NONE; // nor is another's diagnostics answer
            reach.reset();   // a fresh page opens at its first cell, already lit
            following = true; // and opening a friend's page IS asking to be shown
            peerAt = null;    // another's place is not this one's
            ownCaret = null;  // nor is one's own place in it
        }

        if (payload?.addr) outerAddr = payload.addr;
        if (payload?.origin_name) outerName = payload.origin_name;

        if (outerName && outerName !== prevName) {
            // Do NOT scene.focus(outerAddr) here: a page has already dropped
            // the whole-buffer slot, so resolveAddress(addr) is null and the
            // canvas light goes dark on every open. The seating law lights the
            // kindled cell (applyAttend / activateOuter re-attend). Name is
            // only for the nerve claim.
            outerProj?.retarget(outerName);   // claim this friend's signals
            prevName = outerName;
        }
        if (payload?.buffer_id) outerBufferId = payload.buffer_id;

        const view = payload?.view ?? 'watch';
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

        // The author's diagnostics answer, arriving whole each push (LSP-style:
        // an empty answer clears). HELD, not re-derived — the fence alone
        // decides whether this surface is showing theirs or ours. reask() is
        // the breath: every reader re-reads the wounds.
        wireWounds = payload?.diagnostics ?? NONE;
        reask();
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

    // Focus switching via scene bridge. A click re-attends the caret's line so
    // the seating law re-kindles the canvas figure — even when the line is
    // unchanged (double-click select on the already-kindled cell). Focusing by
    // display name alone can dim that figure: a local tab may wear the same
    // name (D006). Never scene.focus(outerAddr) for a page — the whole-buffer
    // slot is gone and resolveAddress(addr) returns null, blanking the light.
    const activateOuter = () => {
        if (outerAddr && term.shell && !term.shell.destroyed) {
            const line = term.shell.state.doc.lineAt(
                term.shell.state.selection.main.head,
            ).number;
            scene.attend(outerAddr, line);
            return;
        }
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

    // BIRTH — every organ stands, so now the surface may speak. One breath
    // reaches every reader (seat, wash, ink) at once; the seat is built silent
    // and this is the ask that seats a friend who is already mid-fault.
    reask();

    return {
        events: {
            seeOuterShell: onSeeOuterShell,
            outerAttend: onOuterAttend,
            outerLive: onOuterLive,
        },
        arena,
    };
}
