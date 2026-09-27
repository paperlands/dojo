// One hash engine — oracle equivalence (id:kb-1 GREEN).
// node:crypto is a REFERENCE in the test only, never in the runtime.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { hash } from "../../../assets/js/keep/hash.js"

const oracle = (text) => createHash("sha256").update(text, "utf8").digest("hex")

// NIST CAVP SHA-256 short messages (byte-oriented).
// https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program
const NIST = [
    {
        // empty
        msg: "",
        dig: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    },
    {
        // "abc"
        msg: "abc",
        dig: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    },
    {
        // "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
        msg: "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
        dig: "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    },
]

describe("hash: FIPS 180-4 oracle equivalence", () => {
    test("NIST short vectors", () => {
        for (const { msg, dig } of NIST) {
            assert.equal(hash(msg), dig, `NIST: ${JSON.stringify(msg).slice(0, 40)}`)
            assert.equal(oracle(msg), dig, "oracle agrees with NIST")
        }
    })

    test("every byte length 0…200 — padding boundaries 55/56/64", () => {
        // SHA-256 pads to 512-bit blocks. Lengths 55, 56, 64 and neighbours
        // cross the one-block / two-block padding edge.
        for (let n = 0; n <= 200; n++) {
            const text = "x".repeat(n)
            assert.equal(hash(text), oracle(text), `len ${n}`)
        }
    })

    test("astral-plane codepoints — utf8 multi-byte", () => {
        const text = "hello 🌍 math ∫∂∇ 𝄞"
        assert.equal(hash(text), oracle(text))
        assert.match(hash(text), /^[0-9a-f]{64}$/)
    })

    test("1e6 bytes — large input", () => {
        const text = "a".repeat(1_000_000)
        assert.equal(hash(text), oracle(text))
    })

    test("identical input → identical name, every time", () => {
        const t = "to forward 100\n"
        assert.equal(hash(t), hash(t))
        assert.equal(hash(t), oracle(t))
    })
})
