// Nerve — one write model (store), N read models (projections).
// Push once; route by claim. Residual = unclaimed; project() claims a peer.
// Content filter (matchPattern) lives inside a projection — never here.

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
        // THE UNCLAIMED REST — complement of every panel's claim, whatever axis
        // each claims on. Naming the axes here meant a third axis edited this
        // line too.
        select: (s) => !store.claimed(s),
    })

    // Claim one peer so residual stops showing them. retarget switches peers.
    // `place` is the second claim, held for the panel's life (a sun has no peer).
    function project(panelEl, opts = {}) {
        let address = null
        const place = opts.place ?? null
        // ONE PREDICATE, USED TWICE: panel renders what it selects; residual
        // excludes exactly that. Written once as select and again as two claim
        // calls on two indices — two spellings of one fact; retarget had to
        // keep them in step by hand.
        const mine = (s) => (address != null && s.source === address)
            || (place != null && s.place === place)
        const hud = createHUD(panelEl, store, opts.pushEvent || pushEvent, {
            targets: opts.targets,
            health: opts.health,  // friend's health — same seat law, other subject
            select: mine,
        })
        const unclaim = store.claimBy(mine)
        return {
            refresh: hud.refresh,
            // Predicate reads `address` live — retargeting is one write.
            retarget(name) { address = name ?? null },
            destroy() {
                unclaim()
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
