// The journal door — verbs over a worker (id:kb-6).
//
// Promise-per-call over postMessage with a request id. The engine never leaks:
// no store name, no transaction, no request handle in any signature or return.
// put takes bytes, not (id, bytes) — the name is not a choice (id:kc-law 3).
//
// The worker is a boundary, not a speedup (id:kc-env). One hash per snap needs
// no worker; folding the clan's history on reconnect is what earns it.
//
// At boot, root() warms — the door resolves and caches the journal's name
// (id:kb-vet2-root). The mint may wait; the hatch never does.
//
// The engine lives behind the worker only. This module speaks verbs and nothing
// lower — greppable by the absence of any storage API name.

import { name } from "./entry.js"
import { VERBS, VERB_SET } from "./verbs.js"

/**
 * Open the durability door.
 *
 * @param {object} [opts]
 * @param {{ [op: string]: (...args: any) => any, close?: () => any }} [opts.engine]
 *   Inject the store directly (node tests — no Worker). The public surface is
 *   identical; the engine still never appears in return values.
 * @param {Worker} [opts.worker] - prebuilt worker
 * @param {string | URL} [opts.workerUrl]
 * @param {typeof Worker} [opts.Worker]
 */
export function createJournal(opts = {}) {
    const transport = makeTransport(opts)
    let closed = false
    /** @type {string | null} */
    let cached = null
    /** @type {Promise<string> | null} */
    let rootP = null

    async function request(op, args) {
        if (closed) throw new Error("journal: closed")
        if (!VERB_SET.has(op)) throw new Error(`journal: unknown op ${op}`)
        return transport.request(op, args)
    }

    /**
     * The journal's name — one door, always a promise (id:kc-p-fence).
     * Idempotent find-or-create; never a getter, never a capability probe.
     * @returns {Promise<string>} hex64 root
     */
    function root() {
        if (cached != null) return Promise.resolve(cached)
        if (rootP) return rootP
        rootP = request("genesis", [])
            .then((bytes) => {
                cached = name(bytes)
                return cached
            })
            .catch((err) => {
                rootP = null
                throw err
            })
        return rootP
    }

    const door = {
        /** One way to ask who am I. Always a promise. */
        root,

        /** The public verbs — always promises. */
        put(bytes, extras) {
            return request("put", [bytes, extras ?? {}])
        },
        get(id) {
            return request("get", [id])
        },
        list(r, n) {
            return request("list", n === undefined ? [r] : [r, n])
        },
        /** n bounds the shared fold; announce drains without it (id:kb-8-page). */
        local(r, n) {
            return request("local", n === undefined ? [r] : [r, n])
        },
        share(id, shared) {
            return request("share", [id, shared])
        },
        image(id) {
            return request("image", [id])
        },
        source(sourceId) {
            return request("source", [sourceId])
        },

        /**
         * Read-or-mint the genesis entry itself (bytes). Prefer root() when
         * only the name is needed.
         * @returns {Promise<string>} the genesis bytes
         */
        async genesis() {
            const bytes = await request("genesis", [])
            cached = name(bytes)
            return bytes
        },

        async close() {
            closed = true
            cached = null
            rootP = null
            await transport.close()
        },
    }

    // Warm the root. Failure is deferred to the first real verb — a missing
    // store should not throw at import time on the classroom path.
    void root().catch(() => {})

    // Where the API exists, ask once, best-effort; nothing ever reads the
    // answer (id:kb-vet3 27). Absence forbids reliance, never the ask.
    try {
        globalThis.navigator?.storage?.persist?.()
    } catch {
        /* best-effort */
    }

    return door
}

// ── transport ───────────────────────────────────────────────────────

function makeTransport(opts) {
    // One injection point: engine, or the worker (id:kb-vet4 36).
    if (opts.engine) {
        const engine = opts.engine
        return {
            request: (op, args) => Promise.resolve(engine[op](...args)),
            close: async () => {
                if (typeof engine.close === "function") await engine.close()
            },
        }
    }

    return workerTransport(opts)
}

function workerTransport(opts) {
    const WorkerCtor = opts.Worker ?? globalThis.Worker
    if (!WorkerCtor) {
        throw new Error("journal: no Worker (inject opts.engine under node)")
    }

    // IIFE build cannot use import.meta.url (empty under esbuild iife).
    // The digested path is stamped into a meta tag by root.html.heex so
    // phx.digest's fingerprint is the door's truth, not a hardcoded string.
    const url =
        opts.workerUrl ??
        (typeof document !== "undefined" &&
            document
                .querySelector?.('meta[name="keep-journal-worker"]')
                ?.getAttribute("content")) ??
        "/assets/js/keep/journal.worker.js"

    // Classic worker: the entry is a self-contained IIFE (engine inlined).
    const worker = opts.worker ?? new WorkerCtor(url)
    let seq = 0
    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    const pending = new Map()
    // Latch dead once — answers or refuses, never hangs (id:kb-vet4 30).
    /** @type {Error | null} */
    let dead = null

    function latchDead(inFlight) {
        if (dead) return
        dead = new Error("journal: worker dead")
        const err = inFlight ?? dead
        for (const p of pending.values()) p.reject(err)
        pending.clear()
    }

    worker.onmessage = (ev) => {
        const msg = ev.data
        if (!msg || (typeof msg.id !== "number" && typeof msg.id !== "string")) return
        const p = pending.get(msg.id)
        if (!p) return
        pending.delete(msg.id)
        if (msg.ok) p.resolve(msg.value)
        else p.reject(new Error(msg.error || "journal error"))
    }

    worker.onerror = (ev) => {
        latchDead(new Error(ev?.message || "journal worker error"))
    }

    // Unusable channel — same fence as onerror (id:kb-vet4 30).
    worker.onmessageerror = () => {
        latchDead()
    }

    return {
        request(op, args) {
            if (dead) return Promise.reject(dead)
            const id = ++seq
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject })
                try {
                    worker.postMessage({ id, op, args })
                } catch (e) {
                    pending.delete(id)
                    reject(e)
                }
            })
        },
        async close() {
            for (const p of pending.values()) {
                p.reject(new Error("journal: closed"))
            }
            pending.clear()
            worker.terminate()
        },
    }
}

/** Verbs the public surface names — re-export for greps and tests (id:kb-6). */
export { VERBS as JOURNAL_VERBS }
