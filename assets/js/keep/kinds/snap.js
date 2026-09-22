// Snap kind (keep kernel). Photograph or nothing.
// Origin omits target (id is the work). Later keeps name target = origin id.
// body: signature_of by keys you have; prev only if they had a keep.

import { write, name } from "../entry.js"
import { stamp } from "../../utils/stamp.js"

/**
 * Author a snap. Pure. ts required from caller — never ambient.
 * @param {object} p
 * @param {string} p.root
 * @param {string} [p.work_id] - origin id; omit on the origin keep itself
 * @param {string} [p.source]
 * @param {string | null} [p.title]
 * @param {unknown} [p.diagnostics]
 * @param {string | null} [p.buffer_id]
 * @param {string | null} [p.prev]
 * @param {string | null} [p.name] — letters this hand wears now
 * @param {{ root: string, name: string } | null} [p.peer] — fork: their root + letters
 * @param {{t: number, n: number}} p.ts
 * @returns {string}
 */
export function writeSnap({
    root,
    work_id = null,
    source = "",
    title = null,
    diagnostics = [],
    buffer_id = null,
    prev = null,
    name: letters = null,
    peer = null,
    ts,
}) {
    if (
        ts == null ||
        typeof ts.t !== "number" ||
        !Number.isFinite(ts.t) ||
        typeof ts.n !== "number" ||
        !Number.isFinite(ts.n)
    ) {
        throw new TypeError("writeSnap: ts is required — {t, n} finite numbers")
    }
    const source_id = name(source)
    const body = { source_id, title, diagnostics, buffer_id }
    // Absent, not null.
    if (typeof prev === "string" && prev) body.prev = prev
    const signature_of = signatureOf(root, letters, peer)
    if (signature_of) body.signature_of = signature_of
    const ctx = { root, ts }
    if (typeof work_id === "string" && work_id) ctx.target = work_id
    return write("snap", body, ctx)
}

/** Build by keys you have — self optional, peer optional; empty → omit. */
function signatureOf(root, letters, peer) {
    const map = {}
    if (typeof root === "string" && root && typeof letters === "string" && letters) {
        map[root] = letters
    }
    if (
        peer &&
        typeof peer.root === "string" &&
        peer.root &&
        typeof peer.name === "string" &&
        peer.name
    ) {
        map[peer.root] = peer.name
    }
    return Object.keys(map).length > 0 ? map : null
}

/** Data URL → Blob once; Blob passes through; else null. */
export function toBlob(path) {
    if (path == null) return null
    if (typeof Blob !== "undefined" && path instanceof Blob) return path
    if (typeof path !== "string") return null
    if (path.startsWith("data:")) return dataUrlToBlob(path)
    return null
}

/**
 * Mint a snap — one put, message + picture. No picture is a spoken drop.
 * No work_id → origin keep (its id becomes the work).
 * @param {{ title: string, prev?: string, name?: string, peer?: { root: string, name: string } }} ask
 * @param {{ source?: string, diagnostics?: unknown }} reflection
 * @param {{ work_id?: string | null, buffer_id?: string | null }} ids
 * @param {{ root: () => Promise<string>, put: Function }} door
 * @param {string | Blob | null} path  hatch product; toBlob decides
 * @returns {Promise<string | null>}  the keep id, or null
 */
export async function mintSnap(ask, reflection, ids, door, path) {
    if (!door) {
        say("mintSnap: no door")
        return null
    }
    if (!ask) {
        say("mintSnap: no ask")
        return null
    }
    const image = toBlob(path)
    if (image == null) {
        say("no picture — not kept")
        return null
    }

    try {
        const root = await door.root()
        const source = typeof reflection?.source === "string" ? reflection.source : ""
        const work_id =
            typeof ids?.work_id === "string" && ids.work_id ? ids.work_id : null
        const bytes = writeSnap({
            root,
            work_id,
            source,
            title: typeof ask.title === "string" && ask.title ? ask.title : null,
            diagnostics: reflection?.diagnostics ?? [],
            buffer_id: ids?.buffer_id ?? null,
            prev: typeof ask.prev === "string" && ask.prev ? ask.prev : null,
            name: typeof ask.name === "string" && ask.name ? ask.name : null,
            peer: ask.peer ?? null,
            ts: stamp(),
        })

        // One write: source + picture. The keep is a photograph or it is not.
        return await door.put(bytes, { source, image })
    } catch (e) {
        say("mintSnap failed:", e && e.message ? e.message : e)
        return null
    }
}

function say(...args) {
    try {
        console.warn("[keep]", ...args)
    } catch {
        /* nowhere to write */
    }
}

// ── data URL → Blob ─────────────────────────────────────────────────

function dataUrlToBlob(dataUrl) {
    const comma = dataUrl.indexOf(",")
    if (comma < 0) return null
    const header = dataUrl.slice(0, comma)
    const data = dataUrl.slice(comma + 1)
    const mime = (header.match(/^data:([^;,]+)/i) || [])[1] || "application/octet-stream"
    const isBase64 = /;base64/i.test(header)

    if (isBase64) {
        const bin = globalThis.atob(data)
        const arr = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
        return new Blob([arr], { type: mime })
    }

    const str = decodeURIComponent(data)
    return new Blob([str], { type: mime })
}
