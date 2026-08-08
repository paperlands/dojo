// Helios — the world's weather as one glyph. Event, never state.
// Pure: walk pulls `read()`, no DOM/store. (id:output-ledger-r2-progress)
// Building is boolean — the sun walks its day, not a load bar. Faults are health (seat base).

// Glyph atoms — invent none at call sites.
export const CAST = Object.freeze({
    sky: '-',            // empty sky cell
    sunWhite: '☼',       // walking body (U+263C)
    sunBlack: '☀︎',      // resting body (U+2600 + VS15)
    dust: '⋆',           // low-sun sides (U+22C6; not ASCII *)
    markL: 'ˋ', markR: 'ˊ',
    flourishL: 'ˏ', flourishR: 'ˎ',  // success mid marks; no outer ˗
})

export const TRACK = 5   // path width (seats 0..4)
export const CENTER = 2  // high sun / rest seat

// East→west, then one night beat so the wrap reads as a new day, not a glitch.
/** @typedef {0|1|2|3|4|'night'} HeliosSky */
export const SKY = Object.freeze([0, 1, 2, 3, 4, 'night'])

export const SKY_DWELL_MS = 150     // hold per sky seat
export const SETTLE_DWELL_MS = 60   // hold per settle step

/** @typedef {'building'|'settled'} HeliosPhase */
/** @typedef {HeliosSky|'noon'|'success'} HeliosRungId */

/**
 * @typedef {object} HeliosProgress
 * @property {HeliosPhase} [phase]
 * @property {number} [lines]
 * @property {number} [commands]
 * @property {number} [ambients]
 * @property {number} [run] monotonic — a new run is a new sun
 */

/**
 * Truth bag for the adapter; not a signal. See signals.helios(view).
 * @typedef {object} HeliosView
 * @property {HeliosRungId} id
 * @property {string} glyph
 * @property {number} lines
 * @property {number} commands
 * @property {number} ambients
 * @property {HeliosPhase} phase
 */

/** @typedef {{ id: HeliosRungId, glyph: string, seat: number|null, body: string, sides: string, note: string }} HeliosRung */

// Grammar in one table — paint and tests read this shape.
export const LADDER = Object.freeze([
    Object.freeze({ id: 0,         glyph: '☼----',   seat: 0,      body: '☼',  sides: '—',     note: 'rises east' }),
    Object.freeze({ id: 1,         glyph: '⋆☼⋆--',   seat: 1,      body: '☼',  sides: '⋆ ⋆',   note: 'climbs · dust' }),
    Object.freeze({ id: 2,         glyph: '-ˋ☼ˊ-',   seat: 2,      body: '☼',  sides: 'ˋ ˊ',   note: 'high · calligraphic' }),
    Object.freeze({ id: 3,         glyph: '--⋆☼⋆',   seat: 3,      body: '☼',  sides: '⋆ ⋆',   note: 'falls · dust' }),
    Object.freeze({ id: 4,         glyph: '----☼',   seat: 4,      body: '☼',  sides: '—',     note: 'sets west' }),
    Object.freeze({ id: 'night',   glyph: '-----',   seat: null,   body: '',   sides: '',      note: 'under · and rises again' }),
    Object.freeze({ id: 'noon',    glyph: '-ˋ☀︎ˊ-',  seat: CENTER, body: '☀︎', sides: 'ˋ ˊ',   note: 'settled · comes to rest, ☼→☀︎' }),
    Object.freeze({ id: 'success', glyph: 'ˏˋ☀︎ˎˊ',  seat: CENTER, body: '☀︎', sides: 'ˏˋˎˊ',  note: 'holds · no outer ˗' }),
])

/** Fault is not weather — only building | settled. */
export function phaseOf(p = {}) {
    return p.phase === 'building' ? 'building' : 'settled'
}

// Truth says rest or up; the walk says where in the sky (world has no ratio).
export function rungIdFor(p = {}) {
    return phaseOf(p) === 'settled' ? 'success' : 0
}

/** Bare at horizons, dust climbing, marks at center. */
export function sideAt(seat) {
    if (seat === CENTER) return 'mark'
    if (seat <= 0 || seat >= TRACK - 1) return null
    return 'dust'
}

export function pathGlyph(pos, body, side) {
    const cells = Array(TRACK).fill(CAST.sky)
    const i = Math.max(0, Math.min(TRACK - 1, pos | 0))
    if (side === 'dust') {
        if (i - 1 >= 0) cells[i - 1] = CAST.dust
        if (i + 1 < TRACK) cells[i + 1] = CAST.dust
    } else if (side === 'mark') {
        if (i - 1 >= 0) cells[i - 1] = CAST.markL
        if (i + 1 < TRACK) cells[i + 1] = CAST.markR
    }
    cells[i] = body
    return cells.join('')
}

export function nightGlyph() {
    return CAST.sky.repeat(TRACK)
}

/** ˏˋ☀︎ˎˊ — no outer ˗. */
export function successGlyph() {
    return CAST.flourishL + CAST.markL + CAST.sunBlack + CAST.flourishR + CAST.markR
}

export function glyphForRung(id) {
    for (const r of LADDER) if (r.id === id) return r.glyph
    return LADDER[0].glyph  // unknown → rise east; never invent a seat
}

export function glyphFor(progress = {}) {
    return glyphForRung(rungIdFor(progress))
}

// Truth view: weather only. Counts ride as payload at the HUD, never in the glyph.
export function heliosView(progress = {}) {
    const phase = phaseOf(progress)
    const id = rungIdFor({ phase })
    return {
        id,
        glyph: glyphForRung(id),
        lines: progress.lines ?? 0,
        commands: progress.commands ?? 0,
        ambients: progress.ambients ?? 0,
        phase,
    }
}

// Display walk over building|settled. Pulls `read` (a held sample is stale).
// Speaks on edges only (view or null). Inject read/now for tests; shell owns timers.
// progress.run is sun identity — a tiny run that settles in one breath still rises.
export function createHeliosWalk(opts = {}) {
    const read = opts.read ?? (() => ({}))
    const skyMs = opts.skyMs ?? SKY_DWELL_MS
    const settleMs = opts.settleMs ?? SETTLE_DWELL_MS
    let step = null           // index into SKY; null before rise
    /** @type {HeliosRungId|null} */
    let shown = null
    let lastStepAt = 0
    /** @type {'idle'|'building'|'settling'} */
    let mode = 'idle'
    /** @type {number|null} */
    let lastRun = null
    let spoken = null         // last stamp — walk owns its edge

    /** @returns {HeliosView|null} view only when glyph or breath moved */
    function tick(now = 0) {
        const progress = read() ?? {}
        const truth = heliosView(progress)
        const run = progress.run ?? null

        // New run, or busy again under the same run → rise east.
        if (run !== lastRun || (truth.phase === 'building' && mode === 'idle')) {
            lastRun = run
            step = null
            shown = null
            lastStepAt = 0
            mode = 'building'
        }

        // Settled: head home. Shell keeps ticking while isAnimating().
        if (truth.phase === 'settled' && mode === 'building') {
            mode = 'settling'
            lastStepAt = shown === null ? 0 : now  // keep beat if already up
        }

        const view = mode === 'building' ? stepSky(truth, now)
                   : mode === 'settling' ? stepSettle(truth, now)
                   : hold(truth)

        // Edge = (run, glyph, breath). Same glyph re-run is news; living→rest is news.
        const stamp = `${run}|${view.glyph}${view.phase === 'building' ? '~' : ''}`
        if (stamp === spoken) return null
        spoken = stamp
        return view
    }

    function hold(truth) {
        shown = 'success'
        return viewAt(truth, 'success')
    }

    function rise(truth, now) {
        step = 0
        shown = SKY[0]
        lastStepAt = now
        return viewAt(truth, shown)
    }

    function nextSeat() {
        step = ((step ?? 0) + 1) % SKY.length
        shown = SKY[step]
    }

    function stepSky(truth, now) {
        if (shown === null || step === null) return rise(truth, now)
        if (now - lastStepAt >= skyMs) {
            nextSeat()
            lastStepAt = now
        }
        return viewAt(truth, shown)
    }

    // Along the day to noon, ☼→☀︎, flourish. Never reverse — a day runs one way.
    function stepSettle(truth, now) {
        if (shown === null || step === null) return rise(truth, now)
        if (now - lastStepAt < settleMs) return viewAt(truth, shown)
        lastStepAt = now

        if (shown === 'noon') {
            shown = 'success'
            mode = 'idle'
        } else if (shown === CENTER) {
            shown = 'noon'  // same seat; body settles ☼ → ☀︎
        } else {
            nextSeat()
        }
        return viewAt(truth, shown)
    }

    // Building always animates so the shell tick lives through quiet `wait`.
    function isAnimating() {
        if (mode === 'building') return true
        if (mode === 'settling') return shown !== 'success'
        return false
    }

    function nextDelayMs() {
        return mode === 'settling' ? settleMs : skyMs
    }

    function reset() {
        step = null
        shown = null
        lastStepAt = 0
        mode = 'idle'
        lastRun = null
        spoken = null
    }

    return {
        tick, reset, isAnimating, nextDelayMs,
        get mode() { return mode },
        get shown() { return shown },
    }
}

function viewAt(truth, id) {
    return {
        id,
        glyph: glyphForRung(id),
        lines: truth.lines,
        commands: truth.commands,
        ambients: truth.ambients,
        phase: truth.phase,
    }
}
