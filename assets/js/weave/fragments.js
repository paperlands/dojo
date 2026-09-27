// Weave — the client door to the fragment press (Phase 2, the locality fence).
//
// Fragments are authored as org in the repo (codex/fragments/, tended by
// codex-morphology) and served as RAW STATIC TEXT at /codex/<name>.org.
// This module is the only way the client reaches them: local-first and LAZY —
// fetched on first walk, parsed in the browser (weave/parse.js, Shoot 0),
// never round-tripping the server to read itself. The server never parses
// org; the repo is the press, the browser is the reader.

const cache = new Map()

// undefined = not fetched yet; null = pressed index absent (honest degrade).
let indexCache = undefined

// The index — the corpus's one GENERATED projection (Q2, <2026-07-12>):
// id ↔ name ↔ title, emitted beside the fragments at press/build time (the
// same asset task that ships them; rebuildable, the machine's share — never
// hand-kept, never a second namespace). It exists so ids outlive renames:
// [[frag-roundness]] resolves here to the name it wears today, which is what
// lets the corpus be tended — files renamed, titles regrown — without
// breaking the constellation's inbound links.
// Resolves to { id: { name, title } }, or null when no index is pressed yet —
// the resolver degrades honestly (names still walk; id-portals wait unborn).
export async function fragmentIndex() {
    if (indexCache !== undefined) return indexCache
    try {
        const res = await fetch("/codex/index.json")
        if (!res.ok) {
            indexCache = null
            return null
        }
        indexCache = await res.json()
        return indexCache
    } catch {
        indexCache = null
        return null
    }
}

// Tag groups — DERIVED from the pressed index, never stored beside it (one
// projection, one namespace: every top-level key in index.json is an id the
// resolver may land on). Groups are the corpus's category pages: tag →
// [ids], insertion order following the index's alphabetical ids. This is
// what lets an onboarding surface open the shelf by theme and let any
// fragment be the door.
export function tagGroups(index) {
    const groups = {}
    if (!index) return groups
    for (const [id, entry] of Object.entries(index)) {
        for (const tag of entry.tags ?? []) {
            ;(groups[tag] ??= []).push(id)
        }
    }
    return groups
}

// Fetch a fragment's raw org source by name ("spirals" → /codex/spirals.org).
// Resolves to the text, or null when the fragment is not (yet) born — the
// caller renders the red-link invitation, never an error.
export async function fetchFragment(name) {
    if (cache.has(name)) return cache.get(name)
    try {
        const res = await fetch(`/codex/${name}.org`)
        if (!res.ok) return null
        const text = await res.text()
        cache.set(name, text)
        return text
    } catch {
        return null
    }
}
