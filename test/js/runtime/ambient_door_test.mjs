// The evaluator↔ambient door is one named contract, installed through one function.
// A pure evaluator has no door and stays a calculator; a frame owner installs the whole
// door at once, so the hooks cannot accrete at each call site. (id:being-facets-centers-review)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Evaluator } from '../../../assets/js/turtling/mafs/evaluate.js'
import { installAmbientDoor } from '../../../assets/js/turtling/ambient.js'

test('a bare evaluator has no ambient door and stays a calculator', () => {
    const evaluator = new Evaluator()
    assert.equal(evaluator.isSubject, undefined)
    assert.equal(evaluator.resolveSubjectFacet, undefined)
    assert.equal(evaluator.resolveSubject, undefined)
    assert.equal(evaluator.beginObservation, undefined)
    assert.equal(evaluator.run({ type: 'operand', value: 'pi', children: [] }, {}), Math.PI)
})

test('installAmbientDoor sets every documented hook from the one door object', () => {
    const evaluator = new Evaluator()
    const calls = []
    const door = {
        observe: () => { calls.push('observe'); return 1 },
        unobserved: () => { calls.push('unobserved') },
        resolve: () => { calls.push('resolve') },
        subject: () => { calls.push('subject') },
        own: () => { calls.push('own') },
        isSubject: () => { calls.push('isSubject') },
        facet: () => { calls.push('facet') },
    }
    installAmbientDoor(evaluator, door)
    assert.equal(evaluator.beginObservation(), 1)
    evaluator.endObservation()
    evaluator.resolveExternal('x')
    evaluator.resolveSubject('x')
    evaluator.ownSubject('x')
    evaluator.isSubject({})
    evaluator.resolveSubjectFacet({}, 'x')
    assert.deepEqual(calls, ['observe', 'unobserved', 'resolve', 'subject', 'own', 'isSubject', 'facet'])
})
