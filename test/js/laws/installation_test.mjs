// Effective installation — the checked configuration and the installed one are the same.
// (id:laws-p0m-publication, id:laws-build-solve-seam, id:cull-hunt-effective-installation)
//
// Two correctness failures the cull hunt found beneath the diffusion:
//   1. approximate write suppression (a presentation epsilon) changed the configuration the
//      whole-law gate had just validated;
//   2. validity was decided before the arithmetic (frame conversion, stated-origin
//      calculation) that could invalidate it.
// These controls assert the DESIRED behaviour; the hunt's `hunt.mjs` asserts the defects.
//
// Run: node --test test/js/laws/installation_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { AUTHORED, bindWorld } from "../../../assets/js/turtling/laws/authored.js"

const pos = (f) => frameWorldTransform(f).position
const measure = (scheduler, law) => AUTHORED[law.feature].measure(law,
    bindWorld((id) => scheduler.registry.get(id), { live: frameWorldTransform, placement: frameWorldTransform }))

// 1a. A joint candidate whose writer moves by less than a display epsilon: the writer is
//     WRITTEN, so the installed pair satisfies the law the gate checked.
test("the installer writes the validated candidate, not a tolerance-suppressed approximation", () => {
    let scheduler
    const A = () => scheduler.root.children.get("host").children.get("A")
    scheduler = buildWorld({ admit: (r) => r.command !== "hand" ? { accepted: true, transform: r.requested }
        : { accepted: true, transform: r.requested,
            component: [{ frame: A(), transform: { rotation: SE3.identity().rotation, position: [9e-7, 0, 0] } }] } })
    const host = scheduler.hotSwapChild("host", fork("host", "let A\njmp 5\nlet B\nlet distance(A,B)=5"))
    drive(scheduler)
    const a = A(), b = host.children.get("B")
    const verdict = scheduler.requestMotion(b,
        { rotation: SE3.identity().rotation, position: [5 + 1.1e-6, 0, 0] }, scheduler.motionRevision, "world")
    const law = scheduler.laws.active().find((l) => l.feature === "distance")
    assert.equal(verdict.kind, "accept")
    assert.ok(Math.abs(pos(a)[0] - 9e-7) < 1e-9, "the sub-epsilon writer really moved")
    assert.equal(measure(scheduler, law).status, "valid", "the installed configuration satisfies the law")
})

// 1b. A small authored pin installs EXACTLY; the position law reports valid, not violation.
test("a sub-epsilon authored pin installs exactly, so the position law holds", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet A=(0.0000009,0.0000009,0.0000009)"))
    drive(scheduler)
    const a = host.children.get("A")
    const law = scheduler.laws.active().find((l) => l.feature === "position")
    assert.equal(host.error, null)
    assert.deepEqual(pos(a), [9e-7, 9e-7, 9e-7], "the pin's own coordinates land")
    assert.equal(measure(scheduler, law).status, "valid")
})

// 2. A world wish whose conversion overflows is not installed as Infinity.
test("a wish that overflows on the way into the frame's own chain is not accepted", () => {
    const scheduler = buildWorld({ admit: (r) => ({ accepted: true, transform: r.requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "jmp -1e308\nlet A"))
    drive(scheduler)
    const a = host.children.get("A")
    const before = [...pos(a)]
    const verdict = scheduler.requestMotion(a,
        { rotation: SE3.identity().rotation, position: [1e308, 0, 0] }, scheduler.motionRevision, "world")
    assert.notEqual(verdict.kind, "accept")
    assert.equal(SE3.isValid(frameWorldTransform(a)), true, "no invalid pose reached the frame")
    assert.deepEqual(pos(a), before, "the accepted state is unchanged")
})

// 3. An own-frame stated wish whose origin calculation overflows is not stored.
test("a stated wish whose computed origin overflows is not stored", () => {
    const scheduler = buildWorld({ admit: (r) => ({ accepted: true, transform: r.requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "jmp 1e308\nlet A"))
    drive(scheduler)
    const a = host.children.get("A")
    const verdict = scheduler.requestMotion(a,
        { rotation: SE3.identity().rotation, position: [1e308, 0, 0] }, scheduler.motionRevision, "own")
    assert.notEqual(verdict.kind, "accept")
    assert.equal(SE3.isValid(a.origin), true, "no invalid origin reached the frame")
})
