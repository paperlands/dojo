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
import { register, putSource } from "./term-cell.js"
import { attach } from "../../kernel/attach.js"
import { safePush } from "../../adapter.js"
import { createOuterRecovery } from "./outer-recovery.js"
import { createSelectionIntent, installSelection, releaseSelection, requestSelection } from "./selection-intent.js"
import { dispatchPhx } from "./outer-shell-payload.js"

// Events at mounted() — seeOuterShell rides the same reply that mounts this
// panel (shell_live.ex "seeTurtle"); a post-await listener would miss it.
export const outer = {
    events: ["seeOuterShell", "outerAttend", "outerLive", "outerClose", "outerIntent", "outerSelect", "syncShell"],
    // Surface-owned state before the first arrival; its arena owns the release.
    acquire(hook) {
        const intent = createSelectionIntent()
        hook.selection = intent
        installSelection(intent)

        // Local close departs HERE, at raw arrival — before the async boot can
        // delay the domain handler behind a later peer click. One helper owns
        // both this departure and every syncShell retry; the receipt is the ack.
        const requestClose = () => {
            const token = intent.supersede(null)
            if (!token) return
            requestSelection(intent, token, () => hook.pushEvent("closeTurtle", {}))
        }
        hook.requestClose = requestClose

        hook.arena.add(() => {
            if (hook.requestClose === requestClose) hook.requestClose = null
            releaseSelection(intent)
            intent.release()
        })
    },
    arrive: (name, payload, hook) => {
        // This hook's controller, never the page-global replacement's.
        const intent = hook.selection

        // The strip's one peer command: a local selector departure at raw
        // arrival, or the same-subject toggle back through the close path.
        if (name === "outerSelect") {
            if (!payload || typeof payload !== "object" || !intent) return false
            if (typeof payload.addr !== "string" || payload.addr === "") return false
            if (intent.current()?.addr === payload.addr) {
                dispatchPhx("outerClose", { local: true })
                return false
            }
            const token = intent.open(payload)
            if (!token) return false
            document.getElementById("outer-open")?.classList.add("is-open")
            requestSelection(intent, token, () => hook.pushEvent("restoreShell", payload),
                (descriptor) => dispatchPhx("outerIntent", descriptor))
            return true
        }

        const fresh = intent?.arrive(name, payload)
        // A local close is a command, not a domain effect: it must leave now.
        // `fresh` is true only for the first ingestion of this exact payload;
        // a duplicate still reads as accepted but never pushes a second close.
        if (name === "outerClose" && fresh === true && payload?.local === true &&
            intent.acceptedClose(payload)) hook.requestClose?.()
    },
    mount: mountOuter,
};

function mountOuter(hook, { term, cm6 }) {
    // Read-only viewer; canvas render is inner via seeOuterShell. Arena owns listeners.
    const arena = hook.arena.child();   // ownership begins at acquisition, not return
    let shownAddr = null;
    // Accepted selection and displayed document differ while waiting.
    // Actions require matching subjects (id:outer-shell-transitions).
    let outerName = null;
    let outerRoot = null;
    let outerBufferId = null;
    // Who owns the light, where the peer stands, what the caret owes — one value,
    // decided by editor/watch-law.js. This surface only performs its answers.
    let watch = openWatch();
    const intent = hook.selection
    // The installed owner is the selected subject; display state may lag it.
    const subject = () => intent.current()?.addr ?? null
    // Recovery metadata: a mirror of the server's selector, never a document.
    // Readiness is a correlated request: a new incarnation supersedes a hung
    // receipt, and only its completion clears the pending local selection.
    const recovery = createOuterRecovery({
        send: (descriptor) => {
            const token = intent.supersede(descriptor.addr)
            requestSelection(intent, token, () => hook.pushEvent("restoreShell", descriptor), recovery.mirror)
        },
    })
    arena.add(recovery.release)

    term.outer();
    arena.add(register("outershell", term));
    const envEl = hook.el.closest('#outerenv');
    const hasSelectedDocument = () => !!shownAddr && subject() === shownAddr;
    const paintSelection = () => {
        const ready = hasSelectedDocument();
        const waiting = !!subject() && !ready;
        if (envEl) envEl.dataset.outerSelection = waiting ? "waiting" : ready ? "ready" : "closed";
        const status = document.getElementById("outer-selection-status");
        if (status) status.hidden = !waiting;
        const fork = document.getElementById("outer-fork");
        if (fork) fork.disabled = !ready;
    };
    paintSelection();

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
            pushEvent: (e, p) => safePush(hook, e, p),
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
    let draftLive = false;
    let outerClaim = null;
    let outerSourceRelease = null;
    arena.add(() => outerSourceRelease?.());

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
        : draftLive ? (world()?.diagnostics?.(shownAddr, OUTERSHELL) ?? NONE)
        : NONE;

    const wounds = readWounds({ ask: shownWounds });
    arena.add(wounds.release);

    arena.add(mountDiagnosticsInk(cm6, { view: () => term.shell, wounds }));

    // Seat base — SAME organ coreshell mounts (weave/seat-health.js): friend's
    // wounds, friend's subject (R1). Frozen draft mutes it: nothing of ours
    // has run, so there is no runtime to speak of (R6).
    const health = seatHealth({
        wounds: wounds.read,
        subject: () => shownAddr,
        mute: () => term.drafting() && !draftLive,
    });
    const speak = () => outerProj?.refresh();

    // Wash from the same wound list. Read the DOM, never a ledger: LiveView
    // mergeAttrs resets data-* on phx-update="ignore" every patch.
    const paint = () => {
        if (!envEl) return
        const word = term.drafting() ? 'draft'
            : verdict(wounds.read(), shownAddr).state === 'error' ? 'error'
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
    const claimOuter = () => {
        if (!shownAddr) return null;
        const claim = {
            place: OUTERSHELL,
            addr: shownAddr,
            name: outerName || "friend",
            text: term.getValue(),
            buffer_id: null,
        };
        outerSourceRelease?.();
        outerSourceRelease = putSource(claim);
        outerClaim = claim;
        scene.claim(claim);
        return claim;
    };
    const runDraft = (claim = outerClaim) => {
        if (!shownAddr) return;
        if (term.shell && !term.shell.destroyed) {
            try {
                const line = term.shell.state.doc.lineAt(
                    term.shell.state.selection.main.head,
                ).number;
                scene.attend(shownAddr, line, { claim });
            } catch { /* mid-teardown — observe still seats with whatever stands */ }
        }
        scene.observe(shownAddr, outerName || 'friend', claim?.text ?? term.getValue(), claim);
    };
    const stopDraftRun = () => {
        // Drop outershell draft; re-seat peer from frozen text — coreshell
        // sister must stay (dim), not vanish with the draft.
        outerSourceRelease?.();
        outerSourceRelease = null;
        outerClaim = null;
        if (!shownAddr) return;
        scene.restore(shownAddr, {
            name: outerName || "friend",
            code: term.getValue(),
        });
    };

    // Crossing runtimes: ledger and ink both re-arm — a wound from the wire
    // must not silence the identical wound from our own run, nor the reverse.
    const changedHands = () => reask();   // key carries the subject; re-arms itself

    const enterDraft = () => {
        // ONE door every draft entry passes through — caret given back HERE,
        // not in the keydown. The local run is authored (D022); server
        // outerLive only confirms live/frozen.
        walk({ kind: 'draftEnter' });
        term.beginDraft({ addr: shownAddr, buffer_id: outerBufferId });
        draftLive = true;
        const claim = claimOuter();
        runDraft(claim);
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
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!(e.key.length === 1 || ['Enter', 'Backspace', 'Delete', 'Tab'].includes(e.key))) return;

        // Only the selected document may be edited (id:outer-shell-transitions).
        if (!hasSelectedDocument()) {
            e.preventDefault();
            return;
        }
        if (term.drafting()) return;
        if (!shownAddr) return;

        enterDraft();
        safePush(hook, "outerDraft", { addr: shownAddr });
    };
    arena.on(term.shell.dom, 'keydown', onDraftKey, true);

    // ── Follow: peer line ↔ hand ──────────────────────────────────────────
    // Law is editor/watch-law.js; this is only wiring. Wheel never intervenes.
    // The reader publishes caret attention only in reader-directed mode.

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
        if (shownAddr && line != null) scene.attend(shownAddr, line);
    };
    const isFirefly = (e) => !!e?.target?.closest?.('.cm-peer-firefly');

    const reach = mountReach(term.shell, {
        gate: () => !!shownAddr && watch.user_attention === "reader",
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

    // Reassert the peer's line or reader's caret, according to user_attention.
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
        landed: ({ addr, line }) => { if (addr === shownAddr) reach.reset(line) },
    }));

    // ── Draft live / hatch body ───────────────────────────────────────────

    const onOuterLive = (payload) => {
        if (!intent.accepted(payload)) return
        const { live } = payload
        const next = !!live;
        if (next === draftLive) return;
        draftLive = next;
        if (draftLive) { claimOuter(); runDraft() }
        else stopDraftRun();
        changedHands();
    };

    // Same quiet law as coreshell — seat after a break, not under the keys.
    const runDraftQuiet = temporal.quiet(() => {
        if (term.drafting() && draftLive) runDraft()
    }, 100)
    arena.add(runDraftQuiet.cancel)
    arena.add(term.bridge.sub(() => {
        if (term.drafting() && draftLive) {
            claimOuter()
            runDraftQuiet()
        }
    }))

    // Line-only carrier (~40 bytes) — reader who moves without typing.
    const onOuterAttend = ({ addr, attend }) => {
        if (!shownAddr || addr !== shownAddr) return;
        if (term.drafting()) return;
        onPeerLine(attend?.line ?? null);
    };

    const onSeeOuterShell = (payload) => {
        if (!intent.accepted(payload)) return
        // A local departure mirrors its selector at once, so readiness during
        // the pending request restores this document, not an older peer.
        if (intent.isLocal(payload)) {
            recovery.mirror({
                addr: payload.addr,
                view: payload.view ?? "watch",
                draft_live: payload.draft_live !== false,
                follow_peer: false,
            })
        }
        document.getElementById("outer-open")?.classList.add("is-open")
        // New friend: drop previous canvas seat + draft before seating this one.
        const opening = !!payload?.addr && payload.addr !== shownAddr;
        if (opening) {
            if (shownAddr) scene.remove(shownAddr);
            if (term.drafting()) leaveDraft();
            wireWounds = NONE;
            reach.reset();
            walk({ kind: 'open' });
        }

        if (payload?.addr) shownAddr = payload.addr;
        // The name we last retargeted with IS outerName, so the change shows here.
        if (payload?.origin_name && payload.origin_name !== outerName) {
            outerName = payload.origin_name;
            outerProj?.retarget(outerName);
        }
        if (typeof payload?.root === "string" && payload.root) outerRoot = payload.root;
        else if (payload?.root == null && opening) outerRoot = null;
        if (payload?.buffer_id) outerBufferId = payload.buffer_id;

        const view = payload?.view ?? 'watch';
        // Tree is source in every state (D022); string is the no-tree degrade.
        const source = payload?.commands?.length
            ? printAST(payload.commands)
            : (payload?.source ?? '');
        const attendLine = payload?.attend?.line ?? null;

        if (view === 'draft') {
            if (payload?.draft_live) term.streamOrigin(source);
            walk({ kind: 'draftView' });
        } else if (term.drafting()) {
            // A restored watch must not overwrite a live draft island.
            if (payload?.draft_live) term.streamOrigin(source);
        } else {
            // Body first (viewport needs the doc), then line — onPeerLine claims
            // only while following. First canvas seat with their line is inner's job.
            term.changeouter(source);
            onPeerLine(attendLine);
        }

        wireWounds = payload?.diagnostics ?? NONE;
        reask();
        paintSelection();
    };


    // Idempotent: close_js already dropped the flag; server notify may re-fire.
    const onOuterClose = (payload) => {
        // Arrival owns the decision; a queued old close cannot re-clear a
        // newer local incarnation. Local close is the one correlated request.
        if (!intent.acceptedClose(payload)) return
        document.getElementById("outer-open")?.classList.remove("is-open")
        if (term.drafting()) leaveDraft()
        if (shownAddr) {
            scene.remove(shownAddr)
            shownAddr = null
        }
        recovery.clear()
        outerSourceRelease?.()
        outerSourceRelease = null
        outerClaim = null
        outerName = null
        outerRoot = null
        outerBufferId = null
        wireWounds = NONE
        term.changeouter("")
        if (envEl) envEl.dataset.outerState = "ok"
        reask()
        paintSelection();

    }

    const onDelegatedClick = (e) => {
        if (!e.target.closest('#outer-fork')) return;
        if (!hasSelectedDocument()) return;
        const source = term.getValue();
        if (!source || !shownAddr) return;
        scene.fork({
            source,
            name: outerName || 'friend',
            root: outerRoot || undefined,
            addr: shownAddr,
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
    // One selector application: the strip's command and the server mirror.
    const applySelector = (descriptor) => {
        if (!intent.accepted(descriptor)) return
        if (!recovery.mirror(descriptor)) return
        const addr = subject()
        if (addr) document.getElementById("outer-open")?.classList.add("is-open")
        if (term.drafting() && addr !== shownAddr) leaveDraft()
        paintSelection()
    }

    arena.add(() => { if (shownAddr) scene.remove(shownAddr); });

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
            outerClose: onOuterClose,
            // Server-owned selector mirror; the addr is also the editability
            // fence. Matching refresh/reconnect preserves a live draft.
            outerIntent: applySelector,
            outerSelect: (payload) => {
                if (intent.isLocal(payload)) applySelector(payload)
            },
            syncShell: () => {
                const pending = intent.pending()
                if (pending && pending.addr === null) return hook.requestClose()
                recovery.restore({
                    visibleAddr: shownAddr,
                    drafting: term.drafting(),
                    draftLive,
                    name: outerName,
                    root: outerRoot,
                })
            },
        },
        arena,
    };
}
