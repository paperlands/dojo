// WHEN THE REFLECT IS HATCHED — pure hatch policy, THREE-free (the timeline.js
// law: testable without a GPU).
//
// ONE QUESTION, TWO ENDS (D025 R3). The server asks `reflect_changed?/2`; this
// asks the same sentence a frame at a time — would the watcher learn something
// new? First light, a running animation, a finished figure, a moved cursor, the
// keepalive: every one is that question. They differ only in how long a changed
// reflect waits its turn.
//
// Two words because the render loop needs both: `owed` says a hatch is still
// coming (keep the loop alive while the floor runs or the stage reads back);
// `reason` says hatch now.

// How long a change waits before it becomes a hatch. One half-second quiet.
export const BEAT = {
    // Fresh canvas: half a second of drawing before the first hatch.
    "first-light": 500,
    // ONE GLIMPSE mid-walk — a run is not a video feed; nothing re-arms after.
    alive: 500,
    // Still canvas: quiet from the CHANGE (not from last hatch). Keys postpone.
    settled: 500,
}

export const NOTHING = { owed: false, reason: null }

/**
 * @param {object} w the world, as the turtle sees it this frame
 * @param {number} w.now         performance.now()
 * @param {boolean} w.present    a compositor exists — there is a canvas to reflect
 * @param {boolean} w.mine       gate[self]: child's own canvas (D022). By the
 *   time a verdict is asked, permission is one bit — turtle.reflectGate is the
 *   witness fence (light-ladders-hatch-resolution).
 * @param {boolean} w.walking    a program is still running
 * @param {number} w.changedAt   when the reflect last changed
 * @param {number} w.lastHatchAt when the last hatch was taken (0 = never)
 * @param {number} w.firstDrawAt when this canvas first drew
 * @returns {{owed: boolean, reason: string|null}}
 */
export function hatchVerdict({ now, present, mine, walking, changedAt, lastHatchAt, firstDrawAt }) {
    if (!present || mine === false) return NOTHING
    // The last hatch already carries it — the watcher would learn nothing.
    if (changedAt <= lastHatchAt) return NOTHING
    const beat = !lastHatchAt ? "first-light" : walking ? "alive" : "settled"
    // settled: quiet from the change. first-light/alive: from draw / walk start.
    const since = beat === "settled"
        ? Math.max(firstDrawAt, changedAt)
        : Math.max(lastHatchAt, firstDrawAt, walking ? changedAt : 0)
    return { owed: true, reason: now - since >= BEAT[beat] ? beat : null }
}
