// Phase 0 — the joining experiment (first slice of Phase 1).
//
// Three operations are not interchangeable ways to restart a generator:
//   new play      — discard the previous realization, initialize again
//   source edit   — replace authored meaning, reconcile affected state
//   as A          — act through a place that already belongs to this world
//
// The ruling under test:
//   Within one play, `as A` addresses the existing declared place. Starting a
//   body there does not itself move that place. A new execution begins from its
//   current accepted pose.
//
// Today the re-entry door does neither: it overwrites the place with the
// caller's pose AND seeds the new executor at identity. Both failures are kept
// visible below, with the paths that must not change pinned alongside.
//
// `let` has no parser form yet, so the declared place is established the way a
// declaration will: a settled ambient with a non-origin pose and heading.
// Run: node --test test/js/laws/phase0_joining_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const pose = (scheduler, name) => {
    const frame = find(scheduler.root, name)
    return {
        id: frame.id,
        local: frame.transform.deref().position.map((n) => +n.toFixed(6)),
        heading: +frame.transform.deref().rotation.w.toFixed(6),
        origin: frame.origin.position.map((n) => +n.toFixed(6)),
        world: frameWorldTransform(frame).position.map((n) => +n.toFixed(6)),
        run: frame.run,
    }
}
const pass = ({ requested }) => ({ accepted: true, transform: requested })

// A settled place A at local (3,0), turned 90°; then the caller moves to 20 and
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

const W90 = Math.SQRT1_2   // the quaternion w of a 90° turn

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

test("characterization: re-entry moves the place and restarts its body at identity", () => {
    const first = established()
    assert.deepEqual(first.local.slice(0, 2), [3, 0], "A settled at (3,0)")
    assert.equal(first.heading, +W90.toFixed(6), "A settled at heading 90°")
    assert.deepEqual(first.origin.slice(0, 2), [0, 0], "A's placement is the caller's pose at birth")
    assert.deepEqual(first.world.slice(0, 2), [3, 0], "the frame own turn does not rotate its own position")

    const again = reentered()
    // 1. the place was overwritten by the caller's new pose (20, turned 45°)
    assert.deepEqual(again.origin.slice(0, 2), [20, 0], "origin should not move on entry")
    // 2. the body restarted at identity instead of continuing from (3,0)
    assert.deepEqual(again.local.slice(0, 2), [1, 0], "a new execution must begin from the accepted pose")
    // 3. the accepted heading was reset, not preserved
    assert.equal(again.heading, 1, "a positional truth does not constrain orientation; keep it")
})

test("acceptance: a first entry still places the ambient at the caller", () => {
    const scheduler = buildWorld({ admit: pass })
    scheduler.hotSwapChild("host", fork("host", ["as b do", "  fw 5", "end"].join("\n")))
    drive(scheduler)
    const b = pose(scheduler, "b")
    // Fresh identity: born at the caller's pose, walking from its own origin.
    assert.deepEqual(b.origin.slice(0, 2), [0, 0])
    assert.deepEqual(b.local.slice(0, 2), [5, 0])
    assert.deepEqual(b.world.slice(0, 2), [5, 0])
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
    assert.deepEqual(b.origin.slice(0, 2), [7, 0])
    assert.deepEqual(b.local.slice(0, 2), [1, 0])
    assert.deepEqual(b.world.slice(0, 2), [8, 0])
})

test("characterization: an unchanged body is retained, a reparsed one is destroyed", () => {
    const source = program(entry)

    // Same AST object: the seed matches, the place keeps its identity.
    const kept = buildWorld({ admit: pass })
    const spec = fork("host", source)
    const host = kept.hotSwapChild("host", spec)
    drive(kept)
    const before = pose(kept, "a")
    assert.equal(kept.hotSwapChild("host", spec), host, "an unchanged body reuses its frame")
    assert.equal(pose(kept, "a").id, before.id)
    assert.equal(pose(kept, "a").run, before.run, "unchanged execution was not restarted")

    // Reparsed text — even byte-identical — is a different AST, so the seed
    // differs and the whole subtree is replaced. There is no relationship-only
    // edit: every authored change takes this door, taking declaration, accepted
    // pose and identity with it.
    const edited = buildWorld({ admit: pass })
    edited.hotSwapChild("host", fork("host", source))
    drive(edited)
    const gone = pose(edited, "a")
    edited.hotSwapChild("host", fork("host", source))
    drive(edited)
    const after = pose(edited, "a")
    assert.notEqual(after.id, gone.id, "a reparsed edit destroys the declared identity")
    assert.notEqual(after.run, gone.run, "the execution is a new run")
    assert.notDeepEqual(after.local.slice(0, 2), [3, 0], "the accepted pose did not survive")
})

test("acceptance: a fresh play inherits nothing", () => {
    const scheduler = buildWorld({ admit: pass })
    scheduler.hotSwapChild("host", fork("host", program(entry)))
    drive(scheduler)
    const before = find(scheduler.root, "a")
    assert.equal(before.done, true)

    scheduler.hotSwapChild("host", fork("host", ["as a do", "  fw 1", "end"].join("\n")), { fresh: true })
    drive(scheduler)
    const after = find(scheduler.root, "a")
    assert.notEqual(after, before, "a fresh play realizes anew")
    assert.deepEqual(pose(scheduler, "a").local.slice(0, 2), [1, 0])
})
