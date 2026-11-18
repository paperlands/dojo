// Value lifecycle — change → replace → refuse → release under pressure.
// Construct → bind → observe is only half a contract. These witnesses follow a
// declared value through replacement, refusal, a saturated ink channel and a retired
// driver. A declared OBJECT is current state (the conflating slot), never deposited
// ink; its name is the invariant overlay's, never label ink.
// (id:notation-coordinate-vector, id:laws-ordered-replacement, id:laws-dependency-driven-place)
// Run: node --test test/js/laws/value_lifecycle_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform, takeSync } from "../../../assets/js/turtling/scheduler.js"
import { materialize, createLabels } from "../../../assets/js/turtling/materializer.js"
import { Group } from "../../../assets/js/utils/three-entry.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const position = (frame) => frameWorldTransform(frame).position
const move = (scheduler, frame, x) => scheduler.requestMotion(frame, {
    rotation: frame.transform.deref().rotation, position: [x, 0, 0],
}, scheduler.motionRevision)

function world(source, options = {}) {
    const scheduler = buildWorld({ admit: pass, ...options })
    const host = scheduler.hotSwapChild("host", fork("host", source))
    const trace = drive(scheduler)
    return { scheduler, host, trace }
}

// The real vector store, with an injected Text stand-in — no WebGL, but the actual
// materializer and arrow path.
function drawing() {
    const group = new Group()
    const labels = createLabels(group, { createText: () => {
        const text = new Group()
        text.sync = () => {}
        return text
    } })
    return {
        groups: { pathGroup: group },
        context: { vectors: new Map(), labels, materials: { get: () => ({}) } },
    }
}

const arrow = (x = 80) => ({
    type: "vector", name: "A", from: [0, 0, 0], to: [x, 0, 0],
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    color: "silver", thickness: 2, textSize: 5,
})

const vectorsIn = (frame) => (takeSync(frame) ?? []).filter((e) => e.type === "vector")

test("a live vector redraw reaches the current-state slot with complete geometry", () => {
    // Birth and redraw share one event contract; the object rides the conflating slot,
    // not the ink channel. (id:notation-coordinate-vector)
    const { scheduler, host } = world("let B\nlet A = [80, B.x, 0]")
    assert.equal(move(scheduler, host.children.get("B"), 7).kind, "accept")
    const event = vectorsIn(host).find((e) => e.name === "A" && !e.removed)
    assert.ok(event, "the redraw reached the slot")
    assert.deepEqual(event.to, [80, 7, 0])
    assert.ok(event.rotation, "the event carries rotation")
    const { groups, context } = drawing()
    assert.doesNotThrow(() => materialize(event, groups, context))
    assert.equal(context.vectors.size, 1, "one arrow object")
})

test("a declared object keeps one identity across redraws; its name is not label ink", () => {
    // A displayed object's name shares its identity and lives in the overlay, never in
    // the layer's appended label set. (id:notation-coordinate-vector, id:laws-decl-interface)
    const { groups, context } = drawing()
    for (let x = 1; x <= 20; x++) materialize(arrow(x), groups, context)
    assert.equal(context.vectors.size, 1, "one arrow survives twenty redraws")
    assert.equal(context.labels.size, 0, "a name deposits no label ink")
})

test("a collection of live vectors all reach the current-state slot at capacity one", () => {
    // A single pending slot repairs one arrow; the slot is keyed by identity, so a
    // collection of arrows each keeps its own newest value. (id:notation-coordinate-vector)
    const { scheduler, host } = world([
        "let B", "let A = [80, B.x, 0]", "let C = [40, B.x, 0]", "let D = [20, B.x, 0]",
    ].join("\n"), { capacity: 1 })
    assert.equal(move(scheduler, host.children.get("B"), 9).kind, "accept")
    const byName = new Map(vectorsIn(host).filter((e) => !e.removed).map((e) => [e.name, e.to]))
    assert.deepEqual(byName.get("A"), [80, 9, 0])
    assert.deepEqual(byName.get("C"), [40, 9, 0])
    assert.deepEqual(byName.get("D"), [20, 9, 0])
})

test("a newer fixed position retires the preceding live driver", () => {
    // A retired site's work must lose the right to publish: the accepted law is the
    // fixed one, so a drag on the live source no longer moves the place, and the
    // already-queued live move is dropped rather than re-installing the old owner.
    // (id:laws-ordered-replacement, id:laws-dependency-driven-place)
    const { scheduler, host } = world([
        "let B", "let A = (B.x, 100)", "let A = (10, 100)",
    ].join("\n"))
    assert.deepEqual(position(host.children.get("A")), [10, 100, 0], "the fixed law wins")
    assert.equal(move(scheduler, host.children.get("B"), 7).kind, "accept")
    drive(scheduler)
    assert.deepEqual(position(host.children.get("A")), [10, 100, 0], "the retired driver is silent")
})

test("a live replacement retires the predecessor and hands the name over", () => {
    const { scheduler, host } = world([
        "let B", "let C", "let A = (B.x, 0)", "let A = (C.x, 0)",
    ].join("\n"))
    assert.equal(scheduler.readouts.size, 1, "one place, one driver")
    assert.equal(move(scheduler, host.children.get("B"), 5).kind, "accept")
    drive(scheduler)
    assert.deepEqual(position(host.children.get("A")), [0, 0, 0], "the old source no longer drives")
    assert.equal(move(scheduler, host.children.get("C"), 9).kind, "accept")
    drive(scheduler)
    assert.deepEqual(position(host.children.get("A")), [9, 0, 0], "the new source drives")
})

test("a refused replacement keeps the old accepted driver", () => {
    // A replacement that cannot land must be atomic: it neither installs nor retires.
    const { scheduler, host } = world([
        "let B", "let A = (B.x, 100)", "let A = (0/0, 0, 0)",
    ].join("\n"))
    assert.ok(scheduler.errors.some((e) => /finite/.test(e.message)), "the refusal is loud")
    assert.deepEqual(position(host.children.get("A")), [0, 100, 0], "the old driver stands")
    assert.equal(move(scheduler, host.children.get("B"), 7).kind, "accept")
    drive(scheduler)
    assert.deepEqual(position(host.children.get("A")), [7, 100, 0], "and it still tracks")
})

test("a re-declared name retracts the whole object — geometry and name together", () => {
    // Stopping redraw is not removing: the owner's replacement transition removes the
    // displayed object itself. (id:notation-coordinate-vector, id:laws-ordered-replacement)
    const { scheduler, host } = world(["let B", "let A = [80, B.x, 0]", "let A = 5"].join("\n"))
    assert.equal(scheduler.readouts.size, 1, "one node survives the re-declaration")
    const retracted = vectorsIn(host).find((e) => e.removed)
    assert.ok(retracted, "the replacement retracts the arrow")
    assert.equal(retracted.name, "A", "and names which object left")
    assert.equal(move(scheduler, host.children.get("B"), 9).kind, "accept")
    assert.equal(vectorsIn(host).filter((e) => !e.removed).length, 0,
        "the retired vector driver is silent")
})

test("a vector replaced by a point of the same name is retracted", () => {
    const { host } = world(["let A = [80, 0, 0]", "let A = (10, 0, 0)"].join("\n"))
    assert.ok(vectorsIn(host).some((e) => e.removed && e.name === "A"),
        "the arrow left when the name became a point")
})

test("a vector replaced by a sampled parameter is retracted", () => {
    const { host } = world(["let A = [80, 0, 0]", "let A = random + 0"].join("\n"))
    assert.ok(vectorsIn(host).some((e) => e.removed && e.name === "A"),
        "a parameter is not a vector, so the arrow left")
})

test("a refused vector replacement keeps the old accepted object", () => {
    // A malformed replacement is a loud notice, not a silent removal: the binding
    // that stands is the one that landed. (id:notation-coordinate-vector)
    const { scheduler, host } = world(["let B", "let A = [80, B.x, 0]", "let A = [0/0, 0, 0]"].join("\n"))
    assert.ok(scheduler.errors.some((e) => /finite/.test(e.message)), "the refusal is loud")
    assert.equal(move(scheduler, host.children.get("B"), 7).kind, "accept")
    assert.deepEqual(vectorsIn(host).filter((e) => !e.removed).at(-1)?.to, [80, 7, 0],
        "the old object still tracks")
})

test("a vector declares its display in its own frame's current-state slot", () => {
    // The display belongs to the frame that declared it; a nested frame does not leak
    // its arrows upward. (id:notation-coordinate-vector)
    const { host } = world(["as S do", "  let A = [80, 0, 0]", "end"].join("\n"))
    const s = host.children.get("S")
    assert.ok(s, "the nested frame exists")
    assert.ok(vectorsIn(s).some((e) => e.name === "A" && !e.removed),
        "the arrow is the declaring frame's display")
    assert.equal(vectorsIn(host).length, 0, "and not its parent's")
})

test("self-reference is refused by policy even when a fixed point exists", () => {
    for (const expr of ["(A.x, 100)", "(A.x / 2 + 1, 100)"]) {
        const { scheduler, host } = world(`let A = (3, 100)\nlet A = ${expr}`)
        assert.equal(scheduler.done, true)
        assert.equal(scheduler.root._derivedMoves.length, 0)
        assert.ok(scheduler.errors.some((e) => /cannot be defined by itself/.test(e.message)))
        assert.deepEqual(position(host.children.get("A")), [3, 100, 0],
            "a refused definition preserves the accepted place, not a computed fixed point")
    }
})

test("a dependent place carries the frames its read RESOLVED, not a name scan", () => {
    // `let A = (B.x, 100)` resolved B, so it tracks; `let F = (10, 100)` resolved
    // nothing, so it is fixed. (id:laws-dependency-driven-place)
    const { scheduler, host } = world("let B\nlet A = (B.x, 100)\nlet F = (10, 100)")
    assert.equal(scheduler.readouts.size, 1, "only the resolved read owns a driver")
    assert.equal(move(scheduler, host.children.get("B"), 7).kind, "accept")
    drive(scheduler)
    assert.deepEqual(position(host.children.get("A")), [7, 100, 0], "A tracks its resolved source")
    assert.deepEqual(position(host.children.get("F")), [10, 100, 0], "F resolved nothing")
})

test("sampling once routes the value through its declared kind", () => {
    // Sampling answers *when* a value is read; the kind answers *what* is declared.
    // A sampled point is still a place; a sampled vector still a visible object.
    // (id:eval-relational, id:notation-coordinate-vector)
    const { host } = world("let P = (random, 2)\nlet V = [random, 3]")
    assert.ok(host.children.get("P"), "a sampled point is still a place")
    assert.ok(vectorsIn(host).some((e) => e.name === "V"),
        "a sampled vector is still a visible object")
})

test("a self-dependent place is refused, not looped", () => {
    // D054 refuses detected own-target reads as a definition policy.
    // This divergent example has no fixed point; stable self-reads are refused too.
    // (id:tower-laws-cycle-contracts)
    const { scheduler, host } = world("let A\nlet A = (A.x + 1, 0, 0)")
    assert.equal(scheduler.done, true, "no unbounded work remains")
    assert.equal(scheduler.root._derivedMoves.length, 0, "no move is queued")
    assert.ok(scheduler.errors.some((e) => /cannot be defined by itself/.test(e.message)),
        "the cycle is diagnosed")
    assert.deepEqual(position(host.children.get("A")), [0, 0, 0], "the place keeps its seat")
})

test("a stable self-read is refused by the same policy, and the place is preserved", () => {
    // `let A = (A.x, 100)` has a fixed point, but D054 is a definition policy, not a
    // solvability test. The existing place keeps its accepted state. (D054)
    const { scheduler, host } = world(["let A", "let A = (5, 0)", "let A = (A.x, 100)"].join("\n"))
    assert.ok(scheduler.errors.some((e) => /cannot be defined by itself/.test(e.message)),
        "the stable self-read is refused too")
    assert.equal(scheduler.root._derivedMoves.length, 0, "and queues no move")
    assert.deepEqual(position(host.children.get("A")), [5, 0, 0], "the place keeps its accepted state")
})
