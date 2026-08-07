// Signal store — only push() creates; renderers subscribe. Pure, no DOM.
// CHANNELS = vocabulary (zone, fade, css). Callers use constructors, not raw bags.
// No error channel: wounds are health the seat pulls (D022). priority is chat-only.
//
// Routing is a CLAIM: a panel registers the predicate that says which signals
// are its own; residual is whatever no predicate claimed. Content filtering
// (matchPattern) lives inside a projection, never here.

import { createObservable } from "../kernel/observable.js"

export const CHANNELS = {
    system: { fadeMs: 15000, zone: 'status', css: 'nerve-system' },
    // Dedicated kind: monospaced glyph, independent mute; edges only.
    helios: { fadeMs: 12000, zone: 'status', css: 'nerve-helios' },
    output: { fadeMs: 4000,  zone: 'status', css: 'nerve-output' },
    chat:   { priority: 3, fadeMs: 12000, zone: 'chat',   css: 'nerve-chat' },
    eval:   { priority: 2, fadeMs: 8000,  zone: 'chat',   css: 'nerve-eval' },
    shout:  { priority: 1, fadeMs: 6000,  zone: 'chat',   css: 'nerve-shout' },
    // Portal followed. trail zone; local store only (no socket = privacy fence).
    walk:   { priority: 2, fadeMs: 20000, zone: 'trail',  css: 'nerve-walk' },
}

// Shape: { msg, payload, source, kind, target, ref, tabId, place }.
export const signals = {
    output:  (msg, payload)          => ({ msg, payload: String(payload), source: 'system', kind: 'output' }),
    system:  (msg, payload)          => ({ msg, payload: payload ?? null, source: 'system', kind: 'system' }),
    // heliosView → signals.helios. msg = glyph; commands = payload; living while building.
    // `place` routes it: every helios says 'system' — source routing alone
    // sent every shell's sun to the residual.
    helios:  (view, place = null) => ({
        msg: view?.glyph ?? '',
        payload: (view?.commands ?? 0) > 0 ? String(view.commands) : null,
        source: 'system',
        kind: 'helios',
        living: view?.phase === 'building',
        place,
    }),
    shout:   (source, msg, payload, tabId) => ({ msg, payload, source, kind: 'shout', tabId }),
    chat:    (source, msg, target)   => ({ msg, payload: null, source, kind: 'chat', target: target ?? null }),
    eval:    (source, msg, payload)  => ({ msg, payload: payload ?? null, source, kind: 'eval' }),
    // source = walker address; target = spoken dest; payload = from; ref survives renames.
    walk:    (source, from, to, ref) => ({
        msg: to,
        payload: from ?? null,
        source: source ?? '?',
        kind: 'walk',
        target: to,
        ref: ref ?? null,
    }),
}

// One place for omitted fields; push stamps id/epoch/ts over this.
const DEFAULTS = Object.freeze({
    msg: '', payload: null, target: null, source: '?', kind: 'shout',
    ref: null, tally: 0, tabId: null, living: false, place: null,
})

export function createSignalStore(opts = {}) {
    const MAX = opts.maxSignals || 200
    const log = []  // not `signals` — that name is the constructors export
    const subscribers = createObservable()
    const sources = new Set()
    const targets = new Set()
    const muted = new Set()
    // CLAIMS ARE PREDICATES, NOT INDICES. A panel says which signals are ITS
    // OWN; residual is the complement of the union. Two parallel Sets (by
    // source, by place) once, four methods, residual AND-ing both — a third
    // axis meant editing three files. Essential relation never names an axis:
    // residual = what nobody claimed.
    const claimants = new Set()
    let counter = 0
    let epoch = 0

    function run() { ++epoch }
    // claimBy(pred) → release. Predicate is the panel's own `select`.
    function claimBy(pred) {
        if (typeof pred !== "function") return () => {}
        claimants.add(pred)
        return () => { claimants.delete(pred) }
    }
    function claimed(signal) {
        for (const pred of claimants) if (pred(signal)) return true
        return false
    }

    function push(raw) {
        const signal = {
            ...DEFAULTS,
            ...raw,
            id: ++counter,
            epoch,
            // ts belongs to the SOURCE (gw-t-clock). Cross-boundary keeps arrival clock.
            // Peer order is per-source (source, id) — honestly partial globally.
            ts: raw.ts ?? performance.now(),
            living: raw.living === true,  // boolean breath, never truthy string
        }
        log.unshift(signal)
        if (log.length > MAX) log.length = MAX

        if (signal.source && signal.source !== '?') sources.add(signal.source)
        if (signal.target) targets.add(signal.target)

        subscribers.notify(signal)
    }

    function subscribe(fn) {
        return subscribers.watch(fn)
    }

    function mute(kind) { muted.add(kind) }
    function unmute(kind) { muted.delete(kind) }
    function clear() { log.length = 0 }

    return {
        push, subscribe, run, signals: log, sources, targets, muted, mute, unmute, clear,
        claimBy, claimed,
        get epoch() { return epoch },
    }
}
