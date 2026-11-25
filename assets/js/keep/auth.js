// Own-root proof wire; private keys stay behind the journal worker (id:keep-auth-write-guard).
import { name, unshaped } from "./entry.js"

export const KEEP_PROOF_DOMAIN = "dojo:keep-auth:v1\0"

export async function signingHand(crypto = globalThis.crypto) {
    if (!crypto?.subtle) throw new Error("keep: signing requires a secure context")
    const pair = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"],
    )
    const publicKey = await crypto.subtle.exportKey("raw", pair.publicKey)
    return {
        auth: { v: 1, algorithm: "P256-SHA256", public_key: hex(new Uint8Array(publicKey)) },
        privateKey: pair.privateKey,
    }
}

export async function keepProof(bytes, genesis, privateKey, crypto = globalThis.crypto) {
    if (!privateKey || privateKey.extractable || privateKey.type !== "private") {
        throw new Error("keep: signing key unavailable; a keyless root needs a new signing hand")
    }
    proofContext(bytes, genesis)
    if (!crypto?.subtle) throw new Error("keep: signing requires a secure context")
    const signature = await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" }, privateKey,
        new TextEncoder().encode(KEEP_PROOF_DOMAIN + bytes),
    )
    return { v: 1, genesis, signature: hex(new Uint8Array(signature)) }
}

// Admission, not a stored verdict; the cache retains the original proof bytes.
export async function checkKeepProof(bytes, candidate, crypto = globalThis.crypto) {
    const { v, genesis, signature } = candidate ?? {}
    if (v !== 1 || Object.keys(candidate).length !== 3 ||
        typeof signature !== "string" || !/^[0-9a-f]{128}$/.test(signature)) {
        throw new Error("keep: invalid proof")
    }
    const auth = proofContext(bytes, genesis)
    if (!crypto?.subtle) throw new Error("keep: proof verification requires a secure context")
    const key = await crypto.subtle.importKey("raw", unhex(auth.public_key),
        { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
        unhex(signature), new TextEncoder().encode(KEEP_PROOF_DOMAIN + bytes))
    if (!valid) throw new Error("keep: invalid proof signature")
    return { v, genesis, signature }
}

// One interpreter for the public genesis credential: proofs and readiness share it.
export function publicCredential(genesis) {
    bounded(genesis, 64 * 1024)
    const birth = uniqueJSON(genesis, true)
    const auth = birth?.auth
    if (birth?.v !== 1 || birth.kind !== "genesis" ||
        !Number.isSafeInteger(birth.ts?.t) || birth.ts.t < 0 ||
        !Number.isSafeInteger(birth.ts?.n) || birth.ts.n < 0 ||
        auth?.v !== 1 || auth.algorithm !== "P256-SHA256" ||
        Object.keys(auth).length !== 3 || typeof auth.public_key !== "string" ||
        !/^04[0-9a-f]{128}$/.test(auth.public_key)) {
        throw new Error("keep: invalid proof genesis")
    }
    return auth
}

function proofContext(bytes, genesis) {
    bounded(bytes, 256 * 1024)
    const value = uniqueJSON(bytes)
    if (unshaped(value)) throw new Error("keep: invalid proof message")
    const auth = publicCredential(genesis)
    if (value?.root !== name(genesis)) throw new Error("keep: proof belongs to another root")
    return auth
}

function bounded(bytes, limit) {
    if (typeof bytes !== "string" || /\p{Surrogate}/u.test(bytes) || bytes.length > limit ||
        new TextEncoder().encode(bytes).byteLength > limit) {
        throw new Error("keep: invalid or oversized proof bytes")
    }
}

// JSON.parse supplies syntax; this walk rejects duplicate keys and float clocks.
function uniqueJSON(bytes, genesis = false) {
    const value = JSON.parse(bytes)
    const frames = []
    const tokens = /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]]/g
    for (const token of bytes.matchAll(tokens)) {
        const word = token[0]
        const frame = frames.at(-1)
        if (/[.eE]/.test(word) && word[0] !== '"' && !Number.isFinite(Number(word))) {
            throw new Error("keep: floating proof JSON number overflow")
        }
        if (word === "{" || word === "[") {
            const role = !frame ? "root" : frame.role !== "root" ? "other" :
                frame.key === "ts" ? "clock" : genesis && frame.key === "auth" ? "auth" : "other"
            frames.push({ role, keys: word === "{" ? new Set() : null, key: null })
        } else if (word === "}" || word === "]") {
            frames.pop()
        } else if (word[0] === '"') {
            const decoded = JSON.parse(word)
            if (/\p{Surrogate}/u.test(decoded)) throw new Error("keep: invalid Unicode proof JSON")
            let next = token.index + word.length
            while (/\s/.test(bytes[next] ?? "")) next += 1
            if (bytes[next] !== ":") continue
            const key = decoded
            if (frame.keys.has(key)) throw new Error("keep: duplicate proof JSON key")
            frame.keys.add(key)
            frame.key = key
        } else if (frame && ((frame.role === "root" && frame.key === "v") ||
            (frame.role === "clock" && ["t", "n"].includes(frame.key)) ||
            (frame.role === "auth" && frame.key === "v"))) {
            if (!/^-?(?:0|[1-9]\d*)$/.test(word)) throw new Error("keep: noninteger proof JSON field")
        }
    }
    return value
}

function unhex(text) {
    return Uint8Array.from(text.match(/../g), (byte) => parseInt(byte, 16))
}

function hex(bytes) {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}
