// Keep cell — page door + answered ask (id:kb-3-owner, id:kc-p-join).
// One door per page; the river never opens a second journal worker.
// touched: empty fold breath. askKeep: valued edge, Promise answer.

import { createCell } from "../kernel/cell.js"
import { createObservable } from "../kernel/observable.js"

const doorCell = createCell()
const keeperCell = createCell()
const folding = createObservable()

/** Seat the door for this page. Returns unregister. */
export function registerDoor(door) {
    return doorCell.register(door)
}

export function getDoor() {
    return doorCell.get()
}

/** {get, watch} — attach() shape (kernel/attach.js). */
export const doorSeat = {
    get: getDoor,
    watch: (fn) => doorCell.watch(fn),
}

/** Journal moved; river re-folds. */
export function touched() {
    folding.notify()
}

export function watchTouched(fn) {
    return folding.watch(fn)
}

/** Seat the machine that joins ask → mint. */
export function registerKeeper(keeper) {
    return keeperCell.register(keeper)
}

/**
 * Ask once: `{ title, prev? }`. Answered with id or null (never hangs).
 * @param {string} title
 * @param {{ prev?: string | null }} [opts]
 * @returns {Promise<string | null>}
 */
export async function askKeep(title, { prev = null } = {}) {
    const keeper = keeperCell.get()
    if (!keeper) return null
    const ask = { title }
    if (typeof prev === "string" && prev) ask.prev = prev
    try {
        return (await keeper(ask)) ?? null
    } catch (e) {
        // Drop is a fact, never an exception (id:kc-c-wire).
        try {
            console.warn("[keep] askKeep: keeper threw —", e?.message ?? e)
        } catch {
            /* nowhere to write */
        }
        return null
    }
}
