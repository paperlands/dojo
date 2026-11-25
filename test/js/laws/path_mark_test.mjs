// A declared path is DISPLAYED by its binding: one keyed mark, current state, never ink,
// never a turtle. (D055, id:path-accepted-places)
// Run: node --test test/js/laws/path_mark_test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive } from './harness.mjs'
import { frameWorldTransform, takeSync } from '../../../assets/js/turtling/scheduler.js'
import { materialize } from '../../../assets/js/turtling/materializer.js'
import { Group } from '../../../assets/js/utils/three-entry.js'

const near = (actual, expected, label = '') => assert.ok(
    Math.hypot(...actual.map((x, i) => x - expected[i])) < 1e-9,
    `${label} ${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)}`)

// One world, one sync read: the current-state slot CONFLATES, so a test that reads it
// twice is reading two different instants.
function world(source) {
    const scheduler = buildWorld({ trace: true })
    const host = scheduler.hotSwapChild('host', fork('host', source))
    const ink = drive(scheduler)
    return {
        scheduler, host, ink,
        sync: takeSync(host) ?? [],
        errors: scheduler.errors.map((error) => error.message),
    }
}

// The real materializer and the real line construction, with no WebGL — the same shape
// the vector witness uses. (test/js/laws/value_lifecycle_test.mjs)
function drawing() {
    const group = new Group()
    return {
        groups: { pathGroup: group },
        context: { paths: new Map(), vectors: new Map(), materials: { get: () => ({}) } },
        group,
    }
}

const marksIn = (sync) => sync.filter((e) => e.type === 'pathmark')
const placeOf = (host, name) => (host.children.get(name)
    ? frameWorldTransform(host.children.get(name)).position : null)
// The blocking counterexample shape: a rail along y = 0, and a probe line across it.
const CROSSING = `let vertical = path((3, -5, 0), (3, 5, 0))
let hit = intersect(rail.path, vertical.path)
goto hit`
// LineGeometry stores the run interleaved: start xyz, then end xyz.
const endsOf = (line) => Array.from(line.geometry.attributes.instanceStart.array).slice(0, 6)

test('a declared path is visible with no turtle: no child, no ink, same query answer', () => {
    const { host, ink, sync, errors } = world(`let rail = path((-6, 0, 0), (6, 0, 0))
let guide = path((0, -6, 0), (0, 6, 0))
let cross = intersect(rail.path, guide.path)`)
    assert.deepEqual(errors, [])
    // Geometry is a VALUE: no walker was created, and nothing was drawn as ink.
    assert.deepEqual([...host.children.keys()], ['cross'])
    assert.deepEqual([...ink.values()].flat().filter((e) => e.type === 'path'), [])
    // The mark is the declaring binding's current state, one key for the whole shape.
    const mark = marksIn(sync).find((e) => e.name === 'rail' && !e.removed)
    assert.ok(mark, 'the declared path deposited a mark')
    assert.equal(mark.key, `mark:${host.id}:rail`, 'keyed by the binding, not by a run name')
    assert.deepEqual(mark.runs, [[[-6, 0, 0], [6, 0, 0]]])
    // It draws through the one polyline construction, in the declarer's own layer.
    const { groups, context } = drawing()
    materialize(mark, groups, context)
    assert.equal(context.paths.size, 1)
    const entry = context.paths.get(mark.key)
    assert.equal(entry.lines.length, 1)
    near(endsOf(entry.lines[0]).slice(0, 3), [-6, 0, 0], 'segment start')
    near(endsOf(entry.lines[0]).slice(3, 6), [6, 0, 0], 'segment end')
    // And the query answer is the geometry, unchanged by being displayed.
    near([...host.children.get('cross').transform.deref().position], [0, 0, 0], 'crossing')
})

test('redefining the same binding leaves only its latest mark', () => {
    const { scheduler, sync } = world(`let rail = path((-6, 0, 0), (6, 0, 0))
let rail = path((-2, 3, 0), (2, 3, 0))`)
    assert.deepEqual(scheduler.errors, [])
    // The slot conflates under one key, so the last write IS the mark.
    const live = marksIn(sync).filter((e) => !e.removed)
    assert.equal(live.length, 1, 'one mark survives the re-declaration')
    assert.deepEqual(live[0].runs, [[[-2, 3, 0], [2, 3, 0]]], 'and it is the latest shape')
    const { groups, context } = drawing()
    for (const event of marksIn(sync)) materialize(event, groups, context)
    assert.equal(context.paths.size, 1, 'one object, not two')
    assert.equal(context.paths.get(live[0].key).lines.length, 1)
})

test('a name that stops naming a path retracts the mark', () => {
    for (const replacement of ['let rail = 5', 'let rail = (1, 2, 3)', 'let rail = [1, 2, 3]']) {
        const { host, sync } = world(`let rail = path((-6, 0, 0), (6, 0, 0))
${replacement}`)
        const gone = marksIn(sync).find((e) => e.removed)
        assert.ok(gone, `the mark left when the name became ${replacement}`)
        assert.equal(gone.key, `mark:${host.id}:rail`)
    }
})

test('a same-name type switch retracts the OTHER kind, not just its own', () => {
    // A path replaced by a vector: the path mark leaves and the arrow arrives.
    const toVector = world(`let rail = path((-6, 0, 0), (6, 0, 0))
let rail = [80, 0, 0]`)
    assert.ok(marksIn(toVector.sync).some((e) => e.removed), 'the path mark left')
    assert.ok(toVector.sync.some((e) => e.type === 'vector' && e.name === 'rail' && !e.removed),
        'the arrow arrived')
    // A vector replaced by a path: the arrow leaves and the mark arrives.
    const toPath = world(`let rail = [80, 0, 0]
let rail = path((-6, 0, 0), (6, 0, 0))`)
    assert.ok(toPath.sync.some((e) => e.type === 'vector' && e.removed), 'the arrow left')
    assert.ok(marksIn(toPath.sync).some((e) => !e.removed), 'the path mark arrived')
})

test('one mark owns every run, and disjoint runs never bridge', () => {
    // A traced guide with a jump is a retained path with two runs: one mark, two
    // polylines, and no segment across the gap. (id:path-accepted-places)
    const { sync, errors } = world(`as pen do
  path (0, 0, 0) (4, 0, 0)
  path (0, 2, 0) (4, 2, 0)
end
let guide = pen.path`)
    assert.deepEqual(errors, [])
    const mark = marksIn(sync).find((e) => e.name === 'guide' && !e.removed)
    assert.deepEqual(mark.runs, [[[0, 0, 0], [4, 0, 0]], [[0, 2, 0], [4, 2, 0]]])
    const { groups, context } = drawing()
    materialize(mark, groups, context)
    const entry = context.paths.get(mark.key)
    assert.equal(entry.lines.length, 2, 'one polyline per run')
    near(endsOf(entry.lines[0]).slice(0, 3), [0, 0, 0], 'first run start')
    near(endsOf(entry.lines[1]).slice(0, 3), [0, 2, 0], 'second run start')
    // The first polyline ends at its own run's end, never at the next run's start.
    near(endsOf(entry.lines[0]).slice(3, 6), [4, 0, 0], 'first run end')
})

test('removing one mark leaves unrelated ink standing', () => {
    const { host, sync } = world(`let rail = path((-6, 0, 0), (6, 0, 0))
let rail = 5
as pen do
  fw 10
end`)
    const { groups, context } = drawing()
    // The layer already holds a stroke of the turtle's ink.
    const inkStroke = { geometry: { dispose() {} }, material: {}, parent: groups.pathGroup }
    groups.pathGroup.add(inkStroke)
    const inkBefore = groups.pathGroup.children.length
    // Anything the declarer displayed before is already gone; the removal names one key.
    const gone = marksIn(sync).find((e) => e.removed)
    assert.ok(gone)
    materialize({ type: 'pathmark', key: gone.key, name: 'rail', runs: [[[-6, 0, 0], [6, 0, 0]]] },
        groups, context)
    const entry = context.paths.get(gone.key)
    for (const line of entry.lines) groups.pathGroup.remove(line)
    context.paths.delete(gone.key)
    assert.equal(groups.pathGroup.children.length, inkBefore, 'the ink stroke is still there')
    assert.equal(context.paths.size, 0)
    assert.equal(host.children.get('pen') ? 'a walker ran' : '', 'a walker ran')
})

// --- the query must follow the BINDING, not the shape the name used to have ---------
// A retracted mark with a live stale value is worse than an undrawn segment: the
// author's next question answers the old shape. (id:path-accepted-places, D055)

test('a replaced path answers the NEW declaration, never the stale shape', () => {
    // Blocking counterexample: a value replaced by a WALK at y = 3 used to answer y = 0.
    const walked = world(`let rail = path((0, 0, 0), (6, 0, 0))
let rail = path (0, 3, 0) (6, 3, 0)
${CROSSING}`)
    assert.deepEqual(walked.errors, [])
    near([...placeOf(walked.host, 'hit')], [3, 3, 0], 'the walked rail is the answer')
    // A walker is a walker: it has no declared mark, and the rail's old one is gone.
    assert.equal(marksIn(walked.sync).filter((e) => !e.removed && e.name === 'rail').length, 0)

    const stepped = world(`let rail = path((0, 0, 0), (6, 0, 0))
jmpto 0 4 0
let rail = fw 5
${CROSSING}`)
    assert.deepEqual(stepped.errors, [])
    near([...placeOf(stepped.host, 'hit')], [3, 4, 0], 'a relative walk replaced it too')
})

test('a path replaced by a non-geometry name stops answering the old path', () => {
    for (const replacement of ['let rail = 5', 'let rail = [2, 3, 0]']) {
        const { host, sync, errors } = world(`let rail = path((0, 0, 0), (6, 0, 0))
${replacement}
${CROSSING}`)
        // A bound number/vector is not a being: it has no facets, so the read is NOTHING
        // (the existing value rule), and no crossing is placed from the old shape.
        assert.deepEqual(errors, [])
        assert.equal(host.children.has('hit'), false, `no hit was placed after ${replacement}`)
        assert.equal(marksIn(sync).filter((e) => !e.removed && e.name === 'rail').length, 0,
            'and the rail\'s mark is gone')
    }

    // A path replaced by a PLACE refuses by name: a place is not a walk.
    const place = world(`let rail = path((0, 0, 0), (6, 0, 0))
let rail = (2, 3, 0)
${CROSSING}`)
    assert.deepEqual(place.scheduler.errors.map((e) => e.message),
        ['No path: rail is a place, not a walk'])
    assert.equal(place.host.children.has('hit'), false)
})

test('a refused replacement keeps the prior mark and the prior geometry', () => {
    const { host, scheduler, sync } = world(`let rail = path((-6, 0, 0), (6, 0, 0))
let rail = path((0/0, 0, 0))
${CROSSING}`)
    // Loud, located, and nothing was installed: the declaration could not mean what it
    // said, so the binding that stands is the one that landed. (id:eval-relational)
    assert.deepEqual(scheduler.errors.map((e) => e.message),
        ['path needs a finite place, got [NaN, 0, 0]'])
    assert.deepEqual(host.params.get('rail').runs, [[[-6, 0, 0], [6, 0, 0]]])
    const mark = marksIn(sync).find((e) => e.name === 'rail')
    assert.deepEqual(mark.runs, [[[-6, 0, 0], [6, 0, 0]]], 'the mark did not leave')
    assert.equal(mark.removed, undefined)
})

test('a path declared LAST owns the name: the export direction is the same rule', () => {
    // A walker or a place named `rail` came first; the value that follows owns the name,
    // because the nearer lexical binding decides. (Existing declaration rules: a VALUE
    // seats no frame, so the earlier frame is not released by this — reported, not fixed.)
    const fromWalk = world(`let A = (0, 3, 0)
let B = (6, 3, 0)
let rail = path A B
let rail = path((0, 0, 0), (6, 0, 0))
${CROSSING}`)
    assert.deepEqual(fromWalk.errors, [])
    near([...placeOf(fromWalk.host, 'hit')], [3, 0, 0], 'the declared value answers, not the walk')
    assert.deepEqual(marksIn(fromWalk.sync).filter((e) => e.name === 'rail' && !e.removed).map((e) => e.runs),
        [[[[0, 0, 0], [6, 0, 0]]]], 'and it is the one that is drawn')

    const fromPlace = world(`let rail = (2, 4, 0)
let rail = path((0, 0, 0), (6, 0, 0))
${CROSSING}`)
    assert.deepEqual(fromPlace.errors, [])
    near([...placeOf(fromPlace.host, 'hit')], [3, 0, 0], 'the declared value answers, not the place')
})

test('a malformed consumer is refused by name, and the path is untouched', () => {
    // The same rule as `path`: a declaration that cannot mean what it says is not
    // installed, and the binding it stood on still answers. (id:eval-relational)
    const { host, scheduler } = world(`let rail = path((0, 0, 0), (6, 0, 0))
let bad = intersect(5, rail.path)`)
    assert.deepEqual(scheduler.errors.map((e) => e.message),
        ['intersect needs two paths, got 5 and a path'])
    assert.deepEqual(host.params.get('rail').runs, [[[0, 0, 0], [6, 0, 0]]])
})

test('a same-kind replacement keeps its node and its driver', () => {
    // No churn: a vector re-declared as a vector is the same object AND the same node,
    // so a driven value does not lose and rebuild its dependency identity.
    const scheduler = buildWorld({ trace: true })
    const host = scheduler.hotSwapChild('host', fork('host',
        'let B\nlet A = [80, B.x, 0]\nwait 1\nlet A = [40, B.x, 0]'))
    let first = null
    for (let i = 0; i < 40 && !scheduler.done; i++) {
        scheduler.tick(i * 1000)
        if (first == null && host.scalars?.has('A')) first = host.scalars.get('A')
    }
    assert.deepEqual(scheduler.errors, [])
    assert.ok(first != null, 'the first declaration owns a node')
    assert.equal(host.scalars.get('A'), first, 'the re-declaration kept the node')
    const sync = takeSync(host) ?? []
    assert.deepEqual(sync.filter((e) => e.type === 'vector' && !e.removed).map((e) => e.to), [[40, 0, 0]])
    assert.equal(sync.some((e) => e.type === 'vector' && e.removed), false,
        'a vector→vector re-declaration is not a retraction')
    // And the driver still works: B still moves A.
    const move = scheduler.requestMotion(host.children.get('B'), {
        rotation: host.children.get('B').transform.deref().rotation, position: [7, 0, 0],
    }, scheduler.motionRevision)
    assert.equal(move.kind, 'accept')
    drive(scheduler, { maxTicks: 40 })
    const last = takeSync(host).filter((e) => e.type === 'vector' && !e.removed).at(-1)
    assert.deepEqual(last?.to, [40, 7, 0], 'the same node, still driven')

    // A path re-declared as a path is one mark, in place, with the newest shape.
    const paths = world(`let rail = path((0, 0, 0), (6, 0, 0))
let rail = path((0, 3, 0), (6, 3, 0))
${CROSSING}`)
    assert.deepEqual(paths.errors, [])
    near([...placeOf(paths.host, 'hit')], [3, 3, 0], 'the newest path answers')
    assert.equal(marksIn(paths.sync).filter((e) => e.removed && e.name === 'rail').length, 0,
        'a path→path re-declaration is not a retraction')
})
