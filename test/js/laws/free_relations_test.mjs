// F1: source binds and initializes one bodyless pair. (id:laws-free-relations-f1)
import { test } from "node:test"
import assert from "node:assert/strict"
import { parseProgram, collectErrors } from "../../../assets/js/turtling/parse.js"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { freePoint } from "../../../assets/js/turtling/laws/batch.js"
import { AUTHORED, boundTerm, makeDistanceTerm } from "../../../assets/js/turtling/laws/authored.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { realizeFreeDistance, validateDistance } from "../../../assets/js/turtling/laws/realize.js"
import { bindLaw, addressOf, createLawStore } from "../../../assets/js/turtling/laws/replacement.js"
import { heldIdentity } from "../../../assets/js/turtling/laws/constraints.js"
import { buildWorld, fork, drive, nz } from "./harness.mjs"

const position = f => nz(frameWorldTransform(f).position)
const close = (actual, expected) => actual.forEach((x, i) =>
    assert.ok(Math.abs(x - expected[i]) < 1e-9, `${actual} != ${expected}`))
const run = (source, options = {}, origin = SE3.identity()) => {
    const scheduler = buildWorld(options)
    const host = scheduler.hotSwapChild("host", fork("host", source, origin))
    const trace = drive(scheduler)
    return { scheduler, host, trace, A: host.children.get("A"), B: host.children.get("B") }
}
const clean = ({ scheduler, host }) => {
    assert.equal(host.error, null)
    assert.equal(host.unresolved, null)
    assert.deepEqual(scheduler.errors, [])
}

test('F1: pure balanced initializer handles directions, coincidence and invalid seeds', () => {
    for (const [a, b, radius, tie] of [
        [[0, 0, 0], [10, 0, 0], 5, [1, 0, 0]],
        [[0, 0, 0], [0, 10, 0], 5, [1, 0, 0]],
        [[4, 6, 8], [4, 6, 8], 5, [0, 0, 1]],
        [[-1e308, 0, 0], [1e308, 0, 0], 10, [1, 0, 0]],
    ]) {
        const answer = realizeFreeDistance(a, b, radius, tie)
        assert.equal(answer.ok, true)
        const [left, right] = answer.positions
        assert.ok(validateDistance(left, right, radius).ok)
        close(left.map((x, i) => x / 2 + right[i] / 2), a.map((x, i) => x / 2 + b[i] / 2))
    }
    assert.equal(realizeFreeDistance([0, 0, 0], [NaN, 0, 0], 5, [1, 0, 0]).ok, false)
    assert.equal(realizeFreeDistance([0, 0, 0], [0, 0, 0], 5, null).ok, false)
})

test('F1 audit: original expression, not a lowered coefficient, governs the distance check', () => {
    const expression = { type: 'distance', references: [1, 2], radius: 5, source: '5' }
    const law = bindLaw({ feature: 'distance', endpoints: [1, 2], scope: 3, frame: 3, predicate: 5, expression })
    const lowered = { ...law, predicate: 500 }
    assert.equal(AUTHORED.distance.measure(lowered, { worldOf: id => [id === 1 ? 0 : 5, 0, 0] }).status, 'valid')
    assert.equal(AUTHORED.distance.measure(lowered, { worldOf: id => [id === 1 ? 0 : 500, 0, 0] }).status, 'violation')
    expression.radius = 500
    expression.references[1] = 999
    assert.equal(law.expression.radius, 5, 'binding owns its sampled term, not the caller object')
    assert.deepEqual(law.expression.references, [1, 2])
})

test('F1 audit: unknown original expression cannot borrow a recognized lowered predicate', () => {
    const law = bindLaw({ feature: 'distance', endpoints: [1, 2], scope: 3, frame: 3, predicate: 5,
        expression: { type: 'unknown', references: [1, 2], radius: 5 } })
    assert.equal(AUTHORED.distance.measure(law, { worldOf: id => [id === 1 ? 0 : 5, 0, 0] }).status, 'cannot-measure')
})

test('F1 audit: coincidence between distinct identities is a real constraint, not a tautology', () => {
    const result = run('let A\nlet B\nlet distance(A,B)=0')
    clean(result)
    assert.equal(AUTHORED.distance.staticVerdict(result.scheduler.laws.active()[0]), null)
    const before = position(result.A)
    const response = result.scheduler.requestMotion(result.A, { rotation: SE3.identity().rotation, position: [10, 0, 0] }, result.scheduler.motionRevision, 'world')
    assert.equal(response.kind, 'accept')
    assert.deepEqual(position(result.A), before, 'the unchanged-partner control still enforces coincidence')
})

test('F1 audit: tiny positive self-distance is an exact contradiction, not a tolerance pass', () => {
    const result = run('let A\nlet distance(A,A)=0.0000001')
    assert.equal(result.host.error?.kind, 'contradiction')
    assert.equal(result.scheduler.laws.count(), 0)
})

test('F1 audit: identity contradiction is known before coupled-method availability', () => {
    const result = run('let A\nlet B\nlet distance(A,B)=5\nlet distance(A,A)=5')
    assert.equal(result.host.error?.kind, 'contradiction')
    assert.equal(result.scheduler.laws.count(), 1)
    close(position(result.A), [-2.5, 0, 0])
    close(position(result.B), [2.5, 0, 0])
})

test('F1 audit: a tautology remains owned without blocking an isolated geometric solve', () => {
    const result = run('let A\nlet B\nlet distance(A,A)=0\nlet distance(A,B)=5')
    clean(result)
    assert.equal(result.scheduler.laws.count(), 2)
    close(position(result.A), [-2.5, 0, 0])
    close(position(result.B), [2.5, 0, 0])
    assert.deepEqual(result.scheduler.laws.active().map(l => l.owner.line).sort(), [3, 4])
})

test('F1: singular tie uses metric-frame +x oriented by identity, not argument order', () => {
    const ab = run('let A\nlet B\nlet distance(A,B)=5')
    const ba = run('let A\nlet B\nlet distance(B,A)=5')
    clean(ab); clean(ba)
    assert.deepEqual(position(ab.A), position(ba.A))
    assert.deepEqual(position(ab.B), position(ba.B))
})

for (const source of [
    "let distance(A, B) = 5", "let distance(A,B)=5",
    'let distance ("A", "B") = 2 + 3',
]) test(`F1: bounded pair head parses: ${source}`, () => {
    const [node] = parseProgram(source)
    assert.deepEqual(collectErrors([node]), [])
    assert.equal(node.type, "Law")
    assert.equal(node.value, "distance")
    assert.equal(node.meta.subjects.length, 2)
    assert.equal(node.span.line, 1)
})

for (const source of [
    "let distance(A) = 5", "let distance(A, B, C) = 5", "let distance(A, B)",
    "let distance(A.position, B) = 5", "let distance(A+1, B) = 5",
    "let distance(A, B) =", "let distance(A, B = 5", "let angle(A,B) = 5",
]) test(`F1: malformed relation remains a located refusal: ${source}`, () => {
    const nodes = parseProgram(`${source}\nlet healthy=7`)
    assert.equal(nodes[0].type, "Error")
    assert.equal(nodes[0].span.line, 1)
    assert.equal(nodes[1].type, "Declaration")
})

test("F1: ordinary BA stays a numeric name", () => {
    const result = run("let A\nlet B\nlet BA=5")
    clean(result)
    assert.equal(result.scheduler.laws.count(), 0)
    assert.ok(freePoint(result.A) && freePoint(result.B))
})

for (const capacity of [1, 64]) test(`F1: coincident free pair initializes, no actor or ink (capacity ${capacity})`, () => {
    const result = run("let A\nlet B\nlet distance(A,B)=5", { capacity })
    clean(result)
    const { scheduler, host, A, B } = result
    assert.deepEqual([...host.children.keys()], ["A", "B"])
    assert.ok(freePoint(A) && freePoint(B))
    close(position(A), [-2.5, 0, 0])
    close(position(B), [2.5, 0, 0])
    const [law] = scheduler.laws.active()
    assert.deepEqual(law.endpoints, [A.id, B.id])
    assert.equal(law.scope, host.id)
    assert.equal(law.frame, host.id)
    assert.equal(law.predicate, 5)
    assert.equal(law.owner.line, 3)
    assert.deepEqual(law.expression, {
        type: "distance", references: [A.id, B.id], radius: 5, source: "5",
    })
    assert.equal(A.actorState, null)
    assert.equal(B.actorState, null)
    assert.equal([...result.trace.values()].flat().filter(e => e.type === 'path').length, 0)
})

test("F1: midpoint initialization uses birth seeds, not a declaring cursor anchor", () => {
    const result = run("let A\njmp 10\nlet B\njmp 20\nlet distance(A,B)=5")
    clean(result)
    close(position(result.A), [2.5, 0, 0])
    close(position(result.B), [7.5, 0, 0])
    assert.deepEqual(position(result.host), [30, 0, 0], 'initialization never corrects the declaring cursor')
})

test("F1: source reversal revises one address and preserves ids", () => {
    const result = run("let A\nlet B\nlet distance(A,B)=5\nlet distance(B,A)=10")
    clean(result)
    const [law] = result.scheduler.laws.active()
    assert.equal(result.scheduler.laws.count(), 1)
    assert.equal(law.predicate, 10)
    assert.equal(law.owner.line, 4)
    close(position(result.A), [-5, 0, 0])
    close(position(result.B), [5, 0, 0])
    assert.deepEqual(new Set(law.endpoints), new Set([result.A.id, result.B.id]))
})

test("F1: lawful birth seeds retain their exact accepted poses", () => {
    const result = run("let A\njmp 5\nlet B\nlet distance(B,A)=5")
    clean(result)
    assert.deepEqual(position(result.A), [0, 0, 0])
    assert.deepEqual(position(result.B), [5, 0, 0])
})

test("F1: zero radius joins positions, not identities", () => {
    const result = run("let A\njmp 10\nlet B\nlet distance(A,B)=0")
    clean(result)
    assert.notEqual(result.A.id, result.B.id)
    close(position(result.A), [5, 0, 0])
    close(position(result.B), [5, 0, 0])
})

test("F1: self-distance zero installs a tautology without duplicate publication targets", () => {
    const result = run("let A\nlet distance(A,A)=0")
    clean(result)
    assert.equal(result.scheduler.laws.count(), 1)
    assert.deepEqual(result.scheduler.laws.active()[0].endpoints, [result.A.id, result.A.id])
    assert.deepEqual(position(result.A), [0, 0, 0])
})

test("F1: positive self-distance has a contradiction witness, not an assignment-cycle error", () => {
    const result = run("let A\nlet distance(A,A)=5")
    assert.equal(result.host.error?.kind, "contradiction")
    assert.equal(result.scheduler.laws.count(), 0)
    assert.deepEqual(position(result.A), [0, 0, 0])
})

for (const rhs of ["-5", "1/0", "0/0", "[5,0,0]"]) test(`F1: invalid radius installs nothing: ${rhs}`, () => {
    const result = run(`let A\nlet B\nlet distance(A,B)=${rhs}`)
    assert.ok(result.host.error || result.host.unresolved)
    assert.equal(result.scheduler.laws.count(), 0)
    assert.deepEqual(position(result.A), [0, 0, 0])
    assert.deepEqual(position(result.B), [0, 0, 0])
})

test("F1: invalid revision retains accepted geometry and preceding owner", () => {
    const result = run("let A\nlet B\nlet distance(A,B)=5\nlet distance(A,B)=-1")
    assert.ok(result.host.error)
    const [law] = result.scheduler.laws.active()
    assert.equal(law.owner.line, 3)
    assert.equal(law.predicate, 5)
    close(position(result.A), [-2.5, 0, 0])
    close(position(result.B), [2.5, 0, 0])
})

for (const subject of ["missing", "radius"]) test(`F1: unresolved/wrong-kind subject creates no implicit point: ${subject}`, () => {
    const result = run(`let A\nlet radius=2\nlet distance(A,${subject})=5`)
    assert.ok(result.host.error || result.host.unresolved)
    assert.deepEqual([...result.host.children.keys()], ["A"])
    assert.equal(result.scheduler.laws.count(), 0)
})

test("F1: local future introduction shadows an outer participant", () => {
    const result = run("let A\nlet B\nas inner do\n let distance(A,B)=5\n let A\n let B\nend")
    assert.match(result.host.children.get("inner").error?.message ?? "", /before introduction/)
    assert.equal(result.scheduler.laws.count(), 0)
    assert.deepEqual(position(result.A), [0, 0, 0])
})

test("F1: quoted names and lexical selector forwarding reach the same pair", () => {
    const result = run('let left-tip\nlet right-tip\ndef gap left right r do\n let distance(left,right)=r\nend\ndef relay x y do\n gap x y 5\nend\nrelay "left-tip" "right-tip"')
    clean(result)
    const left = result.host.children.get("left-tip"), right = result.host.children.get("right-tip")
    assert.ok(freePoint(left) && freePoint(right))
    assert.deepEqual(result.scheduler.laws.active()[0].endpoints, [left.id, right.id])
    close(position(left), [-2.5, 0, 0])
    close(position(right), [2.5, 0, 0])
})

test("F1: a closed constructor cannot use an outside endpoint", () => {
    const result = run('let outside\ndef unit do\n let A\n let distance(A,outside)=5\nend\nlet F=unit')
    const F = result.host.children.get("F")
    assert.ok(F.error || F.unresolved)
    assert.equal(result.scheduler.laws.count(), 0)
    assert.deepEqual(position(result.host.children.get("outside")), [0, 0, 0])
})

test("F1: attaching a body is not an implicit free-pair initializer", () => {
    const result = run("let A\nlet B\nas A do\nend\nlet distance(A,B)=5")
    assert.ok(result.host.error || result.host.unresolved)
    assert.equal(result.scheduler.laws.count(), 0)
    assert.deepEqual(position(result.B), [0, 0, 0])
})

test("F1: a coupled search remains unresolved; preceding law and poses survive", () => {
    const result = run("let A\nlet B\nlet C\nlet distance(A,B)=5\nlet distance(B,C)=10")
    assert.ok(result.host.unresolved)
    assert.equal(result.scheduler.laws.count(), 1)
    close(position(result.A), [-2.5, 0, 0])
    close(position(result.B), [2.5, 0, 0])
    assert.deepEqual(position(result.host.children.get("C")), [0, 0, 0])
})

test("F1: a current lawful mixed configuration needs no pair search", () => {
    const result = run("let A=(0,0,0)\nlet B=(5,0,0)\nlet distance(A,B)=5")
    clean(result)
    assert.equal(result.scheduler.laws.count(), 3)
    assert.deepEqual(position(result.A), [0, 0, 0])
    assert.deepEqual(position(result.B), [5, 0, 0])
})

test("F1: committed readouts observe both endpoints and the installed law in a placed frame", () => {
    for (const origin of [SE3.identity(),
        { position: [20, 30, 0], rotation: SE3.rotateLocal(SE3.identity(), { x: 0, y: 0, z: 1 }, 90).rotation },
        { position: [20, -30, 40], rotation: SE3.rotateLocal(SE3.identity(), { x: 0, y: 1, z: 0 }, 60).rotation },
    ]) {
        const scheduler = buildWorld()
        const samples = []
        const host = scheduler.hotSwapChild("host", fork("host", "let A\nlet B\nwait 1\nlet distance(A,B)=5", origin))
        drive(scheduler, { maxTicks: 1 })
        const A = host.children.get("A"), B = host.children.get("B")
        assert.ok(A && B)
        const changes = []
        const observer = scheduler.readouts.register(host.id, "pair-observer", snapshot => {
            const a = snapshot.world(A), b = snapshot.world(B)
            samples.push({ a, b, radius: scheduler.laws.active()[0]?.predicate, revision: scheduler.motionRevision })
            return [...a, ...b]
        })
        scheduler.readouts.watch(event => { if (event.id === observer) changes.push(event) })
        drive(scheduler)
        assert.equal(host.error, null)
        const installed = samples.filter(s => s.radius === 5)
        assert.ok(installed.length > 0, "a real consumer ran for the joint law/geometry commit")
        assert.equal(new Set(installed.map(s => s.revision)).size, 1)
        assert.equal(changes.length, 1, "one coherent change notification, despite later unchanged recomputation")
        for (const s of installed) assert.ok(Math.abs(Math.hypot(...s.a.map((x, i) => x - s.b[i])) - 5) < 1e-9)
        const axis = origin.rotation.rotateVec(1, 0, 0)
        close(position(A), origin.position.map((x, i) => x - 2.5 * axis[i]))
        close(position(B), origin.position.map((x, i) => x + 2.5 * axis[i]))
        const tangent = origin.rotation.rotateVec(0, 1, 0)
        const target = position(B).map((x, i) => x + 5 * tangent[i])
        const revision = scheduler.motionRevision
        assert.equal(scheduler.requestMotion(A, { rotation: frameWorldTransform(A).rotation, position: target }, revision, 'world').kind, 'accept')
        close(position(A), target)
        assert.equal(scheduler.motionRevision, revision + 1)
        assert.equal(changes.length, 2, 'stated origin placement reaches the same accepted-snapshot consumer')
        const latest = samples.at(-1)
        close(latest.a, target)
        assert.equal(latest.radius, 5)
        const before = samples.length
        scheduler.removeChild("host")
        assert.equal(scheduler.laws.count(), 0)
        assert.equal(scheduler.readouts.size, 0)
        assert.equal(samples.length, before)
    }
})
test('F1: reached radius stays sampled; a later scalar change is not a live law revision', () => {
    const result = run('let radius=5\nlet A\nlet B\nlet distance(A,B)=radius\nlet radius=10')
    clean(result)
    assert.equal(result.scheduler.laws.active()[0].expression.radius, 5)
    close(position(result.A), [-2.5, 0, 0])
    close(position(result.B), [2.5, 0, 0])
})

test('F1: independent private instances bind separate laws and bodyless points', () => {
    const result = run('def unit r do\n let A\n let B\n let distance(A,B)=r\nend\nlet left=unit 5\nlet right=unit 7')
    clean(result)
    const left = result.host.children.get('left'), right = result.host.children.get('right')
    assert.equal(result.scheduler.laws.count(), 2)
    assert.notEqual(left.children.get('A').id, right.children.get('A').id)
    close(position(left.children.get('A')), [-2.5, 0, 0])
    close(position(right.children.get('A')), [-3.5, 0, 0])
    assert.ok(freePoint(left.children.get('B')) && freePoint(right.children.get('B')))
})

test('F1: removing one owning scope preserves the independent survivor', () => {
    const scheduler = buildWorld()
    const left = scheduler.hotSwapChild('left', fork('left', 'let A\nlet B\nlet distance(A,B)=5'))
    const right = scheduler.hotSwapChild('right', fork('right', 'let A\nlet B\nlet distance(A,B)=7'))
    drive(scheduler)
    const before = position(right.children.get('B'))
    scheduler.removeChild('left')
    assert.equal(scheduler.laws.count(), 1)
    assert.equal(scheduler.registry.has(left.id), false)
    assert.deepEqual(position(right.children.get('B')), before)
})

test('F1: replacing a source region retires its old identities and bindings', () => {
    const result = run('let A\nlet B\nlet distance(A,B)=5')
    const ids = [result.A.id, result.B.id]
    const host = result.scheduler.hotSwapChild('host', fork('host', 'let A\nlet B\nlet distance(A,B)=10'))
    drive(result.scheduler)
    assert.equal(host.error, null)
    const fresh = [host.children.get('A').id, host.children.get('B').id]
    assert.notEqual(host.id, result.host.id)
    for (const id of ids) assert.equal(result.scheduler.registry.has(id), false)
    assert.deepEqual(result.scheduler.laws.active()[0].endpoints, fresh)
    assert.equal(result.scheduler.laws.active()[0].predicate, 10)
    result.scheduler.hotSwapChild('host', fork('host', 'let A'))
    drive(result.scheduler)
    assert.equal(result.scheduler.laws.count(), 0)
    for (const id of fresh) assert.equal(result.scheduler.registry.has(id), false)
    const latest = result.scheduler.hotSwapChild('host', fork('host', 'let A\nlet B\nlet distance(A,B)=5'))
    drive(result.scheduler)
    assert.deepEqual(result.scheduler.laws.active()[0].endpoints, [latest.children.get('A').id, latest.children.get('B').id])
})

test('F1: a pair producer cannot move a disconnected member', () => {
    const original = AUTHORED.distance.propose
    AUTHORED.distance.propose = spec => {
        const proposed = original(spec)
        if (proposed.worlds) proposed.worlds.set(spec.observer.children.get('D').id, [999, 0, 0])
        return proposed
    }
    try {
        const result = run('let A\nlet B\nlet D\nlet distance(A,B)=5')
        assert.ok(result.host.error)
        assert.equal(result.scheduler.laws.count(), 0)
        assert.deepEqual(position(result.A), [0, 0, 0])
        assert.deepEqual(position(result.host.children.get('D')), [0, 0, 0])
    } finally { AUTHORED.distance.propose = original }
})


test("F1: poisoned pair proposal never installs geometry or ownership", () => {
    const original = AUTHORED.distance.propose
    const validate = AUTHORED.distance.validate
    AUTHORED.distance.validate = () => ({ ok: true })
    AUTHORED.distance.propose = spec => {
        const proposed = original(spec)
        if (proposed.worlds) proposed.worlds.set(spec.participants[1].id, [999, 0, 0])
        return proposed
    }
    try {
        const result = run("let A\nlet B\nlet distance(A,B)=5")
        assert.ok(result.host.error || result.host.unresolved)
        assert.equal(result.scheduler.laws.count(), 0)
        assert.deepEqual(position(result.A), [0, 0, 0])
        assert.deepEqual(position(result.B), [0, 0, 0])
    } finally { AUTHORED.distance.propose = original; AUTHORED.distance.validate = validate }
})

// Step 1 witnesses — one truth, two explicit questions. (id:laws-distance-term-normalization, D058)
test('S1 witness: pair and dotted spellings bind one typed term and one address', () => {
    const pair = bindLaw({ feature: 'distance', endpoints: ['A', 'B'], scope: 'S', frame: 'S', predicate: 5,
        expression: makeDistanceTerm(['A', 'B'], 5, '5') })
    const dotted = bindLaw({ feature: 'distance', endpoints: ['A', 'B'], scope: 'S', frame: 'S', predicate: 5,
        expression: makeDistanceTerm(['A', 'B'], 5, 'neighbour x') })
    assert.equal(addressOf(pair), addressOf(dotted), 'RHS text is provenance, never address')
    assert.equal(boundTerm(pair).radius, 5)
    assert.equal(boundTerm(dotted).radius, 5)
    assert.deepEqual(boundTerm(dotted).references, ['A', 'B'])
})

test('S1 witness: one bound term, two explicit contexts, two disclosed poses', () => {
    const law = bindLaw({ feature: 'distance', endpoints: ['A', 'B'], scope: 'S', frame: 'S', predicate: 5,
        expression: makeDistanceTerm(['A', 'B'], 5, '5') })
    const A = { id: 'A' }, B = { id: 'B' }
    const at0 = () => [0, 0, 0]
    const balanced = AUTHORED.distance.propose({ law, reachPolicy: 'balanced',
        participants: [A, B], worldOf: at0, tie: [1, 0, 0] })
    assert.deepEqual(balanced.worlds.get('A'), [-2.5, 0, 0])
    assert.deepEqual(balanced.worlds.get('B'), [2.5, 0, 0])
    const targetOnly = AUTHORED.distance.propose({ law, reachPolicy: 'target-only',
        target: A, observer: B, worldOf: at0, pinWorld: () => null })
    assert.deepEqual(targetOnly.world, [5, 0, 0])
    const again = AUTHORED.distance.propose({ law, reachPolicy: 'target-only',
        target: A, observer: B, worldOf: at0, pinWorld: () => null })
    assert.deepEqual(again.world, targetOnly.world, 'same term + same context => same proposal')
})

test('S1 witness: every view honors the original term under a poisoned predicate', () => {
    const law = bindLaw({ feature: 'distance', endpoints: ['A', 'B'], scope: 'S', frame: 'S', predicate: 5,
        expression: makeDistanceTerm(['A', 'B'], 5, '5') })
    const poisoned = { ...law, predicate: 500 }
    const worldOf = (id) => [id === 'A' ? 0 : 5, 0, 0]
    assert.equal(AUTHORED.distance.measure(poisoned, { worldOf }).status, 'valid', 'measure reads length 5')
    assert.equal(AUTHORED.distance.set(poisoned, { worldOf, writerId: 'A' }).radius, 5)
    const c = AUTHORED.distance.constraint(poisoned, { worldOf, heldOf: () => false, writerId: 'A' })
    assert.equal(c.set.radius, 5, "the record carries its resolved set")
    assert.equal(c.otherHeld, false, "and its policy fact, separately")
    const p = AUTHORED.distance.propose({ law: poisoned, reachPolicy: 'target-only',
        target: { id: 'A' }, observer: { id: 'B' }, worldOf: () => [0, 0, 0], pinWorld: () => null })
    assert.deepEqual(p.world, [5, 0, 0], 'a poisoned coefficient never becomes a length-500 locus')
})

test('S1 witness: source pair and dotted reaches bind the same geometric predicate', () => {
    const pair = run('let A\nlet B\nlet distance(A,B)=5')
    const dotted = run('let A\nlet B\nas B do\n  let A.distance=5\nend')
    clean(pair); clean(dotted)
    const p = pair.scheduler.laws.active().find((l) => l.feature === 'distance')
    const d = dotted.scheduler.laws.active().find((l) => l.feature === 'distance')
    assert.equal(p.expression.type, 'distance')
    assert.equal(d.expression.type, 'distance')
    assert.equal(p.expression.radius, 5)
    assert.equal(d.expression.radius, 5)
    // The dotted reach holds the observer only for its proposal: no pin is installed.
    assert.equal(dotted.scheduler.laws.active().filter((l) => l.feature === 'position').length, 0)
    close(position(dotted.A), [5, 0, 0])
    close(position(dotted.B), [0, 0, 0])
})

// Step 1 hardening witnesses — each counterexample the review raised. (id:laws-distance-term-normalization)
test('S1 hardening: a self-zero tautology invents no hold', () => {
    const A = { id: 1 }, B = { id: 2 }
    const registry = { get: (id) => (id === 1 ? A : id === 2 ? B : null) }
    const selfZero = bindLaw({ feature: 'distance', endpoints: [1, 1], scope: 0, frame: 0, predicate: 0 })
    const twoFree = bindLaw({ feature: 'distance', endpoints: [1, 2], scope: 0, frame: 0, predicate: 0 })
    const pinB = bindLaw({ feature: 'position', endpoints: [2], scope: 0, frame: 0, predicate: [0, 0, 0] })
    assert.equal(heldIdentity(A, [selfZero], registry), false, 'self-zero is a tautology, not a hold')
    assert.equal(heldIdentity(A, [twoFree], registry), false, 'two free coincident identities are not held')
    assert.equal(heldIdentity(A, [twoFree, pinB], registry), true, 'coincidence with a genuinely held partner is held')
})

test('S1 hardening: proposal positions resolve from the bound references, not the context', () => {
    const law = bindLaw({ feature: 'distance', endpoints: ['A', 'B'], scope: 'S', frame: 'S', predicate: 5,
        expression: makeDistanceTerm(['A', 'B'], 5, '5') })
    const at = { A: [0, 0, 0], B: [10, 0, 0], C: [100, 0, 0], D: [200, 0, 0] }
    const planned = AUTHORED.distance.propose({ law, reachPolicy: 'balanced',
        participants: [{ id: 'C' }, { id: 'D' }], worldOf: (id) => at[id], tie: [1, 0, 0] })
    assert.deepEqual([...planned.worlds.keys()].sort(), ['A', 'B'], 'a contradictory role cannot move a third identity')
    assert.equal(AUTHORED.distance.propose({ law, reachPolicy: 'typo', worldOf: (id) => at[id] }).kind, 'relation',
        'an unknown mode is refused, never a silent target-only')
})

test('S1 hardening: bound references are frozen, so incidence cannot diverge', () => {
    const law = bindLaw({ feature: 'distance', endpoints: ['A', 'B'], scope: 'S', frame: 'S', predicate: 5 })
    assert.throws(() => { law.endpoints[0] = 'C' })
    assert.deepEqual(law.endpoints, ['A', 'B'])
    const store = createLawStore()
    store.apply(law)
    assert.throws(() => { store.active()[0].endpoints[0] = 'C' })
})

test('S1 hardening: malformed references refuse, never masquerade as a contradiction', () => {
    const malformed = bindLaw({ feature: 'distance', endpoints: ['A', 'B'], scope: 'S', frame: 'S', predicate: 5,
        expression: { type: 'distance', references: [undefined, undefined], radius: 5 } })
    assert.equal(AUTHORED.distance.staticVerdict(malformed), null, 'not a self-distance')
    assert.equal(AUTHORED.distance.measure(malformed, { worldOf: () => [0, 0, 0] }).status, 'cannot-measure')
    assert.doesNotThrow(() => bindLaw({ feature: 'distance', endpoints: ['A', 'B'], scope: 'S', frame: 'S', predicate: 5,
        expression: { type: 'distance', references: { 0: 'A', 1: 'B' }, radius: 5 } }))
})

test('S1 witness: the reach hold is transient; a later hand follows the same distance', () => {
    const result = run('let A\nlet B\nas B do\n  let A.distance=5\nend')
    clean(result)
    assert.equal(result.scheduler.laws.active().filter((l) => l.feature === 'position').length, 0,
        'the reach installed no lasting pin; holding was transient')
    const before = position(result.B)
    const r = result.scheduler.requestMotion(result.A,
        { rotation: frameWorldTransform(result.A).rotation, position: [10, 0, 0] },
        result.scheduler.motionRevision, 'world')
    assert.equal(r.kind, 'accept')
    close(position(result.A), [5, 0, 0], 'the hand projected A onto the same undirected distance')
    assert.deepEqual(position(result.B), before, 'the reach does not permanently pin the observer')
    assert.ok(Math.abs(Math.hypot(...position(result.A).map((x, i) => x - position(result.B)[i])) - 5) < 1e-9)
})

// Authority witnesses — a framed view follows the term, never a legacy field.
test('authority: a framed measurement follows the term, not a poisoned legacy predicate', () => {
    const IDENT = { position: [0, 0, 0], rotation: { x: 0, y: 0, z: 0, w: 1 } }
    const at = [Math.sin(2 * Math.PI / 3), Math.cos(2 * Math.PI / 3), 0]
    const ctx = { placementOf: () => IDENT, worldOf: () => at }
    const law = bindLaw({ feature: 'bearing', endpoints: ['P'], scope: 'F', frame: 'F', predicate: 30,
        expression: { type: 'bearing', references: ['P'], frame: 'F', value: 30 } })
    const poisoned = { ...law, predicate: 999 }
    assert.equal(AUTHORED.bearing.measure(law, ctx).status, 'valid')
    assert.equal(AUTHORED.bearing.measure(poisoned, ctx).status, 'valid', 'the poisoned predicate is not the reading')
    assert.ok(Math.abs(AUTHORED.bearing.read(poisoned, at, ctx) - 30) < 1e-9, 'read follows the term')
    assert.deepEqual(AUTHORED.bearing.set(poisoned, ctx).dir, AUTHORED.bearing.set(law, ctx).dir, 'set follows the term')
    assert.deepEqual(AUTHORED.bearing.constraint(poisoned, ctx), AUTHORED.bearing.constraint(law, ctx))
})

test('authority: a positional payload is copied and frozen at binding', () => {
    const value = [1, 2, 3]
    const law = bindLaw({ feature: 'position', endpoints: ['P'], scope: 'F', frame: 'F', predicate: value })
    value[0] = 99
    assert.deepEqual(boundTerm(law).value, [1, 2, 3], 'the caller mutation does not reach the term')
    assert.deepEqual(law.predicate, [1, 2, 3], 'nor the compatibility field')
    assert.throws(() => { boundTerm(law).value[0] = 7 }, 'the term value is frozen')
})
