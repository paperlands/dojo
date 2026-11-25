// Root = name(exact genesis); work = name(its first keep) (id:kc-law 1).
// Genesis lives in self, not the moment log; its public key travels as evidence.
// This mint is pure; the journal atomically seats genesis + key (id:keep-auth-write-guard).

import { write } from "./entry.js"

/**
 * Pattern 1's mint side: one draw of 32 random bytes, as hex64.
 *
 * The journal's root is not this value — it is the *name of the genesis
 * entry that carries it*. A work is the first keep's name, not this draw.
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
 * Random, stamp and optional public credential are explicit inputs.
 * The journal supplies the credential; keyless genesis is historical data only.
 *
 * @param {(arr: Uint8Array) => Uint8Array} random
 * @param {{t: number, n: number}} ts
 * @param {{v: number, algorithm: string, public_key: string} | null} [auth]
 * @returns {string} the entry — the durable message
 */
export function genesisBytes(random, ts, auth = null) {
    return write("genesis", { nonce: nonce(random), ...(auth ? { auth } : {}) }, { ts })
}
