// Status seat — one slot, two layers (base wins). Prior: state vs event bus.
// base = health (pulled); event = weather (pushed, fades). (D022)
// health injected (own or peer). Never call at construct — surface refresh()s.

import { makeSlot, statusText, retrigger } from './slot.js'

// Base channel: no lifetime fade — a state ends when the document changes.
const BASE = Object.freeze({ fadeMs: 0, css: 'nerve-error' })

function heliosApex(signal) {
    return (signal?.msg ?? '').startsWith('ˏ')
}

// Same kind keeps the DOM node; only paint moves. Helios walks never flash-replace.
function sameSeat(a, b) {
    if (a.kind !== b.kind) return false
    if (a.kind === 'helios') return true  // (id:carving-todo-nerve)
    return statusText(a) === statusText(b)
}

/**
 * @param {object} zone status zone element
 * @param {{ health?: () => ({msg,payload,ref,tally}|null), nav?: (signal) => void }} opts
 */
export function createStatusSeat(zone, { health = () => null, nav = () => {} } = {}) {
    let event = null      // newest pushed signal until fade
    let fadeTimer = null
    let slot = null       // makeSlot result | null
    let fresh = false     // true on push — separates push from health re-ask
    const leaving = new Set()  // done thunks; el rides as done.el

    function armFade() {
        clearTimeout(fadeTimer)
        fadeTimer = null
        if (!event) return
        if (event.signal.kind === 'helios' && event.signal.living) return  // still building
        fadeTimer = setTimeout(() => { event = null; fadeTimer = null; render() },
                               event.ch.fadeMs)
    }

    function baseSignal(h) {
        return {
            msg: h.msg, payload: h.payload ?? null, source: 'system',
            kind: 'health', ref: h.ref ?? null, tally: h.tally ?? 0, living: false,
        }
    }

    // Asked each render, never remembered — base empties when health() says so.
    function want() {
        const h = health()
        if (h) return { signal: baseSignal(h), ch: BASE }
        return event
    }

    function render() {
        const next = want()
        if (!next) return retire()
        if (slot && sameSeat(slot.signal, next.signal)) {
            const arrived = fresh
            fresh = false
            slot.update(next.signal)
            if (next.signal.kind === 'helios') {
                slot.el.classList.remove('helios-exit', 'helios-arrive')
                light(slot.el, next.signal, arrived)
            }
            return
        }
        part()
        seat(next)
    }

    // Ghosts stay behind; zone's first child is truth.
    function seat(next) {
        const fade = next.ch.fadeMs > 0
        const s = makeSlot(next.signal, next.ch, {
            showSource: false,
            fade: next.signal.kind === 'health' ? true : fade,
        })
        // Health has no lifetime fade but still arrives gently (no nerve-no-fade).
        if (next.signal.kind === 'health') {
            s.el.style.removeProperty('--hud-fade')
            s.el.classList.add('error-arrive')
        }
        if (next.signal.ref) s.el.addEventListener('click', () => nav(next.signal))
        if (next.signal.kind === 'helios') {
            s.el.classList.add('helios-arrive')
            light(s.el, next.signal, true)
        }
        slot = s
        zone.appendChild(s.el)
        for (const d of leaving) {
            d.el.classList.add('nerve-part')
            zone.appendChild(d.el)
        }
    }

    function light(el, signal, changed) {
        el.classList.toggle('helios-living', signal.living === true)
        el.classList.toggle('helios-apex', heliosApex(signal))
        if (changed) retrigger(el, 'helios-lit')  // rung change only, not keep-alives
    }

    // Emptying (nothing follows) = long helios-exit; being taken = quick dissolve in part.
    function retire() {
        if (!slot) return
        if (slot.signal.kind !== 'helios') return clear()
        const el = slot.el
        slot = null
        el.classList.remove('helios-living')
        el.classList.add('helios-exit')
        leave(el, 'helios-exit', 700)
    }

    function part() {
        if (!slot) return
        const el = slot.el
        slot = null
        el.classList.remove('helios-living', 'helios-arrive', 'error-arrive')
        // nerve-part lifts out of flow; nerve-dissolve is the going.
        el.classList.add('nerve-part', 'nerve-dissolve')
        leave(el, 'nerve-dissolve', 400)
    }

    // Remove on animation end; timer if the animation is swallowed.
    function leave(el, animationName, fallbackMs) {
        let timer
        const done = () => {
            clearTimeout(timer)
            leaving.delete(done)
            el.remove()
        }
        done.el = el
        timer = setTimeout(done, fallbackMs)
        leaving.add(done)
        el.addEventListener('animationend',
            (e) => { if (e.animationName === animationName) done() }, { once: true })
    }

    function clear() {
        if (!slot) return
        slot.el.remove()
        slot = null
    }

    return {
        push(signal, ch) { event = { signal, ch }; fresh = true; armFade(); render() },
        refresh: render,  // health may have moved
        destroy() {
            clearTimeout(fadeTimer); fadeTimer = null; event = null
            for (const d of leaving) d()
            clear()
        },
    }
}
