// Registry-of-one — the stage-cell idiom named once.
//
// One occupant. Register returns an unregister only its owner may exercise
// (a later mount wins). Register and release breathe: the signal says "ask
// again" and carries nothing — the signal law (id:cmp-query-cell). A cell
// nobody watches breathes into an empty room, which costs nothing, so there
// is no quiet variant to choose between.

import { createObservable } from "./observable.js"

// createCell() → { register, get, watch, changed }
export function createCell() {
    let current = null
    const breath = createObservable()

    function changed() {
        breath.notify() // no payload, ever
    }

    function register(occupant) {
        // Normalize ONCE, then guard against the normalized value: registering
        // nothing must still hand back an unregister that can fire (comparing
        // against the raw argument left `undefined` seated forever).
        const seated = occupant ?? null
        current = seated
        changed()
        return () => {
            if (current !== seated) return // a later mount won
            current = null
            changed()
        }
    }

    function get() {
        return current
    }

    function watch(fn) {
        return breath.watch(fn)
    }

    return { register, get, watch, changed }
}
