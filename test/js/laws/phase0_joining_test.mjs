// Phase 0 — the joining experiment.
//
// Three operations are not interchangeable ways to restart a generator:
//   new play      — discard the previous realization, initialize again
//   source edit   — replace authored meaning, reconcile affected state
//   as A          — act through a place that already belongs to this world
//
// SCOPE. The re-entry case below is *ordinary, undeclared* re-entry: it records
// the behaviour that must be preserved for an actor that does not participate in
// a batch. It becomes a failing *declared* joining acceptance test only when the
// batch actually identifies A ([[id:laws-decl-join-repair]]). Until then it is
// characterization, and the risk it guards is the cheapest wrong fix — changing
// ordinary `as` globally.
//
// Run: node --test test/js/laws/phase0_joining_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { reparseProgram } from "../../../assets/js/turtling/parse.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const quat = (rotation) => [rotation.x, rotation.y, rotation.z, rotation.w].map((n) => +n.toFixed(6))
// The direction `fw` advances along: the frame's own x axis, read in its frame.
const fwAxis = (rotation) => [
    1 - 2 * (rotation.y * rotation.y + rotation.z * rotation.z),
    2 * (rotation.x * rotation.y + rotation.w * rotation.z),
    2 * (rotation.x * rotation.z - rotation.w * rotation.y),
].map((n) => +n.toFixed(6))
const pose = (scheduler, name) => {
    const frame = find(scheduler.root, name)
    const { position, rotation } = frame.transform.deref()
    return {
        id: frame.id,
        local: position.map((n) => +n.toFixed(6)),
        heading: quat(rotation),
        axis: fwAxis(rotation),
        origin: frame.origin.position.map((n) => +n.toFixed(6)),
        originQuat: quat(frame.origin.rotation),
        world: frameWorldTransform(frame).position.map((n) => +n.toFixed(6)),
        run: frame.run,
    }
}
const pass = ({ requested }) => ({ accepted: true, transform: requested })

// A settled place at local (3,0) turned 90°; then the caller moves to 20 and
// turns 45°. `tail` is what happens next.
const program = (tail) => [
    "as a do",
    "  goto 3 0",
    "  rt 90",
    "end",
    "goto 20 0",
    "rt 45",
    tail,
].join("\n")
const entry = ["as a do", "  fw 1", "end"].join("\n")

const H90 = [0, 0, -0.707107, 0.707107]     // rt 90 about z
const H45 = [0, 0, -0.382683, 0.92388]      // rt 45 about z

const established = () => {
    const scheduler = buildWorld({ admit: pass })
    scheduler.hotSwapChild("host", fork("host", program("wait 0")))
    drive(scheduler)
    return pose(scheduler, "a")
}
const reentered = () => {
    const scheduler = buildWorld({ admit: pass })
    scheduler.hotSwapChild("host", fork("host", program(entry)))
    drive(scheduler)
    return pose(scheduler, "a")
}

test("characterization: ordinary re-entry moves the place and restarts its body", () => {
    const first = established()
    assert.deepEqual(first.local, [3, 0, 0], "settled at local (3,0)")
    assert.deepEqual(first.heading, H90, "settled at heading 90°")
    assert.deepEqual(first.axis, [0, -1, 0], "fw advances along -y at 90°")
    assert.deepEqual(first.origin, [0, 0, 0], "placement is the caller's pose at birth")
    assert.deepEqual(first.world, [3, 0, 0], "identity placement: world names local")

    const again = reentered()
    // The ruling, for a *declared* place, is local (3,-1) at heading 90° with the
    // placement unmoved — world (3,-1). Today:
    assert.deepEqual(again.origin, [20, 0, 0],
        "ordinary re-entry re-places the actor at the caller (originQuat = the caller's 45°)")
    assert.deepEqual(again.originQuat, H45, "the caller's turn travelled into the placement too")
    assert.deepEqual(again.local, [1, 0, 0],
        "the body restarted at identity; fw 1 makes (1,0), not the continue-from-(3,0) step")
    assert.deepEqual(again.heading, [0, 0, 0, 1],
        "the accepted heading was reset; a positional truth does not constrain orientation")
    assert.deepEqual(again.world, [20.707107, -0.707107, 0],
        "world = caller placement ⊕ an identity-headed local body")
    // The unseen cost, in one line: the actor's whole world-space explanation
    // changed, though nothing was admitted to it.
    assert.notDeepEqual(again.world, [3, -1, 0])
})

test("acceptance: a first entry still places the ambient at the caller", () => {
    const scheduler = buildWorld({ admit: pass })
    scheduler.hotSwapChild("host", fork("host", ["as b do", "  fw 5", "end"].join("\n")))
    drive(scheduler)
    const b = pose(scheduler, "b")
    // Fresh identity: born at the caller's pose, walking from its own origin.
    assert.deepEqual(b.origin, [0, 0, 0])
    assert.deepEqual(b.local, [5, 0, 0])
    assert.deepEqual(b.world, [5, 0, 0])
})

test("acceptance: the ordinary undeclared counterpart is unchanged", () => {
    const scheduler = buildWorld({ admit: pass })
    scheduler.hotSwapChild("host", fork("host", [
        "goto 7 0",
        "as b do",
        "  fw 1",
        "end",
    ].join("\n")))
    drive(scheduler)
    const b = pose(scheduler, "b")
    // A body that meets no existing place still starts where the caller stands.
    assert.deepEqual(b.origin, [7, 0, 0])
    assert.deepEqual(b.local, [1, 0, 0])
    assert.deepEqual(b.world, [8, 0, 0])
})

test("acceptance: an unchanged execution seed retains, a newly allocated one replaces", () => {
    const source = program(entry)
    const spec = fork("host", source)
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", spec)
    drive(scheduler)
    const before = pose(scheduler, "a")

    // The same seed object reuses the frame; no execution restarts.
    assert.equal(scheduler.hotSwapChild("host", spec), host)
    assert.equal(pose(scheduler, "a").id, before.id)
    assert.equal(pose(scheduler, "a").run, before.run, "unchanged execution was not restarted")

    // Green-tree reuse: an indentation-only edit keeps the top-level node, and
    // with the function and userspace identities held constant the seat too.
    const indented = reparseProgram(program(entry).replace("  goto 3 0", "    goto 3 0"), source, spec.code.ast)
    assert.equal(indented[0], spec.code.ast[0], "reparseProgram reused the node")
    const green = scheduler.hotSwapChild("host", { ...spec, code: { ...spec.code, ast: indented } })
    assert.equal(green, host, "an indentation-only edit retained the seat")
    assert.equal(pose(scheduler, "a").id, before.id)

    // A newly allocated execution seed replaces the subtree — declaration,
    // accepted pose and identity. Relationship-only edits must update the batch
    // independently of whether the executable seed changes.
    const changed = reparseProgram(source.replace("goto 3 0", "goto 4 0"), source, spec.code.ast)
    assert.notEqual(changed[0], spec.code.ast[0], "a changed body allocates a node")
    const replaced = scheduler.hotSwapChild("host", { ...spec, code: { ...spec.code, ast: changed } })
    assert.notEqual(replaced, host)
    assert.notEqual(pose(scheduler, "a").id, before.id, "a new execution seed destroys the identity")
})

test("acceptance: a fresh play inherits nothing", () => {
    const scheduler = buildWorld({ admit: pass })
    scheduler.hotSwapChild("host", fork("host", program(entry)))
    drive(scheduler)
    const before = find(scheduler.root, "a")
    assert.equal(before.done, true)

    scheduler.hotSwapChild("host", fork("host", ["as a do", "  fw 1", "end"].join("\n")), { fresh: true })
    drive(scheduler)
    assert.notEqual(find(scheduler.root, "a"), before, "a fresh play realizes anew")
    assert.deepEqual(pose(scheduler, "a").local, [1, 0, 0])
})
