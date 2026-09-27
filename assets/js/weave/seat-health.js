// THE SEAT BASE — one law, every surface.
//
// The problem: a seat is PULLED, never pushed. The nerve asks for standing
// health on refresh; nothing is sent. Written twice (once per shell), it
// differed only in whose wounds and whose subject — two places for one
// sentence to drift.
//
// Names the document's own wound when there is one (primaryWound); tally is
// how many are worth saying out loud (announcements).

import { primaryWound, announcements } from "./queries.js"
import { sayWound } from "./wound-view.js"

/**
 * @param {object} o
 * @param {() => Array} o.wounds   this surface's standing wounds, at ask time
 * @param {() => string|null} o.subject  the addr this seat speaks for
 * @param {() => boolean} [o.mute]  true when nothing TRUE can be said —
 *   a frozen draft has run nothing of ours, so there is no runtime to report.
 * @returns {() => object|null}
 */
export function seatHealth({ wounds, subject, mute }) {
    return () => {
        if (mute?.()) return null
        const found = wounds()
        const w = primaryWound(found, subject())
        if (!w) return null
        return {
            msg: "*",
            payload: sayWound(w),
            ref: w.span?.line ? { line: w.span.line } : null,
            tally: announcements(found).length,
        }
    }
}
