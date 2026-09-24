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
import { parseProgram } from "../../../assets/js/turtling/parse.js"
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
        const node = first(src)
        assert.ok(isError(node), `${src} should be a located refusal`)
        assert.equal(node.span.line, 1)
        assert.match(node.meta.expected, /distance or pin/)
    }
})

test("acceptance: a declaration is refused inside a loop, conditional or function body", () => {
    const nested = [
        "loop 3 do\n  let A\nend",
        "when 1 do\n  let A\nend",
        "def f do\n  let A\nend",
    ]
    for (const src of nested) {
        const block = first(src)
        const inner = block.children?.[0]
        assert.ok(isError(inner), `${src.split("\n")[0]} should refuse the declaration`)
        assert.equal(inner.span.line, 2, "the diagnostic is located at the declaration")
        assert.match(inner.meta.expected, /cannot live inside/)
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
