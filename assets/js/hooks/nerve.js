// THE NERVE'S SEAT — registry-of-one (kernel/cell.js).
// Release is owner-guarded: a departing hook cannot null a live successor —
// LiveView mounts the replacement BEFORE destroying the old (nav-nerve-hook).

import { createCell } from '../kernel/cell.js'
import { createNerve } from '../nerve.js'
import { safePush } from '../adapter.js'

const cell = createCell()

// Ask each time; never hold the body. The seat can empty and refill under you.
export const nerve = () => cell.get()
// Hear it seat. A surface that mounts BEFORE the nerve's hook must wait,
// not ask once and give up.
export const watchNerve = (fn) => cell.watch(fn)
// The seat as one value — what kernel/attach.js needs to hold a claim across
// a reseating. get and watch always travel together; the cell stays private.
export const nerveSeat = { get: nerve, watch: watchNerve }

const NerveHook = {
    mounted() {
        const pushEvent = (event, payload) => safePush(this, event, payload)
        // Held on the hook, not the module: teardown destroys ITS OWN
        // instance even when a successor already holds the seat.
        const body = this.nerve = createNerve(this.el, pushEvent)
        cell.register(body, (release) => { this.release = release })
        if (cell.get() !== body) return

        // Inbound envelope: arrives whole — ts is the source's clock and rides
        // through (store.push honors it; gw-t-clock); received_at is the
        // server's annotation; ref the boundary residual.
        this.handleEvent("nerveIncoming", ({ kind, ...rest }) => {
            if (cell.get() === body) body.push({ ...rest, kind: kind || "chat" })
        })
    },

    destroyed() {
        const { release, nerve: body } = this
        this.release = null
        this.nerve = null
        release?.()
        body?.destroy()
    }
}

export default NerveHook
