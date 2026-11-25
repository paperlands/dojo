// A source breakpoint on the play: resolve an accepted statement, stop the
// executor at that node boundary before it runs, and take the caller's scoped
// hold after materialization. Continue passes that node once; the breakpoint
// stays armed. Top-level statements and loop bodies only; function bodies are
// not claimed. (id:nav-core-sill)

function siteIn(frame, line) {
    const stack = [...(frame?.seed?.ast ?? [])]
    while (stack.length > 0) {
        const node = stack.pop()
        if (!node || typeof node !== 'object') continue
        if (Array.isArray(node)) { stack.push(...node); continue }
        if (node.type === 'Loop') {
            for (const key of ['body', 'children']) if (Array.isArray(node[key])) stack.push(...node[key])
            continue
        }
        if (node.type && node.span?.line === line) return node
    }
    return null
}

// Can this seat catch this line? A finished or paused drawing still answers.
export function catchSite(turtle, seat, line) {
    const frame = turtle?.scheduler?.root?.children?.get(seat) ?? null
    const node = frame && siteIn(frame, line)
    return node ? { line: node.span.line, type: node.type } : null
}

// The caller owns the lease; `cancel`/`resume` release only the receipt it got.
// No timer and no public observer: the compositor's normal drive carries it.
export function createPlayCatch(turtle, { seat, line, hold = null, release = null, witness = null } = {}) {
    const schedulerOf = () => turtle?.scheduler ?? null
    const compositorOf = () => turtle?.compositor ?? null
    let state = 'off'          // off | armed | waiting | hit | waiting-hold | paused | stale | unreachable | cancelled
    let site = null
    let frame = null
    let run = null
    let instant = null
    let matched = false
    let lastEligible = null
    let receipt = null
    let unwatch = null
    let boundScheduler = null
    let boundCompositor = null
    let pendingBreak = false

    const frontier = () => {
        const scheduler = schedulerOf()
        if (!scheduler) return Infinity
        let next = Infinity
        for (const f of scheduler.registry.values()) {
            if (f === scheduler.root || f.done) continue
            if (f.resumeAt < next) next = f.resumeAt
        }
        return next
    }

    const nodeAt = target => siteIn(target, line)
    const setBreak = value => { if (frame?.batch) frame.batch.breakLine = value }

    const detach = (name) => {
        if (unwatch) { unwatch(); unwatch = null }
        if (receipt != null) {
            const held = receipt
            receipt = null
            try { release?.(held) } catch { /* release is the caller's */ }
        }
        setBreak(null)
        pendingBreak = false
        state = name
        return true
    }

    // PURE: does this catch still bind the play it was armed on? A READER asks this
    // to describe the arm; only an EDGE may retire it. Asking used to detach, so
    // `catchReading()` destroyed the arm it was describing — and then reported the
    // row available. Reads are not commands. (id:nav-core-sill)
    const stale = () => {
        // A drive can land between the editor's transaction and any notification. Ask
        // the source site itself, so a stop cannot fire on an arm whose document is
        // gone. (id:nav-core-sill)
        if (witness != null && witness() !== true) return true
        const scheduler = schedulerOf()
        if (!frame || !scheduler) return false
        if (scheduler !== boundScheduler || compositorOf() !== boundCompositor) return true
        if (scheduler.root.children.size !== 1) return true
        return scheduler.root.children.get(seat) !== frame || frame.run !== run
    }
    // Retirement happens on edges that already exist: a drive pass, or a cancel.
    const checkStale = () => (stale() ? detach('stale') : false)

    const handle = {
        get armed() { return (state === 'armed' || state === 'waiting') && receipt == null },
        get instant() { return instant },
        get eligible() {
            if (checkStale()) return Infinity
            if (matched) { lastEligible = instant; return instant }
            const next = frontier()
            if (!Number.isFinite(next) && schedulerOf()?.done) { detach('unreachable'); return Infinity }
            lastEligible = next
            return next
        },
        get held() { return receipt != null },
        get receipt() { return receipt },
        get breakpointHit() { return pendingBreak },
        sink(ambient, event) {
            // The DRIVE is where a stale arm is retired — not a reader, not a gutter.
            if (checkStale()) return
            if (!handle.armed || matched || ambient !== frame) return
            if (event?.type !== 'breakpoint' || event.line !== line) return
            matched = true
            pendingBreak = true
            instant = lastEligible
            state = 'waiting'
        },
        // The one lease edge: after the pump and materialization, before observers.
        settle() {
            if (!matched || receipt != null || checkStale()) return
            const scheduler = schedulerOf()
            if (!scheduler || instant == null) return
            if (!pendingBreak && (!scheduler.isSettledThrough(instant) || !scheduler.atCut)) { state = 'waiting'; return }
            receipt = hold ? hold() : null
            state = receipt != null ? 'hit' : 'waiting-hold'
            // Never leave a finished play pretending to be caught without a lease.
            if (receipt == null && scheduler.done) detach('unreachable')
        },
        arm() {
            handle.cancel()
            const scheduler = schedulerOf()
            const compositor = compositorOf()
            if (!scheduler || !compositor) return handle.read()
            boundScheduler = scheduler
            boundCompositor = compositor
            if (compositor.held || scheduler.held) { state = 'paused'; return handle.read() }
            frame = scheduler.root.children.get(seat) ?? null
            if (!frame) { state = 'unreachable'; return handle.read() }
            run = frame.run
            site = nodeAt(frame)
            if (!site) { state = 'unreachable'; return handle.read() }
            matched = false; instant = null; receipt = null; lastEligible = null
            state = 'armed'
            pendingBreak = false
            setBreak(line)
            unwatch = compositor.watchCatch(handle)
            turtle?.requestRender?.()
            return handle.read()
        },
        // A sample, not a step: report the binding, never break it.
        read() {
            return {
                state,
                stale: stale(),
                site: site ? { line: site.span?.line ?? line, type: site.type ?? null } : null,
                instant, authorizedH: schedulerOf()?.lastTickTime ?? null,
                held: receipt != null, receipt,
            }
        },
        cancel() {
            if (unwatch) { unwatch(); unwatch = null }
            if (receipt != null) {
                const held = receipt
                receipt = null
                try { release?.(held) } catch { /* release is the caller's */ }
            }
            setBreak(null)
            pendingBreak = false
            if (state !== 'off') state = 'cancelled'
            return handle.read()
        },
        resume() { return handle.cancel() },
    }
    return handle
}
