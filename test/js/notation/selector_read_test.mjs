import { test } from "node:test"
import assert from "node:assert/strict"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { buildWorld, fork, drive } from "../laws/harness.mjs"
import { headingOf } from "../../../assets/js/turtling/laws/relations.js"

function reader() {
    const parser = new Parser(), evaluator = new Evaluator(), reached = []
    evaluator.resolveExternal = name => { reached.push(name); return 2 }
    return { evaluator, reached, read: (source, scope) => evaluator.run(parser.parse(source), scope) }
}

test("an atomic dotted operand reads its bound selector, preserving the property path", () => {
    const { evaluator, reached, read } = reader()
    evaluator.beginReads()
    assert.equal(read("a.x", { a: "prey" }), 2)
    assert.equal(read("a.position.x", { a: "prey" }), 2)
    assert.deepEqual(reached, ["prey.x", "prey.position.x"])
    assert.deepEqual(evaluator.reads.inputs, [
        ["scope", "a", "prey"], ["external", "prey.x", null, 2],
        ["scope", "a", "prey"], ["external", "prey.position.x", null, 2],
    ])
})

test("a selector is read once, not recursively rebound or parsed as source", () => {
    const { reached, read } = reader()
    assert.equal(read("a.x", { a: "prey", prey: "other" }), 2)
    assert.equal(read('"prey".x', { prey: "other" }), 2)
    assert.equal(read("a.x", { a: "a+b" }), 2)
    assert.deepEqual(reached, ["prey.x", "prey.x", "a+b.x"])
})

test("a held dotted value still wins; unbound and non-string subjects keep their path", () => {
    const { reached, read } = reader()
    assert.equal(read("a.x", { a: "prey", "a.x": 9 }), 9)
    assert.equal(read("a.x", { a: "prey", "prey.x": 7 }), 7)
    for (const scope of [{}, { a: 3 }, { a: null }, { a: [2, 0] }]) {
        assert.equal(read("a.x", scope), 2)
    }
    assert.deepEqual(reached, ["a.x", "a.x", "a.x", "a.x"])
})

test("selector reads use the same captured binding door as other scope reads", () => {
    const { evaluator, reached, read } = reader()
    evaluator.beginReads().bind = (kind, name) => {
        assert.equal(kind, "scope")
        assert.equal(name, "a")
        return "captured"
    }
    assert.equal(read("a.x", { a: "current" }), 2)
    assert.deepEqual(reached, ["captured.x"])
})

test("blocked resolved selectors propagate unchanged", () => {
    const { evaluator, read } = reader()
    const blocked = Object.assign(new Error("waiting"), { blocked: true })
    evaluator.resolveExternal = name => {
        assert.equal(name, "prey.x")
        throw blocked
    }
    assert.throws(() => read("a.x", { a: "prey" }), error => error === blocked)
})

function run(source) {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", source))
    const trace = drive(scheduler, { maxTicks: 120 })
    return {
        scheduler, host,
        labels: [...trace.values()].flat().filter(e => e.type === "label").map(e => e.text),
        errors: scheduler.errors.map(e => e.message),
    }
}

test("a closed figure may read its owned local point through a subject parameter", () => {
    const result = run(`
def peek a do
  let A = (2, 0)
  as nested do
    label a.x 10
  end
end
let flake = peek "A"
`)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.labels, ["2"])
})

test("an open recipe resolves the parameter rather than waiting for a phantom frame", () => {
    const result = run(`
def peek a do
  label a.x 10
end
let prey = (2, 0)
as observer do
  peek "prey"
end
wait 1000
`)
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.labels, ["2"])
    assert.equal(result.host.children.get("observer").done, true)
})

test("resolving a subject parameter does not grant a closed figure outside observation", () => {
    const result = run(`
def peek a do
  label a.x 10
end
let prey = (2, 0)
let flake = peek "prey"
`)
    assert.deepEqual(result.labels, [])
    assert.deepEqual(result.errors, ["closed region has no world read: prey.x"])
})

test("a selector in a figure argument keeps the reached frame in its live question", () => {
    const result = run(`
def wrap a do
  let flake = fw a.x
end
let prey
as prey do
  fw 2
end
wrap "prey"
wait 1000
`)
    assert.deepEqual(result.errors, [])
    const prey = result.host.children.get("prey"), flake = result.host.children.get("flake")
    assert.deepEqual(flake.transform.deref().position, [2, 0, 0])
    const outcome = result.scheduler.requestMotion(prey,
        { rotation: prey.transform.deref().rotation, position: [5, 0, 0] }, result.scheduler.motionRevision)
    assert.equal(outcome.kind, "accept")
    result.scheduler.readouts.recompute()
    result.scheduler.readouts.drain()
    drive(result.scheduler, { maxTicks: 120 })
    assert.deepEqual(flake.transform.deref().position, [5, 0, 0])
    assert.deepEqual(result.scheduler.errors, [])
})

test("an ordinary follow call remains a live ambient as its selected prey moves", () => {
    const result = run(`
def follow a b do
  as b do
    loop 1000 do
      faceto a.x a.y
      label a.x 10
      wait 1
    end
  end
end
let prey
as prey do
  fw 2
end
follow "prey" "predator"
`)
    assert.deepEqual(result.errors, [])
    const prey = result.host.children.get("prey"), predator = result.host.children.get("predator")
    assert.equal(predator.closed, false)
    assert.equal(headingOf(predator.transform.deref().rotation), 90)
    assert.ok(result.labels.includes("2"))
    const outcome = result.scheduler.requestMotion(prey,
        { rotation: prey.transform.deref().rotation, position: [5, 5, 0] }, result.scheduler.motionRevision)
    assert.equal(outcome.kind, "accept")
    const trace = drive(result.scheduler, { maxTicks: 120 })
    const labels = [...trace.values()].flat().filter(e => e.type === "label").map(e => e.text)
    assert.ok(labels.includes("5"))
    assert.equal(headingOf(predator.transform.deref().rotation), 45)
    assert.deepEqual(result.scheduler.errors, [])
})
