// The keep cell — one door, one breath (id:gw-t-dom-registry, id:cmp-query-cell).
//
// The coreshell opens the durability door because it owns the hatch that mints
// (id:kb-7). Every other reader — the river first — asks HERE rather than
// opening a second journal: two doors are two workers over one database, and
// the second one's genesis race is exactly what the mint's transaction fence
// exists to prevent (id:kb-3-owner).
//
// LAND CARRIES NOTHING. A keep entered the log; ask again. The id is not in
// the signal because the river derives the new seat by re-folding — a payload
// here would be a second, staler truth beside the fold (id:kc-p-fold).

import { createCell } from "../kernel/cell.js"
import { createObservable } from "../kernel/observable.js"

const doorCell = createCell()
const landing = createObservable()
const asking = createObservable()
// One pending parent for the next mint — the river's draft commit is a fork
// (id:kr-mirror). Taken once by the hatch path; never a durable field here.
let forkPrev = null

/** Seat the door for this page's lifetime. Returns its unregister. */
export function registerDoor(door) {
    return doorCell.register(door)
}

export function getDoor() {
    return doorCell.get()
}

/** {get, watch} — the shape attach() claims (kernel/attach.js). */
export const doorSeat = {
    get: getDoor,
    watch: (fn) => doorCell.watch(fn),
}

/** A keep landed. No payload, ever — the signal says "ask again". */
export function landed() {
    landing.notify()
}

export function watchLanded(fn) {
    return landing.watch(fn)
}

/**
 * Ask for this moment to be kept, with the child's word for it.
 *
 * The river holds the word; the coreshell holds the hatch that can answer —
 * the source, the picture, the ailments. So the ask carries the ONE thing the
 * answering shell cannot know, and nothing it already has.
 *
 * @param {string} title
 * @param {{ prev?: string | null }} [opts] - parent keep id when committing a draft fork
 */
export function askKeep(title, { prev = null } = {}) {
    forkPrev = typeof prev === "string" && prev ? prev : null
    asking.notify(title)
}

/** Consume the pending fork parent for the next keepSnap. Once only. */
export function takeForkPrev() {
    const p = forkPrev
    forkPrev = null
    return p
}

export function watchAsk(fn) {
    return asking.watch(fn)
}
