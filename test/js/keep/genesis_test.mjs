// The log names itself (id:kb-3, id:kc-law 1) — pure, sync, random injected.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { nonce, genesisBytes } from "../../../assets/js/keep/genesis.js"
import { V, read, name, write } from "../../../assets/js/keep/entry.js"
import { hash } from "../../../assets/js/keep/hash.js"

const here = dirname(fileURLToPath(import.meta.url))
const keep = (f) => readFileSync(join(here, "../../../assets/js/keep/", f), "utf8")

// THE LANDMARK IS THIS LIST (id:kc-verify steps 0-4). The naming layer is pure;
// the two doors are not in it. Adding a file here is a deliberate act.
const PURE = ["hash.js", "entry.js", "genesis.js", "upcast.js"]

const TS = Object.freeze({ t: 1_700_000_000_000, n: 0 })

/** Fill every byte with `b`. Shape of crypto.getRandomValues. */
const fill = (b) => (arr) => {
    arr.fill(b)
    return arr
}

describe("nonce: pattern 1's mint side", () => {
    test("draws 32 bytes as 64 lowercase hex digits", () => {
        const n = nonce(fill(0xab))
        assert.match(n, /^[0-9a-f]{64}$/)
        assert.equal(n, "ab".repeat(32))
    })

    test("same fill → same nonce; different fill → different nonce", () => {
        assert.equal(nonce(fill(0x01)), nonce(fill(0x01)))
        assert.notEqual(nonce(fill(0x01)), nonce(fill(0x02)))
    })

    test("hands the random a 32-byte array — the only size of the draw", () => {
        let seen = null
        nonce((arr) => {
            seen = arr
            arr.fill(0)
            return arr
        })
        assert.ok(seen instanceof Uint8Array)
        assert.equal(seen.length, 32)
    })

    test("is the draw any continuant reuses — work_id is the same shape", () => {
        // mints.work = () => nonce(crypto.getRandomValues) (id:kb-work, id:kb-2a)
        // One law, two instances: author root rides the entry's name; work_id
        // is the draw itself. Both are hex64; neither carries meaning.
        const workId = nonce(fill(0x42))
        assert.match(workId, /^[0-9a-f]{64}$/)
        assert.equal(workId.length, 64)
    })
})

describe("genesisBytes: the entry whose name is the root", () => {
    test("returns a string — the entry is text (id:kc-p-text)", () => {
        const bytes = genesisBytes(fill(0x11), TS)
        assert.equal(typeof bytes, "string")
        assert.ok(bytes.startsWith("{"))
    })

    test("authors a genesis keep: five frozen fields, free body is the nonce", () => {
        const v = read(genesisBytes(fill(0x22), TS))
        assert.equal(v.v, V)
        assert.equal(v.kind, "genesis")
        // root: null is the base case — the first entry cannot name a log
        // that does not yet exist (id:kb-3).
        assert.equal(v.root, null)
        assert.equal(v.target, null)
        assert.equal(typeof v.ts.t, "number")
        assert.equal(typeof v.ts.n, "number")
        assert.equal(v.nonce, "22".repeat(32))
    })

    test("the root is the name of the entry, not the hash of the nonce", () => {
        // id:kc-feynman — we roll one die and write one message; that
        // message's fingerprint names the journal. hash(nonce) alone would
        // name the die, not the message (id:kb-3).
        const bytes = genesisBytes(fill(0x33), TS)
        const root = name(bytes)
        assert.equal(root, hash(bytes))
        assert.match(root, /^[0-9a-f]{64}$/)
        assert.notEqual(root, hash(read(bytes).nonce), "root is not hash(nonce)")
        assert.notEqual(root, read(bytes).nonce, "root is not the bare nonce")
    })

    test("two sessions mint two roots — display name never enters", () => {
        // Two alices are two children (id:kc-verify). Same build, same
        // display name, two draws → two roots. Nothing durable derives from
        // name or user_id (id:kg-genesis-userid, D007).
        const alice = name(genesisBytes(fill(0xaa), TS))
        const alsoAlice = name(genesisBytes(fill(0xbb), TS))
        assert.notEqual(alice, alsoAlice)
        const a = read(genesisBytes(fill(0xaa), TS))
        assert.equal(a.name, undefined)
        assert.equal(a.user_id, undefined)
        assert.equal(a.sessionId, undefined)
        assert.deepEqual(
            Object.keys(a).sort(),
            ["kind", "nonce", "root", "target", "ts", "v"],
        )
    })

    test("the mint is a pure function of its two inputs", () => {
        // Both inputs injected, so identical arguments author identical bytes.
        // Nothing here is "once": the BINDING is the journal's find-or-create
        // in one readwrite transaction (id:kb-3-owner). This function authors a
        // CANDIDATE; the store decides which candidate becomes the root.
        const fixed = fill(0xcd)
        assert.equal(genesisBytes(fixed, TS), genesisBytes(fixed, TS))
    })

    test("two DRAWS are two roots — that is the two-tab fork, stated", () => {
        // A random body means two tabs mint different bytes: a fork, not a
        // dedup. The stamp's "identical body ⇒ same page" premise does not
        // transfer (id:kc-c-stamp, id:kb-vet3), which is exactly why the
        // journal needs ONE transaction and not tab election.
        const tabA = genesisBytes(fill(0x01), TS)
        const tabB = genesisBytes(fill(0x02), TS)
        assert.notEqual(name(tabA), name(tabB))
    })

    test("a random that RETURNS instead of filling in place is not 64 zeros", () => {
        // The one silent catastrophic failure in the naming layer: ignoring the
        // declared return draws all-zeros, so every author mints the SAME root,
        // TOFU binds the first arrival, and the rest are refused forever.
        const returnsFresh = (_buf) => new Uint8Array(32).fill(0x9f)
        assert.equal(read(genesisBytes(returnsFresh, TS)).nonce, "9f".repeat(32))

        // And a void-returning in-place fill still works — both conventions.
        const voidFill = (buf) => { buf.fill(0x5c) }
        assert.equal(read(genesisBytes(voidFill, TS)).nonce, "5c".repeat(32))
    })

    test("the nonce rides inside the entry — never kept apart from it", () => {
        // id:kb-3 NOT: the nonce is never stored beside the entry as a
        // second fact. The free body holds it; the name covers it.
        const bytes = genesisBytes(fill(0x7e), TS)
        assert.ok(bytes.includes('"nonce":"' + "7e".repeat(32) + '"'))
        assert.equal(read(bytes).nonce, "7e".repeat(32))
    })

    test("a rename cannot touch the root — no durable key carries meaning", () => {
        // changeName → root identical (id:kc-verify). There is no field the
        // rename could write: the name is the hash of opaque authored bytes.
        const bytes = genesisBytes(fill(0x55), TS)
        const root = name(bytes)
        // The surface may hold a display name; the entry does not.
        const again = write("genesis", { nonce: read(bytes).nonce }, {
            root: null,
            target: null,
            ts: read(bytes).ts,
        })
        assert.equal(name(again), root)
        assert.equal(again, bytes)
    })
})

describe("genesis: pure law — what it is not", () => {
    // LANDMARK 4, as a test rather than a shell grep — so it survives in CI and
    // fails the moment a file in PURE grows a door (id:kc-verify steps 0–4).
    // Comments may name a refusal, so strip them: the check reads the CODE.
    // A green a comment can fail is a bad green (id:kb-2).
    for (const file of PURE) {
        test(`${file} is pure: no async, no await, no subtle, no UUID, no store`, () => {
            const code = keep(file)
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/\/\/.*$/gm, "")
            for (const banned of [
                /\basync\b/, /\bawait\b/, /crypto\.subtle/, /randomUUID/,
                /localStorage/, /indexedDB|IndexedDB/, /sessionId|user_id|Session/,
            ]) {
                assert.equal(banned.test(code), false, `${file} must not match ${banned}`)
            }
        })
    }

    test("hash.js has exactly one importer — one engine, structurally", () => {
        // The journal reaches the hash through entry.name, never by importing
        // it again (id:kb-2 GREEN). Two importers is two engines waiting.
        const importers = PURE.filter((f) => f !== "hash.js")
            .filter((f) => /from "\.\/hash\.js"/.test(keep(f)))
        assert.deepEqual(importers, ["entry.js"])
    })

    test("needs nobody — no server, no login, a draw is enough", () => {
        // The genesis needs nobody (id:kc-verify). Injected random is the
        // whole world; nothing is fetched, nothing is awaited.
        const root = name(genesisBytes(fill(0x01), TS))
        assert.match(root, /^[0-9a-f]{64}$/)
    })

    test("a body cannot smuggle a forged root into the catalog", () => {
        // Inherited from entry.write catalog-last (id:kb-2), restated here
        // because the genesis *is* the root — forging it would name a lie.
        const bytes = write(
            "genesis",
            { nonce: "aa".repeat(32), root: "forged".padEnd(64, "0") },
            { root: null, target: null, ts: { t: 1, n: 0 } },
        )
        assert.equal(read(bytes).root, null)
        assert.equal(read(bytes).nonce, "aa".repeat(32))
    })
})
