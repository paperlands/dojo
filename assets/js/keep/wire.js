// Keep socket edge (id:kb-9, id:kc-c-wire). Only keep/ file that names pushEvent.
// Bound not backoff: PAGE ships, silence ends pass. No online flag, outbox, or queue.

import { name, read } from "./entry.js"
import { PAGE } from "./page.js"

/** The event that ships one kept-local message. */
export const KEEP_EVENT = "keep"


/**
 * Open the keep's socket edge.
 *
 * @param {object} opts
 * @param {{ pushEvent?: Function, liveSocket?: { isConnected?: () => boolean } }} opts.hook
 *   The LiveView hook (or a test double). pushEvent is named only here in keep/.
 * @param {{ root: () => Promise<string>, local: Function, share: Function, source?: Function, image?: Function }} [opts.door]
 *   The journal door. Absent → announce ships nothing and says so.
 * @param {(eventName: string, err?: unknown) => void} [opts.onDrop]
 *   Optional log for a dropped push — never throws into the caller.
 * @param {(note: { kind: string, id: string, why?: string }) => void} [opts.onNote]
 *   Optional side-channel for permanent refusals (why is for us, not the journal).
 * @param {number} [opts.page] - ship page depth; defaults to PAGE (keep/page.js)
 */
export function createWire(opts = {}) {
    const hook = opts.hook
    const door = opts.door
    const onDrop = opts.onDrop
    const onNote = opts.onNote
    const page =
        typeof opts.page === "number" && opts.page > 0 ? opts.page : PAGE

    let running = false      // one shipment at a time
    let passWanted = false   // "another pass requested" — independent of running
    let epoch = 0

    /**
     * Fire and forget. Drop → undefined, never throws (id:kc-c-wire).
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
     * Birth, rejoin, and after each mint — one PAGE of local, serial.
     * Re-entry while a pass runs arms another pass — never a second shipment.
     * @returns {Promise<void>}
     */
    // "Running" and "another pass requested" are INDEPENDENT facts: a re-entry
    // arms a pass — it never starts a second shipment beside the first.
    async function announce() {
        passWanted = true
        if (running) return
        const run = ++epoch
        running = run
        try {
            passes: do {
                passWanted = false
                const mine = ++epoch
                try {
                    if (!door || typeof door.root !== "function") break passes

                    const root = await door.root()
                    if (mine !== epoch) return   // superseded — the healer owns the queue

                    const held = await door.local(root, page)
                    if (mine !== epoch) return

                    let progressed = false
                    let silenced = false

                    for (const bytes of held) {
                        if (mine !== epoch) return
                        const id = name(bytes)
                        const payload = await pack(door, id, bytes)
                        if (mine !== epoch) return

                        const reply = await say(KEEP_EVENT, payload)
                        if (mine !== epoch) return

                        // Silence ends this pass; remainder stays local for reconnect.
                        if (reply == null) {
                            silenced = true
                            break
                        }

                        // Only the id just shipped may settle (id:kb-12).
                        const outcome = await settle(door, reply, note, id)
                        if (outcome) progressed = true
                    }

                    if (mine === epoch && progressed && !silenced) {
                        const more = await door.local(root, 1)
                        if (mine === epoch && more.length > 0) passWanted = true
                    }
                } catch (err) {
                    try {
                        console.debug?.("[keep/wire] announce:", err?.message || err)
                    } catch {
                        /* nowhere to write */
                    }
                }
                // Let a re-entry's arm land before the next pass runs.
                await new Promise((r) => queueMicrotask(r))
            // Pass demand is shared; only the run that OWNS the latch may
            // consume it — including along error paths. (id:ownership-o2)
            } while (passWanted && running === run)
        } finally {
            if (running === run) running = 0
        }
    }

    /** Cancel the in-flight pass, then announce (id:kb-vet2 15). */
    function reconnected() {
        epoch += 1
        running = 0   // even a pass hung on a reply cannot block the healer
        return announce()
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

    /** Permanent refusal: keep it, or say why not (id:kb-7). */
    function note(n) {
        try {
            onNote?.(n)
            if (!onNote) console.debug?.(`[keep/wire] ${n.kind} ${n.id}:`, n.why)
        } catch {
            /* a note that throws is still a note */
        }
    }

    return { say, announce, reconnected }
}

// ── pack one message for the wire ────────────────────────────────────

/**
 * Message + claimed id; source and image if held. One ship, both referents.
 * @param {{ source?: Function, image?: Function }} door
 * @param {string} id
 * @param {string} bytes
 */
async function pack(door, id, bytes) {
    /** @type {{ id: string, message: string, source?: string, image?: string }} */
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
    try {
        if (typeof door.image === "function") {
            const blob = await door.image(id)
            if (blob != null) {
                const image = await toBase64(blob)
                if (image) payload.image = image
            }
        }
    } catch {
        // Mint gates the picture; eviction may still drop it later. No blob → ship text.
    }
    return payload
}

/**
 * Permanent answer → share. Fenced to expectedId (id:kb-12). why stays off journal.
 * @param {{ share: Function }} door
 * @param {{ id?: string, at?: number, node?: string, why?: string }} reply
 * @param {(note: {kind: string, id: string, why?: string}) => void} note
 * @param {string} expectedId
 * @returns {Promise<"shared" | "refused" | null>}
 */
async function settle(door, reply, note, expectedId) {
    if (!reply || typeof reply !== "object") return null
    if (typeof expectedId !== "string" || !expectedId) return null
    if (reply.id !== expectedId || typeof reply.at !== "number") return null

    await door.share(reply.id, { at: reply.at, node: reply.node })

    if (reply.why != null) {
        note({ kind: "refused", id: reply.id, why: reply.why })
        return "refused"
    }
    return "shared"
}

async function toBase64(blob) {
    const buf = await blob.arrayBuffer()
    const bytes = new Uint8Array(buf)
    let bin = ""
    // Chunked — apply over a whole PNG overflows the stack.
    for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
    }
    return globalThis.btoa(bin)
}
