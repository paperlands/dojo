// The journal names itself (id:kc-law 1, id:kb-3).
//
// We roll one die and write one message; that message's fingerprint is the
// name of the whole journal (id:kc-feynman). The root is name(bytes) of this
// entry — not hash(a bare nonce). Pattern 1: a continuant is minted; an
// occurrent is derived. The author is the first continuant; work is the
// second (id:kb-work) and reuses nonce() for its draw.
//
// This is the journal's name, kept in `self`. It is not a log row: identity
// is not a moment the author kept, and the nonce never ships (id:kb-5-genesis-place).
// Every log keep names this one as `root`.
//
// This file is pure law. The BINDING — once, ever; find-or-create; two tabs
// one genesis — lives in the journal as one readwrite transaction over
// `self` (id:kb-3-owner, id:kb-vet2-root). A random body makes two tabs a
// fork, not a dedup; the stamp's "identical body ⇒ same page" premise does not
// transfer here (id:kc-c-stamp, id:kb-vet3).

import { write } from "./entry.js"

/**
 * Pattern 1's mint side: one draw of 32 random bytes, as hex64.
 *
 * Continuants mint once through this draw. The journal's root is not this
 * value — it is the *name of the genesis entry that carries it*. A work_id is
 * this value directly — the terminal's `mints.work` (id:kb-2a).
 *
 * `random` has the shape of crypto.getRandomValues: it fills the array it is
 * handed. Never crypto.randomUUID — that throws on the classroom path and
 * looks safe (id:kc-env).
 *
 * Read the RETURN, not just the buffer: a `random` that hands back a fresh
 * array instead of filling in place would otherwise draw 64 zeros — silently,
 * and one identical root for every author.
 *
 * @param {(arr: Uint8Array) => Uint8Array} random
 * @returns {string} 64 lowercase hex digits
 */
export function nonce(random) {
    const buf = new Uint8Array(32)
    const bytes = random(buf) ?? buf
    let hex = ""
    for (let i = 0; i < 32; i++) hex += bytes[i].toString(16).padStart(2, "0")
    return hex
}

/**
 * The genesis entry itself — a keep whose name is the journal's root.
 *
 * Pure and synchronous: each call authors a fresh entry. "Once, ever" is the
 * journal's find-or-create over the pure bytes this returns, not a property of
 * this function. The nonce is never kept apart from the entry (id:kb-3 NOT).
 *
 * BOTH inputs are injected, so the bytes are fully determined by the call —
 * half-ambient inputs are what the stamp's own contract refuses (id:kc-c-stamp).
 * The journal passes stamp(); a test passes a fixed pair and asserts bytes.
 *
 * @param {(arr: Uint8Array) => Uint8Array} random
 * @param {{t: number, n: number}} ts
 * @returns {string} the entry — the durable message
 */
export function genesisBytes(random, ts) {
    return write("genesis", { nonce: nonce(random) }, { ts })
}
