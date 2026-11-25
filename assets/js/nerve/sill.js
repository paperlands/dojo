// Draws the pulled reading. A click runs the painted intent; the shell re-asks.
// (id:nav-core-sill)
import { createEffect, pulse, whenDone } from '../kernel/motion.js'
import { controlsOf, sameVerb } from './controls.js'

const WINDOW_MS = 2500
const TICK_MS = 500
// Fallback if the exit animation never ends.
const EXIT_MS = 700
const clockArc = u => 27 - 60 * u * (1 - u)
const clockX = u => 4 + 244 * u

// Each mount owns its gradient target. (id:outer-sill)
let SILLS = 0

export function mountSill(el, { read }) {
    if (!el) return { paint() {}, destroy() {} }
    el.classList.add('nerve-sill')
    const rim = `sill-rim-fade-${++SILLS}`
    el.innerHTML = `
      <button type="button" class="sill-winder" aria-label="Restart from beginning">
        <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4.4 13.6A6.35 6.35 0 1 0 3.25 6.35M2.55 3.65 3.25 6.35 6.05 5.55"/><path class="sill-hands" d="M9 5.65V9L11.4 10.25"/></svg>
      </button>
      <button type="button" class="sill-dial" aria-label="Pause">
        <svg class="sill-arc" viewBox="0 0 252 35" aria-hidden="true">
          <defs><linearGradient class="sill-rim-fade" id="${rim}">
            <stop stop-opacity=".48"/>
            <stop offset=".5" class="sill-rim-reflection" stop-opacity=".6"/>
            <stop offset="1" stop-opacity="0"/>
          </linearGradient></defs>
          <path class="sill-rim" stroke="url(#${rim})" d="M4 27Q126 -3 248 27"/>
          <path class="sill-ticks"/><path class="sill-shadow" d="M126 12l3.5 9"/><path class="sill-cut" d="M126 4v12"/>
        </svg>
      </button>
      <span class="sill-time"><span></span><small>s</small>
        <svg class="sill-action" viewBox="0 0 16 16" aria-hidden="true"><path class="sill-play" d="M5 3.5 12 8 5 12.5Z"/><path class="sill-pause" d="M6 4v8m4-8v8"/></svg>
      </span>`
    const winder = el.querySelector('.sill-winder')
    const dial = el.querySelector('.sill-dial')
    const ticks = el.querySelector('.sill-ticks')
    const time = el.querySelector('.sill-time span')
    let dead = false
    let painted = null
    // TWO transients, ONE lifetime convention: a start supersedes, an end
    // retires, and a completion only writes while its own start stands.
    // (id:outer-sill-lifetime)
    const beat = createEffect()
    const sunset = createEffect()

    // A successor takes presentation it OWNS. A predecessor may have left a glow
    // or an exit on the shared host, with a completion that can no longer write
    // here — so the state must not be inherited either. (id:outer-sill-lifetime)
    el.classList.remove('is-rewinding', 'is-leaving')
    el.removeAttribute('inert')

    const calm = () => typeof matchMedia === 'function' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches

    function vanish() {
        // A late sunset must not write a successor's host. (id:outer-sill-lifetime)
        sunset.end()
        if (!owned()) return
        el.classList.remove('is-leaving', 'is-caught')
        el.removeAttribute('inert')
        // A hidden instrument advertises no play. (id:outer-sill)
        delete el.dataset.playback
        painted = null
        el.hidden = true
    }

    function revive() {
        if (!el.classList.contains('is-leaving')) return
        sunset.end()
        el.classList.remove('is-leaving')
        el.removeAttribute('inert')
    }

    function hide() {
        painted = null
        // A beat outlives no instrument: the glow is this play's, not the next
        // one's. Cancel it here, where the reading it belonged to dies.
        // (id:outer-sill-lifetime)
        // Only touch the host when there is an effect to retire: a concealment
        // that writes nothing must record nothing. (id:outer-sill)
        if (el.classList.contains('is-rewinding')) {
            beat.end()
            el.classList.remove('is-rewinding')
        }
        if (el.hidden || el.classList.contains('is-leaving')) return
        if (calm()) return vanish()   // reduced motion: no sunset, and no linger
        sunset.start((fenced) => {
            el.classList.add('is-leaving')
            el.setAttribute('inert', '')
            // A late completion is not a statement about a successor.
            return whenDone(el, { animation: 'sill-exit', ms: EXIT_MS }, () => {
                if (fenced()) vanish()
            })
        })
    }
    // Still our nodes? A successor may own the element. (id:outer-sill-lifetime)
    const owned = () => el.contains(winder)

    function paint() {
        if (dead || !owned()) return
        const r = read()
        if (!r) return hide()
        // An instant the reader never supplied is not invented as zero: the
        // instrument says nothing rather than a wrong time. (id:outer-sill)
        if (!Number.isFinite(r.ms) || r.ms < 0) return hide()
        revive()
        const step = Math.round(r.ms / 100)
        if (painted?.step !== step) {
            const origin = step * 100 - WINDOW_MS / 2
            let d = ''
            for (let beat = Math.max(0, Math.ceil(origin / TICK_MS)); beat * TICK_MS < origin + WINDOW_MS; beat++) {
                const u = (beat * TICK_MS - origin) / WINDOW_MS
                if (u > .94) break
                d += `M${clockX(u).toFixed(1)} ${clockArc(u).toFixed(1)}v-${beat % 2 ? 3 : 5}`
            }
            ticks.setAttribute('d', d)
            time.textContent = (step / 10).toFixed(1)
        }
        if (painted?.caught !== r.caught) el.classList.toggle('is-caught', r.caught === true)
        const shown = controlsOf(r)
        if (painted?.phase !== r.phase) {
            el.dataset.playback = r.phase
            el.classList.toggle('is-resting', r.phase !== 'running')
            // The seat stays named whether or not it may act. (id:nav-core-sill)
            dial.setAttribute('aria-label', shown.name)
        }
        // A control that cannot act says so, and an absent fact is not a grant.
        // (id:outer-sill)
        if (!sameVerb(painted?.toggle, shown.toggle)) dial.disabled = shown.toggle == null
        if (!sameVerb(painted?.restart, shown.restart)) winder.disabled = shown.restart == null
        painted = {
            step, phase: r.phase, caught: r.caught,
            toggle: shown.toggle, restart: shown.restart,
        }
        if (el.hidden) el.hidden = false
    }
    // A PRESS MEANS THE CONTROL, NOT THE WORD IT WORE. The seat may have moved
    // under the hand; the act follows the offer standing when it lands — a
    // toggle has a current state, not an opposite — and the gold says it moved.
    // Admission stays below, in dial.js. (id:nav-core-sill)
    function invoke(kind) {
        if (dead || !owned()) return false
        const r = read()
        const now = controlsOf(r)[kind]
        const seen = painted?.[kind]
        if (!now) { paint(); return { done: false, moved: false } }   // no offer, no act
        const moved = seen != null && !sameVerb(seen, now)
        const done = r[now.method]() === true
        paint()
        if (done && moved) acknowledge()
        return { done, moved }
    }

    // The beat belongs to the reading that earned it: absent instrument, dead
    // mount, or a successor's host means no beat at all. (id:outer-sill-lifetime)
    function acknowledge() {
        if (dead || !owned() || painted == null) return
        beat.start((fenced) => {
            // A second accepted rewind must RESTART the named one-shot, not merely
            // extend a class that is already there. (id:nav-core-sill)
            pulse(el, 'is-rewinding', { names: ['sill-rewind'], within: '.sill-winder' })
            const timer = setTimeout(() => {
                if (fenced() && owned()) el.classList.remove('is-rewinding')
            }, 560)
            return () => clearTimeout(timer)
        })
    }

    // The winder's own gesture, and never a second beat for the same press. A
    // replay that died with its reading donates no glow. (id:outer-sill-lifetime)
    function replay() {
        const { done, moved } = invoke('restart')
        if (done && !moved && painted != null) acknowledge()
    }

    function toggle() { invoke('toggle') }

    winder.addEventListener('click', replay)
    dial.addEventListener('click', toggle)

    return {
        paint,
        destroy() {
            dead = true
            // Retire first: a late completion writes nothing.
            beat.end()
            sunset.end()
            winder.removeEventListener('click', replay)
            dial.removeEventListener('click', toggle)
            // A dead sill does not write a successor's host. (id:outer-sill-lifetime)
            if (!owned()) return
            el.classList.remove('is-rewinding', 'is-leaving')
            el.removeAttribute('inert')
            el.replaceChildren()
            el.hidden = true
        },
    }
}
