// A registration owns the seat; an observer can only ask again. (id:cell-publication)
import { createObservable } from "./observable.js"

export function createCell() {
    let current = null
    const breath = createObservable()

    function changed() {
        breath.notify()
    }

    function register(occupant, adopt) {
        let mine = { occupant: occupant ?? null }
        const release = () => {
            const prior = mine
            mine = null
            if (prior == null || current !== prior) return
            current = null
            changed()
        }
        adopt?.(release)
        if (mine != null) {
            current = mine
            changed()
        }
        return release
    }

    function get() {
        return current?.occupant ?? null
    }

    function watch(fn) {
        if (typeof fn !== "function") throw new TypeError("cell: watcher must be a function")
        return breath.watch(() => {
            try { fn() } catch (error) {
                try { console.error("cell: watcher failed", error) } catch { /* reporting is not a veto */ }
            }
        })
    }

    return { register, get, watch, changed }
}
