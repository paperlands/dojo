// weave/resolve.js — THE RESOLVER (Shoot 0; Q2/Q3 settled <2026-07-12>).
//
// One address grammar for the docuverse: two faces, an owner prefix, and a
// scope law. Pure decision, effects injected (the focus.js/lifecycle.js
// extraction law) — the resolver decides WHERE a word lands; the surface
// performs the landing.
//
//   FACES   name — the child's word: [[roundness]], [[the wonder]]. Mortal:
//                  a rename red-links inbound name-portals (the wiki law,
//                  accepted at id:gw-vetting).
//           id   — the press's word: [[frag-roundness]]. Durable across
//                  renames: it RESOLVES to the name it wears today (the
//                  index) and is always DISPLAYED as that name — the id is
//                  never the child's reading word.
//
//   OWNERS  ~/name   — the corpus root (the library's shelf)
//           my/name  — HER shelf, reserved (<2026-07-12>): the first-person
//                      owner. She addresses her own without knowing any
//                      minted username; Shoot 2's woven buffers and her
//                      forks root here.
//           kai/name — a friend's fork (Shoot 5's reach) — ONLY when `kai`
//                      is a known someone (world.owners). The slash is
//                      overloaded: nested corpus paths (primitives/control/as)
//                      are ONE name, not an owner. Cut (<2026-07-12 reflect>):
//                      owner is recognized only for the reserved two and a
//                      known someone; otherwise the whole word is the name.
//           bare     — unqualified (or nested drawer path): scope law
//
//   `my` and `~` are RESERVED: no username may ever be minted as either
//   (a rule Shoot 5's mint must honor). They are the two deliberate
//   reaches; everything else is somebody — and only when named as such.
//
//   SCOPE   bare: her ambients → the corpus (~) → unborn (the red link).
//           Sovereignty as lexical scope: the library never shadows her
//           making. The reserved owners escape the scope on purpose, in
//           either direction: my/name never falls through to the library;
//           ~/name reaches the library past her own shadow.
//
//   FORGIVENESS (Q3): matching is normalized — case folded, space / dash /
//   underscore collapsed — so [[The Wonder]] finds `* the wonder`.
//   Normalization ONLY, no fuzz: the plural deviations in the corpus
//   (frag-spiral ↔ spirals.org) are healed by the INDEX, never by guessing.
//   Display stays verbatim; forgiveness lives only in the comparison.

// Fold a word for comparison: case, and the space/dash/underscore family,
// collapse to one form. Never used for display.
export function normalize(word) {
    return String(word ?? '')
        .toLowerCase()
        .replace(/[\s\-_]+/g, ' ')
        .trim()
}

// Id-face: the press's durable word. Corpus ids wear the `frag-` prefix
// (and kin `prim-`); the child's reading words never do. Syntactic only —
// the index heals renames; the resolver never guesses.
const ID_FACE = /^(frag|prim)-/i

const RESERVED_OWNERS = new Set(['~', 'my'])

function isKnownOwner(head, knownOwners) {
    if (RESERVED_OWNERS.has(head)) return true
    if (!knownOwners) return false
    if (knownOwners instanceof Set) return knownOwners.has(head)
    if (Array.isArray(knownOwners)) return knownOwners.includes(head)
    return false
}

// Read a portal word's grammar without touching any world:
//   "roundness"              → { owner: null, name: "roundness",              face: "name" }
//   "~/roundness"            → { owner: "~",  name: "roundness",              face: "name" }
//   "my/roundness"           → { owner: "my", name: "roundness",              face: "name" }
//   "kai/roundness" + known  → { owner: "kai", name: "roundness",             face: "name" }
//   "kai/roundness" bare     → { owner: null, name: "kai/roundness",          face: "name" }
//   "primitives/control/as"  → { owner: null, name: "primitives/control/as",  face: "name" }
//   "frag-roundness"         → { owner: null, name: "frag-roundness",         face: "id" }
//
// knownOwners — optional Set/array of someone-tokens (Shoot 5). Without it,
// only the reserved owners (~, my) split; nested corpus paths stay whole.
export function parseAddress(word, knownOwners = null) {
    const raw = String(word ?? '').trim()
    const slash = raw.indexOf('/')
    let owner = null
    let name = raw
    if (slash !== -1) {
        const head = raw.slice(0, slash)
        const rest = raw.slice(slash + 1)
        if (isKnownOwner(head, knownOwners)) {
            owner = head
            name = rest
        }
        // else: slash is a drawer path, not a shelf — name stays whole.
    }
    const face = ID_FACE.test(name) ? 'id' : 'name'
    return { owner, name, face }
}

function findAmbient(name, ambients) {
    const key = normalize(name)
    if (!key || !Array.isArray(ambients)) return null
    for (const a of ambients) {
        if (normalize(a) === key) return a
    }
    return null
}

// index: { id → { name, title } }. Lookup by id key or by today's name.
function findById(id, index) {
    if (!index) return null
    const key = normalize(id)
    for (const [k, v] of Object.entries(index)) {
        if (normalize(k) === key) return { id: k, name: v.name, title: v.title }
    }
    return null
}

function findByName(name, index) {
    if (!index) return null
    const key = normalize(name)
    for (const [k, v] of Object.entries(index)) {
        if (normalize(v.name) === key) return { id: k, name: v.name, title: v.title }
    }
    return null
}

function unborn(word) {
    return { kind: 'unborn', word }
}

function fragment(hit) {
    return { kind: 'fragment', name: hit.name, id: hit.id, title: hit.title }
}

// The scope law, run against an injected world:
//   world = {
//     ambients: [names alive on the stage — HER making only; library
//               mounts under ~/ are filtered by the surface],
//     index:    { id → { name, title } } | null
//     owners:   Set|array of known someones (Shoot 5); optional
//   }
// → { kind: "ambient",  name }
// → { kind: "fragment", name, id, title }
// → { kind: "unborn",   word }
export function resolve(word, world = {}) {
    const { owner, name, face } = parseAddress(word, world.owners ?? null)
    const ambients = world.ambients ?? []
    const index = world.index ?? null

    // ~/name — deliberate reach past her own shadow into the library.
    // Name may be a nested drawer path (primitives/control/as).
    if (owner === '~') {
        if (face === 'id') {
            const hit = findById(name, index)
            return hit ? fragment(hit) : unborn(word)
        }
        const hit = findByName(name, index)
        return hit ? fragment(hit) : unborn(word)
    }

    // my/name — hers only; never falls through to the library.
    if (owner === 'my') {
        const alive = findAmbient(name, ambients)
        return alive != null
            ? { kind: 'ambient', name: alive }
            : unborn(word)
    }

    // A known someone (Shoot 5). Until the shared weave lands, their shelf
    // is unborn here — honesty over a half-fork that pretends the peer is here.
    if (owner != null) {
        return unborn(word)
    }

    // Bare — the scope law: her world, then the library, then the invitation.
    if (face === 'id') {
        const hit = findById(name, index)
        return hit ? fragment(hit) : unborn(word)
    }

    const alive = findAmbient(name, ambients)
    if (alive != null) return { kind: 'ambient', name: alive }

    const hit = findByName(name, index)
    if (hit) return fragment(hit)

    return unborn(word)
}
