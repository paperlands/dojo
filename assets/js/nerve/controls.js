// What the seat may SHOW, derived from facts. Never whether it will succeed.
// (id:outer-sill) Permission is the grant's and the stage's (dial.js::offers);
// this names the one verb painted, so the hand always asks for what it saw.

// The phase NAMES the seat even when it cannot act. (id:nav-core-sill)
const NAMES = {
    running: 'Pause',
    paused: 'Play',
    finished: 'Replay from beginning',
    fault: 'Execution stopped. Replay from beginning',
}

const PLAY = {
    running: { method: 'pause', permission: 'hold' },
    paused: { method: 'resume', permission: 'resume' },
    finished: { method: 'replay', permission: 'replay' },
    fault: { method: 'replay', permission: 'replay' },
}

// An absent fact is not a permission. Fail closed, always. (id:outer-sill)
// The offer carries the play's incarnation: a verb of the same name from a
// different play is not the verb the hand saw. (id:outer-sill-lifetime)
function offer(r, permission, method, verb) {
    if (!r?.can || r.can[permission] !== true) return null
    if (typeof r[method] !== 'function') return null
    return { verb, method, permission, key: r.key ?? null }
}

export function controlsOf(reading) {
    if (!reading) return { toggle: null, restart: null, name: NAMES.running }
    const phase = reading.phase
    const plan = PLAY[phase] ?? PLAY.fault
    return {
        toggle: offer(reading, plan.permission, plan.method, NAMES[phase] ?? NAMES.fault),
        restart: offer(reading, 'replay', 'replay', 'Restart from beginning'),
        name: NAMES[phase] ?? NAMES.fault,
    }
}

// Unpainted is not unpromised: `undefined` must always write. `null` on both
// sides is the same steady offer — two painted nothings are not a change.
export function sameVerb(a, b) {
    if (a === undefined || b === undefined) return false
    if (a == null || b == null) return a == null && b == null
    return a.method === b.method && a.verb === b.verb &&
        a.permission === b.permission && a.key === b.key
}
