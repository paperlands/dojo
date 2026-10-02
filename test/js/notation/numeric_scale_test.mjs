// NUMBERS AT SCALE, AND WHERE THEY STILL GO SILENT — the fixtures the suite was
// missing. Every other numeric witness in the tree sits at scale 1 with clean values,
// which is exactly why a real regression (a relative tolerance in a kernel that can
// only see its result) passed all 2434 of them. (id:tower-center-approximation-ruling)
//
// Two jobs: PIN the scale-invariant behaviours a figure relies on, and CHARACTERIZE the
// one door that is still silent, so fixing it is a deliberate edit here and not a
// surprise elsewhere.
// Run: node --test test/js/notation/numeric_scale_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { drainEvents } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { format } from "../../../assets/js/turtling/numerics.js"
import { unit, directionBetween, len, sub } from "../../../assets/js/turtling/laws/vec3.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })
const run = (src) => drainEvents(parseProgram(src), deps(), { maxCommands: 200 })
const ev = (expr, scope = {}) => new Evaluator().run(new Parser().parse(expr), scope)

describe("a reading is exact at every scale", () => {
    // The reading gate used to be an absolute floor at 1e-10 with 9-decimal snapping —
    // so a figure a million times smaller than the viewport could not see its own ink.
    for (const scale of [1e-9, 1e-3, 1, 1e3, 1e9]) {
        test(`fw ${scale} reads back as the coordinate it walked`, () => {
            const events = run(`fw ${scale}\nlabel x\n`)
            const label = events.find((e) => e.type === "label")
            const moved = events.filter((e) => e.type === "path").at(-1).points.at(-1)[0]
            assert.equal(events.filter((e) => e.type === "notice").length, 0, "no step refused")
            assert.ok(Math.abs(moved - scale) <= Math.abs(scale) * 5e-13)
            assert.equal(Number(label.text), moved, "the reading is the value, not a rounded cousin")
        })
    }

    test("a comparison at a figure's own scale is the comparison it looks like", () => {
        for (const scale of [1e-9, 1, 1e9]) {
            assert.equal(ev(`${scale} * 2 > ${scale}`), 1, `twice ${scale} exceeds it`)
        }
    })
})

describe("geometry at scale — the displacement is the question", () => {
    const at = (x) => [x, 0, 0]
    // A direction is checked as a DIRECTION: subtracting two same-scale points carries
    // its own last-bit error, and demanding bit equality would be a different claim
    // (exact arithmetic) than the one under test (a direction at every scale).
    const aimsAlongX = (dir) => {
        assert.ok(dir, "a direction, not null")
        assert.ok(dir[0] > 0.999, `x-component ${dir[0]}`)
        assert.equal(dir[1], 0)
        assert.equal(dir[2], 0)
    }

    test("two points far apart have a direction, at any scale", () => {
        for (const scale of [1e-9, 1, 1e9]) {
            aimsAlongX(directionBetween(at(scale), at(scale * 2)))
        }
    })

    // The separation IS the question: where the pair stands is no one's policy, so the
    // same figure answers the same in every frame. Translated and rotated copies must
    // agree — a scale sweep about zero was never a test of this. (P1)
    test("a displacement is judged by itself, at every placement", () => {
        // The review's own witness: half a unit apart near the origin, and the same
        // pair translated by [1e12, 1e12, 0] — one answer, one bearing.
        for (const [a, b] of [
            [[0, 0, 0], [0, 0.5, 0]],
            [[1e12, 1e12, 0], [1e12, 1e12 + 0.5, 0]],
        ]) {
            assert.deepEqual(directionBetween(a, b), [0, 1, 0], `from ${a} to ${b}`)
        }
    })

    test("the same offset is the same answer wherever the figure stands", () => {
        // 1e-14 apart at unit scale used to be "the same place" — that verdict was
        // the display's 12-digit budget dressed as geometry. The displacement answers
        // for itself; a frame that cannot express it says so by collapsing the pair.
        for (const place of [0, 1e-9, 1, 1e9, 1e12]) {
            for (const offset of [0.5, 1e-11, 1e-14]) {
                if (place + offset === place) continue
                aimsAlongX(directionBetween(at(place), at(place + offset)))
            }
        }
    })

    test("a rotated copy answers with the rotated direction", () => {
        // A quarter turn of the pair about the origin turns the answer with it.
        assert.deepEqual(directionBetween([1e12, 1e12, 0], [1e12 - 0.5, 1e12, 0]), [-1, 0, 0])
    })

    test("a direction the caller already holds is judged by its own length", () => {
        aimsAlongX(unit(at(1)))
        aimsAlongX(unit(at(4)))
        assert.equal(unit(at(0)), null, "no length, no direction")
        assert.equal(unit([NaN, 0, 0]), null, "a non-number is not a direction")
        assert.equal(unit(at(1e-320)), null, "below the absolute floor a given is too short to have a direction")
    })

    test("a coincident pair is null, so the caller's stated fallback stands", () => {
        assert.equal(directionBetween(at(3), at(3)), null)
        assert.equal(directionBetween(at(0), at(0)), null)
        assert.equal(len(sub(at(3), at(3))), 0, "the length is honestly zero, not a floor")
    })
})

describe("the display gate — what the eye gets, at every magnitude", () => {
    test("about twelve significant digits, and never fed back", () => {
        assert.equal(format(0.1 + 0.2), "0.3", "the residue stays out of the eye")
        assert.equal(format(Math.sin(30 * Math.PI / 180)), "0.5")
        assert.equal(format(1e-15), "1e-15", "a tiny value is shown as itself")
        assert.equal(format(1 + 1e-15), "1", "and a tail below the budget is dropped for the eye only")
        assert.equal(format(1e9 + 1e-8), "1000000000", "the same rule at a large magnitude")
    })

    test("a non-number is NAMED, never printed as a numeral", () => {
        assert.equal(format(1 / 0), "infinity")
        assert.equal(format(0 / 0), "not a number")
    })

    test("and the value keeps its bits", () => {
        assert.notEqual(0.1 + 0.2, 0.3, "the sum is its own number")
        assert.equal(1 + 1e-15, 1.000000000000001, "and the tail is still there to compute with")
    })
})

describe("the one door still silent — CHARACTERIZED, not endorsed", () => {
    // A comparison erases a non-answer before any consumer can see it: IEEE says every
    // comparison with a NaN is false, and the center answers 0 without a word. The
    // condition consumer (below) is told only when the value arrives BARE.
    // Fixing this door changes the lines here — deliberately, with its own witnesses.
    test("a NaN compared is 0, silently", () => {
        assert.equal(ev("0/0 > 0"), 0)
        assert.equal(ev("0/0 < 0"), 0)
        assert.equal(ev("0/0 == 0/0"), 0, "a NaN is not equal to itself, and nothing says so")
    })

    test("infinity orders as a number, which is at least true", () => {
        assert.equal(ev("1/0 > 0"), 1)
        assert.equal(ev("1/0 < 0"), 0)
    })

    test("a BARE non-answer in a condition is told, and takes no branch", () => {
        const events = run("when (0/0) do\n  fw 10\nend\n")
        const told = events.filter((e) => e.type === "notice")
        assert.equal(told.length, 1, "the branch is not taken, and the author hears why")
        assert.equal(told[0].kind, "nan")
        assert.equal(events.filter((e) => e.type === "path").length, 0, "no ink from no answer")
    })
})
