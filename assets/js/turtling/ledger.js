// Ink ledger — stock + ceilings. Prior: working-set accounting, not event count.
// charge/release like refcount on resident geometry. (id:output-ledger-r3-stock-flow)
// enforceResidency still reads park.cause; woundInk kills frames (id:carving-todo-ledger-stock).

export const MAX_RUN_SEGMENTS = 1_000_000      // per-run truth: "program too big" (id:output-ledger-r2-ceiling)
export const MAX_STAGE_SEGMENTS = 3_000_000    // stage residency: "device out of ink" (id:output-ledger-r2-residency)
export const MAX_RESIDENCY_STALL_MS = 2000     // wait on full stage before wound (id:output-ledger-r3-addressee)

export function createStock() {
    let resident = 0
    return {
        get resident() { return resident },
        get full() { return resident > MAX_STAGE_SEGMENTS },
        charge(n) { if (n > 0) resident += n },
        release(n) { if (n > 0) resident = Math.max(0, resident - n) },
    }
}

// Per-frame bill. Stage fullness is stock.full — not mirrored here.
export function createInk() {
    return { resident: 0 }
}

export function resetInk(frame, stock) {
    stock.release(frame.ink.resident)
    frame.ink.resident = 0
}

// Test seam: fill stage without drawing three million lines.
export function setResident(frame, stock, n) {
    stock.release(frame.ink.resident)
    frame.ink.resident = n
    stock.charge(n)
}

// kind:'ink' — a budget wound is never a walk error.
export function woundInk(ctx, message, span = null) {
    ctx.done = true
    ctx.generator = null
    ctx.error = { message, span: span ?? null, kind: 'ink' }
    ctx.channel.put({ type: 'error', ...ctx.error, ambientId: ctx.id })
}

// Charge run bill + stage stock. false when run ceiling wounds.
export function chargeInk(ctx, value, stock) {
    const ink = ctx.ink
    if (value.type === 'clear') {
        stock.release(ink.resident)
        ink.resident = 0
        return true
    }
    if (value.type !== 'path' || !value.points || value.points.length < 2) return true

    const segs = value.points.length - 1
    ink.resident += segs
    stock.charge(segs)

    if (ink.resident <= MAX_RUN_SEGMENTS) return true

    woundInk(ctx, `this world has drawn more than ${MAX_RUN_SEGMENTS} lines`,
        value.span ?? null)
    return false
}

// Residency park too long → wound the waiter (not the holder). One stock cell.
// (id:output-ledger-r3-addressee)
export function enforceResidency(registry, clock, stock) {
    const total = stock.resident
    if (!stock.full) return total

    const now = clock()
    for (const f of registry.values()) {
        const stall = f.park?.cause === 'residency' ? f.park : null
        if (!stall) continue
        if (stall.since === null) { stall.since = now; continue }
        if (!f.done && now - stall.since > MAX_RESIDENCY_STALL_MS) {
            woundInk(f, `the world is holding ${total} lines and has no room — this one has been waiting`)
        }
    }
    return total
}
