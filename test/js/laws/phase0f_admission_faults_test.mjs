// Phase 0f: an admission fault is not a mathematical refusal.
//
// Only an explicit { accepted: false } may hold the pose as a *truth refusal*.
// A thrown responder, a malformed reply, or an accidental Promise is a protocol
// fault and must wound with its own message — never wear refusal's silence.
// (laws-build.org id:laws-build-solve-seam)
//
// Run: node --test test/js/laws/phase0f_admission_faults_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const FORWARD = { rotation: SE3.identity().rotation, position: [3, 0, 0] }

function fork(name, src) {
    return {
        name, origin: SE3.identity(), frame: null,
        style: { color: "#000000", thickness: 2, down: true, showTurtle: 10 },
        code: { ast: parseProgram(src), functions: {} },
        env: { userspace: new Map(), loopCounter: 0, scope: {} },
    }
}

function attempt(admit) {
    // A thrown responder used to escape hotSwapChild; it must now wound the frame.
    const scheduler = createScheduler(metaRoot(), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax: 1, breathEvery: 1 },
        channelCapacity: 64,
        motionAdmission: admit,
        onShout: () => {},
    })
    let escaped = null
    try {
        scheduler.hotSwapChild("w", fork("w", "fw 5\nwait 1"))
        for (let i = 0; i < 10 && !scheduler.done; i++) scheduler.tick(i * 1000)
    } catch (error) {
        escaped = error
    }
    const frame = scheduler.root.children.get("w")
    return { escaped, frame, errors: scheduler.errors }
}

test("a throwing responder wounds instead of escaping the scheduler", () => {
    const { escaped, frame, errors } = attempt(() => { throw new Error("boom") })
    assert.equal(escaped, null, "no fault may escape hotSwapChild or tick")
    assert.equal(frame.error?.kind, "motion")
    assert.match(frame.error.message, /motion responder failed: boom/)
    assert.deepEqual(errors.map((e) => e.message), [frame.error.message])
})

test("an accidental Promise does not masquerade as a refusal", () => {
    const { frame } = attempt(() => Promise.resolve({ accepted: true, transform: FORWARD }))
    assert.notEqual(frame.error, null, "a Promise must not read as { accepted: false }")
    assert.match(frame.error.message, /Promise/)
    assert.match(frame.error.message, /motionAdmissionAsync/, "the message names the door to use")
    assert.deepEqual(frame.transform.deref().position, [0, 0, 0])
})

test("a bare undefined is a malformed reply, not a refusal", () => {
    const { frame } = attempt(() => undefined)
    assert.match(frame.error?.message ?? "", /expected a verdict object/)
})

test("an accepted reply without a transform is a fault, not a no-op refusal", () => {
    const { frame } = attempt(() => ({ accepted: true }))
    assert.match(frame.error?.message ?? "", /no transform\.position/)
})

test("a component that is not a list is rejected", () => {
    const { frame } = attempt(() => ({ accepted: true, transform: FORWARD, component: "sibling" }))
    assert.match(frame.error?.message ?? "", /component is not a list/)
})

test("explicit refusal stays silent and holds the pose — the one clean refusal", () => {
    const { escaped, frame, errors } = attempt(() => ({ accepted: false }))
    assert.equal(escaped, null)
    assert.equal(frame.error, null, "a truth refusal is not an error")
    assert.deepEqual(errors, [])
    assert.deepEqual(frame.transform.deref().position, [0, 0, 0])
})
