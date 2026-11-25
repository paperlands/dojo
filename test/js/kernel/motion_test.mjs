// Motion — restart an animation, and survive one that never runs.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { createEffect, pulse, whenDone } from "../../../assets/js/kernel/motion.js"

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

describe("pulse: a NAMED beat restarts, and nothing else", () => {
    // The semantic reds: an unfiltered subtree restart clobbers a sibling's finite
    // animation, a CSS transition, and the instrument's own arrival. Only the keyframes
    // the caller names may move.
    const anim = (name, { iterations = 1, currentTime = 500 } = {}) => {
        const a = {
            animationName: name, currentTime,
            effect: { getTiming: () => ({ iterations }) },
            state: "running",
            cancel() { this.state = "idle" },
            play() { this.state = "running"; this.currentTime = 0 },
        }
        return a
    }
    const transition = () => ({
        // A CSS transition has no animationName at all.
        currentTime: 500, state: "running",
        effect: { getTiming: () => ({ iterations: 1 }) },
        cancel() { this.state = "idle" },
        play() { this.state = "running"; this.currentTime = 0 },
    })

    const host = (anims, child = null) => {
        const el = makeEl()
        el.getAnimations = () => anims
        el.querySelector = (sel) => (child && sel === ".msg" ? child : null)
        return el
    }

    test("the named keyframe restarts; a sibling, a transition and a breath do not", () => {
        const radiate = anim("helios-radiate")
        const sibling = anim("other")
        const breathe = anim("helios-breathe", { iterations: Infinity })
        const trans = transition()
        const el = host([radiate, sibling, breathe, trans])

        pulse(el, "lit", { names: ["helios-radiate", "helios-radiate-apex"] })

        assert.equal(el.classList.contains("lit"), true)
        assert.equal(radiate.currentTime, 0, "the named beat restarted")
        assert.equal(sibling.currentTime, 500, "an unrelated finite animation stays put")
        assert.equal(trans.currentTime, 500, "a CSS transition is not a keyframe beat")
        assert.equal(breathe.currentTime, 500, "an infinite breath is never restarted")
        assert.equal(el.reflows, 0, "and no layout was read")
    })

    test("the arrival is not the beat: a named radiate leaves it alone", () => {
        const arrive = anim("helios-arrive", { currentTime: 90 })
        const radiate = anim("helios-radiate")
        const el = host([arrive, radiate])
        pulse(el, "lit", { names: ["helios-radiate"] })
        assert.equal(arrive.currentTime, 90, "arrival keeps its progress")
        assert.equal(radiate.currentTime, 0)
    })

    test("first activation, then a repeat: both restart the named beat", () => {
        const radiate = anim("helios-radiate", { currentTime: 0 })
        const el = host([radiate])
        pulse(el, "lit", { names: ["helios-radiate"] })
        assert.equal(radiate.state, "running", "first activation plays")
        radiate.currentTime = 400
        pulse(el, "lit", { names: ["helios-radiate"] })
        assert.equal(radiate.currentTime, 0, "a repeat restarts it, not merely re-adds the class")
    })

    test("a scoped beat searches the named element, not the subtree", () => {
        const msg = host([anim("helios-radiate")])
        const see = []
        msg.getAnimations = function () { see.push("own"); return [anim("helios-radiate")] }
        const el = host([anim("other")], null)
        el.querySelector = (sel) => (sel === ".msg" ? msg : null)
        el.getAnimations = function () { throw Error("the subtree must not be walked") }
        pulse(el, "lit", { names: ["helios-radiate"], within: ".msg" })
        assert.deepEqual(see, ["own"], "the named element was asked, the host was not")
    })

    test("reduced motion (no animations) adds the class and throws nothing", () => {
        const el = host([])
        pulse(el, "lit", { names: ["helios-radiate"] })
        assert.equal(el.classList.contains("lit"), true)
        assert.equal(el.reflows, 0)
    })

    test("no named beat falls back to the documented reflow read", () => {
        const el = makeEl()
        el.classList.add("lit")
        pulse(el, "lit")
        assert.ok(el.classList.contains("lit"))
        assert.equal(el.reflows, 1, "with no names there is no safe WAAPI restart")
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

describe("createEffect: one transient, one lifetime", () => {
    test("a start supersedes: the previous cancellation runs, the new fence is current", () => {
        const fx = createEffect()
        let cancelled = 0
        let first = null
        fx.start((fenced) => { first = fenced; return () => { cancelled += 1 } })
        assert.equal(first(), true, "the standing start is current")

        let second = null
        fx.start((fenced) => { second = fenced })
        assert.equal(cancelled, 1, "the superseded effect is cancelled")
        assert.equal(first(), false, "and its fence answers no")
        assert.equal(second(), true)
    })

    test("an end retires: the pending write is cancelled and the fence no longer answers", () => {
        const fx = createEffect()
        let cancelled = 0
        let fenced = null
        fx.start((f) => { fenced = f; return () => { cancelled += 1 } })
        fx.end()
        assert.equal(cancelled, 1)
        assert.equal(fenced(), false, "a retired generation writes nothing")
    })

    test("ending twice cancels once, and an effect with no start ends quietly", () => {
        const fx = createEffect()
        let cancelled = 0
        fx.end()
        fx.start(() => () => { cancelled += 1 })
        fx.end()
        fx.end()
        assert.equal(cancelled, 1)
    })

    test("a begin that returns no cancellation still fences its generation", () => {
        const fx = createEffect()
        let fenced = null
        fx.start((f) => { fenced = f })
        fx.end()
        assert.equal(fenced(), false)
    })
})
