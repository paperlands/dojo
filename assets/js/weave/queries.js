// The diagnostics query — the first face over the resilient tree
// (specs/compiler.org id:cmp-memo-grain). Pure functions; the world cell
// carries them as the registrant's contract.
//
// THREE DUTIES, ALL OF THEM FACTS:
//   gather   four kinds of hurt in one shape, so the join is a concat.
//   locate   every wound names its phase, its cell, and the cell's word.
//   judge    WHICH wound the document speaks of, and whether it is well.
//
// NO PROSE LIVES HERE. An authored wound carries the FACTS for a sentence
// (`why`, `word`, `answersTo`, `standsOn`); a wound passed through keeps the
// words it was GIVEN, quoted. `weave/wound-view.js` is where facts become words.
//
// The memo law: memoize at the REUSE-UNIT grain. reparseProgram answers a
// new root array every edit — adoption reuses top-level units, never the
// root — so the WeakMap keys on the unit nodes, where green-tree identity
// actually survives. A reused node answers its old array (literally the
// same object — the memo-hit proof is identity); a fresh node has none.
// No dirty flags, no cache protocol; a missed reuse costs recomputing one
// unit, never a wrong answer.

import { collectErrors, phaseCells, phaseAt, cellAtLine, cellIdentities, dependentsOf, cellKey, outlineFromAst } from "../turtling/parse.js"

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

// A buffer's standing walk ailments out of the scheduler's one error scan
// (scheduler.errors): frames whose address TOP SEGMENT is the buffer's key
// — the plain tab itself (key) or its page cells (key#cellN). Spans are
// absolute buffer lines, so a sibling tab's line 7 must never cross into
// this buffer's ink. Live read, never memoized.
export function ailmentsFor(errors, key) {
    if (!errors || key == null) return []
    return errors.filter((e) => {
        const top = String(e.address ?? "").split("/")[0]
        return top === key || top.startsWith(`${key}#`)
    })
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
// inheriting a dead cell's vocabulary stands on a definition that never ran, and
// the page seats lazily — so without this the child learns it only by reaching
// each one. No runtime for a fact already known.
//
// A warning, not an error: the dependent did not itself fail, and it is not a
// FAULT kind, so no verdict turns on it. A cell with its own fault is skipped —
// that is the more specific thing to say.
const dependentWounds = (cells, ids, wounds, key) => {
    const dead = new Set()
    for (const w of wounds) {
        if (w.kind !== "walk" || w.span?.line == null) continue
        const at = cellAtLine(cells, w.span.line)
        if (at != null) dead.add(at)
    }
    if (!dead.size) return []

    const spoken = new Set(dead)
    const out = []
    for (const i of dead) {
        for (const k of dependentsOf(cells, i)) {
            if (spoken.has(k)) continue
            spoken.add(k)
            out.push({
                kind: "dependent",
                standsOn: ids[i].name ?? ids[i].id,   // the fact; the words are the view's
                severity: "warning",
                span: cells[k].open == null ? null : { line: cells[k].open },
                source: null,
                address: cellKey(key, ids[k].id),
            })
        }
    }
    return out
}

// --- The locating. One pass, one prose walk, over every gathered wound.

// Every wound names WHERE it lives — the phase whose sisters it stands among,
// its cell slot, and the author's own word for that cell (D024). Derived from
// the LINE (attention is the address, D021), never stored, so nothing goes stale.
const locate = (w, nodes, cells, ids, marks) => {
    if (w.span?.line == null) return w
    const at = cellAtLine(cells, w.span.line)
    return {
        ...w,
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
// A diagnostic is ADDRESSED (D022): a walk fault carries the address of the frame
// that died — for a page, the CELL — so a reader breaks AT the cell instead of
// smearing one death across the page. A parse error has no frame; its place is
// its span. Locating is pure over the tree we already hold, so it belongs here:
// a surface asks and paints, it does not compute the world.
export function diagnostics(ast, ailments = [], key = null) {
    const nodes = ast ?? []
    const gathered = [...parseWounds(nodes, key), ...ailmentWounds(ailments, key)]
    if (!gathered.length && !anyNamed(nodes)) return gathered

    // One print→outline for the whole pass: phaseCells and every locate share it.
    const marks = outlineFromAst(nodes)
    const cells = phaseCells(nodes, marks)
    const ids = cellIdentities(cells)
    const all = [
        ...gathered,
        ...nameWounds(cells, ids, key),
        ...dependentWounds(cells, ids, gathered, key),
    ]
    return all.length ? all.map((w) => locate(w, nodes, cells, ids, marks)) : all
}

// WHAT COUNTS AS A FAULT. A frame that died and a vocabulary that never
// rehearsed are one piece of news: the code did not happen. Parse wounds are not
// here — the healthy parts drew (D020), so they are ink, never a verdict.
const FAULT = new Set(["walk", "rehearsal"])

// THE WOUNDS A SURFACE SAYS OUT LOUD — one list, so the HUD, a friend's panel
// and a draft cannot disagree about what is worth a sentence.
export const announcements = (found) => (found ?? []).filter((w) => FAULT.has(w.kind))

// WHICH WOUND THE DOCUMENT SPEAKS OF — one selector, because two readers ask:
// the child's own HUD and the reflect reaching a friend must name the SAME
// fault. The buffer's own wins when there is one, being the most specific thing
// a document can say about itself; otherwise the first standing tenant's.
export const primaryWound = (found, key) => {
    const faults = announcements(found)
    return faults.find((w) => w.address === key) ?? faults[0] ?? null
}

// The verdict — one binary, one home. A DOCUMENT WITH A DEAD CELL IS NOT WELL:
// a watcher must never have to RUN the code to learn there is an error in it.
//
// This amends D020 for the VERDICT only. `state` is the document's health,
// `diagnostics` are the wounds, and only the wounds are addressed — healthy
// cells keep their light, because appearance rides a diagnostic's address, not
// this binary. The old rule bought silence: a page whose tenant died reflected
// `success`, so only a draft re-running the code could surface it.
//
// It answers WHETHER and WHICH, never how it reads — the surface says the wound
// through wound-view.js.
export function verdict(found, key) {
    const wound = primaryWound(found, key)
    return { state: wound ? "error" : "success", wound }
}
