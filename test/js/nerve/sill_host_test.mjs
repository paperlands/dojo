// TWO MOUNTS, ONE HOST. When a successor takes the element, the predecessor's
// teardown and its ASYNC completion are both stale writes: they must leave the host
// exactly as the successor left it. Ownership is the test the instrument already has
// — are these still my nodes? (id:outer-sill-lifetime)
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mountSill } from '../../../assets/js/nerve/sill.js'

// The smallest host that answers what mountSill asks of one. `innerHTML = …` builds
// fresh nodes, exactly as a real re-mount would, which is how ownership changes hands.
class Host {
    constructor() {
        this.hidden = false
        this.dataset = {}
        this._classes = new Set()
        this._attrs = new Map()
        this._listeners = new Map()
        this._nodes = null
        this.classList = {
            add: (...c) => c.forEach((x) => this._classes.add(x)),
            remove: (...c) => c.forEach((x) => this._classes.delete(x)),
            contains: (c) => this._classes.has(c),
            toggle: (c, on) => (on ? this._classes.add(c) : this._classes.delete(c)),
        }
        this.setAttribute = (k, v) => this._attrs.set(k, v)
        this.removeAttribute = (k) => this._attrs.delete(k)
        this.hasAttribute = (k) => this._attrs.has(k)
        this.addEventListener = (n, fn) => {
            if (!this._listeners.has(n)) this._listeners.set(n, [])
            this._listeners.get(n).push(fn)
        }
        this.removeEventListener = (n, fn) => {
            const fns = this._listeners.get(n)
            if (fns) this._listeners.set(n, fns.filter((f) => f !== fn))
        }
        this.innerHTML = ''
        this.replaceChildren = () => { this._nodes = null }
        this.contains = (node) => node === this._nodes?.['.sill-winder']
        this.querySelector = (sel) => this._nodes?.[sel] ?? null
    }
    get innerHTML() { return this._html ?? '' }
    set innerHTML(html) {
        this._html = html
        const node = () => {
            const listeners = new Map()
            const n = {
                textContent: '', disabled: false, _classes: new Set(),
                setAttribute() {}, removeAttribute() {},
                addEventListener(name, fn) {
                    if (!listeners.has(name)) listeners.set(name, [])
                    listeners.get(name).push(fn)
                },
                removeEventListener(name, fn) {
                    const fns = listeners.get(name)
                    if (fns) listeners.set(name, fns.filter((f) => f !== fn))
                },
                click() { for (const fn of listeners.get('click') ?? []) fn({ type: 'click' }) },
            }
            return n
        }
        const winder = node(), dial = node(), ticks = node(), time = node()
        dial.setAttribute = () => {}
        this._nodes = { '.sill-winder': winder, '.sill-dial': dial, '.sill-ticks': ticks, '.sill-time span': time }
    }
}

const reading = () => ({
    ms: 1200, phase: 'running', caught: false,
    can: { hold: true, resume: false, replay: true },
    pause: () => true, resume: () => true, replay: () => true,
})

test('a dead sill does not mutate the host its successor took', () => {
    const host = new Host()
    const first = mountSill(host, { read: () => null })     // stages its sunset
    assert.equal(host.classList.contains('is-leaving'), false, 'a fresh mount is not leaving')

    const second = mountSill(host, { read: () => null })    // successor takes the host
    second.paint()                                          // successor stages ITS sunset
    assert.equal(host.classList.contains('is-leaving'), true)

    first.destroy()                                         // predecessor releases late
    assert.equal(host.classList.contains('is-leaving'), true, 'the successor keeps its own state')
    assert.equal(host.hasAttribute('inert'), true, 'and its own inert')
    assert.equal(host.hidden, false, 'and its own visibility')
})

test('a predecessor sunset cannot hide the successor that replaced it', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    const first = mountSill(host, { read: () => null })
    first.paint()                                           // stages a 700ms sunset
    assert.equal(host.classList.contains('is-leaving'), true)

    const second = mountSill(host, { read: reading })       // successor, and it is LIVE
    second.paint()
    assert.equal(host.hidden, false, 'the successor depicts a play')
    assert.equal(host.classList.contains('is-leaving'), false, 'and is not leaving')

    t.mock.timers.tick(800)                                 // the predecessor's sunset completes
    assert.equal(host.hidden, false, 'a stale completion does not hide the successor')
    assert.equal(host.classList.contains('is-leaving'), false, 'nor does it start one')
})

test('a passive reading disables the hand and never acknowledges a click', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    // What the Outer sends until command admission lands: a depiction, explicit all-false
    // abilities, and NO intents. (id:outer-sill)
    const passive = () => ({
        ms: 2400, phase: 'running', caught: false,
        can: { hold: false, resume: false, replay: false },
    })
    const sill = mountSill(host, { read: passive })
    sill.paint()

    const winder = host.querySelector('.sill-winder')
    const dial = host.querySelector('.sill-dial')
    assert.equal(dial.disabled, true, 'the arc cannot hold')
    assert.equal(winder.disabled, true, 'the winder cannot restart')

    dial.click()
    winder.click()
    t.mock.timers.tick(50)
    assert.equal(host.classList.contains('is-rewinding'), false, 'a passive sill acknowledges nothing')
    assert.equal(host.hidden, false, 'and keeps depicting')
})

test('a replaced host rejects the old paint and the old acknowledgement', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    const paused = () => ({ ms: 100, phase: 'paused', caught: false, can: { hold: false, resume: true, replay: false } })
    const running = () => ({ ms: 900, phase: 'running', caught: false, can: { hold: true, resume: false, replay: true } })

    const first = mountSill(host, { read: paused })
    const staleWinder = host.querySelector('.sill-winder')   // the predecessor's own button
    first.paint()
    assert.equal(host.dataset.playback, 'paused')

    const second = mountSill(host, { read: running })      // successor takes the host
    second.paint()
    assert.equal(host.dataset.playback, 'running')

    first.paint()                                          // the old organ keeps ticking
    assert.equal(host.dataset.playback, 'running', 'a stale paint cannot relabel the successor')

    staleWinder.click()                                    // …and its handler must not fire gold
    t.mock.timers.tick(60)
    assert.equal(host.classList.contains('is-rewinding'), false, 'a stale acknowledgement paints nothing')
})

test('a click runs the verb it painted, never its opposite', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    const calls = { pause: 0, resume: 0, replay: 0 }
    let phase = 'running'
    const read = () => ({
        ms: 400, caught: false, phase,
        can: phase === 'running'
            ? { hold: true, resume: false, replay: true }
            : { hold: false, resume: true, replay: true },
        pause: () => { calls.pause++; return true },
        resume: () => { calls.resume++; return true },
        replay: () => { calls.replay++; return true },
    })
    const sill = mountSill(host, { read })
    sill.paint()

    const dial = host.querySelector('.sill-dial')
    phase = 'paused'                 // the world moved under the pointer, no repaint yet
    dial.click()

    assert.equal(calls.resume, 0, 'a painted Pause must never run Resume')
    assert.equal(calls.pause, 0, 'nor run itself from a stale reading')
    assert.equal(dial.disabled, false, 'the click only repaints the offer that stands now')
})

test('a reading that omits its grant enables nothing', () => {
    const host = new Host()
    let called = 0
    const sill = mountSill(host, {
        read: () => ({
            ms: 10, phase: 'running', caught: false,
            pause: () => { called++; return true },
            replay: () => { called++; return true },
        }),
    })
    sill.paint()

    assert.equal(host.querySelector('.sill-dial').disabled, true, 'no grant, no hold')
    assert.equal(host.querySelector('.sill-winder').disabled, true, 'no grant, no restart')
    host.querySelector('.sill-dial').click()
    host.querySelector('.sill-winder').click()
    assert.equal(called, 0, 'an absent fact is not a permission')
})

test('a refused restart paints no acknowledgement', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    const refused = () => ({
        ms: 300, phase: 'finished', caught: false,
        can: { hold: false, resume: false, replay: true },
        replay: () => false,
    })
    const sill = mountSill(host, { read: refused })
    sill.paint()
    host.querySelector('.sill-winder').click()
    assert.equal(host.classList.contains('is-rewinding'), false, 'a refusal is not a beat')
})

test('a held glow does not outlive its reading', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    let current = {
        ms: 300, phase: 'finished', caught: false,
        can: { hold: false, resume: false, replay: true },
        replay: () => true,
    }
    const sill = mountSill(host, { read: () => current })
    sill.paint()
    host.querySelector('.sill-winder').click()
    assert.equal(host.classList.contains('is-rewinding'), true, 'the accepted rewind is lit')

    current = null                   // a different play arrives inside the beat
    sill.paint()
    assert.equal(host.classList.contains('is-rewinding'), false, 'the next play does not inherit its glow')
})

// A replay can end the play it restarts. The instrument must not don the glow
// on its way out, and nothing may inherit it. (id:outer-sill-lifetime)
test('an accepted replay that dies with its reading paints no glow', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    let current = {
        ms: 300, phase: 'finished', caught: false,
        can: { hold: false, resume: false, replay: true },
        replay: () => { current = null; return true },     // accepted, then gone
    }
    const sill = mountSill(host, { read: () => current })
    sill.paint()
    host.querySelector('.sill-winder').click()

    assert.equal(host.classList.contains('is-rewinding'), false, 'a dead reading earns no acknowledgement')
    assert.equal(host.hidden, false, 'and the sunset is still the only exit')
})

// The play's identity, not the verb's name: a successor offering the same
// Pause is not the Pause the hand saw. (id:outer-sill-lifetime)
test('a same-named verb on another play is not the painted verb', () => {
    const host = new Host()
    const calls = { first: 0, second: 0 }
    let key = 'A:1'
    const read = () => ({
        key, ms: 400, phase: 'running', caught: false,
        can: { hold: true, resume: false, replay: true },
        pause: () => { calls[key === 'A:1' ? 'first' : 'second']++; return true },
        replay: () => true,
    })
    const sill = mountSill(host, { read })
    sill.paint()

    key = 'B:1'                          // the same phase, the same verb, a new play
    host.querySelector('.sill-dial').click()

    assert.equal(calls.first, 0, 'the old play is never asked again')
    assert.equal(calls.second, 0, 'and the new one is not asked for a verb painted on the old')
    assert.equal(host.querySelector('.sill-dial').disabled, false, 'the repaint offers the new play')
})

test('an instant the reader never supplied is not painted', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    const sill = mountSill(host, {
        read: () => ({ ms: undefined, phase: 'running', caught: false, can: {} }),
    })
    sill.paint()
    sill.paint()

    assert.equal(host.querySelector('.sill-time span').textContent, '', 'no instant is invented, not even zero')
    assert.equal(host.classList.contains('is-leaving'), true, 'the instrument says nothing instead')
})

// A caller may hold a reused host. The successor owns its presentation: an
// inherited glow or exit is not its state, and the predecessor's deadlines
// cannot end the successor's beat. (id:outer-sill-lifetime)
test('a successor takes presentation it owns', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    const beat = () => ({
        ms: 300, phase: 'finished', caught: false,
        can: { hold: false, resume: false, replay: true },
        replay: () => true,
    })
    const first = mountSill(host, { read: beat })
    first.paint()
    host.querySelector('.sill-winder').click()
    assert.equal(host.classList.contains('is-rewinding'), true, 'the predecessor earns its beat')

    t.mock.timers.tick(300)
    const second = mountSill(host, { read: beat })
    assert.equal(host.classList.contains('is-rewinding'), false, 'the successor inherits no glow')
    second.paint()
    host.querySelector('.sill-winder').click()
    assert.equal(host.classList.contains('is-rewinding'), true, 'and earns its own')

    t.mock.timers.tick(300)                 // t=600: the predecessor's deadline comes due
    assert.equal(host.classList.contains('is-rewinding'), true, "an old timer cannot end a successor's beat")

    t.mock.timers.tick(400)                 // t=1000: the successor's own deadline does
    assert.equal(host.classList.contains('is-rewinding'), false, 'a beat still ends when its own time is up')
})

test('a successor is not left mid-exit by an inherited sunset', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    const first = mountSill(host, { read: () => null })
    first.paint()                                            // stages a sunset
    assert.equal(host.classList.contains('is-leaving'), true)

    const second = mountSill(host, { read: () => null })
    assert.equal(host.classList.contains('is-leaving'), false, 'the successor starts standing')
    assert.equal(host.hasAttribute('inert'), false, 'and reachable')
})

// Two accepted rewinds inside one beat must RESTART the named one-shot, not
// merely extend a class that is already present. (id:nav-core-sill)
test('a second accepted rewind restarts the acknowledgement', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    const finished = () => ({
        ms: 300, phase: 'finished', caught: false,
        can: { hold: false, resume: false, replay: true },
        replay: () => true,
    })
    const sill = mountSill(host, { read: finished })
    sill.paint()

    const winder = host.querySelector('.sill-winder')
    let restarts = 0
    host.getAnimations = () => []                       // the named path is available
    winder.getAnimations = () => [{
        animationName: 'sill-rewind',
        cancel() { restarts++ },
        play() {},
    }]

    winder.click()
    t.mock.timers.tick(300)
    winder.click()                                      // inside the first beat

    assert.equal(restarts, 2, 'each accepted rewind restarts its own animation')
})

// The beat belongs to the winder's gesture, not to the replay method: the dial's
// phase-dependent replay is a different affordance and paints no gold.
test('the winder acknowledges a restart; the dial does not', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const host = new Host()
    const finished = () => ({
        ms: 300, phase: 'finished', caught: false,
        can: { hold: false, resume: false, replay: true },
        replay: () => true,
    })
    const sill = mountSill(host, { read: finished })
    sill.paint()
    host.querySelector('.sill-dial').click()
    assert.equal(host.classList.contains('is-rewinding'), false, "the dial's replay is not the winder's gesture")
    host.querySelector('.sill-winder').click()
    assert.equal(host.classList.contains('is-rewinding'), true, 'the winder is')
})
