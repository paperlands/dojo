// One claim at a time. The seat's watch registers without delivering. (id:cell-publication)
export function attach({ get, watch }, bind, adopt) {
    let release = null
    let binding = 0
    let dead = false
    let unwatch = null

    const drop = () => { const r = release; release = null; r?.() }

    const rebind = () => {
        if (dead) return
        const mine = ++binding
        drop()
        if (dead || mine !== binding) return
        const occupant = get()
        if (!occupant || dead || mine !== binding) return
        const claimed = bind(occupant) ?? null
        if (dead || mine !== binding) { claimed?.(); return }
        release = claimed
    }

    const detach = () => {
        if (dead) return
        dead = true
        const off = unwatch
        unwatch = null
        try { off?.() } finally { drop() }
    }

    try {
        adopt?.(detach)
        if (!dead) {
            unwatch = watch(rebind)
            rebind()
        }
    } catch (error) {
        try { detach() } catch (cleanup) {
            throw new AggregateError([error, cleanup], "attach: setup and release failed")
        }
        throw error
    }
    return detach
}
