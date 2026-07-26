import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { temporal } from "../../assets/js/utils/temporal.js"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

describe("temporal.pace", () => {
    test("a lone call always lands", async () => {
        const seen = []
        const p = temporal.pace((x) => seen.push(x), 20)
        p("only")
        await sleep(60)
        assert.deepEqual(seen, ["only"])
    })

    test("the LAST call always lands once the stream goes quiet", async () => {
        const seen = []
        const p = temporal.pace((x) => seen.push(x), 30)
        for (let i = 0; i < 10; i++) p(i)
        await sleep(120)
        assert.equal(seen.at(-1), 9, "the newest args must be what finally fires")
    })

    test("sustained input still fires — it paces, it does not starve", async () => {
        const seen = []
        const p = temporal.pace((x) => seen.push(x), 20)
        // 150ms of unbroken input: a plain debounce would emit nothing at all.
        const until = Date.now() + 150
        while (Date.now() < until) {
            p(Date.now())
            await sleep(5)
        }
        await sleep(60)
        assert.ok(seen.length >= 3, `expected repeated delivery under load, got ${seen.length}`)
    })

    test("coalesces — fires far less often than it is called", async () => {
        const seen = []
        const p = temporal.pace(() => seen.push(1), 25)
        for (let i = 0; i < 40; i++) { p(); await sleep(2) }
        await sleep(60)
        assert.ok(seen.length < 10, `expected coalescing, got ${seen.length} of 40`)
    })

    test("never drops the newest call while one is in flight (the exec bug)", async () => {
        // The old pipe(exec, delay) returned a STALE cached result and skipped
        // the call outright when one was running. On a per-keystroke spine that
        // means losing the most recent edit — the one thing that must not happen.
        const seen = []
        const p = temporal.pace(async (x) => { seen.push(x); await sleep(30) }, 10)
        p("a")
        await sleep(15)
        p("b")
        await sleep(80)
        assert.deepEqual(seen, ["a", "b"], "the second call must not be swallowed")
    })

    test("cancel() drops a pending trailing call", async () => {
        const seen = []
        const p = temporal.pace((x) => seen.push(x), 30)
        p("x")
        p("y")
        p.cancel()
        await sleep(80)
        assert.deepEqual(seen, [], "a cancelled timer must not fire into a dead surface")
    })

    test("cancel() is safe at rest and leaves the timer reusable", async () => {
        const seen = []
        const p = temporal.pace((x) => seen.push(x), 20)
        p.cancel()
        p("after")
        await sleep(60)
        assert.deepEqual(seen, ["after"])
    })
})
