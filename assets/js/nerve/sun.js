// ONE SHELL'S SUN — the body that carries a pure helios walk (helios.js).
//
// The problem: a sun must keep walking through a quiet `wait` where no
// render breathes, so it needs its own timer. Written twice, once per shell,
// the pacing was two things to keep equal.
//
// `place` rides the signal because a sun NAMES NO PEER: every helios says
// 'system', and address routing alone sent every shell's sun to the residual —
// the outershell had no sun at all (id:nav-nerve-helios).
//
// A BODY, NOT A BREATH: a push notifies the seat, which pulls health()
// synchronously — wire this at BIRTH, after every organ a push will reach.

import { createHeliosWalk } from "./helios.js"
import { signals as S } from "./store.js"

/**
 * @param {object} o
 * @param {() => object} o.read   this shell's progress, at ask time
 * @param {string} o.place        which shell this sun belongs to
 * @param {() => {push: Function}|null} o.nerve  the seated nerve, asked each tick
 * @returns {{ tick: () => void, release: () => void }}
 */
export function mountSun({ read, place, nerve }) {
    const walk = createHeliosWalk({ read })
    let timer = null

    const tick = () => {
        const view = walk.tick(performance.now())
        if (view) nerve()?.push(S.helios(view, place))
        // One timer in flight. Re-arms while walking; stops when the day ends —
        // no interval to cancel on idle.
        if (timer == null && walk.isAnimating()) {
            timer = setTimeout(() => { timer = null; tick() }, walk.nextDelayMs())
        }
    }

    return {
        tick,
        release() { if (timer != null) clearTimeout(timer); timer = null },
    }
}
