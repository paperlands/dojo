// THE DIAGNOSTICS QUERY — first face over the resilient tree
// (id:cmp-memo-grain). Pure; the world cell carries these as the contract.
//
// THREE DUTIES, ALL FACTS:
//   gather   four kinds of hurt in one shape — the join is a concat
//   locate   every wound names its phase, its cell, and the cell's word
//   judge    WHICH wound the document speaks of, and whether it is well
//
// NO PROSE LIVES HERE. An authored wound carries FACTS for a sentence
// (`why`, `word`, `answersTo`, `standsOn`); a wound passed through keeps
// the words it was GIVEN. `weave/wound-view.js` is where facts become words.
//
// Memo at the REUSE-UNIT grain. reparseProgram answers a new root every
// edit — adoption reuses top-level units, never the root — so the WeakMap
// keys on unit nodes, where green-tree identity survives. A reused node
// answers its old array (same object = memo hit); a fresh node has none.
// No dirty flags; a missed reuse recomputes one unit, never a wrong answer.

import { collectErrors, phaseCells, phaseAt, cellAtLine, cellIdentities, dependentsOf, outlineFromAst } from "../turtling/parse.js"
import { cellKey, isSeatOf, rebase } from "../turtling/address.js"

const unitMemo = new WeakMap()

// The parse-half for one reuse unit, memoized on the node object.
export function nodeDiagnostics(node) {
    if (node == null || typeof node !== "object") return []
    let answer = unitMemo.get(node)
    if (!answer) {
        answer = collectErrors([node])
        unitMemo.set(node, answer)
    }
    return answer
}

// Standing walk ailments for one seat — frames whose address belongs to this
// plain tab or its page cells (scheduler.errors). Spans are absolute buffer
// lines: a sibling tab's line 7 must never cross into this buffer's ink.
// Live read, never memoized.
//
// TWO SPACES, ONE CONVERTER (id:light-ladders-place-axis). A figure RUNS at a
// Slot (place:addr); a reader ADDRESSES it as a Node (addr) — a friend knows
// nothing of my places. Select by `seat`, answer rebased to `key`; omit `key`
// and answer in seat space (canvas asking about its own frames).
//
// Grammar is turtling/address.js — string arithmetic lived here once, which
// is knowing a spelling that another module mints.
export function ailmentsFor(errors, seat, key = seat) {
    if (!errors || seat == null) return []
    const out = []
    for (const e of errors) {
        if (!isSeatOf(e.address, seat)) continue
        out.push(key === seat ? e : { ...e, address: rebase(e.address, seat, key) })
    }
    return out
}

// EVERY STANDING CANVAS AILMENT, IN ONE LIST — frames, seats that threw with
// no frame, phases whose vocabulary broke. Three holders, ONE law: a fault
// stands until the thing that raised it runs again. Nothing downstream learns
// there was more than one holder — that is this join's whole job.
//
// Only rehearsals dedupe, by where the hurt LIVES: cells of a phase share one
// vocabulary, so a broken line is one diagnostic, not one per cell.
export function standingAilments({ frames = [], seats = [], rehearsals = [] } = {}) {
    const out = [...frames, ...seats]
    const seen = new Set()
    for (const w of rehearsals) {
        const at = `${w.message}@${w.span?.line ?? "?"}`
        if (seen.has(at)) continue
        seen.add(at)
        out.push(w)
    }
    return out
}

// --- The gatherings. Each answers a LIST in the one wound shape, so joining
// --- them is a concat and locating them is one pass over all of them.

// The tree's own broken statements, memoized per reuse unit.
const parseWounds = (nodes, key) =>
    nodes.flatMap((node) => nodeDiagnostics(node).map((d) => ({ ...d, address: key })))

// The canvas's standing walk faults, normalized into the wound shape. An
// ailment keeps its OWN address — the frame that died — so a reader can break
// at the cell instead of smearing one death across the page.
const ailmentWounds = (ailments, key) =>
    (ailments ?? []).map((a) => ({
        message: a.message,
        span: a.span ?? null,
        kind: a.kind ?? "walk",
        source: a.name ?? null,
        address: a.address ?? key,
    }))

// TWO CELLS, ONE NAME (D024 rule 2). The first keeps the word; a later claimant
// answers to its coordinate and the collision is SAID — silence would seat two
// figures in one frame invisibly. Facts only; wound-view.js says them.
const nameWounds = (cells, ids, key) =>
    ids.flatMap((id, i) => !id.collides ? [] : [{
        kind: "name",
        why: id.why,
        word: cells[i].name,
        answersTo: id.id,
        span: cells[i].open == null ? null : { line: cells[i].open },
        source: null,
        address: key,
    }])

// WHO THE DEAD CELL TOOK WITH IT (D019's edge, walked backward). A cell
// inheriting a dead cell's vocabulary stands on a definition that never ran,
// and the page seats lazily — without this the child learns it only by
// reaching each one. No runtime for a fact already known.
//
// A CHILD OF THE DEATH THAT CAUSED IT, never a peer (rustc SubDiagnostic,
// LSP relatedInformation). The dominoes are the shape of the one problem, not
// three more. Counting them top-level would say "6 things wrong" for one line.
//
// Warning, not error: the dependent did not itself fail, so no verdict turns
// on it. A cell with its own fault is skipped — more specific. Costs no extra
// pass: the wound that killed the cell is already in hand.
const attachDependents = (cells, ids, wounds, key) => {
    const dead = new Map()   // cell index → the wound that killed it
    for (const w of wounds) {
        if (w.kind !== "walk" || w.span?.line == null) continue
        const at = cellAtLine(cells, w.span.line)
        if (at != null && !dead.has(at)) dead.set(at, w)
    }
    if (!dead.size) return

    const spoken = new Set(dead.keys())
    for (const [i, parent] of dead) {
        for (const k of dependentsOf(cells, i)) {
            if (spoken.has(k)) continue
            spoken.add(k)
            ;(parent.children ??= []).push({
                kind: "dependent",
                standsOn: ids[i].name ?? ids[i].id,   // the fact; the words are the view's
                span: cells[k].open == null ? null : { line: cells[k].open },
                source: null,
                address: cellKey(key, ids[k].id),
            })
        }
    }
}

// --- The locating. One pass, one prose walk, over every gathered wound.

// Every wound names WHERE it lives — the phase whose sisters it stands among,
// its cell slot, and the author's own word for that cell (D024). Derived from
// the LINE (attention is the address, D021), never stored, so nothing goes stale.
const locate = (w, nodes, cells, ids, marks) => {
    // Children are wounds too: each stands somewhere of its own, and the ink
    // must mark it there even while the voice folds it under its parent.
    const kids = w.children?.map((c) => locate(c, nodes, cells, ids, marks))
    if (w.span?.line == null) return kids ? { ...w, children: kids } : w
    const at = cellAtLine(cells, w.span.line)
    return {
        ...w,
        ...(kids ? { children: kids } : null),
        // marks is the one outlineFromAst for this diagnostics pass — N wounds
        // share one print, never one print each.
        phase: phaseAt(nodes, w.span.line, marks),
        cell: at,
        // Kept BESIDE the index, never instead of it: a display string and a
        // machine handle are two things.
        cellName: (at == null ? null : ids[at]?.name) ?? null,
    }
}

// A cheap GATE, never the rule: with no word on any fence there can be no
// collision, so a page that names nothing walks exactly as it did before.
const anyNamed = (nodes) => nodes.some((n) => n?.meta?.cellFence && n.meta.info?.trim())

// THE WHOLE ANSWER — four gatherings, one located list.
//
// A diagnostic is ADDRESSED (D022): a walk fault carries the address of the
// frame that died — for a page, the CELL — so a reader breaks AT the cell
// instead of smearing one death across the page. A parse error has no frame;
// its place is its span. Locating is pure over the tree we hold — a surface
// asks and paints; it does not compute the world.
export function diagnostics(ast, ailments = [], key = null) {
    const nodes = ast ?? []
    const gathered = [...parseWounds(nodes, key), ...ailmentWounds(ailments, key)]
    if (!gathered.length && !anyNamed(nodes)) return gathered

    // One print→outline for the whole pass: phaseCells and every locate share it.
    const marks = outlineFromAst(nodes)
    const cells = phaseCells(nodes, marks)
    const ids = cellIdentities(cells)
    // Dependents hang UNDER the death that caused them, so the top-level list
    // stays the real faults — what a reader counts and what a verdict weighs.
    attachDependents(cells, ids, gathered, key)
    const all = [...gathered, ...nameWounds(cells, ids, key)]
    return all.length ? all.map((w) => locate(w, nodes, cells, ids, marks)) : all
}

// THE TREE, FLAT — for a reader that must mark every hurt WHERE IT STANDS. The
// ink needs this; the voice does not, because folding is the point of the tree.
export const everyWound = (found) =>
    (found ?? []).flatMap((w) => (w.children ? [w, ...everyWound(w.children)] : [w]))

// WHAT MAKES TWO WOUNDS THE SAME WOUND — not object identity, which every ask
// rebuilds. The four facts a reader could tell apart. (Not `mark`: this file's
// `marks` are the outline print.)
export const fingerprint = (w) =>
    `${w.kind}:${w.address ?? "?"}:${w.message ?? ""}:${w.span?.line ?? "?"}`

// THE WOUND VOCABULARY — one row per kind; SEVERITY IS THE VERDICT AXIS.
// A fault is a wound at "error": the document is not well.
//
// The problem: two tables had already drifted. `name` set no severity, so the
// gutter defaulted it to "error" and inked RED — while the verdict, on its own
// list, called the document well and painted a friend ☀︎. Two fields that must
// agree is a place they can disagree.
//
// D020 is about the WALK, not the verdict: error nodes stay inert and healthy
// statements still draw. Severity turns on whether a friend may be told ☀︎ —
// a parse-broken buffer reflecting `success` was the peer seam lying.
export const KINDS = {
    parse:     { severity: "error" },     // the tree would not build
    walk:      { severity: "error" },     // it ran and died
    rehearsal: { severity: "error" },     // a vocabulary ancestor broke
    name:      { severity: "warning" },   // two cells, one word (D024 rule 2)
    dependent: { severity: "warning" },   // it stands on something that never ran
}

// An unknown kind is an ERROR: a hurt we cannot name must not be quietly
// downgraded. wound-view says it out loud rather than saying nothing.
export const severityOf = (w) => KINDS[w?.kind]?.severity ?? "error"

// THE WOUNDS A SURFACE SAYS OUT LOUD — one list, so the HUD, a friend's panel
// and a draft cannot disagree about what is worth a sentence.
export const announcements = (found) =>
    (found ?? []).filter((w) => severityOf(w) === "error")

// WHICH WOUND THE DOCUMENT SPEAKS OF — one selector, because two readers ask:
// the child's own HUD and the reflect reaching a friend must name the SAME
// fault. The buffer's own wins when there is one, being the most specific thing
// a document can say about itself; otherwise the first standing tenant's.
export const primaryWound = (found, key) => {
    const faults = announcements(found)
    return faults.find((w) => w.address === key) ?? faults[0] ?? null
}

// The verdict — one binary, one home. A DOCUMENT WITH A STANDING FAULT IS NOT
// WELL: a watcher must never have to RUN the code (or squint at underlines) to
// learn there is an error in it.
//
// Amends D020 for the VERDICT only. Execution still lets healthy parts live;
// `state` is document health, `diagnostics` are the wounds — only wounds are
// addressed; healthy cells keep their light (appearance rides a diagnostic's
// address, not this binary). The old rule bought silence: a page whose tenant
// died reflected `success`, and only a draft re-running the code could surface it.
//
// Answers WHETHER and WHICH, never how it reads — the surface says the wound
// through wound-view.js.
export function verdict(found, key) {
    const wound = primaryWound(found, key)
    return { state: wound ? "error" : "success", wound }
}
