// Movement lifecycle witnesses: who may still be carried, what a decline leaves, and what one
// edit may publish. Prerequisites for the open policy rulings, not evidence for any of them.
// (id:laws-free-relations-f4-actor, id:laws-free-relations-contract, id:laws-activation-order)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, worldOf } from './harness.mjs'
import { frameWorldTransform, lawWorld } from '../../../assets/js/turtling/scheduler.js'
import { programFollowing } from '../../../assets/js/turtling/laws/program_following.js'
import { canMove, pinnedLaw } from '../../../assets/js/turtling/laws/candidate.js'

const DRIVER = '  jmp 1\n  wait 1/24\n  rt 30\n  wait 1/24\n  jmp 1\n  wait 1/24'

const chain = (names, tail = '') => [
    names.map((id, i) => `${i === 0 ? '' : 'jmp 5\n'}let ${id}`).join('\n'),
    names.slice(1).map((id, i) => `let distance(${names[i]},${id})=5`).join('\n'),
    tail,
].join('\n')

const dist = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]))

// A monotonic clock: the harness restarts `now`, so a `wait` would never resume.
function run(scheduler, { steps = 60 } = {}) {
    let now = 0
    for (let i = 0; i < steps && !scheduler.done; i++) {
        now += 1000
        scheduler.tick(now)
        scheduler.readouts?.drain?.()
    }
}

const seat = (source) => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild('host', fork('host', source))
    return { scheduler, host }
}

const offeredFor = (frame, position) =>
    ({ kind: 'accept', pose: { ...frame.transform.deref(), position }, component: [] })

const worldOfAll = (host, names) => Object.fromEntries(names.map((id) => [id, worldOf(host.children.get(id))]))

test('a follower that has left the world is not followed, and the offer is untouched', () => {
    const { scheduler, host } = seat(chain(['A', 'B', 'C']))
    run(scheduler, { steps: 6 })
    const [A, B, C] = ['A', 'B', 'C'].map((id) => host.children.get(id))
    const offered = offeredFor(A, [3, 0, 0])
    const pose = offered.pose
    const before = worldOfAll(host, ['A', 'B', 'C'])
    scheduler.registry.delete(C.id)   // the follower is retired; its law still points at it
    assert.equal(programFollowing(offered, A, scheduler.registry, scheduler.laws, lawWorld), null,
        'a retired member is a decline, never a guessed placement')
    assert.strictEqual(offered.pose, pose, 'the offered pose is the same object')
    assert.deepEqual(offered.component, [], 'a decline adds no member')
    assert.deepEqual(worldOfAll(host, ['A', 'B']), { A: before.A, B: before.B }, 'nothing was published')
})

test('a follower that cannot move is not followed: a pinned point is not carried', () => {
    const { scheduler, host } = seat(chain(['A', 'B'],
        'jmp 5\nlet C\nlet distance(A,C)=5\nlet C.position=(5,5,0)'))
    run(scheduler, { steps: 6 })
    const A = host.children.get('A'), C = host.children.get('C')
    const offered = offeredFor(A, [3, 0, 0])
    // The fixture's reason, stated as the policy reads it: a pinned member has its own authority.
    assert.ok(pinnedLaw(scheduler.laws.active(), C.id), 'the fixture really pinned the follower')
    assert.equal(canMove(C, scheduler.laws.active()), false, 'and it is therefore not movable')
    const before = worldOfAll(host, ['A', 'C'])
    assert.equal(programFollowing(offered, A, scheduler.registry, scheduler.laws, lawWorld), null,
        'a pinned follower is not a movable member')
    assert.deepEqual(offered.component, [], 'and the offer is unchanged')
    assert.deepEqual(worldOfAll(host, ['A', 'C']), before, 'and nothing was published')
})

test('each explicitly issued edit advances the revision exactly once', () => {
    // The correlation, not a dedupe: one CALLER edit, one increment. Counting notifications and
    // then de-duplicating revisions proves nothing about how many publications an edit caused.
    const { scheduler, host } = seat(chain(['A', 'B', 'C']))
    run(scheduler, { steps: 6 })
    const A = host.children.get('A')
    const edit = (position, ref = 'world') => {
        const before = scheduler.motionRevision
        const out = scheduler.requestMotion(A, { ...A.transform.deref(), position }, scheduler.motionRevision, ref)
        return { out, delta: scheduler.motionRevision - before }
    }
    const first = edit([3, 0, 0])
    assert.equal(first.out.kind, 'accept', 'the caller edit is accepted')
    assert.equal(first.delta, 1, 'one accepted edit, one publication')
    const second = edit([4, 0, 0])
    assert.equal(second.out.kind, 'accept')
    assert.equal(second.delta, 1, 'and again, exactly once')
    // A stale edit publishes nothing at all: no revision is invented to carry a refusal.
    const before = scheduler.motionRevision
    const stale = scheduler.requestMotion(A, { ...A.transform.deref(), position: [9, 0, 0] },
        before - 1, 'world')
    assert.equal(stale.kind, 'stale', 'an expired offer is refused, not silently applied')
    assert.equal(scheduler.motionRevision - before, 0, 'a refusal is not a publication')
})

test('a joint publication is one complete configuration', () => {
    // The OBSERVATION, with no claim about edit counts: every configuration a watcher can see
    // already holds every bond. Atomic publication is exactly this, and it is not once-per-edit.
    const { scheduler, host } = seat(chain(['A', 'B', 'C'], `wait 1\nas A do\n${DRIVER}\nend\n`))
    const seen = []
    scheduler.onAcceptedChange(() => {
        if (!['A', 'B', 'C'].every((id) => host.children.get(id))) return
        seen.push(worldOfAll(host, ['A', 'B', 'C']))
    })
    run(scheduler)
    assert.ok(seen.length > 0, 'the actor really moved')
    for (const at of seen) {
        assert.deepEqual(Object.keys(at), ['A', 'B', 'C'], 'every member is present in every observation')
        for (const [child, parent] of [['B', 'A'], ['C', 'B']]) {
            assert.ok(Math.abs(dist(at[child], at[parent]) - 5) < 1e-9,
                `${child} holds its bond about ${parent} in every observed configuration`)
        }
    }
})

test('an unchanged request is accepted, and invents no revision', () => {
    // The request is really sent again, and it is really accepted: a settled actor may restate
    // where it already is. (The hand-standard regression makes the same distinction.)
    const { scheduler, host } = seat(chain(['A', 'B']))
    run(scheduler, { steps: 6 })
    const A = host.children.get('A')
    const settledAt = worldOfAll(host, ['A', 'B'])
    const first = scheduler.requestMotion(A, { ...A.transform.deref(), position: [3, 0, 0] },
        scheduler.motionRevision, 'world')
    assert.equal(first.kind, 'accept')
    const accepted = scheduler.motionRevision
    const at = worldOfAll(host, ['A', 'B'])
    const again = scheduler.requestMotion(A, { ...A.transform.deref(), position: [...A.transform.deref().position] },
        scheduler.motionRevision)
    assert.equal(again.kind, 'accept', 'restating the same pose is accepted, not refused')
    assert.equal(scheduler.motionRevision, accepted, 'and it publishes no new revision')
    assert.deepEqual(worldOfAll(host, ['A', 'B']), at, 'and nothing moves')
    assert.notDeepEqual(at, settledAt, 'the fixture really did move once before the restatement')
    assert.ok(Math.abs(dist(at.A, at.B) - 5) < 1e-9, 'the accepted answer still holds its bond')
})
