// The stamp (id:kc-parts, build 0) — strictly increasing, clamped, per-hand.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createStamp, stamp, compare } from "../../../assets/js/utils/stamp.js"

// A clock we drive by hand. The module takes its reader, so there is nothing
// to mock (id:kc-c-pure).
const handClock = (start) => {
    let t = start
    return { now: () => t, set: (v) => { t = v }, step: (d) => { t += d } }
}

describe("stamp: the mint", () => {
    test("first stamp takes the wall clock at n=0", () => {
        const c = handClock(1_700_000_000_000)
        const { stamp } = createStamp(c)
        assert.deepEqual(stamp(), { t: 1_700_000_000_000, n: 0 })
    })

    test("same millisecond increments n and holds t", () => {
        const c = handClock(1_700_000_000_000)
        const { stamp } = createStamp(c)
        assert.deepEqual(stamp(), { t: 1_700_000_000_000, n: 0 })
        assert.deepEqual(stamp(), { t: 1_700_000_000_000, n: 1 })
        assert.deepEqual(stamp(), { t: 1_700_000_000_000, n: 2 })
    })

    test("an advancing clock resets n — n is a same-ms tiebreak, not a total", () => {
        const c = handClock(1_000)
        const { stamp } = createStamp(c)
        stamp()
        stamp()
        c.step(1)
        assert.deepEqual(stamp(), { t: 1_001, n: 0 })
    })
})

describe("stamp: t never walks back (id:kc-parts)", () => {
    test("a backward clock holds t and increments n", () => {
        const c = handClock(5_000)
        const { stamp } = createStamp(c)
        assert.deepEqual(stamp(), { t: 5_000, n: 0 })
        c.set(4_000) // NTP correction, resume, or a hand on the system clock
        assert.deepEqual(stamp(), { t: 5_000, n: 1 })
        assert.deepEqual(stamp(), { t: 5_000, n: 2 })
    })

    test("the clock catching back up resumes at the real time", () => {
        const c = handClock(5_000)
        const { stamp } = createStamp(c)
        stamp()
        c.set(4_000)
        stamp()
        c.set(5_001)
        assert.deepEqual(stamp(), { t: 5_001, n: 0 })
    })

    test("no pair is ever minted twice, however the clock jitters", () => {
        // The identity law: a reissued stamp is a reissued NAME, and the room
        // drops the second entry. This is the test that matters.
        const c = handClock(1_000)
        const { stamp } = createStamp(c)
        const jitter = [0, +1, -5, +3, 0, 0, -1, +9, -9, +1, 0, -2]
        const seen = new Set()
        let prev = null
        for (const d of jitter) {
            for (let i = 0; i < 4; i++) {
                const s = stamp()
                const key = `${s.t}/${s.n}`
                assert.ok(!seen.has(key), `stamp reissued: ${key}`)
                seen.add(key)
                if (prev) assert.ok(compare(prev, s) < 0, "stamps must strictly increase")
                prev = s
            }
            c.step(d)
        }
        assert.equal(seen.size, jitter.length * 4)
    })

    test("a coarsened clock still yields distinct ordered stamps", () => {
        // Firefox under privacy.resistFingerprinting floors Date.now() to 100ms,
        // so n carries the order in normal operation, not only at the edge.
        const c = handClock(1_700_000_000_000)
        const { stamp } = createStamp(c)
        const out = []
        for (let i = 0; i < 250; i++) {
            out.push(stamp())
            if (i % 100 === 99) c.step(100)
        }
        for (let i = 1; i < out.length; i++) {
            assert.ok(compare(out[i - 1], out[i]) < 0, `not increasing at ${i}`)
        }
    })
})

describe("stamp: the ambient hand", () => {
    test("mints epoch milliseconds, not navigation-relative time", () => {
        const s = stamp()
        // performance.now() is typically << 1e12; wall clock is ~1.7e12
        assert.ok(s.t > 1e12, "epoch ms, not performance.now()")
        assert.equal(typeof s.n, "number")
    })

    test("two mints from the process never collide", () => {
        const a = stamp()
        const b = stamp()
        assert.ok(compare(a, b) < 0)
    })

    test("hands are independent — one does not disturb another", () => {
        const kai = createStamp(handClock(1_000))
        const sky = createStamp(handClock(1_000))
        kai.stamp()
        kai.stamp()
        assert.deepEqual(sky.stamp(), { t: 1_000, n: 0 })
    })
})

describe("stamp: compare is the order", () => {
    test("orders by t, then by n", () => {
        assert.ok(compare({ t: 100, n: 9 }, { t: 200, n: 0 }) < 0)
        assert.ok(compare({ t: 100, n: 0 }, { t: 100, n: 1 }) < 0)
        assert.equal(compare({ t: 100, n: 1 }, { t: 100, n: 1 }), 0)
    })

    test("sorts newest-last, matching the shelf's reverse cursor read", () => {
        // The measured probe order (id:kc-c-shelf): openCursor("prev") yields
        // c,b,e,a over (t 300, 200, 100·n1, 100·n0).
        const a = { t: 100, n: 0 }
        const b = { t: 200, n: 0 }
        const c = { t: 300, n: 0 }
        const e = { t: 100, n: 1 }
        const newestFirst = [a, b, c, e].sort(compare).reverse()
        assert.deepEqual(newestFirst, [c, b, e, a])
    })
})
