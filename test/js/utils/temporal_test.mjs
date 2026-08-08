import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { temporal } from "../../../assets/js/utils/temporal.js"

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

// GATE — memo for side effects: do it only when it would read differently.
// Suppresses by SAMENESS where pace suppresses by RATE. The early cutoff every
// reader of a standing answer needs; hand-rolled three times before it was named.
describe("temporal.gate", () => {
    const rig = () => {
        const drawn = []
        return { drawn, gate: temporal.gate((...a) => drawn.push(a.length > 1 ? a[1] : a[0])) }
    }

    test("the first value is always news", () => {
        const { drawn, gate } = rig()
        gate("ok")
        assert.deepEqual(drawn, ["ok"])
    })

    test("the same value again is not", () => {
        const { drawn, gate } = rig()
        gate("ok"); gate("ok"); gate("ok")
        assert.deepEqual(drawn, ["ok"])
    })

    test("a change is news, and so is coming back", () => {
        const { drawn, gate } = rig()
        gate("ok"); gate("error"); gate("ok")
        assert.deepEqual(drawn, ["ok", "error", "ok"])
    })

    // The ink keys on a digest and draws the diagnostics themselves.
    test("the FIRST argument keys; the rest carry what to draw", () => {
        const { drawn, gate } = rig()
        gate("d1", { at: 1 })
        gate("d1", { at: 2 })   // same key, different body — already drawn
        gate("d2", { at: 3 })
        assert.deepEqual(drawn, [{ at: 1 }, { at: 3 }])
    })

    // Not JSON.stringify over the args: the ink's payload is the whole
    // diagnostic list, walked on every keystroke.
    test("it never walks the payload to decide", () => {
        const drawn = []
        const big = { get boom() { throw new Error("payload was walked") } }
        const gate = temporal.gate((_k, v) => drawn.push(v))
        gate("k", big); gate("k", big)
        assert.equal(drawn.length, 1)
    })

    test("the empty projection is a transition like any other", () => {
        const { drawn, gate } = rig()
        gate("line 4 — boom"); gate(""); gate("line 4 — boom")
        assert.deepEqual(drawn, ["line 4 — boom", "", "line 4 — boom"],
            "healing is a change; the wound returning is news again")
    })

    test("two gates keep their own memory", () => {
        const a = rig(), b = rig()
        a.gate("x"); b.gate("x"); a.gate("x")
        assert.deepEqual(a.drawn, ["x"])
        assert.deepEqual(b.drawn, ["x"])
    })

    test("a custom keyOf can look past the first argument", () => {
        const drawn = []
        const gate = temporal.gate((v) => drawn.push(v), (args) => args[0].id)
        gate({ id: 1, n: "a" }); gate({ id: 1, n: "b" }); gate({ id: 2, n: "c" })
        assert.deepEqual(drawn.map((d) => d.n), ["a", "c"])
    })
})

// THE TALLY MUST NOT GO STALE. Three faults stand and the child fixes one: the
// primary wound is unchanged, so a key that is only the sentence reads "already
// said" and the count sits there lying. The key carries the tally for exactly
// this — it is why the cutoff had to land before the tally could.
describe("a projection that includes its count", () => {
    const rig = () => {
        const said = []
        const say = temporal.gate((_k, v) => said.push(v))
        return { said, speak: (sentence, n) => say(`${sentence} ○${n}`, `${sentence} ○${n}`) }
    }

    test("healing one of three re-says the sentence with the new count", () => {
        const { said, speak } = rig()
        speak("line 4 — boom", 3)
        speak("line 4 — boom", 3)
        speak("line 4 — boom", 2)   // one fixed; the primary did not move
        assert.deepEqual(said, ["line 4 — boom ○3", "line 4 — boom ○2"])
    })

    test("a key of the sentence ALONE would have gone quiet and lied", () => {
        const said = []
        const say = temporal.gate((_k, v) => said.push(v))
        say("line 4 — boom", "line 4 — boom ○3")
        say("line 4 — boom", "line 4 — boom ○2")
        assert.deepEqual(said, ["line 4 — boom ○3"], "the count only ever counts up")
    })
})
