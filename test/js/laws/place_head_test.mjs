// One A: place and walking head share accepted geometry and identity.
// The WebGL compositor needs a browser (threetext's extensionless import cannot
// run in node); this pins its inputs, while pin_test pins the passive mark.
// Run: node --test test/js/laws/place_head_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { frameWorldTransform, worldTransform, takeSync } from "../../../assets/js/turtling/scheduler.js"
import { buildWorld, fork, drive } from "./harness.mjs"

const close = (actual, expected) => actual.forEach((n, i) =>
    assert.ok(Math.abs(n - expected[i]) < 1e-6, `${actual} != ${expected}`))

test("an empty declared A exists but emits no walking head", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let A"))
    const a = host.children.get("A")
    assert.ok(a?.isPlace)
    assert.equal(a.done, true)
    assert.deepEqual(takeSync(a), [], "a place alone does not pretend to walk")
})

test("let A + as A: one place and one headed walker, at the same position", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let A", "fw 200", "as A do", "  fw 100", "  rt 90", "  fw 100", "end",
    ].join("\n")))
    const a = host.children.get("A")
    assert.ok(a?.isPlace, "as adopted the already declared A")
    const trace = drive(scheduler)
    const head = takeSync(a).find((event) => event.type === "head")
    assert.ok(head?.headSize > 0, "A emits a visible heading cue")
    assert.ok((trace.get("A") ?? []).some((event) => event.type === "path"),
        "A's strokes stay in A's layer")
    close(head.position, a.transform.deref().position)
    close(SE3.apply(worldTransform(a), head.position), frameWorldTransform(a).position)
    assert.equal(host.children.get("A"), a, "the place and the walking head are one ambient")
})

// The arm a bodyless place wears is read from here: a declaration is seated at the
// walk's reached pose, facing forward, and a world transform is frozen at the
// parent's birth origin — so the heading is heritable and does not follow the
// walker on. (id:laws-decl-interface, id:laws-ordered-birth)
test("a place inherits the heading it was born with, and keeps it when the head walks on", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", [
        "rt 90",        // the head faces −y when the declaration is reached
        "let A",
        "rt 90",        // the head turns on; the place does not
        "fw 100",
    ].join("\n")))
    const a = host.children.get("A")
    drive(scheduler)
    const forward = (frame) => frameWorldTransform(frame).rotation.rotateVec(1, 0, 0)
    close(forward(a), [0, -1, 0])
    close(a.transform.deref().position, [0, 0, 0])
    close(forward(host), [-1, 0, 0])
})

test("the canvas offers a hand only to an unanchored place", () => {
    const turtle = readFileSync(new URL("../../../assets/js/turtling/turtle.js", import.meta.url), "utf8")
    assert.match(turtle, /const world = frameWorldTransform\(frame\)/, "both marks read one accepted world pose")
    assert.match(turtle, /world\.rotation\.rotateVec\(FACING_STEP, 0, 0\)/,
        "the arm is the place's own heading, not the paper's north")
    assert.match(turtle, /pointCandidates\(scheduler\.registry\.values\(\), frame => this\._touchable\(frame\)\)/,
        "the state query gates the pointer gesture, topmost first")
    assert.match(turtle, /canTouch: frame => this\._touchable\(frame\)/, "a point gaining a head releases an existing capture")
    assert.doesNotMatch(turtle, /\bfreePoint\(/, "the pin loop reads the state, not a second predicate")
})

