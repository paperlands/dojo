// `loop until touch(<a path>) do … end` — the enclosed walk is the subject.
// The screen is ONE retained `.path` snapshot taken at entry; the loop repeats on a
// miss and returns only at entry contact or an accepted hit.
// (id:touch-generative-centers, id:touch-play-reading, M1/M2)
// Run: node --test test/js/laws/touch_step_test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildWorld, drive, fork } from './harness.mjs'
import { collectErrors, parseProgram, printAST } from '../../../assets/js/turtling/parse.js'
import { firstMeeting, incidence, makePath } from '../../../assets/js/turtling/geometry.js'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'
import { SE3, AXIS_Z } from '../../../assets/js/turtling/se3.js'
import { execute } from '../../../assets/js/turtling/executor.js'
import { storageSpace } from '../../../assets/js/turtling/localize.js'

const near = (actual, expected, label = '') => assert.ok(
    Math.hypot(...actual.map((x, i) => x - expected[i])) < 1e-9,
    `${label} ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`)

const guide = (x) => `let guide = path((${x}, -5, 0), (${x}, 5, 0))`
const until = (body, header = 'guide.path') => `${guide(3.25)}
loop until touch(${header}) do
${body}
end
label after`

const stateOf = (frame) => frame.batch ?? frame.actorState
const traceOf = (frame) => stateOf(frame)?.trace ?? []
// The HOST walk's own output: a world may also contain the turtle that walked the
// screen, and its ink is not the walk under test.
const labelsIn = (ink) => (ink.get('host') ?? []).filter((e) => e.type === 'label').map((e) => e.text)
const strokesIn = (ink) => (ink.get('host') ?? []).filter((e) => e.type === 'path')

function play(source, opts = {}) {
    const scheduler = buildWorld({ trace: true, ...opts })
    const spec = fork('host', source, opts.origin)
    if (opts.penUp) spec.style = { ...spec.style, down: false }
    // A guard that never meets a screen repeats: the seat always slices the spawn, so a
    // fixture that drives an unbounded walk arms a slice too. (id:output-ledger-r2-pacer)
    scheduler.sliceFor(opts.slice ?? 5000)
    const host = scheduler.hotSwapChild('host', spec)
    const ink = drive(scheduler, { maxTicks: opts.maxTicks ?? 600 })
    return {
        scheduler, host, ink,
        pose: () => [...frameWorldTransform(host).position],
        errors: scheduler.errors.map((error) => error.message),
    }
}

test('one step, one screen: the accepted pose, the ink and the trace stop at the screen', () => {
    const run = play(until(`  goto 10 0 0
  label suffix`))
    assert.deepEqual(run.errors, [])
    assert.deepEqual(run.pose(), [3.25, 0, 0], 'the accepted pose is the contact')
    assert.deepEqual(traceOf(run.host), [[[0, 0, 0], [3.25, 0, 0]]], 'the trace is the prefix')
    const strokes = strokesIn(run.ink)
    assert.equal(strokes.length, 1)
    assert.deepEqual(strokes[0].points, [[0, 0, 0], [3.25, 0, 0]], 'one stroke, no ink beyond it')
    // The suffix of the guarded body does not run; the caller continues, once.
    assert.deepEqual(labelsIn(run.ink), ['after'])
})

test('the same consumer text for a declared screen and a walked one', () => {
    const declared = play(until(`  goto 10 0 0`))
    // Only the header's producer changes: the guide is a turtle's own accepted trace.
    const walked = play(`as pen do
  path (3.25, -5, 0) (3.25, 5, 0)
end
let guide = pen.path
loop until touch(guide.path) do
  goto 10 0 0
end
label after`, { plain: true })
    assert.deepEqual(declared.errors, [])
    assert.deepEqual(walked.errors, [])
    assert.deepEqual(walked.pose(), declared.pose())
    assert.deepEqual(traceOf(walked.host), traceOf(declared.host))
    assert.deepEqual(strokesIn(walked.ink).map((e) => e.points),
        strokesIn(declared.ink).map((e) => e.points))
})

test('loop and helper revisits keep the same .path read for both kinds of guide', () => {
    const value = (x) => `path((${x}, -5, 0), (${x}, 5, 0))`
    const figure = (x) => `path (${x}, -5, 0) (${x}, 5, 0)`
    for (const make of [value, figure]) {
        for (const revise of [`let p = ${make(3.25)}`, 'revise']) {
            const run = play(`def revise do
  let p = ${make(3.25)}
end
let p = ${make(20)}
loop 2 do
  ${revise}
end
loop until touch(p.path) do
  fw 30
end`)
            assert.deepEqual(run.errors, [], `${make(20)} via ${revise}`)
            assert.deepEqual(run.pose(), [3.25, 0, 0])
        }
    }
})

test('a pen-up hit clips without ink and still records the accepted place', () => {
    const run = play(until(`  goto 10 0 0`), { penUp: true })
    assert.deepEqual(run.errors, [])
    assert.deepEqual(run.pose(), [3.25, 0, 0], 'the route is decided by provenance, not by pen state')
    assert.deepEqual(strokesIn(run.ink), [], 'no ink was deposited')
    assert.deepEqual(traceOf(run.host), [[[3.25, 0, 0]]], 'the accepted place is retained')
    assert.deepEqual(labelsIn(run.ink), ['after'])
})

test('a miss repeats, and a later iteration hits: the step size does not change the landing', () => {
    // Two units at a time: four, then the clip at five — the body runs on each miss.
    const repeated = play(`${guide(5)}
loop until touch(guide.path) do
  goto x+2 y 0
  label suffix
end
label after`)
    assert.deepEqual(repeated.errors, [])
    assert.deepEqual(repeated.pose(), [5, 0, 0])
    assert.deepEqual(traceOf(repeated.host), [[[0, 0, 0], [2, 0, 0], [4, 0, 0], [5, 0, 0]]])
    // A miss takes the whole step, suffix included; the hit skips it.
    assert.deepEqual(labelsIn(repeated.ink), ['suffix', 'suffix', 'after'])
    assert.equal(strokesIn(repeated.ink).length, 3)

    // The same screen reached by one long step and by one short one lands identically.
    const long = play(until(`  goto 10 0 0`))
    const short = play(until(`  goto 4 0 0`))
    assert.deepEqual(long.pose(), [3.25, 0, 0])
    assert.deepEqual(short.pose(), [3.25, 0, 0])
})

test('entry contact runs no body effect at all', () => {
    const run = play(`let guide = path((0, -5, 0), (0, 5, 0))
loop until touch(guide.path) do
  goto 10 0 0
  label suffix
end
label after`)
    assert.deepEqual(run.errors, [])
    assert.deepEqual(run.pose(), [0, 0, 0], 'no move')
    assert.deepEqual(traceOf(run.host), [], 'no place was accepted')
    assert.deepEqual(strokesIn(run.ink), [], 'no ink')
    assert.deepEqual(labelsIn(run.ink), ['after'], 'the body never ran; the caller continued')
})

test('a malformed header is a located failure with no body effects', () => {
    for (const header of ['notpath', 'guide.position']) {
        const run = play(`let notpath = 5
${guide(3.25)}
let guide2 = guide
loop until touch(${header}) do
  goto 10 0 0
  label suffix
end
label after`)
        assert.equal(run.errors.length, 1, `${header} must be refused`)
        assert.match(run.errors[0], /^touch: needs a path/)
        assert.deepEqual(run.pose(), [0, 0, 0])
        assert.deepEqual(strokesIn(run.ink), [], 'and the body never ran')
        assert.deepEqual(labelsIn(run.ink), [])
    }
})

test('the user walk meets its figure, independent of forward spelling and step size', () => {
    for (const step of ['fw 10', 'fw 30', 'forward 200', 'fd 11']) {
        const run = play(`let guide = fw 100
jmp -100
loop until touch(guide.path) do
  ${step}
end
label after`)
        assert.deepEqual(run.errors, [], step)
        assert.deepEqual(run.pose(), [0, 0, 0], step)
        assert.deepEqual(traceOf(run.host.children.get('guide')), [[[0, 0, 0], [100, 0, 0]]])
        assert.deepEqual(traceOf(run.host).at(-1).at(-1), [0, 0, 0])
        assert.deepEqual(strokesIn(run.ink).at(-1).points.at(-1), [0, 0, 0])
        assert.deepEqual(labelsIn(run.ink), ['after'])
    }
})

test('a turn inside the guard changes heading, then a pen-up relative step meets in world space', () => {
    const origin = SE3.rotateLocal({ rotation: SE3.identity().rotation, position: [5, 2, 0] }, AXIS_Z, 90)
    const run = play(until(`  lt 90
  fw 10
  label suffix`), { origin, penUp: true })
    assert.deepEqual(run.errors, [])
    near(run.pose(), [3.25, 2, 0], 'world contact')
    assert.deepEqual(strokesIn(run.ink), [])
    assert.deepEqual(labelsIn(run.ink), ['after'])
})

test('jumps do not inherit a straight route from their endpoints', () => {
    for (const jump of ['jmp 10', 'jmpto 10 0 0']) {
        const run = play(until(`  ${jump}
  label suffix`))
        assert.match(run.errors[0], /not a represented straight step/)
        assert.deepEqual(run.pose(), [0, 0, 0])
        assert.deepEqual(strokesIn(run.ink), [])
        assert.deepEqual(labelsIn(run.ink), [])
    }
})

test('a refusal is never a hit, and never a loop', () => {
    // A custom producer could accept a route the screen never saw: refused beforeasking.
    let asked = 0
    const substituted = play(until(`  goto 10 0 0
  label suffix`), {
        admit: ({ requested }) => { asked++; return { accepted: true, transform: requested } },
    })
    assert.equal(asked, 0, 'the producer was never consulted')
    assert.deepEqual(substituted.pose(), [0, 0, 0])
    assert.deepEqual(strokesIn(substituted.ink), [], 'nothing was published')
    assert.deepEqual(substituted.errors, ['touch: the screen step was refused'])

    const delayed = play(until('  fw 10'), {
        admitAsync: async ({ requested }) => { asked++; return { accepted: true, transform: requested } },
    })
    assert.equal(asked, 0, 'the delayed door does not lose the same guard')
    assert.deepEqual(delayed.errors, ['touch: the screen step was refused'])

    // A live law whose subject is the WRITER'S READING refuses the clipped pose.
    const law = play(`let A = (0, 0, 5)
let A.distance = 5
${guide(3.25)}
loop until touch(guide.path) do
  goto 10 0 0
  label suffix
end
label after`)
    assert.deepEqual(law.pose(), [0, 0, 0], 'no move was accepted')
    assert.deepEqual(strokesIn(law.ink), [], 'no stroke claimed a hit')
    assert.deepEqual(law.errors, ['touch: the screen step was refused'])
    near([...frameWorldTransform(law.host.children.get('A')).position], [0, 0, 5],
        'and the lawful participant was not dragged along')

    // A declining independent validation is the same boundary.
    const declined = play(until(`  goto 10 0 0`), { validate: () => false })
    assert.deepEqual(declined.pose(), [0, 0, 0])
    assert.deepEqual(strokesIn(declined.ink), [])
    assert.equal(declined.errors.length, 1)
})

test('a later refusal skips the suffix and preserves already accepted ink at any capacity', () => {
    for (const capacity of [1, 64]) {
        const run = play(until(`  fw 1
  let A = (0, 0, 5)
  let A.distance = 5
  loop 2 do
    fw 10
    label inner
  end
  label outer`), { capacity, strokeMax: 1000 })
        assert.deepEqual(run.errors, ['touch: the screen step was refused'])
        assert.deepEqual(run.pose(), [1, 0, 0])
        assert.deepEqual(labelsIn(run.ink), [])
        assert.deepEqual(strokesIn(run.ink).map(({ points }) => points), [[[0, 0, 0], [1, 0, 0]]])
    }
})

test('a following expansion cannot slip a different step past the screen', () => {
    const run = play(`let A
let A.distance = 100
${guide(3.25)}
loop until touch(guide.path) do
  goto 10 0 0
  label suffix
end
label after`)
    assert.deepEqual(run.pose(), [0, 0, 0], 'nothing was accepted')
    assert.deepEqual(strokesIn(run.ink), [], 'and no stroke claimed the hit')
    assert.equal(run.errors.length, 1, 'the refusal is said out loud')
    near([...frameWorldTransform(run.host.children.get('A')).position], [100, 0, 0],
        'the lawful follower stands where it was')
})

test('an ordinary helper call inside the body stays guarded', () => {
    const run = play(`def advance do
  goto 10 0 0
end
${guide(3.25)}
loop until touch(guide.path) do
  advance
  label suffix
end
label after`)
    assert.deepEqual(run.errors, [])
    assert.deepEqual(run.pose(), [3.25, 0, 0], 'the inner step answered the screen')
    assert.deepEqual(strokesIn(run.ink).map((e) => e.points), [[[0, 0, 0], [3.25, 0, 0]]])
    assert.deepEqual(labelsIn(run.ink), ['after'], 'the body stopped, the caller continued')
})

test('the enclosing loop counter is untouched, and a child does not inherit the guard', () => {
    const counted = play(`${guide(3.25)}
loop 2 do
  loop until touch(guide.path) do
    goto 10 0 0
  end
  label count
end`)
    assert.deepEqual(counted.errors, [])
    assert.deepEqual(labelsIn(counted.ink), ['0', '1'], 'the outer count is exactly the loop counter')

    const child = play(`${guide(3.25)}
loop until touch(guide.path) do
  as kid do
    goto 10 0 0
  end
  goto 10 0 0
end
label after`)
    assert.deepEqual(child.errors, [])
    assert.deepEqual(child.pose(), [3.25, 0, 0], 'the walker answered the screen')
    near([...frameWorldTransform(child.host.children.get('kid')).position], [10, 0, 0],
        'the child is its own walk and was not clipped')
})

test('a nested guarded extent refuses explicitly', () => {
    const run = play(`${guide(3.25)}
loop until touch(guide.path) do
  loop until touch(guide.path) do
    goto 10 0 0
  end
end`)
    assert.deepEqual(run.errors, ['touch: a guarded extent cannot nest inside another'])
    assert.deepEqual(run.pose(), [0, 0, 0])
})

test('capacity one changes nothing: same prefix, same ink, no leftover debt', () => {
    const source = until(`  goto 10 0 0
  label suffix`)
    const free = play(source)
    const tight = play(source, { capacity: 1 })
    assert.deepEqual(tight.errors, [])
    assert.deepEqual(tight.pose(), free.pose())
    assert.deepEqual(traceOf(tight.host), traceOf(free.host))
    assert.deepEqual(strokesIn(tight.ink).map((e) => e.points),
        strokesIn(free.ink).map((e) => e.points))
    assert.deepEqual(labelsIn(tight.ink), labelsIn(free.ink))
    assert.equal(tight.scheduler.done, true, 'the walk settled')
})

test('an empty body never fires: it is preemptible and retirable', () => {
    // No mover, no miss, no hit: the iteration is charged and the slice is offered, so
    // the seat can take a keystroke and the shell can retire the frame.
    const scheduler = buildWorld({ trace: true })
    scheduler.sliceFor(4)
    const host = scheduler.hotSwapChild('host', fork('host', `${guide(50)}
loop until touch(guide.path) do
end
label after`))
    assert.equal(scheduler.done, false, 'the loop is still running')
    assert.equal(host.done, false)
    assert.ok((host.batch?.reductions ?? 0) > 0, 'each iteration was charged')
    scheduler.removeChild('host')
    for (let i = 0; i < 6; i++) scheduler.tick(1000 + i * 20)
    assert.equal(scheduler.done, true, 'retiring the walk settles the world')
})

test('a nontrivial world chart is respected: the clip is a world place', () => {
    const origin = SE3.rotateLocal({ rotation: SE3.identity().rotation, position: [5, 7, 0] }, AXIS_Z, 30)
    const run = play(`let guide = path((7.25, -20, 0), (7.25, 20, 0))
loop until touch(guide.path) do
  goto 10 0 0
end
label after`, { origin })
    assert.deepEqual(run.errors, [])
    // The straight world step (5,7,0) → (10,0,0) meets x = 7.25 at t = 0.45.
    near(run.pose(), [7.25, 3.85, 0], 'world contact')
    const trace = traceOf(run.host)
    near(trace[0][trace[0].length - 1], [7.25, 3.85, 0], 'the trace ends at the contact')
})

test('the kernel facts the step relies on', () => {
    const screenAt = (x) => makePath([[[x, -5, 0], [x, 5, 0]]])
    const from = [0, 0, 0], to = [10, 0, 0]
    const hit = firstMeeting(screenAt(3.25), from, to)
    assert.equal(hit.kind, 'point')
    near(hit.at, [3.25, 0, 0], 'meeting')
    assert.ok(Math.abs(hit.t - 0.325) < 1e-12, 't is the fraction along the step')
    assert.equal(firstMeeting(screenAt(-2), from, to).kind, 'none')
    assert.equal(firstMeeting(screenAt(20), from, to).kind, 'none')
    const x = 1e12
    const translated = screenAt(x + 3.25)
    assert.equal(incidence(translated, [x, 0, 0]), false)
    assert.deepEqual(firstMeeting(translated, [x, 0, 0], [x + 10, 0, 0]),
        { kind: 'point', t: 0.325, at: [x + 3.25, 0, 0] })
    const e = 1e-10
    const justBeyond = makePath([[[0.5 + e, 1.5 + e, 0], [1.5 + e, 0.5 + e, 0]]])
    assert.deepEqual(firstMeeting(justBeyond, from, [1, 1, 0]), { kind: 'point', t: 1, at: [1, 1, 0] })
    assert.equal(firstMeeting(makePath([[[2, 1, 0], [6, 1, 0]]]), from, to).kind, 'none')
    const along = makePath([[[2, 0, 0], [6, 0, 0]]])
    assert.deepEqual(firstMeeting(along, from, to), { kind: 'point', t: 0.2, at: [2, 0, 0] })
    assert.deepEqual(firstMeeting(along, to, from), { kind: 'point', t: 0.4, at: [6, 0, 0] })
    // A jump-gapped screen does not bridge its runs.
    const gapped = makePath([[[3.25, -5, 0], [3.25, -1, 0]], [[3.25, 1, 0], [3.25, 5, 0]]])
    assert.equal(firstMeeting(gapped, [0, 0, 0], [10, 0, 0]).kind, 'none')
    assert.equal(incidence(screenAt(3.25), [3.25, 2, 0]), true)
    assert.equal(incidence(screenAt(3.25), [0, 0, 0]), false)
    assert.equal(incidence(gapped, [3.25, 0, 0]), false)
})

test('a blocked target read cannot carry the old chart into its proposal', () => {
    let available = false
    let basis = SE3.identity()
    const walk = execute([{ type: 'Call', value: 'goto', children: [{ type: 'Value', value: 'target' }] }], {
        mathParser: { userspace: new Map() },
        mathEvaluator: { constants: {}, resolveExternal: () => {
            if (!available) throw Object.assign(new Error('pending'), { blocked: true })
            return [10, 0, 0]
        } },
        space: storageSpace(() => basis),
    }, { breathEvery: 0, motionProtocol: true })
    assert.equal(walk.next().value.type, 'blocked')
    basis = { ...basis, position: [5, 0, 0] }
    available = true
    const attempt = walk.next().value
    assert.equal(attempt.type, 'motion')
    assert.deepEqual(attempt.requested.position, [5, 0, 0])
    walk.return()
})
test('the playable rung', () => {
    const rung = readFileSync(new URL('../../../scripts/play/rungs/touch-stop.plang', import.meta.url), 'utf8')
    const run = play(rung)
    assert.deepEqual(run.errors, [])
    // The walk stops on the guide, then walks AWAY: the screen was a stopping condition
    // for one walk, never a wall.
    assert.deepEqual(strokesIn(run.ink).map((e) => e.points),
        [[[0, 0, 0], [3.25, 0, 0]], [[3.25, 0, 0], [0, 8, 0]]])
    assert.deepEqual(labelsIn(run.ink), ['here'], 'the hit skipped the body suffix')
    near([...frameWorldTransform(run.host.children.get('guide')).position], [3.25, 6, 0],
        'the guide walked the screen it supplies')
})

// --- the head is a bracket, and the execution context is named ----------------------

test('until reads a condition or one balanced swept touch, before any body is consumed', () => {
    const SRC = (head) => `loop ${head} do\n  goto 10 0 0\nend`
    // Valid spellings, canonical print, and a clean round trip.
    for (const [head, canonical] of [
        ['until x == 10', 'loop until x == 10 do'],
        ['until guide.path', 'loop until guide.path do'],
        ['until touch(guide.path)', 'loop until touch(guide.path) do'],
        ['until touch (guide.path)', 'loop until touch(guide.path) do'],
        // The expression keeps the author's spelling, exactly as `when`/`let` do.
        ['until touch(path((3,0,0),(4,0,0)))', 'loop until touch(path((3,0,0),(4,0,0))) do'],
        // No head at all is the unbounded loop, closed by the body's own `stop`.
        ['', 'loop do'],
    ]) {
        const ast = parseProgram(SRC(head))
        assert.deepEqual(collectErrors(ast), [], `${head} must parse`)
        const printed = printAST(ast)
        assert.equal(printed.split('\n')[0], canonical, `${head} prints canonically`)
        assert.deepEqual(collectErrors(parseProgram(printed)), [], 'and the printed source parses')
    }
    // Refusals: a located head error, no guarded loop, and the body left where it was.
    for (const [head, pattern] of [
        ['until touch(guide.path) rubbish', /one balanced touch/],
        ['until touch(guide.path, other.path)', /one balanced touch/],
        ['until touch (guide.path) rubbish', /one balanced touch/],
        ['until x ==', /a condition after 'until'/],
        ['until', /a condition after 'until'/],
        ['until touch()', /one balanced touch/],
        ['until touch(guide.path', /'do' to open 'loop'/],
    ]) {
        const ast = parseProgram(SRC(head))
        const errors = collectErrors(ast)
        assert.ok(errors.length >= 1, `${head} must be refused`)
        assert.match(errors[0].message, pattern, head)
        assert.equal(ast.some((n) => n.type === 'Loop'), false, `${head}: no loop`)
        assert.ok(ast.some((n) => n.type === 'Call' && n.value === 'goto'),
            `${head}: the body was not folded into the head`)
    }
})

test('until re-reads a condition like when with stop, then resumes the caller', () => {
    const source = `let guide = fw 100
jmp -100
fn x
loop until x==10 do
  fw 1
  fn x x+1
end
rt 90
fw 100`
    const manual = source.replace('loop until x==10 do', `loop do
  when x==10 do
    stop
  end`)
    for (const text of [source, manual]) {
        const run = play(text)
        assert.deepEqual(run.errors, [])
        assert.equal(run.scheduler.done, true)
        near(run.pose(), [-90, -100, 0])
        assert.equal(traceOf(run.host)[0].length, 12, 'jump, ten steps, then one after the loop')
    }
})

test('until checks at entry and at the next boundary, not between body statements', () => {
    const run = play(`loop until 1 do
  label skipped
end
loop until count == 2 do
  fw 1
  label count
end
label after`)
    assert.deepEqual(run.errors, [])
    assert.deepEqual(labelsIn(run.ink), ['0', '1', 'after'])
    near(run.pose(), [2, 0, 0])
})

test('a conditional inner loop does not replace the outer motion guard', () => {
    const run = play(until(`  loop until count == 1 do
    fw 10
    label inner
  end
  label outer`))
    assert.deepEqual(run.errors, [])
    assert.deepEqual(labelsIn(run.ink), ['after'])
    near(run.pose(), [3.25, 0, 0])
})

test('a repeating walk refuses a context it cannot park in — deterministically', () => {
    const SRC = `let guide = path((50, -5, 0), (50, 5, 0))
loop until touch(guide.path) do
end
label after`
    const settle = (scheduler) => { scheduler.tick(10_000); return scheduler.done }
    // (a) no timeslice armed: the headless reproduction, one tick, no spin.
    const plain = buildWorld({ trace: true })
    const hostA = plain.hotSwapChild('host', fork('host', SRC))
    assert.deepEqual(plain.errors.map((e) => e.message),
        ['loop: an unbounded walk needs a finite timeslice (withSlice)'])
    assert.equal(hostA.done, true, 'the walk ended; nothing is left mid-instant')
    assert.equal(settle(plain), true)

    // (b) a VALID host setting can still leave no breath: a cadence that never fires.
    //      Zero disables breaths; Infinity and NaN make `reductions % cadence === 0`
    //      never true. Each is refused with the value named.
    for (const breathEvery of [0, Infinity, NaN]) {
        const noBreath = buildWorld({ trace: true, breathEvery })
        const hostB = noBreath.withSlice(4, () => noBreath.hotSwapChild('host', fork('host', SRC)))
        assert.deepEqual(noBreath.errors.map((e) => e.message),
            [`loop: an unbounded walk needs a usable breath cadence (breathEvery is ${breathEvery})`],
            `breathEvery ${breathEvery}`)
        assert.equal(hostB.done, true, `breathEvery ${breathEvery}: the walk ended`)
        assert.equal(settle(noBreath), true)
    }

    // (c) an armed deadline must be FINITE: an infinite slice can never be spent.
    const endless = buildWorld({ trace: true })
    endless.sliceFor(Infinity)
    const hostC = endless.hotSwapChild('host', fork('host', SRC))
    assert.deepEqual(endless.errors.map((e) => e.message),
        ['loop: an unbounded walk needs a finite timeslice (withSlice)'])
    assert.equal(hostC.done, true)
    assert.equal(settle(endless), true)
})

test('a walk that resumes after its slice unwound is re-checked before the next iteration', () => {
    // The park is a breath; the slice is the caller's. Resuming without one must refuse
    // rather than re-enter the loop with no way to park.
    const scheduler = buildWorld({ trace: true })
    scheduler.sliceFor(4)
    const host = scheduler.hotSwapChild('host', fork('host', `let guide = path((50, -5, 0), (50, 5, 0))
loop until touch(guide.path) do
end
label after`))
    assert.deepEqual(scheduler.errors, [])
    assert.equal(host.done, false, 'the loop parked on its breath')
    assert.equal(host.suspension?.kind, 'breath')
    scheduler.sliceFor(null)          // the caller's slice unwinds
    scheduler.tick(2000)
    assert.deepEqual(scheduler.errors.map((e) => e.message),
        ['loop: an unbounded walk needs a finite timeslice (withSlice)'])
    assert.equal(host.done, true, 'the resumed walk refused the context and ended')
})

// --- `stop`: the author's own close, addressed to a loop ----------------------------

test('stop closes the nearest loop — and only that one', () => {
    // The inner loop is closed by its own `stop`; the outer one is not addressed, so it
    // keeps walking. Two units per outer iteration, four iterations.
    const run = play(`loop 4 do
  loop 9 do
    fw 1
    stop
  end
  fw 1
end
label after`)
    assert.deepEqual(run.errors, [])
    near(run.pose(), [8, 0, 0], 'the inner loop closed; the outer kept walking')
    assert.deepEqual(labelsIn(run.ink), ['after'])
})

test('a nested loop does not swallow the extent\'s close', () => {
    // The hit names the extent's loop. The inner loop yields without clearing, so the
    // contact is the pose rather than one inner iteration's leftover.
    const run = play(`${guide(3.25)}
loop until touch(guide.path) do
  loop 3 do
    goto 10 0 0
  end
end
label after`)
    assert.deepEqual(run.errors, [])
    near(run.pose(), [3.25, 0, 0], 'the contact is the pose')
    assert.deepEqual(labelsIn(run.ink), ['after'])
})

test('stop with no loop to close refuses by name', () => {
    const run = play(`stop
label after`)
    assert.deepEqual(run.errors, ['stop: no enclosing loop to close'])
})
