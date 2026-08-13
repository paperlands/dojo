// River — keep surface for one work (id:kr-orient).
// fold → paint → chrome → effects. Truths: keeps, view, seal.

import { createArena } from "../../kernel/arena.js"
import { attach } from "../../kernel/attach.js"
import { link } from "../../link.js"
import { name, read } from "../../keep/entry.js"
import { REACH } from "../../keep/page.js"
import { ofWork } from "../../keep/work.js"
import { askKeep, doorSeat, getDoor, watchTouched } from "../../keep/cell.js"
import { seatOf as termSeatOf } from "./term-cell.js"
import { moodOf, paintSky } from "../../river/light.js"
import { pulse, whenDone } from "../../kernel/motion.js"
import { copyText } from "../../utils/clipboard.js"
import { temporal } from "../../utils/temporal.js"
import { wear } from "../../river/atoms.js"
import { readDraft, readHead, writeDraft, writeHead } from "../../river/memory.js"
import { paint } from "../../river/paint.js"
import { mountWheel } from "../../river/wheel.js"
import { HEAD, fold, landed, restKey } from "../../river/fold.js"
import { BEAT, paintChrome, shareLinkOf } from "../../river/chrome.js"
import { DRAFT, modeOf, PRESENT } from "../../river/mode.js"
import { clear as clearKeeps, faceOf, ingest, prune } from "../../river/keeps.js"

export const river = {
    events: [],
    mount: mountRiver,
}

/** No door, no work, or a sour read — the fold still runs, on nothing. */
const NO_PAGE = Object.freeze({ versions: [], held: [] })

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
    const arena = createArena()
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
    /** Chosen line head for the mirror (null = newest). */
    let lineHead = null
    let at = { key: PRESENT, id: null }
    let unkept = null
    /** @type {{from: string, text: string, title: string, face: string|null}|null} */
    let draft = null
    /** @type {Map<string, {bytes: string, source?: string, face?: string}>} */
    const keeps = new Map()
    let view = emptyView()
    /** @type {{title: string, at: number, head: string|null}|null} */
    let seal = null
    let epoch = 0

    // Guards, not truths. landHold is a setTimeout (remaining HOLD_MIN).
    const sealGuard = temporal.quiet(endSeal, BEAT.KEEP_GUARD_MS)
    const flareOut = temporal.quiet(cool, BEAT.IGNITE_MS)
    /** @type {ReturnType<typeof setTimeout> | null} */
    let landHoldT = null

    const wheel = mountWheel(rail, { onCenter, onSettle, onTap })
    arena.add(wheel.release)
    arena.add(flareOut.cancel)
    arena.add(sealGuard.cancel)
    arena.add(() => clearTimeout(landHoldT))
    arena.add(() => clearKeeps(keeps))

    function setDraft(next) {
        draft = next
        if (work) writeDraft(work, next)
    }

    function setUnkept(text) {
        if (typeof text !== "string") return
        unkept = text
        if (work) writeHead(work, text)
    }

    // ── refold: door → keeps + fold → paint → chrome → effects ───────

    async function refold({ ignite = false, rest = null } = {}) {
        const my = ++epoch
        const alive = () => arena.alive && my === epoch

        if (reseat()) rest = PRESENT
        const page = await readPage(alive)
        if (!alive()) return

        const folded = reindex(page)

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

    /** The child moved to another work: forget this fold, wear that work's memory. */
    function reseat() {
        const shell = term.get()
        const workNow = shell?.currentWorkId() ?? null
        if (workNow === work) return false
        work = workNow
        lineHead = null
        clearKeeps(keeps)
        view = emptyView()
        unkept = readHead(work)
        draft = readDraft(work)
        if (unkept != null) shell?.pinHead?.(unkept)
        return true
    }

    /** The door's page, folded to this work. A shut or sour door is no page. */
    async function readPage(alive) {
        const door = getDoor()
        if (!door || !work) return NO_PAGE
        try {
            const rootName = await door.root()
            if (!alive()) return NO_PAGE
            // REACH, not PAGE — this page is filtered down to one work, so it
            // must reach past the author's other rivers (id:ka-reach). SAME
            // depth on both sides: that is what kb-8-page's proof requires.
            const [listed, held] = await Promise.all([
                door.list(rootName, REACH),
                door.local(rootName, REACH),
            ])
            return { versions: ofWork(listed, work), held }
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

    /** Paint: rail, sky, and — on a landing — the arrival ceremony. */
    function show(folded, ignite) {
        root.classList.toggle("has-mirror", folded.hasMirror)
        const { seats, arrived } = paint(rail, folded.columns, {
            kept: folded.kept,
            faceOf: (id) => faceOf(keeps, id),
        })
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
        pulse(sun, "flare")
        flareOut()
    }

    /** The sky lets the land go — and re-folds, because the seal has passed. */
    function cool() {
        sun?.classList.remove("flare")
        void refold()
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
        const from = at.key
        at = where ?? { key: PRESENT, id: null }
        root.dataset.centered = at.id ?? at.key
        if (from === PRESENT && at.key !== PRESENT) {
            const shell = term.get()
            setUnkept(shell?.getValue() ?? unkept)
        }
        say()
        void openFace()
    }

    function onSettle(where) {
        onCenter(where)
        projectStanding()
    }

    /** setValue: text and project mode together. */
    function hold(text, project) {
        const shell = term.get()
        if (!shell) return
        if (shell.getValue() === text && !!shell.projecting?.() === project) return
        shell.setValue(text, { project })
    }

    /** Editor holds whatever the standing seat names. */
    function projectStanding() {
        if (at.key === PRESENT) {
            if (unkept != null) hold(unkept, false)
        } else if (at.key === DRAFT) {
            if (draft) hold(draft.text, true)
        } else if (at.id) {
            void stand(at.id)
        }
    }

    /** Fill source field on the keep row, then project into the editor. */
    async function stand(id) {
        const door = getDoor()
        const row = keeps.get(id)
        if (!door || !row) return

        if (row.source == null) {
            const my = work
            let text
            try {
                text = await door.source(read(row.bytes).source_id)
            } catch {
                return
            }
            if (!arena.alive || my !== work || typeof text !== "string") return
            row.source = text
        }
        if (at.id !== id) return
        hold(row.source, true)
    }

    function seatFor(id) {
        const esc = typeof CSS?.escape === "function" ? CSS.escape(id) : id
        return rail.querySelector(`[data-place="sky"][data-id="${esc}"]`)
    }

    function drift() {
        const shell = term.get()
        if (!shell) return

        if (at.key === PRESENT) {
            if (shell.projecting?.()) return
            const text = shell.getValue()
            if (typeof text === "string" && text !== unkept) setUnkept(text)
            return
        }

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
        const prev = at.key === DRAFT && draft?.from ? draft.from : null
        void askKeep(title, { prev }).then((id) => {
            if (!id && seal) endSeal()
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
        const uncopy = temporal.quiet(() => {
            copy.classList.remove("is-copied")
            copy.title = "copy link"
        }, BEAT.COPIED_MS)
        arena.add(uncopy.cancel)
        arena.on(copy, "click", async (e) => {
            e.preventDefault()
            e.stopPropagation()
            const url = shareLinkOf({
                at,
                sharedIds: view.sharedIds,
                keeps,
                newestId: view.newestId,
                work,
            })
            if (!url) return
            await copyText(url)
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

    arena.add(attach(doorSeat, () => { void refold({ rest: PRESENT }) }))
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
                if (entries.some((e) => e.isIntersecting)) void refold({ rest: PRESENT })
            }),
        )
        io.observe(root)
    }

    return { events: {}, arena }
}
