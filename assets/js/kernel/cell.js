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
    let seat = 0      // the winning registration's incarnation
    const breath = createObservable()

    function changed() {
        breath.notify() // no payload, ever
    }

    function register(occupant) {
        // Normalize ONCE. Ownership is the REGISTRATION's incarnation, never
        // the occupant's value: re-registering the same object must not let
        // the first unregister evict the second.
        const seated = occupant ?? null
        const mine = ++seat
        current = seated
        changed()
        return () => {
            if (mine !== seat) return // a later mount won — or already fired
            seat += 1
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
