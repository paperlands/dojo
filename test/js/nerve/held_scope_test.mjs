// WHOLE-STAGE HELD, SCOPED BY PLACE. The Outer Helios used to read progress with no
// `held` at all, so an outer pause could never paint the outer sun — and a stage-wide
// flag could paint the wrong one. One query answers both suns. (id:outer-sill)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { heldAt } from '../../../assets/js/weave/page.js'

const outerHold = { held: true, holdOwner: { seat: 'outershell:friend-a' } }
const coreHold = { held: true, holdOwner: { seat: 'coreshell:b1' } }

test('POSITIVE: a scoped outer hold reads held at the outer place', () => {
    assert.equal(heldAt(outerHold, 'outershell'), true)
})

test('NEGATIVE: and NOT held at the core place — the suns cannot borrow each other', () => {
    assert.equal(heldAt(outerHold, 'coreshell'), false)
})

test('the reverse pair holds too', () => {
    assert.equal(heldAt(coreHold, 'coreshell'), true)
    assert.equal(heldAt(coreHold, 'outershell'), false)
})

test('no hold at all is held nowhere', () => {
    assert.equal(heldAt({ held: false, holdOwner: null }, 'coreshell'), false)
    assert.equal(heldAt({ held: false, holdOwner: null }, 'outershell'), false)
    assert.equal(heldAt(null, 'coreshell'), false)
})

test('LEGACY: a flag-only hold has no lease to scope by and stays stage-wide', () => {
    // Documented, not desired: the pre-lease door (compositor.setHeld) cannot name a
    // place. Both suns read it as held rather than guessing a place.
    assert.equal(heldAt({ held: true, holdOwner: null }, 'coreshell'), true)
    assert.equal(heldAt({ held: true, holdOwner: null }, 'outershell'), true)
})
