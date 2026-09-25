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

test("the canvas offers a hand only to an unanchored place", () => {
    const turtle = readFileSync(new URL("../../../assets/js/turtling/turtle.js", import.meta.url), "utf8")
    assert.match(turtle, /frameWorldTransform\(frame\)\.position/, "both marks read the accepted position")
    assert.match(turtle, /pointCandidates\(scheduler\.registry\.values\(\), frame => this\._touchable\(frame\)\)/,
        "the state query gates the pointer gesture, topmost first")
    assert.match(turtle, /canTouch: frame => this\._touchable\(frame\)/, "a point gaining a head releases an existing capture")
    assert.doesNotMatch(turtle, /\bfreePoint\(/, "the pin loop reads the state, not a second predicate")
})
