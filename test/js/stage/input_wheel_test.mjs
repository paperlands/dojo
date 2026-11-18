// Own the vendor's bound wheel listener across connect/disconnect/disposal.
// Non-prevention alone does not prove scrolling: host_play supplies that evidence.
// (id:host-input-wheel)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { PerspectiveCamera } from '../../../assets/js/utils/three-entry.js'
import {
    DojoOrbitControls, normalizeInput, wheelAdmits, WHEEL_POLICIES,
} from '../../../assets/js/turtling/orbit.js'

// A DOMElement just real enough for OrbitControls: listener sets, a root node with
// a style, and a `dispatch` that records what the host did to the event.
function fakeCanvas() {
    const map = new Map()
    const doc = { addEventListener() {}, removeEventListener() {}, documentElement: { style: {} } }
    return {
        style: {},
        ownerDocument: doc,
        getRootNode: () => doc,
        clientWidth: 400, clientHeight: 300, offsetWidth: 400, offsetHeight: 300,
        addEventListener(type, fn) { (map.get(type) ?? map.set(type, new Set()).get(type)).add(fn) },
        removeEventListener(type, fn) { map.get(type)?.delete(fn) },
        setPointerCapture() {}, releasePointerCapture() {},
        getBoundingClientRect() { return { left: 0, top: 0, width: 400, height: 300 } },
        count(type) { return map.get(type)?.size ?? 0 },
        dispatch(type, overrides = {}) {
            const event = {
                type, preventDefault() { event.defaultPrevented = true }, defaultPrevented: false,
                deltaMode: 0, deltaY: -120, clientX: 200, clientY: 150,
                ctrlKey: false, metaKey: false, shiftKey: false, altKey: false,
                ...overrides,
            }
            for (const fn of [...(map.get(type) ?? [])]) fn(event)
            return event
        },
    }
}

function controlsOf(input = null) {
    const canvas = fakeCanvas()
    const camera = new PerspectiveCamera(60, 4 / 3, 0.1, 10000)
    camera.position.set(0, 0, 500)
    const controls = new DojoOrbitControls(camera, canvas, input)
    // Count ADMITTED zooms, not listener invocations: the vendor's own gate calls
    // this lower handler only after its policy check and preventDefault. Wrapping
    // here observes admission without touching the binding under test.
    let reached = 0
    const zoom = controls._handleMouseWheel.bind(controls)
    controls._handleMouseWheel = event => { reached++; return zoom(event) }
    return { canvas, controls, reached: () => reached }
}

describe('the policy is a value, refused before any resource', () => {
    test('the default is today: always', () => {
        assert.deepEqual(normalizeInput(null), { wheel: 'always' })
        assert.deepEqual(normalizeInput(undefined), { wheel: 'always' })
        assert.deepEqual(normalizeInput({}), { wheel: 'always' })
    })

    test('a normalized policy is frozen and never reads the caller again', () => {
        const caller = { wheel: 'modifier' }
        const policy = normalizeInput(caller)
        assert.ok(Object.isFrozen(policy))
        caller.wheel = 'none'
        assert.equal(policy.wheel, 'modifier')
    })

    test('a misspelt policy is refused by name', () => {
        assert.throws(() => normalizeInput({ wheel: 'modifer' }),
            /input\.wheel must be one of always, modifier, none/)
        assert.throws(() => normalizeInput({ wheel: true }), TypeError)
        assert.throws(() => normalizeInput('modifier'), /input must be an options object/)
        assert.throws(() => normalizeInput([]), /input must be an options object/)
        for (const wheel of WHEEL_POLICIES) assert.equal(normalizeInput({ wheel }).wheel, wheel)
    })

    test('an unknown input key is refused, not silently read as orbit/pan support', () => {
        assert.throws(() => normalizeInput({ wheel: 'modifier', orbit: false }),
            /input\.orbit is not supported/)
        assert.throws(() => normalizeInput({ pan: true }), /input\.pan is not supported/)
    })

    test('the stage refuses a bad policy before touching the canvas', () => {
        // Source-level: getContext is the first side effect in createStage, so the
        // normalization must sit above it. Reading source is the honest rig here —
        // importing stage needs WebGL.
        const stage = readFileSync(new URL('../../../assets/js/turtling/stage.js', import.meta.url), 'utf8')
        const body = stage.slice(stage.indexOf('export function createStage('))
        assert.match(body, /createStage\(canvas, bridge, instruments = \{\}, input = null\)/)
        const normalize = body.indexOf('normalizeInput(input)')
        const context = body.indexOf('canvas.getContext')
        assert.ok(normalize > -1 && context > -1 && normalize < context,
            'input must be normalized before canvas.getContext')
        assert.match(body, /new DojoOrbitControls\(camera, canvas, policy\)/)
    })
})

describe('admission table', () => {
    const plain = {}, ctrl = { ctrlKey: true }, meta = { metaKey: true }
    const shift = { shiftKey: true }, alt = { altKey: true }

    test('always admits everything it always did', () => {
        for (const event of [plain, ctrl, meta, shift, alt]) assert.equal(wheelAdmits('always', event), true)
    })

    test('modifier claims Ctrl and Cmd only', () => {
        assert.equal(wheelAdmits('modifier', plain), false)
        assert.equal(wheelAdmits('modifier', ctrl), true)
        assert.equal(wheelAdmits('modifier', meta), true)
        assert.equal(wheelAdmits('modifier', shift), false)
        assert.equal(wheelAdmits('modifier', alt), false)
    })

    test('none claims nothing, modifiers included', () => {
        for (const event of [plain, ctrl, meta, { ctrlKey: true, metaKey: true }])
            assert.equal(wheelAdmits('none', event), false)
    })

    test('a missing event is not a modifier', () => {
        assert.equal(wheelAdmits('modifier', null), false)
        assert.equal(wheelAdmits('always', null), true)
    })
})

test('pinch-shaped wheel and held Control keep distinct native normalization', () => {
    const { controls } = controlsOf({ wheel: 'modifier' })
    const event = { deltaMode: 0, deltaY: -120, ctrlKey: true }
    try {
        assert.equal(controls._customWheelEvent(event).deltaY, -1200)
        controls._interceptControlDown({ key: 'Control' })
        assert.equal(controls._customWheelEvent(event).deltaY, -120)
        controls._interceptControlUp({ key: 'Control' })
        assert.equal(controls._customWheelEvent(event).deltaY, -1200)
        assert.equal(controls._customWheelEvent({ ...event, ctrlKey: false, metaKey: true }).deltaY, -120)
        assert.equal(event.deltaY, -120, 'native normalization must not mutate the browser event')
    } finally { controls.dispose() }
})

describe('the live binding', () => {
    test('default wiring is the vendor untouched: one listener, unchanged behaviour', () => {
        const { canvas, reached } = controlsOf()
        assert.equal(canvas.count('wheel'), 1)
        const event = canvas.dispatch('wheel')
        assert.equal(reached(), 1)
        assert.equal(event.defaultPrevented, true)
    })

    test('modifier: a plain wheel is not intercepted and not prevented', () => {
        const { canvas, reached } = controlsOf({ wheel: 'modifier' })
        assert.equal(canvas.count('wheel'), 1)
        const event = canvas.dispatch('wheel')
        assert.equal(reached(), 0, 'the vendor handler must not run')
        assert.equal(event.defaultPrevented, false, 'the page keeps its scroll')
    })

    test('modifier: Ctrl+wheel and Cmd+wheel zoom and prevent the page', () => {
        const { canvas, reached } = controlsOf({ wheel: 'modifier' })
        for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
            const before = reached()
            const event = canvas.dispatch('wheel', modifier)
            assert.equal(reached(), before + 1)
            assert.equal(event.defaultPrevented, true)
        }
    })

    test('modifier: Shift-only and Alt-only wheels stay with the page', () => {
        const { canvas, reached } = controlsOf({ wheel: 'modifier' })
        for (const modifier of [{ shiftKey: true }, { altKey: true }]) {
            const event = canvas.dispatch('wheel', modifier)
            assert.equal(event.defaultPrevented, false)
        }
        assert.equal(reached(), 0)
    })

    test('none: no wheel reaches the camera, pinch included', () => {
        const { canvas, reached } = controlsOf({ wheel: 'none' })
        for (const modifier of [{}, { ctrlKey: true }, { metaKey: true }]) {
            const event = canvas.dispatch('wheel', modifier)
            assert.equal(event.defaultPrevented, false)
        }
        assert.equal(reached(), 0)
    })

    test('a disabled control stays inert under every policy', () => {
        for (const wheel of WHEEL_POLICIES) {
            const { canvas, controls, reached } = controlsOf({ wheel })
            controls.enabled = false
            canvas.dispatch('wheel', { ctrlKey: true })
            assert.equal(reached(), 0, wheel)
        }
    })

    test('dispose leaves no wheel listener; reconnect keeps the same policy and owner', () => {
        const { canvas, controls, reached } = controlsOf({ wheel: 'modifier' })
        controls.dispose()
        assert.equal(canvas.count('wheel'), 0)

        controls.connect(canvas)
        assert.equal(canvas.count('wheel'), 1, 'reconnect re-adds one listener, not two')
        canvas.dispatch('wheel')
        assert.equal(reached(), 0, 'the policy survived reconnection')
        canvas.dispatch('wheel', { ctrlKey: true })
        assert.equal(reached(), 1)
    })

    test('an element-less world keeps the policy for whatever element it later connects', () => {
        // The vendor is constructible without a DOM element, so the gate must be owned
        // by the property, not by the presence of an element at construction.
        const camera = new PerspectiveCamera(60, 4 / 3, 0.1, 10000)
        const controls = new DojoOrbitControls(camera, null, { wheel: 'modifier' })
        let reached = 0
        const zoom = controls._handleMouseWheel.bind(controls)
        controls._handleMouseWheel = event => { reached++; return zoom(event) }

        const first = fakeCanvas()
        controls.connect(first)
        first.dispatch('wheel')
        assert.equal(reached, 0, 'a plain wheel is still the page’s')
        first.dispatch('wheel', { ctrlKey: true })
        assert.equal(reached, 1)

        const second = fakeCanvas()
        controls.disconnect()
        assert.equal(first.count('wheel'), 0, 'the old element keeps no listener')
        controls.connect(second)
        assert.equal(first.count('wheel'), 0)
        second.dispatch('wheel')
        assert.equal(reached, 1, 'a DIFFERENT element gets the same gate')
        second.dispatch('wheel', { metaKey: true })
        assert.equal(reached, 2)
    })

    test('the policy list is frozen and one instance owns one wheel listener', () => {
        assert.ok(Object.isFrozen(WHEEL_POLICIES))
        assert.throws(() => WHEEL_POLICIES.push('sometimes'), TypeError)
        const { canvas, controls } = controlsOf({ wheel: 'none' })
        // The policy is a closure, not a live knob: reassignment could not reach it.
        assert.equal('input' in controls, false)
        assert.equal(canvas.count('wheel'), 1)
        // One install, in the constructor: the binding is owned, not stacked.
        assert.equal(typeof controls._onMouseWheel, 'function')
    })

    test('a bad mode is refused by the raw controls too, before any listener exists', () => {
        const canvas = fakeCanvas()
        const camera = new PerspectiveCamera(60, 4 / 3, 0.1, 10000)
        // Normalization runs before `super`, so nothing is built and nothing attaches.
        assert.throws(() => new DojoOrbitControls(camera, canvas, { wheel: 'sometimes' }),
            /input\.wheel must be one of always, modifier, none/)
        assert.equal(canvas.count('wheel'), 0)
        assert.equal(canvas.count('pointerdown'), 0)
    })
})
