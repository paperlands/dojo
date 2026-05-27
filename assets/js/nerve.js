// Nerve — read-only signal indicators.
// Composes store (data) + HUD (rendering).

import { createSignalStore } from './nerve/store.js'
import { createHUD } from './nerve/hud.js'

export function createNerve(container, pushEvent) {
    const store = createSignalStore({ maxSignals: 200 })
    const hud = createHUD(container, store, pushEvent)

    return {
        push: store.push,
        store,
        hud,
        destroy: hud.destroy
    }
}
