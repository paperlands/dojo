// The entry is text (id:kb-2, id:kc-p-text) — pure, sync, no mocks.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { V, write, read, name, unshaped } from "../../../assets/js/keep/entry.js"
import { hash } from "../../../assets/js/keep/hash.js"

const ctx = Object.freeze({
    root: "a".repeat(64),
    target: "b".repeat(64),
    ts: Object.freeze({ t: 1_700_000_000_000, n: 0 }),
})

describe("entry: write is the one place a value becomes text", () => {
    test("returns a string — the entry is never an object", () => {
        const bytes = write("snap", { source: "fd 100" }, ctx)
        assert.equal(typeof bytes, "string")
        // It is the JSON text itself; parse is for display only.
        assert.ok(bytes.startsWith("{"))
        assert.ok(bytes.includes('"kind":"snap"'))
    })

    test("authors at V, with the five frozen fields", () => {
        const v = read(write("snap", { source: "fd 100" }, ctx))
        assert.equal(v.v, V)
        assert.equal(v.kind, "snap")
        assert.equal(v.root, ctx.root)
        assert.equal(v.target, ctx.target)
        assert.deepEqual(v.ts, ctx.ts)
        assert.equal(v.source, "fd 100")
    })

    test("identical arguments yield identical bytes, every time", () => {
        // Two orderings of one value would be two names — a duplicate, never a
        // conflict (id:kc-law 2). Same arguments must not invent two.
        const a = write("snap", { source: "fd 100", commands: [] }, ctx)
        const b = write("snap", { source: "fd 100", commands: [] }, ctx)
        assert.equal(a, b)
        assert.equal(name(a), name(b))
    })

    test("name is hash of the bytes — never a parameter, never trusted", () => {
        const bytes = write("snap", { source: "fd 100" }, ctx)
        assert.equal(name(bytes), hash(bytes))
        assert.match(name(bytes), /^[0-9a-f]{64}$/)
    })
})

describe("entry: catalog last — body cannot displace a frozen field", () => {
    // One line in write makes a silent corruption of root inexpressible
    // rather than documented (id:kb-2).

    test("body.root cannot overwrite the catalog's root", () => {
        const bytes = write(
            "snap",
            { root: "attacker-root", source: "x" },
            ctx,
        )
        assert.equal(read(bytes).root, ctx.root)
    })

    test("body.v, body.kind, body.ts, body.target cannot displace the catalog", () => {
        const bytes = write(
            "snap",
            {
                v: 99,
                kind: "evil",
                ts: { t: 0, n: 0 },
                target: "forged",
                source: "x",
            },
            ctx,
        )
        const v = read(bytes)
        assert.equal(v.v, V)
        assert.equal(v.kind, "snap")
        assert.deepEqual(v.ts, ctx.ts)
        assert.equal(v.target, ctx.target)
        assert.equal(v.source, "x")
    })
})

describe("entry: read is for display; unknowns need no rule", () => {
    test("read(write(x)) round-trips the free body", () => {
        const body = {
            source: "fd 100",
            commands: [{ name: "forward", args: [100] }],
            diagnostics: [],
        }
        const v = read(write("snap", body, ctx))
        assert.equal(v.source, body.source)
        assert.deepEqual(v.commands, body.commands)
        assert.deepEqual(v.diagnostics, body.diagnostics)
    })

    test("an unknown field survives read → re-write verbatim", () => {
        // Pattern 5: the entry is a string, so unknowns need no preserve
        // code path — re-spreading the free body is enough. Deleting a
        // "preserve-unknowns" helper would change nothing, because there is none
        // (id:kc-verify, id:kc-adapt).
        const bytes = write(
            "snap",
            { source: "fd 100", mystery: { nested: true, n: 7 } },
            ctx,
        )
        const value = read(bytes)

        // A naive re-keep: hand every free field back through write.
        // Catalog is restored from the value; unknowns ride in the spread.
        const again = write(value.kind, value, {
            root: value.root,
            target: value.target,
            ts: value.ts,
        })
        assert.equal(again, bytes, "re-write of the same free body is byte-identical")
        assert.equal(name(again), name(bytes))
        assert.deepEqual(read(again).mystery, { nested: true, n: 7 })
    })

    test("the catalog is five keys ALWAYS — an omitted one is not an absent one", () => {
        // JSON.stringify DROPS an undefined value, so an omitted `target` would
        // be a different string, hence a different name, for the same value.
        // That is meaning smuggled into an absence (id:kc-r-absence) at the very
        // bottom of the stack — the bytes that ARE the name.
        const omitted = write("snap", { source: "x" }, { root: ctx.root, ts: ctx.ts })
        const explicit = write("snap", { source: "x" }, { ...ctx, target: null })

        assert.equal(omitted, explicit, "omitted target must equal explicit null")
        assert.equal(name(omitted), name(explicit))
        assert.ok(omitted.includes('"target":null'))
        assert.deepEqual(
            Object.keys(read(omitted)).sort(),
            ["kind", "root", "source", "target", "ts", "v"],
        )
    })

    test("null root and target are first-class (genesis base case)", () => {
        // The log's first entry cannot name a log that does not exist yet
        // (id:kb-3). null is the base case, not an exception.
        const bytes = write(
            "genesis",
            { nonce: "c".repeat(64) },
            { root: null, target: null, ts: ctx.ts },
        )
        const v = read(bytes)
        assert.equal(v.root, null)
        assert.equal(v.target, null)
        assert.equal(v.kind, "genesis")
        assert.equal(typeof name(bytes), "string")
    })
})

describe("entry: what it is not", () => {
    test("has no schema, no class, no object model on the wire", () => {
        // The durable unit is the string. read returns a plain object for
        // display; write will never be handed that object *as an entry*
        // (id:kb-2 NOT — a fold's output is not an entry).
        const bytes = write("snap", { source: "x" }, ctx)
        const value = read(bytes)
        assert.equal(Object.getPrototypeOf(value), Object.prototype)
        assert.equal(typeof bytes, "string")
        // name takes the string, never the value.
        assert.equal(name(bytes), hash(bytes))
    })
})

// ── THE PROJECTION FLOOR — one law, both sides of the wire ────────────
//
// The fixture is the law's ONE artifact: this suite and Dojo.Keep.ProjectTest
// read the same file, so the two floors cannot drift apart in silence. They
// did once — client finite, server non-negative integer — and a client could
// mint what the clan refuses forever (id:kb-5-floor, id:kb-vet5 42).

describe("entry: the projection floor", () => {
    const cases = JSON.parse(
        readFileSync(
            new URL("../../fixtures/keep_floor.json", import.meta.url),
            "utf8",
        ),
    )

    for (const c of cases) {
        test(c.note, () => {
            assert.equal(unshaped(c.value), c.why)
        })
    }

    test("what write authors always clears the floor", () => {
        assert.equal(unshaped(read(write("snap", { any: 1 }, ctx))), null)
    })

    test("the genesis is below the floor, and is not a put (id:kb-5-genesis-place)", () => {
        const g = read(write("genesis", { nonce: "c" }, { root: null, ts: ctx.ts }))
        assert.equal(unshaped(g), "root")
    })
})
