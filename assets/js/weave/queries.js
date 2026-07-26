// The diagnostics query — the first face over the resilient tree
// (specs/compiler.org id:cmp-memo-grain). Pure functions; the world cell
// carries them as the registrant's contract.
//
// The memo law: memoize at the REUSE-UNIT grain. reparseProgram answers a
// new root array every edit — adoption reuses top-level units, never the
// root — so the WeakMap keys on the unit nodes, where green-tree identity
// actually survives. A reused node answers its old array (literally the
// same object — the memo-hit proof is identity); a fresh node has none.
// No dirty flags, no cache protocol; a missed reuse costs recomputing one
// unit, never a wrong answer.

import { collectErrors, phaseCells, phaseAt, cellAtLine } from "../turtling/parse.js"

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

// The whole answer: parse errors across the tree's units ⊕ standing walk
// ailments. Ailments are never memoized — the frame is the truth's owner
// and a live read cannot go stale; they arrive span-true from the
// scheduler's errorRecord ({ message, span, kind: 'walk' }).
// A diagnostic is ADDRESSED — reflect the document (D022): a walk fault carries the
// address of the frame that died — for a page, the CELL (`addr#cellN`) — so a
// reader can break with awareness at the cell instead of smearing one death
// across the whole page. A parse error has no frame; its true place is its
// span, and the document's own key is its address.
//
// The answer is WHOLE: every diagnostic also names WHERE it lives — the phase
// whose sisters it stands among, and the cell slot — both derived from its LINE
// through the one prose walk (attention is the address, D021). Locating is a
// pure function of the tree we already hold, so it belongs here beside the
// gathering, not in a surface: a surface asks and paints, it does not compute
// the world.
export function diagnostics(ast, ailments = [], key = null) {
    const out = []
    for (const node of ast ?? []) {
        for (const d of nodeDiagnostics(node)) out.push({ ...d, address: key })
    }
    for (const a of ailments) {
        out.push({
            message: a.message,
            span: a.span ?? null,
            kind: a.kind ?? "walk",
            source: a.name ?? null,
            address: a.address ?? key,
        })
    }
    if (!out.length) return out
    const cells = phaseCells(ast ?? [])
    return out.map((w) => (w.span?.line == null ? w : {
        ...w,
        phase: phaseAt(ast ?? [], w.span.line),
        cell: cellAtLine(cells, w.span.line),
    }))
}

// The verdict — one binary, one home. It is the SUBJECT's own fault and nothing
// else: a page is a container, and a tenant cell dying is that cell's diagnostic, not
// the page's death. A plain tab, a PROGRAM's bare code and a live draft ARE
// their own frame, so for them the verdict speaks. Everything else a reader
// needs is in the diagnostics, addressed.
export function verdict(found, key) {
    const own = (found ?? []).find((w) => w.kind === "walk" && w.address === key)
    return own
        ? { state: "error", message: own.message }
        : { state: "success", message: null }
}
