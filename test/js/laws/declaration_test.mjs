// Phase 1 — the first declaration.
//
// Existence only: `let A` states that A is here. Distance and pin are refused
// locally with a span rather than silently ignored, and a declaration inside a
// loop, conditional or function body is refused because one batch belongs to one
// supported source body. (id:laws-decl-batch)
//
// From that one parse come two meanings: the batch (what is declared) and the
// executable body (what runs, node identity preserved). Participation is derived
// from the current parse at every seat and rewire — never a stored flag.
// Run: node --test test/js/laws/declaration_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseProgram, collectErrors } from "../../../assets/js/turtling/parse.js"
import { deriveBatch } from "../../../assets/js/turtling/laws/batch.js"
import { buildWorld, fork, drive } from "./harness.mjs"

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

test("acceptance: a distance or pin is refused locally, not silently ignored", () => {
    for (const src of ["let AB = 5", "let A = [0,0]", "let A = origin"]) {
        // The structured diagnostic, not a message field that can drift from it.
        const [wound] = collectErrors(parseProgram(src))
        assert.ok(wound, `${src} should be a located refusal`)
        assert.equal(wound.span.line, 1)
        assert.match(wound.expected, /distance or pin/)
        assert.equal(wound.found, "=")
    }
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

test("acceptance: one parse, two meanings — declarations leave the executable body", () => {
    const body = parseProgram("let A\nfw 1\nlet B\nfw 2")
    const { declared, body: executable } = deriveBatch(body)
    assert.deepEqual([...declared], ['A', 'B'])
    assert.equal(executable.length, 2)
    // Node identity is preserved, so nothing re-parses what it already has.
    assert.equal(executable[0], body[1])
    assert.equal(executable[1], body[3])
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
    assert.equal(a.isPlace, true, "a declared place is a point handle, not an arrowhead")
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
    assert.deepEqual(declared.transform.deref().position.slice(0, 2), [3, 0])
})

// Found while writing the witness above: `findFrame` in its default `near` reach
// searches siblings and ancestors, so a body cannot read its OWN declared child by
// bare name (`goto a.x 0` wounds with "Undefined assistant"). The `as` door
// resolves it because spawn looks in ctx.children. Coordinate reads from the
// declaring body will need that scope question answered — it is not distance work.
test("characterization: a body cannot read its own declared child by bare name", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let a\nas a do\n  goto 3 0\nend\ngoto a.x 0"))
    drive(scheduler)
    assert.equal(host.error?.kind, "walk")
    assert.match(host.error?.message ?? '', /Undefined assistant: a/)
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
