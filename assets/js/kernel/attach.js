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
    let binding = 0   // the winning claim's incarnation
    let dead = false

    const drop = () => { const r = release; release = null; r?.() }

    const rebind = () => {
        if (dead) return
        // Claim the era BEFORE touching anything; recheck ownership after the
        // release, before acquisition, and after it — a bind, a release or a
        // detach may reenter us, and the newest era alone may hold a claim.
        const mine = ++binding
        drop()
        if (dead || mine !== binding) return
        const occupant = get()
        if (!occupant) return
        if (dead || mine !== binding) return
        const claimed = bind(occupant) ?? null
        if (dead || mine !== binding) { claimed?.(); return }
        release = claimed
    }

    const unwatch = watch(rebind)
    rebind()

    return () => {
        if (dead) return
        dead = true
        binding += 1     // detachment invalidates in-progress claims
        unwatch()
        drop()
    }
}
