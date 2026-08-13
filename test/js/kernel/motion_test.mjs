// Motion — restart an animation, and survive one that never runs.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { pulse, whenDone } from "../../../assets/js/kernel/motion.js"

/** Enough of Element: classes, one reflow counter, real listener bookkeeping. */
function makeEl() {
    const classes = new Set()
    const listeners = []
    let reflows = 0
    return {
        classes,
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
        },
        get offsetWidth() {
            reflows += 1
            return 1
        },
        get reflows() {
            return reflows
        },
        get watching() {
            return listeners.length
        },
        addEventListener: (name, fn) => listeners.push({ name, fn }),
        removeEventListener: (name, fn) => {
            const i = listeners.findIndex((l) => l.name === name && l.fn === fn)
            if (i >= 0) listeners.splice(i, 1)
        },
        dispatch: (name, ev) => {
            for (const l of [...listeners]) if (l.name === name) l.fn(ev)
        },
    }
}

describe("pulse: the reflow read is the function", () => {
    test("a class already standing is made to arrive again", () => {
        const el = makeEl()
        el.classList.add("lit")
        pulse(el, "lit")
        assert.ok(el.classList.contains("lit"))
        assert.equal(el.reflows, 1, "without the read the browser never sees it leave")
    })
})

describe("whenDone: the animation may never come", () => {
    test("the animation ends → done runs, and nothing stays watching", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] })
        const el = makeEl()
        let ran = 0
        whenDone(el, { animation: "fade", ms: 800 }, () => { ran += 1 })

        el.dispatch("animationend", { animationName: "fade" })
        assert.equal(ran, 1)
        assert.equal(el.watching, 0)

        t.mock.timers.tick(2000)
        assert.equal(ran, 1, "the fallback was disarmed, not merely late")
    })

    test("no animation ever runs → the fallback still lands it", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] })
        const el = makeEl()
        let ran = 0
        whenDone(el, { animation: "fade", ms: 800 }, () => { ran += 1 })

        t.mock.timers.tick(799)
        assert.equal(ran, 0)
        t.mock.timers.tick(1)
        assert.equal(ran, 1)
        assert.equal(el.watching, 0)
    })

    test("another animation ending does not spend our listener", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] })
        const el = makeEl()
        let ran = 0
        whenDone(el, { animation: "fade", ms: 800 }, () => { ran += 1 })

        el.dispatch("animationend", { animationName: "wiggle" })
        assert.equal(ran, 0)
        assert.equal(el.watching, 1, "a {once} listener would be gone here")

        el.dispatch("animationend", { animationName: "fade" })
        assert.equal(ran, 1)
    })

    test("no name given → any animation is the one we waited for", () => {
        const el = makeEl()
        let ran = 0
        whenDone(el, { ms: 800 }, () => { ran += 1 })
        el.dispatch("animationend", { animationName: "whatever" })
        assert.equal(ran, 1)
    })

    test("finishing early is idempotent — done runs once, whoever calls", (t) => {
        t.mock.timers.enable({ apis: ["setTimeout"] })
        const el = makeEl()
        let ran = 0
        const finish = whenDone(el, { animation: "fade", ms: 800 }, () => { ran += 1 })

        finish()
        finish()
        el.dispatch("animationend", { animationName: "fade" })
        t.mock.timers.tick(2000)
        assert.equal(ran, 1)
    })
})
