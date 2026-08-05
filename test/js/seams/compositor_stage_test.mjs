// The turtle↔compositor seam — what the compositor reads off the stage.
// Run with: node --test test/js/seams/compositor_stage_test.mjs
//
// This is a CONTRACT, like three-entry.js, and it has two enforcers: the
// compositor checks STAGE_CONTRACT at birth (loud in the browser on the first
// draw), and this test pins the list against the module's actual reads.
//
// It reads SOURCE rather than importing, which is not the shape we'd choose:
// compositor.js → materializer.js → utils/threetext.js, and that vendored troika
// bundle says `from "./three.core.min"` with no extension. Bundlers resolve it;
// node cannot, and the file is hashed immutable in VENDOR.org. So the compositor
// — 444 lines carrying the reframe fold — is unreachable from `node --test` over
// one missing `.js` in a file we may not touch. Lifting troika's import out of
// the materializer's eager path is what would let this test hold the real object.
//
// What the source check still buys, exactly: the two ways this seam has actually
// failed. A member the caller never delivers (`frameInterval`, which sat in the
// wrong argument and took the fallback for its whole life), and members nobody
// reads riding along declared (`renderer`, `recorder`, `renderstate`, `hatch`).

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8")

// Comments name members in prose; only code counts as a read.
const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const COMPOSITOR = read("../../../assets/js/turtling/compositor.js")
const TURTLE = read("../../../assets/js/turtling/turtle.js")
const CODE = stripComments(COMPOSITOR)

// The declared list, read out of the frozen array itself.
const declared = (() => {
    const block = COMPOSITOR.match(/STAGE_CONTRACT = Object\.freeze\(\[([\s\S]*?)\]\)/)
    assert.ok(block, "STAGE_CONTRACT must be a frozen array literal this test can read")
    return new Set([...block[1].matchAll(/'(\w+)'/g)].map((m) => m[1]))
})()

// Every `stage.x` / `stage?.x` the module actually reads.
const reads = new Set([...CODE.matchAll(/\bstage\??\.(\w+)/g)].map((m) => m[1]))

describe("the compositor's stage contract", () => {
    test("every declared member is one the compositor reads", () => {
        const dead = [...declared].filter((n) => !reads.has(n))
        assert.deepEqual(dead, [],
            `declared but never read — the bag grew members nobody wanted: ${dead}`)
    })

    test("every member the compositor reads is declared", () => {
        const undeclared = [...reads].filter((n) => !declared.has(n))
        assert.deepEqual(undeclared, [],
            `read but not declared — a caller can omit it and get silence: ${undeclared}`)
    })

    test("the four dead members are gone and stay gone", () => {
        // They were passed for years; none was ever read. `hatch` is the loud one:
        // it was the TURTLE's hatch, so the bag mixed two lifetimes in one shape.
        for (const name of ["renderer", "recorder", "renderstate", "hatch"]) {
            assert.equal(reads.has(name), false, `stage.${name} is read again`)
            assert.equal(declared.has(name), false, `stage.${name} is declared again`)
        }
    })

    test("the cadence is read from the live loop, not handed in", () => {
        // frameInterval was passed by the caller into the wrong argument and read
        // as `opts.frameInterval`, so FRAME_MS always took `1000/60`. It was benign
        // only because targetFPS is hardcoded 60 (render/loop.js). One source now.
        assert.match(CODE, /const FRAME_MS = stage\.renderLoop\?\.frameInterval/)
        assert.equal(/opts\.frameInterval/.test(CODE), false,
            "frameInterval is a copy again — that copy is the bug")
    })

    test("a stage missing any member is refused by name, not defaulted", () => {
        // The check is presence, not truthiness (renderLoop is legitimately null).
        assert.match(CODE, /!\(name in stage\)/)
        assert.match(CODE, /throw new TypeError/)
    })

    test("the turtle hands over the live stage, never a copy of it", () => {
        // Paren-matched slice of the one call site, so a bag reintroduced inside
        // the call is caught even though `this.stage` still appears elsewhere.
        const start = TURTLE.indexOf("createCompositor(")
        assert.ok(start > 0, "turtle.js must construct the compositor")
        let depth = 0, end = start
        for (let i = TURTLE.indexOf("(", start); i < TURTLE.length; i++) {
            if (TURTLE[i] === "(") depth++
            else if (TURTLE[i] === ")" && --depth === 0) { end = i; break }
        }
        const call = TURTLE.slice(start, end + 1)
        assert.match(call, /\bthis\.stage\b/, "the live stage is the argument")
        for (const name of declared) {
            assert.equal(call.includes(`${name}:`), false,
                `\`${name}:\` is being mirrored into a bag at the call site again`)
        }
    })
})
