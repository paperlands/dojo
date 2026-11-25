// D018 magnitude order: the longer arrow wins, and a length tie is not identity.
// Run: node --test test/js/notation/vector_magnitude_test.mjs
//
// Answers go through the default tower the Parser/Evaluator already seals.
// The oracle is binary-text fractions, not the production bit-field formula.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { DomainRefusal, TowerRefusal } from "../../../assets/js/turtling/mafs/tower.js"
import { parseProgram, collectErrors } from "../../../assets/js/turtling/parse.js"
import { drainEvents } from "../../../assets/js/turtling/executor.js"

const ev = (s) => new Evaluator().run(new Parser().parse(s), {})
const apply = (op, a, b) => new Evaluator().tower.apply(op, a, b)
const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const domain = (fn) => assert.throws(fn, (e) => e instanceof DomainRefusal)
const missing = (fn) => assert.throws(fn, (e) => e instanceof TowerRefusal)

// Independent of the production shift: the represented value's own binary text.
function fraction(x) {
    const [whole, tail = ""] = Math.abs(x).toString(2).split(".")
    return { n: BigInt(`0b${whole}${tail}`), k: tail.length }
}
function oracle(a, b) {
    const fa = a.map(fraction), fb = b.map(fraction)
    const k = 2 * Math.max(0, ...[...fa, ...fb].map((v) => v.k))
    const sum = (fs) => fs.reduce((s, f) => s + (f.n * f.n << BigInt(k - 2 * f.k)), 0n)
    const d = sum(fa) - sum(fb)
    return d > 0n ? 1 : d < 0n ? -1 : 0
}
const signOf = (op, s) => op === "<" ? s < 0 : op === "<=" ? s <= 0 : op === ">" ? s > 0 : s >= 0
const OPS = ["<", "<=", ">", ">="]

describe("magnitude order through the language", () => {
    test("the four orderings agree with exact squares, and a tie is not identity", () => {
        assert.equal(ev("[1,2] < [1,3]"), 1)
        assert.equal(ev("[1,2] > [1,3]"), 0)
        assert.equal(ev("[3,0] <= [0,3]"), 1)
        assert.equal(ev("[0,3] <= [3,0]"), 1)
        assert.equal(ev("[3,0] < [0,3]"), 0)
        assert.equal(ev("[3,4] >= [0,5]"), 1)
        assert.equal(ev("[3,4] > [0,5]"), 0)
        assert.equal(ev("[-3,-4] <= [4,3]"), 1)
        assert.equal(ev("[3,0] == [0,3]"), 0)
        assert.equal(ev("[1,2] == [1,2]"), 1)
        assert.equal(ev("[1,2] != [1,2]"), 0)
        assert.equal(ev("[1,2] !== [1,2]"), 0)
    })

    test("a norm collision is still a longer arrow", () => {
        assert.equal(Math.hypot(1e16, 1), Math.hypot(1e16, 0))
        assert.equal(ev("[1e16,1] > [1e16,0]"), 1)
        assert.equal(ev("[1e16,0] < [1e16,1]"), 1)
        assert.equal(ev("[1e16,1] <= [1e16,0]"), 0)
    })
    test("a taken magnitude branch walks, and says nothing", () => {
        const source = "when ([1e16,1] > [1e16,0]) do\n fw 2\nend\n"
        const ast = parseProgram(source)
        assert.equal(collectErrors(ast).length, 0)
        const events = drainEvents(ast, deps())
        assert.equal(events.filter((e) => e.type === "notice").length, 0)
        assert.deepEqual(events.filter((e) => e.type === "head").at(-1).position, [2, 0, 0])
    })


    test("overflowing hypot still orders, and a subnormal is longer than zero", () => {
        assert.equal(ev("[1e308,1e308] < [1.5e308,1.5e308]"), 1)
        assert.equal(ev("[1.5e308,1.5e308] > [1e308,1e308]"), 1)
        assert.equal(apply(">", [Number.MIN_VALUE, 0], [0, 0]), 1)
        assert.equal(apply("<", [0, 0], [Number.MIN_VALUE, 0]), 1)
        assert.equal(apply("<=", [-0, 0], [0, -0]), 1)
        assert.equal(apply("<", [-0, 0], [0, -0]), 0)
    })

    test("points, mixed kinds and scalars are untouched", () => {
        missing(() => ev("(1,2) < (0,3)"))
        missing(() => ev("[1,2] < (1,2)"))
        missing(() => ev("(1,2) >= [1,2]"))
        assert.equal(ev("1 < 2"), 1)
        assert.equal(ev("'a' < 'b'"), 1)
    })
})

describe("the domain is finite equal-length primitive numbers", () => {
    test("shape, coefficient and non-finite refuse before any coercion", () => {
        domain(() => apply("<", [], [0]))
        domain(() => apply("<", [1, 2], [1]))
        domain(() => ev("[[1],2] < [1,2]"))
        domain(() => apply("<", [1,, 2], [0, 0, 0]))
        domain(() => ev("['3',0] < [0,0]"))
        domain(() => apply("<", [null, 0], [0, 0]))
        domain(() => apply("<", [true, 0], [0, 0]))
        domain(() => ev("[0/0,0] < [0,0]"))
        domain(() => ev("[1/0,0] > [0,0]"))
        let calls = 0
        domain(() => apply("<", [{ valueOf() { calls++; return 3 } }, 0], [0, 0]))
        assert.equal(calls, 0, "validation does not coerce")
    })

    test("a later mutation is read again — nothing is cached on the array", () => {
        const a = [1, 0], b = [0, 1]
        assert.equal(apply("<", a, b), 0)
        a[0] = 3
        assert.equal(apply(">", a, b), 1)
        a[1] = "0"
        domain(() => apply(">", a, b))
    })
    test("a component is captured once, and a length mismatch reads none", () => {
        let reads = 0
        const a = [0, 0]
        Object.defineProperty(a, 0, { get() { reads++; return 4 } })
        assert.equal(apply(">", a, [1, 0]), 1)
        assert.equal(reads, 1, "the snapshot is the only read")
        const mismatched = []
        Object.defineProperty(mismatched, 0, { get() { reads++; return 1 } })
        mismatched.length = 1
        domain(() => apply("<", mismatched, [0, 0]))
        assert.equal(reads, 1, "unequal length does not read a component")
    })
})

describe("exact fallback at the exponent fences", () => {
    test("a scaled 3-4-5 tie is mixed, so dominance cannot decide", () => {
        for (const scale of [2 ** -1024, 2 ** 1021]) {
            const left = [3 * scale, 4 * scale], right = [0, 5 * scale]
            assert.ok(Math.abs(left[0]) < Math.abs(right[1]) && Math.abs(left[1]) > Math.abs(right[0]),
                "the pair is mixed; componentwise dominance cannot decide")
            assert.equal(oracle(left, right), 0)
            for (const op of OPS) assert.equal(apply(op, left, right), signOf(op, 0) ? 1 : 0, `${op} ${scale}`)
            assert.equal(apply("<=", right, left), 1)
            assert.equal(apply("<", right, left), 0)
        }
    })
})

describe("an independent oracle, not the production decoder", () => {
    const named = [
        [[1e16, 1], [1e16, 0]],
        [[1e308, 0], [0, 1e308]],
        [[Number.MIN_VALUE, 0], [0, 0]],
        [[3, 4], [0, 5]],
        [[3 * Number.MIN_VALUE, 4 * Number.MIN_VALUE], [0, 5 * Number.MIN_VALUE]],
        [[Number.MAX_VALUE, Number.MIN_VALUE], [Number.MAX_VALUE, 0]],
        [[-3, -4], [4, 3]],
        [[-0, 0], [0, -0]],
        [[1e16, 1], [1e16 - 2, 2]],
        [[1e308, 1e308], [1.5e308, 1.5e308]],
        [[1, 2, 2], [3, 0, 0]],
        [[1e16, 0, 1], [0, 1e16, 0]],
    ]
    test("named fences match the binary-text oracle on every ordering", () => {
        for (const [a, b] of named) {
            const sign = oracle(a, b)
            for (const op of OPS) assert.equal(apply(op, a, b), signOf(op, sign) ? 1 : 0, `${op} ${a} ${b}`)
            assert.equal(oracle(b, a), sign === 0 ? 0 : -sign)
        }
    })

    test("seeded finite pairs in several dimensions match the oracle", () => {
        let state = 0x71e12b5d
        const random32 = () => {
            state ^= state << 13; state ^= state >>> 17; state ^= state << 5
            return state >>> 0
        }
        const view = new DataView(new ArrayBuffer(8))
        const randomFinite = () => {
            for (;;) {
                view.setUint32(0, random32())
                view.setUint32(4, random32())
                const x = view.getFloat64(0)
                if (Number.isFinite(x)) return x
            }
        }
        for (const dimension of [1, 2, 3, 8]) {
            for (let i = 0; i < 40; i++) {
                const a = Array.from({ length: dimension }, randomFinite)
                const b = Array.from({ length: dimension }, randomFinite)
                const sign = oracle(a, b)
                for (const op of OPS) {
                    assert.equal(apply(op, a, b), signOf(op, sign) ? 1 : 0, `${dimension}/${i} ${op}`)
                }
                assert.equal(apply(">", b, a), signOf(">", -sign) ? 1 : 0)
            }
        }
    })
})
