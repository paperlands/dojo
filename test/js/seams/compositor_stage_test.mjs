// The turtle↔compositor seam — what the compositor REQUIRES off the stage.
// Run with: node --test test/js/seams/compositor_stage_test.mjs
//
// This is a CONTRACT, like three-entry.js, and it has two enforcers: the
// compositor checks STAGE_CONTRACT at birth (loud in the browser on the first
// draw), and this test pins the list against the module's actual stage reads.
//
// Why SOURCE and not an import: this test asks about DECLARATIONS — members nobody
// reads riding along (`renderer`, `recorder`, `renderstate`, `hatch`), and stage fields
// that used to smuggle cadence (`renderLoop.frameInterval`). An import cannot see a member
// nobody reads; only the text can.
//
// The import is NOT blocked. troika reaches neither the compositor nor the materializer
// as a bundle import — both take it as a stage-injected factory — so the compositor
// resolves under `node --test`, and `the compositor is still reachable` below keeps it so.
// (Corrected 2026-10-02: this header claimed the compositor was unreachable over troika's
// extensionless import. That dependency chain no longer exists — checked, not assumed.)
//
// What the source check still buys: members nobody reads riding along declared
// (`renderer`, `recorder`, `renderstate`, `hatch`), and stage fields that used
// to smuggle cadence (`renderLoop.frameInterval`) instead of an explicit opt.

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
const TURTLE_CODE = stripComments(TURTLE)

// The declared list, read out of the frozen array itself.
const declared = (() => {
    const block = COMPOSITOR.match(/STAGE_CONTRACT = Object\.freeze\(\[([\s\S]*?)\]\)/)
    assert.ok(block, "STAGE_CONTRACT must be a frozen array literal this test can read")
    return new Set([...block[1].matchAll(/'(\w+)'/g)].map((m) => m[1]))
})()

// Every `stage.x` / `stage?.x` the module actually reads.
const reads = new Set([...CODE.matchAll(/\bstage\??\.(\w+)/g)].map((m) => m[1]))

// Paren-matched slice of turtle's one createCompositor call.
function createCompositorCall(src) {
    const start = src.indexOf("createCompositor(")
    assert.ok(start > 0, "turtle.js must construct the compositor")
    let depth = 0, end = start
    for (let i = src.indexOf("(", start); i < src.length; i++) {
        if (src[i] === "(") depth++
        else if (src[i] === ")" && --depth === 0) { end = i; break }
    }
    return src.slice(start, end + 1)
}

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

    test("the contract is the five real verbs, nothing else", () => {
        // scene root, camera-pose sink, render waker, view offset, material cache.
        assert.deepEqual([...declared].sort(),
            ["camera", "materials", "requestRender", "scene", "viewOffset"])
    })

    test("the four dead members are gone and stay gone", () => {
        // They were passed for years; none was ever read. `hatch` is the loud one:
        // it was the TURTLE's hatch, so the bag mixed two lifetimes in one shape.
        for (const name of ["renderer", "recorder", "renderstate", "hatch"]) {
            assert.equal(reads.has(name), false, `stage.${name} is read again`)
            assert.equal(declared.has(name), false, `stage.${name} is declared again`)
        }
    })

    test("frame cadence is an opt, not a stage field", () => {
        // renderLoop sat on the bag only so FRAME_MS could peek frameInterval.
        // Cadence is now opts.frameMs (default 1000/60) — headless needs no loop.
        assert.match(CODE, /opts\.frameMs/)
        assert.equal(/stage\.renderLoop/.test(CODE), false,
            "compositor reaches into renderLoop again")
        assert.equal(declared.has("renderLoop"), false)
        assert.equal(declared.has("controls"), false)
        // Turtle hands the live loop's interval, not a mirrored stage bag field.
        const call = createCompositorCall(TURTLE_CODE)
        assert.match(call, /frameMs:/)
        assert.match(call, /controls:/)
    })

    test("a stage missing any member is refused by name, not defaulted", () => {
        // Presence (`in`), not truthiness — a missing verb is loud at birth.
        assert.match(CODE, /!\(name in stage\)/)
        assert.match(CODE, /throw new TypeError/)
    })

    test("the turtle hands over the live stage, never a copy of it", () => {
        // Paren-matched slice of the one call site, so a bag reintroduced inside
        // the call is caught even though `this.stage` still appears elsewhere.
        const call = createCompositorCall(TURTLE)
        assert.match(call, /\bthis\.stage\b/, "the live stage is the argument")
        for (const name of declared) {
            assert.equal(call.includes(`${name}:`), false,
                `\`${name}:\` is being mirrored into a bag at the call site again`)
        }
    })

    test("labels append across frames; only an explicit clear replaces them", () => {
        // `label` is ink: it persists until `erase` (a clear event). Resetting
        // the pool cursor in the per-frame label branch made each frame
        // overwrite slot 0, so a `label … wait` loop showed only its last word
        // (no-wait showed all — the whole loop rode one frame). rewrite() is the
        // replace path and belongs ONLY to clearChildLayer's keepLabels arm.
        const rewrites = [...CODE.matchAll(/\.labels\.rewrite\(\)/g)]
        assert.equal(rewrites.length, 1,
            "rewrite() belongs to the replace path alone, not the per-frame label branch")
        assert.match(CODE, /if \(keepLabels\) layer\.labels\.rewrite\(\)/)
        assert.match(CODE, /clearChildLayer\(layer, \{ keepLabels: willPrint \}\)/)
    })
})

// The header's claim, CHECKED rather than asserted. If troika ever reaches the
// compositor's eager path again, this fails here instead of surprising a future reader.
// (id:cmp-resilient)
test("the compositor is still reachable from `node --test`", async () => {
    await assert.doesNotReject(() => import("../../../assets/js/turtling/compositor.js"))
})
