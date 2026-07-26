// Become, stage 1 — the seed law (specs/compiler/compiler.org
// id:cmp-become-seed). Run with: node --test test/js/become_test.mjs
//
// A seat whose seed is identical is skipped whole: the standing frame keeps
// running — clocks, transforms, mailbox, children, ink, standing error.
// Continuity is by REFUSAL, so the pins are identity pins (=== of the frame,
// of its mailbox, of its error record), never counters. fresh:true is the
// other door: an explicit restart gesture. The fault path stays byte-
// identical — become is the edit path, never fault handling (two doors).

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot } from "../../assets/js/turtling/scheduler.js"
import { parseProgram, reparseProgram, phaseCells } from "../../assets/js/turtling/parse.js"
import { Parser } from "../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../assets/js/turtling/mafs/evaluate.js"
import { checkTree, treeKey } from "./check_tree.mjs"

function makeScheduler() {
    return createScheduler(metaRoot(), {
        createDeps: () => ({
            mathParser: new Parser(),
            mathEvaluator: new Evaluator()
        }),
        execOpts: { color: '#e77808' }
    })
}

function fork(name, ast, { functions = null, userspace = null, color = '#e77808' } = {}) {
    return {
        name,
        code: { ast, functions },
        style: { color },
        env: userspace ? { userspace } : null
    }
}

describe("the seed law — an unchanged seat is skipped whole", () => {
    test("same seed answers the SAME frame: object, id, generator life", () => {
        const s = makeScheduler()
        const ast = parseProgram("loop 10 do\nfw 1\nwait 100\nend")
        const first = s.hotSwapChild("buf", fork("spiral", ast))
        const again = s.hotSwapChild("buf", fork("spiral", ast))
        assert.equal(again, first, "the frame is the same object")
        assert.equal(again.id, first.id, "no new lifetime was minted")
        assert.ok(!again.done, "still walking")
    })

    test("a fresh slice with ===-same elements is the same seed (adoption's product)", () => {
        const s = makeScheduler()
        const ast = parseProgram("fw 10\nrt 90")
        const first = s.hotSwapChild("buf", fork("spiral", ast))
        // Callers rebuild slice ARRAYS per edit; the elements carry identity.
        const again = s.hotSwapChild("buf", fork("spiral", [...ast]))
        assert.equal(again, first)
    })

    test("continuity by refusal: clock, elapsed, mailbox, channel all stand", () => {
        const s = makeScheduler()
        const ast = parseProgram("loop 10 do\nfw 1\nwait 100\nend")
        const frame = s.hotSwapChild("buf", fork("spiral", ast))
        s.tick(150)
        const resumeAt = frame.resumeAt
        const elapsed = frame.elapsedTime
        assert.ok(resumeAt > 0, "the walk is on its logical grid")
        frame.mailbox.push({ name: "ping", payload: 1 })
        const mailbox = frame.mailbox
        frame.channel.drain()

        const again = s.hotSwapChild("buf", fork("spiral", ast))
        assert.equal(again, frame)
        assert.equal(again.resumeAt, resumeAt, "the logical clock never blinked")
        assert.equal(again.elapsedTime, elapsed)
        assert.equal(again.mailbox, mailbox, "the mailbox is the same array")
        assert.ok(again.mailbox.some(m => m.name === "ping"), "messages survive the seat")
        assert.deepEqual(again.channel.drain(), [], "no clear event — the ink stands")
    })

    test("a changed seed is a rebirth — today's law, untouched", () => {
        const s = makeScheduler()
        const first = s.hotSwapChild("buf", fork("spiral", parseProgram("fw 10")))
        const second = s.hotSwapChild("buf", fork("spiral", parseProgram("fw 20")))
        assert.notEqual(second, first)
        assert.notEqual(second.id, first.id, "a new lifetime clears the old ink")
        assert.equal(second.address, first.address, "the address IS the identity")
        assert.ok(first.channel.closed, "the old body was terminated")
    })

    test("a vocabulary change is a changed seed (functions identity)", () => {
        const s = makeScheduler()
        const ast = parseProgram("fw 10")
        const nsA = { grow: { body: [], params: [] } }
        const nsB = { grow: { body: [], params: [] } }
        const first = s.hotSwapChild("buf", fork("cell", ast, { functions: nsA }))
        const same = s.hotSwapChild("buf", fork("cell", ast, { functions: nsA }))
        assert.equal(same, first, "the rehearsal cache's object is the vocab hash")
        const reborn = s.hotSwapChild("buf", fork("cell", ast, { functions: nsB }))
        assert.notEqual(reborn, first, "new ancestors, new meaning (D019)")
    })

    test("a color change is a changed seed", () => {
        const s = makeScheduler()
        const ast = parseProgram("fw 10")
        const first = s.hotSwapChild("buf", fork("spiral", ast))
        const reborn = s.hotSwapChild("buf", fork("spiral", ast, { color: "#123456" }))
        assert.notEqual(reborn, first)
    })

    test("a rename updates in place — display is a view, the address holds", () => {
        const s = makeScheduler()
        const ast = parseProgram("fw 10")
        const first = s.hotSwapChild("buf", fork("spiral", ast))
        const renamed = s.hotSwapChild("buf", fork("coil", ast))
        assert.equal(renamed, first, "same frame")
        assert.equal(renamed.name, "coil", "new display name")
        assert.equal(renamed.address, "buf")
    })

    test("fresh:true is the restart door — rebirth on an unchanged seed", () => {
        const s = makeScheduler()
        const ast = parseProgram("fw 10")
        const first = s.hotSwapChild("buf", fork("spiral", ast))
        const reborn = s.hotSwapChild("buf", fork("spiral", ast), { fresh: true })
        assert.notEqual(reborn, first)
        assert.notEqual(reborn.id, first.id)
        assert.equal(reborn.address, first.address)
    })
})

describe("the felt win — sibling cells survive the edit", () => {
    const page = (cell2) => [
        "###",
        "a meadow with two cells",
        "```",
        "fw 10",
        "```",
        "```",
        cell2,
        "```",
        "###",
    ].join("\n")

    test("an edit to one cell leaves the sibling's frame untouched", () => {
        const s = makeScheduler()
        const text1 = page("rt 90")
        const ast1 = parseProgram(text1)
        checkTree(ast1)
        const cells1 = phaseCells(ast1)
        const c1 = s.hotSwapChild("addr#cell1", fork("page", cells1[0].nodes))
        const c2 = s.hotSwapChild("addr#cell2", fork("page·2", cells1[1].nodes))

        // The child's edit to cell 2 — the page record's held pair is the reuse ground.
        const text2 = page("rt 45")
        const ast2 = reparseProgram(text2, text1, ast1)
        checkTree(ast2)
        const cells2 = phaseCells(ast2)
        const c1again = s.hotSwapChild("addr#cell1", fork("page", cells2[0].nodes))
        const c2again = s.hotSwapChild("addr#cell2", fork("page·2", cells2[1].nodes))

        assert.equal(c1again, c1, "the untouched cell's frame never blinked")
        assert.notEqual(c2again, c2, "the edited cell re-runs")
    })

    test("the skip never rewrites the tree (walk-immutability probe)", () => {
        const s = makeScheduler()
        const ast = parseProgram("loop 5 do\nfw 1\nwait 100\nend")
        const before = treeKey(ast)
        s.hotSwapChild("buf", fork("spiral", ast))
        s.tick(250)
        s.hotSwapChild("buf", fork("spiral", ast))
        assert.equal(treeKey(ast), before, "walk and skip read, never write")
        checkTree(ast)
    })
})

describe("two doors — become is the edit path, never fault handling", () => {
    test("a fault still kills the frame exactly as before", () => {
        const s = makeScheduler()
        const ast = parseProgram("wiggle 5")
        const frame = s.hotSwapChild("buf", fork("spiral", ast))
        assert.ok(frame.done, "the frame died at the walk")
        assert.ok(frame.error, "and wears its structured wound")
        assert.equal(frame.error.kind, "walk")
    })

    test("an unchanged seat leaves a standing error standing — same record", () => {
        const s = makeScheduler()
        const ast = parseProgram("wiggle 5")
        const frame = s.hotSwapChild("buf", fork("spiral", ast))
        const record = frame.error
        const again = s.hotSwapChild("buf", fork("spiral", ast))
        assert.equal(again, frame, "still erring, still the same identity")
        assert.equal(again.error, record, "the born fact was not re-minted")
    })

    test("the healing edit is a rebirth that clears the diagnostic", () => {
        const s = makeScheduler()
        const broken = s.hotSwapChild("buf", fork("spiral", parseProgram("wiggle 5")))
        assert.ok(broken.error)
        const healed = s.hotSwapChild("buf", fork("spiral", parseProgram("fw 5")))
        assert.notEqual(healed, broken)
        assert.equal(healed.error, null)
        assert.ok(!healed.done || healed.commandCount > 0, "the healed walk ran")
    })
})
