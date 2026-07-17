// The stage's pulse, read for the peek (editor/portals.js, id:portal-peek).
// Pure functions over an injected scheduler — no DOM, no THREE, headless-
// testable with a fake registry (the focus.js extraction law). The peek is a
// READER: it never advances a frame, never evaluates her code, and answers
// null when nobody is home.
//
// Two questions the code-space peek asks:
//   frameVitals   — a bare name in code (`shout coil`, `as coil do`) names a
//                   live frame: how is it doing RIGHT NOW?
//   livingFamily  — a quoted name with holes ('mice[i]') is a family at run
//                   time: who is alive that answers it? matchPattern is the
//                   ONE pattern law (match.js — the same scan `when` uses),
//                   never a second grammar.

import { matchPattern } from "./match.js"
import { resolveAddress } from "./focus.js"

// The live frame a reference names, or null — resolution THROUGH the one
// address law (focus.js), then the registry (the flat index).
function findFrame(scheduler, ref) {
    const address = resolveAddress(scheduler, ref)
    if (address == null) return null
    if (address === scheduler.root?.address) return scheduler.root
    for (const frame of scheduler.registry.values()) {
        if (frame.address === address) return frame
    }
    return null
}

// frameVitals(scheduler, name) → the frame's observable pulse, or null.
//   { name, address, elapsed, commands, letters, kin, error }
//   elapsed  — causal seconds walked (D011's clock, not the wall's)
//   commands — steps taken so far
//   letters  — mailbox depth (shouts waiting to be heard)
//   kin      — children spawned under it
//   error    — the frame's standing error message, or null
export function frameVitals(scheduler, name) {
    if (!scheduler) return null
    const frame = findFrame(scheduler, name)
    if (!frame) return null
    return {
        name: frame.name,
        address: frame.address ?? frame.name,
        elapsed: frame.elapsedTime ?? 0,
        commands: frame.commandCount ?? 0,
        letters: frame.mailbox?.length ?? 0,
        kin: frame.children?.size ?? 0,
        error: frame.error?.message ?? frame.error ?? null,
    }
}

// livingFamily(scheduler, pattern) → live ambient names the hole-pattern
// answers to, in registry order. 'mice[i]' finds mice1, mice2 — the
// interpolated family as it stands THIS moment. Root stays out (it is the
// stage, not a member); a pattern without holes still answers (the family
// of one).
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
