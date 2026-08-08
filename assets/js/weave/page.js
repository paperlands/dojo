// THE SEATING LAW — pure decision; no DOM, no turtle (D023).
// Tested in test/js/seat/page_test.mjs and test/js/seat/world_test.mjs.
//
//   step(world, event) → { world, answer }
//
// One value, three independent indices (id:light-ladders-data):
//
//   records   (witness, place, addr) → Record
//   ladders   (witness, place) → { order: addr[], pins: Set }   capacity 1 + pins
//   places    place[] — where self is looking; head kindles (Law 1)
//
// `self` is whose law this is. Every reader is `f(world, …)`; the one door is
// `step`. pageLaw() owns a world and forwards; its face is unchanged.
//
// EVENT
//   observe  { addr, name, doc, witness|own, place, attention }
//   attend   { addr, line, place, witness }
//   restore  { addr, place }
//   toggle   { addr, name, content, place }
//   forget   { addr, place }
//
//   doc        string or AST. Friend's tree crosses whole (D022); child's text
//              parses against the held tree (green tree).
//   witness    WHO (kernel/witness.js). `own: true/false` is surface sugar —
//              it says only who, never where.
//   place      "coreshell" | "outershell" — named by the surface that owns it.
//   attention  { line } | null — where the reader is (D021). null holds order.
//
// ANSWER — two deltas, then totals (Cut 2 / Law 2). Named arrays, never tagged
// ops: `gone` before `runs` lives in the shape, not array position.
//   { gone, runs, light, at, hatch, main, source, merge }
//
//   gone       Slot[] — what left (a set)
//   runs       [{ slot, node, name, code, nodes, vocab, vocabNodes }]
//   light      { kindled: Slot|null, warm: Slot[], name } — always spoken
//   at         { node, line } | null — attention, no echo suppression
//   hatch      bool | null — for THIS event's witness; never undefined
//   main       Slot | null
//
// Presence is asked, not sent: `presenceOf(world)`. It rode every answer and
// no surface ever read one.
//
// SHAPES — by the document alone (id:gw-cell):
//   plain    no ``` cells — whole buffer is the unit
//   program  cells AND bare code — bare runs; cells dormant until cursor rests
//            in one (ladder capacity 1). Bare is their vocabulary (D019)
//   page     all code in cells — kindled cell runs, warm window of two
//
// ADDRESSINGS (D021): a LINE addresses an intention and crosses seams; a KEY
// names a body for one evaluation. Node = cellKey (place-free join key);
// Slot = place:node is the canvas seat (Cut 1).

import { visit } from "./ladder.js"
import { SELF, PEER } from "../kernel/witness.js"
import { reparseProgram, printAST, phaseCells, stripCells, cellAtLine, cellIdentities, cellKey, CELL_PROBE } from "../turtling/parse.js"

export const CORESHELL = "coreshell"
export const OUTERSHELL = "outershell"

// Same word the canvas uses for its hatch gate (kernel/witness.js).
export { SELF, PEER } from "../kernel/witness.js"

// THE CELL WEARS ITS NAME (D024) — name is the LABEL; id is the identity.
// A flat count made every cell a neighbour of every other: opening a cell in
// chapter one re-aimed a figure in chapter nine. Key is section chain + her
// word (or order among sisters if unnamed). Display name is her word alone
// (`myname`, not `1.2.myname`) — the phase already says which one.
function cellEntries(addr, name, cells) {
    const ids = cellIdentities(cells)
    return cells.map(({ code, vocab, nodes, vocabNodes, open, end, path }, i) => ({
        node: cellKey(addr, ids[i].id),
        name: ids[i].name ?? (i === 0 ? name : `${name}·${i + 1}`),
        code,
        vocab,
        open, end, path,        // attention lines resolve against these
        nodes, vocabNodes,      // live slices — the seat runs THESE
    }))
}

// SLOT = `${place}:${node}` — canvas seat. Node is place-free (join key);
// place says where it SHOWS. Law mints it; no reader spells the separator.
const PLACE_MARK = ":"
const asSlot = (place, node) => `${place}${PLACE_MARK}${node}`
export const nodeOf = (slot) =>
    typeof slot === "string" ? slot.slice(slot.indexOf(PLACE_MARK) + 1) : slot
export const placeOf = (slot) =>
    typeof slot === "string" && slot.includes(PLACE_MARK)
        ? slot.slice(0, slot.indexOf(PLACE_MARK))
        : null

// THREE SHAPES, TWO FACTS (id:gw-cell). Every question reads these:
//   seatsBuffer  does the buffer itself seat a figure?
//   bound        cell ladder capacity; 0 means no cells
// plain: bound 0 → ladder never runs; standing slots are the buffer alone.
const SHAPE = {
    plain:   Object.freeze({ seatsBuffer: true,  bound: 0 }),
    program: Object.freeze({ seatsBuffer: true,  bound: 1 }),
    page:    Object.freeze({ seatsBuffer: false, bound: 2 }),
}

// Document alone. `bare` is the tree with cells stripped.
const shapeFor = (cells, bare) =>
    !cells.length ? SHAPE.plain
        : bare.some((n) => n.type !== "Empty") ? SHAPE.program
        : SHAPE.page

// Bare code BESIDE cells — program only: buffer is cells' vocabulary (D019).
const hasVocabulary = (shape) => shape.seatsBuffer && shape.bound > 0

/** Run entry for a cell (Cut 2 — no per-seat hatch/main flags). */
const cellRun = (place, entry) => ({
    slot: asSlot(place, entry.node),
    node: entry.node,
    name: entry.name,
    code: entry.code,
    vocab: entry.vocab,
    nodes: entry.nodes,
    vocabNodes: entry.vocabNodes,
})

// Whole-buffer run (plain, or a program's bare code). draw folded into seat.
const bufferRun = (place, addr, name, code, extra = {}) => ({
    slot: asSlot(place, addr),
    node: addr,
    name,
    code,
    nodes: extra.nodes,
    vocab: undefined,
    vocabNodes: undefined,
})

const sameOrder = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

// ── THE WORLD ─────────────────────────────────────────────────────────────
// One value. Only mutable binding is the one pageLaw() holds. Transitions
// take a world and answer a world; containers are copied, never written through.

export function openWorld({ self = SELF } = {}) {
    return {
        self,
        records: new Map(),   // `${witness}|${place}|${addr}` → Record
        ladders: new Map(),   // `${witness}|${place}` → { order, pins }
        places: [],           // where self is looking; head kindles
    }
}

const recKey = (witness, place, addr) => `${witness}|${place}|${addr}`
const ladderKey = (witness, place) => `${witness}|${place}`

// Asking must not seat — a ladder nobody has visited is empty.
const NO_LADDER = Object.freeze({ order: Object.freeze([]), pins: new Set() })
const ladderAt = (world, witness, place) =>
    world.ladders.get(ladderKey(witness, place)) ?? NO_LADDER

const withLadder = (world, witness, place, next) => {
    const ladders = new Map(world.ladders)
    ladders.set(ladderKey(witness, place), next)
    return { ...world, ladders }
}

// ── READERS ───────────────────────────────────────────────────────────────
// Pure over one world. A property here is a property of a VALUE.

// THE RECORD A CALLER MEANS. With a witness, that witness's. Without — every
// surface question about "this document here" — self's when she has one,
// otherwise whoever is standing: my draft is what I reach into; with no draft
// I am reading theirs. Stated once so no caller resolves it for itself.
export function recordFor(world, addr, place, witness) {
    if (witness) return world.records.get(recKey(witness, place, addr)) ?? null
    const places = place ? [place] : [CORESHELL, OUTERSHELL]
    for (const p of places) {
        const mine = world.records.get(recKey(world.self, p, addr))
        if (mine) return mine
    }
    for (const p of places) {
        for (const page of world.records.values()) {
            if (page.place === p && page.addr === addr) return page
        }
    }
    return null
}

// ONE SLOT, ONE FIGURE. Two witnesses may hold a record for the same document
// at the same place (drafting over a friend's page) — but a Slot names ONE
// canvas seat. Self paints it; the other is still HELD (tree, diagnostics,
// draft-revert baseline) and does not draw. Totals still speak; only runs at
// a slot self already holds are withheld.
const paints = (world, page) =>
    page.witness === world.self ||
    !world.records.has(recKey(world.self, page.place, page.addr))

// Head of its own ladder — the addr its witness is on.
const isHeadOf = (world, page) => {
    const { order } = ladderAt(world, page.witness, page.place)
    return !order.length || order[0] === page.addr
}

// EVERY SLOT THIS RECORD HAS SEATED. Truth, not policy: light takes degrees
// from it and progress sums over it — an omission is a figure that runs unseen.
// Buffer slot last, so the kindled cell stays slots[0].
function standingSlots(world, page) {
    if (!page || !paints(world, page)) return []
    const cells = page.order.map((i) => asSlot(page.place, page.entries[i].node))
    return page.shape.seatsBuffer ? [...cells, asSlot(page.place, page.addr)] : cells
}

// Where self is looking. A place is never evicted, only emptied.
export const attentionAt = (world) => world.places[0] ?? null

// light total — pure, from the orders. Kindling in one place makes every
// other place's order warm (P1, P3).
export function lightOf(world, kindledPlace) {
    // WHICH RECORD IS BRIGHT — chosen once, then read. At the place self is
    // looking: hers when she has one (draft kindled; friend's held original
    // never paints beneath it); with none of her own she is WATCHING, and
    // their figure is what she sees.
    let lit = null
    if (kindledPlace != null) {
        const heads = []
        for (const page of world.records.values()) {
            if (page.place !== kindledPlace) continue
            if (!standingSlots(world, page).length) continue
            if (isHeadOf(world, page)) heads.push(page)
        }
        lit = heads.find((p) => p.witness === world.self) ?? heads[0] ?? null
    }

    const warm = []
    let kindled = null
    let name = null
    for (const page of world.records.values()) {
        const slots = standingSlots(world, page)
        if (!slots.length) continue
        if (page !== lit) {
            warm.push(...slots)
            continue
        }
        // Every seated slot is kindled or warm — never neither: applyLight
        // writes opacity for exactly these two. A program with the cursor out
        // on bare code must still kindle its buffer slot (the figure running);
        // emptiness of "which cell" must not mean emptiness of light.
        kindled = slots[0]
        // Cell wears its own word (D024); whole buffer wears the page's.
        const i = page.order[0]
        name = (i != null ? page.entries[i]?.name : null) ?? page.name
        warm.push(...slots.slice(1))
    }
    return { kindled, warm, name }
}

// presence — other witnesses' order heads (Law 3). Free to reassert.
// Read WITHOUT `paints`: a shadowed record is exactly what presence is for —
// "someone else is on this node" is most worth saying when they are not drawing.
export function presenceOf(world) {
    const out = []
    for (const page of world.records.values()) {
        if (page.witness === world.self) continue
        const i = page.order[0]
        const node = i != null ? page.entries[i]?.node : page.addr
        if (node == null) continue
        out.push({ slot: asSlot(page.place, node), witness: page.witness, addr: page.addr })
    }
    return out
}

// EVERY WITNESS ON THIS DOCUMENT, self first — "who else is here?".
// Asked, not enumerated: identity is not the set of its values (kernel/witness.js).
export function witnessesOn(world, addr, place) {
    const out = []
    for (const page of world.records.values()) {
        if (page.addr === addr && (!place || page.place === place)) out.push(page.witness)
    }
    return out.sort((a, b) => (a === world.self ? -1 : b === world.self ? 1 : 0))
}

// Every slot seated at a place — scope a world fact to one shell (per-place progress).
export function slotsOf(world, place) {
    const out = []
    for (const page of world.records.values()) {
        if (page.place !== place) continue
        out.push(...standingSlots(world, page))
    }
    return out
}

// Runs a standing record would seat — whole figure list, for when a seat
// changes hands without the document changing.
const runsFor = (page) => {
    const out = page.order.map((i) => cellRun(page.place, page.entries[i]))
    if (page.shape.seatsBuffer) {
        out.push(bufferRun(page.place, page.addr, page.name,
                           page.bareSource ?? page.source, { nodes: page.bare ?? page.tree }))
    }
    return out
}

// at total — where attention landed; no echo suppression (Law 2).
// Built only from shape + order.
function projectAt(shape, addr, entries, order) {
    if (order.length) {
        const e = entries[order[0]]
        return e ? { node: e.node, line: e.open } : null
    }
    // No cell stands: a buffer that seats a figure points at itself; a page
    // points nowhere.
    return shape.seatsBuffer ? { node: addr, line: null } : null
}

// A document becomes a tree exactly once, no matter which caller asks.
// Unparsable degrades to plain: parse errors surface at the seat.
function asTree(world, witness, place, addr, doc) {
    if (Array.isArray(doc)) return { ast: doc, source: printAST(doc) }
    if (!CELL_PROBE.test(doc)) return { ast: null, source: doc }
    const held = world.records.get(recKey(witness, place, addr))
    try {
        // Green tree (id:cmp-green-tree): held tree is the reuse ground —
        // edit one cell, sisters stay ===-identical, their frames survive.
        return { ast: reparseProgram(doc, held?.source ?? null, held?.tree ?? null), source: doc }
    } catch {
        return { ast: null, source: doc }
    }
}

// `order` is the record's whole runtime state: which cells stand, kindled first.
function ladder(prevOrder, entries, index, shape, attended) {
    const order = prevOrder.filter((i) => i < entries.length)
    if (index != null) return visit(order, index, { bound: shape.bound })
    // Cursor law, third clause: out of every cell, cells rest and the buffer
    // kindles again — only a buffer that SEATS one can. A page has nothing to
    // rest onto, so prose keeps the last reach.
    if (attended && shape.seatsBuffer) return { order: [], evicted: null }
    // Page opens at its first cell; program opens with none (bare already runs).
    if (!order.length && !shape.seatsBuffer) return { order: [0], evicted: null }
    return { order, evicted: null }
}

// ── TRANSITIONS ───────────────────────────────────────────────────────────
// World in, world out. Nothing writes through a container.

// THE PLACE LADDER (Law 1; id:light-ladders-place-axis).
// Head = where self is looking; light.kindled comes from there (Law 3 / P9).
// A peer event updates presence without moving it.
//
// A scalar could promote and never DEMOTE — leaving a draft left the light
// pointing at a place with nothing standing. No bound: a place is never
// evicted, only emptied.
const looksAt = (world, place) =>
    ({ ...world, places: visit(world.places, place, { bound: Infinity }).order })

// A place with nothing standing is not a place self can be looking at.
function emptied(world, place) {
    for (const page of world.records.values()) if (page.place === place) return world
    return { ...world, places: world.places.filter((p) => p !== place) }
}

// THE ONE DESTRUCTIVE MOVE — drop a record, answer what left, in Slot space.
// Only a record that SEATS its buffer takes the addr slot with it: a page
// never seated one (its cells are the figures).
function dropAt(world, witness, place, addr) {
    const key = recKey(witness, place, addr)
    const page = world.records.get(key)
    if (!page) return { world, gone: [] }
    // Read slots while the record still stands — `paints` asks the world.
    const was = standingSlots(world, page)

    const records = new Map(world.records)
    records.delete(key)
    let next = { ...world, records }

    const held = world.ladders.get(ladderKey(witness, place))
    if (held) {
        const pins = new Set(held.pins)
        pins.delete(addr)
        next = withLadder(next, witness, place,
                          { order: held.order.filter((a) => a !== addr), pins })
    }
    next = emptied(next, place)

    // A SEAT CAN CHANGE HANDS INSTEAD OF EMPTYING. A slot leaves only when
    // nothing still standing paints it — dropping self's draft hands the seat
    // to the friend's held record. Remove first and you blank the frame for a
    // beat and lose its lifetime.
    const still = new Set()
    for (const p of next.records.values()) {
        for (const sl of standingSlots(next, p)) still.add(sl)
    }
    return { world: next, gone: was.filter((sl) => !still.has(sl)) }
}

// Addr ladder within (witness, place): capacity 1, pins keep ambients.
// Answers the addr that left the order this visit (to stand down).
function visitAddr(world, witness, place, addr) {
    const held = ladderAt(world, witness, place)
    const { order, evicted } = visit(held.order, addr, { bound: 1, pinned: held.pins })
    return { world: withLadder(world, witness, place, { order, pins: held.pins }), evicted }
}

function pinAt(world, witness, place, addr) {
    const held = ladderAt(world, witness, place)
    const pins = new Set(held.pins)
    pins.add(addr)
    return withLadder(world, witness, place, { order: held.order, pins })
}

// THE ONE ANSWER — every verb ends here. No half-shape; no total missing.
// Totals always present; `gone` deduped so a caller may treat it as a set.
function finish(world, gone, runs, {
    source = null, merge = false,
    hatch = null, main = null, at = null,
    movesLight = false, place = null,
} = {}) {
    // Self / follow moves the light place. First seating on empty canvas also
    // establishes it (a lone peer watch still kindles).
    let next = world
    if (movesLight && place) next = looksAt(next, place)
    else if (!next.places.length && place && runs.length) next = looksAt(next, place)
    return {
        world: next,
        answer: {
            gone: gone.length > 1 ? [...new Set(gone)] : gone,
            runs,
            light: lightOf(next, attentionAt(next) ?? place),
            at, hatch, main, source, merge,
        },
    }
}

// THE LIVE-NODES RULE: every effect carries `nodes` (or `vocabNodes`) beside
// `code` whenever a live parse of that exact code is already held. `code`
// still rides — display and green-tree text key — but never the SOLE span source.
//
// Hazard: printAST(bare) drops cell lines with no gap placeholder. Re-parse
// that string alone and every node after a cell is stamped a line short of
// its true buffer line. Hand over the tree and spans stay true.
function seatFrom(world, addr, held, { name, ast, source, witness, place, attention, follow = false }) {
    const own = witness === world.self
    const cells = ast ? phaseCells(ast) : []
    const entries = cellEntries(addr, name, cells)
    const bare = cells.length ? stripCells(ast) : null
    const shape = shapeFor(cells, bare)
    const index = attention?.line == null || !cells.length
        ? null
        : cellAtLine(entries, attention.line)
    // Cell order uses entry indices; map held order forward.
    const { order, evicted } = ladder(held?.order ?? [], entries, index, shape, attention != null)

    // Self events and follow-attend move light; peer events only presence (P9).
    const movesLight = own || follow

    // A seat is a RUN — nothing seats when the record about to be written is
    // the record that already stands. Totals still speak (P5 re-attend, P6 sticky prose).
    if (held && held.source === source && held.shape === shape &&
        sameOrder(held.order, order)) {
        return finish(world, [], [], {
            source, merge: false,
            hatch: null, // pure light reaffirm — gate unmoved
            at: projectAt(shape, addr, held.entries, order),
            movesLight, place,
        })
    }

    const gone = []
    const runs = []
    let next = world

    // Addr ladder within this place: capacity 1 (+ pins). Evicted addr's figures leave.
    const stepped = visitAddr(next, witness, place, addr)
    next = stepped.world
    if (stepped.evicted != null && stepped.evicted !== addr) {
        const left = dropAt(next, witness, place, stepped.evicted)
        next = left.world
        gone.push(...left.gone)
    }

    // Cells the new split no longer has, and the one the ladder evicted.
    for (const i of held?.order ?? []) {
        if (i >= entries.length) {
            gone.push(asSlot(place, held.entries[i].node))
        } else if (!order.includes(i)) {
            gone.push(asSlot(place, entries[i].node))
        }
    }
    // finish() dedupes — no membership guard needed here.
    if (evicted != null && entries[evicted]) gone.push(asSlot(place, entries[evicted].node))

    const record = {
        entries, order, shape, witness, place, source, tree: ast, name, addr,
        // Program's bare half, held so a seat can change hands without
        // reprinting the tree (runsFor).
        bare: hasVocabulary(shape) ? bare : null,
        bareSource: hasVocabulary(shape) ? printAST(bare) : null,
    }
    const records = new Map(next.records)
    records.set(recKey(witness, place, addr), record)
    next = { ...next, records }

    // HATCH IS THE WITNESS, AND NOTHING ELSE.
    const hatch = own

    // A SHADOWED RECORD IS HELD, NOT DRAWN (see `paints`). Their push updates
    // the tree behind her draft and speaks every total; seats and removes
    // nothing — the slot is not theirs to paint.
    if (!paints(next, record)) {
        return finish(next, [], [], {
            source, merge: true,
            hatch, main: null,
            at: projectAt(shape, addr, entries, order),
            movesLight, place,
        })
    }

    if (!shape.bound) {
        const run = bufferRun(place, addr, name, source, { nodes: ast })
        runs.push(run)
        return finish(next, gone, runs, {
            source, merge: true,
            hatch,
            main: own ? run.slot : null,
            at: projectAt(shape, addr, entries, order),
            movesLight, place,
        })
    }

    // A whole-buffer ambient never burns beside its own cells — so a record
    // that seats no buffer takes down the one its predecessor seated.
    if (!shape.seatsBuffer && (!held || held.shape.seatsBuffer)) {
        gone.push(asSlot(place, addr))
    }

    if (hasVocabulary(shape)) {
        const vocab = printAST(bare)      // D019: bare code is their vocabulary
        for (const e of entries) { e.vocab = vocab; e.vocabNodes = bare }
    }

    const kindled = order.length ? entries[order[0]] : null
    const at = projectAt(shape, addr, entries, order)
    // Bare code re-runs only when it CHANGED — and `main` follows it (child
    // looking at the buffer, not a cell).
    const bareRan = hasVocabulary(shape) &&
        (!held || held.source !== source || held.shape !== shape)

    // Seats: kindled + warm window. No per-seat hatch/main flags (totals).
    if (kindled) runs.push(cellRun(place, kindled))
    for (const i of order.slice(1)) runs.push(cellRun(place, entries[i]))
    if (bareRan) runs.push(bufferRun(place, addr, name, printAST(bare), { nodes: bare }))

    // main: the figure the child is looking at — kindled cell if any; bare only when none.
    const main = !own ? null
        : kindled ? asSlot(place, kindled.node)
        : bareRan ? asSlot(place, addr)
        : null

    return finish(next, gone, runs, {
        source, merge: true,
        hatch: runs.length ? hatch : null,
        main, at, movesLight, place,
    })
}

// WITNESS AND PLACE ARE TWO AXES. `own` says only WHO; place is named by the surface.
const witnessOf = (world, witness, own) =>
    witness ?? (own === true ? world.self : own === false ? PEER : null)

function observe(world, { addr, name, doc, witness, own, place = CORESHELL, attention = null, follow = false }) {
    const w = witnessOf(world, witness, own)
    if (w == null) throw new TypeError("observe: name a witness (or own: true/false)")
    const held = world.records.get(recKey(w, place, addr))
    // No document means "the one that stands" — how `attend` calls in.
    // Re-normalizing would round-trip the text and look like an edit.
    const { ast, source } = doc === undefined && held
        ? { ast: held.tree, source: held.source }
        : asTree(world, w, place, addr, doc)

    return seatFrom(world, addr, held, {
        name, ast, source, witness: w, place, attention, follow,
    })
}

// ONE VERB, BY WITNESS (id:light-ladders-one-verb). My reach and their presence
// are the same call; only the witness differs.
//
// The record a reach steps is the one that PAINTS — the figure the reader is
// looking at, whoever authored it. Whose reach it is decides one thing only:
// whether the LIGHT moves with it. Mine claims the place; theirs is presence,
// and never takes the light from a hand in the other shell (P9).
function attend(world, { addr, line, place, witness }) {
    const w = witness ?? world.self
    const claims = w === world.self
    const page = recordFor(world, addr, place)
    if (!page || !page.shape.bound) {
        return finish(world, [], [], { movesLight: claims, place: page?.place ?? place })
    }
    return observe(world, {
        addr, name: page.name, witness: page.witness, place: page.place,
        attention: { line },
        follow: claims,
    })
}

// Leave-draft: drop SELF's record at place. Friend's was held behind it all
// along (see `paints`) — the figure that takes the seat back is theirs; no
// re-seat needed to un-blank the canvas. hatch:false closes self's gate.
function restore(world, { addr, place = OUTERSHELL }) {
    if (!world.records.has(recKey(world.self, place, addr))) return finish(world, [], [])
    const { world: next, gone } = dropAt(world, world.self, place, addr)
    // Held-behind takes the seat with THEIR OWN body — surface needs no re-seat;
    // canvas never shows a stale draft figure at a slot no longer hers.
    const theirs = recordFor(next, addr, place)
    return finish(next, gone, theirs ? runsFor(theirs) : [], { hatch: false, place })
}

// Shift+click. A paged addr toggles its PAGE off. A plain tab's PIN is its
// membership: off is drop, on is pin-then-seat (Cut 1). Always self's gesture.
function toggle(world, { addr, name, content, place = CORESHELL }) {
    const self = world.self
    if (recordFor(world, addr, place, self)?.shape.bound) {
        const { world: next, gone } = dropAt(world, self, place, addr)
        return finish(next, gone, [])
    }
    const probe = asTree(world, self, place, addr, content)
    let next = world
    if (!probe.ast || !phaseCells(probe.ast).length) {
        const { pins } = ladderAt(world, self, place)
        if (pins.has(addr) && world.records.has(recKey(self, place, addr))) {
            const dropped = dropAt(world, self, place, addr)
            return finish(dropped.world, dropped.gone, [])
        }
        next = pinAt(world, self, place, addr)
    }
    return observe(next, { addr, name, doc: content, witness: self, place, attention: null })
}

// Forget this addr entirely — EVERY witness's record, every place asked.
// Re-watch starts clean; nothing of it is left held.
function forget(world, { addr, place }) {
    const gone = []
    let next = world
    for (const p of place ? [place] : [CORESHELL, OUTERSHELL]) {
        // Asked, never enumerated — see witnessesOn. Snapshot first: each drop
        // answers a new world; the list must not shrink under the walk.
        for (const w of witnessesOn(next, addr, p)) {
            const dropped = dropAt(next, w, p, addr)
            next = dropped.world
            gone.push(...dropped.gone)
        }
    }
    return finish(next, gone, [])
}

// ── THE ONE DOOR ──────────────────────────────────────────────────────────
// step(world, event) → { world, answer }

const DOORS = { observe, attend, restore, toggle, forget }

export function step(world, event) {
    const door = DOORS[event?.kind]
    if (!door) throw new Error(`page-law: unknown event "${event?.kind}"`)
    return door(world, event)
}

// ── pageLaw() ─────────────────────────────────────────────────────────────
// Thin shell that owns a world and forwards. Face unchanged: `self` is whose
// law this is; `own` is a comparison against it, never a field.

export function pageLaw({ self = SELF } = {}) {
    let world = openWorld({ self })

    const walk = (event) => {
        const done = step(world, event)
        world = done.world
        return done.answer
    }

    return {
        // World itself — for a reader that asserts over the value, not a walk.
        world: () => world,

        observe: (addr, opts = {}) => walk({ kind: "observe", addr, ...opts }),
        attend: (addr, line, place, opts = {}) =>
            walk({ kind: "attend", addr, line, place, ...opts }),
        restore: (addr, place = OUTERSHELL) => walk({ kind: "restore", addr, place }),
        toggle: (addr, name, content, place = CORESHELL) =>
            walk({ kind: "toggle", addr, name, content, place }),
        forget: (addr, place) => walk({ kind: "forget", addr, place }),

        // Standing page of the child's own — the inner reach's gate.
        // A friend's page is walked from the outer surface, which holds its own reach.
        hasPage(addr, place) {
            const page = world.records.get(recKey(self, place ?? CORESHELL, addr))
                ?? world.records.get(recKey(self, OUTERSHELL, addr))
            return !!page?.shape.bound
        },
        // Standing tree — intra-session identity carrier (id:cmp-standing-primitives).
        // Diagnostics read it; queries memoize on its reuse units.
        tree: (addr, place, witness) => recordFor(world, addr, place, witness)?.tree ?? null,
        // Canvas seat for a document — Slot space (place:addr), the frame
        // registry's key. Asked, so no surface knows how a slot is spelled.
        seatOf: (addr, place) =>
            asSlot(recordFor(world, addr, place)?.place ?? place ?? CORESHELL, addr),
        witnessesOn: (addr, place) => witnessesOn(world, addr, place),
        // standing("coreshell") — non-plain own pages at place.
        standing(place = CORESHELL, witness = self) {
            const out = []
            for (const page of world.records.values()) {
                if (page.place === place && page.witness === witness && page.shape.bound) {
                    out.push(page.addr)
                }
            }
            return out
        },
        // Addr order for a place (head kindled) — syncTabs / ambient pin group.
        orderOf: (place = CORESHELL, witness = self) =>
            [...ladderAt(world, witness, place).order],
        slotsAt: (place) => slotsOf(world, place),
        // WHERE SELF IS LOOKING — "do I hold the light?", asked by any surface,
        // owned by none. A question, not a flag.
        attentionAt: () => attentionAt(world),
    }
}
