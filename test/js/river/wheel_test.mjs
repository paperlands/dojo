// Wheel: drag-to-pan primary; chrome mid-motion; stand only on settle.
import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { mountWheel, SETTLE_MS, DRAG_PX } from "../../../assets/js/river/wheel.js"

/**
 * A rail the wheel can measure: fixed seats, controllable scrollLeft.
 */
function makeRail(keys, { width = 400, seat = 44, gap = 22 } = {}) {
    const pitch = seat + gap
    const listeners = new Map()
    const classes = new Set()
    const rail = {
        isConnected: true,
        clientWidth: width,
        scrollLeft: 0,
        children: [],
        style: {},
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
        },
        setPointerCapture() {},
        releasePointerCapture() {},
        addEventListener(type, fn, _opts) {
            if (!listeners.has(type)) listeners.set(type, new Set())
            listeners.get(type).add(fn)
        },
        removeEventListener(type, fn) {
            listeners.get(type)?.delete(fn)
        },
        dispatch(type, ev = {}) {
            for (const fn of listeners.get(type) ?? []) fn(ev)
        },
        scrollTo({ left }) {
            this.scrollLeft = left
            this.dispatch("scroll")
        },
    }

    keys.forEach((key, i) => {
        const col = {
            dataset: { key },
            offsetLeft: i * pitch,
            offsetWidth: seat,
            classList: {
                _c: new Set(),
                toggle(name, on) {
                    if (on) this._c.add(name)
                    else this._c.delete(name)
                },
                contains(name) {
                    return this._c.has(name)
                },
            },
            style: {
                _p: new Map(),
                setProperty(k, v) {
                    this._p.set(k, v)
                },
            },
            closest(sel) {
                if (String(sel).includes("water")) return null
                if (String(sel).includes("river-col") || String(sel).includes("[data-key")) return col
                return null
            },
            querySelector(sel) {
                if (sel.includes("sky")) {
                    return { dataset: { id: key === "present" ? null : `id-${key}` } }
                }
                return null
            },
        }
        if (key === "present") {
            col.querySelector = () => ({ dataset: { id: null } })
        }
        rail.children.push(col)
    })

    return rail
}

function centersOf(keys, width = 400, seat = 44, gap = 22) {
    const pitch = seat + gap
    return keys.map((_, i) => i * pitch + seat / 2 - width / 2)
}

describe("wheel: onCenter vs onSettle", () => {
    let realRaf
    let realCaf
    let realSetTimeout
    let realClearTimeout
    let timers
    let now

    beforeEach(() => {
        now = 0
        timers = new Map()
        let tid = 0
        realRaf = globalThis.requestAnimationFrame
        realCaf = globalThis.cancelAnimationFrame
        realSetTimeout = globalThis.setTimeout
        realClearTimeout = globalThis.clearTimeout
        globalThis.requestAnimationFrame = (fn) => {
            fn()
            return 0
        }
        globalThis.cancelAnimationFrame = () => {}
        globalThis.setTimeout = (fn, ms) => {
            const id = ++tid
            timers.set(id, { fn, at: now + (ms ?? 0) })
            return id
        }
        globalThis.clearTimeout = (id) => {
            timers.delete(id)
        }
    })

    afterEach(() => {
        globalThis.requestAnimationFrame = realRaf
        globalThis.cancelAnimationFrame = realCaf
        globalThis.setTimeout = realSetTimeout
        globalThis.clearTimeout = realClearTimeout
    })

    function advance(ms) {
        now += ms
        for (const [id, t] of [...timers.entries()]) {
            if (t.at <= now) {
                timers.delete(id)
                t.fn()
            }
        }
    }

    test("instant restAt settles at once — no debounce before stand", () => {
        const rail = makeRail(["a", "b", "present"])
        const centers = []
        const settles = []
        const wheel = mountWheel(rail, {
            onCenter: (w) => centers.push(w?.key ?? null),
            onSettle: (w) => settles.push(w?.key ?? null),
        })

        wheel.restAt("present")
        assert.deepEqual(centers, ["present"])
        assert.deepEqual(settles, ["present"], "instant seating stands immediately")

        wheel.restAt("a")
        assert.deepEqual(centers, ["present", "a"])
        assert.deepEqual(settles, ["present", "a"])

        wheel.release()
    })

    test("re-settling the same seat does not re-fire onSettle", () => {
        const rail = makeRail(["a", "present"])
        const settles = []
        const wheel = mountWheel(rail, {
            onSettle: (w) => settles.push(w?.key ?? null),
        })

        wheel.restAt("a")
        assert.deepEqual(settles, ["a"])
        wheel.restAt("a")
        assert.deepEqual(settles, ["a"], "idempotent rest")

        wheel.release()
    })
})

describe("wheel: drag-to-pan", () => {
    let realRaf

    beforeEach(() => {
        realRaf = globalThis.requestAnimationFrame
        globalThis.requestAnimationFrame = (fn) => {
            fn()
            return 0
        }
    })

    afterEach(() => {
        globalThis.requestAnimationFrame = realRaf
    })

    test("pan follows the finger; stand only on release snap", () => {
        const keys = ["a", "b", "present"]
        const rail = makeRail(keys)
        const [leftA, leftB, leftP] = centersOf(keys)
        const centers = []
        const settles = []
        const wheel = mountWheel(rail, {
            onCenter: (w) => centers.push(w?.key ?? null),
            onSettle: (w) => settles.push(w?.key ?? null),
        })

        wheel.restAt("present")
        assert.deepEqual(settles, ["present"])
        centers.length = 0
        settles.length = 0

        // Content follows the finger: drag RIGHT → scrollLeft falls → older keeps.
        // scrollLeft = startScroll - (clientX - startX)
        const startX = 200
        rail.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: startX, target: rail })
        assert.equal(rail.classList.contains("is-dragging"), false, "grab not yet a pan")

        // Not yet a pan.
        rail.dispatch("pointermove", {
            pointerId: 1,
            clientX: startX + (DRAG_PX - 1),
            cancelable: true,
            preventDefault() {},
        })
        assert.equal(rail.classList.contains("is-dragging"), false)
        assert.deepEqual(settles, [], "tap jitter does not stand")

        // Want scrollLeft ≈ leftB: dx = startScroll - leftB = leftP - leftB (> 0 → finger right)
        const dxToB = leftP - leftB
        rail.dispatch("pointermove", {
            pointerId: 1,
            clientX: startX + dxToB,
            cancelable: true,
            preventDefault() {},
        })
        assert.equal(rail.classList.contains("is-dragging"), true, "past threshold is a pan")
        assert.ok(Math.abs(rail.scrollLeft - leftB) < 1, `scroll tracks finger (got ${rail.scrollLeft}, want ~${leftB})`)
        assert.ok(centers.includes("b") || centers.includes("a"), "chrome followed the sun")
        assert.deepEqual(settles, [], "no stand while the hand holds the drum")

        // Finish over a.
        const dxToA = leftP - leftA
        rail.dispatch("pointermove", {
            pointerId: 1,
            clientX: startX + dxToA,
            cancelable: true,
            preventDefault() {},
        })
        assert.deepEqual(settles, [])

        rail.dispatch("pointerup", { pointerId: 1 })
        assert.equal(rail.classList.contains("is-dragging"), false)
        assert.deepEqual(settles, ["a"], "one stand, after snap on release")
        assert.ok(Math.abs(rail.scrollLeft - leftA) < 0.5)

        wheel.release()
    })

    test("a tap on a keep jumps there (click-to-seat)", () => {
        const rail = makeRail(["a", "present"])
        const settles = []
        const wheel = mountWheel(rail, {
            onSettle: (w) => settles.push(w?.key ?? null),
        })

        wheel.restAt("present")
        settles.length = 0

        // Press on column a, release without dragging past the threshold.
        const colA = rail.children[0]
        rail.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 100, target: colA })
        rail.dispatch("pointermove", {
            pointerId: 1,
            clientX: 100 + 2,
            cancelable: true,
            preventDefault() {},
        })
        rail.dispatch("pointerup", { pointerId: 1, target: colA })

        assert.deepEqual(settles, ["a"], "tap seats the pressed keep")

        wheel.release()
    })

    test("ghost click after a pan is swallowed", () => {
        const keys = ["a", "present"]
        const rail = makeRail(keys)
        const [leftA, leftP] = centersOf(keys)
        const wheel = mountWheel(rail, {})
        wheel.restAt("present")

        rail.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: 200, target: rail })
        const dx = leftP - leftA
        rail.dispatch("pointermove", {
            pointerId: 1,
            clientX: 200 - dx,
            cancelable: true,
            preventDefault() {},
        })
        rail.dispatch("pointerup", { pointerId: 1 })

        let prevented = false
        let stopped = false
        rail.dispatch("click", {
            preventDefault() {
                prevented = true
            },
            stopPropagation() {
                stopped = true
            },
        })
        assert.equal(prevented && stopped, true, "pan must not fire restAt via click")

        wheel.release()
    })

    test("no settle while dragging even if scroll events fire", () => {
        const keys = ["a", "b", "present"]
        const rail = makeRail(keys)
        const [leftA, , leftP] = centersOf(keys)
        const settles = []
        let now = 0
        const timers = new Map()
        let tid = 0
        const realSet = globalThis.setTimeout
        const realClear = globalThis.clearTimeout
        globalThis.setTimeout = (fn, ms) => {
            const id = ++tid
            timers.set(id, { fn, at: now + ms })
            return id
        }
        globalThis.clearTimeout = (id) => timers.delete(id)

        const wheel = mountWheel(rail, {
            onSettle: (w) => settles.push(w?.key ?? null),
        })
        wheel.restAt("present")
        settles.length = 0

        const startX = 200
        const dxToA = leftP - leftA
        rail.dispatch("pointerdown", { button: 0, pointerId: 1, clientX: startX, target: rail })
        rail.dispatch("pointermove", {
            pointerId: 1,
            clientX: startX + dxToA,
            cancelable: true,
            preventDefault() {},
        })
        // Scroll noise during drag must not arm a stand.
        rail.dispatch("scroll")
        now += SETTLE_MS + 50
        for (const [id, t] of [...timers.entries()]) {
            if (t.at <= now) {
                timers.delete(id)
                t.fn()
            }
        }
        assert.deepEqual(settles, [], "hand still holds the drum")

        rail.dispatch("pointerup", { pointerId: 1 })
        assert.equal(settles.length, 1)
        assert.equal(settles[0], "a")

        globalThis.setTimeout = realSet
        globalThis.clearTimeout = realClear
        wheel.release()
    })
})
