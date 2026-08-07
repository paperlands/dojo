// THE STATUS SEAT'S LAW — one slot, TWO LAYERS: base ?? event.
//
// These are the same seven cases a probe measured breaking under the old
// last-write-wins slot (with a `priority` no status reader ever consulted).
// Each passes now for a STRUCTURAL reason, not a rule: the base COVERS the
// event, so there is nothing left to arbitrate.
//
//   node --test test/js/nerve/seat_probe_test.mjs

import { describe, test } from "node:test"
import assert from "node:assert/strict"

import { installDom, makeEl, seatText, seatKind, seatTally, seatGhosts } from "./dom-shim.mjs"
installDom()

const { createHUD } = await import("../../../assets/js/nerve/hud.js")
const { createSignalStore, signals: S, CHANNELS } =
    await import("../../../assets/js/nerve/store.js")
const { createHeliosWalk, heliosView } =
    await import("../../../assets/js/nerve/helios.js")

const WOUND = "unknown name: foo"
const SAID = `* ${WOUND}`
const hurt = (tally = 1) => ({ msg: "*", payload: WOUND, ref: { line: 3 }, tally })

/**
 * A mounted seat whose health this test drives by hand.
 *
 * The `refresh()` is BIRTH, not ceremony: the seat is built silent because
 * constructing one must never call `health` — the surface lending it is still
 * assembling. Asking at construction threw TDZ and killed the whole outershell
 * mount (2026-08-06). Every surface announces itself the same way.
 */
function mount(t, health = () => null) {
    const container = makeEl()
    const store = createSignalStore()
    const hud = createHUD(container, store, () => {}, { health })
    t.after(() => hud.destroy())
    hud.refresh()
    return { container, store, hud }
}

/** Walk to the end of its animation; returns the last view it spoke. */
function settleWalk(walk, step = 40, limit = 4000) {
    let now = 0, last = null
    for (;;) {
        const v = walk.tick(now)
        if (v) last = v
        if (!walk.isAnimating() || now > limit) return last
        now += step
    }
}

describe("no rank, because there is no race", () => {
    test("`error` is not a channel, and status kinds carry no priority", () => {
        assert.equal(CHANNELS.error, undefined)
        assert.equal(S.error, undefined)
        assert.equal(S.remote, undefined)
        for (const kind of ["system", "helios", "output"]) {
            assert.equal(CHANNELS[kind].zone, "status")
            assert.equal(CHANNELS[kind].priority, undefined)
        }
        // Priority survives exactly where it has a reader — chat eviction.
        assert.equal(CHANNELS.chat.priority, 3)
    })
})

// THE REGRESSION THAT KILLED THE OUTERSHELL (2026-08-06). The panel claims its
// nerve at the TOP of mountOuter, long before `health`/`wounds` are bound below;
// a seat that asks while being built reads them in the temporal dead zone and
// throws, taking the whole surface with it. No wound-behaviour test could catch
// this — they all hand over a `health` that is already bound. The invariant is
// about WHEN, so test when.
describe("a seat is built silent", () => {
    test("construction never calls health — the surface says when", (t) => {
        let asked = 0
        const container = makeEl()
        const store = createSignalStore()
        const hud = createHUD(container, store, () => {}, {
            health: () => { asked++; return null },
        })
        t.after(() => hud.destroy())
        assert.equal(asked, 0, "building a seat must not ask; the organs may not exist yet")
        hud.refresh()
        assert.equal(asked, 1, "and birth is what asks")
    })

    test("a panel opening on a friend already mid-fault seats on that first ask", (t) => {
        const container = makeEl()
        const store = createSignalStore()
        const hud = createHUD(container, store, () => {}, { health: () => hurt() })
        t.after(() => hud.destroy())
        assert.equal(seatText(container), null)
        hud.refresh()
        assert.equal(seatText(container), SAID)
    })
})

describe("1/7 — an open wound owns the seat", () => {
    test("weather cannot displace health, however late it pushes", (t) => {
        const { container, store } = mount(t, () => hurt())
        store.push(S.helios(heliosView({ phase: "building", commands: 200 })))
        assert.equal(seatKind(container), "nerve-error")
        assert.equal(seatText(container), SAID)

        // Every later rung, and the run's own ☀︎, land on a covered layer.
        store.push(S.helios(heliosView({ phase: "building", commands: 10_000 })))
        store.push(S.output("☀︎", 42))
        assert.equal(seatText(container), SAID)
    })
})

describe("2 — a fault has ONE writer", () => {
    test("no fault rung is left to race the sentence", () => {
        // worldProgress no longer counts frame.error, so a faulted world reads
        // as settled weather; the fault reaches the seat only as an ADDRESSED
        // wound. `faults` in a progress bag is now simply ignored.
        assert.equal(heliosView({ phase: "settled", commands: 40, faults: 1 }).id, "success")
        assert.equal(heliosView({ phase: "fault", commands: 40 }).phase, "settled")
    })
})

describe("3/5 — no flourish over an open wound", () => {
    test("a settled world celebrates only where the document is well", (t) => {
        let well = false
        const { container, store, hud } = mount(t, () => (well ? null : hurt()))
        const walk = createHeliosWalk({ read: () => ({ phase: "settled", commands: 9, run: 1 }) })

        const v = settleWalk(walk)
        assert.equal(v.id, "success")
        store.push(S.helios(v))
        assert.equal(seatText(container), SAID)

        // The flourish was never lost — only covered. It shows on heal.
        well = true
        hud.refresh()
        assert.equal(seatText(container), "ˏˋ☀︎ˎˊ 9")
    })
})

describe("4 — a stale tick cannot exist", () => {
    test("the walk re-reads the world; a moved world moves the glyph", (t) => {
        let world = { phase: "building", commands: 3000, run: 7 }
        const { store } = mount(t)
        const walk = createHeliosWalk({ read: () => world })
        const seen = []
        store.subscribe((s) => seen.push(s.msg))

        let v = walk.tick(0)
        store.push(S.helios(v))
        // The armed tick fires AFTER a new run began. The old design re-stepped
        // a frozen bag and finished the previous sun; this one reads the world.
        world = { phase: "building", commands: 0, run: 8 }
        v = walk.tick(40)
        assert.equal(v.id, 0, "a new run rises east, not wherever the last one was")
        assert.equal(walk.mode, "building")
    })

    test("a covered seat still takes the write — the base just wins the paint", (t) => {
        let well = true
        const { container, store, hud } = mount(t, () => (well ? null : hurt()))
        const walk = createHeliosWalk({ read: () => ({ phase: "settled", commands: 600, run: 3 }) })
        store.push(S.helios(walk.tick(0)))
        well = false
        hud.refresh()
        assert.equal(seatText(container), SAID)
        // …the outro finishing changes nothing while the wound stands.
        store.push(S.helios(settleWalk(walk) ?? heliosView({ phase: "settled", commands: 600 })))
        assert.equal(seatText(container), SAID)
    })
})

// A LAYER CHANGE IS STILL A GESTURE. Covering is instant in the law; it must
// not be instant in the eye. What leaves gives up the seat and dissolves behind
// what arrives, so a wound landing on a walking sun is a sunset, not a cut.
describe("5b — one becomes the other", () => {
    test("a wound taking the seat leaves the sun dissolving behind it", (t) => {
        let well = true
        const { container, store, hud } = mount(t, () => (well ? null : hurt()))
        const walk = createHeliosWalk({ read: () => ({ phase: "building", commands: 5, run: 1 }) })
        store.push(S.helios(walk.tick(0)))
        assert.equal(seatKind(container), "nerve-helios")

        well = false
        hud.refresh()
        assert.equal(seatKind(container), "nerve-error", "the wound stands")
        assert.equal(seatText(container), SAID)

        const [ghost] = seatGhosts(container)
        assert.ok(ghost, "the sun is still setting behind the sentence")
        assert.ok(ghost._classes.has("nerve-dissolve"))
        assert.ok(!ghost._classes.has("helios-living"), "a ghost does not breathe")
    })

    test("and the ghost goes when its animation ends — the seat holds one thing", (t) => {
        let well = true
        const { container, store, hud } = mount(t, () => (well ? null : hurt()))
        const walk = createHeliosWalk({ read: () => ({ phase: "building", commands: 5, run: 1 }) })
        store.push(S.helios(walk.tick(0)))
        well = false
        hud.refresh()

        seatGhosts(container)[0].dispatch("animationend", { animationName: "nerve-dissolve" })
        assert.equal(seatGhosts(container).length, 0)
        assert.equal(seatText(container), SAID)
    })
})

describe("6 — heal needs no event", () => {
    test("the base empties by itself and the weather shows through", (t) => {
        let well = false
        const { container, store, hud } = mount(t, () => (well ? null : hurt()))
        const walk = createHeliosWalk({ read: () => ({ phase: "settled", commands: 12, run: 3 }) })
        store.push(S.helios(settleWalk(walk)))
        assert.equal(seatText(container), SAID)

        well = true
        hud.refresh()                       // the wounds' breath, nothing more
        assert.equal(seatKind(container), "nerve-helios")
        assert.equal(seatText(container), "ˏˋ☀︎ˎˊ 12")

        // …and back again, with no ledger to re-arm and no sentence key.
        well = false
        hud.refresh()
        assert.equal(seatText(container), SAID)
    })

    test("the tally moves without a re-arm (the old key had to smuggle it)", (t) => {
        let n = 3
        const { container, hud } = mount(t, () => hurt(n))
        assert.equal(seatTally(container), "○ 3")
        n = 2
        hud.refresh()
        assert.equal(seatTally(container), "○ 2")
    })

    test("a hidden HUD answers with no wound, and re-asks when shown", (t) => {
        const { container, hud } = mount(t, () => hurt())
        assert.equal(seatText(container), SAID)
        hud.hide()
        assert.equal(seatText(container), null)
        hud.show()
        assert.equal(seatText(container), SAID)
    })
})
