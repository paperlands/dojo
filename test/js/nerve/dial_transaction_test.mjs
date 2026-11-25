// The dial's command seam, as a transaction: a refused replay must cost nothing.
// Custody (the one hold) is released only when the world ACCEPTS the restart. The
// fake turtle is the smallest world that can witness a hold: one frame, one slot,
// a compositor that hands out exactly one lease. (id:nav-core-sill)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createDial } from '../../../assets/js/hooks/shell/dial.js'

const SLOT = 'coreshell:seat'

function bench({ reseat, admit = () => true }) {
    const frame = {
        id: 'frame-1', run: 1, logicalBirth: 0, elapsedTime: 3,
        children: new Map(), installations: new Map(), done: false, error: null,
    }
    const children = new Map([[SLOT, frame]])
    const scheduler = {
        root: { children }, end: null, held: false, lastTickTime: 100, done: false,
    }
    // The compositor's own rules: one lease at a time, admitted only by a witness
    // that re-reads the world, and it is the one writer of `scheduler.held`.
    const composition = {
        holdOwner: null,
        hold(token) {
            if (this.holdOwner || typeof token?.witness !== 'function') return false
            if (token.witness() !== true) return false
            this.holdOwner = token
            scheduler.held = true
            return true
        },
        releaseHold(owner) {
            if (owner == null || owner !== this.holdOwner) return false
            this.holdOwner = null
            scheduler.held = false
            return true
        },
    }
    // `beginPlay` — the native replacement edge: it clears the hold itself, BEFORE
    // vocabulary rehearsal and commit. Measured, not assumed (upsertAmbient order).
    const edge = () => { composition.holdOwner = null; scheduler.held = false }
    const turtle = { scheduler, compositor: composition }
    const dial = createDial(turtle, {
        seat: () => ({ slot: SLOT, name: 'seat', code: 'fw 1\nwait 3\nrt 9' }),
        authority: () => true,
        prepareReplay: (play) => admit(play) ? (prepare) => reseat(play, prepare) : null,
        acted: () => {},
    })
    return { frame, children, composition, scheduler, turtle, dial, edge }
}

test('a pause takes the one hold', () => {
    const b = bench({ reseat: () => true })
    const reading = b.dial.read()
    assert.ok(reading, 'the seat has a play to depict')
    assert.equal(reading.pause(), true)
    assert.ok(b.composition.holdOwner, 'the hold is ours')
    assert.equal(b.dial.read().phase, 'paused')
})

test('a refused replay does not cost us the pause', () => {
    const b = bench({ reseat: () => false })   // the world refuses the restart
    b.dial.read().pause()
    const paused = b.dial.read()
    assert.equal(paused.phase, 'paused', 'we are holding it')

    assert.equal(paused.replay(), false, 'the restart was refused')
    assert.ok(b.composition.holdOwner, 'the refused replay released nothing')
    assert.equal(b.dial.read().phase, 'paused', 'the dial still says we hold it')
})

test('an accepted replay hands the pause to the new play', () => {
    let asked = 0
    const b = bench({ reseat: () => { asked++; b.edge(); return true } })
    b.dial.read().pause()
    const before = b.composition.holdOwner
    const held = b.dial.read()
    assert.equal(held.replay(), true)
    assert.equal(asked, 1, 'the recipe was asked exactly once')
    // The edge took the old lease; the hand's pause is passed on, as a NEW receipt.
    assert.notEqual(b.composition.holdOwner, before, 'the old lease died at the edge')
    assert.ok(b.composition.holdOwner, 'the pause survives the restart, on the new play')
    assert.equal(b.dial.read().phase, 'paused')
})

test('a stale grant refuses before reaching the recipe', () => {
    let asked = 0
    const b = bench({ reseat: () => { asked++; return true } })
    b.dial.read().pause()
    const held = b.dial.read()
    b.dial.ended()                     // the grant rotates — and an edge also gives the hold back
    assert.equal(b.composition.holdOwner, null, 'an authority edge ends the pause by design')
    assert.equal(held.replay(), false, 'a stale intent owns no right to the clock')
    assert.equal(asked, 0, 'and it never reached the recipe')
})

test('a preflight refusal costs NOTHING — the captured Resume still owns its lease', () => {
    let asked = 0
    const b = bench({ admit: () => false, reseat: () => { asked++; return true } })
    b.dial.read().pause()
    const paused = b.dial.read()
    const leaseBefore = b.composition.holdOwner

    assert.equal(paused.replay(), false, 'the recipe refused admission')
    assert.equal(asked, 0, 'and the mutation was never attempted')
    assert.equal(b.composition.holdOwner, leaseBefore, 'the very same lease, not a replacement')
    // The killer: an intent painted before the refusal is still live, because
    // nothing was released and nothing was re-taken.
    assert.equal(paused.resume(), true, 'the earlier Resume still owns what it took')
    assert.equal(b.dial.read().phase, 'running')
})

test('a post-admission refusal restores custody, and that is all it can restore', () => {
    const b = bench({ admit: () => true, reseat: () => { b.edge(); return false } })
    b.dial.read().pause()
    const paused = b.dial.read()
    const before = b.composition.holdOwner

    assert.equal(paused.replay(), false)
    assert.ok(b.composition.holdOwner, 'custody is back')
    assert.notEqual(b.composition.holdOwner, before, 'but as a NEW receipt')
    assert.equal(paused.resume(), false, 'so a Resume painted before the refusal is dead')
    assert.equal(b.dial.read().resume(), true, 'only a freshly painted one can release it')
})
