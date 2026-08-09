// text → hex64. ONE engine, always (id:kc-p-fence).
//
// Not crypto.subtle: secure-context only (id:kc-env) — absent exactly where the
// classroom runs; that fence alone carries these 2 KB. Sync keeps the naming
// layer pure and node-testable (id:kb-1) — the bonus, not the reason.
//
// FIPS 180-4. The algorithm block below is replaceable as a unit; nothing
// dojo-shaped lives inside it.

const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const w = new Uint32Array(64)

function sha256(bytes) {
    const len = bytes.length
    // 0x80, then zeroes, then a 64-bit big-endian bit count — padded to blocks.
    const m = new Uint8Array(((len + 72) >> 6) << 6)
    m.set(bytes)
    m[len] = 0x80
    const view = new DataView(m.buffer)
    view.setUint32(m.length - 8, Math.floor(len / 0x20000000))
    view.setUint32(m.length - 4, (len * 8) >>> 0)

    const H = new Uint32Array([
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ])

    for (let i = 0; i < m.length; i += 64) {
        for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + (j << 2))
        for (let j = 16; j < 64; j++) {
            const x = w[j - 15], y = w[j - 2]
            const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
            const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
            w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0
        }

        let [a, b, c, d, e, f, g, h] = H

        for (let j = 0; j < 64; j++) {
            const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
            const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[j] + w[j]) | 0
            const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
            const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0
            h = g; g = f; f = e; e = (d + t1) | 0
            d = c; c = b; b = a; a = (t1 + t2) | 0
        }

        H[0] += a; H[1] += b; H[2] += c; H[3] += d
        H[4] += e; H[5] += f; H[6] += g; H[7] += h
    }

    let hex = ""
    for (let i = 0; i < 8; i++) hex += H[i].toString(16).padStart(8, "0")
    return hex
}

const utf8 = new TextEncoder()

/**
 * The name of a value, derived from the bytes that hold it (id:kc-law 3).
 * @param {string} text
 * @returns {string} 64 lowercase hex digits
 */
export const hash = (text) => sha256(utf8.encode(text))
