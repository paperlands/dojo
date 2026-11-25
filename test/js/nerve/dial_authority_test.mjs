// WHAT MAY COMMAND IS THE INCARNATION THIS SURFACE ADMITTED, NOT THE ADDRESS.
// A claim is not evidence that the draft has seated: in the claim→seat interval a
// PEER occupant may still be running in the same slot. So the dial must hand the
// shell the PLAY — not a slot string — and the shell refuses on identity.
// (id:outer-sill-lifetime)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createDial } from '../../../assets/js/hooks/shell/dial.js'

const SLOT = 'outershell:shown'

function bench(authority) {
    const frame = {
        id: 'peer-incarnation', run: 4, logicalBirth: 0, elapsedTime: 2,
        children: new Map(), installations: new Map(), done: false, error: null,
        seed: { ast: [] }, batch: { breakLine: null },
    }
    const scheduler = { root: { children: new Map([[SLOT, frame]]) }, end: null, held: false, lastTickTime: 50, done: false }
    const composition = {
        holdOwner: null,
        hold(t) { if (this.holdOwner || typeof t?.witness !== 'function' || t.witness() !== true) return false; this.holdOwner = t; scheduler.held = true; return true },
        releaseHold(o) { if (o !== this.holdOwner) return false; this.holdOwner = null; scheduler.held = false; return true },
        get held() { return this.holdOwner != null },
        watchCatch: () => () => {},
    }
    const asked = []
    const dial = createDial({ scheduler, compositor: composition }, {
        seat: () => ({ slot: SLOT }),
        authority: (subject) => { asked.push(subject); return authority(subject) },
        reseat: () => true,
        acted: () => {},
        docOf: () => ({ v: 'doc' }),
    })
    return { frame, scheduler, composition, dial, asked }
}

test('authority is asked with the PLAY, so a shell can refuse on incarnation', () => {
    const b = bench(() => true)
    const reading = b.dial.read()
    assert.ok(reading, 'the seat has a play to depict')
    const subjects = b.asked.filter(Boolean)
    assert.ok(subjects.length > 0, 'authority was asked')
    assert.equal(subjects[0]?.id, 'peer-incarnation', 'it was handed the play, not a slot')
    assert.equal(subjects[0]?.seat, SLOT)
})

test('a peer occupant with no local admission is depicted but cannot command', () => {
    // The shell's rule, as the shell would write it: the grant may name the address,
    // but the occupant is the PEER's incarnation — not one this surface admitted.
    const b = bench((play) => play?.id === 'our-admitted-incarnation')
    const reading = b.dial.read()
    assert.ok(reading, 'watching still depicts the running play')
    assert.deepEqual(reading.can, { hold: false, resume: false, replay: false })

    assert.equal(reading.pause(), false, 'Pause is refused')
    assert.equal(b.composition.holdOwner, null, 'and no lease was taken')
    assert.equal(b.scheduler.held, false, 'and the clock was not held')
    assert.equal(reading.replay(), false, 'Restart is refused')
    assert.equal(b.frame.id, 'peer-incarnation', 'with the original incarnation intact')
})
