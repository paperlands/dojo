// Point consumers cross the receiver's sampled storage basis once.
// Aliases share the callable contract; untouched pose components remain exact.
// (id:world-coordinate-phase-2)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork } from '../laws/harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'
import { contractOf } from '../../../assets/js/turtling/commands.js'
import { SE3, AXIS_Z, AXIS_Y } from '../../../assets/js/turtling/se3.js'

const TOL = 1e-9
const near = (a, b) => Math.abs(a - b) <= TOL
const near3 = (a, b) => a.length === b.length && a.every((x, i) => near(x, b[i]))
const IDENT = SE3.identity()
const unit = (v) => { const n = Math.hypot(v[0], v[1], v[2]); return [v[0] / n, v[1] / n, v[2] / n] }
const heading = (frame) => frameWorldTransform(frame).rotation.rotateVec(1, 0, 0)

// Receiver basis: translated, yawed, pitched. Its local cursor starts at zero, so its
// world position is BASIS.position.
const BASIS = SE3.rotateLocal(
    SE3.rotateLocal({ rotation: IDENT.rotation, position: [10, 20, 30] }, AXIS_Z, 90), AXIS_Y, 30)
const HOST = SE3.rotateLocal({ rotation: IDENT.rotation, position: [-4, 8, 2] }, AXIS_Z, 40)

// The chosen world-facing convention, computed independently with trig matrices:
// R = Rz(atan2(dy,dx)) . Ry(-atan2(dz,hyp)). This is a COMPLETE rotation — it settles
// roll/up, not only the forward axis.
const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]))
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, -s, 0], [s, c, 0], [0, 0, 1]] }
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]] }
const aimOracle = (dir) => {
    const d = unit(dir)
    return mul(rotZ(Math.atan2(d[1], d[0])), rotY(-Math.atan2(d[2], Math.hypot(d[0], d[1]))))
}
const axisImage = (rot, axis) => rot.rotateVec(axis[0], axis[1], axis[2])
const assertRotation = (got, matrix, label) => {
    for (const [name, axis] of [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]]) {
        const want = matrix.map((row) => row[0] * axis[0] + row[1] * axis[1] + row[2] * axis[2])
        assert.ok(near3(axisImage(got, axis), want), `${label}: ${name}-axis ${axisImage(got, axis)} != ${want}`)
    }
}

const build = ({ source, basis = BASIS, admit, deferStart = false }) => {
    const scheduler = buildWorld({ admit })
    const frame = scheduler.hotSwapChild('aimer', fork('aimer', source, basis), { deferStart })
    return { scheduler, frame }
}
const drive = (scheduler) => {
    for (let i = 0; i < 24 && !scheduler.done; i++) scheduler.tick(i * 1000)
    assert.deepEqual(scheduler.errors, [], `runtime errors: ${scheduler.errors.map((e) => e.message)}`)
}
const run = (opts) => {
    const built = build(opts)
    drive(built.scheduler)
    return built
}

test('world faceto aims at a world point with a complete rotation', () => {
    const target = [40, 20, 35]
    const { frame } = run({ source: `faceto ${target.join(' ')}` })
    const world = frameWorldTransform(frame)
    assertRotation(world.rotation, aimOracle([target[0] - world.position[0], target[1] - world.position[1], target[2] - world.position[2]]), 'faceto')
    assert.ok(near3(world.position, BASIS.position), 'faceto does not move the receiver')
})

test('omitted z completes in world space', () => {
    const target = [40, 20]
    const { frame } = run({ source: `faceto ${target.join(' ')}` })
    const world = frameWorldTransform(frame)
    assertRotation(world.rotation, aimOracle([target[0] - world.position[0], target[1] - world.position[1], 0]), 'faceto omitted z')
    assert.ok(near(world.position[2], BASIS.position[2]), 'the receiver world height is preserved')
})

test('an orientation-only consumer preserves the local position bit-for-bit', () => {
    const setup = 'yaw 37\nfw 5'
    const before = run({ source: setup }).frame
    const after = run({
        source: `${setup}\n${Array.from({ length: 100 }, () => 'faceto 40 20 35').join('\n')}` }).frame
    assert.deepEqual([...after.transform.deref().position], [...before.transform.deref().position],
        '100 faceto commands must not perturb the untouched local position')
    assert.ok(!near(after.transform.deref().rotation.w, before.transform.deref().rotation.w) ||
        !near(after.transform.deref().rotation.z, before.transform.deref().rotation.z), 'but the aim did change')
})

test('a position-only consumer preserves the local rotation', () => {
    const setup = 'yaw 37'
    const before = run({ source: setup }).frame
    const after = run({ source: `${setup}\ngoto 40 20 35` }).frame
    const a = after.transform.deref().rotation, b = before.transform.deref().rotation
    assert.ok(['w', 'x', 'y', 'z'].every((k) => a[k] === b[k]), 'goto must not perturb the untouched local rotation')
    assert.ok(near3(frameWorldTransform(after).position, [40, 20, 35]), 'and it reached the world target')
})

test('coordinate consumers never reinterpret a numeric target through birth axes', () => {
    const target = [40, 20, 35]
    const face = run({ source: `faceto ${target.join(' ')}` }).frame
    const world = frameWorldTransform(face)
    assertRotation(world.rotation, aimOracle(target.map((n, i) => n - world.position[i])), 'faceto')
    const move = run({ source: `goto ${target.join(' ')}` }).frame
    assert.ok(near3(frameWorldTransform(move).position, target))
    assert.ok(!near3(frameWorldTransform(move).position, SE3.apply(BASIS, target)))
})

test('the adapter uses the receiver basis, not the parent placement', () => {
    const target = [7, -3, 9]
    const scheduler = buildWorld({  })
    const host = scheduler.hotSwapChild('host', fork('host', `yaw 40
jmpto 5 6 7
as child do
  faceto ${target.join(' ')}
end`, HOST))
    for (let i = 0; i < 24 && !scheduler.done; i++) scheduler.tick(i * 1000)
    assert.deepEqual(scheduler.errors, [])
    const child = host.children.get('child')
    const world = frameWorldTransform(child)
    assert.ok(!near3(world.position, HOST.position), 'the child basis is not the host placement')
    assertRotation(world.rotation, aimOracle([target[0] - world.position[0], target[1] - world.position[1], target[2] - world.position[2]]), 'nested faceto')
})

test('an accepted world candidate is normalized by admission, and the accepted pose publishes', () => {
    let requested = null
    const admit = (request) => {
        if (request.command !== 'faceto') return { accepted: true, transform: request.requested }
        requested = request.requested
        return { accepted: true, transform: SE3.rotateLocal(request.requested, AXIS_Z, 5) }
    }
    const { frame } = run({ source: 'faceto 40 20 35', admit })
    assert.ok(requested, 'the responder saw the converted local candidate')
    // The requested candidate is local: its rotation composed with the basis aims at the
    // world target.
    const reqWorld = SE3.compose(BASIS, requested)
    const dir = unit([40 - BASIS.position[0], 20 - BASIS.position[1], 35 - BASIS.position[2]])
    assertRotation(reqWorld.rotation, aimOracle(dir), 'candidate')
    // The ACCEPTED (normalized) pose, not the candidate, is what published.
    const stored = frame.transform.deref()
    const normalized = SE3.rotateLocal(requested, AXIS_Z, 5)
    assert.ok(['w', 'x', 'y', 'z'].every((k) => near(stored.rotation[k], normalized.rotation[k])), 'accepted rotation stored')
    assert.ok(!['w', 'x', 'y', 'z'].every((k) => near(stored.rotation[k], requested.rotation[k])), 'the normalization is real')
})

test('a refused world candidate changes nothing', () => {
    const admit = (request) => request.command === 'faceto'
        ? { accepted: false } : { accepted: true, transform: request.requested }
    const { frame } = run({ source: 'faceto 40 20 35', admit })
    const local = frame.transform.deref()
    assert.ok(near3(local.position, [0, 0, 0]), 'the refused command leaves the cursor')
    assert.ok(['w', 'x', 'y', 'z'].every((k) => near(local.rotation[k], IDENT.rotation[k])), 'and the orientation')
    assert.deepEqual(frame.error ?? null, null, 'a refusal is not a wound')
})

test('goto, jmpto and the jumpto alias consume world coordinates', () => {
    const target = [40, 20, 35]
    for (const name of ['goto', 'jmpto', 'jumpto']) {
        const { frame } = run({ source: `${name} ${target.join(' ')}` })
        assert.ok(near3(frameWorldTransform(frame).position, target), `${name} reaches the world target`)
    }
    assert.equal(contractOf('jmpto'), contractOf('jumpto'), 'an alias shares the callable spec')
    assert.deepEqual(contractOf('jumpto').holes, ['target'], 'aliases inherit the one-target contract')
})


test('mutant: losing the conversion fails the world aim', () => {
    const target = [40, 20, 35]
    const { scheduler, frame } = build({ source: `faceto ${target.join(' ')}`, deferStart: true })
    const real = frame.deps.space.sample
    frame.deps.space.sample = () => ({ toWorld: (l) => l, toLocal: (w) => w, toLocalRotation: (r) => r, toLocalPoint: (p) => p })
    try {
        drive(scheduler)
        const world = frameWorldTransform(frame)
        const dir = unit([target[0] - world.position[0], target[1] - world.position[1], target[2] - world.position[2]])
        assert.throws(() => assert.ok(near3(heading(frame), dir), 'world aim survives a lost conversion'), /world aim/)
    } finally { frame.deps.space.sample = real }
})
