// Outershell — friend's read-only surface (data-target="outershell"). Peer to coreshell.
// Claimant nerve projection + draft/fork. Adapters whole via bridged.js.

import { scene } from "../../bridged.js"
import { temporal } from "../../utils/temporal.js"
import { printAST } from "../../turtling/parse.js"
import { mountReach } from "../../editor/reach.js"
import { setPeerCell } from "../../editor/code-cell-activation.js"
import { follow, haltFollow, mountChase } from "../../editor/peer-attention.js"
import { openWatch, step } from "../../editor/watch-law.js"
import { mountDiagnosticsInk } from "../../editor/diagnostics.js"
import { verdict } from "../../weave/queries.js"
import { seatHealth } from "../../weave/seat-health.js"
import { readWounds } from "../../weave/wounds.js"
import { world, watchWorld } from "../../weave/world.js"
import { OUTERSHELL } from "../../weave/page.js"
import { mountSun } from "../../nerve/sun.js"
import { nerve, nerveSeat } from "../nerve.js"
import { listeners } from "./core.js"
import { register } from "./term-cell.js"
import { createArena } from "../../kernel/arena.js"
import { attach } from "../../kernel/attach.js"

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
    // Who owns the light, where the peer stands, what the caret owes — one value,
    // decided by editor/watch-law.js. This surface only performs its answers.
    let watch = openWatch();

    term.outer();
    arena.add(register("outershell", term));
    const envEl = hook.el.closest('#outerenv');

    // THIS SHELL'S OWN SUN — read through the world cell; this surface owns no
    // scheduler. BODY, NOT BREATH: a push pulls health() synchronously, so a
    // tick before organs stand reads health in its dead zone. Wire at BIRTH.
    const sun = mountSun({
        read: () => world()?.progress?.(OUTERSHELL) ?? {},
        place: OUTERSHELL,
        nerve,
    });
    arena.add(sun.release);

    // Claim friend's address on the shared nerve. Health is seat base (pulled),
    // not a signal. The claim lives exactly as long as THIS nerve is seated —
    // panel mounts before #nerve-hud; a reseating must re-project rather than
    // keep a dead claim (kernel/attach.js). health() deferred: seat asks only
    // on refresh() (silent construct).
    const remoteNerveEl = document.getElementById('outer-nerve');
    let outerProj = null;
    arena.add(attach(nerveSeat, (seated) => {
        if (!remoteNerveEl) return;
        outerProj = seated.project(remoteNerveEl, {
            pushEvent: (e, p) => hook.pushEvent(e, p),
            targets: { editorView: () => term.shell },
            health: () => health(),
            // A sun names no peer — route by place, not address.
            place: OUTERSHELL,
        });
        if (outerName) outerProj.retarget(outerName);
        return () => { outerProj?.destroy(); outerProj = null };
    }));

    // While drafting, a body flag tells coreshell's type-anywhere-to-focus
    // capture to stand down — typing here must not jump to the core editor
    // even if a re-render or merge view's async DOM briefly blurs us.
    // Live = draft running on the canvas (intervened); frozen = text only.
    let draftLive = false;

    // Wire's last diagnostics list (by ref — ink diffs by identity). Never re-parsed.
    let wireWounds = [];

    // Whose runtime? One ask for ink, voice, wash (id:cmp-query-cell).
    // watching → wire; draft-live → world cell; draft-frozen → quiet.
    // NONE is one array so quiet stays quiet by identity.
    const NONE = [];
    // Draft's figure stands at outershell — ask for THAT place, or the answer
    // is the coreshell sister's faults on the same document (Cut 1).
    const shownWounds = () =>
        !term.drafting() ? wireWounds
        : draftLive ? (world()?.diagnostics?.(outerAddr, OUTERSHELL) ?? NONE)
        : NONE;

    const wounds = readWounds({ ask: shownWounds });
    arena.add(wounds.release);

    arena.add(mountDiagnosticsInk(cm6, { view: () => term.shell, wounds }));

    // Seat base — SAME organ coreshell mounts (weave/seat-health.js): friend's
    // wounds, friend's subject (R1). Frozen draft mutes it: nothing of ours
    // has run, so there is no runtime to speak of (R6).
    const health = seatHealth({
        wounds: wounds.read,
        subject: () => outerAddr,
        mute: () => term.drafting() && !draftLive,
    });
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

    // Readers subscribe; they are not called. A fourth projection is one more
    // watch, not another site to find on every surface.
    arena.add(wounds.watch(speak));
    arena.add(wounds.watch(paint));

    // News the world cell never hears — friend's push, draft going live.
    // reask() reaches EVERY reader; a per-organ refresh reached one.
    const reask = () => wounds.changed();

    // Run the draft as observe(own:true) so intervention on broken code
    // actually executes. Their code keeps streaming into the merge baseline
    // separately.
    //
    // Seed seating ledger from THIS caret before the page seats: reach at
    // 80 ms, draft edit at 60 ms — without this, canvas can still run cell 1
    // while the outer light already sits in cell 2.
    const runDraft = () => {
        if (!outerAddr) return;
        if (term.shell && !term.shell.destroyed) {
            try {
                const line = term.shell.state.doc.lineAt(
                    term.shell.state.selection.main.head,
                ).number;
                scene.attend(outerAddr, line);
            } catch { /* mid-teardown — observe still seats with whatever stands */ }
        }
        scene.observe(outerAddr, outerName || 'friend', term.getValue());
    };
    const stopDraftRun = () => {
        // Drop outershell draft; re-seat peer from frozen text — coreshell
        // sister must stay (dim), not vanish with the draft.
        if (!outerAddr) return;
        scene.restore(outerAddr, {
            name: outerName || "friend",
            code: term.getValue(),
        });
    };

    // Crossing runtimes: ledger and ink both re-arm — a wound from the wire
    // must not silence the identical wound from our own run, nor the reverse.
    const changedHands = () => reask();   // key carries the subject; re-arms itself

    const enterDraft = () => {
        // ONE door every draft entry passes through — caret given back HERE,
        // not in the keydown.
        walk({ kind: 'draftEnter' });
        term.beginDraft({ addr: outerAddr, buffer_id: outerBufferId });
        changedHands();   // friend's diagnostics are not the child's
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

    // ── Follow: peer line ↔ hand ──────────────────────────────────────────
    // Law is editor/watch-law.js; this is only wiring. Wheel never intervenes.
    // Reach shut while following (no eyeline first-light).

    // THE THREE READINGS the law needs and never takes for itself.
    const caretLine = () => {
        if (!term.shell || term.shell.destroyed) return null;
        try {
            return term.shell.state.doc.lineAt(term.shell.state.selection.main.head).number;
        } catch { return null; }
    };
    const caretHead = () =>
        (term.shell && !term.shell.destroyed) ? term.shell.state.selection.main.head : null;
    const docLines = () => term.shell?.state?.doc?.lines ?? 0;

    const claimAt = (line) => {
        if (outerAddr && line != null) scene.attend(outerAddr, line);
    };
    const isFirefly = (e) => !!e?.target?.closest?.('.cm-peer-firefly');

    const reach = mountReach(term.shell, {
        gate: () => !!outerAddr && !watch.following,
        publish: (line) => claimAt(line),
    });
    arena.add(reach.cleanup);

    const chase = mountChase(term.shell, {
        initials: () => outerName,
        onResume: (line) => walk({ kind: 'resume', line, head: caretHead() }),
    });
    arena.add(chase.cleanup);

    // ONE DOOR: law decides, this performs, in the order the law names.
    const walk = (event) => {
        const ans = step(watch, event);
        watch = ans.state;
        const view = term.shell;
        if ('caret' in ans && view && !view.destroyed) {
            const { doc } = view.state;
            view.dispatch({ selection: { anchor: Math.min(ans.caret, doc.length) } });
        }
        if (ans.halt) haltFollow(view);
        if (ans.stir) chase.stir();
        if ('mark' in ans) setPeerCell(view, ans.mark);
        if ('chase' in ans) chase.update(ans.chase);
        if ('claim' in ans) claimAt(ans.claim);
        if ('viewport' in ans) follow(view, ans.viewport, { quiet: reach.pause });
    };

    // Peer line from hatch meta or body+attend.
    const onPeerLine = (line) =>
        walk({ kind: 'peerLine', line, docLines: docLines(), head: caretHead() });

    const inputEl = envEl ?? term.shell.scrollDOM;
    for (const kind of ['mousedown', 'keydown']) {
        arena.on(inputEl, kind, (e) => {
            if (isFirefly(e)) return;
            walk({ kind: 'hand', spendCaret: e?.type === 'mousedown', caret: caretLine() });
        }, { passive: true });
    }

    // Re-assert place light: their line while following, caret after intervene.
    const reassertLight = (e) => {
        if (isFirefly(e)) return;
        walk({ kind: 'reassert', caret: caretLine() });
    };
    const outerEl = hook.el.closest('.outershell') || hook.el;
    arena.on(outerEl, 'mousedown', reassertLight);
    arena.on(document, 'focusin', (e) => {
        if (outerEl.contains(e.target)) reassertLight(e);
    });

    arena.add(scene.sub({
        landed: ({ addr, line }) => { if (addr === outerAddr) reach.reset(line) },
    }));

    // ── Draft live / hatch body ───────────────────────────────────────────

    const onOuterLive = ({ live }) => {
        draftLive = !!live;
        if (draftLive) runDraft();
        else stopDraftRun();
        changedHands();
    };

    const runDraftPaced = temporal.pace(runDraft, 60);
    arena.add(term.bridge.sub(() => {
        if (term.drafting() && draftLive) runDraftPaced();
    }));

    // Line-only carrier (~40 bytes) — reader who moves without typing.
    const onOuterAttend = ({ addr, attend }) => {
        if (!outerAddr || addr !== outerAddr) return;
        if (term.drafting()) return;
        onPeerLine(attend?.line ?? null);
    };

    const onSeeOuterShell = (payload) => {
        // New friend: re-arm follow. Drop previous addr's canvas seat + draft.
        // outerAddr IS the previous until the line below moves it — a second
        // variable for that was one fact kept in two places.
        const opening = !!payload?.addr && payload.addr !== outerAddr;
        if (opening) {
            if (outerAddr) scene.remove(outerAddr);
            if (term.drafting()) leaveDraft();
            wireWounds = NONE;
            reach.reset();
            walk({ kind: 'open' });
        }

        if (payload?.addr) outerAddr = payload.addr;
        // The name we last retargeted with IS outerName, so the change shows here.
        if (payload?.origin_name && payload.origin_name !== outerName) {
            outerName = payload.origin_name;
            outerProj?.retarget(outerName);
        }
        if (payload?.buffer_id) outerBufferId = payload.buffer_id;

        const view = payload?.view ?? 'watch';
        // Tree is source in every state (D022); string is the no-tree degrade.
        const source = payload?.commands?.length
            ? printAST(payload.commands)
            : (payload?.source ?? '');
        const attendLine = payload?.attend?.line ?? null;

        if (view === 'draft') {
            if (payload?.stream) term.streamOrigin(source);
            walk({ kind: 'draftView' });
        } else {
            // Body first (viewport needs the doc), then line — onPeerLine claims
            // only while following. First canvas seat with their line is inner's job.
            term.changeouter(source);
            onPeerLine(attendLine);
        }

        wireWounds = payload?.diagnostics ?? NONE;
        reask();
    };

    // Keep-as-fork → coreshell tab.
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
    arena.add(listeners.theme(theme => term.setOption('theme', theme)).mount());

    // Authoritative teardown: drop this addr from the canvas entirely. NOT
    // stopDraftRun() — restore *reverts* to the friend's code (panel stays
    // open); on close the slot must go. Registered last so it releases before
    // every organ: canvas learns the panel is gone before the panel comes apart.
    arena.add(() => { if (outerAddr) scene.remove(outerAddr); });

    return {
        // BIRTH — every organ stands, so now the surface may speak. Anything
        // that can TICK is wired only here: a push pulls health() synchronously,
        // so a tick before organs stand reads health in its dead zone.
        birth() {
            arena.add(watchWorld(sun.tick));
            // One breath reaches every reader (seat, wash, ink) at once. Seat
            // is built silent; this is the ask that seats a friend already mid-fault.
            reask();
            sun.tick();     // first light, for a panel opening onto running work
        },

        events: {
            seeOuterShell: onSeeOuterShell,
            outerAttend: onOuterAttend,
            outerLive: onOuterLive,
        },
        arena,
    };
}
