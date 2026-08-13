// Page link + fork ladder (id:la-not). Only location.search reader in the tree.

import { createLink, SERVER } from "./kernel/link.js"
import { name, read } from "./keep/entry.js"
import { newerKeep, ofWork } from "./keep/work.js"
import { REACH } from "./keep/page.js"
import { accept } from "./keep/shared.js"
import { resolve } from "./weave/resolve.js"

/** One word, one owner (id:la-vocabulary). Minted address carries SERVER words. */
export const WORDS = Object.freeze({
    clan: SERVER,
    fork: "hooks/shell/inner.js",
    action: "hooks/shell/river.js",
    weave: "hooks/shell/weave.js",
    perf: "hooks/shell/inner.js",
})

// Prefer live location; preserve LV history.state on carry (id:la-law).
export const link = createLink(
    typeof location === "undefined" ? "" : location.search,
    (qs) => history.replaceState(
        history.state,
        "",
        `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`,
    ),
    { words: WORDS },
)

// A minted continuant's shape (id:kb-work-three) — keep id or work_id.
const HEX64 = /^[0-9a-f]{64}$/

/**
 * Mint the fork word for a standing keep (id:la-fork-pull).
 *
 * The HEAD of the work shares the **work id** — the link resolves to the
 * chain's head at open time, on any machine. An older keep is
 * commit-specific and shares that keep's id. Pure: no door, no I/O.
 *
 * workId is the keep's target (the river it is of); headId is the newest
 * keep of that work among the fold. The root rides inside the keep the
 * ref resolves to — never in the address (id:la-fork-hand).
 *
 * @param {string|null|undefined} keepId - the keep under the sun
 * @param {{ workId?: string|null, headId?: string|null }} ids
 * @returns {string|null} the ref to put in ?fork=
 */
export function shareForkRef(keepId, { workId = null, headId = null } = {}) {
    if (typeof keepId !== "string" || !keepId) return null
    if (headId && keepId === headId && typeof workId === "string" && workId) return workId
    return keepId
}

/**
 * Fork the named thing into a buffer, or find the buffer that already bears
 * it (id:la-fork). Pure decision, effects injected; every refusal is spoken
 * (id:kb-7: keep it, or say why not — never neither).
 *
 * @param {string} ref - hex64 (keep id or work_id) or a corpus word
 * @param {{ door?, term?, corpus?: {index, fetch, press}, pull?, say? }} doors
 * @returns {Promise<string|null>} the buffer id that answered, or null
 */
export async function forkRef(ref, { door, term, corpus, pull, say = note }) {
    if (typeof ref !== "string" || !ref) return null
    if (!term) { say("no terminal standing"); return null }
    if (HEX64.test(ref)) return forkKept(ref, { door, term, pull, say })
    return forkCorpus(ref, { term, corpus, say })
}

function note(...args) {
    console.debug("[link fork]", ...args)
}

/** The room's read door for the fork word (id:la-fork-pull). Best-effort. */
export async function pullKeep(ref) {
    const res = await fetch(`/keeps/${ref}`, { headers: { accept: "application/json" } })
    return res.ok ? res.json() : null
}

// Hex64 ladder (id:la-fork · la-fork-pull · la-fork-hand). Face then hand; each rung returns a new bag.

async function forkKept(ref, { door, term, pull, say }) {
    if (!door) { say("no door standing"); return null }
    const face = await holdFace(ref, { door, pull, say })
    if (!face) return null
    const picture = await openPicture(face, { door, ref, say })
    return landHand(term, say, ref, picture)
}

/** Face → {bytes, source, mine}. No work yet; no gesture yet. */
async function holdFace(ref, { door, pull, say }) {
    try {
        const mine = await door.root()

        const asKeep = await door.get(ref)
        if (asKeep) return pinCommit(asKeep, mine)

        // REACH, not PAGE (id:ka-reach). At the wire's depth an older work's
        // own fork link misses the copy already in IDB and falls through to
        // coldPull — a round trip for bytes we hold, and nothing at all with
        // the door shut.
        const local = ofWork(await door.list(mine, REACH), ref)[0] ?? null
        if (local) return headAtOpen(ref, { local, mine, door, pull, say })

        if (pull) return coldPull(ref, { mine, door, pull, say })
        return { bytes: null, source: null, mine }
    } catch (e) {
        say("the door refused", e)
        return null
    }
}

function pinCommit(bytes, mine) {
    return { bytes, source: null, mine }
}

// Work face with a local head: re-ask quietly; take the newer by author ts
// (id:la-fork-pull, id:kb-8). A prior accept must not freeze the first artifact.
async function headAtOpen(ref, { local, mine, door, pull, say }) {
    if (!pull) return { bytes: local, source: null, mine }
    const got = await askRoom(ref, { pull, say: () => {} })
    if (!got) return { bytes: local, source: null, mine }
    if (newerKeep(local, got.bytes) !== got.bytes) {
        return { bytes: local, source: null, mine }
    }
    await keepPulled(door, got, say)
    return { bytes: got.bytes, source: got.source, mine }
}

// Cold machine: one loud ask covers both keep-face and work-face.
async function coldPull(ref, { mine, door, pull, say }) {
    const got = await askRoom(ref, { pull, say })
    if (!got) return { bytes: null, source: null, mine }
    await keepPulled(door, got, say)
    return { bytes: got.bytes, source: got.source, mine }
}

// Derive work / title / root / ts / source once. Work is the keep's target
// when we hold bytes — never the keep's own name mistaken for a work id on
// a cold keep-face pull.
async function openPicture(face, { door, ref, say }) {
    const { bytes, mine } = face
    if (!bytes) {
        return { work: ref, bytes: null, source: face.source, mine, title: null, root: null, ts: null }
    }
    const value = read(bytes)
    const work = (typeof value.target === "string" && value.target) ? value.target : ref
    const title = typeof value.title === "string" ? value.title : null
    const root = value.root
    const ts = value.ts
    let source = face.source
    if (source == null) {
        try {
            source = value.source_id ? await door.source(value.source_id) : null
        } catch {
            source = null
        }
    }
    // A tombstone still finds; it cannot create (id:kb-source-absence).
    if (typeof source !== "string") say(`no source held for ${ref}`)
    return { work, bytes, source, mine, title, root, ts }
}

// Hand (id:la-fork-hand, id:kb-vet2-work): same root rejoins; foreign is a
// peer fork. Works stay single-hand by construction.
function landHand(term, say, ref, picture) {
    if (picture.bytes && picture.root !== picture.mine) {
        return landForeign(term, say, ref, picture)
    }
    return landMine(term, say, ref, picture)
}

// land: open the keep/HEAD — do not only rejoin a stale draft (id:la-fork-pull).
function landMine(term, say, ref, { work, source, title }) {
    const landed = term.forkKeep({ work_id: work, source, name: title, land: true })
    if (!landed) say(`nothing kept as ${ref}`)
    return landed
}

// Peer-fork by the river (origin.addr = work), not the moment — so a HEAD
// reopen after the author kept again merges the same lineage. forkBuffer
// itself finds without source (tombstone) and lands with it.
function landForeign(term, say, ref, { work, bytes, source, title, ts }) {
    const landed = term.forkBuffer({
        source,
        name: title ?? "kept",
        addr: work ?? name(bytes),
        time: ts?.t ?? Date.now(),
        land: true,
    }) ?? null
    if (!landed) say(`nothing kept as ${ref}`)
    return landed
}

async function keepPulled(door, got, say) {
    try {
        await accept(
            door,
            got.bytes,
            got.fact,
            got.source != null ? { source: got.source } : {},
        )
    } catch (e) {
        say("pulled, not kept", e)
    }
}

// The reader verifies the name (id:kc-law 3): a keep face must BE the ref,
// a work face must be OF it — a lying room lands nothing.
async function askRoom(ref, { pull, say }) {
    let got = null
    try {
        got = await pull(ref)
    } catch {
        got = null
    }
    if (got == null) { say(`the room does not hold ${ref}`); return null }
    if (typeof got.message !== "string") { say("the room answered a shape we cannot read"); return null }
    let value
    try {
        value = read(got.message)
    } catch {
        say("the room answered unreadable bytes")
        return null
    }
    if (name(got.message) !== ref && value.target !== ref) {
        say("the room answered the wrong bytes")
        return null
    }
    return {
        bytes: got.message,
        source: typeof got.source === "string" ? got.source : null,
        fact: Number.isFinite(got.at)
            ? { at: got.at, node: typeof got.node === "string" ? got.node : "" }
            : null,
    }
}

async function forkCorpus(word, { term, corpus, say }) {
    if (!corpus) { say("no corpus standing"); return null }
    let index = null
    try {
        index = await corpus.index()
    } catch {
        index = null
    }
    const r = resolve(word, { ambients: [], index })
    if (r.kind !== "fragment") { say(`nothing in the corpus called ${word}`); return null }
    const text = await corpus.fetch(r.name)
    if (typeof text !== "string") { say(`${r.name} has no page`); return null }
    const { title, source } = corpus.press(text)
    // The inherited library-fork path: find-or-create by origin.addr; a
    // library fork is a new river for this author (id:kb-vet2-work).
    // land: same as the keep face — a link open shows the page.
    return term.forkBuffer({ source, name: title ?? r.name, addr: `~/${r.name}`, land: true }) ?? null
}
