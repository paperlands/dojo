// Selection intent — one local installation, acknowledged only by its bound
// request completion. Phoenix applies reply pushes before resolving, so a
// server event is never an ack; a hung request keeps pending (O3).

import { selectorFor } from "./outer-recovery.js"

export function createSelectionIntent() {
    let pending = null      // waiting receipt token
    let owner = null        // current ownership incarnation; the local subject
    let released = false
    let local = new WeakSet()
    let decisions = new WeakMap()

    const decide = (payload, accepted) => {
        decisions.set(payload, { accepted, owner })
    }

    return {
        // Local departure: register the exact subject, then protect it until
        // the correlated request completes. Only a known subject may depart.
        open(payload) {
            if (released || !payload || typeof payload !== "object") return null
            const addr = payload.addr
            if (typeof addr !== "string" || addr === "") return null
            const token = { addr }
            owner = token
            pending = token
            local.add(payload)
            decide(payload, true)
            return token
        },

        // Register a fetched body under the owner that expressed the subject.
        install(ownerToken, payload) {
            if (released || !payload || typeof payload !== "object") return false
            if (!ownerToken || ownerToken !== owner) return false
            if ((payload.addr ?? null) !== (ownerToken.addr ?? null)) return false
            local.add(payload)
            decide(payload, true)
            return true
        },

        // A readiness request supersedes any hung local receipt with a new
        // incarnation. The owner, and so the subject, survives.
        supersede(addr) {
            if (released) return null
            pending = { addr }
            return pending
        },

        // Only the current request's completion may clear pending; ownership
        // stays, so an older queued command cannot act on a newer incarnation.
        ack(token) {
            if (released || token == null || pending !== token) return false
            pending = null
            return true
        },

        // Ingest once at event arrival, before any boot queue or domain mount.
        arrive(name, payload) {
            if (released) return false

            if (name === "outerClose") {
                if (payload && typeof payload === "object" && decisions.has(payload)) return false
                if (payload && typeof payload === "object" && payload.local === true) {
                    owner = { addr: null }
                    pending = owner
                    decide(payload, true)
                    return true
                }

                // A server notify cannot close a newer local request.
                if (pending != null) {
                    if (payload && typeof payload === "object") decide(payload, false)
                    return true
                }

                owner = { addr: null }
                pending = null
                if (payload && typeof payload === "object") decide(payload, true)
                return true
            }

            if (name === "outerLive") {
                if (payload == null || typeof payload !== "object") return
                if (decisions.has(payload)) return
                decide(payload, pending == null)
                return
            }

            if (name !== "seeOuterShell" && name !== "outerIntent") return
            if (payload == null || typeof payload !== "object") return
            if (decisions.has(payload)) return

            // A body needs a known subject; a selector may say explicitly closed.
            const addr = payload.addr
            const known = name === "seeOuterShell"
                ? typeof addr === "string" && addr !== ""
                : addr === null || (typeof addr === "string" && addr !== "")
            if (!known) {
                decide(payload, false)
                return
            }

            // A selector must validate before it can establish or replace an
            // owner; bodies keep their addr-only document envelope.
            if (name === "outerIntent" && !selectorFor(payload, addr)) {
                decide(payload, false)
                return
            }
            // A server event while a local receipt is pending is stale or an
            // echo of that request; the request completion is the only ack.
            if (pending != null) {
                decide(payload, false)
                return
            }

            // An explicit closed selector is a server close; it needs no owner
            // match. A known body/selector establishes the first owner.
            if (addr === null) {
                owner = { addr: null }
                decide(payload, true)
                return
            }
            if (owner == null) owner = { addr }
            decide(payload, owner.addr === addr)
        },

        isLocal(payload) {
            return local.has(payload)
        },

        current() {
            return owner
        },

        owns(token) {
            return !released && token != null && token === owner
        },

        // Domain handlers read only registered arrivals, and only while the
        // subject still owns the installation.
        accepted(payload) {
            if (released) return false
            if (payload == null || typeof payload !== "object") return false
            const d = decisions.get(payload)
            if (!d || !d.accepted || d.owner !== owner) return false
            if ("addr" in payload && (payload.addr ?? null) !== (owner?.addr ?? null)) return false
            return true
        },

        acceptedClose(payload) {
            if (released || payload == null || typeof payload !== "object") return false
            const d = decisions.get(payload)
            return !!d && d.accepted && d.owner === owner
        },

        release() {
            released = true
            pending = null
            owner = null
            local = new WeakSet()
            decisions = new WeakMap()
        },

        pending: () => pending,
    }
}

/** Validate before ack: only an exact-address descriptor retires the token. */
export function completeSelection(intent, token, reply) {
    const descriptor = selectorFor(reply, token?.addr)
    if (!descriptor) return null
    if (!intent?.ack?.(token)) return null
    return descriptor
}

/** One receipt protocol: send synchronously; only an exact-address reply acks. */
export async function requestSelection(intent, token, send, accept) {
    try {
        const request = send()
        if (typeof request?.then !== "function") return
        const descriptor = completeSelection(intent, token, await request)
        if (descriptor) accept?.(descriptor)
    } catch { /* missing receipt leaves the current fence */ }
}

// Page pointer to the outer hook's controller; replacement releases the old
// incarnation so stale completions cannot reach the new one (O2/O3).
let current = null

export function installSelection(selection) {
    if (current && current !== selection) current.release()
    current = selection
}

export function releaseSelection(selection) {
    if (current === selection) current = null
}

export function selection() {
    return current
}
