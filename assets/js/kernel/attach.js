// ATTACH — claim a cell's occupant for as long as it is the occupant.
//
// The problem: a seat can arrive LATE (shell mounts before #nerve-hud) and
// can be REPLACED under you (LiveView seats the successor before the
// incumbent dies). Claim-once, release-then-relend, bare thunk — three
// hand-rolls of the same sentence, three places for it to drift.
//
// bind(occupant) → release | undefined. Called for the standing occupant and
// again on every breath; the previous release always runs FIRST, so a claim
// never stacks and a departing occupant never leaves a live one behind.

export function attach({ get, watch }, bind) {
    let release = null
    let dead = false

    const drop = () => { const r = release; release = null; r?.() }

    const rebind = () => {
        if (dead) return
        drop()
        const occupant = get()
        if (occupant) release = bind(occupant) ?? null
    }

    const unwatch = watch(rebind)
    rebind()

    return () => {
        if (dead) return
        dead = true
        unwatch()
        drop()
    }
}
