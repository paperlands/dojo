// The keep's one socket edge (id:kb-9, id:kc-c-wire).
//
// Two doors open the keep: the journal and this. Everything else is pure, or
// is handed a door and opens none. Greppable: only this file in keep/ names
// pushEvent — the law of two doors made checkable (id:kb-vet finding 7).
//
//   say(name, payload)  — fire and forget; a drop is a fact, never an exception
//   announce()          — birth AND reconnected say the same sentence
//   attached()          — the one honest answer; exactly one legitimate caller
//
// announce pages local(root, PAGE), serially, newest first — the same page
// depth the river folds (id:kb-8-page, keep/page.js). A kill mid-drain leaves
// the oldest unshared — the least costly residue.
//
// Bound, not backoff:
//   - at most PAGE ships per pass
//   - first silence ends this pass (no thrash of the whole log)
//   - if the clan answered and more remain → chain one more announce
//     (queueMicrotask — yield, not a retry timer)
//
// One in-flight boolean, and no timeout (id:kb-vet finding 6). A stalled
// reply needs no handling: the entry stays kept local and rides reconnect.
// reconnected() clears the latch before announcing (id:kb-vet2 15).
//
// Detection is not a question we ask. navigator.onLine lies on a captive
// portal. The socket already knows, already retries with backoff, already
// calls reconnected(). No online flag, no backoff, no outbox, no queue.

import { name, read } from "./entry.js"
import { PAGE } from "./page.js"

/** The event that ships one kept-local message. Image rides a later verb. */
export const KEEP_EVENT = "keep"

/**
 * Open the keep's socket edge.
 *
 * @param {object} opts
 * @param {{ pushEvent?: Function, liveSocket?: { isConnected?: () => boolean } }} opts.hook
 *   The LiveView hook (or a test double). pushEvent is named only here in keep/.
 * @param {{ root: () => Promise<string>, local: Function, share: Function, source?: Function }} [opts.door]
 *   The journal door. Absent → announce still says standing, ships nothing.
 * @param {() => ({ name: string, payload?: object } | null | undefined)} [opts.stand]
 *   What this surface stands on. Null/undefined → say nothing about standing.
 * @param {(eventName: string, err?: unknown) => void} [opts.onDrop]
 *   Optional log for a dropped push — never throws into the caller.
 * @param {(note: { kind: string, id: string, why?: string }) => void} [opts.onNote]
 *   Optional side-channel for permanent refusals (why is for us, not the journal).
 * @param {number} [opts.page] - ship page depth; defaults to PAGE (keep/page.js)
 */
export function createWire(opts = {}) {
    const hook = opts.hook
    const door = opts.door
    let standing = typeof opts.stand === "function" ? opts.stand : () => null
    const onDrop = opts.onDrop
    const onNote = opts.onNote
    const page =
        typeof opts.page === "number" && opts.page > 0 ? opts.page : PAGE

    // Latch + epoch: re-entry is re-entrancy, not a mode (id:kb-9).
    // epoch supersedes a hung drain after reconnected() clears the latch, so
    // a finally from the old generation cannot clear the new one's latch, and
    // a late old reply cannot mark shares under a finished epoch.
    let inFlight = false
    let epoch = 0

    /**
     * Fire and forget. A drop is a fact, never an exception.
     * When awaited and the socket answers, the reply is returned; a drop or a
     * missing push settles as undefined — silence is not an answer.
     *
     * @param {string} eventName
     * @param {object} [payload]
     * @returns {Promise<unknown>}
     */
    async function say(eventName, payload = {}) {
        if (!hook || typeof hook.pushEvent !== "function") return undefined
        try {
            const result = hook.pushEvent(eventName, payload)
            if (result != null && typeof result.then === "function") {
                try {
                    return await result
                } catch (err) {
                    noteDrop(eventName, err)
                    return undefined
                }
            }
            // Callback-style pushEvent (no promise) — no reply path here.
            return undefined
        } catch (err) {
            // Sync throw (dead hook, missing liveSocket) — still a drop.
            noteDrop(eventName, err)
            return undefined
        }
    }

    /**
     * The same sentence at birth and at every rejoin.
     * Standing first; then one page of unshipped keeps, newest first, serial.
     * Never throws. Re-entry while a drain is live is a no-op.
     *
     * @returns {Promise<void>}
     */
    async function announce() {
        if (inFlight) return
        const mine = ++epoch
        inFlight = true
        /** @type {boolean} */
        let chain = false
        try {
            // What this surface stands on — one push, fire and forget.
            const seat = standing()
            if (seat && typeof seat.name === "string" && seat.name) {
                void say(seat.name, seat.payload ?? {})
            }

            if (!door || typeof door.root !== "function") return

            const root = await door.root()
            if (mine !== epoch) return

            // One page — same depth the river folds (keep/page.js).
            const held = await door.local(root, page)
            if (mine !== epoch) return

            let heard = false
            let silenced = false

            for (const bytes of held) {
                if (mine !== epoch) return
                const id = name(bytes)
                const payload = await pack(door, id, bytes)
                if (mine !== epoch) return

                const reply = await say(KEEP_EVENT, payload)
                if (mine !== epoch) return

                // Silence ends THIS pass — do not thrash the rest of the page
                // (or the log). Remainder stays kept local; reconnect heals.
                if (reply == null) {
                    silenced = true
                    break
                }

                // Only the id we just shipped may settle (probe W1).
                await settle(door, reply, onNote, id)
                heard = true
            }

            // Clan was answering and more remain → continue after the latch
            // releases. Not a retry timer: yield, then the same sentence again.
            if (mine === epoch && heard && !silenced) {
                const more = await door.local(root, 1)
                if (mine === epoch && more.length > 0) chain = true
            }
        } catch (err) {
            // Journal errors, bad bytes — a drop is a fact. Say it, never raise.
            try {
                console.debug?.("[keep/wire] announce:", err?.message || err)
            } catch {
                /* nowhere to write */
            }
        } finally {
            // Only the living generation releases the latch.
            if (mine === epoch) inFlight = false
        }

        if (chain && mine === epoch) {
            queueMicrotask(() => {
                void announce()
            })
        }
    }

    /**
     * The healer. Clears the latch first so a hung drain cannot block forever
     * (id:kb-vet2 15), then says the same sentence birth said.
     *
     * @returns {Promise<void>}
     */
    function reconnected() {
        epoch += 1
        inFlight = false
        return announce()
    }

    /**
     * The one honest answer to "is anyone there?"
     * Exactly one legitimate caller (presence). Nothing else branches on this.
     *
     * @returns {boolean}
     */
    function attached() {
        try {
            return !!hook?.liveSocket?.isConnected?.()
        } catch {
            return false
        }
    }

    /**
     * Replace what the surface stands on. Surfaces that have nothing to say
     * leave it null — no branch.
     *
     * @param {() => ({ name: string, payload?: object } | null | undefined)} fn
     */
    function stand(fn) {
        standing = typeof fn === "function" ? fn : () => null
    }

    function noteDrop(eventName, err) {
        try {
            onDrop?.(eventName, err)
            if (!onDrop) {
                console.debug?.(
                    `[keep/wire] drop ${eventName}:`,
                    err?.message || err,
                )
            }
        } catch {
            /* a log that throws is still a drop */
        }
    }

    return { say, announce, attached, reconnected, stand }
}

// ── pack one message for the wire ────────────────────────────────────

/**
 * The wire carries the message and a claim (id:kb-11-derive). Source rides
 * when we still hold it — a keep without source arrives as a tombstone on the
 * far side (id:kb-source-absence). The image does NOT ride announce (id:kb-12a).
 *
 * @param {{ source?: Function }} door
 * @param {string} id
 * @param {string} bytes
 */
async function pack(door, id, bytes) {
    /** @type {{ id: string, message: string, source?: string }} */
    const payload = { id, message: bytes }
    try {
        const v = read(bytes)
        const sid = v && v.source_id
        if (typeof sid === "string" && sid && typeof door.source === "function") {
            const text = await door.source(sid)
            if (typeof text === "string") payload.source = text
        }
    } catch {
        // Ship the message alone rather than drop the keep for a bad body.
    }
    return payload
}

/**
 * A permanent answer — shared or refused — flips local → 0 via the same verb.
 * why never reaches the journal (id:kc-c-shared). Silence is not an answer.
 *
 * The settle is fenced to `expectedId` — the name of the message this push
 * carried. Foreign ids in the reply are ignored (not shared, not noted).
 *
 * @param {{ share: Function }} door
 * @param {{ shared?: Array, refused?: Array }} reply
 * @param {Function} [onNote]
 * @param {string} expectedId - name(bytes) of the entry just shipped
 */
async function settle(door, reply, onNote, expectedId) {
    if (!reply || typeof reply !== "object") return
    if (typeof expectedId !== "string" || !expectedId) return

    const shared = Array.isArray(reply.shared) ? reply.shared : []
    for (const s of shared) {
        if (s && s.id === expectedId && typeof s.at === "number") {
            await door.share(s.id, { at: s.at, node: s.node })
        }
    }

    const refused = Array.isArray(reply.refused) ? reply.refused : []
    for (const r of refused) {
        // Permanent refusal is an answer: same fact shape, why rides beside.
        if (r && r.id === expectedId && typeof r.at === "number") {
            await door.share(r.id, { at: r.at, node: r.node })
            try {
                onNote?.({ kind: "refused", id: r.id, why: r.why })
            } catch {
                /* notes must not break the drain */
            }
        }
    }
}
