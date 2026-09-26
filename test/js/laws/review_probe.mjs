// Review probes — the contract each finding owes, runnable by name.
// (id:laws-build-scaffold: predicted result -> smallest witness -> recorded surprise)
//
// NOT collected by the default fence glob (`test/js/*/*_test.mjs`):
//
//   node --test test/js/laws/review_probe.mjs
//
// After the first fix pass the falsifiers below are GREEN fences; the two remaining
// `todo` probes are capabilities the spec defers (Phase 3 member policy, Phase 4
// running continuation), recorded so they are not silently forgotten.
//
//   A  a hand drag is order-free              FIXED   continueLaws fixed point
//   B  declaration order selects the member    OWED    Phase 3 policy
//   C  a non-finite measurement asserts nothing FIXED  domain guard
//   D  a pin is an anchor, not an impossibility FIXED  unresolved, not obstructed
//   E  a law needs both participants            FIXED  retractIdentity
//   F  a committed transition is path-legal     OWED    Phase 4 wiring (pure now)

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { bindLaw, addressOf, createLawStore } from "../../../assets/js/turtling/laws/replacement.js"
import { componentOf, realizeDistanceTree } from "../../../assets/js/turtling/laws/component.js"
import { measure } from "../../../assets/js/turtling/laws/relations.js"
import { segmentResidual, segmentKeepsDistance } from "../../../assets/js/turtling/laws/path.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const world = (frame) => frameWorldTransform(frame).position
const show = (frame) => world(frame).map((n) => +n.toFixed(3))
const round = (n) => +n.toFixed(3)
const drag = (scheduler, frame, position) => scheduler.requestMotion(frame,
    { rotation: frame.transform.deref().rotation, position }, scheduler.motionRevision)

const L1 = "as A do\n  let B.distance = 5\nend"   // target B, observer A
const L2 = "as B do\n  let C.distance = 5\nend"   // target C, observer B
const FORWARD = ["let A", "let B", "let C", L1, L2].join("\n")
const REVERSED = ["let A", "let B", "let C", L2, L1].join("\n")

function seated(src) {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", src))
    drive(scheduler)
    return { scheduler, host, A: find(host, "A"), B: find(host, "B"), C: find(host, "C") }
}
const dist = (a, b) => Math.hypot(...world(a).map((n, i) => n - world(b)[i]))

// ---------------------------------------------------------------------------
// A. A hand drag is order-free. (id:laws.org "Truth is not an iteration order")
// ---------------------------------------------------------------------------
test("A. fence: the same truths in either source order admit the same hand drag", () => {
    const fwd = seated(FORWARD)
    const rev = seated(REVERSED)
    const aFwd = drag(fwd.scheduler, fwd.A, [0, 20, 0]).kind
    const aRev = drag(rev.scheduler, rev.A, [0, 20, 0]).kind
    console.log(`A. drag A->(0,20): forward=${aFwd} reversed=${aRev}`)
    assert.equal(aFwd, "accept", "forward order admits the drag")
    assert.equal(aRev, "accept", "reversed order admits the same drag")
    assert.equal(round(dist(fwd.B, fwd.C)), 5, "the forward chain kept |BC|")
    assert.equal(round(dist(rev.B, rev.C)), 5, "the reversed chain kept |BC|")
})

// ---------------------------------------------------------------------------
// B. The realized member is a declarative policy, not statement order.
//    The runtime still realizes each statement as reached: OWED (Phase 3).
// ---------------------------------------------------------------------------
test("B. characterization: both source orders realize a member of the solution set", () => {
    for (const [label, src] of [["forward", FORWARD], ["reversed", REVERSED]]) {
        const { A, B, C } = seated(src)
        assert.equal(round(dist(A, B)), 5, `${label}: |AB| holds`)
        assert.equal(round(dist(B, C)), 5, `${label}: |BC| holds`)
    }
})

test("B. todo: statement order does not select the realized member", { todo: true }, () => {
    const fwd = seated(FORWARD)
    const rev = seated(REVERSED)
    console.log(`B. seated member: forward C=${JSON.stringify(show(fwd.C))} reversed C=${JSON.stringify(show(rev.C))}`)
    assert.deepEqual(show(fwd.C), show(rev.C), "a declarative policy must choose the member")
})

// ---------------------------------------------------------------------------
// C. measure computes; it does not assert. A measurement that cannot answer is
//    not a satisfied predicate. (id:eval-relational)
// ---------------------------------------------------------------------------
test("C. characterization: the raw comparison reads a non-finite measurement as satisfied", () => {
    const read = (f) => ({ position: f === "nan" ? [NaN, 0, 0] : [0, 0, 0], rotation: { x: 0, y: 0, z: 0, w: 1 }, time: 0 })
    const d = measure("distance", "nan", "o", read)
    const rawGuardSaysViolated = Math.abs(d - 5) > 1e-6
    console.log(`C. pure: measure=${d}; raw Math.abs(d-5) > 1e-6 === ${rawGuardSaysViolated}`)
    assert.equal(rawGuardSaysViolated, false, "raw `>` guard silently reads NaN as satisfied")
})

test("C. fence: non-finite geometry never admits a move", () => {
    const { scheduler, A, B } = seated("let A\nlet B\nas B do\n  let A.distance = 5\nend")
    B.transform.swap(() => ({ rotation: B.transform.deref().rotation, position: [NaN, 0, 0] }))
    const verdict = drag(scheduler, A, [3, 0, 0])
    console.log(`C. drag A->3 with NaN reference: verdict=${verdict.kind}`)
    assert.notEqual(verdict.kind, "accept", "an unmeasurable configuration is not admitted")
})

// ---------------------------------------------------------------------------
// D. A pin is an anchor, not a refusal. The analytic tree cannot use a second
//    anchor yet, but that is OWED, not impossible: the scope ends unresolved and
//    the accepted prefix stands. (id:laws-contradiction, id:laws-activation-verdicts)
// ---------------------------------------------------------------------------
const PINNED_CHAIN = [
    "let A", "let B", "let C",
    "as O do\n  let C = [1, 0, 0]\nend",
    "as A do\n  let B.distance = 6\n  wait 1\n  let B.distance = 5\nend",
    "as B do\n  let C.distance = 5\nend",
].join("\n")

test("D. fence: a pinned member ends unresolved, never a false impossibility", () => {
    const { A, B, C } = seated(PINNED_CHAIN)
    const feasible = dist(A, C) <= 5 + 5 && dist(A, C) >= Math.abs(5 - 5)
    console.log(`D. |AC|=${round(dist(A, C))} solvable=${feasible} A.unresolved=${!!A.unresolved} A.error=${A.error?.kind ?? "none"}`)
    assert.equal(feasible, true, "the probe geometry is genuinely solvable")
    assert.equal(A.error, null, "a solver limit is not a wound")
    assert.ok(A.unresolved, "the declaring scope ends unresolved")
    assert.equal(round(dist(A, B)), 6, "the accepted prefix stands")
    assert.equal(round(dist(B, C)), 5, "the surviving law still holds")
})

test("D2. fence: the same pin is reported the same way on anchor and member", () => {
    const src = [
        "let A", "let B", "let C",
        "as O do\n  let A = [0, 0, 0]\nend",
        "as A do\n  let B.distance = 6\n  wait 1\n  let B.distance = 5\nend",
        "as B do\n  let C.distance = 5\nend",
    ].join("\n")
    const { A } = seated(src)
    assert.equal(A.error, null, "no false impossibility when the anchor carries the pin")
    assert.ok(A.unresolved, "the same honest report as a pinned member")
})

test("I. fence: a solvable triangle ends unresolved, not an obstruction", () => {
    const authored = [5, 5, 6]
    const valid = authored[0] + authored[1] > authored[2]
        && authored[0] + authored[2] > authored[1]
        && authored[1] + authored[2] > authored[0]
    const src = [
        "let A", "let B", "let C",
        "as A do\n  let B.distance = 5\nend",
        "as B do\n  let C.distance = 5\nend",
        "as C do\n  let A.distance = 6\nend",
    ].join("\n")
    const { C } = seated(src)
    console.log(`I. triangle authored=${JSON.stringify(authored)} valid=${valid} C.unresolved=${!!C.unresolved} C.error=${C.error?.kind ?? "none"}`)
    assert.equal(valid, true, "5,5,6 is a valid triangle")
    assert.equal(C.error, null, "a cycle is a normal relation, not a demonstrated obstruction")
    assert.ok(C.unresolved, "the declaring scope ends unresolved about the cycle")
})

// The refusal site, isolated: a pin is an endpoint of its own position law, so
// componentOf pulls that law into the component and the distance-only guard is what
// rules it out — before the pinnedLaw check runs.
test("J. characterization: the distance-only guard, not pinnedLaw, rules out a pinned component", () => {
    const d1 = bindLaw({ feature: "distance", endpoints: ["B", "A"], scope: "A", frame: "A", predicate: 5 })
    const d2 = bindLaw({ feature: "distance", endpoints: ["C", "B"], scope: "B", frame: "B", predicate: 5 })
    const pin = bindLaw({ feature: "position", endpoints: ["C"], scope: "O", frame: "O", predicate: [1, 0, 0] })
    const comp = componentOf([d1, d2, pin], ["B", "A"])
    console.log(`J. component frames=${[...comp.frames].join(",")} laws=${comp.laws.map((l) => l.feature).join(",")}`)
    assert.ok(comp.laws.some((l) => l.feature === "position"), "the pin's own law joins by incidence")
    assert.equal(realizeDistanceTree(comp.laws, "A", () => [0, 0, 0], (l) => l.predicate), null,
        "the tree solver refuses the component because it is not all-distance")
})

// ---------------------------------------------------------------------------
// E. A law survives only while both participants exist. A source edit retracts what
//    the edited scope declared; an identity leaving retracts every law naming it.
// (id:laws-ordered-replacement, id:laws-activation.org "Remove a scope/identity")
// ---------------------------------------------------------------------------
test("E. fence: source edit versus identity removal are different retractions", () => {
    const declared = bindLaw({ feature: "distance", endpoints: ["C", "B"], scope: "B", frame: "B", predicate: 5 })
    assert.equal(declared.scope, declared.frame, "collapse: scope and frame are both the observer")
    assert.equal(addressOf(declared), addressOf(bindLaw({
        feature: "distance", endpoints: ["B", "C"], scope: "B", frame: "B", predicate: 5,
    })), "reversed endpoints reach one address: direction is not the address")

    const editing = createLawStore()
    editing.apply(declared)
    assert.equal(editing.retractFrame("B"), "retracted", "a source edit retracts what the edited scope declared")
    assert.equal(editing.active().length, 0)

    const targeting = bindLaw({ feature: "distance", endpoints: ["B", "A"], scope: "A", frame: "A", predicate: 5 })
    const leaving = createLawStore()
    leaving.apply(targeting)
    assert.equal(leaving.retractFrame("B"), "noop", "editing a target does not retract another scope's law")
    assert.equal(leaving.active().length, 1, "the target identity is still in the play")
    assert.equal(leaving.retractIdentity("B"), "retracted", "the identity leaving retracts every law naming it")
    assert.equal(leaving.active().length, 0)
})

// ---------------------------------------------------------------------------
// F. Trajectory. pathOk is correct and pure; wiring it into the discrete commit is
//    OWED with Phase 4 running continuation. (id:laws-build-p4-path-built)
// ---------------------------------------------------------------------------
test("F. fence: pathOk is a correct pure prerequisite", () => {
    assert.equal(segmentKeepsDistance([5, 0, 0], [-5, 0, 0], [0, 0, 0], 5), false, "a diameter chord leaves the circle")
    const arc = []
    for (let i = 0; i <= 32; i++) {
        const a = (i / 32) * Math.PI
        arc.push([5 * Math.cos(a), 5 * Math.sin(a), 0])
    }
    let worst = 0
    for (let i = 0; i < 32; i++) worst = Math.max(worst, segmentResidual(arc[i], arc[i + 1], [0, 0, 0], 5, 4))
    assert.ok(worst < 0.05, `a fine arc stays on the circle (worst ${worst})`)
})

test("F. todo: the commit path validates the represented trajectory", { todo: true }, () => {
    const src = readFileSync(new URL("../../../assets/js/turtling/scheduler.js", import.meta.url), "utf8")
    assert.match(src, /pathOk|segmentKeepsDistance|segmentResidual/,
        "the runtime that claims trajectory validation must call it, not only its test")
})
