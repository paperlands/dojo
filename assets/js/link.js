// The page's one link, and the fork word's ladder (specs link-actions).
//
// The singleton is the only reader of location.search in the tree — a
// surface parsing location itself is the regression (id:la-not).

import { createLink } from "./kernel/link.js"
import { name, read } from "./keep/entry.js"
import { ofWork } from "./keep/work.js"
import { PAGE } from "./keep/page.js"
import { accept } from "./keep/shared.js"
import { resolve } from "./weave/resolve.js"

// Seed is only for off-document (tests); on the page, read prefers location
// (id:la-law — the address bar is the fact store, not a closed-over snapshot).
export const link = createLink(
    typeof location === "undefined" ? "" : location.search,
    (qs) => history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`),
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

async function forkKept(ref, { door, term, pull, say }) {
    if (!door) { say("no door standing"); return null }
    let bytes = null
    let work = ref
    let source = null
    let mine = null
    try {
        mine = await door.root()
        const asKeep = await door.get(ref)
        if (asKeep) {
            // Keep face, already held — pin this commit (never chase HEAD).
            bytes = asKeep
            work = read(asKeep).target
        } else {
            // ofWork hit ⇒ work face with a local head. Miss ⇒ cold keep or
            // cold work; the room's answer (or its absence) decides.
            const local = ofWork(await door.list(mine, PAGE), ref)[0] ?? null
            if (local) {
                // Work face: HEAD at *open time*. A prior accept must not
                // freeze the first artifact — re-ask the room and take the
                // newer by the author's ts (id:la-fork-pull, id:kb-8).
                work = ref
                bytes = local
                if (pull) {
                    const got = await askRoom(ref, { pull, say: () => {} })
                    if (got && newerKeep(local, got.bytes) === got.bytes) {
                        bytes = got.bytes
                        source = got.source
                        await keepPulled(door, got, say)
                    }
                }
            } else if (pull) {
                // Cold machine: keep id or work id — one ask, both faces.
                const got = await askRoom(ref, { pull, say })
                if (got) {
                    bytes = got.bytes
                    work = read(bytes).target
                    source = got.source
                    await keepPulled(door, got, say)
                }
            }
        }
    } catch (e) {
        say("the door refused", e)
        return null
    }
    let title = null
    let root = null
    let ts = null
    if (bytes) {
        const value = read(bytes)
        title = typeof value.title === "string" ? value.title : null
        root = value.root
        ts = value.ts
        // Work is always the keep's target when we hold bytes — never the
        // keep's own name mistaken for a work id on a cold keep-face pull.
        if (typeof value.target === "string" && value.target) work = value.target
        if (source == null) {
            try {
                source = value.source_id ? await door.source(value.source_id) : null
            } catch {
                source = null
            }
        }
        // A tombstone still finds; it cannot create (id:kb-source-absence).
        if (typeof source !== "string") say(`no source held for ${ref}`)
    }
    // The hand decides the gesture (id:la-fork-hand, id:kb-vet2-work): my own
    // keep rejoins its river; another hand's keep is a peer fork — a new
    // river, lineage in origin. Works stay single-hand by construction.
    if (bytes && root !== mine) {
        return forkForeign({ term, say, ref, work, bytes, source, title, ts })
    }
    // land: the address asked for this keep/HEAD — open it, don't only
    // rejoin a stale draft of the same river (id:la-fork-pull).
    const landed = term.forkKeep({ work_id: work, source, name: title, land: true })
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

/** Author order (id:kb-8): newer ts wins; missing/unreadable loses. */
function newerKeep(a, b) {
    if (!a) return b
    if (!b) return a
    try {
        const ta = read(a).ts
        const tb = read(b).ts
        if (!tb || typeof tb.t !== "number") return a
        if (!ta || typeof ta.t !== "number") return b
        if (tb.t > ta.t || (tb.t === ta.t && (tb.n ?? 0) > (ta.n ?? 0))) return b
        return a
    } catch {
        return a
    }
}

// A foreign keep rides the peer-fork path: find-or-create by origin.addr —
// the river, not the moment, so a HEAD link reopened after the author kept
// again lands a merge on the same lineage rather than a second fork.
function forkForeign({ term, say, ref, work, bytes, source, title, ts }) {
    const addr = work ?? name(bytes)
    if (typeof source !== "string") {
        const held = term.findFork?.(addr) ?? null
        if (held) {
            term.opBufferHandler({ op: "select", target: held })
            return held
        }
        say(`nothing kept as ${ref}`)
        return null
    }
    // land: a link open shows the keep (HEAD or pinned), even when a fork
    // buffer already stands with a diverged draft (id:la-fork-pull).
    const landed = term.forkBuffer({
        source,
        name: title ?? "kept",
        addr,
        time: ts?.t ?? Date.now(),
        land: true,
    }) ?? null
    if (!landed) say(`nothing kept as ${ref}`)
    return landed
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
