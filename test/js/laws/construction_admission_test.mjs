// The construction admission boundary: a construction PROPOSES an identity, a retained
// conjunction and a selection request; the existing boundary admits and publishes them
// together. Harvested from the construction-composition campaign (D062).
//
// The admitted domain is bounded: absent-local identity, captured inputs, DISTINCT
// addresses, bounded realization coverage. Grammar, adoption/revisitation, live inputs
// and mid-install failure are separate work.
//
// Run: node --test test/js/laws/construction_admission_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { ASTNode } from "../../../assets/js/turtling/ast.js"
import { SE3, AXIS_Z } from "../../../assets/js/turtling/se3.js"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

const X = 3
const SEED = [0, 0, 4]
const EXPECTED = [X, 0, SEED[2]]
const f3 = (a) => a ? a.map((n) => +n.toFixed(6)) : null
const coordinate = (axis, value) => ({ feature: "coordinate", axis, term: (id) => ({ type: "coordinate", references: [id], axis, value, source: null }) })
const distance = (radius) => ({ feature: "distance", term: (id) => ({ type: "distance", references: [id, { value: [0, 0, 0] }], radius, source: null }) })
const construct = (name, seed, obligations, span = { line: 1 }) => {
    const node = new ASTNode("Construct", name, [], { seed, obligations })   // captured data, never re-read
    node.span = span
    return node
}
function build(ast, origin = SE3.identity()) {
    const scheduler = buildWorld()
    const spec = fork("host", "", origin)
    spec.code.ast = ast
    const host = scheduler.hotSwapChild("host", spec)
    drive(scheduler, { maxTicks: 20 })
    return { scheduler, host }
}
const pos = (frame) => frame ? f3(frameWorldTransform(frame).position) : null

test("a construction establishes an absent local identity at the prepared candidate", () => {
    const { scheduler, host } = build([construct("A", SEED, [coordinate("x", X), coordinate("y", 0)])])
    const A = host.children.get("A")
    assert.ok(A, "the identity exists")
    assert.deepEqual(pos(A), EXPECTED, "at the analytic candidate")
    assert.deepEqual(scheduler.laws.active().map((l) => l.feature).sort(), ["coordinate", "coordinate"])
})

test("a construction refuses a name that is already local", () => {
    const { host } = build([construct("A", SEED, [coordinate("x", X)]), construct("A", SEED, [coordinate("y", 0)])])
    assert.ok(host.children.get("A"), "the first establishes")
    assert.match(host.error?.message ?? "", /already local/)
})

test("the installed records are exactly the requested distinct obligations", () => {
    // A mixed conjunction proves the uniform row context: no distance-specific dispatch.
    const { scheduler, host } = build([construct("A", SEED, [coordinate("x", X), coordinate("y", 0), distance(5)])])
    assert.deepEqual(pos(host.children.get("A")), EXPECTED)
    assert.equal(scheduler.laws.active().length, 3, "three requested, three installed")
})

test("a repeated obligation address is refused before installation", () => {
    const { scheduler, host } = build([construct("A", SEED, [coordinate("x", X), coordinate("x", X), coordinate("y", 0)])])
    assert.match(host.error?.message ?? "", /repeats an obligation address/)
    assert.equal(host.children.has("A"), false, "no identity survives")
    assert.equal(scheduler.laws.active().length, 0, "nothing installs")
})

test("an unnameable construction meet ends unresolved, not as a relation error", () => {
    // cone ∩ sphere is not a named set: the fold has no supported intermediate, so the
    // conjunction is unresolved. Unsupported realization is not an authored relation error.
    const tilt = { feature: "tilt", term: (id, frame) => ({ type: "tilt", references: [id], axis: null, value: 45, source: "45", frame }) }
    const { host } = build([construct("A", SEED, [tilt, distance(5), coordinate("z", 5 / Math.SQRT2)])])
    assert.equal(host.error ?? null, null, "no relation error is raised")
    assert.ok(host.unresolved, "the unsupported meet is reported unresolved")
    assert.match(host.unresolved.reason, /named set/)
    assert.equal(host.children.has("A"), false, "no identity survives")
})

test("installed obligations carry the statement's ownership, fenced by retraction", () => {
    const span = { line: 7 }
    const { scheduler } = build([construct("A", SEED, [coordinate("x", X), coordinate("y", 0)], span)])
    const installed = scheduler.laws.active()
    assert.equal(installed.length, 2)
    assert.ok(installed.every((law) => law.owner === span), "statement-site ownership, not only scope ownership")
    assert.equal(scheduler.laws.retract(span), "retracted", "the ownership boundary is the statement site")
    assert.equal(scheduler.laws.active().length, 0)
})

test("a subscriber sees the complete accepted construction, never a partial one", () => {
    const scheduler = buildWorld()
    const snapshots = []
    scheduler.readouts.register(1, "probe", () => 1)
    scheduler.readouts.watch(() => {
        const host = scheduler.root.children.get("host")
        const A = host?.children.get("A")
        snapshots.push({ existed: !!A, exposed: host?.reached?.has("A") === true, pose: pos(A), laws: scheduler.laws.active().length })
    })
    const spec = fork("host", "")
    spec.code.ast = [construct("A", SEED, [coordinate("x", X), coordinate("y", 0)])]
    scheduler.hotSwapChild("host", spec)
    drive(scheduler, { maxTicks: 20 })
    const complete = snapshots.filter((s) => s.existed)
    assert.equal(complete.length, 1, "one notification shows the identity")
    assert.deepEqual(complete[0], { existed: true, exposed: true, pose: EXPECTED, laws: 2 },
        "identity, exposure, pose and every obligation were coherent when the subscriber ran")
})

test("admission refusal preserves a nonempty accepted prefix unchanged", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let B\nlet B.x = 1"))
    drive(scheduler, { maxTicks: 20 })
    const B = host.children.get("B")
    const before = { pose: pos(B), law: scheduler.laws.active().map((l) => `${l.feature}:${l.axis}`).sort() }
    // An unmeasurable active law: preparation succeeds (it composes only the new
    // obligations), admission refuses (the gate checks the whole configuration).
    scheduler.laws.apply({ feature: "distance", address: "ghost|B", endpoints: [B.id, "GHOST"], scope: host.id, frame: host.id, predicate: 999,
        expression: { type: "distance", references: [B.id, "GHOST"], radius: 999 } })
    const spec = fork("src", "")
    spec.code.ast = [construct("A", SEED, [coordinate("x", X), coordinate("y", 0)])]
    const src = scheduler.hotSwapChild("src", spec)
    drive(scheduler, { maxTicks: 20 })
    assert.ok(src.error, "admission refused")
    assert.equal(src.children.has("A"), false, "no new identity")
    assert.deepEqual(pos(B), before.pose, "the prefix pose is unchanged")
    assert.deepEqual(scheduler.laws.active().filter((l) => l.feature === "coordinate").map((l) => `${l.feature}:${l.axis}`).sort(), before.law)
})

for (const [label, origin] of [
    ["identity", SE3.identity()],
    ["translated", SE3.translateLocal(SE3.identity(), 10, 0, 0)],
    ["rotated", SE3.rotateLocal(SE3.identity(), AXIS_Z, 90)],
]) {
    test(`a construction admits in the ${label} parent, birth distinct from accepted`, () => {
        const { host } = build([construct("A", SEED, [coordinate("x", X), coordinate("y", 0)])], origin)
        const A = host.children.get("A")
        assert.ok(A)
        assert.deepEqual(pos(A), EXPECTED, "the accepted WORLD pose is the candidate, whatever the parent")
        assert.notDeepEqual(f3(A.birthPose.position), f3(A.origin.position),
            "the birth anchor is the reached seat; the accepted pose is the selected candidate")
    })
}
