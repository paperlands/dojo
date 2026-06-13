// Nerve — one write model (the store), N read models (projections).
//
// Every signal is pushed once into the store; producers never choose a
// destination. Projections route by ADDRESS (a signal's `source` name):
//   - the default projection is RESIDUAL — it shows every signal whose address
//     no panel has claimed (your own ambients, system output, chat).
//   - project(panelEl, …) mounts a CLAIMANT projection for one peer address;
//     while claimed, that peer's signals route there instead of the residual.
// Content filtering (matchPattern / the `[t]` filter) is a separate concern,
// layered inside a projection — never conflated with this address routing.

import { createSignalStore } from './nerve/store.js'
import { createHUD } from './nerve/hud.js'

// `targets` (optional) scopes the residual projection's navigation to its own
// editor/canvas; omit for the core surfaces. `run()` marks an execution-epoch
// boundary — part of the nerve's surface, so callers never reach for the store.
export function createNerve(container, pushEvent, targets) {
    const store = createSignalStore({ maxSignals: 200 })

    const residual = createHUD(container, store, pushEvent, {
        targets,
        select: (s) => !store.claims.has(s.source),
    })

    // A peer projection renders only its claimed address, and holds that claim
    // on the store so the residual stops showing it. retarget() switches peers
    // (e.g. when the outershell follows a different disciple).
    function project(panelEl, opts = {}) {
        let address = null
        const hud = createHUD(panelEl, store, opts.pushEvent || pushEvent, {
            targets: opts.targets,
            select: (s) => address != null && s.source === address,
        })
        return {
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
    }
}
