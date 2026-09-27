// `as <name> <frame> do` names a FRAME OF REFERENCE, and any frame can be one.
// Run: node --test test/js/runtime/reference_frame_test.mjs
//
// The lookup used to walk ancestors only, so a sibling — the ordinary case —
// silently resolved to nothing and the deposit went home. Wrong figure, no
// word said. Two laws are pinned here:
//
//   1. ANY frame resolves: sibling, ancestor, cousin, another tab's subtree.
//      Nearest still wins, so locality decides between two of the same name.
//   2. A name that resolves to NOTHING is said out loud — at the frame's end,
//      so a reference defined later still works.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot, findReferenceFrame } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

// Run a program to rest, reporting where each path event landed and what was
// said. `from` is the depositing frame's id — ink with none is a frame's own pen.
function walk(src, ticks = 80) {
    const s = createScheduler(metaRoot(), { createDeps: realDeps, execOpts: { color: '#e77808' } })
    s.hotSwapChild("buf", {
        name: "w", code: { ast: parseProgram(src), functions: null },
        style: { color: '#e77808' }, env: null,
    })
    const deposits = []
    const collect = () => {
        for (const f of s.registry.values()) {
            for (const e of f.channel.drain()) {
                if (e.type === 'path') deposits.push({ landedIn: f.name, deposited: e.sourceId != null })
            }
        }
    }
    collect()
    for (let t = 0; t < ticks && !s.done; t++) { s.tick(t * 16); collect() }
    return { deposits, wounds: s.errors.map(e => e.message) }
}

// Did `name`'s layer receive ink that some OTHER frame deposited into it?
const wasDepositedInto = (r, name) =>
    r.deposits.some(d => d.landedIn === name && d.deposited)

describe("a frame of reference can be any frame", () => {
    test("an ancestor", () => {
        const r = walk(`
as parent do
  as kid parent do
    fw 20
  end
end`)
        assert.ok(wasDepositedInto(r, "parent"))
        assert.deepEqual(r.wounds, [])
    })

    test("a sibling", () => {
        const r = walk(`
as a do
  fw 10
end
as b a do
  fw 20
end`)
        assert.ok(wasDepositedInto(r, "a"), "b's ink belongs to a, not to b")
        assert.deepEqual(r.wounds, [])
    })

    test("a cousin, deep in another subtree", () => {
        const r = walk(`
as branch do
  as leaf do
    fw 1
  end
end
as painter leaf do
  fw 20
end`)
        assert.ok(wasDepositedInto(r, "leaf"))
        assert.deepEqual(r.wounds, [])
    })

    test("the reserved name `world`", () => {
        const r = walk(`
as b world do
  fw 20
end`)
        assert.ok(wasDepositedInto(r, "w"))
        assert.deepEqual(r.wounds, [])
    })
})

describe("a reference that names nothing is said out loud", () => {
    test("a name that exists nowhere wounds", () => {
        const r = walk(`
as b nowhere do
  fw 20
end`)
        assert.equal(r.wounds.length, 1)
        assert.match(r.wounds[0], /no 'nowhere' to draw in/)
    })

    test("a reference defined LATER still resolves — no wound", () => {
        const r = walk(`
as b later do
  wait 0.02
  fw 20
end
as later do
  fw 5
end`)
        assert.deepEqual(r.wounds, [], "the reference arrived before b finished")
        assert.ok(wasDepositedInto(r, "later"))
    })

    test("finishing before the reference exists is a TRUE report", () => {
        // b draws and ends in the same instant it was born, so its ink really
        // did go home. Saying nothing here is what hid the sibling bug.
        const r = walk(`
as b later do
  fw 20
end
as later do
  fw 5
end`)
        assert.equal(r.wounds.length, 1)
        assert.match(r.wounds[0], /no 'later' to draw in/)
    })

    test("a healthy frame with no reference says nothing", () => {
        const r = walk(`
as plain do
  fw 20
end`)
        assert.deepEqual(r.wounds, [])
    })
})

// The wide search is O(tree) and is asked once per pass AND once per drawn
// layer, so the answer is memoized against a tree generation. A memo is only
// as good as what invalidates it — these are the events that must.
describe("the reference memo lets go when it should", () => {
    const idle = "loop 50 do\n  wait 0.016\nend"
    const fork = (name, ast) => ({ name, code: { ast, functions: null }, style: { color: '#e77808' }, env: null })

    function twoFrames() {
        const s = createScheduler(metaRoot(), { createDeps: realDeps, execOpts: { color: '#e77808' } })
        const ast = parseProgram(idle)
        s.hotSwapChild("a", fork("alpha", ast))
        s.hotSwapChild("b", fork("beta", ast))
        return { s, ast, b: s.root.children.get("b") }
    }

    test("a spawn makes a missing name findable", () => {
        const s = createScheduler(metaRoot(), { createDeps: realDeps, execOpts: { color: '#e77808' } })
        const ast = parseProgram(idle)
        s.hotSwapChild("b", fork("beta", ast))
        const b = s.root.children.get("b")
        assert.equal(findReferenceFrame(b, "alpha"), null, "nothing to find yet — miss is cached")
        s.hotSwapChild("a", fork("alpha", ast))
        assert.ok(findReferenceFrame(b, "alpha"), "the spawn let the memo go")
    })

    test("a removal stops a name resolving", () => {
        const { s, b } = twoFrames()
        assert.ok(findReferenceFrame(b, "alpha"), "hit is cached")
        s.removeChild("a")
        assert.equal(findReferenceFrame(b, "alpha"), null,
            "a memo must never hand back a frame that left the tree")
    })

    test("a rename is a resolution change even though the shape held", () => {
        const { s, ast, b } = twoFrames()
        assert.ok(findReferenceFrame(b, "alpha"), "hit is cached")
        // Same seed → the frame is kept and only its display name moves.
        s.hotSwapChild("a", fork("gamma", ast))
        assert.equal(findReferenceFrame(b, "alpha"), null, "the old name is gone")
        assert.ok(findReferenceFrame(b, "gamma"), "and the new one answers")
    })

    test("kin outrank a stranger of the same name", () => {
        // Nearest is nearest by TREE DISTANCE, so `kid` means a different frame
        // depending on who asks — names collide across tabs.
        const s = createScheduler(metaRoot(), { createDeps: realDeps, execOpts: { color: '#e77808' } })
        s.hotSwapChild("l", fork("left", parseProgram(`as kid do\n${idle}\nend\n${idle}`)))
        s.hotSwapChild("r", fork("right", parseProgram(`as kid do\n${idle}\nend\n${idle}`)))
        const left = s.root.children.get("l")
        const right = s.root.children.get("r")
        const fromLeft = findReferenceFrame(left, "kid")
        const fromRight = findReferenceFrame(right, "kid")
        assert.ok(fromLeft && fromRight)
        assert.notEqual(fromLeft, fromRight, "each sees its own child, not the other's")
    })
})
