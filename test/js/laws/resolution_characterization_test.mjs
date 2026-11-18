// Cut 2, step 1 — the resolution and establishment rules, frozen as behaviour before
// any extraction. These are DEFINITION and USE rules, not operator-name checks:
//
//   definition (bare, plain, position) — establishes or adopts; never a use-before-introduction
//   use        (coordinate, distance)  — resolves an existing identity; ordered birth applies
//
// Scope: a local child is adopted; a definition with no local child shadows an outer
// namesake only when THIS scope's body declares the name; otherwise a definition (and
// always a use) reaches the visible outer identity.
// (D058, D061, laws-ordered-birth, laws-first-two-pin-birth)
//
// Run: node --test test/js/laws/resolution_characterization_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { buildWorld, fork, drive } from "./harness.mjs"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const pos = (f) => f ? frameWorldTransform(f).position.map((n) => +n.toFixed(4)) : null

// Drive one host program and read the scope it names (B if present, else the host).
function scope(src) {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", src))
    drive(scheduler, { maxTicks: 12 })
    const B = find(host, "B")
    const at = B ?? host
    return {
        host, B, at, scheduler,
        V: at.children.get("V"),
        hostV: host.children.get("V"),
        err: (at.error ?? host.error)?.message ?? null,
        laws: scheduler.laws.active().map((l) => l.feature + (l.axis ? ":" + l.axis : "")).sort(),
    }
}

// --- §1 Definitions establish or adopt; ordered birth never refuses them.

test("bare and plain definitions establish a local identity", () => {
    for (const src of ["let V", "let V = (1,2,3)"]) {
        const w = scope(src)
        assert.equal(w.err, null, src)
        assert.ok(w.V, `${src} seats V`)
        assert.ok(w.scheduler.registry.get(w.V.id), `${src} registers it`)
    }
})

test("a position definition establishes a declared-but-unreached name", () => {
    // The corrected witness: the later bare `let V` is declaration ownership, not a use.
    const w = scope("let V.position = origin\nlet V")
    assert.equal(w.err, null, "resolution succeeds")
    assert.ok(w.V, "V is introduced")
    assert.deepEqual(pos(w.V), [0, 0, 0])
    assert.deepEqual(w.laws, ["position"])
})

test("a position definition revises a visible outer subject when this scope declares nothing", () => {
    const w = scope("let V\nas B do\n  let V.position = (1,2,3)\nend")
    assert.equal(w.err, null, "no local namesake is required")
    assert.equal(w.at.children.has("V"), false, "no local V is minted")
    assert.deepEqual(pos(w.hostV), [1, 2, 3], "the visible V was revised")
})

test("a position definition shadows when this scope declares the name", () => {
    const w = scope("let V\nas B do\n  let V\n  let V.position = (1,2,3)\nend")
    assert.equal(w.err, null)
    assert.ok(w.V, "the local V is established")
    assert.deepEqual(pos(w.V), [1, 2, 3])
    assert.deepEqual(pos(w.hostV), [0, 0, 0], "the outer V is untouched")
})


// --- §2 Uses resolve; ordered birth and absence are located refusals.

test("a use on an absent subject is an unknown target", () => {
    for (const src of ["let V.x = 5", "let distance(V, W) = 5"]) {
        const w = scope(src)
        assert.match(w.err ?? "", /Unknown target: V/, src)
        assert.equal(w.V, undefined, src)
    }
})

test("a use on a declared-but-unreached subject is a use-before-introduction", () => {
    const w = scope("let V.x = 5\nlet V")
    assert.match(w.err ?? "", /Use before introduction: V/)
    assert.equal(w.V, undefined)
})

test("a use resolves a local identity once it has been reached", () => {
    const w = scope("let V\nlet V.x = 5")
    assert.equal(w.err, null)
    assert.deepEqual(pos(w.V), [5, 0, 0])
    assert.deepEqual(w.laws, ["coordinate:x"])
})

test("a use revises a visible outer identity when this scope declares nothing", () => {
    const w = scope("let V\nas B do\n  let V.x = 5\nend")
    assert.equal(w.err, null)
    assert.equal(w.at.children.has("V"), false, "no local V is minted")
    assert.deepEqual(pos(w.hostV), [5, 0, 0], "the visible V was constrained")
})

// --- §3 Resolution and geometry are different failures.

test("a resolved definition that then conflicts is a geometry refusal, never a resolution one", () => {
    // The position resolves and installs; the later being act cannot move a pinned V.
    const w = scope("let V.position = (1,2,3)\nlet V")
    assert.ok(w.V, "resolution succeeded and V was established")
    assert.deepEqual(w.laws, ["position"], "the position law installed")
    assert.match(w.err ?? "", /being act/, "the conflict names the being act, not resolution")
})

// --- §4 Source reservation is not establishment: a dotted definition reserves nothing.
// If it did, the earlier coordinate would become use-before-introduction — a language
// change, not bookkeeping. (laws-first-two-pin-birth, laws-decl-frame)

test("a dotted definition does not reserve a local name; both conditions reach the visible V", () => {
    const w = scope("let V\nas B do\n  let V.x = 5\n  let V.position = (5,0,0)\nend")
    assert.equal(w.err, null, "the coordinate is not a use-before-introduction")
    assert.equal(w.at.children.has("V"), false, "B mints no local V")
    assert.deepEqual([...(w.at.declared ?? [])], [], "the declaration index is untouched")
    assert.deepEqual(pos(w.hostV), [5, 0, 0], "both conditions reached the visible V")
    assert.deepEqual(w.laws, ["coordinate:x", "position"])
})

// --- §5 Reserved names resolve before local children. Lookup precedence belongs to
// findFrame; the policy must never rank candidates. (resolveReserved, D061)

test("a reserved name resolves before a local child", () => {
    const w = scope("let world\nlet world.x = 5")
    assert.match(w.err ?? "", /Unknown target: world/, "the local `world` does not capture the coordinate")
    assert.deepEqual(w.laws, [], "no coordinate installs")
})

test("origin is reserved too, never a local child", () => {
    const w = scope("let origin\nlet origin.x = 5")
    assert.match(w.err ?? "", /origin/, "the reserved origin is not the local child")
    assert.deepEqual(w.laws, [], "no coordinate installs")
})
