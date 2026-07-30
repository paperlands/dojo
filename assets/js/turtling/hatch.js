// WHEN THE REFLECT IS HATCHED — the whole hatch policy, pure and THREE-free
// (the timeline.js law: the logic is testable without a GPU).
//
// ONE QUESTION, TWO ENDS (D025 R3). The server asks `reflect_changed?/2`; this
// asks the same sentence a frame at a time — would the watcher learn something
// new? First light, a running animation, a finished figure, a moved cursor, the
// keepalive: every one of them is that question. They differ only in how long a
// changed reflect waits its turn.
//
// The verdict has two words because the render loop needs both: `owed` says a
// hatch is still coming (keep the loop alive, even while the floor runs or the
// stage is still reading back), `reason` says hatch now.

// How long a change waits before it becomes a hatch. The only durations here.
export const BEAT = {
    // Let a fresh canvas draw something worth reflecting before the first hatch.
    "first-light": 500,
    // ONE GLIMPSE, half a second into the walk — long enough for the figure to
    // be worth sending. A run carries its code and ONE snapshot; a loop that
    // runs for minutes is not a video feed, so nothing re-arms while it walks.
    alive: 500,
    // A still canvas hatches when something changes the reflect: the run ended,
    // the cursor moved, the keepalive came due. The floor is what keeps a person
    // typing from becoming a drumbeat.
    settled: 200,
}

export const NOTHING = { owed: false, reason: null }

/**
 * @param {object} w the world, as the turtle sees it this frame
 * @param {number} w.now         performance.now()
 * @param {boolean} w.present    a compositor exists — there is a canvas to reflect
 * @param {boolean} w.mine       the gate: this canvas is the child's own (D022)
 * @param {boolean} w.walking    a program is still running
 * @param {number} w.changedAt   when the reflect last changed
 * @param {number} w.lastHatchAt when the last hatch was taken (0 = never)
 * @param {number} w.firstDrawAt when this canvas first drew
 * @returns {{owed: boolean, reason: string|null}}
 */
export function hatchVerdict({ now, present, mine, walking, changedAt, lastHatchAt, firstDrawAt }) {
    if (!present || !mine) return NOTHING
    // The last hatch already carries it — the watcher would learn nothing.
    if (changedAt <= lastHatchAt) return NOTHING
    const beat = !lastHatchAt ? "first-light" : walking ? "alive" : "settled"
    // WHAT THE FLOOR IS MEASURED FROM. A still canvas waits out its floor from
    // the last hatch. A walking one waits from the change that set it walking,
    // so its one glimpse lands half a second INTO the run and not at the empty
    // first frame. Before any hatch, from the canvas's first draw — "half a
    // second of drawing", which is what first light always meant.
    const since = Math.max(lastHatchAt, firstDrawAt, walking ? changedAt : 0)
    return { owed: true, reason: now - since >= BEAT[beat] ? beat : null }
}
