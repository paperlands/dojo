// THE NERVE'S SEAT — a registry-of-one (kernel/cell.js), Registry for one name.
// Release is owner-guarded, so a departing hook cannot null a live successor:
// LiveView mounts the replacement BEFORE destroying the old (nav-nerve-hook).

import { createCell } from '../kernel/cell.js'
import { createNerve } from '../nerve.js'

const cell = createCell()

// Ask each time; never hold the body. The seat can empty and refill under you.
export const nerve = () => cell.get()
// Hear it seat. A surface that mounts BEFORE the nerve's hook must wait, not
// ask once and give up (outer.js claimNerve).
export const watchNerve = (fn) => cell.watch(fn)

const NerveHook = {
    mounted() {
        const pushEvent = (event, payload) => this.pushEvent(event, payload)
        // Held on the hook, not in the module: teardown destroys ITS OWN
        // instance even when a successor already holds the seat.
        this.nerve = createNerve(this.el, pushEvent)
        this.release = cell.register(this.nerve)

        // pushEvent ↔ envelope adapter (inbound half): the envelope arrives
        // structurally whole — ts is the source's clock and rides through
        // (store.push honors it; gw-t-clock), received_at is the server's
        // annotation, ref the boundary residual.
        this.handleEvent("nerveIncoming", ({ kind, ...rest }) => {
            this.nerve.push({ ...rest, kind: kind || "chat" })
        })
    },

    destroyed() {
        this.release?.()        // no-op if a later mount already took the seat
        this.nerve?.destroy()   // but this one is ours, and its element is gone
        this.nerve = null
    }
}

export default NerveHook
