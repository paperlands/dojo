// Signal Store — single source of truth for all nerve signals.
// Renderers subscribe and react. Only push() creates signals.
//
// CHANNELS is the vocabulary. Each channel defines its visual identity
// (zone, priority, fade duration, CSS class) and its signal constructor.
// Callers use signal constructors — never raw objects.

export const CHANNELS = {
    error:  { priority: 5, fadeMs: 60000, zone: 'status', css: 'nerve-error' },
    system: { priority: 4, fadeMs: 15000, zone: 'status', css: 'nerve-system' },
    output: { priority: 1, fadeMs: 4000,  zone: 'status', css: 'nerve-output' },
    chat:   { priority: 3, fadeMs: 12000, zone: 'chat',   css: 'nerve-chat' },
    eval:   { priority: 2, fadeMs: 8000,  zone: 'chat',   css: 'nerve-eval' },
    shout:  { priority: 1, fadeMs: 6000,  zone: 'chat',   css: 'nerve-shout' },
}

// ---------------------------------------------------------------------------
// Signal constructors — iconic form factor.
// Every signal is { msg, payload, source, kind, target, ref, tabId }.
// Constructors enforce shape; callers speak the vocabulary.
// ---------------------------------------------------------------------------

export const signals = {
    output:  (msg, payload)          => ({ msg, payload: String(payload), source: 'system', kind: 'output' }),
    error:   (msg, payload, ref)     => ({ msg, payload, source: 'system', kind: 'error', ref: ref ?? null }),
    system:  (msg, payload)          => ({ msg, payload: payload ?? null, source: 'system', kind: 'system' }),
    shout:   (source, msg, payload, tabId) => ({ msg, payload, source, kind: 'shout', tabId }),
    chat:    (source, msg, target)   => ({ msg, payload: null, source, kind: 'chat', target: target ?? null }),
    eval:    (source, msg, payload)  => ({ msg, payload: payload ?? null, source, kind: 'eval' }),
}

// ---------------------------------------------------------------------------
// Store — push/subscribe/mute. Pure runtime, no DOM.
// ---------------------------------------------------------------------------

export function createSignalStore(opts = {}) {
    const MAX = opts.maxSignals || 200
    const signals = []
    const subscribers = []
    const sources = new Set()
    const targets = new Set()
    const muted = new Set()
    let counter = 0
    let epoch = 0

    function run() { ++epoch }

    function push(raw) {
        const signal = {
            id:      ++counter,
            epoch,
            msg:     raw.msg ?? '',
            payload: raw.payload ?? null,
            target:  raw.target ?? null,
            source:  raw.source ?? '?',
            kind:    raw.kind ?? 'shout',
            ts:      performance.now(),
            ref:     raw.ref ?? null,
            tabId:   raw.tabId ?? null,
        }
        signals.unshift(signal)
        if (signals.length > MAX) signals.length = MAX

        if (signal.source && signal.source !== '?') sources.add(signal.source)
        if (signal.target) targets.add(signal.target)

        for (let i = 0; i < subscribers.length; i++) {
            subscribers[i](signal)
        }
    }

    function subscribe(fn) {
        subscribers.push(fn)
        return () => {
            const idx = subscribers.indexOf(fn)
            if (idx !== -1) subscribers.splice(idx, 1)
        }
    }

    function mute(kind) { muted.add(kind) }
    function unmute(kind) { muted.delete(kind) }
    function clear() { signals.length = 0 }

    return { push, subscribe, run, signals, sources, targets, muted, mute, unmute, clear, get epoch() { return epoch } }
}
