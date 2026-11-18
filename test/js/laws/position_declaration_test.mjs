// The coordinate/vector convention: `(…)` names a POINT, `[…]` a VECTOR — and a
// declaration reads the KIND OF THE VALUE, whatever built it. A point is a PLACE (a
// pin, no ink). A vector is an OBJECT (a straight line from here to the point it
// reaches) and a VALUE (a displacement a name holds) — NOT a place, and the walker
// does not move. So `2*[1,2,3]`, `[u] + [v]` and `(p) - (q)` all agree by what they ARE.
// (id:notation-coordinate-vector)
// Run: node --test test/js/laws/position_declaration_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform, takeSync } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { drainEvents } from "../../../assets/js/turtling/executor.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const nz = (v) => v.map((x) => Math.round(x * 1e6) / 1e6)
const first = (src) => parseProgram(src)[0]
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const ink = (src) => drainEvents(parseProgram(src), deps()).find((e) => e.type === "path")?.points ?? null

test("the delimiter names the kind — and one declaration reads it", () => {
    // ONE declaration node per `let NAME = <expr>`. The delimiter CONSTRUCTS a kind
    // (`(…)` a point, `[…]` a vector); the parser validates the bracketed forms and
    // reads nothing else about them, because what the VALUE is decides what the name
    // is — at the walk. (id:notation-coordinate-vector)
    for (const src of [
        "let A = (1,)", "let A = (1, 2)", "let A = (1, 2, 3)", "let A = origin",
        "let A = [1]", "let A = [1, 2]", "let A = [1, 2, 3]",
        "let s = 5", "let s = 1 + 2",
    ]) {
        assert.equal(first(src).type, "Declaration", src)
    }
})

test("a coordinate pins with no ink; a vector is a LINE object and a value, not ink", () => {
    assert.equal(ink("let A = (10, 20, 30)"), null, "a fixed point draws nothing")
    // A vector is an OBJECT, not deposited ink — and it mints no place.
    assert.equal(ink("let A = [10, 20, 30]"), null, "a vector is not ink")
    const events = drainEvents(parseProgram("let A = [10, 20, 30]"), deps())
    assert.deepEqual(events.find((e) => e.type === "scalar" && e.vector)?.initial, [10, 20, 30],
        "the value holds the displacement the object draws")
    assert.ok(!events.some((e) => e.type === "birth"), "a vector mints no place")
    assert.ok(events.some((e) => e.type === "scalar"), "the name holds the displacement")
})

test("a coordinate names a place; a vector names a value", () => {
    const scheduler = buildWorld({ admit: pass })
    const coord = scheduler.hotSwapChild("coord", fork("coord", "let A = (10, 20, 30)"))
    const vec = scheduler.hotSwapChild("vec", fork("vec", "let A = [10, 20, 30]\nlet W = (0, 0, 0) + A"))
    drive(scheduler)
    assert.ok(coord.children.get("A"), "the coordinate introduces a place")
    assert.equal(vec.children.get("A"), undefined, "a vector introduces no place")
    assert.deepEqual(nz(frameWorldTransform(vec.children.get("W")).position), [10, 20, 30],
        "but the value it holds MOVES a location")
})

test("the algebra is typed: two points do not add; their difference is a vector", () => {
    // A location has no sum and no scale; the displacement between two locations is a
    // VECTOR VALUE; a location moved by a displacement is a location.
    // (id:notation-coordinate-vector)
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let D = (4, 5, 6) - (1, 2, 3)",
        "let W = (0, 0, 0) + D",
        "let P = (1, 1, 1) + [1, 2, 3]",
    ].join("\n")))
    drive(scheduler)
    assert.equal(host.children.get("D"), undefined, "a difference of locations is a vector value")
    assert.deepEqual(nz(frameWorldTransform(host.children.get("W")).position), [3, 3, 3],
        "and it moves a location")
    assert.deepEqual(nz(frameWorldTransform(host.children.get("P")).position), [2, 3, 4],
        "a location moved by a displacement is a location")
    const bad = buildWorld({ admit: pass })
    const wound = bad.hotSwapChild("host", fork("host", "let A = (1, 2, 3) + (4, 5, 6)"))
    drive(bad)
    assert.equal(wound.error?.kind, "walk", "two locations do not add")
})

test("a computed position reaches the framed pipeline", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", "let A.position = (1 + 1, 2, 3)"))
    drive(scheduler)
    const A = host.children.get("A")
    assert.ok(A, "A was introduced")
    assert.deepEqual(nz(frameWorldTransform(A).position), [2, 2, 3])
})

test("a value projects into the engine's space — short embeds, long truncates", () => {
    // 2 → embed, 4 → project (truncate), so a pose exists for any dimension.
    const reach = (src) => drainEvents(parseProgram(src), deps()).find((e) => e.type === "scalar" && e.vector)?.initial
    assert.deepEqual(reach("let A = [10, 20]"), [10, 20, 0], "a 2-vector embeds its missing z")
    assert.deepEqual(reach("let A = [10, 20, 30, 40]"), [10, 20, 30],
        "a 4-vector projects down to the view's three")
    // A pin projects the same way.
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", "let A = (1, 2, 3, 4)"))
    drive(scheduler)
    assert.deepEqual(nz(frameWorldTransform(host.children.get("A")).position), [1, 2, 3])
})

test("a position that cannot land is refused, and no identity is left behind", () => {
    // Not a wrong dimension — a value without three finite components: a nonfinite
    // coordinate, a scalar. The refusal is a WOUND, and the provisional subject is
    // withdrawn. (id:notation-coordinate-vector)
    for (const src of ["let A.position = (0/0, 0, 0)", "let A.position = 5"]) {
        const scheduler = buildWorld({ admit: pass })
        const host = scheduler.hotSwapChild("host", fork("host", src))
        drive(scheduler)
        assert.equal(host.children.get("A"), undefined, `no ghost identity: ${src}`)
        assert.ok(host.error, `the declaring body is told: ${src}`)
    }
})

test("origin and (0, 0, 0) agree as predicates in one declaring frame", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", [
        "let B.position = (10, 20, 30)",
        "as B do",
        "  let Z.position = origin",
        "  let W.position = (0, 0, 0)",
        "end",
    ].join("\n")))
    drive(scheduler)
    const b = host.children.get("B")
    const z = b.children.get("Z")
    const w = b.children.get("W")
    assert.ok(z && w, "both places were born in B")
    assert.deepEqual(nz(frameWorldTransform(z).position), nz(frameWorldTransform(w).position),
        "origin and (0,0,0) land at the same world place")
})

test("a dependent coordinate is a derived value: it tracks; a fixed one does not", () => {
    // A place is fixed only when its coordinates are. A coordinate that reads a live
    // sibling is a derived value, recomputed at each commit. (id:laws-dependency-driven-place)
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let B\nlet C\nlet A = (B.x, 100)\nlet F = (10, 100)"))
    drive(scheduler)
    const A = host.children.get("A")
    const F = host.children.get("F")
    const B = host.children.get("B")
    const C = host.children.get("C")
    assert.deepEqual(nz(frameWorldTransform(A).position), [0, 100, 0], "A starts at B.x = 0")
    assert.deepEqual(nz(frameWorldTransform(F).position), [10, 100, 0], "F is fixed")

    // An unrelated commit recomputes A's coordinate and finds it unchanged: no move.
    assert.equal(scheduler.requestMotion(C, { rotation: C.transform.deref().rotation, position: [5, 0, 0] },
        scheduler.motionRevision).kind, "accept", "the hand moves C")
    drive(scheduler)
    assert.deepEqual(nz(frameWorldTransform(A).position), [0, 100, 0], "C's move does not disturb A")

    // B moves: A tracks its x; the fixed coordinate stands.
    assert.equal(scheduler.requestMotion(B, { rotation: B.transform.deref().rotation, position: [7, 0, 0] },
        scheduler.motionRevision).kind, "accept", "the hand moves B")
    drive(scheduler)
    assert.deepEqual(nz(frameWorldTransform(A).position), [7, 100, 0], "A follows B")
    assert.deepEqual(nz(frameWorldTransform(F).position), [10, 100, 0], "F never moved")
})

test("a live vector is a value that tracks; a fixed one is a constant", () => {
    // A vector names no place. It is a VALUE, and a place built from it follows.
    // (id:notation-coordinate-vector)
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let B\nlet A = [2, B.x, 0]\nlet W = (0, 0, 0) + A"))
    drive(scheduler)
    assert.equal(host.children.get("A"), undefined, "a vector names no place")
    assert.deepEqual(nz(frameWorldTransform(host.children.get("W")).position), [2, 0, 0],
        "W is the vector from here")
    const B = host.children.get("B")
    assert.equal(scheduler.requestMotion(B, { rotation: B.transform.deref().rotation, position: [7, 0, 0] },
        scheduler.motionRevision).kind, "accept", "the hand moves B")
    drive(scheduler)
    assert.deepEqual(nz(frameWorldTransform(host.children.get("W")).position), [2, 7, 0],
        "the vector tracks B, and the place built from it follows")
})

test("the literal and the scaled vector are the same VALUE", () => {
    const read = (src) => {
        const scheduler = buildWorld({ admit: pass })
        scheduler.hotSwapChild("host", fork("host", src))
        drive(scheduler)
        return scheduler.readouts.list().map((n) => scheduler.readouts.value(n.id))
    }
    assert.deepEqual(read("let A = [1, 2, 3]"), [[1, 2, 3]], "the literal binds the vector")
    assert.deepEqual(read("let A = 2 * [1, 2, 3]"), [[2, 4, 6]], "the product binds the same")
})

test("a live vector's LINE follows its value", () => {
    // The value tracks; the object is re-emitted under the SAME key, so the materializer
    // REPLACES the line — the drawn vector is what it is NOW. It rides the current-state
    // slot, not the ink channel. (id:notation-coordinate-vector)
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", "let B\nlet A = [80, B.x, 0]"))
    const seen = []
    const collect = () => {
        for (const e of takeSync(host) ?? []) if (e.type === "vector") seen.push(e.to)
    }
    drive(scheduler); collect()
    assert.deepEqual(seen.at(-1), [80, 0, 0], "the line starts where the vector does")
    const B = host.children.get("B")
    assert.equal(scheduler.requestMotion(B, { rotation: B.transform.deref().rotation, position: [7, 0, 0] },
        scheduler.motionRevision).kind, "accept", "the hand moves B")
    drive(scheduler); collect()
    assert.deepEqual(seen.at(-1), [80, 7, 0], "and it FOLLOWS the displacement")
})
