import { test } from "node:test"
import assert from "node:assert/strict"
import { EMPTY, UNCERTAIN, UNRESOLVED, halfplane, plane, meet, nearest } from "../../../assets/js/turtling/laws/meet.js"
import { ACCEPT_TOL } from "../../../assets/js/turtling/laws/relationships.js"

const origin = [0, 0, 0]
const x = [1, 0, 0], y = [0, 1, 0], z = [0, 0, 1]
const pairs = (a, b) => [meet(a, b), meet(b, a)]
const close = (a, b) => assert.ok(Math.hypot(...a.map((v, i) => v - b[i])) < 1e-9,
    `${JSON.stringify(a)} differs from ${JSON.stringify(b)}`)

// A half-plane's boundary and inward direction are separate facts. (id:laws-meet-axioms)
test("half-plane self-meets terminate and same-facing pairs retain the tighter boundary", () => {
    const a = halfplane(origin, z, x)
    assert.deepEqual(meet(a, a), a)
    const duplicate = halfplane([0, 3, 0], [0, 0, -1], x)
    for (const result of pairs(a, duplicate)) {
        assert.equal(result.kind, "halfplane")
        close(nearest(result, [2, 4, 8]).at, [2, 4, 0])
    }
    const tighter = halfplane([2, 7, 0], z, x)
    for (const result of pairs(a, tighter)) assert.equal(result, tighter)
})

test("opposed coplanar half-planes name their shared boundary or a definite gap", () => {
    const a = halfplane(origin, z, x)
    const opposed = halfplane(origin, z, [-1, 0, 0])
    for (const result of pairs(a, opposed)) {
        assert.equal(result.kind, "line")
        close(nearest(result, [5, 3, 9]).at, [0, 3, 0])
    }
    const disjoint = halfplane([-2, 0, 0], z, [-1, 0, 0])
    for (const result of pairs(a, disjoint)) assert.equal(result, EMPTY)
})

test("a strip or wedge remains unresolved rather than becoming a guessed half-plane", () => {
    const a = halfplane(origin, z, x)
    for (const width of [2, 1e-7]) {
        const strip = halfplane([width, 0, 0], z, [-1, 0, 0])
        for (const result of pairs(a, strip)) assert.equal(result, UNRESOLVED)
    }
    for (const direction of [y, [1, 1e-12, 0]]) {
        const wedge = halfplane(origin, z, direction)
        for (const result of pairs(a, wedge)) assert.equal(result, UNRESOLVED)
    }
})

test("crossing supporting planes clip a ray without extending its original reach", () => {
    const a = halfplane(origin, z, x)
    const b = halfplane([2, 0, 0], y, x)
    for (const result of pairs(a, b)) {
        assert.equal(result.kind, "ray")
        close(nearest(result, [-5, 0, 0]).at, [2, 0, 0])
        close(nearest(result, [5, 0, 0]).at, [5, 0, 0])
    }
})

test("opposed ray clips distinguish a segment, a point and emptiness", () => {
    const a = halfplane(origin, z, x)
    for (const end of [2, 1e-7, 0, -2]) {
        const b = halfplane([end, 0, 0], y, [-1, 0, 0])
        for (const result of pairs(a, b)) {
            if (end > 0) assert.equal(result, UNRESOLVED, "a finite segment has no named constructor")
            else if (end < 0) assert.equal(result, EMPTY)
            else {
                assert.equal(result.kind, "point")
                close(result.at, origin)
            }
        }
    }
})

test("half-plane meets respect separated supports and lines wholly on their boundaries", () => {
    const a = halfplane(origin, z, x)
    for (const result of pairs(a, halfplane([0, 0, 2], z, x))) assert.equal(result, EMPTY)
    const b = halfplane(origin, x, z)
    for (const result of pairs(a, b)) {
        assert.equal(result.kind, "line")
        close(nearest(result, [5, 3, 9]).at, [0, 3, 0])
    }
})

test("half-plane self, boundary and ray witnesses survive a translated rotated frame", () => {
    const at = ([a, b, c]) => [c + 10, a - 7, b + 3]
    const dir = ([a, b, c]) => [c, a, b]
    const hp = (p, n, d) => halfplane(at(p), dir(n), dir(d))
    const a = hp(origin, z, x)
    assert.deepEqual(meet(a, a), a)
    for (const result of pairs(a, hp(origin, z, [-1, 0, 0]))) {
        assert.equal(result.kind, "line")
        close(nearest(result, at([5, 3, 9])).at, at([0, 3, 0]))
    }
    for (const result of pairs(a, hp([2, 0, 0], y, x))) {
        assert.equal(result.kind, "ray")
        close(nearest(result, at([-5, 0, 0])).at, at([2, 0, 0]))
    }
})

test("named half-plane pair results satisfy both original halves in either order", () => {
    const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0)
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
    const along = (p, d, t) => p.map((v, i) => v + d[i] * t)
    const offsets = [origin, [-2, 0, 0], [2, 0, 0], [0, 0, 2]]
    const frames = [[z, x], [z, y], [x, y], [x, z], [y, x], [y, z]]
    const halves = offsets.flatMap(p => frames.flatMap(([n, d]) =>
        [halfplane(p, n, d), halfplane(p, n, d.map(v => -v))]))
    let checked = 0
    for (const a of halves) for (const b of halves) {
        const results = pairs(a, b)
        assert.equal(results[0].kind, results[1].kind, "argument order preserves the kind on this grid")
        for (const result of results) {
            let samples = []
            if (result.kind === "point") samples = [result.at]
            if (result.kind === "line" || result.kind === "ray") {
                samples = (result.kind === "line" ? [-4, 0, 4] : [0, 1, 10])
                    .map(t => along(result.point, result.dir, t))
            }
            if (result.kind === "halfplane") {
                samples = [0, 1, 10].flatMap(t => [-4, 0, 4].map(s =>
                    along(along(result.point, result.dir, t), cross(result.normal, result.dir), s)))
            }
            for (const p of samples) for (const hp of [a, b]) {
                const delta = p.map((v, i) => v - hp.point[i])
                assert.ok(Math.abs(dot(delta, hp.normal)) <= ACCEPT_TOL, "on the original supporting plane")
                assert.ok(dot(delta, hp.dir) >= -ACCEPT_TOL, "on the original allowed side")
                checked++
            }
        }
    }
    assert.ok(checked > 1000, "the sweep checks named results, not just refusals")
})

test("supporting-plane coincidence keeps its existing length budget", () => {
    const a = halfplane(origin, z, x)
    for (const result of pairs(a, halfplane([0, 0, ACCEPT_TOL / 10], z, [-1, 0, 0]))) {
        assert.equal(result.kind, "line", "plane coincidence is inherited, not exactified by clipping")
        const p = nearest(result, [5, 3, 9]).at
        assert.ok(Math.abs(p[2]) <= ACCEPT_TOL)
        assert.ok(Math.abs(p[2] - ACCEPT_TOL / 10) <= ACCEPT_TOL)
    }
    for (const result of pairs(a, halfplane([0, 0, 2 * ACCEPT_TOL], z, [-1, 0, 0]))) {
        assert.equal(result, EMPTY)
    }
})

test("a real near-parallel clip is uncertain, not a coincident or empty line", () => {
    const a = halfplane(origin, z, x)
    for (const result of pairs(a, plane([1, 0, 0], [1, -1e-12, 0]))) assert.equal(result, UNCERTAIN)
})

test("a degenerate half-plane direction cannot manufacture a boundary line", () => {
    for (const d of [origin, z]) {
        const a = halfplane(origin, z, d)
        assert.equal(meet(a, a), UNRESOLVED)
    }
})
