// Peek readers over an injected scheduler. (id:portal-peek)

import { matchPattern } from "./match.js"
import { resolveAddress } from "./focus.js"
import { commandsOf } from "./scheduler.js"

function findFrame(scheduler, ref) {
    const address = resolveAddress(scheduler, ref)
    if (address == null) return null
    if (address === scheduler.root?.address) return scheduler.root
    for (const frame of scheduler.registry.values()) {
        if (frame.address === address) return frame
    }
    return null
}

// Observable pulse of a live frame, or null. (id:portal-peek)
export function frameVitals(scheduler, name) {
    if (!scheduler) return null
    const frame = findFrame(scheduler, name)
    if (!frame) return null
    return {
        name: frame.name,
        address: frame.address ?? frame.name,
        elapsed: frame.elapsedTime ?? 0,
        commands: commandsOf(frame),
        letters: frame.mailbox?.length ?? 0,
        kin: frame.children?.size ?? 0,
        error: frame.error?.message ?? frame.error ?? null,
    }
}

// Building cursor: phase, lines, commands, which run — no fake total.
// No fault count: wounds are keyed by address (weave/queries), not here.
// (D027 R2, id:output-ledger-r2-progress)
export function worldProgress(scheduler) {
    if (!scheduler) return { phase: 'settled', lines: 0, commands: 0, ambients: 0, run: 0 }
    // One stage cell — read, never re-sum. (id:carving-todo-ledger-stock)
    const lines = scheduler.stock?.resident ?? 0
    let commands = 0
    let ambients = 0
    let run = 0
    for (const frame of scheduler.registry.values()) {
        commands += commandsOf(frame)  // live batch counts while it runs
        if (frame.run > run) run = frame.run
        // Root is the stage. Errored frames are done — stop counting.
        if (frame !== scheduler.root && !frame.done) ambients++
    }
    const phase = (scheduler.building || ambients > 0) ? 'building' : 'settled'
    return { phase, lines, commands, ambients, run }
}

// Live names matching a hole-pattern; root excluded. Same match law as when.
export function livingFamily(scheduler, pattern) {
    if (!scheduler || !pattern) return []
    const names = []
    for (const frame of scheduler.registry.values()) {
        if (frame === scheduler.root) continue
        if (typeof frame.name !== "string") continue
        if (matchPattern(pattern, frame.name) !== null) names.push(frame.name)
    }
    return names
}
