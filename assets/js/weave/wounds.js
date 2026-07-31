// THE SURFACE'S WOUNDS — one ask, one breath, N readers (ink, voice, wash).
//
// ONE clock per surface: a reader that keeps its own paints twice per breath.
// And NO last answer is held here — early cutoff belongs to each reader, keyed
// on what that reader emits (a sentence, a span list, a word).

import { createObservable } from "../kernel/observable.js"
import { watchWorld } from "./world.js"

// changed() is news the world cell never hears — a push arriving, a draft going
// live. It reaches every reader.
export function readWounds({ ask }) {
    const breath = createObservable()
    const unwatch = watchWorld(() => breath.notify())

    return {
        // Never null: a surface with nothing to say says an empty list, so no
        // reader has to guard the call.
        read: () => ask() ?? [],
        watch: (fn) => breath.watch(fn),
        changed: () => breath.notify(),
        release: () => unwatch(),
    }
}
