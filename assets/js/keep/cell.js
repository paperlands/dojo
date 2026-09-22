// Keep cell — page door + answered ask (id:kb-3-owner, id:kc-p-join).
// One door per page; the river never opens a second journal worker.
// touched: empty fold breath. askKeep: valued edge, Promise answer.
// Ask carries letters (shell passes session name) and, on a peer fork, their root + name.

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
 * Ask once: `{ title, prev?, name?, peer? }`. Answered with id or null (never hangs).
 * Letters come from the shell (session); peer only when the caller has one (outershell fork).
 * @param {string} title
 * @param {{ prev?: string | null, name?: string | null, peer?: { root: string, name: string } | null }} [opts]
 * @returns {Promise<string | null>}
 */
export async function askKeep(title, { prev = null, name = null, peer = null } = {}) {
    const keeper = keeperCell.get()
    if (!keeper) return null
    const ask = { title }
    if (typeof prev === "string" && prev) ask.prev = prev
    if (typeof name === "string" && name) ask.name = name
    if (
        peer &&
        typeof peer.root === "string" &&
        peer.root &&
        typeof peer.name === "string" &&
        peer.name
    ) {
        ask.peer = { root: peer.root, name: peer.name }
    }
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

/**
 * Peer on an outershell-forked buffer — root + letters for signature_of.
 * Letters: live presence name by addr when present; origin.name only if presence is gone.
 * Self forks / blank tabs have no origin.root → null (linear).
 * @param {{ currentOrigin?: () => { root?: string, name?: string, addr?: string } | null } | null | undefined} shell
 * @param {{ presenceName?: (addr: string) => string | null | undefined }} [opts]
 * @returns {{ root: string, name: string } | null}
 */
export function peerOf(shell, { presenceName } = {}) {
    const origin = shell?.currentOrigin?.()
    if (!origin || typeof origin.root !== "string" || !origin.root) return null

    const addr = typeof origin.addr === "string" && origin.addr ? origin.addr : null
    let letters = null
    if (addr) {
        const live =
            typeof presenceName === "function" ? presenceName(addr) : livePresenceName(addr)
        if (typeof live === "string" && live) letters = live
    }
    // Presence gone (or no addr to look up) → frozen origin.name.
    if (!letters && typeof origin.name === "string" && origin.name) letters = origin.name
    if (!letters) return null
    return { root: origin.root, name: letters }
}

/** Living seat in the disciple strip — presence letters by addr. */
function livePresenceName(addr) {
    try {
        if (typeof document === "undefined") return null
        const safe =
            typeof CSS !== "undefined" && typeof CSS.escape === "function"
                ? CSS.escape(addr)
                : addr.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
        const seat = document.querySelector(`[data-disciple][phx-value-addr="${safe}"]`)
        const text = seat?.querySelector(".name")?.textContent?.trim()
        return text || null
    } catch {
        return null
    }
}
