// Shell hook lifecycle — booting → live → dead; the queue carries the transition.
// Run with: node --test test/js/shell_lifecycle_test.mjs
//
// Guards the boot seam: LiveView dispatches a reply's push_events synchronously
// in the same task as the patch that mounts the hook, while the shell's boot is
// async (CM6 dynamic import). The lifecycle machine must register every event a
// surface declares BEFORE its first await and queue payloads until the surface
// stands — or the outershell's initial seeOuterShell (pushed by the very
// seeTurtle reply that mounts the panel) is deterministically lost: empty
// editor, dead focus/opacity, until the friend's next hatch re-pushes.
// And a hook destroyed mid-boot must stand down, not zombie-mount.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { makeShellHook } from "../../assets/js/hooks/shell/lifecycle.js"

const tick = () => new Promise((resolve) => setImmediate(resolve))

function deferred() {
    let resolve
    const promise = new Promise((r) => { resolve = r })
    return { promise, resolve }
}

// A hook context the way LiveView provides it: el.dataset picks the surface,
// handleEvent registers a listener we can fire by hand.
function makeHook(hookDef, target = "outer") {
    const registered = {}
    return Object.assign(Object.create(hookDef), {
        el: { dataset: { target } },
        handleEvent(name, cb) { registered[name] = cb },
        fire(name, payload) { registered[name]?.(payload) },
        registered,
    })
}

// A surface that records what reaches it.
function makeSurface(events) {
    const record = { mounts: 0, seen: [], cleaned: 0 }
    const surface = {
        events,
        mount: () => {
            record.mounts++
            return {
                events: Object.fromEntries(
                    events.map((name) => [name, (p) => record.seen.push([name, p])])
                ),
                cleanup: [() => record.cleaned++],
            }
        },
    }
    return { surface, record }
}

describe("boot seam: events riding the mount patch are never lost", () => {
    test("registers every declared event synchronously, before boot resolves", () => {
        const { surface } = makeSurface(["seeOuterShell", "outerSignal"])
        const boot = deferred()
        const hook = makeHook(
            makeShellHook({ boot: () => boot.promise, surfaces: { outer: surface, inner: surface } })
        )

        hook.mounted()

        // The listener must exist NOW — LiveView's dispatchEvents runs in the
        // same synchronous task as the patch that called mounted().
        assert.equal(typeof hook.registered.seeOuterShell, "function")
        assert.equal(typeof hook.registered.outerSignal, "function")
    })

    test("queues payloads during boot and drains them in arrival order", async () => {
        const { surface, record } = makeSurface(["seeOuterShell", "outerSignal"])
        const boot = deferred()
        const hook = makeHook(
            makeShellHook({ boot: () => boot.promise, surfaces: { outer: surface, inner: surface } })
        )

        hook.mounted()
        hook.fire("seeOuterShell", { addr: "a1", source: "fd 10" })
        hook.fire("outerSignal", { state: "success" })
        assert.deepEqual(record.seen, [], "nothing delivered before the surface stands")

        boot.resolve({ term: {}, cm6: {} })
        await tick()

        assert.equal(record.mounts, 1)
        assert.deepEqual(record.seen, [
            ["seeOuterShell", { addr: "a1", source: "fd 10" }],
            ["outerSignal", { state: "success" }],
        ])
    })

    test("after live, events flow straight through", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outer: surface, inner: surface } })
        )

        hook.mounted()
        await tick()

        hook.fire("seeOuterShell", { addr: "a2" })
        assert.deepEqual(record.seen, [["seeOuterShell", { addr: "a2" }]])
    })

    test("data-target picks the surface: outer vs inner", async () => {
        const outer = makeSurface(["seeOuterShell"])
        const inner = makeSurface(["writeShell"])
        const def = makeShellHook({
            boot: () => Promise.resolve({}),
            surfaces: { outer: outer.surface, inner: inner.surface },
        })

        const outerHook = makeHook(def, "outer")
        const innerHook = makeHook(def, "core")
        outerHook.mounted()
        innerHook.mounted()
        await tick()

        assert.equal(outer.record.mounts, 1)
        assert.equal(inner.record.mounts, 1)
        assert.equal(typeof outerHook.registered.seeOuterShell, "function")
        assert.equal(outerHook.registered.writeShell, undefined)
        assert.equal(typeof innerHook.registered.writeShell, "function")
    })
})

describe("dead state: a mid-boot destroy stands the mount down", () => {
    test("destroyed before boot resolves → surface never mounts, events dropped", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        const boot = deferred()
        const hook = makeHook(
            makeShellHook({ boot: () => boot.promise, surfaces: { outer: surface, inner: surface } })
        )

        hook.mounted()
        hook.fire("seeOuterShell", { addr: "a3" })
        hook.destroyed()

        boot.resolve({ term: {}, cm6: {} })
        await tick()

        assert.equal(record.mounts, 0, "no zombie mount over a destroyed hook")
        assert.deepEqual(record.seen, [])
    })

    test("boot standing down (null, per bootShell's dead check) → no mount", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve(null), surfaces: { outer: surface, inner: surface } })
        )

        hook.mounted()
        await tick()

        assert.equal(record.mounts, 0)
    })

    test("events arriving after destroyed are ignored", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outer: surface, inner: surface } })
        )

        hook.mounted()
        await tick()
        hook.destroyed()
        hook.fire("seeOuterShell", { addr: "a4" })

        assert.deepEqual(record.seen, [])
    })

    test("destroyed after live runs the surface cleanup and destroys the term", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        let termDestroyed = 0
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outer: surface, inner: surface } })
        )
        hook.term = { destroy: () => termDestroyed++ }

        hook.mounted()
        await tick()
        hook.destroyed()

        assert.equal(record.cleaned, 1)
        assert.equal(termDestroyed, 1)
    })
})
