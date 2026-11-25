// A declared path and a turtle trace answer one `.path` read, meet through one
// consumer, and the crossing composes back into authorship. (id:path-a-walk-of-places)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, deps, drive, fork, worldOf } from './harness.mjs'
import { createActorState, drainEvents } from '../../../assets/js/turtling/executor.js'
import { takeSync } from '../../../assets/js/turtling/scheduler.js'
import { parseProgram } from '../../../assets/js/turtling/parse.js'
import { SE3 } from '../../../assets/js/turtling/se3.js'
import { readFileSync } from 'node:fs'
import { collectErrors } from '../../../assets/js/turtling/parse.js'
import { intersectPaths, isCrossing, isPath, makePath, snapshotPath, spanCrossing } from '../../../assets/js/turtling/geometry.js'

const near = (actual, expected, label = '') => assert.ok(
    Math.hypot(...actual.map((x, i) => x - expected[i])) < 1e-9,
    `${label} ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`)

function play(source, opts = {}) {
    const scheduler = buildWorld({ trace: true, ...opts })
    const spec = fork('host', source)
    assert.deepEqual(collectErrors(spec.code.ast), [])
    const host = scheduler.hotSwapChild('host', spec)
    const ink = drive(scheduler, { maxTicks: 400 })
    return { scheduler, host, ink, errors: scheduler.errors.map((error) => error.message) }
}

const stateOf = (frame) => frame ? (frame.batch ?? frame.actorState) : null
const traceOf = (frame) => stateOf(frame)?.trace ?? null
const placeOf = (host, name) => worldOf(host.children.get(name))

// The consumer is the SAME TEXT in both programs below: only the maker changes.
const consumer = `let cross = intersect(rail.path, guide.path)

as probe do
  path cross (3, 6, 0)
end`

const declared = `let rail = path((-6, 0, 0), (6, 0, 0))
let guide = path((0, -6, 0), (0, 6, 0))
${consumer}`

const walked = `let rail = path((-6, 0, 0), (6, 0, 0))
beColour slategray
as pen do
  path (0, -6, 0) (0, 6, 0)
end
beColour gold
let guide = pen.path
${consumer}`


// `let guide = path A B` names a WALK: the same figure door every recipe uses, so the
// walker it makes is indistinguishable from `as guide do path A B end` for `.path`.
const walkedByLet = `let rail = path((-6, 0, 0), (6, 0, 0))
let A = (0, -6, 0)
let B = (0, 6, 0)
let guide = path A B
${consumer}`

const walkedByAmbient = `let rail = path((-6, 0, 0), (6, 0, 0))
let A = (0, -6, 0)
let B = (0, 6, 0)
as guide do
  path A B
end
${consumer}`
test('two makers, one consumer: the declared guide and the turtle twin cross the same rail', () => {
    const a = play(declared)
    const b = play(walked)
    assert.deepEqual(a.errors, [])
    assert.deepEqual(b.errors, [])
    // The consumer lines are literally the same source.
    assert.equal(declared.slice(declared.indexOf('let cross')),
        walked.slice(walked.indexOf('let cross')))
    // Same walk, same stopping place: the crossing fed the later path as a vertex.
    assert.deepEqual(traceOf(a.host.children.get('probe')), traceOf(b.host.children.get('probe')))
    near(placeOf(b.host, 'probe'), [3, 6, 0], 'probe')
    near(placeOf(b.host, 'cross'), [0, 0, 0], 'crossing')
})

test('a let naming a walk walks: caller unchanged, ink with the pen down', () => {
    const named = play(walkedByLet)
    const ambient = play(walkedByAmbient)
    assert.deepEqual(named.errors, [])
    assert.deepEqual(ambient.errors, [])
    // The head of the program differs; the consumer is fixed text, asserted above.
    const guide = named.host.children.get('guide')
    assert.ok(guide, 'the let spawned a walker')
    assert.deepEqual(traceOf(guide), [[[0, -6, 0], [0, 6, 0]]])
    // Indistinguishable as a walker: the ambient twin's trace is the same geometry.
    assert.deepEqual(traceOf(ambient.host.children.get('guide')), traceOf(guide))
    // Pen down, so the accepted segment also became ink — one stroke, two places.
    const strokes = (named.ink.get('guide') ?? []).filter((event) => event.type === 'path')
    assert.equal(strokes.length, 1)
    assert.deepEqual(strokes[0].points, [[0, -6, 0], [0, 6, 0]])
    // And the crossing consumer sees the same place either way.
    assert.deepEqual(traceOf(named.host.children.get('probe')), traceOf(ambient.host.children.get('probe')))
    near(placeOf(named.host, 'cross'), [0, 0, 0], 'crossing')
})

test('the bracketed spelling stays a value, and grouped places stay places', () => {
    // `path((…), (…))` is the constructor: no turtle, no motion, no ink.
    const value = play(`let guide = path((0, -6, 0), (0, 6, 0))
let rail = path((-6, 0, 0), (6, 0, 0))
let cross = intersect(rail.path, guide.path)`)
    assert.deepEqual(value.errors, [])
    assert.equal(value.host.children.has('guide'), false)
    assert.deepEqual(value.host.params.get('guide').runs, [[[0, -6, 0], [0, 6, 0]]])
    assert.deepEqual([...value.ink.values()].flat().filter((e) => e.type === 'path'), [])
    near(placeOf(value.host, 'cross'), [0, 0, 0], 'crossing')

    // The command spelling groups by whitespace: two parenthesized places, not one call.
    const walk = play(`let guide = path (0, -6, 0) (0, 6, 0)`)
    assert.deepEqual(walk.errors, [])
    assert.deepEqual(traceOf(walk.host.children.get('guide')), [[[0, -6, 0], [0, 6, 0]]])
})

test('a trace is the geometry a declaration would have made', () => {
    const { host, errors } = play(walked)
    assert.deepEqual(errors, [])
    // The pen walked the guide, with no span invented for the jmpto.
    assert.deepEqual(traceOf(host.children.get('pen')), [[[0, -6, 0], [0, 6, 0]]])
    // `pen.path` retained as a value is the same runs a declaration would hold.
    assert.deepEqual(host.params.get('guide').runs, [[[0, -6, 0], [0, 6, 0]]])
    // And `.path` on a retained path is that path: the read does not change the shape.
    const again = play(`${walked}
let twice = intersect(guide.path, guide.path)`)
    assert.deepEqual(again.errors, [])
})

test('the crossing is the geometry, not a defaulted coordinate', () => {
    const { host, errors } = play(`let rail = path((-6, 2, 0), (6, 2, 0))
let guide = path((1, -6, 0), (1, 6, 0))
let cross = intersect(rail.path, guide.path)

as probe do
  path cross (4, 6, 0)
end`)
    assert.deepEqual(errors, [])
    near(placeOf(host, 'cross'), [1, 2, 0], 'crossing')
    assert.deepEqual(traceOf(host.children.get('probe')), [[[1, 2, 0], [4, 6, 0]]])
})

test('a certified empty crossing is a value, and it is not a vertex', () => {
    const { host, scheduler } = play(`let rail = path((0, 0, 0), (1, 0, 0))
let guide = path((0, 1, 0), (1, 1, 0))
let none = intersect(rail.path, guide.path)

as probe do
  path none (2, 2, 0)
end`)
    const none = host.params.get('none')
    assert.ok(isCrossing(none))
    assert.deepEqual(none.points, [])
    // Nothing was walked, and the author was told at the line that asked.
    assert.deepEqual(traceOf(host.children.get('probe')), [])
    const said = (host.children.get('probe').notices ?? []).map((n) => n.message)
    assert.equal(said.length, 1)
    assert.match(said[0], /coordinate target/)
    assert.deepEqual(scheduler.errors.map((e) => e.message), said)
})

test('a jump is not a bridge: the gap is provably empty', () => {
    const { host, errors } = play(`as pen do
  path (-6, 0, 0) (-1, 0, 0)
  path (1, 0, 0) (6, 0, 0)
end
let guide = pen.path
let wall = path((0, -5, 0), (0, 5, 0))
let none = intersect(guide.path, wall.path)`)
    assert.deepEqual(errors, [])
    assert.deepEqual(traceOf(host.children.get('pen')),
        [[[-6, 0, 0], [-1, 0, 0]], [[1, 0, 0], [6, 0, 0]]])
    assert.deepEqual(host.params.get('none').points, [])
})

test('two hits are a place set, and a set is not a walk', () => {
    const { host, scheduler } = play(`let zig = path((0, 0, 0), (0, 10, 0), (5, 10, 0), (5, 0, 0))
let line = path((-5, 5, 0), (15, 5, 0))
let hits = intersect(zig.path, line.path)

as probe do
  path hits (9, 9, 0)
end`)
    const hits = host.params.get('hits')
    assert.ok(isCrossing(hits))
    assert.deepEqual(hits.points, [[0, 5, 0], [5, 5, 0]])
    // The author must choose; walking a set would be an arbitrary pick.
    assert.deepEqual(traceOf(host.children.get('probe')), [])
    assert.equal(scheduler.errors.length, 1)
})

test('stroke batching does not move the geometry', () => {
    const source = `as pen do
  jmpto 0 0 0
  loop 8 do
    goto 10 0 0
    goto 10 10 0
    goto 0 10 0
    goto 0 0 0
  end
end`
    const traces = [1, 2, 1000].map((strokeMax) => {
        const { host, errors } = play(source, { strokeMax })
        assert.deepEqual(errors, [])
        return traceOf(host.children.get('pen'))
    })
    assert.deepEqual(traces[0], traces[1])
    assert.deepEqual(traces[0], traces[2])
    assert.equal(traces[0].length, 1)
    assert.equal(traces[0][0].length, 33)
})

test('a moved ambient still reports one world chart', () => {
    const { host, errors } = play(`as frame_a do
  jmpto 10 20 0
  lt 90
  as pen do
    fw 4
    lt 90
    fw 3
  end
end`)
    assert.deepEqual(errors, [])
    // pen starts on frame_a's accepted world pose, and both steps are world-valued.
    assert.deepEqual(traceOf(host.children.get('frame_a').children.get('pen')),
        [[[10, 20, 0], [10, 24, 0], [7, 24, 0]]])
})

test('a place has no path, and says so by name', () => {
    const { scheduler } = play(`let A = (0, 0, 0)
as reader do
  goto A.path
end`)
    assert.deepEqual(scheduler.errors.map((error) => error.message),
        ['No path: A is a place, not a walk'])
})

test('a local path shadows an outer ambient of the same name', () => {
    const { host, errors } = play(`as rail do
  jmpto 0 3 0
end
let rail = path((-6, 0, 0), (6, 0, 0))
let guide = path((0, -6, 0), (0, 6, 0))
let cross = intersect(rail.path, guide.path)`)
    assert.deepEqual(errors, [])
    // The ambient's single place lies ON the guide, so reaching it instead of the local
    // path would seat the crossing at (0, 3, 0).
    assert.deepEqual(traceOf(host.children.get('rail')), [[[0, 3, 0]]])
    near(placeOf(host, 'cross'), [0, 0, 0], 'crossing')
    // (0, 3, 0) would be the answer if the ambient had won.
})

test('path walks places one at a time, through the existing moves', () => {
    const { host, errors } = play(`let A = (-4, 3, 0)
let B = (4, 3, 0)
as walker do
  path A B
end
as one do
  path A
end`)
    assert.deepEqual(errors, [])
    assert.deepEqual(traceOf(host.children.get('walker')), [[[-4, 3, 0], [4, 3, 0]]])
    // A one-vertex path behaves like jmpto: a visit, no span.
    assert.deepEqual(traceOf(host.children.get('one')), [[[-4, 3, 0]]])
    assert.equal(host.children.get('walker').commandCount, 2)
})

test('a recipe named path still wins in command position', () => {
    const { host, errors } = play(`def path a b do
  goto a b 0
end
path 3 4`)
    assert.deepEqual(errors, [])
    assert.deepEqual(traceOf(host), [[[0, 0, 0], [3, 4, 0]]])
})

test('a path with no place is refused, not emptied', () => {
    const { scheduler } = play(`as p do
  path
end`)
    assert.deepEqual(scheduler.errors.map((error) => error.message),
        ['a path needs at least one place'])
})

test('one appended place per accepted mover, and a rebase is not an edge', () => {
    const { host, errors } = play(`as pen do
  jmpto 0 0 0
  loop 120 do
    goto 1 0 0
  end
end`)
    assert.deepEqual(errors, [])
    const trace = traceOf(host.children.get('pen'))
    assert.equal(trace.length, 1)
    // The turtle's standing place, then one per accepted goto. No history is rewritten.
    assert.equal(trace[0].length, 121)
    assert.equal(stateOf(host.children.get('pen')).trace === trace, true)
})


test('retention is a host capability, and its ceiling is named', () => {
    // Off: the walk keeps nothing, and the read says which fact it met.
    const off = play(`as pen do
  goto 1 0 0
end
as reader do
  goto pen.path
end`, { trace: false })
    assert.deepEqual(traceOf(off.host.children.get('pen')), null)
    assert.deepEqual(off.scheduler.errors.map((e) => e.message),
        ['No path: pen keeps no accepted trace — this world does not retain geometry'])

    // Bounded: past the ceiling the trail is not shortened behind the author's back.
    const bounded = play(`as pen do
  jmpto 0 0 0
  loop 5 do
    goto 1 0 0
  end
end
as reader do
  goto pen.path
end`, { traceMax: 3 })
    assert.deepEqual(traceOf(bounded.host.children.get('pen')), [[[0, 0, 0], [1, 0, 0], [1, 0, 0]]])
    assert.deepEqual(bounded.scheduler.errors.map((e) => e.message),
        ['No path: pen walked past its trace bound of 3 places'])
})
test('a retained path is a snapshot: a later step cannot rewrite the read', () => {
    const runs = [[[0, 0, 0], [1, 0, 0]]]
    const held = snapshotPath(runs)
    runs[0].push([2, 0, 0])
    assert.deepEqual(held.runs, [[[0, 0, 0], [1, 0, 0]]])
    // The container cannot gain a run under the consumer that was handed it, and a
    // place is that consumer's own copy.
    assert.throws(() => { held.runs.push([[9, 9, 9]]) }, TypeError)
    held.runs[0][0][2] = 42
    assert.deepEqual(runs[0][0], [0, 0, 0])
    assert.ok(isPath(makePath([])))
})

test('span facts: bounded, exact enough to know when nothing is there', () => {
    const seg = (from, to) => ({ from, to })
    // Bounded: the lines meet at t = 2, the spans do not.
    assert.equal(spanCrossing(seg([0, 0, 0], [1, 0, 0]), seg([2, -1, 0], [2, 1, 0])).kind, 'none')
    // Parallel and provably separated.
    assert.equal(spanCrossing(seg([0, 0, 0], [1, 0, 0]), seg([0, 1, 0], [1, 1, 0])).kind, 'none')
    // The kernel names the shared interval; the set-valued authoring surface can refuse it.
    assert.deepEqual(spanCrossing(seg([0, 0, 0], [4, 0, 0]), seg([1, 0, 0], [6, 0, 0])),
        { kind: 'overlap', enter: 0.25, exit: 1 })
    // Collinear, touching at one endpoint: that is one point.
    const touch = spanCrossing(seg([0, 0, 0], [4, 0, 0]), seg([4, 0, 0], [8, 0, 0]))
    assert.equal(touch.kind, 'point')
    near(touch.at, [4, 0, 0], 'touch')
    // Skew: the projections cross, the spans do not meet in the common chart.
    assert.equal(spanCrossing(seg([0, 0, 0], [2, 0, 0]), seg([1, -1, 5], [1, 1, 5])).kind, 'none')
    // A place on a span.
    // A place on a span is one point; a place off it is provably nothing.
    const onSpan = spanCrossing(seg([0, 0, 0], [0, 0, 0]), seg([0, -1, 0], [0, 1, 0]))
    assert.equal(onSpan.kind, 'point')
    assert.equal(spanCrossing(seg([1, 0, 0], [1, 0, 0]), seg([0, -1, 0], [0, 1, 0])).kind, 'none')
    near(onSpan.at, [0, 0, 0], 'place on span')
    // A non-finite endpoint is unresolved, never a quiet miss.
    assert.equal(spanCrossing(seg([0, 0, 0], [NaN, 0, 0]), seg([0, -1, 0], [0, 1, 0])).kind, 'unresolved')
    // Separation on any axis is exact, and short spans are not merged by a grid.
    const tiny = 1e-10
    assert.equal(spanCrossing(seg([-tiny, 0, 0], [tiny, 0, 0]), seg([0, -tiny, 3 * tiny], [0, tiny, 3 * tiny])).kind, 'none')
    // A large figure is classified by shape, not overflowed into a false point.
    const huge = 1e200
    const big = spanCrossing(seg([-huge, 0, 0], [huge, 0, 0]), seg([0, -huge, 0], [0, huge, 0]))
    assert.equal(big.kind, 'point')
    near(big.at, [0, 0, 0], 'large crossing')
    // A large figure that is genuinely disjoint stays disjoint.
    assert.equal(spanCrossing(seg([-huge, 0, 0], [huge, 0, 0]), seg([-huge, 3 * huge, 0], [huge, 3 * huge, 0])).kind, 'none')
    // The same rule holds through the consumer, not just the kernel.
    const tinyPaths = intersectPaths(makePath([[[-tiny, 0, 0], [tiny, 0, 0]]]),
        makePath([[[0, -tiny, 3 * tiny], [0, tiny, 3 * tiny]]]))
    assert.ok(isCrossing(tinyPaths))
    assert.deepEqual(tinyPaths.points, [])
    assert.deepEqual(intersectPaths(makePath([]), makePath([])).points, [])
})

test('a place-only path and a traced single visit answer the same way', () => {
    // One policy for both makers: a run of one place is one included place.
    const declaredOnly = play(`let point = path((0, 2, 0))
let line = path((-4, 2, 0), (4, 2, 0))
let hit = intersect(point.path, line.path)`)
    assert.deepEqual(declaredOnly.errors, [])
    near(placeOf(declaredOnly.host, 'hit'), [0, 2, 0], 'declared place')
    const tracedOnly = play(`as pen do
  path (0, 2, 0)
end
let point = pen.path
let line = path((-4, 2, 0), (4, 2, 0))
let hit = intersect(point.path, line.path)`)
    assert.deepEqual(tracedOnly.errors, [])
    assert.deepEqual(traceOf(tracedOnly.host.children.get('pen')), [[[0, 2, 0]]])
    near(placeOf(tracedOnly.host, 'hit'), [0, 2, 0], 'traced visit')
})

test('the trace records the accepted place, not the requested one', () => {
    const admit = ({ command, requested }) => command === 'goto'
        ? { accepted: true, transform: { rotation: requested.rotation, position: [7, 0, 0] } }
        : { accepted: true, transform: requested }
    const { host, errors } = play(`as pen do
  goto 3 0 0
  goto 1 0 0
end`, { admit })
    assert.deepEqual(errors, [])
    // Both proposals were corrected to the same accepted place: a held duplicate visit.
    assert.deepEqual(traceOf(host.children.get('pen')), [[[0, 0, 0], [7, 0, 0], [7, 0, 0]]])
})

test('an adopted rebase starts a new run at the place it landed on', () => {
    // A law moved this turtle between commands. Nobody walked from the old place, so the
    // trace must not span it — but the step after it is a real segment from its own start.
    const state = createActorState({ color: '#000000', traceGeometry: true })
    state.rebase = { rotation: SE3.identity().rotation, position: [5, 0, 0] }
    drainEvents(parseProgram(`goto 1 0 0
goto 2 0 0`), deps(), { actorState: state })
    assert.deepEqual(state.trace, [[[5, 0, 0], [1, 0, 0], [2, 0, 0]]])
})

test('a refused step adds no place, and the next real step still starts where it stands', () => {
    const admit = ({ requested }) => requested.position[0] === 2
        ? { accepted: false }
        : { accepted: true, transform: requested }
    const { host, errors } = play(`as pen do
  goto 1 0 0
  goto 2 0 0
  goto 3 0 0
end`, { admit })
    assert.deepEqual(errors, [])
    // The refused step is absent; the held place is where the next segment begins.
    assert.deepEqual(traceOf(host.children.get('pen')), [[[0, 0, 0], [1, 0, 0], [3, 0, 0]]])
})

// The playable rung, driven exactly as the seat would: the guide is made by walking,
// the crossing is a place, and the probe walks away from it.
const rung = readFileSync(new URL('../../../scripts/play/rungs/path-crossing.plang', import.meta.url), 'utf8')

test('the playable rung', () => {
    const { host, errors } = play(rung)
    assert.deepEqual(errors, [])
    // The maker is one `let` naming a walk: a turtle walked A then B.
    assert.deepEqual(traceOf(host.children.get('guide')), [[[0, -6, 0], [0, 6, 0]]])
    near(placeOf(host, 'cross'), [0, 0, 0], 'crossing')
    assert.deepEqual(traceOf(host.children.get('probe')), [[[0, 0, 0], [3, 6, 0]]])
    // The rail is a VALUE: no walker, and its own binding drew it.
    assert.equal(host.children.has('rail'), false)
    const mark = (takeSync(host) ?? []).find((e) => e.type === 'pathmark' && e.name === 'rail')
    assert.deepEqual(mark?.runs, [[[-6, 0, 0], [6, 0, 0]]])
})
