// One quoted-name read, across command, definition, value and figure routes.
import { test } from "node:test"
import assert from "node:assert/strict"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseMemo } from "../../../assets/js/turtling/mafs/parse_memo.js"
import { drainEvents } from "../../../assets/js/turtling/executor.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { headingOf } from "../../../assets/js/turtling/laws/relations.js"
import { buildWorld, fork, drive, deps } from "../laws/harness.mjs"

function setup(src) {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", src))
    settle(scheduler)
    return { scheduler, host }
}
function settle(scheduler) {
    for (let i = 0; i < 4; i++) {
        drive(scheduler, { maxTicks: 40 })
        scheduler.readouts.drain()
    }
}
function question(scheduler) {
    return scheduler.readouts.list().find(n => n.keyed)?.question
}
function drag(scheduler, frame, position) {
    const outcome = scheduler.requestMotion(frame, { rotation: frame.transform.deref().rotation, position }, scheduler.motionRevision)
    assert.equal(outcome.kind, 'accept')
    settle(scheduler)
}
const target = "let mice\nas mice do\n rt 90\n fw 10\nend\n"

for (const quote of ["'", '"']) {
    test(`${quote}quoted access is one operand inside arithmetic, groups, vectors and calls`, () => {
        const parser = new Parser()
        const evaluator = new Evaluator()
        evaluator.parser = parser
        evaluator.resolveExternal = (name, args) => {
            assert.equal(name, "mice.x")
            return args ? args[0] + 7 : 7
        }
        const name = `${quote}mice${quote}.x`
        const ev = src => evaluator.run(parser.parse(src), {})
        assert.equal(ev(name), 7)
        assert.equal(ev(`(${name})+2`), 9)
        assert.equal(ev(`1+${name}*2`), 15)
        assert.deepEqual(ev(`[${name},2]`), [7, 2])
        assert.equal(ev(`sin(${name})`), Math.sin(7 * Math.PI / 180))
        assert.equal(ev(`${name}(3)`), 10)
        for (const bad of [`${quote}mice${quote}.`, `${quote}mice${quote}.1`, `${quote}mice${quote}..x`, `${name}$`]) {
            assert.throws(() => parser.parse(bad), undefined, bad)
        }
    })

    test(`${quote}quoted figure inputs agree with bodies and keep following a moved target`, () => {
        const x = `${quote}mice${quote}.x`, y = `${quote}mice${quote}.y`
        const { scheduler, host } = setup(target + `as body do\n faceto ${x} ${y}\nend\nlet ho = faceto ${x} ${y}`)
        const ho = host.children.get("ho")
        assert.equal(headingOf(ho.transform.deref().rotation), headingOf(host.children.get("body").transform.deref().rotation))
        assert.equal(headingOf(ho.transform.deref().rotation), 180)
        assert.ok(Math.abs(question(scheduler)[0]) < 1e-12)
        assert.equal(question(scheduler)[1], -10)
        drag(scheduler, host.children.get("mice"), [10, 10, 0])
        assert.deepEqual(question(scheduler), [10, 10])
        assert.equal(headingOf(ho.transform.deref().rotation), 45)
        assert.deepEqual(scheduler.errors, [])
    })

    test(`${quote}quoted value declaration and fn body have the same read`, () => {
        const { scheduler, host } = setup(target + `let value = ${quote}mice${quote}.y\nfn read[n] ${quote}mice${quote}.y+n\nlet ho = fw read(20)`)
        assert.equal(host.children.get("ho").transform.deref().position[0], 10)
        assert.deepEqual(scheduler.errors, [])
    })
}

test("one faceto input retains the omitted y default", () => {
    const { scheduler, host } = setup("as mice do\n fw 10\nend\nlet ho = faceto \"mice\".x")
    assert.deepEqual(question(scheduler), [10])
    assert.equal(headingOf(host.children.get("ho").transform.deref().rotation), 90)
    assert.deepEqual(scheduler.errors, [])
})

test("interpolation uses declaring parameters on initial capture and rebuild", () => {
    const { scheduler, host } = setup("let mice1\nas mice1 do\n fw 10\nend\ndef wrap n do\n let ho = fw 'mice[n]'.x\nend\nwrap 1")
    const ho = host.children.get("ho")
    assert.deepEqual(question(scheduler), [10])
    assert.equal(ho.transform.deref().position[0], 10)
    drag(scheduler, host.children.get("mice1"), [25, 0, 0])
    assert.deepEqual(question(scheduler), [25])
    assert.equal(ho.transform.deref().position[0], 25)
    assert.deepEqual(scheduler.errors, [])
})

test("interpolated names are data, not injected expression source", () => {
    const { scheduler, host } = setup("as 'a+b' do\n fw 12\nend\nlet ho = fw 'a+b'.x")
    assert.deepEqual(question(scheduler), [12])
    assert.equal(host.children.get("ho").transform.deref().position[0], 12)
    assert.deepEqual(scheduler.errors, [])
})

test("source strings interpolate inside expressions, while held literal strings stay held", () => {
    const parser = new Parser()
    const evaluator = new Evaluator()
    evaluator.parser = parser
    assert.deepEqual(evaluator.run(parser.parse("['mice[n]']"), { n: 2 }), ["mice2"])
    assert.equal(evaluator.run({ type: "literal", value: "mice[n]" }, { n: 2 }), "mice[n]")
    assert.deepEqual(evaluator.run(parser.parse("['[`n`]']"), { n: 2 }), ["[`n`]"])
})

test("the shared question memo forgets expanded functions at a new epoch", () => {
    const { scheduler, host } = setup("fn distance 10\nlet ho = fw distance")
    host.deps.mathParser.defineFunction("distance", "25")
    scheduler.readouts.recompute()
    settle(scheduler)
    assert.deepEqual(question(scheduler), [25])
    assert.equal(host.children.get("ho").transform.deref().position[0], 25)
    assert.deepEqual(scheduler.errors, [])
    const parser = new Parser()
    parser.defineFunction("n", "1")
    assert.equal(new Evaluator().run(parseMemo(parser, "n"), {}), 1)
    parser.reset()
    assert.throws(() => new Evaluator().run(parseMemo(parser, "n"), {}), /Undefined variable/)
})

test("a refused recapture reports on its figure, then a valid question recovers", () => {
    const { scheduler, host } = setup("fn distance 10\nlet ho = fw distance")
    const ho = host.children.get("ho")
    host.deps.mathParser.defineFunction("distance", "[1,2]+[3]")
    scheduler.readouts.recompute()
    settle(scheduler)
    assert.ok(scheduler.errors.some(e => e.name === "ho" && /equal lengths/.test(e.message)))
    assert.ok(scheduler.errors.find(e => e.name === "ho").span)
    host.deps.mathParser.defineFunction("distance", "25")
    scheduler.readouts.recompute()
    settle(scheduler)
    assert.equal(ho.transform.deref().position[0], 25)
    assert.deepEqual(scheduler.errors, [])
})

test("malformed quoted access wounds visibly in the headless rehearsal", () => {
    assert.throws(() => drainEvents(parseProgram('let ho = "mice".'), deps()), /Expected a property/)
    assert.throws(() => drainEvents(parseProgram('let ho = fw "mice"..x'), deps()), /Unknown token/)
})

test("the original two-input spelling has a determined question without an exposed place", () => {
    const { scheduler, host } = setup('as mice do\n rt 90\n fw 10\nend\nlet ho = faceto "mice".x "mice".y')
    assert.ok(Math.abs(question(scheduler)[0]) < 1e-12)
    assert.equal(question(scheduler)[1], -10)
    assert.equal(headingOf(host.children.get("ho").transform.deref().rotation), 180)
    assert.deepEqual(scheduler.errors, [])
})

test("declaring parameters override evaluator constants on both sides of a question", () => {
    const { scheduler, host } = setup("let mice1\nas mice1 do\n fw 10\nend\ndef wrap x do\n let ho = fw 'mice[x]'.x+x\nend\nwrap 1")
    assert.deepEqual(question(scheduler), [11])
    drag(scheduler, host.children.get("mice1"), [25, 0, 0])
    assert.deepEqual(question(scheduler), [26])
    assert.equal(host.children.get("ho").transform.deref().position[0], 26)
    assert.deepEqual(scheduler.errors, [])
})

test("a quoted access also resolves a held dotted context binding", () => {
    const parser = new Parser()
    const evaluator = new Evaluator()
    assert.equal(evaluator.run(parser.parse("'mice'.x"), { 'mice.x': 12 }), 12)
})

test("blocked reads pass through interpolation and quoted access without becoming NOTHING", () => {
    const parser = new Parser()
    const evaluator = new Evaluator()
    evaluator.parser = parser
    const waiting = Object.assign(new Error("waiting"), { blocked: true })
    evaluator.resolveExternal = () => { throw waiting }
    for (const src of ["'mice'.x", "'mice[n]'.x", "['mice[n]']"]) {
        assert.throws(() => evaluator.run(parser.parse(src), {}), error => error === waiting)
    }
})
