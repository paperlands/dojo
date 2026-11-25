// Capture and restore across the page/scheduler seam: one source record carries the
// offered choices; a fresh seat applies them at birth, not as a synthetic drag.
// (id:laws-construction-input)
import { test } from "node:test"
import assert from "node:assert/strict"
import { OUTERSHELL, PEER, SELF, pageLaw } from "../../../assets/js/weave/page.js"
import { cellIdentities, parseProgram, phaseCells } from "../../../assets/js/turtling/parse.js"
import { buildWorld, fork, drive, worldOf } from "./harness.mjs"

const SRC = "goto 5 0\nlet p"
const CAP = {
    v: 1,
    inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 3, 0] } }],
}
const near = (a, b) => assert.deepEqual(a.map((v) => +v.toFixed(6)), b)

test("a plain source record carries its choices into the run", () => {
    const law = pageLaw()
    const ans = law.observe("doc1", { name: "doc", doc: SRC, own: true, choices: CAP })
    const run = ans.runs.find((r) => !String(r.node).includes("#"))
    assert.ok(run, "a plain document seats one buffer run")
    assert.deepEqual(run.choices, CAP)
})

test("the same source and choices hold with no run; the choice is still spoken", () => {
    const law = pageLaw()
    law.observe("doc1", { name: "doc", doc: SRC, own: true, choices: CAP })
    const again = law.observe("doc1", { name: "doc", doc: SRC, own: true })
    assert.deepEqual(again.runs, [], "source idempotence still wins")
    assert.deepEqual(law.choicesOf("doc1"), CAP, "the held record's offer remains readable")
})

test("a choice-only same-source report updates the held record without a source run", () => {
    const law = pageLaw()
    law.observe("doc1", { name: "doc", doc: SRC, own: true, choices: CAP })
    const next = {
        v: 1,
        inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 6, 0] } }],
    }
    const changed = law.observe("doc1", { name: "doc", doc: SRC, own: true, choices: next })
    assert.ok(changed.runs.length, "a choice delta is a resident seating request")
    assert.deepEqual(changed.runs[0].choices, next)
    assert.deepEqual(law.choicesOf("doc1"), next, "the held record updated without a source run")

    const back = law.observe("doc1", { name: "doc", doc: SRC, own: true })
    assert.deepEqual(back.runs, [], "no news means no reoffer")
    assert.deepEqual(law.choicesOf("doc1"), next, "the held record kept the newer offer")
})

test("a shadowed peer choice delta updates its record but never signals the draft", () => {
    const law = pageLaw()
    const addr = "shadow"
    const peer = "goto 5 0\nlet p"
    const draft = "goto 20 0\nlet p\nwait 1"
    const offer = (x) => ({
        v: 1,
        inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, x, 0] } }],
    })
    law.observe(addr, { name: "peer", doc: peer, witness: PEER, place: OUTERSHELL, choices: offer(1) })
    law.observe(addr, { name: "draft", doc: draft, witness: SELF, place: OUTERSHELL, choices: offer(10) })
    const ans = law.observe(addr, { name: "peer", doc: peer, witness: PEER, place: OUTERSHELL, choices: offer(2) })
    assert.deepEqual(ans.runs, [], "a shadowed record emits no seating request")
    assert.deepEqual(law.choicesOf(addr, OUTERSHELL, PEER), offer(2),
        "the held peer record still owns the new offer")
})

test("a new draft snapshots the peer offer; later peer updates do not follow in", () => {
    const law = pageLaw()
    const addr = "draftbase"
    law.observe(addr, { name: "peer", doc: SRC, witness: PEER, place: OUTERSHELL, choices: CAP })
    const inherited = law.choicesOf(addr, OUTERSHELL, PEER)
    assert.deepEqual(inherited, CAP, "the painted peer's offer is the draft's starting base")

    law.observe(addr, {
        name: "draft", doc: "goto 20 0\nlet p", witness: SELF, place: OUTERSHELL, choices: inherited,
    })
    const next = {
        v: 1,
        inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 6, 0] } }],
    }
    law.observe(addr, { name: "peer", doc: SRC, witness: PEER, place: OUTERSHELL, choices: next })

    assert.deepEqual(law.choicesOf(addr, OUTERSHELL, SELF), CAP, "the draft keeps its own snapshot")
    assert.deepEqual(law.choicesOf(addr, OUTERSHELL, PEER), next, "the peer record owns the newer offer")
})

test("live legacy null keeps the held offer; explicit empty is the clear", () => {
    const law = pageLaw()
    law.observe("doc1", { name: "doc", doc: SRC, own: true, choices: CAP })
    const legacy = law.observe("doc1", { name: "doc", doc: SRC, own: true, choices: null })
    assert.deepEqual(legacy.runs, [])
    assert.deepEqual(law.choicesOf("doc1"), CAP, "legacy null is unspecified, not a clear")

    const empty = law.observe("doc1", {
        name: "doc", doc: SRC, own: true, choices: { v: 1, inputs: [] },
    })
    assert.ok(empty.runs.length, "an explicit empty capsule is a real delta")
    assert.deepEqual(empty.runs[0].choices, { v: 1, inputs: [] })
    assert.deepEqual(law.choicesOf("doc1"), { v: 1, inputs: [] })
})

test("a fresh seat applies the record's offered choice at birth", () => {
    const law = pageLaw()
    const ans = law.observe("doc1", { name: "doc", doc: SRC, own: true, choices: CAP })
    const run = ans.runs.find((r) => !String(r.node).includes("#"))
    const s = buildWorld()
    s.offerAt(run.slot, run.choices)
    const host = s.hotSwapChild(run.slot, fork(run.slot, run.code))
    drive(s)
    near(worldOf(host.children.get("p")), [5, 3, 0])
    assert.deepEqual(s.handChoices(host), [{ names: ["p"], action: { kind: "translation", by: [0, 3, 0] } }])
    // The lender's exact call: page law speaks the raw seat key, not the frame.
    assert.deepEqual(s.handChoices(run.slot), [{ names: ["p"], action: { kind: "translation", by: [0, 3, 0] } }])
    const captured = {
        v: 1,
        inputs: s.handChoices(run.slot).map(({ names, action }) => ({ route: { root: "document", names }, action })),
    }
    s.offerChoices(host, {
        v: 1,
        inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 5, 0] } }],
    })
    near(worldOf(host.children.get("p")), [5, 5, 0])
    assert.deepEqual(captured.inputs[0].action.by, [0, 3, 0], "the cut sampled the old choice, not a later one")
})

test("a changed baseline keeps the same offered adjustment", () => {
    const law = pageLaw()
    const first = law.observe("doc1", { name: "doc", doc: SRC, own: true, choices: CAP })
    const run1 = first.runs.find((r) => !String(r.node).includes("#"))
    const s = buildWorld()
    s.offerAt(run1.slot, run1.choices)
    s.hotSwapChild(run1.slot, fork(run1.slot, run1.code))
    drive(s)

    const edited = "goto 10 0\nlet p"
    law.observe("doc1", { name: "doc", doc: edited, own: true, choices: CAP })
    const run2 = { slot: run1.slot, code: edited }
    const host = s.hotSwapChild(run2.slot, fork(run2.slot, run2.code), { fresh: true })
    drive(s)
    near(worldOf(host.children.get("p")), [10, 3, 0])
})

test("a cell-root offer binds to that cell's seat, not a delimiter guess", () => {
    const src = "###\n```\ngoto 5 0\nlet p\n```\n###"
    const cells = phaseCells(parseProgram(src))
    const id = cellIdentities(cells)[0].id
    const cap = {
        v: 1,
        inputs: [{ route: { root: { cell: id }, names: ["p"] }, action: { kind: "translation", by: [0, 3, 0] } }],
    }
    const law = pageLaw()
    const ans = law.observe("doc3", { name: "doc", doc: src, own: true, choices: cap })
    const run = ans.runs.find((r) => r.cell === id)
    assert.ok(run, "the cell run exists")
    assert.deepEqual(run.choices, {
        v: 1,
        inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 3, 0] } }],
    }, "the materialized run speaks names relative to the cell seat")

    assert.deepEqual(law.bindingsOf("doc3"), [{ root: { cell: id }, slot: run.slot }],
        "one query gives the cell root and its local seat")
    assert.deepEqual(law.choicesOf("doc3"), cap, "the held offered capsule is readable without parsing")
    const s = buildWorld()
    s.offerAt(run.slot, run.choices)
    const host = s.hotSwapChild(run.slot, fork(run.slot, run.code))
    drive(s)
    near(worldOf(host.children.get("p")), [5, 3, 0])
})

test("a cell-only choice delta emits the cell's resident seating request", () => {
    const src = "###\n```\ngoto 5 0\nlet p\n```\n###"
    const id = cellIdentities(phaseCells(parseProgram(src)))[0].id
    const law = pageLaw()
    const offer = (y) => ({
        v: 1,
        inputs: [{ route: { root: { cell: id }, names: ["p"] }, action: { kind: "translation", by: [0, y, 0] } }],
    })
    law.observe("doc7", { name: "doc", doc: src, own: true, choices: offer(3) })
    const ans = law.observe("doc7", { name: "doc", doc: src, own: true, choices: offer(6) })
    const run = ans.runs.find((r) => r.cell === id)
    assert.ok(run, "no seat side channel: the cell run itself carries the delta")
    assert.deepEqual(run.choices, {
        v: 1,
        inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 6, 0] } }],
    })
    assert.deepEqual(law.choicesOf("doc7"), offer(6))
})
