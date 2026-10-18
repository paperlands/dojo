// Bounded free-tree initialization: an unsatisfied edge with exactly ONE endpoint isolated
// from every surviving positional truth places that leaf alone. (id:laws-free-relations-f2)
//
// Run: node --test test/js/laws/leaf_init_test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive } from './harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'
import { AUTHORED, boundTerm } from '../../../assets/js/turtling/laws/authored.js'
import { SE3, AXIS_Z } from '../../../assets/js/turtling/se3.js'

const at3 = (frame) => [...frameWorldTransform(frame).position]
const q = (v) => v.map((n) => Math.round(n * 1e6) / 1e6)
const close = (a, b) => assert.ok(Math.hypot(...q(a).map((v, i) => v - b[i])) < 1e-6, `${q(a)} != ${b}`)
const DEG = Math.PI / 180

function seat(source, origin = SE3.identity()) {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild('host', fork('host', source, origin))
    drive(scheduler, { maxTicks: 120 })
    const at = (n) => host.children.get(n)
    // Radii come from the BOUND TERM, never the legacy predicate mirror. (D058)
    const lengths = () => scheduler.laws.active().filter((l) => l.feature === 'distance').map((l) => {
        const [a, b] = l.endpoints.map((id) => at3(scheduler.registry.get(id)))
        return { ends: [...l.endpoints].sort().join('-'), got: Math.hypot(...a.map((v, i) => v - b[i])),
            want: boundTerm(l)?.radius }
    })
    return { scheduler, host, at, lengths }
}

const EXACT = 'let A\nlet B\nlet distance(A,B)=100\nlet D\nlet distance(B,D)=500'

test('leaf realization reads the bound distance, not its optional point-set view', (t) => {
    const set = t.mock.method(AUTHORED.distance, 'set', () => {
        throw new Error('a derived locus is not the distance authority')
    })
    const origin = SE3.rotateLocal(SE3.identity(), AXIS_Z, 37)
    for (const [prefix, radius, expected] of [[100, 500, -450], [100, 0, 50], [0, 500, 500]]) {
        const source = `let A\nlet B\nlet distance(A,B)=${prefix}\nlet D\nlet distance(B,D)=${radius}`
        const { scheduler, host, at, lengths } = seat(source, origin)
        assert.deepEqual(scheduler.errors, [])
        assert.equal(host.unresolved, null)
        assert.equal(scheduler.laws.active().length, 2)
        close(at3(at('D')), SE3.apply(origin, [expected, 0, 0]))
        for (const { got, want } of lengths()) assert.ok(Math.abs(got - want) < 1e-9)
    }
    assert.equal(set.mock.callCount(), 0, 'no point/sphere lowering is needed for this method')
})

test('the user source installs: two laws, prefix unchanged, D placed on BD', () => {
    const { host, at, lengths } = seat(EXACT)
    assert.equal(host.unresolved ?? null, null, 'no unresolved')
    const laws = lengths()
    assert.equal(laws.length, 2, 'both laws active')
    for (const { got, want } of laws) assert.ok(Math.abs(got - want) < 1e-9, `${got} != ${want}`)
    close(at3(at('A')), [-50, 0, 0])
    close(at3(at('B')), [50, 0, 0])
    close(at3(at('D')), [-450, 0, 0])
})

test('the edge spelled the other way gives the same answer', () => {
    const forward = seat(EXACT)
    const reversed = seat('let A\nlet B\nlet distance(A,B)=100\nlet D\nlet distance(D,B)=500')
    for (const n of ['A', 'B', 'D']) close(at3(reversed.at(n)), q(at3(forward.at(n))))
    close(at3(reversed.at('D')), [-450, 0, 0])
})

test('a rotated declaring parent keeps SE3 covariance', () => {
    const origin = SE3.rotateLocal(SE3.identity(), AXIS_Z, 37)
    const { at, lengths, host } = seat(EXACT, origin)
    assert.equal(host.unresolved ?? null, null)
    for (const { got, want } of lengths()) assert.ok(Math.abs(got - want) < 1e-9)
    // D is the accepted -x direction at 500, carried through the parent's placement.
    close(at3(at('D')), SE3.apply(origin, [-450, 0, 0]))
    close(at3(at('A')), SE3.apply(origin, [-50, 0, 0]))
})

test('a singular leaf takes the DECLARING metric ray, identical either spelling', () => {
    // AB=0 leaves A, B and D coincident, so no accepted ray exists. The leaf takes the
    // declaring frame's +x — never realizeDistance's bare world +x.
    const one = seat('let A\nlet B\nlet distance(A,B)=0\nlet D\nlet distance(B,D)=500')
    const two = seat('let A\nlet B\nlet distance(A,B)=0\nlet D\nlet distance(D,B)=500')
    for (const { at, host } of [one, two]) {
        assert.equal(host.unresolved ?? null, null)
        close(at3(at('D')), [500, 0, 0])
    }
    close(at3(one.at('D')), q(at3(two.at('D'))))
    assert.notEqual(one.at('A').id, one.at('B').id, 'coincident identities are distinct')
})

test('the singular ray keeps the declaring parent\'s covariance', () => {
    // A rotated declaring parent must move the ray with it, not leave it on world +x.
    const origin = SE3.rotateLocal(SE3.identity(), AXIS_Z, 37)
    const { at, host } = seat('let A\nlet B\nlet distance(A,B)=0\nlet D\nlet distance(B,D)=500', origin)
    assert.equal(host.unresolved ?? null, null)
    close(at3(at('D')), [500 * Math.cos(37 * DEG), 500 * Math.sin(37 * DEG), 0])
    assert.notDeepEqual(q(at3(at('D'))), [500, 0, 0], 'not the world +x')
})

test('a leaf coincident with its centre at radius 0 lands ON the centre', () => {
    const { host, at } = seat('let A\nlet B\nlet distance(A,B)=100\nlet D\nlet distance(B,D)=0')
    assert.equal(host.unresolved ?? null, null)
    close(at3(at('D')), [50, 0, 0])
})

test('BOTH ends constrained stays unsupported; the accepted prefix is untouched', () => {
    // A and C are each already touched, so there is no isolated leaf. The joining/closing
    // edge must change nothing: two laws, no A-C record, both originals intact, poses held.
    const { host, at, scheduler } = seat('let A\nlet B\nlet C\nlet distance(A,B)=5\nlet distance(B,C)=5\nlet distance(A,C)=5')
    assert.match(host.unresolved?.reason ?? String(host.unresolved), /free-pair initialization/)
    assert.equal(scheduler.laws.active().length, 2, 'exactly the two accepted laws')
    const [A, B, C] = ['A', 'B', 'C'].map((n) => at(n))
    assert.ok(!scheduler.laws.active().some((l) => [...l.endpoints].sort().join() === [A.id, C.id].sort().join()),
        'no A-C law was installed')
    for (const { got, want } of lengthsOf(scheduler, at)) assert.ok(Math.abs(got - want) < 1e-9)
    close(at3(A), [-2.5, 0, 0])
    close(at3(B), [2.5, 0, 0])
    close(at3(C), [-2.5, 0, 0])
})

test('numerical invalidity on the leaf is a typed relation error; the prefix survives', () => {
    const { host, scheduler } = seat('let A\nlet B\nlet distance(A,B)=100\nlet D\nlet distance(B,D)=-1')
    assert.equal(host.error?.kind, 'relation', 'the domain guard names the outcome')
    assert.equal(host.unresolved ?? null, null, 'not a dataflow suspension')
    assert.equal(scheduler.laws.active().length, 1, 'only AB is installed')
})

test('an explicit ceiling is a ceiling: empty and existing-only movers both refuse the leaf', () => {
    // The existing operation scaffold, not new public mover syntax (D058).
    const withCeiling = (movers) => {
        const scheduler = buildWorld({})
        const spec = fork('host', EXACT)
        const law = spec.code.ast.filter((n) => n.type === 'Law' && n.value === 'distance').pop()
        law.meta.movers = movers
        law.meta.reachPolicy = 'balanced'
        const host = scheduler.hotSwapChild('host', spec)
        drive(scheduler, { maxTicks: 120 })
        return { host, scheduler }
    }
    for (const movers of [[], ['B']]) {
        const { host, scheduler } = withCeiling(movers)
        assert.equal(scheduler.laws.active().length, 1, `movers ${JSON.stringify(movers)}: only AB installs`)
        assert.match(host.unresolved?.reason ?? String(host.unresolved), /free-pair initialization/)
    }
})

function lengthsOf(scheduler, at) {
    return scheduler.laws.active().filter((l) => l.feature === 'distance').map((l) => {
        const [a, b] = l.endpoints.map((id) => at3(scheduler.registry.get(id)))
        return { got: Math.hypot(...a.map((v, i) => v - b[i])), want: boundTerm(l)?.radius }
    })
}

test('the isolated leaf takes PRIORITY over a larger producer that would obstruct it', () => {
    // Independently reproduced blocker: A is PINNED, so `anchors.length === 1` dispatched the
    // whole-component meet first and returned "obstructed" before the leaf was ever tried,
    // even though D is isolated, free and movable. The smallest one-point problem must not sit
    // behind an unrelated larger producer's limitation.
    const source = 'let A=(0,0,0)\njmp 100\nlet B\nlet distance(A,B)=100\nlet B.y=0\nlet D\nlet distance(B,D)=500'
    const { host, at, scheduler } = seat(source)
    assert.equal(host.unresolved ?? null, null, 'no obstruction')
    assert.deepEqual(scheduler.laws.active().map((l) => l.feature), ['position', 'distance', 'coordinate', 'distance'])
    close(at3(at('A')), [0, 0, 0])       // pinned prefix untouched
    close(at3(at('B')), [100, 0, 0])     // AB and the coordinate unchanged
    close(at3(at('D')), [600, 0, 0])     // the new BD, placed on the declaring +x
    for (const { got, want } of lengthsOf(scheduler, at)) assert.ok(Math.abs(got - want) < 1e-9)
})
