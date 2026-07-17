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

import { collectErrors } from "../turtling/parse.js"

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
// scheduler's errorRecord ({ message, span, phase: 'walk' }).
export function diagnostics(ast, ailments = []) {
    const out = []
    for (const node of ast ?? []) out.push(...nodeDiagnostics(node))
    for (const a of ailments) {
        out.push({
            message: a.message,
            span: a.span ?? null,
            phase: a.phase ?? "walk",
            source: a.name ?? null,
        })
    }
    return out
}
