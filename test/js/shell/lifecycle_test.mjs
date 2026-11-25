// The LiveView mount-patch seam and the installation rollback contract.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { makeShellHook } from "../../../assets/js/hooks/shell/lifecycle.js"

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
        handleEvent(name, cb) { registered[name] = cb; return { name, cb } },
        removeHandleEvent({ name, cb }) {
            if (registered[name] === cb) delete registered[name]
        },
        fire(name, payload) { registered[name]?.(payload) },
        registered,
    })
}

// A surface that records what reaches it.
function makeSurface(events) {
    const record = { mounts: 0, seen: [], cleaned: 0, births: 0 }
    const surface = {
        events,
        mount: (hook) => {
            record.mounts++
            const arena = hook.arena.child()
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
        mount: (hook) => { mounted++; return { events: {}, arena: hook.arena.child() } },
        }
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outershell: surface, coreshell: surface } })
        )
        hook.mounted()
        await tick()
        assert.equal(mounted, 1)
    })

    test("acquire runs before registration; arrive ingests before the boot queue", async () => {
        const boot = deferred()
        const seen = []
        let acquired = false

        const surface = {
            events: ["seeOuterShell"],
            acquire(hook) {
                acquired = true
                hook.selection = "owner"
            },
            arrive(name, payload) {
                seen.push(["arrive", name, payload.addr])
            },
        mount: (hook) => ({
            events: { seeOuterShell: (payload) => seen.push(["surface", payload.addr]) },
            arena: hook.arena.child(),
            }),
        }

        const hook = makeHook(
            makeShellHook({
                boot: () => boot.promise,
                surfaces: { outershell: surface, coreshell: surface },
            })
        )

        hook.mounted()
        assert.equal(acquired, true)
        assert.equal(hook.selection, "owner")

        hook.fire("seeOuterShell", { addr: "a1" })
        assert.deepEqual(seen, [["arrive", "seeOuterShell", "a1"]], "arrive precedes the queue")

        boot.resolve({})
        await tick()
        assert.deepEqual(seen, [
            ["arrive", "seeOuterShell", "a1"],
            ["surface", "a1"],
        ])
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

    test("the mounted surface is a child of the installation", async () => {
        const { surface, record } = makeSurface(["seeOuterShell"])
        const hook = makeHook(
            makeShellHook({ boot: () => Promise.resolve({}), surfaces: { outershell: surface, coreshell: surface } })
        )
        hook.mounted()
        await tick()

        const child = hook.surface.arena
        hook.destroyed()
        assert.equal(record.cleaned, 1)
        assert.equal(child.alive, false)
        assert.equal(hook.surface, null)
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
        const releases = []
        surface.acquire = (ctx) => ctx.arena.add(() => releases.push("acquired"))
        const mount = surface.mount
        surface.mount = (ctx) => {
            const mounted = mount(ctx)
            mounted.arena.add(() => releases.push("surface"))
            return mounted
        }
        const hook = makeHook(makeShellHook({
            boot(ctx) {
                ctx.arena.add(() => releases.push("terminal"))
                return Promise.resolve({})
            },
            surfaces: { outershell: surface },
        }))
        hook.mounted()
        await tick()
        hook.destroyed()
        hook.destroyed()

        assert.equal(record.cleaned, 1)
        assert.deepEqual(releases, ["surface", "terminal", "acquired"])
        assert.equal(hook.registered.seeOuterShell, undefined)
    })

    test("release runs LIFO — the surface's arena owns the order, not this file", async () => {
        const order = []
        const surface = {
            events: ["seeOuterShell"],
            mount: (hook) => {
                const arena = hook.arena.child()
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

    test("outer recovery events ride the boot queue in order", async () => {
        const { surface, record } = makeSurface(["outerIntent", "syncShell"])
        const boot = deferred()
        const hook = makeHook(
            makeShellHook({ boot: () => boot.promise, surfaces: { outershell: surface, coreshell: surface } }),
            "outershell"
        )

        hook.mounted()
        const intent = { addr: "a1", view: "watch", draft_live: true, follow_peer: true }
        hook.fire("outerIntent", intent)
        hook.fire("syncShell", {})

        boot.resolve({})
        await tick()

        assert.deepEqual(record.seen, [
            ["birth", null],
            ["outerIntent", intent],
            ["syncShell", {}],
        ])
    })
})


describe("installation as one revocable lifetime", () => {
    test("raw ingestion is synchronous; delivery queues through birth and replay", async () => {
        const seen = []
        let hook
        const surface = {
            events: ["event"],
            arrive(_name, value) {
                seen.push(`arrive ${value}`)
                if (value === "first") hook.fire("event", "nested arrival")
            },
            mount(ctx) {
                return {
                    arena: ctx.arena.child(),
                    birth() { seen.push("birth"); hook.fire("event", "from birth") },
                    events: { event(value) {
                        seen.push(`deliver ${value}`)
                        if (value === "first") hook.fire("event", "from handler")
                    } },
                }
            },
        }
        hook = makeHook(makeShellHook({ boot: async () => ({}), surfaces: { outershell: surface } }))
        hook.mounted()
        hook.fire("event", "first")
        hook.fire("event", "second")
        assert.deepEqual(seen, ["arrive first", "arrive nested arrival", "arrive second"])
        await tick()
        assert.deepEqual(seen, [
            "arrive first", "arrive nested arrival", "arrive second", "birth", "arrive from birth",
            "deliver first", "arrive from handler", "deliver nested arrival", "deliver second",
            "deliver from birth", "deliver from handler",
        ])
    })

    for (const edge of ["acquire", "register", "boot", "stand down", "mount", "birth", "ingest", "replay"]) {
        test(`${edge} failure leaves no registered resources`, async (t) => {
            const fault = new Error(edge)
            const logged = t.mock.method(console, "error", () => {})
            const taken = [], released = []
            let lateArrivals = 0
            const take = (arena, resource) => {
                taken.push(resource)
                arena.add(() => released.push(resource))
            }
            const check = (point) => { if (edge === point) throw fault }
            const hook = makeHook(makeShellHook({
                boot: async (ctx) => {
                    take(ctx.arena, "boot")
                    check("boot")
                    return edge === "stand down" ? null : {}
                },
                surfaces: { outershell: {
                    events: ["event", "second"],
                    acquire(ctx) { take(ctx.arena, "acquire"); check("acquire") },
                    arrive(_name, payload) { if (payload === "late") lateArrivals++; check("ingest") },
                    mount(ctx) {
                        const arena = ctx.arena.child()
                        take(arena, "surface")
                        check("mount")
                        return {
                            arena,
                            birth() {
                                if (edge === "birth") queueMicrotask(() => ctx.fire("event", "late"))
                                check("birth")
                            },
                            events: { event() { check("replay") }, second() {} },
                        }
                    },
                } },
            }))
            const register = hook.handleEvent
            hook.handleEvent = (name, cb) => {
                if (name === "second") check("register")
                return register(name, cb)
            }
            hook.mounted()
            hook.fire("event", null)
            await tick()
            assert.equal(hook.arena.alive, false)
            assert.equal(hook.surface, null)
            assert.deepEqual(Object.keys(hook.registered), [])
            assert.equal(lateArrivals, 0)
            assert.deepEqual(released, taken.toReversed())
            assert.equal(logged.mock.callCount(), edge === "stand down" ? 0 : 1)
            hook.destroyed()
            assert.deepEqual(released, taken.toReversed())
        })
    }

    test("destroy during replay drops the tail; a retired callback cannot enter the successor", async () => {
        const seen = []
        const hook = makeHook(makeShellHook({
            boot: async () => ({}),
            surfaces: { outershell: {
                events: ["event"],
                mount(ctx) {
                    return {
                        arena: ctx.arena.child(),
                        events: { event(value) {
                            seen.push(value)
                            if (value === "destroy") ctx.destroyed()
                        } },
                    }
                },
            } },
        }))
        hook.mounted()
        const stale = hook.registered.event
        hook.fire("event", "destroy")
        hook.fire("event", "discarded")
        await tick()
        assert.equal(hook.surface, null)
        hook.mounted()
        await tick()
        stale("stale")
        hook.fire("event", "successor")
        assert.deepEqual(seen, ["destroy", "successor"])
    })
})
