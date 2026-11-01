// M2a: same-origin live availability, not an author image commitment.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { liveForkRef, pullImage, pullHistory } from "../../../assets/js/link.js"
import { writeSnap } from "../../../assets/js/keep/kinds/snap.js"
import { name, read } from "../../../assets/js/keep/entry.js"
import { genesisBytes } from "../../../assets/js/keep/genesis.js"
import { keepProof, signingHand } from "../../../assets/js/keep/auth.js"

const ROOT = "a".repeat(64)
const SRC = "goto 5 0\nlet p"
const CHOICES = {
    v: 1,
    inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 2, 0] } }],
}
const PROOF = { v: 1, genesis: "c".repeat(64), signature: "ab".repeat(64) }
const origin = writeSnap({ root: ROOT, source: SRC, choices: CHOICES, ts: { t: 1, n: 0 } })
const WORK = name(origin)
const child = writeSnap({ root: ROOT, work_id: WORK, source: SRC, choices: CHOICES, ts: { t: 2, n: 0 } })
const ID = name(child)
const PNG = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }

function entry(bytes, over = {}) {
    return { id: name(bytes), message: bytes, source: SRC, proof: PROOF, ...over }
}

function fixture({ entries = [origin, child], head = ID, headRecord = null, image = PNG, check = async () => true } = {}) {
    const records = new Map(entries.map((bytes) => [name(bytes), entry(bytes)]))
    return {
        pull: async (id) => records.get(id) ?? null,
        head: async () => headRecord ?? (head == null ? null : { id: head }),
        image: async () => image,
        check,
    }
}

describe("liveForkRef: current server availability gate", () => {
    test("a complete signed construction + preview earns an exact link", async () => {
        const f = fixture()
        assert.equal(await liveForkRef({ id: ID, ...f }), `keep:${ID}`)
    })

    test("a complete selected head and evidenced origin earns a work link", async () => {
        const f = fixture()
        assert.equal(await liveForkRef({ id: ID, work: WORK, ...f }), `work:${WORK}`)
    })

    test("selected not server head falls back to the exact selected keep", async () => {
        const f = fixture({ head: "e".repeat(64) })
        assert.equal(await liveForkRef({ id: ID, work: WORK, ...f }), `keep:${ID}`)
    })

    test("missing or bad server head cannot throw away the earned exact link", async () => {
        assert.equal(await liveForkRef({ id: ID, work: WORK, ...fixture({ head: null }) }), `keep:${ID}`)
    })

    test("a refusal or unreadable id is not live", async () => {
        const f = fixture({ entries: [] })
        assert.equal(await liveForkRef({ id: ID, ...f }), null)
        assert.equal(await liveForkRef({ id: "not-hex", ...f }), null)
    })

    test("malformed proof is not live", async () => {
        const f = fixture({ check: async () => { throw new Error("bad proof") } })
        assert.equal(await liveForkRef({ id: ID, ...f }), null)
        const noProof = fixture()
        noProof.pull = async (id) => {
            const got = await fixture().pull(id)
            return { ...got, proof: null }
        }
        assert.equal(await liveForkRef({ id: ID, ...noProof }), null)
    })

    test("source hash mismatch is not live", async () => {
        const f = fixture()
        const pull = f.pull
        f.pull = async (id) => ({ ...(await pull(id)), source: "different" })
        assert.equal(await liveForkRef({ id: ID, ...f }), null)
    })

    test("missing preview is not live", async () => {
        assert.equal(await liveForkRef({ id: ID, ...fixture({ image: null }) }), null)
    })

    test("future envelope or non-snap kind is not live", async () => {
        for (const bytes of [
            JSON.stringify({ ...read(child), v: 2 }),
            JSON.stringify({ ...read(child), kind: "genesis" }),
        ]) {
            const f = fixture({ entries: [bytes] })
            assert.equal(await liveForkRef({ id: name(bytes), ...f }), null)
        }
    })

    test("a throwing image callback fails closed", async () => {
        const f = fixture()
        f.image = async () => { throw new Error("body lost") }
        assert.equal(await liveForkRef({ id: ID, ...f }), null)
    })

    test("a contradictory full head cannot earn a work label", async () => {
        const f = fixture()
        assert.equal(await liveForkRef({
            id: ID, work: WORK, ...f, head: async () => ({ ...entry(child) }),
        }), `work:${WORK}`)
        assert.equal(await liveForkRef({
            id: ID, work: WORK, ...f,
            head: async () => ({
                ...entry(child),
                proof: { signature: PROOF.signature, v: PROOF.v, genesis: PROOF.genesis },
            }),
        }), `work:${WORK}`)
        assert.equal(await liveForkRef({
            id: ID, work: WORK, ...f,
            head: async () => ({
                ...entry(child),
                proof: { ...PROOF, signature: "0".repeat(128) },
            }),
        }), `keep:${ID}`)
        assert.equal(await liveForkRef({
            id: ID, work: WORK, ...f, head: async () => ({ ...entry(child), message: origin }),
        }), `keep:${ID}`)
    })

    test("selected origin reuses its exact read instead of a second GET", async () => {
        let pulls = 0
        let checks = 0
        const f = fixture({
            entries: [origin],
            head: WORK,
            image: PNG,
            check: async () => { checks += 1 },
        })
        const pull = f.pull
        f.pull = async (id) => { pulls += 1; return pull(id) }
        assert.equal(await liveForkRef({ id: WORK, work: WORK, ...f }), `work:${WORK}`)
        assert.equal(pulls, 1)
        assert.equal(checks, 1)
    })

    test("real P256 proof earns default-check live; tampered proof fails", async () => {
        const hand = await signingHand()
        const birth = genesisBytes((a) => a.fill(7), { t: 0, n: 0 }, hand.auth)
        const bytes = writeSnap({
            root: name(birth), source: SRC, choices: CHOICES, ts: { t: 1, n: 0 },
        })
        const id = name(bytes)
        const proof = await keepProof(bytes, birth, hand.privateKey)
        const pull = async (ref) => ref === id ? { id, message: bytes, source: SRC, proof } : null
        assert.equal(await liveForkRef({ id, pull, head: async () => null, image: async () => PNG }), `keep:${id}`)

        const sig = proof.signature.slice(0, -1) + (proof.signature.endsWith("0") ? "1" : "0")
        const tampered = async () => ({ id, message: bytes, source: SRC, proof: { ...proof, signature: sig } })
        assert.equal(await liveForkRef({ id, pull: tampered, head: async () => null, image: async () => PNG }), null)
    })
})

describe("pullHistory: lazy read-only work page", () => {
    test("asks the server for target history at REACH", async () => {
        const asks = []
        const page = { keeps: [{ message: child }], next: null }
        const got = await pullHistory(WORK, {
            n: 3,
            fetchImpl: async (url, opts) => {
                asks.push({ url, opts })
                return { ok: true, json: async () => page }
            },
        })
        assert.deepEqual(got, page)
        assert.match(asks[0].url, new RegExp(`/keeps/${WORK}/history`))
        assert.match(asks[0].url, /of=target/)
        assert.match(asks[0].url, /n=3/)
    })
})

describe("pullImage: available PNG content gate (not decoded)", () => {
    const response = (type, bytes, ok = true) => ({
        ok,
        headers: { get: () => type },
        arrayBuffer: async () => bytes,
    })

    test("accepts image/png with the PNG signature", async () => {
        const got = await pullImage(ID, {
            fetchImpl: async () => response("image/png", PNG.bytes),
        })
        assert.deepEqual(got.bytes, PNG.bytes)
    })

    test("rejects non-PNG content type, empty body, and bad signature", async () => {
        for (const res of [
            response("application/octet-stream", PNG.bytes),
            response("image/png", new Uint8Array()),
            response("image/png", new Uint8Array([1, 2, 3])),
            response("image/png", PNG.bytes, false),
        ]) {
            assert.equal(await pullImage(ID, { fetchImpl: async () => res }), null)
        }
    })

    test("a body read rejection fails closed", async () => {
        const res = {
            ok: true,
            headers: { get: () => "image/png" },
            arrayBuffer: async () => { throw new Error("body lost") },
        }
        assert.equal(await pullImage(ID, { fetchImpl: async () => res }), null)
    })
})
