// Timeslice budget via AIMD (TCP congestion control prior): down fast, up slow.
// Rate only — pure, injected clock. (D027 R2, id:output-ledger-r2-pacer)

const DEFAULTS = {
    targetMs: 1000 / 60,  // frame we must not blow (author-felt jank)
    startMs: 4,           // opening quantum bid
    minMs: 0.5,           // never starve the pump (zero → never finishes)
    maxMs: 8,             // never take the whole frame (render needs half)
    cut: 0.5,             // multiplicative decrease on overrun
    growMs: 0.5,          // additive increase when calm
    calmRatio: 0.8,       // hysteresis band — hold between calm and target
}

export function createPacer(opts = {}) {
    const cfg = { ...DEFAULTS, ...opts }
    let budgetMs = clamp(cfg.startMs, cfg)

    return {
        get budgetMs() { return budgetMs },

        // One observation per frame: end-to-end wall cost.
        observe(frameMs) {
            if (!(frameMs >= 0)) return budgetMs
            if (frameMs > cfg.targetMs) {
                budgetMs = clamp(budgetMs * cfg.cut, cfg)
            } else if (frameMs < cfg.targetMs * cfg.calmRatio) {
                budgetMs = clamp(budgetMs + cfg.growMs, cfg)
            }
            return budgetMs
        },

        // Tab wake / idle-out is not a slow device — do not cut the quantum.
        skip() { return budgetMs },

        reset() { budgetMs = clamp(cfg.startMs, cfg) },
    }
}

function clamp(ms, cfg) {
    return Math.min(cfg.maxMs, Math.max(cfg.minMs, ms))
}
