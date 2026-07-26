// weave/page.js — THE SEATING LAW. Pure decision, no DOM and no turtle;
// tested in test/js/weave_page_test.mjs. Why it is one law and not three:
// one seating law (D023).
//
//   observe(addr, { name, doc, own, attention }) → answer
//
// One verb for every surface. `own` and `attention` are the ONLY difference
// between the child's own shell, the child's live draft on a friend's page,
// and a watched friend's push — so all three evaluate identically.
//
//   doc        string or AST. A friend's tree crosses the wire whole — reflect
//              the document (D022); the child's text parses here against the
//              held tree (green tree).
//   own        is this canvas the child's this transition? Sets the hatch and
//              the local-group exclusivity. Nothing else.
//   attention  { line } | null — where the reader is; attention is the address
//              (D021). null holds the standing order.
//
// THE ANSWER — two channels, two jobs:
//   { effects, landed, source, merge, paged }
//
//   effects    five canvas ops, each naming a target:
//                seat   key name code hatch? vocab? nodes? vocabNodes? main?
//                                                          — a seat RUNS
//                draw   addr name code nodes? main?        — exclusive whole buffer
//                remove key
//                focus  key name  |  world:true            — the one attention move
//                degree key degree unlessFocused?          — appearance, never a run
//   landed     where the ladder actually put the light, when that is not where
//              `attention` pointed. For the input organ, not the canvas — the
//              surface that owns that cursor applies it.
//
// THREE SHAPES, decided by the document alone (the cell shape rule,
// id:gw-cell):
//   plain    no ``` cells — the whole buffer is the unit.
//   program  cells AND bare code — the bare code runs; cells are dormant
//            until the cursor rests in one (ladder capacity 1). The bare
//            code is their vocabulary (outline-scoped vocabulary, D019).
//   page     all code in cells — the kindled cell runs, warm window of two.
//
// TWO ADDRESSINGS (D021): a LINE addresses an intention and crosses seams;
// an ORDINAL (`#cellN`) names a body for one evaluation and is the frame key,
// which must stay stable across edits.

import { visit } from "./ladder.js"
import { reparseProgram, printAST, phaseCells, stripCells, cellAtLine } from "../turtling/parse.js"

const CELL_PROBE = /^[ \t]*```/m        // cheap gate — no fence, no parse

// The first cell wears the page's name, so a surface holding only a tab NAME
// (the outer shell, the tab restore) lights the page by naming it. Nothing on
// the canvas is keyed by that name — seat, focus and degree all ride the key,
// because in a `program` the bare code wears this same name beside cell 1.
function cellEntries(addr, name, cells) {
    return cells.map(({ code, vocab, nodes, vocabNodes, open, end, path }, i) => ({
        key: `${addr}#cell${i + 1}`,
        name: i === 0 ? name : `${name}·${i + 1}`,
        code,
        vocab,
        open, end, path,        // the law resolves an incoming line through these
        nodes, vocabNodes,      // live slices of the one tree — the seat runs THESE
    }))
}

const seat = (entry, extra = {}) => ({
    op: "seat", key: entry.key, name: entry.name, code: entry.code, vocab: entry.vocab,
    nodes: entry.nodes, vocabNodes: entry.vocabNodes, ...extra,
})

const sameOrder = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

// Every verb answers in this shape, so no caller can pass the wrong half.
const answer = (effects, extra = {}) =>
    ({ effects, landed: null, source: null, merge: false, paged: false, ...extra })

// localKeys — () => [keys]: the whole-buffer ambients the canvas holds. The
// child's page claims the canvas alone and must NAME what it displaces; the
// law cannot see the group, so the surface injects the read.
export function pageLaw({ localKeys = () => [] } = {}) {
    // addr → { entries, order, mode, own, source, tree, name }
    const pages = new Map()
    // addr → { name, ast, source } — a friend's last push. Revert ground and
    // merge baseline; recorded on every push, displaced by none.
    const streams = new Map()

    const isPaged = (addr) => {
        const page = pages.get(addr)
        return !!page && page.mode !== "plain"
    }

    function standDown(addr, effects) {
        const page = pages.get(addr)
        if (!page) return
        for (const i of page.order) effects.push({ op: "remove", key: page.entries[i].key })
        pages.delete(addr)
    }

    // Exclusive across kinds: the child's pages stand down together. A
    // friend's persists — it belongs to the outershell, closed via forget.
    function standDownLocal(effects) {
        for (const [addr, page] of [...pages]) {
            if (page.own && page.mode !== "plain") standDown(addr, effects)
        }
    }

    // A document becomes a tree exactly once, whichever door it came through.
    // Unparsable degrades to plain: the parse errors surface at the draw.
    function asTree(addr, doc) {
        if (Array.isArray(doc)) return { ast: doc, source: printAST(doc) }
        if (!CELL_PROBE.test(doc)) return { ast: null, source: doc }
        const held = pages.get(addr)
        try {
            // Green tree (id:cmp-green-tree): the held tree is the reuse
            // ground, so an edit to one cell leaves its sisters' nodes
            // ===-identical and their frames survive the keystroke.
            return { ast: reparseProgram(doc, held?.source ?? null, held?.tree ?? null), source: doc }
        } catch {
            return { ast: null, source: doc }
        }
    }

    // `order` is the record's whole runtime state: which cells stand, kindled first.
    function ladder(prevOrder, entries, index, mode, attended) {
        const order = prevOrder.filter((i) => i < entries.length)
        if (index != null) return visit(order, index, mode === "program" ? 1 : 2)
        // The cursor law, third clause: out on bare code a program's cells
        // rest and the bare code regains the light. A page ignores it — prose
        // keeps the last reach.
        if (attended && mode === "program") return { order: [], evicted: null }
        // A page opens at its first cell; a program opens with none.
        if (!order.length && mode === "page") return { order: [0], evicted: null }
        return { order, evicted: null }
    }

    // The addr's own slot: the whole buffer, or a program's bare code. The
    // child's draws (exclusive — it replaces the local group); a friend's
    // seats passively.
    const slot = (addr, name, code, own, extra = {}) => own
        ? [{ op: "draw", addr, name, code, ...extra }]
        : [{ op: "seat", key: addr, name, code, hatch: false, ...extra },
           { op: "degree", key: addr, degree: "warm", unlessFocused: true }]

    function observe(addr, { name, doc, own = false, attention = null }) {
        const held = pages.get(addr)
        // No document means "the one that stands" — `attend`'s door.
        // Re-normalizing would round-trip the text and look like an edit.
        const { ast, source } = doc === undefined && held
            ? { ast: held.tree, source: held.source }
            : asTree(addr, doc)

        if (!own) streams.set(addr, { name, ast, source })

        // An owned canvas is not displaced by an unowned REPORT: while the
        // child drafts on a friend's addr, the friend's push records and does
        // not seat. Handing the canvas back is not a report — see restore.
        if (held?.own && !own) return answer([], { source, paged: isPaged(addr) })

        return seatFrom(addr, held, { name, ast, source, own, attention })
    }

    // THE LIVE-NODES RULE: every effect below carries `nodes` (or
    // `vocabNodes`) beside its `code` string whenever this function already
    // holds a live parse of that exact code. `code` still rides — for display
    // and the green-tree text key — but it is never the SOLE source of a span.
    //
    // The hazard it stands against: printAST(bare) below reprints a program's
    // bare code with its cells' lines dropped and no placeholder for the gap.
    // Re-parse that string on its own and every node after a cell is stamped a
    // line short of its true buffer line. Hand over the tree and spans stay true.
    function seatFrom(addr, held, { name, ast, source, own, attention }) {
        const cells = ast ? phaseCells(ast) : []
        const entries = cellEntries(addr, name, cells)
        const bare = cells.length ? stripCells(ast) : null
        const mode = !cells.length
            ? "plain"
            : bare.some((n) => n.type !== "Empty") ? "program" : "page"
        const index = attention?.line == null || !cells.length
            ? null
            : cellAtLine(entries, attention.line)
        const { order, evicted } = ladder(held?.order ?? [], entries, index, mode, attention != null)

        // A seat is a RUN, so the law emits nothing when the record it would
        // write is the record that already stands.
        if (held && held.source === source && held.own === own &&
            held.mode === mode && sameOrder(held.order, order)) {
            return answer([], { source, paged: mode !== "plain" })
        }

        const effects = []

        if (own && mode !== "plain" && !isPaged(addr)) standDownLocal(effects)
        if (own && mode === "page" && !isPaged(addr)) {
            for (const key of localKeys()) effects.push({ op: "remove", key })
        }
        // Cells the new split no longer has, and the one the ladder evicted.
        for (const i of held?.order ?? []) {
            if (i >= entries.length) effects.push({ op: "remove", key: held.entries[i].key })
            else if (!order.includes(i)) effects.push({ op: "remove", key: entries[i].key })
        }
        if (evicted != null && entries[evicted] && !effects.some((e) => e.key === entries[evicted].key)) {
            effects.push({ op: "remove", key: entries[evicted].key })
        }

        pages.set(addr, { entries, order, mode, own, source, tree: ast, name })

        if (mode === "plain") {
            if (own) standDownLocal(effects)
            // ast is null unless the ``` probe already paid for a parse that
            // found no real cell — nodes rides it either way (the live-nodes law).
            effects.push(...slot(addr, name, source, own, { main: own || undefined, nodes: ast }))
            return answer(effects, { source, merge: true })
        }

        // A whole-buffer ambient never burns beside its own cells. A program
        // keeps that slot — it is where the bare code lives.
        if (mode === "page" && (!held || held.mode !== "page")) {
            effects.push({ op: "remove", key: addr })
        }

        if (mode === "program") {
            const vocab = printAST(bare)      // D019: the bare code is their vocabulary
            for (const e of entries) { e.vocab = vocab; e.vocabNodes = bare }
        }

        // Spoken only when the ladder landed somewhere other than where
        // attention pointed; echoing the organ's own line back is a loop.
        const kindled = order.length ? entries[order[0]] : null
        const landed = !kindled
            ? (held ? null : { line: null })
            : (kindled.open === attention?.line ? null : { line: kindled.open })

        // A program's cells stay passive: the bare code is what is being made.
        const hatch = own && mode === "page"
        if (kindled) {
            effects.push(seat(kindled, { hatch, main: mode === "page" && own ? true : undefined }))
            // The light moves by KEY (D006) — as `degree` does. The name rides
            // along as the display label, never as the target: in a program the
            // bare code and the first cell wear the same one.
            effects.push({ op: "focus", key: kindled.key, name: kindled.name })
        }
        for (const i of order.slice(1)) {
            effects.push(seat(entries[i], { hatch: false }))
            effects.push({ op: "degree", key: entries[i].key, degree: "warm" })
        }
        // Bare code re-runs only when it CHANGED: a draw is exclusive and ends
        // by focusing its own key, so a ladder step must not echo it.
        if (mode === "program" && (!held || held.source !== source || held.mode !== mode)) {
            // nodes: bare, per the live-nodes rule above — printAST(bare) is
            // display/memo only, never re-derived from.
            effects.push(...slot(addr, name, printAST(bare), own, { main: own || undefined, nodes: bare }))
        }
        if (mode === "program" && !order.length && held?.order?.length) {
            effects.push({ op: "focus", world: true })
        }
        return answer(effects, { landed, source, merge: true, paged: true })
    }

    return {
        observe,

        // One ladder step: the same law with a new attention and the document
        // unchanged. Sugar, not a second path — and the door a followed peer's
        // line will come through.
        attend(addr, line) {
            const page = pages.get(addr)
            if (!page || page.mode === "plain") return answer([])
            return observe(addr, { name: page.name, own: page.own, attention: { line } })
        },

        // The draft ends: back to the friend's last push. Enters at seatFrom
        // because handing the canvas back is not a report about it — and
        // because `own` changes, the hatch gate is re-spoken even when
        // nothing was typed.
        restore(addr) {
            const stream = streams.get(addr)
            if (!stream) return answer([])
            return seatFrom(addr, pages.get(addr), {
                name: stream.name, ast: stream.ast, source: stream.source,
                own: false, attention: null,
            })
        },

        // Shift+click. paged:false hands a plain tab back to the turtle's own
        // toggle (the sister-group restart).
        toggle(addr, name, content) {
            if (isPaged(addr)) {
                const effects = []
                standDown(addr, effects)
                effects.push({ op: "remove", key: addr })
                return answer(effects, { paged: true })
            }
            const probe = asTree(addr, content)
            if (!probe.ast || !phaseCells(probe.ast).length) {
                const effects = []
                standDown(addr, effects)      // stale cells, if it just lost its fences
                return answer(effects)
            }
            return observe(addr, { name, doc: content, own: true, attention: null })
        },

        // Both ledgers forget, so a later re-watch starts clean.
        forget(addr) {
            const effects = []
            standDown(addr, effects)
            effects.push({ op: "remove", key: addr })
            streams.delete(addr)
            return answer(effects)
        },

        // Is this a standing page of the child's own — the inner reach's gate.
        // A friend's page is walked from the outer surface, which holds its
        // own reach.
        hasPage(addr) {
            const page = pages.get(addr)
            return !!page?.own && page.mode !== "plain"
        },
        // The standing tree — the intra-session identity carrier
        // (id:cmp-standing-primitives). Diagnostics read it; queries memoize
        // on its reuse units.
        tree(addr) {
            return pages.get(addr)?.tree ?? null
        },
        localPages() {
            return [...pages].filter(([, p]) => p.own && p.mode !== "plain").map(([addr]) => addr)
        },
    }
}
