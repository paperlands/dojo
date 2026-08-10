// The snap kind — first kind (id:kb-7-snap).
//
// target = work_id — the work the picture is of (id:kb-work).
// body   = { source_id, title, diagnostics, buffer_id }
//   title is the CHILD'S WORD for this moment — the first one names the river,
//   the rest name the steps. It is the only thing here no fold could recover,
//   so it is kept; everything else in the body is a pointer or an ailment.
//   source is a BLOB named by hash(source); the message carries only the pointer
//   (id:kb-source). commands are gone: the AST is derived. state and message
//   are folds, not fields (id:kc-adapt 2). diagnostics stay — runtime ailments
//   no re-parse can recover. attend is excluded — a live coordinate is not a
//   kept moment. prev is absent on a straight keep; the fork gesture mints it
//   (id:kr-mirror) — causal parent of a line that split.
//
// Blob at the mint (id:kb-vet2-image): the stage hands a data URL; one decode
// here and it is gone. IDB holds Blobs natively; base64 exists again only at ship.

import { write, name } from "../entry.js"
import { stamp as ambientStamp } from "../../utils/stamp.js"

/**
 * Author a snap message. Pure and synchronous.
 *
 * @param {object} p
 * @param {string} p.root
 * @param {string} p.work_id - becomes the frozen field target
 * @param {string} [p.source] - program text; stored as a blob, pointed by source_id
 * @param {string | null} [p.title] - the child's word for this moment
 * @param {unknown} [p.diagnostics]
 * @param {string | null} [p.buffer_id] - UI residue in the free body only
 * @param {string | null} [p.prev] - causal parent; only on a fork (id:kr-mirror)
 * @param {{t: number, n: number}} [p.ts]
 * @returns {string} the entry bytes
 */
export function writeSnap({
    root,
    work_id,
    source = "",
    title = null,
    diagnostics = [],
    buffer_id = null,
    prev = null,
    ts,
}) {
    const source_id = name(source)
    const body = { source_id, title, diagnostics, buffer_id }
    // Absent, not null: a straight keep carries no parent key (id:kc-r-absence).
    if (typeof prev === "string" && prev) body.prev = prev
    return write(
        "snap",
        body,
        { root, target: work_id, ts: ts ?? ambientStamp() },
    )
}

/**
 * Decode a data URL to a Blob once. The data URL dies at this seam.
 * Already-a-Blob passes through. Null/unknown → null.
 *
 * @param {string | Blob | null | undefined} path
 * @returns {Blob | null}
 */
export function toBlob(path) {
    if (path == null) return null
    if (typeof Blob !== "undefined" && path instanceof Blob) return path
    if (typeof path !== "string") return null
    if (path.startsWith("data:")) return dataUrlToBlob(path)
    return null
}

/**
 * Mint a snap and put it in the journal. Fire-and-forget from the hatch path —
 * the caller must not await (id:kb-7). A drop is a fact, never an exception
 * (id:kc-c-wire) — failures are said out loud and settle as null, never reject.
 *
 * @param {object} hatch - reflect payload: source, path, diagnostics, …
 * @param {{ work_id: string, buffer_id?: string | null, prev?: string | null }} ids
 * @param {{ root: () => Promise<string>, put: Function }} door
 * @returns {Promise<string | null>} the keep id, or null if the mint could not run
 */
export async function keepSnap(hatch, ids, door) {
    if (!door) {
        say("keepSnap: no door")
        return null
    }
    if (!hatch) {
        say("keepSnap: no hatch")
        return null
    }
    if (!ids?.work_id) {
        // A silent no-op on the durability path is the wound step 7 exists to
        // prevent. Say it — never vanish without a trace.
        say("keepSnap: no work_id — refuse silent keep")
        return null
    }

    try {
        // One way to ask who am I (id:kc-p-fence) — never a capability probe.
        const root = await door.root()
        const source = typeof hatch.source === "string" ? hatch.source : ""
        const bytes = writeSnap({
            root,
            work_id: ids.work_id,
            source,
            title: typeof hatch.title === "string" && hatch.title ? hatch.title : null,
            diagnostics: hatch.diagnostics ?? [],
            buffer_id: ids.buffer_id ?? null,
            prev: typeof ids.prev === "string" && ids.prev ? ids.prev : null,
        })

        const image = toBlob(hatch.path)
        const extras = { source } // always — even ""; no tombstone (id:kb-source-absence)
        if (image != null) extras.image = image

        return await door.put(bytes, extras)
    } catch (e) {
        // Dead worker, quota, rejected root, bad ts — a drop is a fact.
        say("keepSnap failed:", e && e.message ? e.message : e)
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
