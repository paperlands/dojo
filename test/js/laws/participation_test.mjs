// A request addresses a subject through a region; addressing is not authority to mutate.
// (id:participation-language)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFrame, isLiveBeing } from '../../../assets/js/turtling/frame.js'
import { isWithinRegion, isSuppliedParticipant, mayAddressParticipant } from '../../../assets/js/turtling/participation.js'

function world() {
    const registry = new Map()
    function seat(name, parent = null) {
        const frame = createFrame(name, null, { parent })
        registry.set(frame.id, frame)
        parent?.children.set(name, frame)
        return frame
    }
    const root = seat('origin')
    const requester = seat('answer', root)
    requester.closed = true
    const inside = seat('inside', requester)
    const outside = seat('outside', root)
    requester.seed = { question: [] }
    return { registry, seat, root, requester, inside, outside }
}

test('the eight scope combinations preserve the existing membrane rule', () => {
    for (const closed of [false, true]) {
        for (const within of [false, true]) {
            for (const supplied of [false, true]) {
                const { requester, inside, outside, registry } = world()
                requester.closed = closed
                const subject = within ? inside : outside
                requester.seed.question = supplied ? [subject] : []
                assert.equal(isWithinRegion(requester, subject), within)
                assert.equal(isSuppliedParticipant(requester, subject, registry), supplied)
                assert.equal(mayAddressParticipant(requester, subject, registry), !closed || within || supplied)
            }
        }
    }
})

test('an open requester may address an outside subject without containing or owning it', () => {
    const { requester, outside, registry } = world()
    requester.closed = false
    assert.equal(isWithinRegion(requester, outside), false)
    assert.equal(isSuppliedParticipant(requester, outside, registry), false)
    assert.equal(mayAddressParticipant(requester, outside, registry), true)
    const readOnlyDomain = isWithinRegion(requester, outside) || isSuppliedParticipant(requester, outside, registry)
    assert.equal(readOnlyDomain, false, 'the read-only method domain has no open-context exemption')
})

test('nested requesters use the enclosing region, not a private inner input list', () => {
    const { requester, inside, outside, seat, registry } = world()
    const inner = seat('inner', requester)
    inner.closed = true
    inner.seed = { question: [outside] }
    assert.equal(isWithinRegion(inner, inside), true)
    assert.equal(isSuppliedParticipant(inner, outside, registry), false, 'a nested answer cannot launder an outside being')
    assert.equal(mayAddressParticipant(inner, outside, registry), false)
    requester.seed.question = [outside]
    assert.equal(isSuppliedParticipant(inner, outside, registry), true)
    assert.equal(mayAddressParticipant(inner, outside, registry), true)
})

test('supplied means exact identity, never a matching name or matching id alone', () => {
    const { requester, outside, seat, root, registry } = world()
    requester.seed.question = [outside]
    const namesake = seat(outside.name, root)
    const impostor = { ...outside }
    assert.equal(isSuppliedParticipant(requester, namesake, registry), false)
    assert.equal(isSuppliedParticipant(requester, impostor, registry), false)
    assert.equal(mayAddressParticipant(requester, namesake, registry), false)
})

test('a superseded question stops supplying its former participant', () => {
    const { requester, outside, registry } = world()
    requester.seed.question = [outside]
    assert.equal(isSuppliedParticipant(requester, outside, registry), true)
    requester.seed = { question: [] }
    assert.equal(isSuppliedParticipant(requester, outside, registry), false)
    assert.equal(mayAddressParticipant(requester, outside, registry), false)
})

test('a retired or replaced region cannot supply an outside participant', () => {
    const { requester, outside, registry } = world()
    requester.seed.question = [outside]
    registry.delete(requester.id)
    assert.equal(isSuppliedParticipant(requester, outside, registry), false)
    assert.equal(mayAddressParticipant(requester, outside, registry), false)
    registry.set(requester.id, { ...requester })
    assert.equal(isSuppliedParticipant(requester, outside, registry), false)
})

test('a subject may still be supplied while retired: its lifetime is a separate question', () => {
    const { requester, outside, registry } = world()
    requester.seed.question = [outside]
    registry.delete(outside.id)
    assert.equal(isSuppliedParticipant(requester, outside, registry), true)
    assert.equal(mayAddressParticipant(requester, outside, registry), true)
    assert.equal(isLiveBeing(outside, registry), false, 'addressability is not publication permission')
})

test('a missing registry cannot certify a supplied participant or a live being', () => {
    const { requester, outside } = world()
    requester.seed.question = [outside]
    for (const registry of [null, undefined]) {
        assert.equal(isSuppliedParticipant(requester, outside, registry), false)
        assert.equal(mayAddressParticipant(requester, outside, registry), false)
        assert.equal(isLiveBeing(outside, registry), false)
    }
})

test('unknown subjects remain scope questions, not an implicit existence check', () => {
    const { requester, registry } = world()
    for (const subject of [null, undefined]) {
        assert.equal(isWithinRegion(requester, subject), false)
        assert.equal(mayAddressParticipant(requester, subject, registry), false)
        requester.closed = false
        assert.equal(mayAddressParticipant(requester, subject, registry), true)
        requester.closed = true
    }
})

test('the region contains itself but supplying a value does not make it a being', () => {
    const { requester, registry } = world()
    assert.equal(isWithinRegion(requester, requester), true)
    for (const value of ['outside', 0, false, [0, 0, 0], null]) {
        requester.seed.question = [value]
        assert.equal(isSuppliedParticipant(requester, value, registry), false)
        assert.equal(isLiveBeing(value, registry), false)
    }
})

test('scope queries do not change inputs or cache a question as authority', () => {
    const { requester, outside, registry } = world()
    const question = Object.freeze([outside])
    requester.seed = Object.freeze({ question })
    Object.freeze(requester)
    Object.freeze(outside)
    const entries = [...registry]
    assert.equal(mayAddressParticipant(requester, outside, registry), true)
    assert.equal(isWithinRegion(requester, outside), false)
    assert.deepEqual([...registry], entries)
    assert.equal(requester.seed.question, question)
    assert.equal(requester._root, null, 'the policy does not populate scheduler caches')
})

test('a live being is the exact registered object, whether running or settled', () => {
    const { outside, registry } = world()
    for (const done of [false, true]) {
        outside.done = done
        assert.equal(isLiveBeing(outside, registry), true)
    }
    assert.equal(isLiveBeing({ ...outside }, registry), false)
    registry.delete(outside.id)
    assert.equal(isLiveBeing(outside, registry), false)
})

test('an installation is not a being even when its object is registered', () => {
    const { outside, registry } = world()
    outside.installation = true
    assert.equal(isLiveBeing(outside, registry), false)
})
