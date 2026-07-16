// =============================================================================
// weave/page.js — THE PAGE LAW (the extraction law applied to the page
// relation; stands beside ladder.js the way the ladder stands beside the
// surfaces: pure decision, effects out — no DOM, no turtle; node-tested in
// test/js/weave_page_test.mjs).
//
// One addr wears one of three shapes, decided by its document (id:gw-cell,
// the priority law):
//   PLAIN    — no ``` cells: the whole buffer draws, exclusive across kinds.
//   PROGRAM  — cells AND bare code: the bare code is the tab's ambient; the
//              cells are previews, dormant until reached (cursor-only —
//              ladder capacity 1). Previews fork from the PROGRAM (D019):
//              its code is their vocabulary, rehearsed lazily at seat time.
//   PAGE     — every executable line lives in cells: the kindled cell runs,
//              a warm window of two (ladder capacity 2); siblings DERIVE
//              from the one AST (sectionCells), never ferried beside it.
//
// Every transition returns consequences in the turtle's OWN transition
// alphabet, performed in order by the inner surface (inner.js perform()):
//
//   { op:'seat',   key, name, code, hatch?, vocab?, main? } — upsertAmbient (a seat RUNS)
//   { op:'draw',   addr, name, code, main:true }            — exclusive whole-buffer draw
//   { op:'remove', key }                                    — removeAmbient
//   { op:'clearLocal' }                                     — every _localKeys ambient leaves
//   { op:'kindle', key }                                    — focusAmbient by address
//   { op:'focus',  name } | { op:'focus', world:true }      — the one attention move
//   { op:'degree', name, degree, unlessFocused? }           — appearance only, never a run
//   { op:'reach',  index }                                  — reset the editor reach
//
// The two degrees are gw-appearance's axis: KINDLED (bright, running) and
// WARM (dimmed, waiting); EVICTED is a remove. A seat is a run, not a paint —
// so the law is idempotent where the canvas already burns: re-reaching the
// kindled cell emits nothing. That resolves the consequence-purity ⊗
// turtle-statefulness tension: speak transitions the turtle understands,
// never a naive desired-state diff.
//
// The slot ledger: who owns an addr's canvas slot — the friend's stream, a
// reviewer's live draft, or her page. ONE record with a lifecycle field
// (draft), not parallel registries; forget() drops the record whole, so no
// stale entry can block a re-watch or silently revive a dead draft.
//
// Addresses are the grammar's (key-is-address, decision 006): parseAddress
// owns ~/-ness (the resolver's shelf law), `${addr}#cellN` is the sibling
// cell's address. No prefix folklore.
// =============================================================================

import { visit } from "./ladder.js"
import { parseAddress } from "./resolve.js"
import { reparseProgram, printAST, sectionCells, stripCells } from "../turtling/parse.js"

// Fast fence probe — the full parse only for buffers that hold a cell.
const CELL_PROBE = /^[ \t]*```/m

const isLibrary = (addr) => parseAddress(addr).owner === "~"

// Sibling entries derive from the one AST: the key is the cell address; the
// first cell wears the page's name, so the outer focus flow lights it.
function cellEntries(addr, name, cells) {
    return cells.map(({ code, vocab, nodes, vocabNodes }, i) => ({
        key: `${addr}#cell${i + 1}`,
        name: i === 0 ? name : `${name}·${i + 1}`,
        code,
        vocab,
        // Live node slices of the one tree — the seat runs THESE; the code/
        // vocab strings stay as content keys and socket projections (the
        // partition never severs identity, specs/compiler.org id:cmp-vet).
        nodes,
        vocabNodes,
    }))
}

const seat = (entry, extra = {}) => ({
    op: "seat", key: entry.key, name: entry.name, code: entry.code, vocab: entry.vocab,
    nodes: entry.nodes, vocabNodes: entry.vocabNodes, ...extra,
})

export function pageLaw() {
    const pages = new Map() // addr → { entries, order, mode: 'preview'|'page', hatch }
    const slots = new Map() // addr → { draft, name, code } — the slot ledger

    function standDown(addr, effects) {
        const page = pages.get(addr)
        if (!page) return
        for (const i of page.order) effects.push({ op: "remove", key: page.entries[i].key })
        pages.delete(addr)
    }

    // Exclusive law across kinds: local pages stand down together; library
    // (~/) pages persist — they belong to the outershell, closed via forget.
    function standDownLocal(effects) {
        for (const addr of [...pages.keys()]) {
            if (!isLibrary(addr)) standDown(addr, effects)
        }
    }

    // The page attempt: paged:false for a cell-less/unparsable buffer — the
    // caller takes the plain path (parse errors surface there, as ever); a
    // de-fenced buffer's stale cells still stand down in the effects.
    function attempt(addr, name, content) {
        const effects = []
        let cells = []
        let ast = null
        if (CELL_PROBE.test(content)) {
            try {
                // The green tree (id:cmp-green-tree): the page's previous
                // tree is the reuse ground — an edit to one cell leaves the
                // sibling cells' nodes ===-identical, so their content keys,
                // memos, and (Phase 3) frames survive the keystroke.
                const held = pages.get(addr)
                ast = reparseProgram(content, held?.source ?? null, held?.program ?? null)
                cells = sectionCells(ast)
            } catch { cells = [] }
        }
        if (!cells.length) {
            standDown(addr, effects) // fences gone — the page stands down
            return { effects, paged: false }
        }
        const prev = pages.get(addr)
        // Entering a cell-bearing tab stands other local pages down.
        if (!prev) standDownLocal(effects)
        const entries = cellEntries(addr, name, cells)
        // Keep her place across edits; indexes past a shorter split clamp
        // away, and siblings from the longer previous split leave the canvas.
        const order = (prev?.order ?? []).filter((i) => i < entries.length)
        if (prev) {
            for (const i of prev.order) {
                if (i >= entries.length) effects.push({ op: "remove", key: prev.entries[i].key })
            }
        }
        const program = stripCells(ast)
        if (program.some((n) => n.type !== "Empty")) {
            // A PROGRAM: the bare code runs as the tab's ambient (cells
            // stripped, so a preview never runs twice); previews re-seat in
            // place, dormant until the cursor reaches them (D019: the
            // program is their vocabulary; the outline is ignored under the
            // priority law).
            const vocab = printAST(program)
            for (const e of entries) { e.vocab = vocab; e.vocabNodes = program }
            pages.set(addr, { entries, order, mode: "preview", hatch: false, source: content, program: ast })
            effects.push({ op: "reach", index: order[0] ?? null })
            for (const i of order) effects.push(seat(entries[i], { hatch: false }))
            effects.push({ op: "draw", addr, name, code: vocab, main: true })
            return { effects, paged: true }
        }
        // A PAGE: the kindled cell runs — hers, so it hatches; warm siblings
        // wait dimmed; the whole buffer never runs beside them.
        if (!order.length) order.push(0)
        if (!prev) effects.push({ op: "clearLocal" })
        pages.set(addr, { entries, order, mode: "page", hatch: true, source: content, program: ast })
        effects.push({ op: "remove", key: addr })
        effects.push({ op: "reach", index: order[0] })
        const kindled = entries[order[0]]
        effects.push(seat(kindled, { main: true }))
        effects.push({ op: "kindle", key: kindled.key })
        for (const i of order.slice(1)) {
            effects.push(seat(entries[i], { hatch: false }))
            effects.push({ op: "degree", name: entries[i].name, degree: "warm" })
        }
        return { effects, paged: true }
    }

    return {
        // Her edit: a weave buffer walks as its page; anything else draws
        // whole — and the plain draw is exclusive across kinds too.
        edit(addr, name, content) {
            const a = attempt(addr, name, content)
            if (a.paged) return a.effects
            standDownLocal(a.effects)
            a.effects.push({ op: "draw", addr, name, code: content, main: true })
            return a.effects
        },

        // One ladder step (scene 'cell'): the reached cell mounts and RUNS
        // (lazy — first parse/run happens at the seat); the ladder says what
        // warms and what leaves. Explicit, never inferred from focus history
        // — wandering focus elsewhere must not strand a bright sibling.
        reach(addr, index) {
            const page = pages.get(addr)
            if (!page) return []
            if (index == null) {
                // The cursor law's third clause: on bare code the cells rest
                // and the program regains the light; a pure page ignores —
                // prose keeps the last reach.
                if (page.mode !== "preview" || !page.order.length) return []
                const effects = page.order.map((i) => ({ op: "remove", key: page.entries[i].key }))
                page.order = []
                effects.push({ op: "focus", world: true })
                return effects
            }
            const entry = page.entries[index]
            if (!entry) return []
            // Re-reaching the kindled cell is a no-op — a seat re-runs, and
            // the law never re-runs what already burns.
            if (page.order[0] === index) return []
            const effects = [seat(entry, { hatch: page.hatch })]
            // A preview holds one cell (cursor-only); a page reads with a
            // warm window of two (the before/after).
            const { order, evicted } = visit(page.order, index, page.mode === "preview" ? 1 : 2)
            page.order = order
            if (evicted != null) effects.push({ op: "remove", key: page.entries[evicted].key })
            effects.push({ op: "focus", name: entry.name })
            for (const i of order.slice(1)) {
                effects.push({ op: "degree", name: page.entries[i].name, degree: "warm" })
            }
            return effects
        },

        // Shift+click: a weave buffer toggles its PAGE — never a whole-buffer
        // ambient standing beside its own cells. paged:false hands a plain
        // tab back to the turtle's own toggle (the sister-group restart).
        toggle(addr, name, content) {
            if (pages.has(addr)) {
                // Toggle OFF: previews/siblings down, and a preview tab's
                // program ambient with them.
                const effects = []
                standDown(addr, effects)
                effects.push({ op: "remove", key: addr })
                return { effects, paged: true }
            }
            return attempt(addr, name, content)
        },

        // A live draft from the review surface owns the addr's slot: the
        // page stands down while the intervention runs; the friend's stream
        // keeps recording underneath (friendPush), for the revert.
        draftSeat(addr, name, code) {
            const effects = []
            standDown(addr, effects)
            const slot = slots.get(addr) ?? {}
            slot.draft = true
            slots.set(addr, slot)
            effects.push({ op: "seat", key: addr, name, code })
            effects.push({ op: "degree", name, degree: "kindled" })
            return effects
        },

        // Draft frozen/ended — the slot reverts to the friend's code,
        // passively (no hatch). Nothing recorded, nothing to revert to.
        draftStop(addr) {
            const slot = slots.get(addr)
            if (slot) slot.draft = false
            if (slot?.code == null) return []
            return [{ op: "seat", key: addr, name: slot.name || addr, code: slot.code, hatch: false }]
        },

        // A friend's push (seeOuterShell success). The slot records always;
        // while drafted the running draft owns the canvas — record only.
        // A ~/ addr IS page-ness (the resolver's shelf law): the first cell
        // mounts and shows, the rest wait unevaluated until reached; a
        // re-push of a standing page (a view toggle) changes nothing.
        // merge: whether the caller streams the merge baseline this push.
        friendPush(addr, name, ast) {
            const code = printAST(ast)
            const slot = slots.get(addr) ?? {}
            slot.name = name
            slot.code = code
            slots.set(addr, slot)
            if (slot.draft) return { effects: [], code, merge: false }
            if (isLibrary(addr)) {
                if (pages.has(addr)) return { effects: [], code, merge: false }
                const cells = sectionCells(ast)
                if (cells.length) {
                    const entries = cellEntries(addr, name, cells)
                    pages.set(addr, { entries, order: [0], mode: "page", hatch: false })
                    return {
                        effects: [
                            seat(entries[0], { hatch: false }),
                            { op: "focus", name: entries[0].name },
                        ],
                        code,
                        merge: true,
                    }
                }
                // A cell-less page (pure prose) falls through: the meadow is
                // a no-op for the executor — the passive mount is right.
            }
            // Passive watch: render the friend but never hatch — their
            // drawing must not be reflected to the server as the user's.
            return {
                effects: [
                    { op: "seat", key: addr, name, code, hatch: false },
                    { op: "degree", name, degree: "warm", unlessFocused: true },
                ],
                code,
                merge: true,
            }
        },

        // Close/remove an addr entirely: cells down, ambient gone, the slot
        // ledger forgets — a later re-watch of the same friend starts clean.
        forget(addr) {
            const effects = []
            standDown(addr, effects)
            effects.push({ op: "remove", key: addr })
            slots.delete(addr)
            return effects
        },

        // Reads for the surface: is this addr a standing page; her local
        // pages (tab indicators mirror them — ~/ pages have no tab).
        hasPage(addr) {
            return pages.has(addr)
        },
        localPages() {
            return [...pages.keys()].filter((a) => !isLibrary(a))
        },
    }
}
