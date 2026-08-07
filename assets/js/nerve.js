// Nerve — one write model (store), N read models (projections).
// Push once; route by source address. Residual = unclaimed; project() claims a peer.
// Content filter (matchPattern) is inside a projection — never address routing.

import { createSignalStore } from './nerve/store.js'
import { createHUD } from './nerve/hud.js'

// targets scopes navigation to this instance's editor/canvas. run() is the epoch boundary.
export function createNerve(container, pushEvent, targets) {
    const store = createSignalStore({ maxSignals: 200 })

    // Seat base is a pull, not a signal. Surface lends health when whole (inner.js).
    let healthOf = null
    const residual = createHUD(container, store, pushEvent, {
        targets,
        health: () => healthOf?.() ?? null,
        select: (s) => !store.claims.has(s.source),
    })

    // Claim one peer address so residual stops showing them. retarget switches peers.
    function project(panelEl, opts = {}) {
        let address = null
        const hud = createHUD(panelEl, store, opts.pushEvent || pushEvent, {
            targets: opts.targets,
            health: opts.health,  // friend's health — same seat law, other subject
            select: (s) => address != null && s.source === address,
        })
        return {
            refresh: hud.refresh,
            retarget(name) {
                const next = name ?? null
                if (next === address) return
                store.release(address)
                address = next
                store.claim(address)
            },
            destroy() {
                store.release(address)
                hud.destroy()
            },
        }
    }

    return {
        push: store.push,
        run: store.run,
        project,
        hud: residual,
        destroy: residual.destroy,
        // Lend residual health; returned release clears it when the surface dies.
        health(fn) {
            healthOf = fn
            residual.refresh()
            return () => { if (healthOf === fn) healthOf = null; residual.refresh() }
        },
        refresh: residual.refresh,
    }
}
