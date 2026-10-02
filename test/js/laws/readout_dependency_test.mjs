// The readout store is a dependency graph, not a list swept in registration order.
//
// ORDER: a node answers AFTER everything it stands on, whatever order the declarations
// arrived in — registry history must not decide the answer. ACYCLIC: a definition that
// stands on itself, even through a scalar or a frame it drives, is accidental feedback,
// diagnosed — never looped. (id:tower-laws-cycle-contracts, id:laws-dependency-driven-place)
// Run: node --test test/js/laws/readout_dependency_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const position = (frame) => frameWorldTransform(frame).position
const drag = (scheduler, frame, x) => scheduler.requestMotion(frame, {
    rotation: frame.transform.deref().rotation, position: [x, 0, 0],
}, scheduler.motionRevision)

const run = (lines) => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", lines.join("\n")))
    drive(scheduler)
    return { scheduler, host }
}

test("a dependency answers in ITS order, not the order declarations arrived", () => {
    // `s` reads `t` and was declared before it. Both spellings must agree: the answer
    // must not depend on which node the registry happened to hold first.
    const late = run(["let B", "let s = 0", "let t = B.x", "let s = t + 1", "let A = (s, 100)"])
    const early = run(["let B", "let t = B.x", "let s = t + 1", "let A = (s, 100)"])
    for (const { scheduler, host } of [late, early]) {
        assert.equal(drag(scheduler, host.children.get("B"), 7).kind, "accept")
        drive(scheduler)
        assert.deepEqual(position(host.children.get("A")), [8, 100, 0])
    }
})

test("a chain of derived places is not a cycle", () => {
    // `C` reads the frame `A` drives; `A` reads the frame `B` a hand drives. No loop.
    const { scheduler, host } = run(["let B", "let A = (B.x, 0)", "let C = (A.x + 1, 0)"])
    assert.equal(scheduler.errors.length, 0, "an acyclic chain is not refused")
    assert.equal(drag(scheduler, host.children.get("B"), 3).kind, "accept")
    drive(scheduler)
    assert.deepEqual(position(host.children.get("A")), [3, 0, 0])
    assert.deepEqual(position(host.children.get("C")), [4, 0, 0])
})

test("an indirect self-dependence is diagnosed, not looped", () => {
    // A stands on `s`; `s` stands on A. The frame-mediated loop is an ordinary cycle.
    const { scheduler, host } = run(["let A", "let s = A.x + 1", "let A = (s, 0)"])
    assert.ok(scheduler.errors.some((e) => /cannot be defined by itself/.test(e.message)),
        "the indirect cycle is diagnosed")
    assert.equal(scheduler.done, true, "no unbounded work remains")
    assert.equal(scheduler.root._derivedMoves.length, 0, "no move is queued")
})
