// Phase 1 — the first declaration.
//
// Existence only: `let A` states that A is here. Distance and pin are refused
// locally with a span rather than silently ignored, and a declaration inside a
// loop, conditional or function body is refused because one batch belongs to one
// supported source body. (id:laws-decl-batch)
//
// From that one parse come two meanings: the batch (what is declared) and the
// executable stream (what runs, reached declarations included, node identity
// preserved). Participation is derived from the current parse at every seat and
// rewire — never a stored flag; a reached `let` is the birth site.
// Run: node --test test/js/laws/declaration_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseProgram, collectErrors } from "../../../assets/js/turtling/parse.js"
import { deriveBatch, exposed, freePoint } from "../../../assets/js/turtling/laws/batch.js"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const first = (src) => parseProgram(src)[0]
const isError = (node) => node.type === 'Error'

test("acceptance: `let A` states existence and carries its span", () => {
    const node = first("let A")
    assert.equal(node.type, 'Existence')
    assert.equal(node.value, 'A')
    assert.equal(node.span.line, 1)
    // It is not an action: nothing about it executes.
    assert.deepEqual(node.children, [])
})

test("acceptance: unsupported declaration forms are refused locally", () => {
    for (const src of ["let A = [0,0]", "let A = B"]) {
        // The structured diagnostic, not a message field that can drift from it.
        const [wound] = collectErrors(parseProgram(src))
        assert.ok(wound, `${src} should be a located refusal`)
        assert.equal(wound.span.line, 1)
        assert.match(wound.expected, /property|relation|position/)
    }
})

test("acceptance: a position pin parses (`origin` and a coordinate literal)", () => {
    const o = first("let A = origin")
    assert.equal(o.type, "Law")
    assert.equal(o.value, "position")
    assert.deepEqual(o.meta.coords, [0, 0, 0])
    const l = first("let A = [1, 2, 3]")
    assert.equal(l.type, "Law")
    assert.equal(l.value, "position")
    assert.deepEqual(l.meta.coords, [1, 2, 3])
})

test("acceptance: `let A.distance = 5` is a dotted relation with its span", () => {
    const node = first("let A.distance = 5")
    assert.equal(node.type, "Law")
    assert.equal(node.value, "distance")
    assert.equal(node.meta.target, "A")
    assert.equal(node.meta.expr, "5")
    assert.equal(node.span.line, 1)
})

test("acceptance: a declaration is refused inside a loop, conditional or function body", () => {
    const nested = [
        "loop 3 do\n  let A\nend",
        "when 1 do\n  let A\nend",
        "def f do\n  let A\nend",
    ]
    for (const src of nested) {
        const [wound] = collectErrors(parseProgram(src))
        assert.ok(wound, `${src.split("\n")[0]} should refuse the declaration`)
        assert.equal(wound.span.line, 2, "the diagnostic is located at the declaration")
        assert.match(wound.expected, /cannot live inside/)
    }
    // An `as` body is a supported source body, so its declaration belongs there.
    const ambient = first("as child do\n  let A\nend")
    assert.equal(ambient.type, 'Ambient')
    assert.equal(ambient.children[0].type, 'Existence')
})

test("acceptance: one parse, two meanings — declarations stay in the executable stream", () => {
    const body = parseProgram("let A\nfw 1\nlet B\nfw 2")
    const { declared, body: executable } = deriveBatch(body)
    assert.deepEqual([...declared], ['A', 'B'])
    // Every statement stays in order: a reached `let` is the birth site, never
    // hoisted. Node identity is preserved, so nothing re-parses what it has.
    assert.equal(executable.length, 4)
    assert.equal(executable[0], body[0])
    assert.equal(executable[1], body[1])
    assert.equal(executable[2], body[2])
    assert.equal(executable[3], body[3])
})

test("acceptance: a seated body declares its places and runs its actions", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nas A do\n  fw 1\nend"))
    drive(scheduler)
    assert.equal(host.error, null, "the declaration never reaches the executor")
    assert.deepEqual([...host.declared], ['A'], "the batch names what the body declares")
    const a = find(host, "A")
    assert.ok(a, "the action still seats its ambient")
    assert.deepEqual(a.transform.deref().position.slice(0, 2), [1, 0])
    assert.equal(host.unresolved, null, "its declaration was fulfilled by the action")
})

test("acceptance: `let A` establishes an accepted place before any action runs", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "let A\nfw 1"))
    const a = find(host, "A")
    // The positive evidence: a place, established at seat, with default geometry
    // in the declared domain — no tick, no output, no clock of its own.
    assert.ok(a, "the declaration established a place")
    assert.equal(a.done, true)
    assert.equal(a.isPlace, true, "an empty place has a point handle before it has a walking head")
    assert.equal(freePoint(a), true, "a place without a walking body can be touched")
    assert.deepEqual(a.transform.deref().position, [0, 0, 0])
    const q = a.transform.deref().rotation
    assert.deepEqual([q.x, q.y, q.z, q.w], [0, 0, 0, 1])
    assert.equal(a.channel.length, 0, "a place emits nothing")
    assert.equal(Object.keys(a.sync).length, 0, "and has nothing awaiting display")

    drive(scheduler)
    assert.equal(host.unresolved, null, "its existence was realized, so there is nothing to report")
    assert.equal(host.error, null)
})

test("acceptance: A resolves to the declared identity before any `as`", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "let a\nas a do\n  goto 3 0\nend"))
    const declared = find(host, "a")
    // Resolvable at seat, before any action: the identity is the place, and it is
    // registered, so every resolver finds the same frame.
    assert.ok(declared, "the declared identity resolves before the first as")
    assert.equal(scheduler.registry.get(declared.id), declared)
    drive(scheduler)
    assert.equal(find(host, "a"), declared, "the later `as a` adopted it, never minted a second")
    assert.equal(freePoint(declared), false, "as gave that same point a walking head")
    assert.deepEqual(declared.transform.deref().position.slice(0, 2), [3, 0])
})


test("a free A may be touched before as; the head joins its accepted pose", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let a\nwait 1\nas a do\n  fw 1\nend"))
    const a = host.children.get("a")
    assert.equal(freePoint(a), true)
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(a, { rotation: a.transform.deref().rotation,
        position: [3, 0, 0] }, revision).kind, "accept")
    assert.deepEqual(a.transform.deref().position, [3, 0, 0])
    drive(scheduler)
    assert.equal(host.children.get("a"), a)
    assert.equal(freePoint(a), false, "the head has claimed this point")
    assert.deepEqual(a.transform.deref().position.map(n => +n.toFixed(6)), [4, 0, 0],
        "fw starts at the position the free point accepted")
})
// Own children are the nearest kin, so a body reads its own declared child by
// bare name: the coordinate read and the `as` door share one scope.
// (id:laws-decl-point-agent)
test("acceptance: a body reads its own declared child by bare name", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let a\nas a do\n  goto 3 0\nend\ngoto a.x 0"))
    drive(scheduler)
    assert.equal(host.error, null)
    assert.deepEqual(host.transform.deref().position.map((n) => +n.toFixed(6)), [3, 0, 0],
        "a.x is the declared a's accepted x, read from a's own body")
})

test("acceptance: participation is current source participation, not a stored flag", () => {
    const withDeclaration = deriveBatch(parseProgram("let A\nas A do\n  fw 1\nend"))
    const without = deriveBatch(parseProgram("as A do\n  fw 1\nend"))
    assert.deepEqual([...withDeclaration.declared], ['A'])
    assert.deepEqual([...without.declared], [], "removing the declaration removes participation")

    // And the runtime derives it the same way on every seat.
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "as A do\n  fw 1\nend"))
    drive(scheduler)
    assert.deepEqual([...host.declared], [])
    assert.ok(find(host, "A"), "an undeclared action still runs — participation is not required to act")
})

test("acceptance: exposure follows the current batch, never the frame's history", () => {
    const pass = ({ requested }) => ({ accepted: true, transform: requested })

    // Declared, then the scope is rewired without the declaration. The frame
    // survives — frame identity is not eligibility.
    const dropped = buildWorld({ admit: pass })
    const dHost = dropped.hotSwapChild("host", fork("host", [
        "as s do", "  let a", "end",
        "wait 1",
        "as s do", "end",
    ].join("\n")))
    drive(dropped)
    const dS = find(dHost, "s")
    const dA = find(dS, "a")
    assert.ok(dS.declared instanceof Set)
    assert.deepEqual([...dS.declared], [], "the declaration is gone")
    assert.equal(exposed(dA), false, "so it is not exposed for manipulation")
    assert.equal(dA.isPlace, true, "though it was, historically, seated as a place")

    // Ordinary ambient, then the scope is rewired WITH the declaration. It was
    // never an empty place, and it is eligible now.
    const gained = buildWorld({ admit: pass })
    const gHost = gained.hotSwapChild("host", fork("host", [
        "as s do", "  as a do", "    fw 1", "  end", "end",
        "wait 1",
        "as s do", "  let a", "end",
    ].join("\n")))
    drive(gained)
    const gA = find(find(gHost, "s"), "a")
    assert.equal(gA.isPlace, undefined, "it was seated as an ordinary ambient")
    assert.equal(exposed(gA), true, "but the current batch exposes it")
    assert.deepEqual(gA.transform.deref().position.slice(0, 2), [0, 0],
        "the being act reseated it to the current head state")
})

// Ordered birth — Phase 1a. A declaration is reached in the stream; the birth
// effect carries the executor's post-command pose. (id:laws-ordered-birth)

test("acceptance: ordered birth — A begins where the walk reached it", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "fw 100\nlet A\nfw 100\nlet B"))
    drive(scheduler)
    const a = find(host, "A")
    const b = find(host, "B")
    assert.equal(host.error, null, "reaching a declaration is not an error")
    assert.deepEqual(a.transform.deref().position.map((n) => +n.toFixed(6)), [100, 0, 0],
        "A begins at the walk's reached pose, not the frame origin")
    assert.deepEqual(b.transform.deref().position.map((n) => +n.toFixed(6)), [200, 0, 0],
        "B begins at its own reached pose")
    assert.equal(a.isPlace, true)
    assert.equal(freePoint(a), true, "a reached declaration is a free point")
})

test("acceptance: ordered birth — a not-yet-reached declaration has no point", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "fw 100\nwait 1\nlet A\nfw 100"))
    // Paused at the wait: the walk passed 100 and has not reached `let A` yet.
    assert.equal(host.children.has("A"), false, "A is absent before its site")
    drive(scheduler)
    const a = find(host, "A")
    assert.ok(a, "A is born when the walk reaches its declaration")
    assert.deepEqual(a.transform.deref().position.map((n) => +n.toFixed(6)), [100, 0, 0],
        "born at the pose the walk held at the declaration")
})

test("acceptance: ordered birth — the next statement reads the born point", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "fw 100\nlet A\ngoto A.x 5"))
    drive(scheduler)
    assert.equal(host.error, null, "A is acknowledged before the next read")
    assert.deepEqual(host.transform.deref().position.map((n) => +n.toFixed(6)), [100, 5, 0],
        "A.x is the born point's accepted x")
})

test("acceptance: ordered birth — a re-reached let revises to the current head state", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "fw 50\nlet a\nwait 1\nfw 50\nlet a"))
    const a = host.children.get("a")
    assert.equal(freePoint(a), true)
    assert.deepEqual(a.transform.deref().position.map((n) => +n.toFixed(6)), [50, 0, 0],
        "a began at the walk's reached pose")
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(a, { rotation: a.transform.deref().rotation,
        position: [3, 0, 0] }, revision).kind, "accept")
    drive(scheduler)
    assert.equal(host.children.get("a"), a, "the same identity throughout")
    assert.deepEqual(a.transform.deref().position.map((n) => +n.toFixed(6)), [100, 0, 0],
        "the re-reached let adopts the current head's state")
})

// Phase 1b — naming and time. (id:laws-ordered-birth)

test("acceptance: a read before the local let is a located use-before-introduction", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "fw A.x\nlet A"))
    drive(scheduler)
    assert.equal(host.error?.kind, "walk")
    assert.match(host.error?.message ?? "", /Use before introduction: A/)
    assert.equal(host.error?.span?.line, 1, "located at the forward use")
    assert.deepEqual(host.transform.deref().position, [0, 0, 0], "a refused read moves nothing")
})

test("acceptance: a later local let does not read an outer namesake", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    scheduler.hotSwapChild("A", fork("A", "goto 5 0"))
    const host = scheduler.hotSwapChild("host", fork("host", "fw A.x\nlet A"))
    drive(scheduler)
    assert.match(host.error?.message ?? "", /Use before introduction: A/,
        "the sibling A is not a fallback")
    assert.deepEqual(host.transform.deref().position, [0, 0, 0])
})

test("acceptance: ordered birth — a turn before the site locates the point", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "rt 90\nfw 100\nlet A"))
    drive(scheduler)
    const a = find(host, "A")
    assert.deepEqual(frameWorldTransform(a).position.map((n) => +n.toFixed(6)), [0, -100, 0],
        "A is at the walk's reached world pose, after the turn (rt 90 → fw along −y)")
})

test("acceptance: ordered birth — a nested frame births at its own cursor", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "goto 10 0\nas s do\n  fw 5\n  let A\nend"))
    drive(scheduler)
    const s = find(host, "s")
    const a = find(s, "A")
    assert.deepEqual(frameWorldTransform(a).position.map((n) => +n.toFixed(6)), [15, 0, 0],
        "A composes the nested frame's reached pose")
    assert.deepEqual(frameWorldTransform(a).position, frameWorldTransform(s).position,
        "A begins exactly at its parent's cursor")
})

test("acceptance: a child's read of a parent's later let waits, then reads it", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "as s do\n  fw A.x\nend\nfw 7\nlet A"))
    drive(scheduler)
    assert.equal(host.error, null)
    const a = find(host, "A")
    const s = find(host, "s")
    assert.deepEqual(a.transform.deref().position.map((n) => +n.toFixed(6)), [7, 0, 0],
        "the parent introduced A at its reached pose")
    assert.deepEqual(s.transform.deref().position.map((n) => +n.toFixed(6)), [7, 0, 0],
        "the child's fw A.x waited (D011), then read 7")
})

test("acceptance: ordered birth is invariant under breath and channel budget", () => {
    const admit = ({ requested }) => ({ accepted: true, transform: requested })
    const run = (breathEvery, capacity) => {
        const scheduler = buildWorld({ admit, breathEvery, capacity })
        const host = scheduler.hotSwapChild("host", fork("host", "fw 100\nlet A\nfw 100\nlet B"))
        drive(scheduler)
        return {
            a: find(host, "A").transform.deref().position.map((n) => +n.toFixed(6)),
            b: find(host, "B").transform.deref().position.map((n) => +n.toFixed(6)),
        }
    }
    const base = run(1, 64)
    assert.deepEqual(base, { a: [100, 0, 0], b: [200, 0, 0] })
    for (const [breath, cap] of [[1, 1], [1, 2], [8, 64], [512, 64]]) {
        assert.deepEqual(run(breath, cap), base, `budget (${breath},${cap}) changed births`)
    }
})
