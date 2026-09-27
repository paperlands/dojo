// The seam between our subclass and vendored three.js.
//
// DojoOrbitControls (assets/js/turtling/orbit.js) overrides a few
// underscore-private entry points the stock state machine dispatches, and
// still reads a small private surface for pointer state / zoom-to-cursor /
// dolly-through bookkeeping. Span and drift route through the *public* rig
// API (#32810). If an upgrade renames an overridden entry, our override is
// simply never invoked and gesture arbitration stops SILENTLY.
//
// So assert the seam textually: no import, no DOM, no THREE (the vendored file
// pulls in the whole minified core), which keeps this in the zero-npm rig.

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const VENDOR = "assets/js/utils/threeorbital.js"
const SUBCLASS = "assets/js/turtling/orbit.js"
const vendor = readFileSync(new URL(`../../../${VENDOR}`, import.meta.url), "utf8")
const subclass = readFileSync(new URL(`../../../${SUBCLASS}`, import.meta.url), "utf8")

// Methods we override. Each MUST still be dispatched through `this.` inside the
// vendored file, or our override is dead code.
const OVERRIDDEN = [
    "_handleTouchStartDollyRotate",
    "_handleTouchStartDollyPan",
    "_handleTouchMoveDollyRotate",
    "_handleTouchMoveDollyPan",
    "_handleMouseDownDolly",
    "update"
]

// Private members we still call (not override). Keep this list short — every
// entry is an upgrade risk. Span/drift no longer need the private touch
// start/move handlers; they go through public pan/rotate/dolly.
const CALLED = [
    "_updateZoomParameters",
    "_dollyStart",
    "_pointers",
    "_pointerPositions",
    "_lastTargetPosition"
]

// Public rig DOF from #32810 — the intent→rig boundary we route through.
const PUBLIC_RIG = [
    "pan(",
    "rotateLeft(",
    "rotateUp(",
    "dollyIn(",
    "dollyOut("
]

describe("the vendored/subclass seam", () => {
    for (const name of OVERRIDDEN) {
        test(`vendored OrbitControls still defines ${name}()`, () => {
            assert.ok(
                vendor.includes(`\t${name}( `),
                `${VENDOR} no longer defines ${name}() — our override in ${SUBCLASS} is now dead code`
            )
        })
    }

    for (const name of OVERRIDDEN) {
        if (name === "update") continue // called by the render loop, not internally
        test(`vendored OrbitControls still dispatches ${name} through this.`, () => {
            assert.ok(
                vendor.includes(`this.${name}( event )`),
                `${VENDOR} no longer calls this.${name}(event) — our override would never run`
            )
        })
    }

    for (const name of CALLED) {
        test(`vendored OrbitControls still has ${name}`, () => {
            assert.ok(
                vendor.includes(name),
                `${VENDOR} no longer has ${name}, which ${SUBCLASS} depends on`
            )
        })
    }

    for (const sig of PUBLIC_RIG) {
        test(`vendored OrbitControls still exposes public ${sig.slice(0, -1)}()`, () => {
            assert.ok(
                vendor.includes(`\t${sig}`),
                `${VENDOR} no longer has public ${sig.slice(0, -1)}() — #32810 surface missing`
            )
        })
    }

    test("subclass routes span/drift through public pan/rotate/dolly, not private touch-move", () => {
        assert.match(subclass, /\.pan\s*\(/)
        assert.match(subclass, /\.rotateLeft\s*\(/)
        assert.match(subclass, /\.rotateUp\s*\(/)
        assert.match(subclass, /\.dollyOut\s*\(/)
        // Call sites only — the composite overrides we still define
        // (_handleTouchMoveDollyRotate etc.) contain these as prefixes.
        for (const call of [
            "this._handleTouchMoveDolly(",
            "this._handleTouchMoveRotate(",
            "this._handleTouchMovePan(",
            "this._handleTouchStartDolly(",
            "this._handleTouchStartRotate(",
            "this._handleTouchStartPan("
        ]) {
            assert.ok(
                !subclass.includes(call),
                `${SUBCLASS} still calls ${call} — route through the public rig API instead`
            )
        }
    })

    test("dojo behaviour has not crept back into the vendored file", () => {
        for (const smell of ["gesture.js", "gestureArbitration", "dollyThrough", "_arbiter", "dollyStandoff"]) {
            assert.ok(
                !vendor.includes(smell),
                `${VENDOR} mentions "${smell}" — dojo behaviour belongs in ${SUBCLASS} so the vendored file stays swappable`
            )
        }
    })

    test("the subclass disarms the near clamp that dolly-through replaces", () => {
        // With minDistance = 0 the stock clamp is identity at the near end, so
        // stock itself computes the unclamped advance; the subclass then floors
        // the TARGET. Re-introducing a minDistance would silently restore the
        // asymptote this whole design exists to remove.
        assert.match(subclass, /this\.minDistance\s*=\s*0/)
        assert.match(subclass, /dollyStandoff/)
    })

    test("the clientX-as-y middle-dolly fix still lives in the subclass", () => {
        // Upstream still passes clientX as y in r185. Fix stays here so the
        // vendored file never conflicts on upgrade.
        assert.match(subclass, /_updateZoomParameters\(\s*event\.clientX\s*,\s*event\.clientY\s*\)/)
    })
})
