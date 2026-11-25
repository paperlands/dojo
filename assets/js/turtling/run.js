// A stopped walk succeeds only without fatal wounds; warnings do not reject.
// Count the seat's work, not the meta-root's. (id:host-runtime-play)

import { sumCounts } from "./scheduler.js"
import { ailmentsFor, verdict } from "../weave/queries.js"

export function completionOf(scheduler, seatKey) {
    if (!scheduler) return { done: false, commandCount: 0, wound: null }
    const seat = scheduler.root?.children?.get(seatKey) ?? null
    const wound = verdict(ailmentsFor(scheduler.errors, seatKey), seatKey).wound
    return {
        done: scheduler.done === true,
        commandCount: seat ? sumCounts(seat) : 0,
        wound,
    }
}

// Supersession and disposal are not wounds in the program. The reason is the
// machine-readable fact; the message stays the sentence the door already spoke.
export function halt(reason) {
    const message = reason === "disposed" ? "world disposed" : reason
    const err = new Error(message)
    err.reason = reason
    return err
}

export function refuse(wound) {
    // The sentence is the wound's own. The line stays on the span; a page
    // that wants a location reads the wound, it does not parse this message.
    const err = new Error(wound ? wound.message : "program failed")
    err.reason = "fatal"
    if (wound) err.wound = wound
    return err
}

// One observer for every play of a world. It reads the current run. It does
// not wrap the previous callback, so a twentieth play is not twenty calls.
export function createRunWatch(read) {
    let current = null
    return {
        begin(run) { current = run },
        clear() { current = null },
        look() {
            const run = current
            if (!run || run.settled) return
            const snap = read()
            if (!snap.done) return
            run.settled = true
            current = null
            if (snap.wound) run.reject(refuse(snap.wound))
            else run.resolve({ commandCount: snap.commandCount })
        },
    }
}
