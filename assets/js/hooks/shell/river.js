// =============================================================================
// RIVER — the keep surface: self, one work (id:kr-orient, id:kr-place).
//
// The first surface over the journal, and the shell's spine: the column under
// the sun is WHERE THE CHILD IS. Drag (or tap) the strip; once the drum is
// still, the editor holds that keep's source and the canvas follows — the
// shell evaluates live (D021: attention is the address). Chrome tracks the
// sun mid-motion; setValue waits for settle.
//
// THE PRESENT IS A PLACE. East of every keep stands one open seat: the buffer
// as it is now, unkept. The child rests there by default. Writing a word there
// is the whole keep gesture — the first word names the river, the rest name
// the steps.
//
// EAST OF PRESENT: a local DRAFT — a potential head. Editing a past keep
// does not clobber the head buffer; it opens one draft seat (from, text,
// face), never a journal row. Commit lands a fork (prev = from); discard
// drops it. Local memory holds the draft per work so reload and tab switch
// do not forget a head that has not been kept yet.
//
// Client-lazy like the weave: no CM6, no Terminal of its own. Its two ports
// arrive through cells — the coreshell's door (keep/cell.js) and the
// coreshell's Terminal (term-cell.js) — because the shell that mints is the
// shell whose work this river is of.
// =============================================================================

import { createArena } from "../../kernel/arena.js"
import { attach } from "../../kernel/attach.js"
import { name, read } from "../../keep/entry.js"
import { PAGE } from "../../keep/page.js"
import { shared } from "../../keep/shared.js"
import { columnsOf, mirrorOf, ofWork } from "../../keep/work.js"
import { askKeep, doorSeat, getDoor, watchLanded } from "../../keep/cell.js"
import { seatOf } from "./term-cell.js"
import { moodOf, rigOf } from "../../river/light.js"
import { wear } from "../../river/atoms.js"
import { readDraft, writeDraft } from "../../river/draft-memory.js"
import { readHead, writeHead } from "../../river/head-memory.js"
import { paint } from "../../river/paint.js"
import { mountWheel } from "../../river/wheel.js"

export const river = {
    events: [],
    mount: mountRiver,
}

// PAGE is keep/page.js — same depth the wire ships (id:kb-8-page, id:kb-9).
// list and local read at the SAME depth or the fold lies.

// Column keys that are not keep ids — never collides with hex64 (id:kb-work-three).
const PRESENT = "present"
const DRAFT = "draft"

// How long the sky stays lit after a keep descends (id:kr-motion ≤400ms
// streak, then the standing weather takes the sky back).
const IGNITE_MS = 700

function mountRiver(hook) {
    const arena = createArena()
    const root = hook.el
    const rail = root.querySelector("[data-rail]")
    const sun = root.querySelector("[data-sun]")
    const word = root.querySelector("[data-word]")
    const message = root.querySelector("[data-message]")
    const drop = root.querySelector("[data-drop]")
    if (!rail || !word || !message) {
        console.error("river: the sky is missing its rail or its word")
        arena.destroy()
        return { events: {}, arena }
    }

    const term = seatOf("coreshell")

    // The shell's chosen head. null is the resting head — the newest keep —
    // and a swap is nothing but this field naming the other line's head.
    let head = null
    let work = null
    // The two things this surface holds that the log does not: the text behind
    // each keep, so standing in one costs a read only the first time, and an
    // object URL per picture, which the arena revokes.
    const sources = new Map()
    const faces = new Map()
    // The standing fold, so the caption and the walk can ask by id.
    let byId = new Map()
    let keptLast = new Set()
    // Only a NEWER fold may paint; a slow read must never overwrite a fresh one.
    let epoch = 0
    let igniting = null
    let siblingHead = null
    let at = { key: PRESENT, id: null }
    // What the child had in hand when they last walked away from the present.
    // Without this the present is not a place: stepping west into a keep would
    // overwrite unkept work and stepping back would find it gone. Persisted —
    // refresh while standing on an older keep must not kill the head.
    let unkept = null
    // Edit-from-keep: local potential head. null | { from, text, title, face }.
    // Never a keep — but remembered per work (id: draft-memory).
    let draft = null

    const wheel = mountWheel(rail, { onCenter, onSettle })
    arena.add(wheel.release)
    arena.add(() => clearTimeout(igniting))
    arena.add(forgetFaces)

    function forgetFaces() {
        for (const url of faces.values()) URL.revokeObjectURL(url)
        faces.clear()
    }

    // The page is the keep set we may paint; everything else is residue.
    // Draft parent and the seat under the sun may sit just outside the list
    // for a beat — keep those two. Revoke the rest so blob: URLs do not grow
    // with every keep that ages off PAGE.
    function pruneCaches(versions) {
        const want = new Set(versions.map(name))
        if (draft?.from) want.add(draft.from)
        if (at?.id) want.add(at.id)
        for (const [id, url] of faces) {
            if (want.has(id)) continue
            URL.revokeObjectURL(url)
            faces.delete(id)
        }
        for (const id of sources.keys()) {
            if (!want.has(id)) sources.delete(id)
        }
    }

    /** Hold a potential head in memory and on disk for this work. */
    function holdDraft(next) {
        draft = next
        if (work) writeDraft(work, next)
    }

    function dropDraft() {
        draft = null
        if (work) writeDraft(work, null)
    }

    /** Stash the authored head — local memory so refresh cannot kill it. */
    function holdUnkept(text) {
        if (typeof text !== "string") return
        unkept = text
        if (work) writeHead(work, text)
    }

    // ── the fold ─────────────────────────────────────────────────────

    async function refold({ ignite = false, rest = null } = {}) {
        const door = getDoor()
        const shell = term.get()
        const my = ++epoch
        const alive = () => arena.alive && my === epoch

        const workNow = shell?.currentWorkId() ?? null
        if (workNow !== work) {
            // A new work is a new river: the head and kept-local memory
            // belonged to the last one. Draft and unkept are potential heads —
            // load this work's; the last was already written on hold.
            work = workNow
            head = null
            sources.clear()
            forgetFaces()
            keptLast = new Set()
            unkept = readHead(work)
            draft = readDraft(work)
            // Heal a buffer that was clobbered by projecting a keep last session.
            if (unkept != null && shell?.pinHead) shell.pinHead(unkept)
            rest = PRESENT
        }

        let listed = [], held = []
        if (door && work) {
            try {
                const rootName = await door.root()
                if (!alive()) return
                ;[listed, held] = await Promise.all([
                    door.list(rootName, PAGE),
                    door.local(rootName, PAGE),
                ])
            } catch {
                // A door that cannot answer is not a river with no keeps — the
                // present still stands, so the child can still begin.
                listed = []
                held = []
            }
        }
        if (!alive()) return

        const versions = ofWork(listed, work)
        byId = new Map(versions.map((bytes) => [name(bytes), bytes]))
        pruneCaches(versions)

        // Shared is the difference between two folds, never a field
        // (id:kb-8): what the clan has permanently answered.
        const answered = new Set(shared(versions, held).map(name))
        const kept = (id) => !answered.has(id)
        const keptNow = new Set(versions.map(name).filter(kept))

        // A share edge is the only other thing the fold owns: a keep that was
        // ours alone last breath and is the room's now.
        const settling = [...keptLast].some((id) => !keptNow.has(id) && answered.has(id))
        keptLast = keptNow

        const { line, sibling, meet, siblingHead: sib } = mirrorOf(versions, head)
        siblingHead = sib
        root.classList.toggle("has-mirror", sibling.length > 0)

        const columns = columnsOf(line, sibling, meet)
        const headKey = columns.length ? columns[columns.length - 1].key : PRESENT
        // The east is always open (id:kr-meridian) — even on an empty river,
        // where it is the whole sky and the only place there is.
        columns.push({
            key: PRESENT,
            sky: null,
            water: null,
            trunk: false,
            meet: false,
            present: true,
        })
        // Draft sits past the present — potential head, never a journal row.
        if (draft) {
            // Face is session-only; re-wear the parent's picture when we have it.
            const face = draft.face ?? faces.get(draft.from) ?? null
            columns.push({
                key: DRAFT,
                sky: null,
                water: null,
                trunk: false,
                meet: false,
                draft: true,
                face,
            })
        }

        paint(rail, columns, { kept, faceOf: (id) => faces.get(id) ?? null })

        sky(moodOf({ keptLocal: keptNow.size, landing: ignite, settling }))
        if (ignite) flare()
        void openFaces(versions)

        if (rest === "head") wheel.restAt(headKey)
        else if (rest === PRESENT) wheel.restAt(PRESENT)
        else if (rest === DRAFT && draft) wheel.restAt(DRAFT)
        else wheel.update()
        say()
    }

    // ── the light ────────────────────────────────────────────────────

    // One sun, set once at the strip root; every seat only reads (id:kr-rig).
    function sky(mood) {
        root.dataset.mood = mood
        for (const [prop, value] of Object.entries(rigOf(mood))) {
            root.style.setProperty(prop, value)
        }
    }

    /**
     * A keep landed, and THE SUN SAYS SO — nothing else moves.
     *
     * Land was a descent with a streak and a seat that radiated (id:kr-land);
     * three announcements of one fact, two of them on the rail. One sun lights
     * this river (id:kr-light), so one flare is the whole event: the seats
     * simply are where they are, brighter for a moment because the light is.
     */
    function flare() {
        if (!sun) return
        sun.classList.remove("flare")
        void sun.offsetWidth // restart the one animation, never queue two
        sun.classList.add("flare")
        // One timer, re-armed. A child who keeps six pictures in a minute must
        // not leave six cleanups behind on the arena.
        clearTimeout(igniting)
        igniting = setTimeout(() => {
            igniting = null
            sun.classList.remove("flare")
            // The sky returns to the standing weather — ignite decays, it is
            // not a state anyone stores.
            void refold()
        }, IGNITE_MS)
    }

    /**
     * The pictures of the keeps you are NOT standing in.
     *
     * The list still never touches bytes (id:kb-8) — this is the open, just
     * asked for every seat on the page rather than one. The page is small by
     * law (id:kr-vis), so this is a dozen small reads, once, and a seat that
     * has one never asks again.
     */
    async function openFaces(versions) {
        const door = getDoor()
        if (!door) return
        for (const bytes of versions) {
            const id = name(bytes)
            if (faces.has(id)) continue
            const my = work
            let blob
            try {
                blob = await door.image(id)
            } catch {
                continue
            }
            // The picture may simply not be here: a shared keep's blob may have
            // yielded to the cap (id:kc-evict). The sun is the honest answer.
            if (!arena.alive || my !== work) return
            // A concurrent refold may have won the seat while we awaited —
            // re-check before createObjectURL, or the loser leaks a blob: URL.
            if (faces.has(id)) continue
            if (blob == null) continue
            const url = URL.createObjectURL(blob)
            faces.set(id, url)
            const seat = seatFor(id)
            if (seat) wear(seat, { kept: keptLast.has(id), face: url })
            // A restored draft re-wears its parent's face once the picture lands.
            if (draft?.from === id) {
                draft = { ...draft, face: url }
                const dSeat = rail.querySelector(`[data-key="${DRAFT}"] [data-place="sky"]`)
                if (dSeat) wear(dSeat, { kept: false, face: url })
            }
        }
    }

    // ── the word at the meridian ─────────────────────────────────────

    // The child's word for wherever they are standing: a kept moment's title,
    // or the empty line where the next one is written. One caption, because
    // there is one meridian (id:kr-vis: a caption lives outside the strip).
    function say() {
        const here = at.key === PRESENT
        const drafting = at.key === DRAFT
        root.classList.toggle("at-present", here)
        root.classList.toggle("at-draft", drafting)
        if (here) {
            // The first word names the river; every later one names a step.
            message.placeholder = byId.size === 0 ? "YOUR TITLE" : "YOUR MESSAGE"
            return
        }
        if (drafting) {
            // Editable name for the fork; × or Escape drops the draft.
            const from = draft?.from && byId.get(draft.from)
            const parent = (from && titleOf(from)) || null
            message.placeholder = parent ? `from ${parent}` : "YOUR MESSAGE"
            // Don't fight the caret while they type; restore when they return.
            if (document.activeElement !== message) {
                message.value = typeof draft?.title === "string" ? draft.title : ""
            }
            return
        }
        // Leaving an editable seat: do not leave a half-typed word on a keep.
        if (message.value && document.activeElement !== message) message.value = ""
        const bytes = at.id && byId.get(at.id)
        word.textContent = (bytes && titleOf(bytes)) || "—"
    }

    function titleOf(bytes) {
        try {
            const title = read(bytes).title
            return typeof title === "string" ? title : null
        } catch {
            return null
        }
    }

    // ── standing (id:kr-open) ────────────────────────────────────────
    // onCenter = chrome. onSettle = setValue (once the drum is still).

    function onCenter(where) {
        const from = at.key
        at = where ?? { key: PRESENT, id: null }
        root.dataset.centered = at.id ?? at.key
        // Leaving the present stashes the head — draft never steals it; memory
        // holds it so a refresh mid-walk cannot kill the buffer.
        if (from === PRESENT && at.key !== PRESENT) {
            const shell = term.get()
            holdUnkept(shell?.getValue() ?? unkept)
        }
        say()
    }

    function onSettle(where) {
        if (where == null) {
            if (at.key !== PRESENT) onCenter(null)
        } else if (at.key !== where.key || at.id !== where.id) {
            onCenter(where)
        }
        if (at.key === PRESENT) restore()
        else if (at.key === DRAFT) restoreDraft()
        else if (at.id) void stand(at.id)
    }

    function restore() {
        const shell = term.get()
        if (!shell || unkept == null) return
        // Authoring again: write-through is the head.
        if (shell.getValue() !== unkept || shell.projecting?.()) shell.setValue(unkept)
    }

    function restoreDraft() {
        const shell = term.get()
        if (!shell || !draft) return
        // Project only — the head buffer stays what holdUnkept saved.
        if (shell.getValue() !== draft.text || !shell.projecting?.()) {
            shell.setValue(draft.text, { project: true })
        }
    }

    /** Put this keep's source in the editor. Only from onSettle. */
    async function stand(id) {
        const door = getDoor()
        const shell = term.get()
        const bytes = byId.get(id)
        if (!door || !shell || !bytes) return

        let text = sources.get(id)
        if (text == null) {
            const my = work
            try {
                text = await door.source(read(bytes).source_id)
            } catch {
                return
            }
            // Tombstone without source (id:kb-source-absence): do not blank the editor.
            if (!arena.alive || my !== work || typeof text !== "string") return
            sources.set(id, text)
        }
        if (at.id !== id) return
        // Project the keep; never write it through as the head buffer.
        if (shell.getValue() === text && shell.projecting?.()) return
        shell.setValue(text, { project: true })
    }

    function seatFor(id) {
        return rail.querySelector(`[data-place="sky"][data-id="${cssId(id)}"]`)
    }

    // Ids are hex64 by construction (id:kb-work-three) — quote anyway so no
    // future id shape can turn a selector into a parse error.
    function cssId(id) {
        return typeof CSS?.escape === "function" ? CSS.escape(id) : id
    }

    /**
     * The buffer moved off the keep we are standing in.
     * Edit-from-keep opens a local draft past the present — never overwrites
     * unkept. Comparison IS the fact; no stored "dirty" flag.
     */
    function drift() {
        const shell = term.get()
        if (!shell) return

        // At the present: keep head memory warm so a later walk + refresh is safe.
        if (at.key === PRESENT) {
            if (shell.projecting?.()) return
            const text = shell.getValue()
            if (typeof text === "string" && text !== unkept) holdUnkept(text)
            return
        }

        if (at.key === DRAFT) {
            if (!draft) return
            const text = shell.getValue()
            if (text !== draft.text) holdDraft({ ...draft, text })
            return
        }

        const held = at.id != null ? sources.get(at.id) : null
        if (held == null) return
        if (shell.getValue() === held) return

        // One draft per work — a potential head. Unkept stays put.
        const from = at.id
        holdDraft({
            from,
            text: shell.getValue(),
            title: typeof draft?.title === "string" && draft?.from === from ? draft.title : "",
            face: faces.get(from) ?? null,
        })
        void refold({ rest: DRAFT })
    }

    // ── the gesture: a word keeps the moment ─────────────────────────

    function discardDraft() {
        if (!draft) return
        message.value = ""
        message.blur()
        dropDraft()
        void refold({ rest: PRESENT })
    }

    // Hold the fork's title as they type — potential head, still not a keep.
    arena.on(message, "input", () => {
        if (at.key !== DRAFT || !draft) return
        holdDraft({ ...draft, title: message.value })
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
            return
        }
        if (e.key !== "Enter") return
        e.preventDefault()
        const title = message.value.trim()
        // A keep deserves a word. An empty line is not a refusal to keep, it
        // is simply nothing said yet.
        if (!title) return
        message.value = ""
        // Draft commit is a fork: prev names the keep it grew from.
        if (at.key === DRAFT && draft?.from) askKeep(title, { prev: draft.from })
        else askKeep(title)
    })

    if (drop) {
        arena.on(drop, "click", (e) => {
            e.preventDefault()
            e.stopPropagation()
            if (at.key === DRAFT) discardDraft()
        })
    }

    // ── swap: touch the water (id:kr-mirror) ─────────────────────────
    // Seating is the wheel (tap / pan / step). This click is only the swap.
    arena.on(rail, "click", (e) => {
        if (!siblingHead || !e.target.closest?.(".river-water")) return
        head = siblingHead
        void refold()
    })

    // ── edges ────────────────────────────────────────────────────────

    // A keep landed. The signal carries nothing; the fold is the answer.
    // Only a commit from the draft seat spends the draft (fork finished).
    // A keep from the present leaves any side draft alone.
    arena.add(watchLanded(() => {
        if (at.key === DRAFT) dropDraft()
        head = null
        void refold({ ignite: true, rest: "head" })
    }))

    // The door may arrive after us (the coreshell opens it) and may be
    // replaced under us — attach owns both.
    arena.add(attach(doorSeat, () => {
        void refold({ rest: PRESENT })
    }))

    // A tab switch is a work switch; a keystroke is a drift. The bridge
    // breathes for both, and the two questions are cheap and local.
    arena.add(attach(term, (shell) => {
        void refold({ rest: PRESENT })
        return shell.bridge.sub(() => {
            if ((shell.currentWorkId() ?? null) !== work) void refold({ rest: PRESENT })
            else drift()
        })
    }))

    // Hidden, the wheel has no width and cannot find its meridian. Showing is
    // therefore an edge like any other — and the one that seats the present.
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
