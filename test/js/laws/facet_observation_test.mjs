// Facet answer equality does not erase observation identity or current readiness.
// (id:being-facets-p1-results)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork } from './harness.mjs'
import { resolveBinding, frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'

const pass = ({ requested }) => ({ accepted: true, transform: requested })
function world(source) {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild('host', fork('host', source))
    let now = 0
    const events = []
    const pump = () => {
        for (let i = 0; i < 24; i++) {
            if (!scheduler.done) scheduler.tick(now)
            scheduler.readouts.drain()
            now += 1000
            for (const frame of scheduler.registry.values()) {
                for (const event of frame.channel.drain()) events.push({ id: frame.id, event })
            }
        }
        assert.deepEqual(scheduler.errors, [])
    }
    const move = (frame, position, settle = true) => {
        const verdict = scheduler.requestMotion(frame, { ...frame.transform.deref(), position }, scheduler.motionRevision)
        assert.equal(verdict.kind, 'accept')
        if (settle) pump()
    }
    pump()
    return { scheduler, host, pump, move, events }
}

test('a native figure follows its observed facet, not every change of its source being', () => {
    const w = world(`let slider
def triangle len do
 loop 3 do
  fw len
  rt 120
 end
end
let serpinski = triangle slider.x`)
    const slider = w.host.children.get('slider'), figure = w.host.children.get('serpinski')
    w.move(slider, [30, 0, 0])
    const first = figure.runIncarnation, deposited = w.events.length
    w.move(slider, [30, 9, 0])
    w.move(slider, [30, 9, 12])
    assert.equal(figure.closed, true)
    assert.equal(figure.runIncarnation, first)
    assert.equal(w.events.slice(deposited).filter(e => e.id === figure.id && e.event.type === 'path').length, 0)
    assert.deepEqual(w.scheduler.readouts.list().find(n => n.keyed).question, [30])
    w.move(slider, [42, 9, 12])
    assert.ok(figure.runIncarnation > first)
    assert.deepEqual(w.scheduler.readouts.list().find(n => n.keyed).question, [42])
})

for (const translated of [false, true]) {
    test(`an equal keyed facet answer rewires dependencies and retains readiness semantics; translated=${translated}`, () => {
        const w = world(translated ? 'jmp 100\nas room do\n let left\n let right\nend' : 'let left\nlet right')
        const observer = translated ? w.host.children.get('room') : w.host
        const left = observer.children.get('left'), right = observer.children.get('right')
        w.move(left, [10, 0, 0])
        w.move(right, [10, 0, 0])
        assert.deepEqual(frameWorldTransform(right).position.map(n => +n.toFixed(8)), translated ? [110, 0, 0] : [10, 0, 0])
        const store = w.scheduler.readouts, built = [], announced = []
        let selected = left
        const observe = () => {
            assert.equal(w.scheduler.registry.get(selected.id), selected)
            store.readsink(selected)
            return resolveBinding(observer, `${selected.name}.x`)
        }
        const id = store.register(w.host.id, 'selected-facet', {
            capture: observe,
            build: q => { built.push(q); return 3 * q },
        })
        store.watch(change => {
            if (change.id === id) announced.push({ value: change.value, question: change.question, pending: !!change.pending })
        })
        const settle = () => { store.recompute(); store.drain(); w.pump() }
        const check = () => assert.equal(store.value(id), 3 * resolveBinding(observer, `${selected.name}.x`))
        const depends = frame => store.dependsOnFrame(() => store.value(id), frame)
        settle()
        check()
        assert.deepEqual(built, [translated ? 110 : 10])
        assert.equal(depends(left), true)
        assert.equal(depends(right), false)
        const announcements = announced.length
        selected = right
        settle()
        check()
        assert.deepEqual(built, [translated ? 110 : 10])
        assert.equal(announced.length, announcements)
        assert.equal(depends(left), false)
        assert.equal(depends(right), true)
        w.move(left, [20, 0, 0])
        settle()
        check()
        assert.deepEqual(built, [translated ? 110 : 10])
        assert.equal(announced.length, announcements)
        w.move(right, [13, 0, 0], false)
        assert.equal(store.list().find(n => n.id === id).pending, true)
        assert.equal(store.value(id), undefined, 'a retained old payload is not a ready answer to the new question')
        const before = translated ? 110 : 10, after = translated ? 113 : 13
        assert.deepEqual(announced.at(-1), { value: 3 * before, question: after, pending: true })
        settle()
        check()
        assert.deepEqual(built, [before, after])
        assert.equal(store.value(id), 3 * after)
        assert.deepEqual(announced.slice(-2), [
            { value: 3 * before, question: after, pending: true },
            { value: 3 * after, question: after, pending: false },
        ])
        assert.equal(announced.length, announcements + 2)
        assert.equal(store.retire(w.host.id, 'selected-facet'), true)
    })
}
