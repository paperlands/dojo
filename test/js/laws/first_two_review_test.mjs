// The first-two review: the boundaries that a widening vocabulary was hiding.
//
// Each witness is the smallest world that made a finding true. They fence the
// identity/authority boundary — a being's point and head agree; a definition's
// birth is atomic and shares the scope's reached index; unsupported syntax is a
// located refusal; a conditional empty locus is not a contradiction; and every
// candidate producer exits through one whole-law gate.
// (id:laws-first-two-findings)
//
// Run: node --test test/js/laws/first_two_review_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform, worldTransform, takeSync } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { exposed } from "../../../assets/js/turtling/laws/batch.js"
import { stateOf, project, heldIdentity } from "../../../assets/js/turtling/laws/constraints.js"
import { bindWorld, constraintsOn } from "../../../assets/js/turtling/laws/authored.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const world = (frame) => frameWorldTransform(frame).position.map((n) => +n.toFixed(6))
const lastHead = (frame) => (takeSync(frame) ?? []).filter((e) => e.type === "head").at(-1)?.position.map((n) => +n.toFixed(6))
const ghostDistance = (host, a) => ({
    feature: "distance", address: "ghost|A", endpoints: [a.id, "GHOST"], scope: host.id, frame: host.id, predicate: 999,
})
const attempt = (scheduler) => scheduler.root._lastAttempt

// R2 — reintroduction updates the point but not its head. (id:laws-first-two-head)
test("a re-reached being publishes its point and head together", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nas A do\n  fw 1\nend\nwait 1\ngoto 5 0\nlet A"))
    drive(scheduler)
    const A = find(host, "A")
    assert.deepEqual(world(A), [5, 0, 0], "the being act adopted the walk's here")
    assert.deepEqual(lastHead(A), [5, 0, 0], "and its head projection is the same commit")
})

// R3 — pin-as-introduction bypasses declaration binding and atomicity.
// (id:laws-first-two-pin-birth)
test("a definition introduces even when a later bare let declares the name", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", "let V = origin\nlet V"))
    drive(scheduler)
    const V = host.children.get("V")
    assert.equal(host.error, null, "the definition is not use-before-introduction")
    assert.ok(V, "V is seated by its own definition")
    assert.deepEqual(world(V), [0, 0, 0])
    assert.equal(scheduler.laws.active().length, 1, "the pin was stored once")
    assert.equal(scheduler.laws.active()[0].feature, "position")
})

test("a failed introduction leaves no identity, no exposure and no hold", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet D"))
    drive(scheduler)
    const A = host.children.get("A")
    scheduler.laws.apply(ghostDistance(host, A))
    const s2 = scheduler.hotSwapChild("s2", fork("s2", "as B do\n  let V = origin\nend"))
    drive(scheduler)
    const B = s2.children.get("B")
    assert.ok(B.unresolved, "the unmeasurable whole-law gate ends the statement unresolved")
    assert.equal(B.children.get("V"), undefined, "the identity was withdrawn with the statement")
    assert.equal(B.reached.has("V"), false, "and it was never exposed")
})

test("a definition's exposure is installed before any commit notification", () => {
    const scheduler = buildWorld({ admit: pass })
    const seen = []
    scheduler.readouts.register(1, "probe", () => 1)
    scheduler.readouts.watch(() => {
        const host = scheduler.root.children.get("host")
        const V = host?.children.get("V")
        if (V) seen.push(exposed(V))
    })
    const host = scheduler.hotSwapChild("host", fork("host", "let V = origin"))
    drive(scheduler)
    assert.ok(seen.length > 0, "the commit invited a subscriber")
    assert.ok(seen.every((x) => x === true), "no subscriber sees an installed pin it cannot touch")
    assert.ok(exposed(host.children.get("V")), "and the identity is reached when the commit settles")
})

test("a definition's legality does not depend on an outer namesake", () => {
    const bare = buildWorld({ admit: pass })
    const h1 = bare.hotSwapChild("host", fork("host", "let V = origin\nlet V"))
    drive(bare)
    assert.equal(h1.error, null, "no outer namesake")
    assert.ok(h1.children.get("V"))

    const outer = buildWorld({ admit: pass })
    const h2 = outer.hotSwapChild("host", fork("host", [
        "let V",
        "as B do",
        "  let V = origin",
        "  let V",
        "end",
    ].join("\n")))
    drive(outer)
    const B = find(h2, "B")
    assert.equal(B.error, null, "an outer namesake must not make the definition a use-before-introduction")
    assert.ok(B.children.get("V"), "the definition owns the locally declared V")
})

test("a position definition reaches the visible identity, it does not shadow it", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let V",
        "goto 9 0",
        "as B do",
        "  let V = origin",
        "end",
    ].join("\n")))
    drive(scheduler)
    const B = find(host, "B")
    assert.equal(B.children.get("V"), undefined, "no local namesake is minted")
    assert.deepEqual(world(host.children.get("V")), [9, 0, 0], "the pin revised the visible V at B's origin")
})

// R4 — the opening relationship silently becomes a scalar. (id:laws-first-two-spelling)
test("an unsupported scalar binder is a located refusal, not a scalar", () => {
    for (const src of ["let A\nlet B\nlet distance(A, B) = 5", "let A\nlet B\nlet distance(A,B)=5"]) {
        const ast = parseProgram(src)
        const refusal = ast.at(-1)
        assert.equal(refusal.type, "Error", src)
        assert.match(refusal.meta.expected, /name after 'let'/, "the refusal names the binder")
        assert.match(refusal.meta.found, /^distance\(A,? ?B\)$/, "and points at the offending binder")
    }
    // The supported scalar spelling still parses.
    assert.equal(parseProgram("let A\nlet s = A.x").at(-1).type, "Scalar")
})

// R5 — a conditional empty locus called a contradiction. (id:laws-first-two-policy)
//
// A distance anchors to the other endpoint's LIVE position; a coordinate anchors
// to its declaring scope's PLACEMENT frame. Same identity, two features. B's live
// position is a permitted mover, so the empty meet is conditional.
test("an empty meet with a movable live anchor is an obstruction, not a contradiction", () => {
    const scheduler = buildWorld({ admit: pass })
    scheduler.hotSwapChild("host", fork("host",
        "let A\nlet B\nas B do\n  let A.distance = 5\n  let A.y = 100\nend"))
    drive(scheduler)
    const a = attempt(scheduler)
    assert.equal(a.outcome, "obstructed", "B's head can move without re-placing B")
    assert.match(String(a.message), /no point in common/)
    assert.match(String(a.message), /'B'/,"the obstruction names the mover")
    assert.equal(scheduler.laws.active().length, 1, "the impossible coordinate does not install")
})

test("an empty meet with no movable live anchor is a contradiction", () => {
    const scheduler = buildWorld({ admit: pass })
    // A pin point and a coordinate plane, both in the declaring host's PLACEMENT
    // frame: no permitted mover can separate them, so this is authored contradiction.
    scheduler.hotSwapChild("host", fork("host", "let A = [0,0,0]\nlet A.y = 5"))
    drive(scheduler)
    const a = attempt(scheduler)
    assert.equal(a.outcome, "contradiction", "no live anchor exists to free")
    assert.match(String(a.message), /no point in common/)
    assert.deepEqual(scheduler.laws.active().map((l) => l.feature), ["position"], "the impossible coordinate does not install")
})

test("an obstruction names the live mover, not the placement frame", () => {
    const scheduler = buildWorld({ admit: pass })
    scheduler.hotSwapChild("host", fork("host",
        "let A\nas B do\n  let A.distance = 5\nend\nas C do\n  let A.y = 100\nend"))
    drive(scheduler)
    const a = attempt(scheduler)
    assert.equal(a.outcome, "obstructed", "B's live position can meet the fixed plane")
    assert.match(String(a.message), /'B'/, "the distance's live anchor is the mover")
    assert.doesNotMatch(String(a.message), /'C'/, "C's placement frame is not hand-movable")
    assert.equal(scheduler.laws.active().length, 1, "the coordinate never installs")
})

// R6 — the whole-law gate is bypassed by a fallback candidate.
// (id:laws-first-two-final-gate)
test("a poisoned store stops the fallback candidate too", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nlet C\nlet A.distance = 5\nwait 10\nlet A.y = 3"))
    drive(scheduler, { maxTicks: 3 })
    const A = find(host, "A")
    const C = find(host, "C")
    // A ghost distance on another component, injected after the valid distance:
    // the single-target gate stops at the valid distance, so the fallback must
    // still re-check the whole validation scope before it may commit.
    scheduler.laws.apply({ feature: "distance", address: "ghost|C", endpoints: [C.id, "GHOST"], scope: host.id, frame: host.id, predicate: 999 })
    drive(scheduler, { maxTicks: 30 })
    assert.deepEqual(world(A), [5, 0, 0], "the fallback did not commit a check it could not make")
    assert.deepEqual(scheduler.laws.active().map((l) => l.feature), ["distance", "distance"], "no coordinate installed")
    assert.match(attempt(scheduler).message, /missing bound participant/)
    assert.ok(host.unresolved, "the reach ends unresolved, not silently resolved")
})

// 2C — the freedom view is the door's own context, not a certificate.
// (id:laws-first-two-policy, id:laws-freedom)
//
// The state is built the way the shell builds it: the runtime's own law adapter
// (constraintsOn + heldIdentity), the frame's real headedness, default admission.
// No hand-supplied `otherHeld`, no injected responder.
const runtimeState = (scheduler, frame) => {
    const laws = scheduler.laws.active()
    const ctx = bindWorld((id) => scheduler.registry.get(id), {
        writerId: frame.id,
        positionOf: (f) => frameWorldTransform(f).position,
        poseOf: (f) => worldTransform(f),
        heldOf: (id) => heldIdentity(scheduler.registry.get(id), laws, scheduler.registry),
    })
    return stateOf({
        at: frameWorldTransform(frame).position,
        headed: frame.generator != null || frame.actorState != null,
        exposed: exposed(frame),
        isPlace: frame.isPlace === true,
        error: frame.error ?? null,
        unresolved: frame.unresolved ?? frame.held ?? null,
        constraints: constraintsOn(frame.id, laws, ctx),
    })
}

test("the freedom view reads the source's own held context", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nlet B\nas B do\n  let A.distance = 0\nend"))
    drive(scheduler)
    const A = find(host, "A")
    const B = find(host, "B")
    const view = runtimeState(scheduler, A)
    // `as B` gives B a body, so the adapter holds it: A's coincidence is a pin.
    assert.equal(view.tag, "pinned", "a headed endpoint is held, not a free partner")
    assert.equal(view.interaction.offered, false, "and the point is not offered")
    assert.deepEqual(view.interaction.partners, [], "no movable partner is coupled")
    // Default admission: the request is accepted and moves nothing.
    const r = scheduler.requestMotion(A, { rotation: A.transform.deref().rotation, position: [3, 0, 0] }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 3 })
    assert.equal(r.kind, "accept", "default admission, not an injected responder")
    assert.deepEqual(world(A), [0, 0, 0], "A did not leave B")
    assert.deepEqual(world(B), [0, 0, 0], "B was not translated with it")
})

test("a genuinely free pair: the coincidence is named and reads one set", () => {
    // The language cannot yet author two free endpoints, so the law is injected
    // and labelled as such. (id:relationships-todo-participant-binding)
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet B"))
    drive(scheduler)
    const A = find(host, "A")
    const B = find(host, "B")
    scheduler.laws.apply({ feature: "distance", address: "free|A|B", endpoints: [A.id, B.id], scope: host.id, frame: B.id, predicate: 0 })
    const view = runtimeState(scheduler, A)
    assert.equal(view.truth.coincident, true, "the coincidence is named")
    assert.equal(view.dof, 0, "holding B, A has no independent freedom")
    assert.equal(view.interaction.movable, "none", "and none is offered")
    assert.deepEqual(view.locus, { kind: "point", at: [0, 0, 0] }, "the zero distance names the existing point")
    assert.deepEqual(project(view, [5, 5, 0]), [0, 0, 0], "projection reads the same set")
    const r = scheduler.requestMotion(A, { rotation: A.transform.deref().rotation, position: [3, 0, 0] }, scheduler.motionRevision)
    drive(scheduler, { maxTicks: 3 })
    assert.equal(r.kind, "accept", "accepted without displacement")
    assert.deepEqual(world(A), [0, 0, 0])
})

// R5b — a small denominator is not emptiness. Two nearly parallel planes meet in a
// line far away; a tiny angle must not be rounded to a contradiction.
// (id:laws-first-two-policy, id:laws-contradiction)
test("near-parallel planes are a line, not a contradiction", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\nlet A.y = 0\ngoto 0 0.0001\nrt 0.00001\nas F do\n  let A.y = 0\nend"))
    drive(scheduler)
    assert.equal(attempt(scheduler).outcome, "commit", "the meet is the line it actually is")
    assert.deepEqual(scheduler.laws.active().map((l) => l.feature), ["coordinate", "coordinate"],
        "both authored truths are installed")
})
