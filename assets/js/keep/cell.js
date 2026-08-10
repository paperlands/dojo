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
 * Ask for this moment to be kept. The ask IS one value (kb-vet4 33):
 * `{ title, prev? }` — prev only when forking from a draft parent.
 * Not a boolean beside a title beside a side-channel prev.
 *
 * @param {string} title
 * @param {{ prev?: string | null }} [opts] - parent keep id when committing a draft fork
 */
export function askKeep(title, { prev = null } = {}) {
    const ask = { title }
    if (typeof prev === "string" && prev) ask.prev = prev
    asking.notify(ask)
}

export function watchAsk(fn) {
    return asking.watch(fn)
}
