// Shell hook lifecycle — booting → live → dead; the queue carries the transition.
// Run with: node --test test/js/shell/lifecycle_test.mjs
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

import { makeShellHook } from "../../../assets/js/hooks/shell/lifecycle.js"
import { createArena } from "../../../assets/js/kernel/arena.js"

const tick = () => new Promise((resolve) => setImmediate(resolve))

function deferred() {
    let resolve
    const promise = new Promise((r) => { resolve = r })
    return { promise, resolve }
}

// A hook context the way LiveView provides it: el.dataset picks the surface,
// handleEvent registers a listener we can fire by hand.
function makeHook(hookDef, target = "outershell") {
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
    const record = { mounts: 0, seen: [], cleaned: 0, births: 0 }
    const surface = {
        events,
        mount: () => {
            record.mounts++
            const arena = createArena()
            arena.add(() => record.cleaned++)
            return {
                events: Object.fromEntries(
                    events.map((name) => [name, (p) => record.seen.push([name, p])])
                ),
                arena,
                birth: () => { record.births++; record.seen.push(["birth", null]) },
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
            makeShellHook({ boot: () => boot.promise, surfaces: { outershell: surface, coreshell: surface } })
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
            makeShellHook({ boot: () => boot.promise, surfaces: { outershell: surface, coreshell: surface } })
        )

        hook.mounted()
        hook.fire("seeOuterShell", { addr: "a1", source: "fd 10" })
        hook.fire("outerSignal", { state: "success" })
        assert.deepEqual(record.seen, [], "nothing delivered before the surface stands")

        boot.resolve({ term: {}, cm6: {} })
        await tick()

        assert.equal(record.mounts, 1)
        // Birth comes FIRST: the surface takes its own breath before it hears
        // anything from the wire, or the queue lands on organs that have not
        // yet been told the room is whole.
        assert.deepEqual(record.seen, [
            ["birth", null],
            ["seeOuterShell", { addr: "a1", source: "fd 10" }],
            ["outerSignal", { state: "success" }],
        ])
    })

    test("after live, events flow straight through", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outershell: surface, coreshell: surface } })
        )

        hook.mounted()
        await tick()

        hook.fire("seeOuterShell", { addr: "a2" })
        assert.deepEqual(record.seen, [["birth", null], ["seeOuterShell", { addr: "a2" }]])
    })

    test("birth runs once, and only for a surface that stood", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outershell: surface, coreshell: surface } })
        )
        hook.mounted()
        await tick()
        assert.equal(record.births, 1)

        const stillborn = makeSurface(["seeOuterShell"])
        const dead = makeHook(
            makeShellHook({ boot: () => Promise.resolve(null), surfaces: { outershell: stillborn.surface, coreshell: stillborn.surface } })
        )
        dead.mounted()
        await tick()
        assert.equal(stillborn.record.births, 0)
    })

    test("a surface with no birth is legal — the phase is optional", async () => {
        let mounted = 0
        const surface = {
            events: [],
            mount: () => { mounted++; return { events: {}, arena: createArena() } },
        }
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outershell: surface, coreshell: surface } })
        )
        hook.mounted()
        await tick()
        assert.equal(mounted, 1)
    })

    test("data-target names the surface: outershell vs coreshell", async () => {
        const outer = makeSurface(["seeOuterShell"])
        const inner = makeSurface(["writeShell"])
        const def = makeShellHook({
            boot: () => Promise.resolve({}),
            surfaces: { outershell: outer.surface, coreshell: inner.surface },
        })

        const outerHook = makeHook(def, "outershell")
        const innerHook = makeHook(def, "coreshell")
        outerHook.mounted()
        innerHook.mounted()
        await tick()

        assert.equal(outer.record.mounts, 1)
        assert.equal(inner.record.mounts, 1)
        assert.equal(typeof outerHook.registered.seeOuterShell, "function")
        assert.equal(outerHook.registered.writeShell, undefined)
        assert.equal(typeof innerHook.registered.writeShell, "function")
    })

    // An unknown name is a fault, not a default. While the machine branched,
    // any unrecognised target silently mounted the heaviest surface and this
    // guard could never fire.
    test("an unknown data-target mounts nothing", async () => {
        const { surface, record } = makeSurface(["writeShell"])
        const def = makeShellHook({
            boot: () => Promise.resolve({}),
            surfaces: { coreshell: surface },
        })

        const hook = makeHook(def, "corshell") // typo
        hook.mounted()
        await tick()

        assert.equal(record.mounts, 0)
        assert.equal(hook.registered.writeShell, undefined)
    })
})

describe("dead state: a mid-boot destroy stands the mount down", () => {
    test("destroyed before boot resolves → surface never mounts, events dropped", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        const boot = deferred()
        const hook = makeHook(
            makeShellHook({ boot: () => boot.promise, surfaces: { outershell: surface, coreshell: surface } })
        )

        hook.mounted()
        hook.fire("seeOuterShell", { addr: "a3" })
        hook.destroyed()

        boot.resolve({ term: {}, cm6: {} })
        await tick()

        assert.equal(record.mounts, 0, "no zombie mount over a destroyed hook")
        assert.deepEqual(record.seen, [])
    })

    // ONE LIVENESS FACT — boot asks the hook's arena, not a flag beside it.
    test("the hook's arena IS the liveness boot and the surfaces read", async () => {
        const { surface } = makeSurface(["seeOuterShell"])
        let aliveAtBoot = null
        const hook = makeHook(
            makeShellHook({
                boot: (h) => { aliveAtBoot = h.arena.alive; return Promise.resolve({}) },
                surfaces: { outershell: surface, coreshell: surface },
            })
        )

        hook.mounted()
        assert.equal(aliveAtBoot, true)
        assert.equal(hook.arena.alive, true)
        hook.destroyed()
        assert.equal(hook.arena.alive, false, "boot's mid-flight stand-down check")
    })

    test("the surface's arena is adopted — one destroy ends one lifetime", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outershell: surface, coreshell: surface } })
        )
        hook.mounted()
        await tick()

        hook.destroyed()
        assert.equal(record.cleaned, 1)
        assert.equal(hook.surface.arena.alive, false)
        hook.destroyed()
        assert.equal(record.cleaned, 1, "idempotent — the arena guards the second call")
    })

    test("boot standing down (null, per bootShell's dead check) → no mount", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve(null), surfaces: { outershell: surface, coreshell: surface } })
        )

        hook.mounted()
        await tick()

        assert.equal(record.mounts, 0)
    })

    test("events arriving after destroyed are ignored", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outershell: surface, coreshell: surface } })
        )

        hook.mounted()
        await tick()
        hook.destroyed()
        hook.fire("seeOuterShell", { addr: "a4" })

        assert.deepEqual(record.seen, [["birth", null]], "the birth, and nothing after it")
    })

    test("destroyed after live runs the surface cleanup and destroys the term", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        let termDestroyed = 0
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outershell: surface, coreshell: surface } })
        )
        hook.term = { destroy: () => termDestroyed++ }

        hook.mounted()
        await tick()
        hook.destroyed()

        assert.equal(record.cleaned, 1)
        assert.equal(termDestroyed, 1)
    })

    test("release runs LIFO — the surface's arena owns the order, not this file", async () => {
        const order = []
        const surface = {
            events: ["seeOuterShell"],
            mount: () => {
                const arena = createArena()
                arena.add(() => order.push(1))
                arena.add(() => order.push(2))
                arena.add(() => order.push(3))
                return { events: { seeOuterShell: () => {} }, arena }
            },
        }
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outershell: surface, coreshell: surface } })
        )
        hook.mounted()
        await tick()
        hook.destroyed()
        assert.deepEqual(order, [3, 2, 1])
    })
})
