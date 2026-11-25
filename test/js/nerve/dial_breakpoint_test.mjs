// A BREAKPOINT IS A SOURCE SITE, NOT A ROW. The first cut is ephemeral: the line the
// hand chose lives in one document, and an edit retires it rather than re-targeting
// it at whatever now occupies the same number. No AST ids, no row hashes, no carry.
// (id:nav-core-sill)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createDial } from '../../../assets/js/hooks/shell/dial.js'

const SLOT = 'coreshell:seat'
const LINE = 3

function bench() {
    const frame = {
        id: 'frame-1', run: 1, logicalBirth: 0, elapsedTime: 3,
        children: new Map(), installations: new Map(), done: false, error: null,
        seed: { ast: [{ type: 'Command', span: { line: LINE } }] },
        batch: { breakLine: null },
    }
    const scheduler = {
        root: { children: new Map([[SLOT, frame]]) },
        end: null, held: false, lastTickTime: 100, done: false,
    }
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
        get held() { return this.holdOwner != null },
        watchCatch: () => () => {},
        verifyHold: () => true,
    }
    let doc = { v: 'A' }
    const dial = createDial({ scheduler, compositor: composition }, {
        seat: () => ({ slot: SLOT, name: 'seat', code: 'fw 1' }),
        authority: () => true,
        reseat: () => true,
        acted: () => {},
        docOf: () => doc,
    })
    return { frame, scheduler, composition, dial, edit: () => { doc = { v: 'B' } } }
}

test('a chosen line is available in the document it was chosen in', () => {
    const b = bench()
    b.dial.catchLine(LINE)
    const reading = b.dial.catchReading()
    assert.equal(reading.line, LINE)
    assert.equal(reading.available, true)
})

test('an edit retires the UNHIT arm instead of re-targeting the row', () => {
    const b = bench()
    b.dial.catchLine(LINE)
    b.edit()                                   // the quiet-window doc change
    assert.equal(b.dial.catchReading().line, LINE, 'the line is still named')
    assert.equal(b.dial.catchReading().available, false, 'but it is not the site the hand chose')
    assert.equal(b.dial.disarm(), true, 'the edit disarms an unhit trigger')
    assert.equal(b.dial.catchReading(), null, 'and the gutter has nothing to draw')
    assert.equal(b.frame.batch.breakLine, null, 'the play carries no breakpoint')
})

test('the first click in the new document chooses, it does not clear a ghost', () => {
    const b = bench()
    b.dial.catchLine(LINE)
    b.edit()
    b.dial.catchLine(LINE)            // same row, same line number, NEW document
    const reading = b.dial.catchReading()
    assert.equal(reading.line, LINE)
    assert.equal(reading.available, true, 'a fresh choice in the new document may arm')
    b.edit()                          // only an edit retires a live arm; a republication does not
    assert.equal(b.dial.disarm(), true, 'and the next edit retires it')
})

test('a republication of the SAME document disarms nothing', () => {
    const b = bench()
    b.dial.catchLine(LINE)
    // Any edge may reconcile; a same-document call is a no-op, not a notification.
    assert.equal(b.dial.disarm(), false, 'nothing to reconcile')
    assert.equal(b.dial.catchReading().available, true, 'the arm survives')
    assert.equal(b.frame.batch.breakLine, LINE, 'and the play still carries it')
})

test('disarm is idempotent: the second call finds nothing to retire', () => {
    const b = bench()
    b.dial.catchLine(LINE)
    b.edit()
    assert.equal(b.dial.disarm(), true, 'the edit retires the unhit arm')
    assert.equal(b.dial.disarm(), false, 'and reconciliation is a fixed point')
})
