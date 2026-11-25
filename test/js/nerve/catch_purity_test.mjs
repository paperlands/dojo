// A READER MUST NOT DISARM. `catchReading()` is a getter, and it used to call
// `checkStale()` → `detach()` → `frame.batch.breakLine = null`: asking whether the
// breakpoint was armed destroyed it, and then reported the row available anyway.
// Retirement belongs on edges that already exist (a drive, a cancel), never on a
// sample. (id:nav-core-sill)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createPlayCatch } from '../../../assets/js/turtling/catch.js'

const SEAT = 'seat'

function bench() {
    const frame = {
        run: 7,
        seed: { ast: [{ type: 'Command', span: { line: 3 } }] },
        batch: { breakLine: null },
    }
    const children = new Map([[SEAT, frame]])
    const scheduler = { root: { children }, held: false, lastTickTime: 100, registry: new Map(), done: false }
    const compositor = { held: false, watchCatch: () => () => {} }
    const turtle = { scheduler, compositor }
    const catcher = createPlayCatch(turtle, { seat: SEAT, line: 3, hold: () => 41, release: () => {} })
    return { frame, children, scheduler, compositor, turtle, catcher }
}

test('arming writes the breakpoint onto the play', () => {
    const b = bench()
    const reading = b.catcher.arm()
    assert.equal(reading.state, 'armed')
    assert.equal(b.frame.batch.breakLine, 3, 'the play carries the breakpoint')
})

test('reading a stale arm does not disarm it', () => {
    const b = bench()
    b.catcher.arm()
    b.children.set('other', { run: 8, seed: { ast: [] }, batch: { breakLine: null } })   // topology edge

    const reading = b.catcher.read()
    assert.equal(reading.stale, true, 'the arm reports that it no longer binds')
    assert.equal(b.frame.batch.breakLine, 3, 'and a SAMPLE retired nothing')

    const again = b.catcher.read()
    assert.equal(again.stale, true, 'still true on the second read')
    assert.equal(b.frame.batch.breakLine, 3, 'idempotent: reads are not commands')
})

test('a drive retires what no longer binds', () => {
    const b = bench()
    b.catcher.arm()
    b.children.set('other', { run: 8, seed: { ast: [] }, batch: { breakLine: null } })

    b.catcher.sink(b.frame, { type: 'breakpoint', line: 3 })
    assert.equal(b.frame.batch.breakLine, null, 'the drive retired the stale arm')
    assert.equal(b.catcher.read().state, 'stale')
})

test('a live arm hits on the drive and keeps its breakpoint', () => {
    const b = bench()
    b.catcher.arm()
    void b.catcher.eligible                    // the drive samples eligibility first
    b.catcher.sink(b.frame, { type: 'breakpoint', line: 3 })
    assert.equal(b.catcher.read().state, 'waiting', 'a hit waits for its lease')

    b.catcher.settle()                          // the one lease edge
    const reading = b.catcher.read()
    assert.equal(reading.state, 'hit')
    assert.equal(reading.held, true)
    assert.equal(reading.receipt, 41)
    assert.equal(b.frame.batch.breakLine, 3, 'a live hit leaves the breakpoint in place')
    assert.equal(reading.stale, false)
})
