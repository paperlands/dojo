// The keep cell — one empty fold breath + one valued ask (kb-vet4 33).
// Run: node --test test/js/keep/cell_test.mjs

import { describe, test } from "node:test"
import assert from "node:assert/strict"

import {
    askKeep,
    peerOf,
    registerKeeper,
    touched,
    watchTouched,
} from "../../../assets/js/keep/cell.js"

/** Seat a keeper that records its asks and answers `id`. */
function seatKeeper(id = "kept") {
    const seen = []
    const un = registerKeeper((ask) => {
        seen.push(ask)
        return id
    })
    return { seen, un }
}

describe("touched: one empty fold breath", () => {
    test("notifies with no payload — rest/ignite is not the signal", () => {
        const seen = []
        const un = watchTouched((...args) => seen.push(args))
        touched()
        un()
        assert.equal(seen.length, 1)
        assert.deepEqual(seen[0], [])
    })

    test("mint and share are the same empty breath — not empty×2", () => {
        let n = 0
        const un = watchTouched(() => { n += 1 })
        touched() // was landed
        touched() // was stay
        un()
        assert.equal(n, 2)
    })
})

describe("askKeep: one value (kb-vet4 33)", () => {
    test("straight keep asks { title } only — no prev key", async () => {
        const { seen, un } = seatKeeper()
        await askKeep("a small step")
        un()
        assert.deepEqual(seen, [{ title: "a small step" }])
        assert.equal(Object.hasOwn(seen[0], "prev"), false)
    })

    test("draft fork asks { title, prev } as one ask", async () => {
        const parent = "a".repeat(64)
        const { seen, un } = seatKeeper()
        await askKeep("forked", { prev: parent })
        un()
        assert.deepEqual(seen, [{ title: "forked", prev: parent }])
    })

    test("letters and peer ride the ask — signature_of inputs (id:kc-sign)", async () => {
        const peerRoot = "b".repeat(64)
        const { seen, un } = seatKeeper()
        await askKeep("named", {
            name: "bob",
            peer: { root: peerRoot, name: "alice" },
        })
        un()
        assert.deepEqual(seen, [
            {
                title: "named",
                name: "bob",
                peer: { root: peerRoot, name: "alice" },
            },
        ])
    })

    test("name is not invented — shell must pass letters", async () => {
        const { seen, un } = seatKeeper()
        await askKeep("quiet")
        un()
        assert.deepEqual(seen, [{ title: "quiet" }])
        assert.equal(Object.hasOwn(seen[0], "name"), false)
    })

    test("empty / non-string prev is omitted — not a side channel", async () => {
        const { seen, un } = seatKeeper()
        await askKeep("quiet", { prev: null })
        await askKeep("quiet", { prev: "" })
        await askKeep("quiet", {})
        un()
        for (const ask of seen) {
            assert.deepEqual(ask, { title: "quiet" })
            assert.equal(Object.hasOwn(ask, "prev"), false)
        }
    })
})

describe("peerOf: outershell origin → ask.peer", () => {
    test("live presence name wins; origin.name only when presence is gone", () => {
        const root = "c".repeat(64)
        const shell = {
            currentOrigin: () => ({ root, name: "alice-stale", addr: "class:shell:x" }),
        }
        assert.deepEqual(
            peerOf(shell, { presenceName: () => "alice-live" }),
            { root, name: "alice-live" },
        )
        assert.deepEqual(
            peerOf(shell, { presenceName: () => null }),
            { root, name: "alice-stale" },
        )
        assert.deepEqual(
            peerOf({ currentOrigin: () => ({ root, name: "alice", addr: "x" }) }),
            { root, name: "alice" },
        )
        assert.equal(peerOf({ currentOrigin: () => ({ name: "alice" }) }), null)
        assert.equal(peerOf({ currentOrigin: () => null }), null)
        assert.equal(peerOf(null), null)
    })
})

describe("askKeep is answered — the seal ends on a fact (id:kj-vet 2)", () => {
    test("the keeper's id comes back to the asker", async () => {
        const un = registerKeeper(() => "the-id")
        assert.equal(await askKeep("named"), "the-id")
        un()
    })

    test("a refused mint answers null — not silence", async () => {
        const un = registerKeeper(() => null)
        assert.equal(await askKeep("refused"), null)
        un()
    })

    test("no keeper seated answers null at once — never a pending ask", async () => {
        assert.equal(await askKeep("unseated"), null)
    })

    test("one occupant: a later keeper wins, the first stops hearing", async () => {
        const first = []
        const unFirst = registerKeeper((ask) => (first.push(ask), "first"))
        const unSecond = registerKeeper(() => "second")
        assert.equal(await askKeep("who"), "second")
        assert.deepEqual(first, [], "a broadcast would have told both")
        unSecond()
        unFirst()
    })

    test("a keeper that throws answers null — a drop is a fact (id:kc-c-wire)", async () => {
        const un = registerKeeper(() => {
            throw new Error("worker died mid-join")
        })
        // A rejection here is a seal nobody will ever end.
        assert.equal(await askKeep("boom"), null)
        un()
    })
})
