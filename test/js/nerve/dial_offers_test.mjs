// The dial's doctrine, as a truth table: DEPICTION is the seat's, PERMISSION is
// the grant's and the stage's. This file exists so the next author cannot quietly
// move a world fact in front of what may be SEEN. (id:nav-core-sill)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { offers } from '../../../assets/js/hooks/shell/dial.js'

const base = { authorized: true, alone: true, done: false, blocked: false, held: null }

test('alone, authorised, unheld: the hand is offered the hold', () => {
    assert.deepEqual(offers(base), { hold: true, resume: false, replay: true })
})

test('a shared stage refuses the hand and nothing else', () => {
    const can = offers({ ...base, alone: false })
    assert.equal(can.hold, false, 'the one hold is a world fact')
    assert.equal(can.replay, false, 'a replay would reset a shared clock')
})

test('a revoked grant offers no action — the seat is still depicted elsewhere', () => {
    assert.deepEqual(offers({ ...base, authorized: false }), { hold: false, resume: false, replay: false })
})

test('custody outlives authority: the exact lease may always be given back', () => {
    const lease = 41
    assert.deepEqual(offers({ ...base, authorized: false, held: lease }), { hold: false, resume: true, replay: false })
})

test('a foreign hold blocks taking one, never giving ours back', () => {
    assert.equal(offers({ ...base, blocked: true }).hold, false)
    assert.equal(offers({ ...base, blocked: true }).replay, false)
    assert.equal(offers({ ...base, blocked: true, held: 7 }).resume, true)
})

test('our own hold is not a hold to take', () => {
    const can = offers({ ...base, held: 7 })
    assert.equal(can.hold, false)
    assert.equal(can.resume, true)
})

test('a finished day cannot be paused but can be replayed', () => {
    const can = offers({ ...base, done: true })
    assert.equal(can.hold, false, 'holdPlay refuses a done play')
    assert.equal(can.replay, true, 'the dial\'s finished state IS the replay')
})

test('the vocabulary is exactly three actions', () => {
    assert.deepEqual(Object.keys(offers(base)).sort(), ['hold', 'replay', 'resume'])
})

test('a missing predicate is a refusal, never a permission', () => {
    assert.deepEqual(offers({}), { hold: false, resume: false, replay: false })
})
