// Real outer lifecycle + outer.mount over mocked ports: the switch/draft seam
// no helper sees. Events go through makeShellHook's acquire/arrive path.

import { registerHooks } from "node:module"
import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { openWatch, step } from "../../../assets/js/editor/watch-law.js"

const noop = () => {}
const stops = () => noop
const listeners = []
const pushes = []
const forks = []
const reaches = []

function makeArena() {
    return {
        alive: true,
        add: noop,
        on: (...args) => listeners.push(args),
        child: () => makeArena(),
        destroy: noop,
    }
}

const mock = {
    scene: { attend: noop, observe: noop, claim: noop, restore: noop, remove: noop, sub: stops, fork: (payload) => forks.push(payload) },
    temporal: { quiet: (fn) => Object.assign(fn, { cancel: noop }) },
    printAST: () => "",
    mountReach: (_view, options) => { reaches.push(options); return { cleanup: noop, reset: noop, pause: noop } },
    setPeerCell: noop,
    follow: noop,
    haltFollow: noop,
    mountChase: () => ({ cleanup: noop, stir: noop, update: noop }),
    openWatch,
    step,
    mountDiagnosticsInk: stops,
    verdict: () => ({ state: "ok" }),
    seatHealth: () => () => ({}),
    readWounds: () => ({ release: noop, read: () => [], watch: stops, changed: noop }),
    world: () => null,
    watchWorld: stops,
    OUTERSHELL: "outershell",
    mountSun: () => ({ release: noop, tick: noop }),
    nerve: () => null,
    nerveSeat: {},
    listeners: { theme: () => ({ mount: stops }) },
    register: stops,
    createArena: makeArena,
    attach: stops,
    safePush: (_hook, name, payload) => pushes.push([name, payload]),
    dispatchPhx: (name, detail) => globalThis.__outerDispatch?.(name, detail),
}

const exportsByFile = {
    "/bridged.js": ["scene"],
    "/utils/temporal.js": ["temporal"],
    "/turtling/parse.js": ["printAST"],
    "/editor/reach.js": ["mountReach"],
    "/editor/code-cell-activation.js": ["setPeerCell"],
    "/editor/peer-attention.js": ["follow", "haltFollow", "mountChase"],
    "/editor/watch-law.js": ["openWatch", "step"],
    "/editor/diagnostics.js": ["mountDiagnosticsInk"],
    "/weave/queries.js": ["verdict"],
    "/weave/seat-health.js": ["seatHealth"],
    "/weave/wounds.js": ["readWounds"],
    "/weave/world.js": ["world", "watchWorld"],
    "/weave/page.js": ["OUTERSHELL"],
    "/nerve/sun.js": ["mountSun"],
    "/hooks/nerve.js": ["nerve", "nerveSeat"],
    "/shell/core.js": ["listeners"],
    "/shell/outer-shell-payload.js": ["dispatchPhx"],
    "/kernel/arena.js": ["createArena"],
    "/kernel/attach.js": ["attach"],
    "/adapter.js": ["safePush"],
}

registerHooks({
    load(url, context, nextLoad) {
        for (const [suffix, names] of Object.entries(exportsByFile)) {
            if (url.endsWith(suffix)) {
                return {
                    format: "module",
                    shortCircuit: true,
                    source: names.map((n) => `export const ${n} = globalThis.__outerMountMocks.${n};`).join("\n"),
                }
            }
        }
        return nextLoad(url, context)
    },
})

globalThis.__outerMountMocks = mock
const { outer } = await import("../../../assets/js/hooks/shell/outer.js")
const { makeShellHook } = await import("../../../assets/js/hooks/shell/lifecycle.js")

globalThis.document = { getElementById: () => null }

const A = "class:shell:PaperLand:wren"
const B = "class:shell:PaperLand:fox"

let text = ""
let drafting = false

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function mount({ deferBoot = false } = {}) {
    text = ""
    drafting = false
    listeners.length = 0
    pushes.length = 0
    forks.length = 0
    reaches.length = 0
    const selectionStatus = { hidden: true }
    const forkButton = { disabled: true }
    globalThis.document = {
        getElementById: (id) => ({
            "outer-selection-status": selectionStatus,
            "outer-fork": forkButton,
        })[id] ?? null,
    }

    const term = {
        outer: noop,
        drafting: () => drafting,
        shell: {
            dom: {},
            scrollDOM: {},
            state: {
                selection: { main: { head: 0 } },
                doc: { lineAt: () => ({ number: 1 }), lines: 1 },
            },
        },
        bridge: { sub: stops },
        getValue: () => text,
        changeouter: (s) => {
            if (!drafting) text = s
        },
        beginDraft: () => {
            drafting = true
        },
        endDraft: () => {
            drafting = false
        },
        streamOrigin: noop,
    }

    const handlers = {}
    const requests = []
    const env = { dataset: {} }

    let releaseBoot
    const bootReady = deferBoot
        ? new Promise((resolve) => { releaseBoot = resolve })
        : Promise.resolve({ term, cm6: {} })
    const hook = makeShellHook({
        boot: () => bootReady,
        surfaces: { outershell: outer },
    })

    hook.el = {
        dataset: { target: "outershell" },
        closest: (selector) => (selector === "#outerenv" ? env : null),
    }
    hook.handleEvent = (name, callback) => {
        handlers[name] = callback
    }
    hook.pushEvent = (name, payload) => {
        let resolve
        let reject
        const promise = new Promise((res, rej) => {
            resolve = res
            reject = rej
        })
        requests.push({ name, payload, promise, resolve, reject })
        return promise
    }

    hook.mounted()
    await tick()

    const fire = (name, payload) => handlers[name]?.(payload)
    globalThis.__outerDispatch = fire

    const payloadFor = (addr, source, view = "watch", draft_live = true) => ({
        addr,
        origin_name: addr,
        view,
        draft_live,
        source,
        diagnostics: [],
    })

    const see = (addr, source, view = "watch", draft_live = true) =>
        fire("seeOuterShell", payloadFor(addr, source, view, draft_live))

    // Real local departure: open the exact envelope, then dispatch it through
    // the lifecycle. The correlated seeWeave request is the only ack.
    const seeLocal = (addr, source, view = "watch", draft_live = true) => {
        const payload = payloadFor(addr, source, view, draft_live)
        const token = hook.selection.open(payload)
        fire("seeOuterShell", payload)
        return token
    }

    const intent = (addr, view = "watch", draft_live = true, follow_peer = true) =>
        fire("outerIntent", { addr, view, draft_live, follow_peer })

    // A true user peer click: the raw outerSelect command, never a server intent.
    const selectPeer = (addr) =>
        fire("outerSelect", { addr, view: "watch", draft_live: true, follow_peer: true })

    const keydown = listeners.find(([, name, , capture]) => name === "keydown" && capture === true)?.[2]

    const press = (key) => {
        const event = {
            key,
            ctrlKey: false,
            metaKey: false,
            altKey: false,
            prevented: false,
            preventDefault() {
                this.prevented = true
            },
        }
        keydown(event)
        return event
    }

    const close = (local = true) => fire("outerClose", local ? { local: true } : {})

    const resolveRequest = (name, reply) => {
        const request = [...requests].reverse().find((entry) => entry.name === name)
        assert.ok(request, `no ${name} request`)
        request.resolve(reply)
        return request
    }

    const boot = async () => {
        releaseBoot?.({ term, cm6: {} })
        await tick()
    }

    const clickFork = () => {
        const onClick = listeners.find(([el, name]) => el === hook.el && name === "click")?.[2]
        onClick?.({ target: { closest: () => forkButton } })
    }
    const takeAttention = () => {
        const onHand = listeners.find(([el, name]) => el === env && name === "mousedown")?.[2]
        onHand?.({ type: "mousedown", target: { closest: () => null } })
    }
    return {
        hook,
        env,
        selectionStatus,
        forkButton,
        clickFork,
        takeAttention,
        readerHasAttention: () => reaches[0].gate(),
        boot,
        surface: hook.surface,
        selection: hook.selection,
        requests,
        fire,
        press,
        see,
        seeLocal,
        intent,
        selectPeer,
        close,
        resolveRequest,
        tick,
    }
}

describe("explicit switch: displayed code is not yet the selected document", () => {
    test("waiting code is labelled and cannot be forked under the next peer", async () => {
        const shell = await mount()
        assert.equal(shell.env.dataset.outerSelection, "closed")
        assert.equal(shell.forkButton.disabled, true)

        shell.see(A, "fw 10")
        assert.equal(shell.env.dataset.outerSelection, "ready")
        assert.equal(shell.forkButton.disabled, false)
        shell.selectPeer(B)
        assert.equal(text, "fw 10")
        assert.equal(shell.env.dataset.outerSelection, "waiting")
        assert.equal(shell.selectionStatus.hidden, false)
        assert.equal(shell.forkButton.disabled, true)
        shell.clickFork()
        assert.deepEqual(forks, [])

        shell.resolveRequest("restoreShell", { addr: B, view: "watch", draft_live: true, follow_peer: true })
        await shell.tick()
        shell.see(B, "fw 20")
        assert.equal(shell.env.dataset.outerSelection, "ready")
        assert.equal(shell.selectionStatus.hidden, true)
        assert.equal(shell.forkButton.disabled, false)
        shell.clickFork()
        assert.equal(forks[0].addr, B)
        assert.equal(forks[0].source, "fw 20")

        shell.close()
        assert.equal(shell.env.dataset.outerSelection, "closed")
        assert.equal(shell.selectionStatus.hidden, true)
        assert.equal(shell.forkButton.disabled, true)
    })

    test("peer-update consent does not take or return local user attention", async () => {
        const shell = await mount()
        shell.see(A, "fw 10")
        assert.equal(shell.readerHasAttention(), false)
        shell.intent(A, "watch", true, false)
        assert.equal(shell.readerHasAttention(), false)

        shell.takeAttention()
        assert.equal(shell.readerHasAttention(), true)
        shell.intent(A, "watch", true, true)
        assert.equal(shell.readerHasAttention(), true)
    })
    test("a pending selection rejects a key without entering a draft", async () => {
        const { press, see, selectPeer, resolveRequest, tick: wait } = await mount()
        see(A, "fw 10")

        selectPeer(B)

        const event = press("9")
        assert.equal(event.prevented, true, "ghost A must not receive the edit intent")
        assert.equal(drafting, false)
        assert.deepEqual(pushes, [], "no subjectless draft is pushed")
        assert.equal(text, "fw 10", "ghost A is unchanged")

        resolveRequest("restoreShell", { addr: B, view: "watch", draft_live: true, follow_peer: true })
        await wait()
        see(B, "fw 20")
        assert.equal(text, "fw 20", "B lands and replaces the ghost")
        assert.equal(drafting, false)
    })

    test("a key that beats the intent is retired by the matching re-assert", async () => {
        const { press, see, selectPeer, resolveRequest, tick: wait } = await mount()
        see(A, "fw 10")

        const event = press("9")
        assert.equal(event.prevented, false)
        assert.equal(drafting, true)
        assert.deepEqual(pushes, [["outerDraft", { addr: A }]])
        text = "9fw 10"

        selectPeer(B)
        assert.equal(drafting, false)

        resolveRequest("restoreShell", { addr: B, view: "watch", draft_live: true, follow_peer: true })
        await wait()
        see(B, "fw 20")
        assert.equal(text, "fw 20")
        assert.equal(drafting, false)
    })

    test("an explicit switch to a different peer retires the draft", async () => {
        const { press, see, selectPeer, resolveRequest, tick: wait } = await mount()
        see(A, "fw 10")
        press("9")
        text = "9fw 10"

        selectPeer(B)
        resolveRequest("restoreShell", { addr: B, view: "watch", draft_live: true, follow_peer: true })
        await wait()
        see(B, "fw 20")
        assert.equal(drafting, false)
        assert.equal(text, "fw 20")
    })
})

describe("matching refresh, reconnect, and local weave open preserve a live draft", () => {
    test("a repeated matching outerIntent keeps the draft", async () => {
        const { press, see, intent } = await mount()
        see(A, "fw 10")
        intent(A)
        press("9")
        text = "9fw 10"
        assert.equal(drafting, true)

        intent(A, "draft", true, true)
        assert.equal(drafting, true)
        assert.equal(text, "9fw 10")
    })

    test("a same-address document refresh preserves the draft", async () => {
        const { press, see, intent } = await mount()
        see(A, "fw 10")
        intent(A)
        press("9")
        text = "9fw 10"

        see(A, "fw 10", "watch", true)
        assert.equal(drafting, true)
        assert.equal(text, "9fw 10")
    })

    test("an invalid restore reply keeps the pending selection", async () => {
        const { see, intent, fire, requests, selection, tick: wait } = await mount()
        see(A, "fw 10")
        intent(A)

        const latest = () => [...requests].reverse().find((entry) => entry.name === "restoreShell")
        const valid = { addr: A, view: "draft", draft_live: true, follow_peer: true }

        fire("syncShell")
        latest().resolve(undefined)
        await wait()
        assert.ok(selection.pending(), "silence keeps protection")

        fire("syncShell")
        latest().resolve({ ...valid, addr: B })
        await wait()
        assert.ok(selection.pending(), "wrong address keeps protection")

        fire("syncShell")
        latest().resolve(valid)
        await wait()
        assert.equal(selection.pending(), null)
    })

    test("syncShell restores the same address with a correlated request", async () => {
        const { press, see, intent, fire, requests, selection, tick: wait } = await mount()
        see(A, "fw 10")
        intent(A)
        press("9")
        text = "9fw 10"

        fire("syncShell")

        const request = [...requests].reverse().find((entry) => entry.name === "restoreShell")
        assert.ok(request, "readiness sends a correlated restoreShell")
        assert.equal(request.payload.addr, A)
        assert.equal(request.payload.view, "draft")
        assert.equal(request.payload.draft_live, true)
        assert.ok(selection.pending(), "readiness holds a new pending incarnation")

        request.resolve({ addr: A, view: "draft", draft_live: true, follow_peer: true })
        await wait()

        assert.equal(selection.pending(), null)
        assert.equal(drafting, true)
        assert.equal(text, "9fw 10")
    })

    test("a queued syncShell restores newest local B, never retired A", async () => {
        const { hook, requests, seeLocal, fire, boot, selection, tick: wait } =
            await mount({ deferBoot: true })

        seeLocal(A, "fw A")
        seeLocal(B, "fw B")
        fire("syncShell")

        assert.equal(hook.surface, null, "readiness is queued while boot is pending")
        await boot()

        const restores = requests.filter((entry) => entry.name === "restoreShell")
        assert.equal(restores.length, 1, "readiness asks once")
        assert.equal(restores[0].payload.addr, B, "newest local descriptor wins")
        assert.equal(
            restores.some((entry) => entry.payload.addr === A),
            false,
            "retired historical A is never restored",
        )
        assert.equal(text, "fw B")
        assert.equal(selection.pending()?.addr, B)
        await wait()
    })

describe("cross-origin local weave open vs a delayed server intent", () => {
    test("a stale server B descriptor must not retire a newer local A draft", async () => {
        const { press, see, seeLocal, intent, selection } = await mount()

        // B seeTurtle was requested; the client already displays B.
        see(B, "fw 20")
        intent(B)

        // The client-local library open A is newer than the B request and is
        // immediately editable (lvdx-5). The server has not processed it yet.
        const token = seeLocal(A, "lib 10")
        const event = press("9")
        assert.equal(event.prevented, false, "local A is a real selection, not a ghost")
        assert.equal(drafting, true)
        assert.deepEqual(pushes, [["outerDraft", { addr: A }]])
        text = "9lib 10"

        // A delayed outerIntent B arrives before the server acks seeWeave A.
        intent(B)
        assert.equal(drafting, true, "stale B must not retire the newer local A draft")
        assert.equal(text, "9lib 10")
        assert.equal(selection.pending(), token)

        // Only the correlated completion clears this exact incarnation.
        assert.equal(selection.ack(token), true)
        assert.equal(drafting, true)
        assert.equal(text, "9lib 10")
    })

    test("an old A acknowledgement cannot clear a newer A and let stale B retire it", async () => {
        const { press, see, seeLocal, intent, selection } = await mount()

        see(B, "fw 20")
        intent(B)

        const first = seeLocal(A, "lib 1")
        press("9")
        text = "9lib 1"

        const second = seeLocal(A, "lib 2")
        assert.equal(drafting, true)
        assert.equal(text, "9lib 1")

        // Delayed completion for A1 must not clear A2.
        assert.equal(selection.ack(first), false)
        intent(B)
        assert.equal(drafting, true, "older A ack + stale B must not retire the newer A draft")
        assert.equal(text, "9lib 1")

        assert.equal(selection.ack(second), true)
        assert.equal(drafting, true)
        assert.equal(text, "9lib 1")
    })
})

describe("local close is one correlated request with a close fence", () => {
    test("local close departs before deferred boot; ordered ACK then B wins", async () => {
        const { hook, requests, see, seeLocal, selectPeer, resolveRequest, close, boot, selection, tick: wait } =
            await mount({ deferBoot: true })

        seeLocal(A, "fw A")
        close()

        const closes = requests.filter((entry) => entry.name === "closeTurtle")
        assert.equal(closes.length, 1, "closeTurtle leaves at raw arrival")
        assert.equal(hook.surface, null, "the request departs while boot is still pending")

        closes[0].resolve({ addr: null, view: "watch", draft_live: true, follow_peer: true })
        await wait()
        assert.equal(selection.pending(), null, "close ACK clears the fence before B")

        selectPeer(B)
        resolveRequest("restoreShell", { addr: B, view: "watch", draft_live: true, follow_peer: true })
        await wait()
        see(B, "fw B")
        assert.equal(hook.surface, null, "B is queued behind the pending boot")

        await boot()
        assert.equal(text, "fw B", "ordered close ACK then B intent/doc remains B after boot")
        assert.equal(selection.pending(), null)
        assert.equal(
            requests.filter((entry) => entry.name === "closeTurtle").length,
            1,
            "domain cleanup never sends a second close",
        )
    })
    test("duplicate local close ingress pushes once and the ACK clears", async () => {
        const { requests, fire, selection, tick: wait } = await mount()
        const payload = { local: true }

        fire("outerClose", payload)
        fire("outerClose", payload)

        const closes = requests.filter((entry) => entry.name === "closeTurtle")
        assert.equal(closes.length, 1, "duplicate ingress cannot duplicate the command")
        const pending = selection.pending()
        assert.ok(pending, "first ingestion owns the close receipt")

        closes[0].resolve({ addr: null, view: "watch", draft_live: true, follow_peer: true })
        await wait()
        assert.equal(selection.pending(), null, "the one receipt still clears the fence")
    })

    test("pre- and post-reply documents for a retired subject are rejected", async () => {
        const { press, see, seeLocal, close, requests, selection, tick: wait } = await mount()
        seeLocal(A, "lib 10")
        press("9")
        text = "9lib 10"

        close()
        assert.equal(drafting, false)
        assert.equal(text, "")

        const first = [...requests].reverse().find((entry) => entry.name === "closeTurtle")
        assert.ok(first, "local close owns one correlated request")
        assert.ok(selection.pending(), "close holds the fence")

        first.resolve(undefined)
        await wait()
        assert.ok(selection.pending(), "silence keeps the close fence")

        see(A, "stale fw 10")
        assert.equal(text, "", "pre-reply document is rejected")

        // A second local close is a newer incarnation; a canonical reply clears it.
        close()
        const second = [...requests].reverse().find((entry) => entry.name === "closeTurtle")
        assert.ok(second)
        assert.notEqual(second, first)
        second.resolve({ addr: null, view: "watch", draft_live: true, follow_peer: true })
        await wait()
        assert.equal(selection.pending(), null)

        see(A, "post fw 10")
        assert.equal(text, "", "post-reply delivery for the retired subject is rejected")
    })

    test("a server notify cannot close a newer pending local open", async () => {
        const { press, seeLocal, close, selection } = await mount()
        seeLocal(A, "lib 10")
        press("9")
        text = "9lib 10"
        const token = selection.pending()

        close(false)
        assert.equal(drafting, true)
        assert.equal(text, "9lib 10")
        assert.equal(selection.pending(), token)
    })
    test("a stale outerLive cannot stop a newer local draft", async () => {
        const { press, seeLocal, fire, selection } = await mount()
        seeLocal(A, "lib 10")
        press("9")
        text = "9lib 10"
        const token = selection.pending()

        fire("outerLive", { live: false })
        assert.equal(drafting, true)
        assert.equal(text, "9lib 10")
        assert.equal(selection.pending(), token)
    })

    test("a hung close is retried by syncShell and a later peer is accepted", async () => {
        const { press, see, seeLocal, selectPeer, resolveRequest, close, fire, requests, selection, tick: wait } = await mount()
        seeLocal(A, "lib 10")
        press("9")
        text = "9lib 10"

        close()
        const first = [...requests].reverse().find((entry) => entry.name === "closeTurtle")
        first.reject(new Error("offline close drop"))
        await wait()
        assert.ok(selection.pending(), "failed close keeps the fence")

        fire("syncShell")
        const closes = requests.filter((entry) => entry.name === "closeTurtle")
        assert.equal(closes.length, 2, "syncShell retries closeTurtle")
        assert.equal(requests.some((entry) => entry.name === "restoreShell"), false)
        assert.notEqual(closes[1], first)

        closes[1].resolve({ addr: null, view: "watch", draft_live: true, follow_peer: true })
        await wait()
        assert.equal(selection.pending(), null)

        selectPeer(B)
        resolveRequest("restoreShell", { addr: B, view: "watch", draft_live: true, follow_peer: true })
        await wait()
        see(B, "fw B")
        assert.equal(text, "fw B")
    })

    test("a hung local A cannot block a deliberate outerSelect B", async () => {
        const { seeLocal, selectPeer, requests, selection } = await mount()
        seeLocal(A, "lib A")
        assert.equal(selection.pending()?.addr, A)

        selectPeer(B)

        const restore = requests.find((entry) => entry.name === "restoreShell")
        assert.ok(restore, "the peer command leaves as a correlated selector install")
        assert.equal(restore.payload.addr, B)
        assert.equal(selection.pending()?.addr, B)
    })

    test("outerSelect departs before boot and opens waiting on the same-subject toggle", async () => {
        const { hook, selectPeer, requests, selection, boot, env, tick: wait } =
            await mount({ deferBoot: true })

        selectPeer(B)
        const restore = requests.find((entry) => entry.name === "restoreShell")
        assert.ok(restore, "the peer command leaves at raw arrival")
        assert.equal(hook.surface, null, "the request departs while boot is pending")
        assert.equal(selection.pending()?.addr, B)

        restore.resolve({ addr: B, view: "watch", draft_live: true, follow_peer: true })
        await wait()
        await boot()

        assert.equal(env.dataset.outerSelection, "waiting", "the selection opens before a body")
        assert.equal(text, "", "no document was fabricated")

        selectPeer(B)
        const close = requests.find((entry) => entry.name === "closeTurtle")
        assert.ok(close, "the same subject toggles through the local close path")
        assert.equal(selection.pending()?.addr, null)
    })

    test("an offline peer command stays selected; newer command and toggle win", async () => {
        const { selectPeer, requests, selection, env, tick: wait } = await mount()

        selectPeer(B)
        const offline = requests.find((entry) => entry.name === "restoreShell")
        offline.resolve(undefined)
        await wait()
        assert.equal(selection.pending()?.addr, B, "silence keeps the local fence")
        assert.equal(env.dataset.outerSelection, "waiting")

        selectPeer(A)
        const newer = [...requests].reverse().find((entry) => entry.name === "restoreShell")
        assert.equal(newer.payload.addr, A)
        assert.equal(selection.pending()?.addr, A)

        newer.resolve({ addr: A, view: "watch", draft_live: true, follow_peer: true })
        await wait()
        assert.equal(selection.pending(), null)

        selectPeer(A)
        const close = requests.find((entry) => entry.name === "closeTurtle")
        assert.ok(close, "same subject closes")
        assert.equal(selection.pending()?.addr, null)
    })

    test("a queued syncShell before the peer domain needs no pending-selector branch", async () => {
        const { fire, selectPeer, requests, selection, boot } = await mount({ deferBoot: true })

        fire("syncShell")
        selectPeer(B)
        await boot()

        const restores = requests.filter((entry) => entry.name === "restoreShell")
        assert.equal(restores.length, 1, "the raw departure already sent the selector")
        assert.equal(restores[0].payload.addr, B)
        assert.equal(selection.pending()?.addr, B)
    })

    test("a malformed outerSelect cannot close or own", async () => {
        const { fire, selectPeer, requests, selection } = await mount()

        fire("outerSelect", {})
        assert.equal(requests.length, 0, "no request from an unknown command")
        assert.equal(selection.current(), null, "no owner is invented")

        selectPeer(B)
        const before = requests.filter((entry) => entry.name === "closeTurtle").length
        fire("outerSelect", {})
        assert.equal(
            requests.filter((entry) => entry.name === "closeTurtle").length,
            before,
            "a malformed command cannot close the selected subject",
        )
        assert.equal(selection.current()?.addr, B)
    })

})
})
