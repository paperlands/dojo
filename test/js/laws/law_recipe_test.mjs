// Named recipes own obligations over supplied beings, not the beings themselves.
// (id:laws-recipe-composition)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive } from './harness.mjs'
import { frameWorldTransform, worldTransform } from '../../../assets/js/turtling/scheduler.js'
import { freePoint } from '../../../assets/js/turtling/laws/batch.js'
import { AUTHORED, bindWorld } from '../../../assets/js/turtling/laws/authored.js'
import { SE3, AXIS_Z } from '../../../assets/js/turtling/se3.js'

const LINK = `def link a b r do
  let distance(a,b) = r
end`
const at = frame => frameWorldTransform(frame).position
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`)
const clean = scheduler => {
    assert.deepEqual(scheduler.errors, [])
    assert.deepEqual([...scheduler.registry.values()].filter(f => f.unresolved).map(f => f.unresolved), [])
}
function fixture(origin = SE3.identity()) {
    const scheduler = buildWorld({ breathEvery: 0 })
    const points = scheduler.hotSwapChild('points', fork('points', 'let A\nlet B', origin))
    drive(scheduler)
    return { scheduler, points, A: points.children.get('A'), B: points.children.get('B') }
}
function source(scheduler, name, text, inputs, origin = SE3.identity()) {
    const spec = fork(name, text, origin)
    Object.assign(spec.env.scope, inputs)
    const frame = scheduler.hotSwapChild(name, spec)
    drive(scheduler)
    return frame
}
function valid(scheduler) {
    const ctx = bindWorld(id => scheduler.registry.get(id), {
        live: frame => frameWorldTransform(frame),
        placement: frame => worldTransform(frame),
    })
    for (const law of scheduler.laws.active()) assert.equal(AUTHORED[law.feature].measure(law, ctx).status, 'valid')
}

test('a named law recipe binds the supplied pair and owns only its obligation', () => {
    const { scheduler, points, A, B } = fixture()
    const owner = source(scheduler, 'source', `${LINK}\nlet rod = link A B 5`, { A, B })
    clean(scheduler)
    const rod = owner.children.get('rod')
    const [law] = scheduler.laws.active()
    assert.equal(scheduler.laws.count(), 1)
    assert.deepEqual(law.expression.references, [A.id, B.id])
    assert.equal(law.scope, rod.id)
    assert.equal(law.frame, rod.id)
    assert.equal(rod.closed, true)
    assert.equal(rod.children.size, 0, 'no cloned participants')
    assert.equal(A.parent, points)
    assert.equal(B.parent, points)
    assert.ok(freePoint(A) && freePoint(B))
    close(Math.hypot(...at(A).map((x, i) => x - at(B)[i])), 5)
    valid(scheduler)
})

test('two compatible named instances have distinct addresses and independent withdrawal', () => {
    for (const removed of ['first', 'second']) {
        const { scheduler, A, B } = fixture()
        const first = source(scheduler, 'first', `${LINK}\nlet rod = link A B 5`, { A, B })
        const second = source(scheduler, 'second', `${LINK}\nlet rod = link B A 5`, { A, B })
        clean(scheduler)
        const laws = scheduler.laws.active()
        assert.equal(laws.length, 2)
        assert.equal(new Set(laws.map(l => l.address)).size, 2)
        assert.deepEqual(new Set(laws.map(l => l.scope)), new Set([first.children.get('rod').id, second.children.get('rod').id]))
        const before = [at(A), at(B)]
        scheduler.removeChild(removed)
        assert.equal(scheduler.laws.count(), 1)
        assert.deepEqual([at(A), at(B)], before)
        assert.equal(scheduler.registry.get(A.id), A)
        assert.equal(scheduler.registry.get(B.id), B)
        valid(scheduler)
        scheduler.removeChild(removed === 'first' ? 'second' : 'first')
        assert.equal(scheduler.laws.count(), 0)
    }
})

test('ordinary unnamed recipes still replace one address in their declaring scope', () => {
    const scheduler = buildWorld({ breathEvery: 0 })
    scheduler.hotSwapChild('host', fork('host', `let A\nlet B\n${LINK}\nlink A B 5\nlink B A 5`))
    drive(scheduler)
    clean(scheduler)
    assert.equal(scheduler.laws.count(), 1)
})

test('nested helpers forward supplied identities through a nearer namesake', () => {
    const { scheduler, A, B } = fixture()
    const owner = source(scheduler, 'source', `${LINK}
def wrap a b do
  let "A"
  link a b 5
end
let rod = wrap A B`, { A, B })
    clean(scheduler)
    const rod = owner.children.get('rod')
    const [law] = scheduler.laws.active()
    assert.deepEqual(law.expression.references, [A.id, B.id])
    assert.notEqual(rod.children.get('A'), A)
    assert.deepEqual(at(rod.children.get('A')), [0, 0, 0])
    valid(scheduler)
})

test('a recipe composes existing coordinate and literal-distance rows over a supplied being', () => {
    const { scheduler, A } = fixture()
    source(scheduler, 'source', `def rim a do
  let a.x = 3
  let distance(a,(0,0)) = 5
end
let arc = rim A`, { A })
    clean(scheduler)
    assert.equal(scheduler.laws.count(), 2)
    close(at(A)[0], 3)
    close(Math.hypot(...at(A)), 5)
    valid(scheduler)
})

test('an unpassed outside being remains outside a law recipe', () => {
    const { scheduler, A, B } = fixture()
    source(scheduler, 'source', `def hidden a do
  let distance(a,B) = 5
end
let rod = hidden A`, { A, B })
    assert.ok(scheduler.errors.some(e => /outside law target/.test(e.message)))
    assert.equal(scheduler.laws.count(), 0)
    assert.deepEqual([at(A), at(B)], [[0, 0, 0], [0, 0, 0]])
})

test('a nested declaration cannot launder an unpassed law participant', () => {
    const { scheduler, A, B } = fixture()
    source(scheduler, 'source', `${LINK}
def wrap a do
  let inner = link a B 5
end
let outer = wrap A`, { A, B })
    assert.ok(scheduler.errors.some(e => /outside law target|closed region has no world read/.test(e.message)))
    assert.equal(scheduler.laws.count(), 0)
    assert.deepEqual([at(A), at(B)], [[0, 0, 0], [0, 0, 0]])
})

test('an unsupported second obligation preserves the installed first owner and geometry', () => {
    const { scheduler, A, B } = fixture()
    source(scheduler, 'first', `${LINK}\nlet rod = link A B 5`, { A, B })
    const laws = scheduler.laws.active()
    const before = [at(A), at(B)]
    source(scheduler, 'second', `${LINK}\nlet rod = link A B 10`, { A, B })
    assert.equal(laws.length, 1)
    assert.deepEqual(scheduler.laws.active(), laws)
    assert.deepEqual([at(A), at(B)], before)
    assert.ok([...scheduler.registry.values()].some(f => f.unresolved))
    valid(scheduler)
})

test('retiring a supplied identity retracts its laws without rebinding a namesake', () => {
    const { scheduler, A, B } = fixture()
    const owner = source(scheduler, 'source', `${LINK}\nlet rod = link A B 5`, { A, B })
    clean(scheduler)
    assert.equal(scheduler.laws.count(), 1)
    scheduler.removeChild('points')
    assert.equal(scheduler.laws.count(), 0)
    const namesakes = scheduler.hotSwapChild('points', fork('points', 'let A\nlet B'))
    drive(scheduler)
    assert.notEqual(namesakes.children.get('A'), A)
    assert.notEqual(namesakes.children.get('B'), B)
    assert.equal(owner.children.get('rod').seed.question[0], A)
    assert.equal(scheduler.laws.count(), 0)
})

test('the authored single-scope programme needs no injected bindings or new syntax', () => {
    const scheduler = buildWorld({ breathEvery: 0 })
    const host = scheduler.hotSwapChild('host', fork('host', `let A
let B
${LINK}
let first = link A B 5
let second = link B A 5`))
    drive(scheduler)
    clean(scheduler)
    assert.equal(scheduler.laws.count(), 2)
    assert.deepEqual(new Set(scheduler.laws.active().map(l => l.scope)),
        new Set([host.children.get('first').id, host.children.get('second').id]))
    valid(scheduler)
})

test('different participant and owner placements retain world geometry and one coherent publication', () => {
    const pointOrigin = SE3.translateLocal(SE3.rotateLocal(SE3.identity(), AXIS_Z, 37), 10, 20, 3)
    const ownerOrigin = SE3.translateLocal(SE3.rotateLocal(SE3.identity(), AXIS_Z, -21), -30, 7, 2)
    const { scheduler, A, B } = fixture(pointOrigin)
    const midpoint = at(A)
    const snapshots = []
    scheduler.readouts.register(1, 'watch', () => 1)
    scheduler.readouts.watch(() => snapshots.push({
        positions: [at(A), at(B)],
        laws: scheduler.laws.active(),
    }))
    const before = scheduler.motionRevision
    source(scheduler, 'source', `${LINK}\nlet rod = link A B 5`, { A, B }, ownerOrigin)
    clean(scheduler)
    assert.equal(scheduler.motionRevision - before, 1)
    assert.equal(snapshots.length, 1)
    assert.equal(snapshots[0].laws.length, 1)
    close(Math.hypot(...snapshots[0].positions[0].map((x, i) => x - snapshots[0].positions[1][i])), 5)
    midpoint.forEach((x, i) => close((at(A)[i] + at(B)[i]) / 2, x))
    valid(scheduler)
})

test('rewiring one source retracts only its law, preserving other support and both participants', () => {
    const { scheduler, A, B } = fixture()
    const first = source(scheduler, 'first', `${LINK}\nlet rod = link A B 5`, { A, B })
    source(scheduler, 'second', `${LINK}\nlet rod = link A B 5`, { A, B })
    clean(scheduler)
    const oldRod = first.children.get('rod')
    const surviving = scheduler.laws.active().find(l => l.scope !== oldRod.id)
    const before = [at(A), at(B)]
    scheduler.hotSwapChild('first', fork('first', ''))
    drive(scheduler)
    assert.deepEqual(scheduler.laws.active(), [surviving])
    assert.deepEqual([at(A), at(B)], before)
    assert.equal(scheduler.registry.get(A.id), A)
    assert.equal(scheduler.registry.get(B.id), B)
    valid(scheduler)
})

test('withdrawing a waiting recipe prevents its future law installation', () => {
    const { scheduler, A, B } = fixture()
    const spec = fork('source', `def later a b do
  wait 2
  let distance(a,b) = 5
end
let rod = later A B`)
    Object.assign(spec.env.scope, { A, B })
    scheduler.hotSwapChild('source', spec)
    drive(scheduler, { maxTicks: 1 })
    assert.equal(scheduler.laws.count(), 0)
    scheduler.removeChild('source')
    drive(scheduler, { maxTicks: 10 })
    assert.equal(scheduler.laws.count(), 0)
    assert.deepEqual([at(A), at(B)], [[0, 0, 0], [0, 0, 0]])
})

test('a waiting recipe refuses retired supplied identities instead of using new namesakes', () => {
    const { scheduler, A, B } = fixture()
    const spec = fork('source', `def later a b do
  wait 2
  let distance(a,b) = 5
end
let rod = later A B`)
    Object.assign(spec.env.scope, { A, B })
    scheduler.hotSwapChild('source', spec)
    drive(scheduler, { maxTicks: 1 })
    scheduler.removeChild('points')
    const namesakes = scheduler.hotSwapChild('points', fork('points', 'let A\nlet B'))
    drive(scheduler, { maxTicks: 10 })
    assert.ok(scheduler.errors.some(e => /retired/.test(e.message)))
    assert.equal(scheduler.laws.count(), 0)
    assert.deepEqual([at(namesakes.children.get('A')), at(namesakes.children.get('B'))], [[0, 0, 0], [0, 0, 0]])
})

test('supplied distance movers from different parents remain outside this bounded method', () => {
    const { scheduler, A } = fixture()
    const other = scheduler.hotSwapChild('other', fork('other', 'let B'))
    drive(scheduler)
    const B = other.children.get('B')
    source(scheduler, 'source', `${LINK}\nlet rod = link A B 5`, { A, B })
    assert.deepEqual(scheduler.errors, [])
    assert.ok([...scheduler.registry.values()].some(f => /bodyless siblings/.test(f.unresolved?.reason ?? '')))
    assert.equal(scheduler.laws.count(), 0)
    assert.deepEqual([at(A), at(B)], [[0, 0, 0], [0, 0, 0]])
})

test('supplying an active body does not admit it as a free distance mover', () => {
    const scheduler = buildWorld({ breathEvery: 0 })
    const points = scheduler.hotSwapChild('points', fork('points', 'let A\nas B do\n  fw 2\n  wait 100\nend'))
    drive(scheduler, { maxTicks: 2 })
    const A = points.children.get('A'), B = points.children.get('B')
    assert.equal(A.parent, B.parent, 'parent membership must not mask body admission')
    assert.equal(B.done, false)
    const before = [at(A), at(B)]
    source(scheduler, 'source', `${LINK}\nlet rod = link A B 5`, { A, B })
    assert.equal(A.parent, points)
    assert.equal(scheduler.laws.count(), 0)
    assert.ok([...scheduler.registry.values()].some(f => f.unresolved))
    assert.deepEqual([at(A), at(B)], before)
})

test('a ghost obligation still blocks a named recipe before any geometry or law installs', () => {
    const { scheduler, A, B } = fixture()
    const ghost = { feature: 'distance', endpoints: [A.id, 'GHOST'], scope: A.parent.id,
        frame: A.parent.id, predicate: 99, expression: { type: 'distance', references: [A.id, 'GHOST'], radius: 99 } }
    scheduler.laws.apply(ghost)
    const before = scheduler.laws.active()
    const revision = scheduler.motionRevision
    source(scheduler, 'source', `${LINK}\nlet rod = link A B 5`, { A, B })
    assert.deepEqual(scheduler.laws.active(), before)
    assert.equal(scheduler.motionRevision, revision)
    assert.deepEqual([at(A), at(B)], [[0, 0, 0], [0, 0, 0]])
    assert.ok([...scheduler.registry.values()].some(f => /missing bound participant/.test(f.unresolved?.reason ?? '')))
})

test('an explicit internal question may read a supplied body without moving it', () => {
    const scheduler = buildWorld({ breathEvery: 0 })
    const points = scheduler.hotSwapChild('points', fork('points', 'let A\nas B do\n  fw 2\nend'))
    drive(scheduler)
    const A = points.children.get('A'), B = points.children.get('B')
    const before = at(B)
    const spec = fork('source', `${LINK}\nlet rod = link A B 5`)
    Object.assign(spec.env.scope, { A, B })
    const law = spec.code.ast.find(node => node.type === 'Define').children[0]
    // Existing operation scaffold, not new public mover syntax. (D058)
    law.meta.movers = ['a']
    law.meta.reachPolicy = 'target-only'
    scheduler.hotSwapChild('source', spec)
    drive(scheduler)
    clean(scheduler)
    assert.equal(scheduler.laws.count(), 1)
    assert.deepEqual(at(B), before)
    close(Math.hypot(...at(A).map((x, i) => x - at(B)[i])), 5)
    valid(scheduler)
})

test('withdrawing one support leaves the other enforceable; withdrawing both releases it', () => {
    const { scheduler, A, B } = fixture()
    source(scheduler, 'first', `${LINK}\nlet rod = link A B 5`, { A, B })
    source(scheduler, 'second', `${LINK}\nlet rod = link A B 5`, { A, B })
    clean(scheduler)
    scheduler.removeChild('first')
    const wish = { ...SE3.identity(), position: [0, 0, 0] }
    assert.equal(scheduler.requestMotion(A, wish, scheduler.motionRevision, 'world').kind, 'accept')
    assert.equal(scheduler.laws.count(), 1, 'exactly the surviving support remains')
    valid(scheduler)
    assert.deepEqual(at(A), [0, 0, 0], 'the surviving support still answers the hand')
    scheduler.removeChild('second')
    assert.equal(scheduler.laws.count(), 0, 'the last support leaves no law behind')
    assert.equal(scheduler.requestMotion(A, wish, scheduler.motionRevision, 'world').kind, 'accept')
    assert.deepEqual(at(A), [0, 0, 0], 'no support means no hidden pin remains')
})

test('a recipe is an ordered construction, not an implicit all-or-nothing law batch', () => {
    const { scheduler, A } = fixture()
    const owner = source(scheduler, 'source', `def broken a do
  let a.x = 3
  let distance(a,(0,0)) = -1
end
let answer = broken A`, { A })
    const answer = owner.children.get('answer')
    assert.ok(scheduler.errors.some(e => /non-negative/.test(e.message)))
    assert.equal(scheduler.laws.count(), 1)
    assert.equal(scheduler.laws.active()[0].scope, answer.id)
    assert.equal(scheduler.laws.active()[0].feature, 'coordinate')
    close(at(A)[0], 3)
    valid(scheduler)
    scheduler.removeChild('source')
    assert.equal(scheduler.laws.count(), 0)
    assert.equal(at(A)[0], 3, 'withdrawal removes the obligation, not accepted geometry')
})

test('named recipes compose through nested named declarations without flattening ownership', () => {
    const { scheduler, A, B } = fixture()
    const owner = source(scheduler, 'source', `${LINK}
def couple a b do
  let left = link a b 5
  let right = link b a 5
end
let assembly = couple A B`, { A, B })
    clean(scheduler)
    const assembly = owner.children.get('assembly')
    const left = assembly.children.get('left'), right = assembly.children.get('right')
    assert.equal(scheduler.laws.count(), 2)
    assert.deepEqual(new Set(scheduler.laws.active().map(l => l.scope)), new Set([left.id, right.id]))
    assert.ok(scheduler.laws.active().every(l => l.expression.references.every(id => id === A.id || id === B.id)))
    valid(scheduler)
    scheduler.removeChild('source')
    assert.equal(scheduler.laws.count(), 0)
    assert.equal(scheduler.registry.get(A.id), A)
    assert.equal(scheduler.registry.get(B.id), B)
})
