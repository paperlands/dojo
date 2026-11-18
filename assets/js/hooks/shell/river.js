// River — keep surface for one work (id:kr-orient).
// fold → paint → chrome → effects. Truths: keeps, view, seal.

import { createArena } from "../../kernel/arena.js"
import { attach } from "../../kernel/attach.js"
import { link, liveForkRef, pullHistory, pullKeep } from "../../link.js"
import { name, read } from "../../keep/entry.js"
import { REACH } from "../../keep/page.js"
import { adoptWork, ofWork } from "../../keep/work.js"
import { askKeep, doorSeat, getDoor, peerOf, watchTouched } from "../../keep/cell.js"
import { sessionName } from "./session-name.js"
import { nerve } from "../nerve.js"
import { signals as S } from "../../nerve/store.js"
import { seatOf as termSeatOf } from "./term-cell.js"
import { moodOf, paintSky } from "../../river/light.js"
import { pulse, whenDone } from "../../kernel/motion.js"
import { copyText } from "../../utils/clipboard.js"
import { temporal } from "../../utils/temporal.js"
import { wear } from "../../river/atoms.js"
import { readDraft, writeDraft } from "../../river/memory.js"
import { paint } from "../../river/paint.js"
import { mountWheel } from "../../river/wheel.js"
import { HEAD, fold, landed, restKey } from "../../river/fold.js"
import { BEAT, paintChrome, titleOf } from "../../river/chrome.js"
import { DRAFT, modeOf, PRESENT } from "../../river/mode.js"
import { clear as clearKeeps, faceOf, ingest, prune } from "../../river/keeps.js"

export const river = {
    events: [],
    mount: mountRiver,
}

/** No door, no work, or a sour read — the fold still runs, on nothing. */
const NO_PAGE = Object.freeze({ versions: [], held: [] })

/** Where a work's history lives: its exact origin's root, else the active root. */
export function pageRootOf({ origin, work, fallback }) {
    if (typeof origin !== "string" || name(origin) !== work) return fallback
    try {
        const value = read(origin)
        return value.target == null && typeof value.root === "string" && value.root
            ? value.root
            : fallback
    } catch {
        return fallback
    }
}

/** One clock for the ceremony — monotonic where the browser offers it. */
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now())

function emptyView() {
    return {
        sharedIds: new Set(),
        siblingHead: null,
        keptLocal: new Set(),
        newestId: null,
    }
}

function mountRiver(hook) {
    const arena = hook.arena.child()   // ownership begins at acquisition, not return
    const root = hook.el
    const rail = root.querySelector("[data-rail]")
    const sun = root.querySelector("[data-sun]")
    const word = root.querySelector("[data-word]")
    const message = root.querySelector("[data-message]")
    const drop = root.querySelector("[data-drop]")
    const copy = root.querySelector("[data-copy]")
    if (!rail || !word || !message) {
        console.error("river: the sky is missing its rail or its word")
        arena.destroy()
        return { events: {}, arena }
    }

    const term = termSeatOf("coreshell")

    // ?action=share holds the sharing sky open (id:la-vocabulary).
    const flag = document.getElementById("river-state")
    if (flag) {
        if (link.read("action") === "share") flag.classList.add("is-open")
        const mirror = () => {
            if (flag.classList.contains("is-open")) link.carry("action", "share")
            else if (link.read("action") === "share") link.carry("action", null)
        }
        const mo = new MutationObserver(mirror)
        mo.observe(flag, { attributes: true, attributeFilter: ["class"] })
        arena.add(() => mo.disconnect())
    }

    // ── independent truths ───────────────────────────────────────────
    let work = null
    /** Live outer ghost context; null when attention is on this hand. */
    let peer = null
    /** Which hand's river is in focus while a ghost is open. */
    let focus = "core"
    /** The exact base only when both currents actually share it. */
    let forkBase = null
    /** Ids seen on each current, for attention without a mode bar. */
    let lanes = { core: new Set(), peer: new Set() }
    /** Chosen line head for the mirror (null = newest). */
    let lineHead = null
    let at = { key: PRESENT, id: null }
    /** @type {{from: string, text: string, title: string, face: string|null}|null} */
    let draft = null
    /** @type {Map<string, {bytes: string, source?: string, face?: string}>} */
    const keeps = new Map()
    let view = emptyView()
    /** @type {{title: string, at: number, head: string|null}|null} */
    let seal = null
    let epoch = 0

    // Guards, not truths. landHold is a setTimeout (remaining HOLD_MIN).
    // Elapsed time is not evidence: a slow answer earns a notice, never a
    // failure. Only the answered outcome settles the seal (producer liveness).
    const sealGuard = temporal.quiet(() => {
        if (seal) nerve()?.push(S.system("keep not confirmed yet — still waiting"))
    }, BEAT.KEEP_GUARD_MS)
    const flareOut = temporal.quiet(cool, BEAT.IGNITE_MS)
    /** @type {ReturnType<typeof setTimeout> | null} */
    let landHoldT = null

    const baseTitle = () => {
        const row = forkBase ? keeps.get(forkBase) : null
        return row ? (titleOf(row.bytes) || "an untitled moment") : "a shared moment"
    }
    const paintFocus = () => {
        root.dataset.compare = peer ? "true" : "false"
        root.dataset.focus = focus
    }
    const setFocus = (next) => {
        if (next === focus) return
        focus = next
        paintFocus()
    }

    const bindOuter = (name, fn) => {
        if (typeof window === "undefined") return
        window.addEventListener(name, fn)
        arena.add(() => window.removeEventListener(name, fn))
    }
    bindOuter("phx:seeOuterShell", (event) => {
        const payload = event?.detail
        if (!payload?.addr) return
        forkBase = null
        peer = {
            addr: payload.addr,
            name: typeof payload.origin_name === "string" ? payload.origin_name : null,
            root: typeof payload.root === "string" ? payload.root : null,
            work: typeof payload.work_id === "string" ? payload.work_id : null,
            base: typeof payload.base_id === "string" ? payload.base_id : null,
        }
        focus = peer.work ? "peer" : "core"
        at = { key: PRESENT, id: null }
        lineHead = null
        paintFocus()
        void refold({ rest: PRESENT })
    })
    const leavePeer = () => {
        if (!peer) return
        peer = null
        focus = "core"
        forkBase = null
        paintFocus()
        void refold({ rest: PRESENT })
    }
    bindOuter("phx:outerSelect", leavePeer)
    bindOuter("phx:outerClose", leavePeer)

    const wheel = mountWheel(rail, { onCenter, onSettle, onTap })
    arena.on(rail, "pointerover", (event) => {
        if (!peer) return
        const place = event.target?.closest?.("[data-place]")?.dataset.place
        if (place === "sky") setFocus("core")
        else if (place === "water") setFocus("peer")
    })
    arena.add(wheel.release)
    arena.add(flareOut.cancel)
    arena.add(sealGuard.cancel)
    arena.add(() => clearTimeout(landHoldT))
    arena.add(() => clearKeeps(keeps))

    function setDraft(next) {
        draft = next
        if (work) writeDraft(work, next)
    }

    // ── refold: door → keeps + fold → paint → chrome → effects ───────

    async function refold({ ignite = false, rest = null } = {}) {
        const my = ++epoch
        const alive = () => arena.alive && my === epoch

        if (reseat()) rest = PRESENT
        const page = await readPage(alive)
        const ghostPage = peer ? await readGhostPage(alive) : null
        if (!alive()) return

        const folded = peer ? compareFold(page, ghostPage, peer) : reindex(page)

        // Land is fold-derived (id:kr-land) — mint grows newestId past seal.head.
        if (!ignite && seal && landed(seal.head, folded.newestId)) {
            const wait = Math.max(0, BEAT.HOLD_MIN_MS - (now() - seal.at))
            if (wait > 0) {
                clearTimeout(landHoldT)
                landHoldT = setTimeout(landWhenReady, wait)
            } else {
                landWhenReady()
                return
            }
        }

        show(folded, ignite)
        void openFace()

        const key = restKey(rest, folded)
        if (key) wheel.restAt(key)
        else wheel.update()

        if (ignite && seal) endSeal()
        say()
    }

    /** The child moved to another work: forget this fold, wear that work's draft. */
    function reseat() {
        const workNow = term.get()?.currentWorkId() ?? null
        if (workNow === work) return false
        work = workNow
        lineHead = null
        clearKeeps(keeps)
        view = emptyView()
        draft = readDraft(work)
        return true
    }

    /** The focused ghost's lazy page. */
    async function readGhostPage(alive) {
        const ghost = peer
        if (!ghost?.work) return NO_PAGE
        const pulled = await pullHistory(ghost.work, { n: REACH })
        if (!alive()) return NO_PAGE
        const versions = []
        const seen = new Set()
        for (const row of pulled?.keeps ?? []) {
            if (typeof row?.message !== "string") continue
            const id = name(row.message)
            if (seen.has(id)) continue
            seen.add(id)
            versions.push(row.message)
        }
        if (ghost.base && !seen.has(ghost.base)) {
            const cut = await pullKeep(ghost.base)
            if (!alive()) return NO_PAGE
            if (cut && typeof cut.message === "string" && name(cut.message) === ghost.base) {
                versions.push(cut.message)
            }
        }
        return { versions, held: [] }
    }

    /** The door's page, folded to this work. A shut or sour door is no page. */
    async function readPage(alive) {
        const door = getDoor()
        const shell = term.get()
        if (!door || !work) return NO_PAGE
        try {
            // Index context from exact origin bytes, not write authority.
            let origin = null
            try { origin = await door.get(work) } catch { origin = null }
            if (!alive()) return NO_PAGE
            // Known history needs no read-or-minting signer. root() only
            // supplies an index when the exact origin cannot.
            let rootName = pageRootOf({ origin, work, fallback: null })
            if (!rootName) {
                rootName = await door.root()
                if (!alive()) return NO_PAGE
            }
            // REACH, not PAGE — this page is filtered down to one work, so it
            // must reach past the author's other rivers (id:ka-reach). SAME
            // depth on both sides: that is what kb-8-page's proof requires.
            const [listed, held] = await Promise.all([
                door.list(rootName, REACH),
                door.local(rootName, REACH),
            ])
            if (!alive()) return NO_PAGE
            let versions = ofWork(listed, work)
            // Journal owns the origin; recover onto the tab if the field is empty.
            if (versions.length === 0) {
                const recovered = adoptWork(listed, shell?.currentBufferId?.(), work)
                if (recovered && recovered !== work) {
                    work = recovered
                    shell?.adoptWork?.(recovered)
                    versions = ofWork(listed, recovered)
                }
            }
            return { versions, held }
        } catch {
            return NO_PAGE
        }
    }

    /** Index the page, drop what nothing points at, fold the geometry. */
    function reindex({ versions, held }) {
        ingest(keeps, versions)
        const want = new Set(versions.map(name))
        if (draft?.from) want.add(draft.from)
        if (at?.id) want.add(at.id)
        prune(keeps, want)

        const folded = fold(versions, held, {
            head: lineHead,
            draft,
            faceOf: (id) => faceOf(keeps, id),
            keptLocal: view.keptLocal,
        })
        view = {
            sharedIds: folded.sharedIds,
            siblingHead: folded.siblingHead,
            keptLocal: folded.keptLocal,
            newestId: folded.newestId,
        }
        return folded
    }

    /** One river, one confluence, two currents (compare). */
    function compareFold(core, ghost, context) {
        const coreVersions = core?.versions ?? []
        const peerVersions = ghost?.versions ?? []
        const all = [...coreVersions, ...peerVersions]
        ingest(keeps, all)
        const contextBase = typeof context?.base === "string" ? context.base : null
        const peerIds = new Set(peerVersions.map(name))
        let coreHeadBase = null
        try {
            coreHeadBase = coreVersions[0] ? read(coreVersions[0]).prev ?? null : null
        } catch {
            coreHeadBase = null
        }
        const currentBase = term.get()?.currentBaseId?.() ?? null
        const coreBase = coreHeadBase ?? currentBase
        // The fork point can be an ancestor in the peer page, not the peer's
        // current base; the core head's prev names where this branch began.
        const base = coreBase && peerIds.has(coreBase)
            ? coreBase
            : (contextBase && coreBase === contextBase ? contextBase : null)
        forkBase = base
        lanes = {
            core: new Set(coreVersions.map(name)),
            peer: new Set(peerVersions.map(name)),
        }
        const baseBytes = base ? all.find((bytes) => name(bytes) === base) ?? null : null
        const branch = (versions) => {
            let arr = versions.slice()
            if (base) {
                const at = arr.findIndex((bytes) => name(bytes) === base)
                if (at >= 0) arr = arr.slice(0, at + 1)
            }
            return arr.reverse().filter((bytes) => name(bytes) !== base)
        }
        const coreBranch = branch(coreVersions)
        const peerBranch = branch(peerVersions)
        const columns = []
        if (baseBytes) {
            columns.push({
                key: `base:${base}`,
                sky: baseBytes,
                water: null,
                trunk: true,
                meet: true,
            })
        }
        for (let i = 0; i < Math.max(coreBranch.length, peerBranch.length); i++) {
            const sky = coreBranch[i] ?? null
            const water = peerBranch[i] ?? null
            const id = sky ? name(sky) : water ? name(water) : `slot:${i}`
            columns.push({
                key: `cmp:${i}:${id}`,
                sky,
                water,
                trunk: false,
                meet: false,
            })
        }
        const local = new Set((core?.held ?? []).map(name))
        const ids = new Set(all.map(name))
        const keptLocal = new Set([...local].filter((id) => ids.has(id)))
        const sharedIds = new Set([...ids].filter((id) => !local.has(id)))
        view = {
            sharedIds,
            siblingHead: null,
            keptLocal,
            newestId: coreVersions[0] ? name(coreVersions[0]) : peerVersions[0] ? name(peerVersions[0]) : null,
        }
        return {
            sharedIds,
            kept: (id) => local.has(id),
            keptLocal,
            settling: false,
            columns,
            siblingHead: null,
            heads: {
                core: coreVersions[0] ? name(coreVersions[0]) : null,
                peer: peerVersions[0] ? name(peerVersions[0]) : null,
            },
            hasMirror: columns.some((column) => column.water != null),
            headKey: baseBytes ? `base:${base}` : columns[0]?.key ?? PRESENT,
            newestId: view.newestId,
        }
    }

    /** Paint: rail, sky, and — on a landing — the arrival ceremony. */
    function markFork() {
        for (const el of rail.querySelectorAll("[data-fork]")) {
            delete el.dataset.fork
            delete el.dataset.forkLabel
        }
        const base = forkBase
        if (!base) return
        const esc = typeof CSS?.escape === "function" ? CSS.escape(base) : base
        const seat = rail.querySelector(`[data-place="sky"][data-id="${esc}"]`)
        if (!seat) return
        seat.setAttribute("data-fork", "true")
        seat.dataset.forkLabel = baseTitle()
    }

    function markHeads(folded) {
        for (const col of rail.querySelectorAll("[data-head], [data-peer-head]")) {
            delete col.dataset.head
            delete col.dataset.label
            delete col.dataset.peerHead
            delete col.dataset.peerLabel
        }
        for (const lane of ["core", "peer"]) {
            const id = folded.heads?.[lane]
            if (!id) continue
            const esc = typeof CSS?.escape === "function" ? CSS.escape(id) : id
            const place = lane === "core" ? "sky" : "water"
            const col = [...rail.children].find((el) =>
                el.querySelector?.(`[data-place="${place}"][data-id="${esc}"]`))
            if (!col) continue
            const label = lane === "core" ? "you" : (peer?.name ? `@${peer.name}` : "peer")
            if (lane === "core") {
                col.dataset.head = "core"
                col.dataset.label = label
            } else {
                col.dataset.peerHead = "peer"
                col.dataset.peerLabel = label
            }
        }
    }

    function show(folded, ignite) {
        root.classList.toggle("has-mirror", folded.hasMirror)
        const { seats, arrived } = paint(rail, folded.columns, {
            kept: folded.kept,
            faceOf: (id) => faceOf(keeps, id),
        })
        markFork()
        markHeads(folded)
        paintSky(root, moodOf({
            keptLocal: folded.keptLocal.size,
            landing: ignite,
            settling: folded.settling,
        }))
        if (!ignite) return
        for (const id of arrived) lightLand(seats.get(id))
        flare()
    }

    /** @param {HTMLElement | null | undefined} seatEl */
    function lightLand(seatEl) {
        if (!seatEl) return
        pulse(seatEl, "is-landing")
        whenDone(seatEl, { ms: BEAT.LAND_MS }, () => seatEl.classList.remove("is-landing"))
    }

    function flare() {
        if (!sun) return
        sun.classList.remove("blush")
        pulse(sun, "flare")
        flareOut()
    }

    /** The sky lets the land go — and re-folds, because the seal has passed. */
    function cool() {
        sun?.classList.remove("flare")
        void refold()
    }

    /** Dual of flare: the sun reddens, the word comes back, the nerve says why. */
    function blush() {
        if (!sun) return
        pulse(sun, "blush")
        whenDone(sun, { animation: "river-blush", ms: BEAT.BLUSH_MS }, () => {
            sun.classList.remove("blush")
        })
    }

    function miss(title) {
        endSeal()
        if (typeof title === "string" && title) {
            message.value = title
            if (at.key === DRAFT && draft) setDraft({ ...draft, title })
        }
        blush()
        say()
    }

    /**
     * The room's picture for a keep we no longer hold bytes for (id:kb-13).
     *
     * Best-effort by nature: a drop is a fact, never an exception
     * (id:kc-c-wire). Offline, or a keep the room never got, simply has no
     * face — which is the state kc-e-missing-image already names.
     */
    async function roomFace(id) {
        try {
            const res = await fetch(`/keeps/${id}/image`, { headers: { accept: "image/png" } })
            return res.ok ? await res.blob() : null
        } catch {
            return null
        }
    }

    /** Face for the seat under the sun; epoch+row so a stale open never sticks. */
    async function openFace() {
        const door = getDoor()
        const id = at.id
        if (!door || !id) return
        const row = keeps.get(id)
        if (!row || row.face) return

        const my = epoch
        let blob
        try {
            blob = await door.image(id)
        } catch {
            return
        }
        // THE PICTURE ARRIVES ON THE WALK (id:kb-13). A held blob may have
        // been evicted — lawful precisely because the room holds it
        // (id:kc-evict) — and until this fetch existed that law was true about
        // the bytes and false about reachability: the seat just stayed
        // faceless forever. Immutable at the door, so the browser cache makes
        // the second walk free (id:ka-seat).
        if (blob == null) blob = await roomFace(id)
        if (!arena.alive || my !== epoch) return
        if (keeps.get(id) !== row || row.face) {
            return
        }
        // Still absent is a NAMED state, never an error (id:kc-e-missing-image):
        // the message is whole and re-runs the turtle. A void, not a blank.
        if (blob == null) return

        const url = URL.createObjectURL(blob)
        if (!arena.alive || my !== epoch || keeps.get(id) !== row) {
            URL.revokeObjectURL(url)
            return
        }
        row.face = url
        const seat = seatFor(id)
        if (seat) wear(seat, { kept: view.keptLocal.has(id), face: url })
        if (draft?.from === id) {
            draft = { ...draft, face: url }
            const dSeat = rail.querySelector(`[data-key="${DRAFT}"] [data-place="sky"]`)
            if (dSeat) wear(dSeat, { kept: false, face: url })
        }
    }

    // ── chrome ───────────────────────────────────────────────────────

    function say() {
        paintChrome({
            root,
            word,
            message,
            at,
            sharedIds: view.sharedIds,
            sealing: seal?.title ?? null,
            draft,
            keeps,
            empty: view.newestId == null,
        })
    }

    function beginSeal(title) {
        seal = { title, at: now(), head: view.newestId }
        sealGuard()
        message.value = ""
        message.blur()
        word.textContent = title
        say()
    }

    function endSeal() {
        sealGuard.cancel()
        clearTimeout(landHoldT)
        landHoldT = null
        seal = null
        say()
    }

    function landWhenReady() {
        clearTimeout(landHoldT)
        landHoldT = null
        if (!seal) return
        if (at.key === DRAFT) setDraft(null)
        lineHead = null
        void refold({ ignite: true, rest: HEAD })
    }

    // ── standing ─────────────────────────────────────────────────────

    function onCenter(where) {
        at = where ?? { key: PRESENT, id: null }
        root.dataset.centered = at.id ?? at.key
        say()
        void openFace()
    }

    function onSettle(where) {
        onCenter(where)
        projectStanding()
    }

    /** setValue: text and project mode together. */
    function hold(text, project, base_id = null) {
        const shell = term.get()
        if (!shell) return
        if (shell.getValue() === text && !!shell.projecting?.() === project && (!project || shell.currentBaseId?.() === base_id)) return
        shell.setValue(text, { project, base_id })
    }

    /** Editor holds whatever the standing seat names. */
    function projectStanding() {
        if (at.key === PRESENT) {
            // The buffer owns the head. Missing is not an empty program.
            const text = term.get()?.headContent?.()
            if (typeof text === "string") hold(text, false)
        } else if (at.key === DRAFT) {
            if (draft) hold(draft.text, true, draft.from)
        } else if (at.id) {
            void stand(at.id)
        }
    }

    /** Fill source field on the keep row, then project into the editor. */
    async function stand(id) {
        const door = getDoor()
        const row = keeps.get(id)
        if (!row) return

        if (peer && lanes.core.has(id) && !lanes.peer.has(id)) setFocus("core")
        else if (peer && lanes.peer.has(id) && !lanes.core.has(id)) setFocus("peer")

        if (row.source == null) {
            const my = (focus === "peer" && peer) ? peer.work : work
            const sourceId = read(row.bytes).source_id
            let text = null
            if (door) {
                try {
                    text = await door.source(sourceId)
                } catch {
                    text = null
                }
            }
            if (text == null && peer) {
                const cut = await pullKeep(id)
                if (cut && typeof cut.message === "string" && name(cut.message) === id) {
                    row.bytes = cut.message
                    text = typeof cut.source === "string" ? cut.source : null
                }
            }
            if (!arena.alive || ((focus === "peer" && peer) ? peer.work : work) !== my || typeof text !== "string") return
            if (name(text) !== sourceId) return
            row.source = text
        }
        if (at.id !== id) return
        hold(row.source, true, id)
    }

    function seatFor(id) {
        const esc = typeof CSS?.escape === "function" ? CSS.escape(id) : id
        return rail.querySelector(`[data-place="sky"][data-id="${esc}"]`)
    }

    function drift() {
        const shell = term.get()
        if (!shell) return

        if (at.key === PRESENT) return

        if (at.key === DRAFT) {
            if (!draft) return
            const text = shell.getValue()
            if (text !== draft.text) setDraft({ ...draft, text })
            return
        }

        const held = at.id != null ? keeps.get(at.id)?.source : null
        if (held == null || shell.getValue() === held) return

        const from = at.id
        setDraft({
            from,
            text: shell.getValue(),
            title: typeof draft?.title === "string" && draft?.from === from ? draft.title : "",
            face: faceOf(keeps, from),
        })
        void refold({ rest: DRAFT })
    }

    // ── the gesture ──────────────────────────────────────────────────

    function discardDraft() {
        if (!draft) return
        message.value = ""
        message.blur()
        setDraft(null)
        say()
        void refold({ rest: PRESENT })
    }

    /** Lit ring predicate — light, tap, Enter share it (id:kr-ready). */
    function ready() {
        if (focus === "peer" && peer) return false
        return modeOf({
            at,
            sharedIds: view.sharedIds,
            sealing: seal?.title ?? null,
            caption: message.value,
        }).ready
    }

    /** @returns {boolean} true when a keep was asked */
    function commitKeep() {
        if (!ready()) return false
        const title = message.value.trim()
        if (at.key === DRAFT && draft) setDraft({ ...draft, title: "" })
        beginSeal(title)
        const mine = seal   // the seal that ISSUED this ask (id:ownership-o1)
        const prev = at.key === DRAFT && draft?.from ? draft.from : null
        // Self: session letters from the shell. Peer: live presence name, else origin.name.
        // The ask's answer belongs to THIS subject. Recovery/fork preparation
        // may move the selection to a new stream; the old seal ends quietly and
        // the caption returns only to the stream this ask actually prepared.
        const asked = term.get()?.currentBufferId?.() ?? null
        const restoreCaption = () => {
            if (typeof title !== "string" || !title) return
            if (message.value) return   // a freshly entered word wins
            message.value = title
            if (at.key === DRAFT && draft) setDraft({ ...draft, title })
            say()
        }
        void askKeep(title, {
            prev,
            name: sessionName(),
            peer: peerOf(term.get()),
        }).then((answer) => {
            if (!arena.alive) return   // a remount may share the bufferId
            const current = term.get()?.currentBufferId?.() ?? null
            if (answer?.prepared) {
                // createBuffer's refold may have already ended this seal. A
                // NEWER seal still owns the seat; otherwise return the word to
                // the stream this ask prepared — never an unrelated one.
                if (seal !== mine && seal != null) return
                if (current !== answer.prepared.bufferId) return
                if (seal === mine) endSeal()
                restoreCaption()
                return
            }
            if (seal !== mine) return   // a newer seal owns the seat
            if (current !== asked) {
                endSeal()   // a moved subject neither blushes nor carries the old word
                return
            }
            if (answer?.cancelled) {
                endSeal()
                restoreCaption()
                return
            }
            if (!answer) miss(title)
            else sealGuard.cancel()
        })
        return true
    }

    /** A tap on the seat already under the sun keeps, when the ring is lit. */
    function onTap(where) {
        if (where?.key !== at.key) return false
        return commitKeep()
    }

    arena.on(message, "input", () => {
        if (at.key === DRAFT && draft) setDraft({ ...draft, title: message.value })
        say()
    })

    arena.on(message, "keydown", (e) => {
        if (e.key === "Escape") {
            if (at.key === DRAFT && draft) {
                e.preventDefault()
                discardDraft()
                return
            }
            message.value = ""
            message.blur()
            say()
            return
        }
        if (e.key !== "Enter") return
        e.preventDefault()
        commitKeep()
    })

    if (drop) {
        arena.on(drop, "click", (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (at.key === DRAFT) discardDraft()
        })
    }

    if (copy) {
        let copyAttempt = 0
        const uncopy = temporal.quiet(() => {
            copy.classList.remove("is-copied")
            copy.title = "copy link"
        }, BEAT.COPIED_MS)
        arena.add(uncopy.cancel)
        arena.on(copy, "click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const copyEpoch = epoch
            const attempt = ++copyAttempt
            const id = at.id
            const newestId = view.newestId
            const bytes = bytesOf(keeps, id)
            let work = null
            try {
                work = bytes && (read(bytes).target ?? name(bytes))
            } catch {
                // No local bytes: only the exact server reading can earn a copy.
            }
            const current = () => arena.alive && copyEpoch === epoch && attempt === copyAttempt &&
                at.id === id && view.newestId === newestId
            const url = (async () => {
                const ref = await liveForkRef({ id, work })
                if (!current() || !ref) throw new Error("copy: stale or not live")
                const address = link.address({ fork: ref })
                if (!address) throw new Error("copy: no address")
                return address
            })()
            const took = await copyText(url)
            if (!current() || !took) return
            copy.classList.add("is-copied")
            copy.title = "copied"
            uncopy()
        })
    }

    // ── swap: touch the water (id:kr-mirror) ─────────────────────────
    arena.on(rail, "click", (e) => {
        if (!view.siblingHead || !e.target.closest?.(".river-water")) return
        lineHead = view.siblingHead
        void refold()
    })

    // ── edges ────────────────────────────────────────────────────────

    arena.add(watchTouched(() => { void refold() }))

    arena.add(attach(doorSeat, () => { void refold() }))
    arena.add(attach(term, (shell) => {
        void refold({ rest: PRESENT })
        return shell.bridge.sub(() => {
            if ((shell.currentWorkId() ?? null) !== work) void refold({ rest: PRESENT })
            else drift()
        })
    }))

    if (typeof IntersectionObserver !== "undefined") {
        const io = arena.observe(
            new IntersectionObserver((entries) => {
                if (entries.some((e) => e.isIntersecting)) void refold()
            }),
        )
        io.observe(root)
    }

    return { events: {}, arena }
}

