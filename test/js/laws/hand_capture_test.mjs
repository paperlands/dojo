// Capture is held offer + resident effective choices. An inactive offered cell
// survives; an evicted local choice does not (D064 seat removal). No delimiter split.
// (id:laws-construction-input)
import { test } from "node:test"
import assert from "node:assert/strict"
import { pageLaw } from "../../../assets/js/weave/page.js"
import { buildWorld, fork, drive, worldOf } from "./harness.mjs"
import { toLocalPoint } from "../../../assets/js/turtling/localize.js"
import { worldTransform } from "../../../assets/js/turtling/scheduler.js"
import { captureChoices } from "../../../assets/js/turtling/laws/hand_choices.js"
import { cellIdentities, parseProgram, phaseCells } from "../../../assets/js/turtling/parse.js"

const near = (a, b) => assert.deepEqual(a.map((v) => +v.toFixed(6)), b)
const translation = (y) => ({ kind: "translation", by: [0, y, 0] })
const capsule = (root, names, action) => ({
    v: 1,
    inputs: [{ route: { root, names }, action }],
})

const capture = (law, addr, place, s) => captureChoices(
    law.choicesOf(addr, place),
    law.bindingsOf(addr, place),
    (slot) => s.handLocalChoices(slot),
    (slot) => !!s.root.children.has(slot),
)

test("a resident plain point captures its local choice over the held offer", () => {
    const src = "goto 5 0\nlet p"
    const law = pageLaw()
    const ans = law.observe("doc1", { name: "doc", doc: src, own: true, choices: capsule("document", ["p"], translation(3)) })
    const run = ans.runs.find((r) => !String(r.node).includes("#"))
    const s = buildWorld()
    s.offerAt(run.slot, run.choices)
    const host = s.hotSwapChild(run.slot, fork(run.slot, run.code))
    drive(s)
    const p = host.children.get("p")
    const local = toLocalPoint(worldTransform(p), [5, 4, 0])
    assert.equal(s.requestMotion(p, { ...p.transform.deref(), position: local }, s.motionRevision).kind, "accept")

    assert.deepEqual(capture(law, "doc1", "coreshell", s), capsule("document", ["p"], translation(4)))
})

test("resident cell local wins; an inactive offered cell survives capture", () => {
    const src = "###\n```\ngoto 5 0\nlet p\n```\n```\ngoto 6 0\nlet q\n```\n###"
    const cells = phaseCells(parseProgram(src))
    const ids = cellIdentities(cells).map(({ id }) => id)
    const law = pageLaw()
    const offered = {
        v: 1,
        inputs: [
            { route: { root: { cell: ids[0] }, names: ["p"] }, action: translation(3) },
            { route: { root: { cell: ids[1] }, names: ["q"] }, action: translation(3) },
        ],
    }
    const ans = law.observe("doc2", { name: "doc", doc: src, own: true, choices: offered })
    const run = ans.runs.find((r) => r.cell === ids[0])
    const s = buildWorld()
    s.offerAt(run.slot, run.choices)
    const host = s.hotSwapChild(run.slot, fork(run.slot, run.code))
    drive(s)
    const p = host.children.get("p")
    const local = toLocalPoint(worldTransform(p), [5, 4, 0])
    assert.equal(s.requestMotion(p, { ...p.transform.deref(), position: local }, s.motionRevision).kind, "accept")

    const resident = capture(law, "doc2", "coreshell", s)
    const first = resident.inputs.find((e) => e.route.root.cell === ids[0])
    const second = resident.inputs.find((e) => e.route.root.cell === ids[1])
    assert.deepEqual(first.route, { root: { cell: ids[0] }, names: ["p"] })
    assert.deepEqual(first.action, translation(4))
    assert.deepEqual(second.route, { root: { cell: ids[1] }, names: ["q"] })
    assert.deepEqual(second.action, translation(3), "the unvisited offered cell is preserved")
})

test("eviction drops the local choice but keeps the record-owned offer", () => {
    const src = "###\n```\ngoto 5 0\nlet p\n```\n###"
    const id = cellIdentities(phaseCells(parseProgram(src)))[0].id
    const law = pageLaw()
    const offered = capsule({ cell: id }, ["p"], translation(3))
    const ans = law.observe("doc3", { name: "doc", doc: src, own: true, choices: offered })
    const run = ans.runs.find((r) => r.cell === id)
    const s = buildWorld()
    s.offerAt(run.slot, run.choices)
    const host = s.hotSwapChild(run.slot, fork(run.slot, run.code))
    drive(s)
    const p = host.children.get("p")
    const local = toLocalPoint(worldTransform(p), [5, 4, 0])
    assert.equal(s.requestMotion(p, { ...p.transform.deref(), position: local }, s.motionRevision).kind, "accept")
    assert.deepEqual(capture(law, "doc3", "coreshell", s).inputs[0].action, translation(4))

    s.removeChild(run.slot)
    assert.deepEqual(s.handChoices(run.slot), [], "seat removal forgets the local choice")
    const after = capture(law, "doc3", "coreshell", s)
    assert.deepEqual(after.inputs[0].action, translation(3),
        "the held offer remains; the local eviction is not invented as retention")
    near(worldOf(p), [5, 4, 0], "the removed seat's old geometry is not a claim")
})

test("capture uses the held offer, not a stale scheduler projection", () => {
    const src = "goto 5 0\nlet p"
    const law = pageLaw()
    const first = law.observe("doc4", { name: "doc", doc: src, own: true, choices: capsule("document", ["p"], translation(3)) })
    const run = first.runs.find((r) => !String(r.node).includes("#"))
    const s = buildWorld()
    s.offerAt(run.slot, run.choices)
    const host = s.hotSwapChild(run.slot, fork(run.slot, run.code))
    drive(s)
    assert.deepEqual(s.handChoices(host)[0].action, translation(3), "execution projected A")

    const next = capsule("document", ["p"], translation(6))
    law.observe("doc4", { name: "doc", doc: src, own: true, choices: next })
    assert.deepEqual(s.handChoices(host)[0].action, translation(3), "scheduler has not adopted B yet")

    assert.deepEqual(capture(law, "doc4", "coreshell", s), next,
        "capture speaks the held offer, not stale effective A")
})

test("a local identity mask removes the inherited route from capture", () => {
    const src = "goto 5 0\nlet p"
    const law = pageLaw()
    const held = capsule("document", ["p"], translation(3))
    const ans = law.observe("doc5", { name: "doc", doc: src, own: true, choices: held })
    const run = ans.runs.find((r) => !String(r.node).includes("#"))
    const s = buildWorld()
    s.offerAt(run.slot, run.choices)
    const host = s.hotSwapChild(run.slot, fork(run.slot, run.code))
    drive(s)
    const p = host.children.get("p")
    assert.equal(s.requestMotion(p, s.handHome(p), s.motionRevision, null, { reset: true }).kind, "accept")
    assert.deepEqual(s.handLocalChoices(host), [{ names: ["p"], action: null }])
    assert.deepEqual(capture(law, "doc5", "coreshell", s), { v: 1, inputs: [] })
})

test("a renamed/removed cell's held offer stays data, not deleted absence", () => {
    const cellSrc = "###\n```\ngoto 5 0\nlet p\n```\n###"
    const plainSrc = "goto 5 0\nlet p"
    const id = cellIdentities(phaseCells(parseProgram(cellSrc)))[0].id
    const law = pageLaw()
    const offered = capsule({ cell: id }, ["p"], translation(3))
    law.observe("doc6", { name: "doc", doc: cellSrc, own: true, choices: offered })
    law.observe("doc6", { name: "doc", doc: plainSrc, own: true })   // source edit removes the cell
    const held = law.choicesOf("doc6")
    const bindings = law.bindingsOf("doc6")
    const captured = captureChoices(held, bindings, () => [], () => false)
    assert.deepEqual(captured.inputs, [{ route: { root: { cell: id }, names: ["p"] }, action: translation(3) }],
        "an unresolved offered root is retained as data, never silently emptied")
})

test("a captured local route does not alias the binding's root object", () => {
    const binding = { root: { cell: "1.2.spiral" }, slot: "coreshell:doc#1.2.spiral" }
    const captured = captureChoices(null, [binding], () => [{ names: ["p"], action: translation(2) }], () => true)
    binding.root.cell = "mutated"
    assert.deepEqual(captured.inputs[0].route.root, { cell: "1.2.spiral" })
})
