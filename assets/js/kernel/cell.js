// Registry-of-one — the stage-cell idiom named once.
//
// One occupant. Register returns an unregister only its owner may exercise
// (a later mount wins). Optional breath: register and release say "ask again"
// and carry nothing — the signal law (id:cmp-query-cell).

import { createObservable } from "./observable.js"

// createCell({ breathes }) → { register, get, watch, changed }
export function createCell({ breathes = false } = {}) {
    let current = null
    const breath = createObservable()

    function changed() {
        breath.notify() // no payload, ever
    }

    function register(occupant) {
        current = occupant ?? null
        if (breathes) changed()
        return () => {
            // Owner guard compares to the argument as given — same as the
            // three hand-rolls this lifts (a later mount wins).
            if (current === occupant) {
                current = null
                if (breathes) changed()
            }
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
