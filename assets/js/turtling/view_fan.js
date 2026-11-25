// A frame fan on the kernel's one breath: liveness at delivery, add-waits,
// and one throwing callback never stops its siblings. Registration wakes one
// frame. (id:host-embedding-slice-1-view)
import { createObservable } from "../kernel/observable.js"

export function createViewFan(wake = null) {
    const breath = createObservable()
    const offs = new Set()
    let failures = []

    return {
        watch(fn) {
            if (typeof fn !== "function") throw new TypeError("a frame observer needs a callback")
            const wrapped = (payload) => {
                try { fn(payload) } catch (error) { failures.push(error) }
            }
            const stop = breath.watch(wrapped)
            const release = () => { offs.delete(release); stop() }
            offs.add(release)
            wake?.()
            return release
        },

        notify(payload) {
            breath.notify(payload)
            if (!failures.length) return
            const errors = failures
            failures = []
            if (errors.length === 1) throw errors[0]
            throw new AggregateError(errors, "view frame observers failed")
        },

        clear() { for (const off of [...offs]) off() },

        get size() { return offs.size },
    }
}
