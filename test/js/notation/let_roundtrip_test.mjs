// Cut 1 — the surface is an instrument again. A `let` must survive parse → print →
// parse with its binding structure intact, inside bodies and nesting, and the two
// programs must RUN the same. Printer idempotence alone is vacuous: the pre-fix bug
// already satisfied `print(parse(src)) === print(parse(""))`. (D058, laws-ordered-birth)
//
// Run: node --test test/js/notation/let_roundtrip_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseProgram, printAST } from "../../../assets/js/turtling/parse.js"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { buildWorld, fork, drive } from "../laws/harness.mjs"

const BINDING = new Set(["Existence", "Declaration", "Law"])

// The binding structure a printer must conserve: which form, which target, which
// operator, which expression — and where it nests. Formatting is free.
function bindings(nodes, depth = 0, out = []) {
    for (const node of nodes) {
        if (BINDING.has(node.type)) {
            out.push({
                type: node.type, depth, value: node.value,
                expr: node.meta?.expr ?? null,
                target: node.meta?.target ?? null,
                axis: node.meta?.axis ?? null,
                subjects: node.meta?.subjects ?? null,
            })
        }
        bindings(node.children ?? [], depth + 1, out)
    }
    return out
}

const roundTrip = (src) => printAST(parseProgram(src))

// 1. Structural round-trip, modulo intentional formatting.
const FORMS = [
    "let A",
    "let A = 5",
    "let A = (1,2,3)",
    "let A = origin",
    "let A = [1,0,0]",
    "let A.position = (1,2,3)",
    "let A.x = 5",
    "let A.tilt = 45",
    "let A.bearing = 30",
    "let distance(A, B) = 5",
    "let distance(A, origin) = 5",
    "let distance(A, (1,2)) = 5",
    "let distance(A, [1,2,0]) = 5",
    'let "J[count]"',
]

test("every let form survives parse → print → parse structurally", () => {
    for (const src of FORMS) {
        const before = bindings(parseProgram(src))
        const after = bindings(parseProgram(roundTrip(src)))
        assert.ok(before.length > 0, `the form parses: ${src}`)
        assert.deepEqual(after, before, `structure conserved: ${src} → ${roundTrip(src)}`)
    }
})

// 2. Inside a body, with comments and nesting.
const NESTED = [
    "def f x do",
    "  let A # the anchor",
    "  as B do",
    "    let C",
    "    let C.y = 2",
    "  end",
    "  fw A.x",
    "end",
].join("\n")

test("a let survives inside a def body, with comments and nesting", () => {
    const printed = roundTrip(NESTED)
    assert.deepEqual(bindings(parseProgram(printed)), bindings(parseProgram(NESTED)), "structure conserved")
    assert.equal((printed.match(/^ *let /gm) ?? []).length, 3, "all three lets printed")
    assert.match(printed, /let A # the anchor/, "the comment rides its statement")
    assert.match(printed, /\n    let C\n/, "nesting is kept")
    assert.equal(roundTrip(printed), printed, "and printing is stable")
})

// 3. Execution equivalence: the printed program RUNS the same witnesses.
const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}

function observe(src) {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", src))
    drive(scheduler, { maxTicks: 12 })
    const A = host.children.get("A")
    const B = find(host, "B")
    return {
        err: host.error?.message ?? null,
        A: A ? frameWorldTransform(A).position.map((n) => +n.toFixed(4)) : null,
        B_A: B?.children.get("A") ? frameWorldTransform(B.children.get("A")).position.map((n) => +n.toFixed(4)) : null,
        host_A: A ? frameWorldTransform(A).position.map((n) => +n.toFixed(4)) : null,
        laws: scheduler.laws.active().map((l) => l.feature + (l.axis ? ":" + l.axis : "")).sort(),
    }
}

const WITNESSES = {
    "bare birth + coordinate commits": "let A\nlet A.x = 5",
    "pin + coordinate contradicts": "let A = (0,0,0)\nlet A.x = 5",
    "plain declaration shadows": "let A\nas B do\n  let A = (1,2,3)\nend",
    "dotted position revises": "let A\nas B do\n  let A.position = (1,2,3)\nend",
}

test("the original and the printed program execute the same witnesses", () => {
    for (const [label, src] of Object.entries(WITNESSES)) {
        const printed = roundTrip(src)
        assert.deepEqual(observe(printed), observe(src), `${label}: ${JSON.stringify(printed)}`)
    }
})
