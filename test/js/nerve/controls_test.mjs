// THE SEAT'S NAME IS NOT ITS PERMISSION. These two are derived from facts and
// may never invite a control that could not act — nor hide which seat it names.
// (id:nav-core-sill) · (id:outer-sill)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { controlsOf, sameVerb } from '../../../assets/js/nerve/controls.js'

const verbs = () => ({ pause: () => true, resume: () => true, replay: () => true })
const base = { ms: 900, caught: false, can: { hold: true, resume: false, replay: true }, ...verbs() }

test('a running play names Pause and offers the restart beside it', () => {
    const shown = controlsOf({ ...base, phase: 'running' })
    assert.deepEqual(shown.toggle, { verb: 'Pause', method: 'pause', permission: 'hold', key: null })
    assert.deepEqual(shown.restart, { verb: 'Restart from beginning', method: 'replay', permission: 'replay', key: null })
    assert.equal(shown.name, 'Pause')
})

test('a paused play names Play; the winder is a replay in every phase', () => {
    const shown = controlsOf({ ...base, phase: 'paused', can: { hold: false, resume: true, replay: true } })
    assert.equal(shown.toggle.method, 'resume')
    assert.equal(shown.name, 'Play')
    assert.equal(shown.restart.method, 'replay', 'a new day may start from a hold')
})

test('a fault keeps its own sentence: the stop is a fact, not a Replay', () => {
    const shown = controlsOf({ ...base, phase: 'fault', can: { hold: false, resume: false, replay: true } })
    assert.equal(shown.name, 'Execution stopped. Replay from beginning')
    assert.equal(shown.toggle.verb, shown.name)
})

// A phase we do not know is a stopped execution: it may replay and nothing else.
test('an unknown phase falls back to the stopped sentence, never to a hold', () => {
    const shown = controlsOf({ phase: 'nonsense', can: { hold: true, replay: true }, ...verbs() })
    assert.equal(shown.name, 'Execution stopped. Replay from beginning')
    assert.equal(shown.toggle.method, 'replay', 'no unknown phase may offer a fresh hold')
    assert.equal(shown.restart.method, 'replay')
})

test('an absent fact is not a grant — every missing shape fails closed', () => {
    for (const reading of [
        null, undefined,
        { phase: 'running' },                                    // no `can` at all
        { phase: 'running', can: {} },                           // no permission named
        { phase: 'running', can: { hold: 'yes' } },              // truthy is not true
        { phase: 'running', can: { hold: true } },               // permitted but no method
        { phase: 'nonsense' },                                   // unknown phase, no facts
    ]) {
        const shown = controlsOf(reading)
        assert.equal(shown.toggle, null, `toggle must be withheld for ${JSON.stringify(reading)}`)
        assert.equal(shown.restart, null, `restart must be withheld for ${JSON.stringify(reading)}`)
        assert.equal(typeof shown.name, 'string', 'the seat is still named')
    }
})

test('the name survives a withheld permission — the seat stays named', () => {
    const shown = controlsOf({ phase: 'running', can: { hold: false, replay: false }, ...verbs() })
    assert.equal(shown.toggle, null)
    assert.equal(shown.name, 'Pause')
})

test('sameVerb tells a repaint from a new offer', () => {
    const pause = { verb: 'Pause', method: 'pause', permission: 'hold' }
    assert.equal(sameVerb(pause, { ...pause }), true)
    assert.equal(sameVerb(null, null), true, 'two painted nothings are steady')
    assert.equal(sameVerb(undefined, null), false, 'unpainted must write')
    assert.equal(sameVerb(pause, null), false)
    assert.equal(sameVerb(pause, { ...pause, method: 'resume' }), false)
})

// A verb of the same name from another play is not the verb the hand saw.
test('the offer carries the play it belongs to', () => {
    const reading = { phase: 'running', can: { hold: true, replay: true }, key: 'p7:2', ...verbs() }
    const shown = controlsOf(reading)
    assert.equal(shown.toggle.key, 'p7:2')

    const other = controlsOf({ ...reading, key: 'p7:3' })
    assert.equal(sameVerb(shown.toggle, other.toggle), false, 'a successor is a different offer')
    assert.equal(sameVerb(shown.toggle, controlsOf({ ...reading, key: 'p7:2' }).toggle), true)
})
