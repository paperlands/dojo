// Newest expressed navigation — async routes/fetches must not take ownership
// after a newer peer. Run with: node --test test/js/shell/weave_ownership_test.mjs

import { registerHooks } from "node:module"
import assert from "node:assert/strict"
import { test } from "node:test"

const noop = () => {}
const events = []
const requests = []
const deferreds = new Map()

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

function element() {
    return {
        style: { setProperty: noop },
        classList: { add: noop },
        addEventListener: noop,
        title: "",
        textContent: "",
    }
}

globalThis.document = {
    createElement: element,
    getElementById: () => null,
}

globalThis.__weaveMocks = {
    fetchFragment: (name) => {
        const slot = deferreds.get(name)
        return slot ? slot.promise : Promise.resolve(null)
    },
    fragmentIndex: () => globalThis.__weaveIndex.promise,
    transpile: (text) => ({ id: `id-${text}`, title: `T-${text}`, source: text }),
    resolve: (word) => globalThis.__weaveResolve?.(word)
        ?? ({ kind: "fragment", name: "a", id: "1", title: "A" }),
    parseAddress: (dest) => ({ owner: dest.startsWith("~") ? "~" : "#", name: dest }),
    parseProgram: () => [],
    diagnostics: () => [],
    signals: { walk: (source, from, to, ref) => ({ source, from, to, target: to, ref }) },
    revealAmbient: noop,
    registerNavigator: (fn) => { globalThis.__weaveNavigator = fn; return noop },
    getStage: () => null,
    nerve: () => ({ push: noop }),
    link: { read: () => null },
    stamp: () => ({ t: 123 }),
    outerShellPayload: (partial) => ({ ...partial }),
    dispatchPhx: (name, detail) => {
        globalThis.__weaveDispatch?.(name, detail)
        events.push({ name, detail })
    },
}

const exportsByFile = {
    "/weave/fragments.js": ["fetchFragment", "fragmentIndex"],
    "/weave/parse.js": ["transpile"],
    "/weave/resolve.js": ["resolve", "parseAddress"],
    "/turtling/parse.js": ["parseProgram"],
    "/weave/queries.js": ["diagnostics"],
    "/nerve/store.js": ["signals"],
    "/nerve/reveal.js": ["revealAmbient", "registerNavigator"],
    "/turtling/stage-cell.js": ["getStage"],
    "/hooks/nerve.js": ["nerve"],
    "/link.js": ["link"],
    "/utils/stamp.js": ["stamp"],
    "/shell/outer-shell-payload.js": ["outerShellPayload", "dispatchPhx"],
}

registerHooks({
    load(url, context, nextLoad) {
        for (const [suffix, names] of Object.entries(exportsByFile)) {
            if (url.endsWith(suffix)) {
                return {
                    format: "module",
                    shortCircuit: true,
                    source: names
                        .map((name) => `export const ${name} = globalThis.__weaveMocks.${name};`)
                        .join("\n"),
                }
            }
        }
        return nextLoad(url, context)
    },
})

const { createArena } = await import("../../../assets/js/kernel/arena.js")
const { createSelectionIntent, installSelection, releaseSelection } =
    await import("../../../assets/js/hooks/shell/selection-intent.js")
const { weave } = await import("../../../assets/js/hooks/shell/weave.js")

const tick = () => new Promise((resolve) => setImmediate(resolve))

async function setup({ install = true } = {}) {
    events.length = 0
    requests.length = 0
    deferreds.clear()

    globalThis.__weaveIndex = deferred()

    const intent = createSelectionIntent()
    if (install) installSelection(intent)

    const hook = {
        el: {
            replaceChildren() {},
            appendChild() {},
        },
        arena: createArena(),
        pushEvent(name, payload) {
            const request = deferred()
            requests.push({ name, payload, request })
            return request.promise
        },
    }

    const surface = weave.mount(hook, {})

    return {
        intent,
        surface,
        events,
        requests,
        fetchFor(name) {
            const slot = deferred()
            deferreds.set(name, slot)
            return slot
        },
        cleanup() {
            releaseSelection(intent)
            intent.release()
            surface.arena.destroy()
            hook.arena.destroy()
        },
    }
}

test("a delayed library fetch cannot take ownership after a newer peer", async () => {
    const shell = await setup()
    try {
        const fetch = shell.fetchFor("a")
        const opening = shell.surface.openPage("a")

        // The reader expresses a newer peer while A's fragment is in flight.
        shell.intent.open({ addr: "peer:B", view: "watch", draft_live: true, follow_peer: true })

        fetch.resolve("fw A")
        await opening
        await tick()

        assert.deepEqual(
            {
                pending: shell.intent.pending()?.addr,
                documents: shell.events
                    .filter((event) => event.name === "seeOuterShell")
                    .map((event) => event.detail.addr),
                requests: shell.requests.map((request) => [request.name, request.payload.addr]),
            },
            { pending: "peer:B", documents: [], requests: [] },
            "the late A fetch must not take ownership, show, or notify",
        )
    } finally {
        shell.cleanup()
    }
})

test("a delayed portal index cannot open a page after a newer peer", async () => {
    const shell = await setup()
    try {
        shell.fetchFor("a").resolve("fw A")

        // followPortal: await fragmentIndex, then resolve a fragment and open it.
        const navigating = globalThis.__weaveNavigator("word-a")

        shell.intent.open({ addr: "peer:B", view: "watch", draft_live: true, follow_peer: true })

        globalThis.__weaveIndex.resolve({ 1: { name: "a", title: "A" } })
        await navigating
        await tick()

        assert.deepEqual(
            {
                pending: shell.intent.pending()?.addr,
                documents: shell.events
                    .filter((event) => event.name === "seeOuterShell")
                    .map((event) => event.detail.addr),
                requests: shell.requests.map((request) => [request.name, request.payload.addr]),
            },
            { pending: "peer:B", documents: [], requests: [] },
            "the stale route must not take ownership, show, or notify",
        )
    } finally {
        shell.cleanup()
    }
})

test("same-address A1→B→A2 installs only the newest expression", async () => {
    const shell = await setup()
    try {
        const first = shell.fetchFor("a")
        const openingFirst = shell.surface.openPage("a")
        shell.intent.open({ addr: "peer:B", view: "watch", draft_live: true, follow_peer: true })

        const second = shell.fetchFor("a")
        const openingSecond = shell.surface.openPage("a")

        second.resolve("fw A2")
        await openingSecond
        first.resolve("fw A1")
        await openingFirst
        await tick()

        const documents = shell.events.filter((event) => event.name === "seeOuterShell")
        assert.deepEqual(documents.map((event) => event.detail.source), ["fw A2"])
        assert.equal(shell.requests.filter((request) => request.name === "seeWeave").length, 1)
    } finally {
        shell.cleanup()
    }
})

test("readiness may supersede the receipt without cancelling the same-owner fetch", async () => {
    const shell = await setup()
    try {
        const fetch = shell.fetchFor("a")
        const opening = shell.surface.openPage("a")
        const owner = shell.intent.current()
        shell.intent.supersede("~/a")
        assert.equal(shell.intent.owns(owner), true, "the owner survives readiness")

        fetch.resolve("fw A")
        await opening
        await tick()

        assert.equal(shell.events.filter((event) => event.name === "seeOuterShell").length, 1)
        assert.equal(shell.requests.filter((request) => request.name === "seeWeave").length, 1)
        assert.equal(shell.intent.pending()?.addr, "~/a")
    } finally {
        shell.cleanup()
    }
})

test("a missing fragment keeps the local subject waiting and installs nothing", async () => {
    const shell = await setup()
    try {
        const fetch = shell.fetchFor("a")
        const opening = shell.surface.openPage("a")
        fetch.resolve(null)
        await opening
        await tick()

        assert.equal(shell.events.some((event) => event.name === "seeOuterShell"), false)
        assert.equal(shell.requests.length, 0, "no metadata-only network request")
        assert.equal(shell.intent.current()?.addr, "~/a", "the expressed subject stays")
    } finally {
        shell.cleanup()
    }
})

test("an ambient route does not cancel a live library fetch", async () => {
    const shell = await setup()
    try {
        globalThis.__weaveResolve = () => ({ kind: "ambient", name: "amb" })
        const fetch = shell.fetchFor("a")
        const opening = shell.surface.openPage("a")

        const navigating = globalThis.__weaveNavigator("ambient-word")
        globalThis.__weaveIndex.resolve({})
        await navigating

        fetch.resolve("fw A")
        await opening
        await tick()

        assert.equal(shell.events.filter((event) => event.name === "seeOuterShell").length, 1,
            "the library fetch still publishes")
    } finally {
        globalThis.__weaveResolve = null
        shell.cleanup()
    }
})

test("a route started before outer acquisition does not outlive it", async () => {
    const shell = await setup({ install: false })
    try {
        const navigating = globalThis.__weaveNavigator("word-a")
        installSelection(shell.intent)
        globalThis.__weaveIndex.resolve({ 1: { name: "a", title: "A" } })
        await navigating
        await tick()

        assert.equal(shell.events.some((event) => event.name === "seeOuterShell"), false)
        assert.equal(shell.requests.length, 0)
    } finally {
        shell.cleanup()
    }
})

test("without a controller openPage still notifies, never acks", async () => {
    const shell = await setup({ install: false })
    try {
        shell.fetchFor("a").resolve("fw A")
        await shell.surface.openPage("a")
        await tick()

        assert.equal(shell.events.filter((event) => event.name === "seeOuterShell").length, 1)
        assert.equal(shell.requests.filter((request) => request.name === "seeWeave").length, 1)
    } finally {
        shell.cleanup()
    }
})

test("a known no-controller fetch cannot publish after a later controller selects B", async () => {
    const shell = await setup({ install: false })
    try {
        const fetch = shell.fetchFor("a")
        const opening = shell.surface.openPage("a")

        installSelection(shell.intent)
        shell.intent.open({ addr: "peer:B", view: "watch", draft_live: true, follow_peer: true })

        fetch.resolve("fw A")
        await opening
        await tick()

        assert.equal(
            shell.events.some((event) => event.name === "seeOuterShell" && event.detail.addr === "~/a"),
            false,
            "the late known fetch must not publish",
        )
        assert.equal(
            shell.requests.some((request) => request.name === "seeWeave" && request.payload.addr === "~/a"),
            false,
            "the late known fetch must not notify",
        )
    } finally {
        shell.cleanup()
    }
})

test("a newer peer expressed during seeOuterShell dispatch cannot be overwritten", async () => {
    const shell = await setup()
    try {
        shell.fetchFor("a").resolve("fw A")
        globalThis.__weaveDispatch = (name, detail) => {
            if (name !== "seeOuterShell" || detail.addr !== "~/a") return
            shell.intent.open({ addr: "peer:B", view: "watch", draft_live: true, follow_peer: true })
        }

        await shell.surface.openPage("a")
        await tick()

        assert.equal(shell.intent.current()?.addr, "peer:B", "the newer peer owns the subject")
        assert.equal(shell.intent.pending()?.addr, "peer:B", "the newer receipt survives")
        assert.equal(
            shell.requests.some((request) => request.name === "seeWeave" && request.payload.addr === "~/a"),
            false,
            "the older A completion never notifies after B",
        )
    } finally {
        globalThis.__weaveDispatch = null
        shell.cleanup()
    }
})
