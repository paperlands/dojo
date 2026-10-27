// Real mountInner over mocked ports: claims, deferred render, readiness commit.

import { registerHooks } from "node:module"
import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"

const noop = () => {}
const stops = () => noop
const pushes = []
const quietFns = []
const paceFns = []
let deferPace = false
let diagnosticsValue = []
let journalGate = null
let failObserve = false
let keeper = null
let snapPath = null
const mintSnapCalls = []
const snapCalls = []
const adoptedArgs = []
const attendCalls = []
const observeCalls = []

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

const temporal = {
    quiet(fn) {
        const held = (...args) => { held.args = args }
        held.flush = () => {
            if (!held.args) return
            const args = held.args
            held.args = null
            fn(...args)
        }
        held.cancel = () => { held.args = null }
        quietFns.push(held)
        return held
    },
    pace(fn) {
        const held = (...args) => {
            held.args = args
            if (!deferPace) held.flush()
        }
        held.flush = () => {
            if (!held.args) return
            const args = held.args
            held.args = null
            fn(...args)
        }
        held.cancel = () => { held.args = null }
        paceFns.push(held)
        return held
    },
    gate: (fn) => fn,
    once: async () => null,
}

class TurtleStub {
    constructor() {
        globalThis.__innerTurtle = this
        this.bridge = mock.bridged("turtle.test")
        this.scheduler = {}
        this.stage = {}
        this.renderstate = {}
        this.onProgress = noop
    }
    attachHand() { return noop }
    removeAmbient() {}
    upsertAmbient() {}
    light() {}
    reflectGate() {}
    programFor() { return null }
    ailments() { return [] }
    attentionMoved() {}
    dispose() {}
    async snap() { snapCalls.push(true); return snapPath }
}

class RecorderStub {}

const pageLaw = () => ({
    orderOf: () => [],
    tree: () => [],
    seatOf: (addr) => addr,
    slotsAt: () => [],
    attentionAt: () => null,
    hasPage: () => false,
    observe: (addr, { name, doc, attention }) => {
        observeCalls.push({ addr, attention })
        if (failObserve) throw new Error("render failed")
        return {
        gone: [], runs: [], light: null, hatch: null, at: null,
        source: doc, merge: false, name,
        }
    },
    attend: (addr, line) => {
        attendCalls.push({ addr, line })
        return { gone: [], runs: [], light: null, hatch: null, at: null }
    },
    forget: () => ({ gone: [], runs: [], light: null, hatch: null, at: null }),
    restore: () => ({ gone: [], runs: [], light: null, hatch: null, at: null }),
    toggle: () => ({ gone: [], runs: [], light: null, hatch: null, at: null }),
})

const mock = {
    Turtle: TurtleStub,
    Recorder: RecorderStub,
    registerStage: stops,
    temporal,
    pageLaw,
    CORESHELL: "coreshell",
    OUTERSHELL: "outershell",
    SELF: "self",
    PEER: "peer",
    registerWorld: stops,
    worldChanged: noop,
    makeReflector: () => ({
        ask: () => ({}),
        of: ({ source, attend }) => ({
            source,
            commands: source ? [{ source }] : [],
            attend,
            diagnostics: diagnosticsValue,
            state: "success",
        }),
    }),
    seatHealth: () => () => ({}),
    readWounds: () => ({ release: noop, read: () => [], watch: stops, changed: noop }),
    frameVitals: () => ({}),
    livingFamily: () => [],
    worldProgress: () => 0,
    mountReach: () => ({ cleanup: noop, reset: noop, pause: noop }),
    printAST: () => "",
    setPeerCell: noop,
    follow: noop,
    haltFollow: noop,
    mountChase: () => ({ cleanup: noop, stir: noop, update: noop }),
    openWatch: () => ({}),
    step: (state) => ({ state }),
    verdict: () => ({ state: "ok" }),
    world: () => null,
    watchWorld: stops,
    mountDiagnosticsInk: stops,
    nerve: () => null,
    nerveSeat: { get: () => null, watch: stops },
    signals: {},
    mountSun: () => ({ release: noop, tick: noop }),
    commands: {
        execute: () => noop,
        camera: () => noop,
        saveImage: () => noop,
        saveRecording: () => noop,
    },
    listeners: {
        keyboard: () => ({ mount: stops }),
        selection: () => ({ mount: stops }),
        theme: () => ({ mount: stops }),
        slider: () => ({ mount: stops }),
    },
    mutators: { slider: () => ({ mount: stops }) },
    register: stops,
    outerDrafting: () => false,
    safePush: (_hook, name, payload) => pushes.push([name, payload]),
    createJournal: () => ({
        close: noop,
        root: () => journalGate?.promise ?? Promise.resolve(null),
        local: () => [],
        list: async () => ({}),
    }),
    createWire: () => ({ say: async () => null, announce: noop, reconnected: noop }),
    mintSnap: async (...args) => { mintSnapCalls.push(args); return "keep-id" },
    adoptWork: () => "w1",
    REACH: {},
    askKeep: async () => null,
    peerOf: () => null,
    registerDoor: stops,
    registerKeeper: (fn) => { keeper = fn; return stops },
    touched: noop,
    sessionName: () => "?",
    forkRef: async () => null,
    link: { read: () => null },
    pullKeep: async () => null,
    fetchFragment: async () => null,
    fragmentIndex: {},
    transpile: () => ({ source: "", ast: [] }),
    bridged: null,
}

const exportsByFile = {
    "/turtling/turtle.js": ["Turtle"],
    "/turtling/export/recorder.js": ["Recorder"],
    "/turtling/stage-cell.js": ["registerStage"],
    "/utils/temporal.js": ["temporal"],
    "/weave/page.js": ["pageLaw", "CORESHELL", "OUTERSHELL", "SELF", "PEER"],
    "/weave/world.js": ["registerWorld", "worldChanged", "world", "watchWorld"],
    "/weave/reflect.js": ["makeReflector"],
    "/weave/seat-health.js": ["seatHealth"],
    "/weave/wounds.js": ["readWounds"],
    "/turtling/vitals.js": ["frameVitals", "livingFamily", "worldProgress"],
    "/editor/reach.js": ["mountReach"],
    "/editor/diagnostics.js": ["mountDiagnosticsInk"],
    "/turtling/parse.js": ["printAST"],
    "/editor/code-cell-activation.js": ["setPeerCell"],
    "/editor/peer-attention.js": ["follow", "haltFollow", "mountChase"],
    "/editor/watch-law.js": ["openWatch", "step"],
    "/weave/queries.js": ["verdict"],
    "/hooks/nerve.js": ["nerve", "nerveSeat"],
    "/nerve/store.js": ["signals"],
    "/nerve/sun.js": ["mountSun"],
    "/shell/core.js": ["commands", "listeners", "mutators"],
    "/adapter.js": ["safePush"],
    "/keep/journal.js": ["createJournal"],
    "/keep/wire.js": ["createWire"],
    "/keep/kinds/snap.js": ["mintSnap"],
    "/keep/work.js": ["adoptWork"],
    "/keep/page.js": ["REACH"],
    "/keep/cell.js": ["askKeep", "peerOf", "registerDoor", "registerKeeper", "touched"],
    "/shell/session-name.js": ["sessionName"],
    "/link.js": ["forkRef", "link", "pullKeep"],
    "/weave/fragments.js": ["fetchFragment", "fragmentIndex"],
    "/weave/parse.js": ["transpile"],
}

registerHooks({
    load(url, context, nextLoad) {
        for (const [suffix, names] of Object.entries(exportsByFile)) {
            if (url.endsWith(suffix)) {
                return {
                    format: "module",
                    shortCircuit: true,
                    source: names.map((n) => `export const ${n} = globalThis.__innerMocks.${n};`).join("\n"),
                }
            }
        }
        return nextLoad(url, context)
    },
})

globalThis.__innerMocks = mock
const { bridged, scene } = await import("../../../assets/js/bridged.js")
mock.bridged = bridged
const { inner } = await import("../../../assets/js/hooks/shell/inner.js")
const { outer } = await import("../../../assets/js/hooks/shell/outer.js")
const { putSource, getSource } = await import("../../../assets/js/hooks/shell/term-cell.js")
const { makeShellHook } = await import("../../../assets/js/hooks/shell/lifecycle.js")

globalThis.document = {
    getElementById: () => null,
    addEventListener: noop,
    removeEventListener: noop,
    contains: () => false,
}

const shell = {
    dom: { addEventListener: noop, removeEventListener: noop, contains: () => false },
    scrollDOM: {},
    destroyed: false,
    focus: noop,
    dispatch: noop,
    state: {
        selection: { main: { head: 0 } },
        doc: { lineAt: () => ({ number: 1 }), lines: 1 },
    },
}

const activeHooks = []
async function mount({ gate = null } = {}) {
    pushes.length = 0
    quietFns.length = 0
    paceFns.length = 0
    diagnosticsValue = []
    journalGate = gate
    failObserve = false
    adoptedArgs.length = 0
    attendCalls.length = 0
    observeCalls.length = 0
    keeper = null
    snapPath = null
    mintSnapCalls.length = 0
    snapCalls.length = 0
    const sourceBridge = bridged("source.test")
    const bridge = bridged("frame.test")
    const selectionBridge = bridged("selection.test")

    const term = {
        inner: noop,
        bridge,
        sourceBridge,
        selectionBridge,
        shell,
        innerBase: true,
        currentBufferId: () => "b1",
        currentWorkId: () => null,
        getBufferInfo: () => ({ name: "one", content: "fw 1", origin: null }),
        getValue: () => "fw 1",
        setOption: noop,
        setTabActive: noop,
        clearAllTabActive: noop,
        adoptWork: (...args) => adoptedArgs.push(args),
        forkBuffer: noop,
        resumeMerge: noop,
        updateMergeOriginal: noop,
        clearMerge: noop,
        opBufferHandler: noop,
        destroy: noop,
        triggerBridge: () => {
            const claim = { place: "coreshell", addr: "b1", name: "one", text: "fw 1", buffer_id: "b1" }
            sourceBridge.pub(claim)
            const payload = { id: "b1", name: "one", content: "fw 1", claim }
            bridge.pub(payload)
            return payload
        },
    }

    const handlers = {}
    const hook = makeShellHook({
        boot: async () => ({ term, cm6: {} }),
        surfaces: { coreshell: inner },
    })
    hook.el = { dataset: { target: "coreshell" } }
    hook.handleEvent = (name, callback) => { handlers[name] = callback }
    hook.mounted()
    activeHooks.push(hook)
    await tick()

    return {
        hook,
        term,
        sourceBridge,
        bridge,
        surface: hook.surface,
        fire: (name, payload) => handlers[name]?.(payload),
        flush: () => {
            quietFns.forEach((fn) => fn.flush())
            paceFns.forEach((fn) => fn.flush())
        },
        hatches: () => pushes.filter(([name]) => name === "hatchTurtle").map(([, p]) => p),
    }
}

async function mountBoth({ deferInner = false } = {}) {
    pushes.length = 0
    quietFns.length = 0
    paceFns.length = 0
    diagnosticsValue = []
    journalGate = null
    failObserve = false
    adoptedArgs.length = 0
    attendCalls.length = 0
    observeCalls.length = 0
    keeper = null
    snapPath = null
    mintSnapCalls.length = 0
    snapCalls.length = 0
    putSource(null)

    const sourceBridge = bridged("source.both")
    const bridge = bridged("frame.both")
    const selectionBridge = bridged("selection.both")
    const innerTerm = {
        inner: noop, bridge, sourceBridge, selectionBridge, shell,
        currentBufferId: () => "b1",
        currentWorkId: () => null,
        getBufferInfo: () => ({ name: "one", content: "fw 1", origin: null }),
        getValue: () => "fw 1",
        setOption: noop, setTabActive: noop, clearAllTabActive: noop,
        adoptWork: (...args) => adoptedArgs.push(args), forkBuffer: noop, resumeMerge: noop,
        updateMergeOriginal: noop, clearMerge: noop, opBufferHandler: noop,
        destroy: noop,
        triggerBridge: () => {
            const claim = coreClaim("fw 1")
            sourceBridge.pub(claim)
            const payload = { id: "b1", name: "one", content: "fw 1", claim }
            bridge.pub(payload)
            return payload
        },
    }

    let outerText = "draft"
    let outerDrafting = false
    const outerEvents = {}
    const outerShell = {
        dom: {
            addEventListener: (name, callback) => {
                (outerEvents[name] ||= []).push(callback)
            },
            removeEventListener: noop,
            contains: () => false,
        },
        scrollDOM: { addEventListener: noop, removeEventListener: noop },
        destroyed: false,
        focus: noop,
        dispatch: noop,
        state: {
            selection: { main: { head: 0 } },
            doc: { lineAt: () => ({ number: 1 }), lines: 1 },
        },
    }
    const outerBridge = bridged("outer.both")
    const outerTerm = {
        outer: noop,
        drafting: () => outerDrafting,
        bridge: outerBridge,
        shell: outerShell,
        getValue: () => outerText,
        beginDraft: () => { outerDrafting = true },
        endDraft: () => { outerDrafting = false },
        changeouter: (s) => { if (!outerDrafting) outerText = s },
        streamOrigin: noop,
        setOption: noop,
    }

    const innerHandlers = {}
    const innerHook = makeShellHook({
        boot: async () => ({ term: innerTerm, cm6: {} }),
        surfaces: { coreshell: inner },
    })
    innerHook.el = { dataset: { target: "coreshell" } }
    innerHook.handleEvent = (name, callback) => { innerHandlers[name] = callback }

    const outerHandlers = {}
    const outerHook = makeShellHook({
        boot: async () => ({ term: outerTerm, cm6: {} }),
        surfaces: { outershell: outer },
    })
    outerHook.el = {
        dataset: { target: "outershell" },
        closest: () => null,
        addEventListener: noop,
        removeEventListener: noop,
        contains: () => false,
    }
    outerHook.handleEvent = (name, callback) => { outerHandlers[name] = callback }

    outerHook.mounted()
    activeHooks.push(outerHook)
    await tick()

    const startInner = async () => {
        innerHook.mounted()
        activeHooks.push(innerHook)
        await tick()
    }
    if (!deferInner) await startInner()
    await tick()

    return {
        innerHook,
        outerHook,
        sourceBridge,
        startInner,
        outerBridge,
        setOuterText: (s) => { outerText = s },
        setOuterLine: (line) => {
            outerShell.state.selection.main.head = line - 1
            outerShell.state.doc.lineAt = () => ({ number: line })
        },
        setSnapPath: (s) => { snapPath = s },
        observeCalls,
        keep: (ask) => keeper?.(ask),
        mintSnapCalls,
        snapCalls,
        innerFire: (name, payload) => innerHandlers[name]?.(payload),
        outerFire: (name, payload) => outerHandlers[name]?.(payload),
        pressOuter: (key) => {
            const callback = outerEvents.keydown?.[0]
            callback?.({
                key, ctrlKey: false, metaKey: false, altKey: false,
                preventDefault: noop,
            })
        },
        flush: () => {
            quietFns.forEach((fn) => fn.flush())
            paceFns.forEach((fn) => fn.flush())
        },
        hatches: () => pushes.filter(([name]) => name === "hatchTurtle").map(([, p]) => p),
    }
}

afterEach(() => {
    for (const hook of activeHooks.splice(0)) {
        try { hook.destroyed() } catch { /* already dead */ }
    }
    putSource(null)
    deferPace = false
    failObserve = false
})

const coreClaim = (text = "fw 1", addr = "b1") => ({
    place: "coreshell", addr, name: "one", text, buffer_id: addr,
})

describe("mountInner source claims and commits", () => {
    test("readiness commits a dirty core claim and sends its buffer id", async () => {
        const { sourceBridge, fire, hatches } = await mount()
        const claim = coreClaim("fw 9")

        sourceBridge.pub(claim)
        fire("syncShell")

        const last = hatches().at(-1)
        assert.equal(last.source, "fw 9")
        assert.equal(last.buffer_id, "b1")
        assert.deepEqual(last.commands, [{ source: "fw 9" }])
    })

    test("a newer outer claim wins while the core draft path stays deferred", async () => {
        const { sourceBridge, fire, hatches } = await mount()
        const core = coreClaim("core old")
        sourceBridge.pub(core)

        const outer = { place: "outershell", addr: "o1", name: "friend", text: "draft", buffer_id: null }
        scene.claim(outer)
        scene.observe("o1", "friend", "draft", outer)

        fire("syncShell")
        const last = hatches().at(-1)
        assert.equal(last.source, "draft")
        assert.equal(last.buffer_id, null)
    })

    test("a newer core claim wins while the outer draft remains open", async () => {
        const { sourceBridge, fire, hatches } = await mount()
        const outer = { place: "outershell", addr: "o1", name: "friend", text: "draft", buffer_id: null }
        scene.claim(outer)
        scene.observe("o1", "friend", "draft", outer)

        const core = coreClaim("core newer")
        sourceBridge.pub(core)
        fire("syncShell")

        const last = hatches().at(-1)
        assert.equal(last.source, "core newer")
        assert.equal(last.buffer_id, "b1")
    })

    test("an older deferred core render cannot reclaim after a newer outer claim", async () => {
        const { sourceBridge, bridge, flush, fire, hatches } = await mount()
        const old = coreClaim("old core")
        sourceBridge.pub(old)
        bridge.pub({ id: "b1", name: "one", content: "old core", claim: old })

        const outer = { place: "outershell", addr: "o1", name: "friend", text: "new draft", buffer_id: null }
        scene.claim(outer)
        scene.observe("o1", "friend", "new draft", outer)
        flush()
        fire("syncShell")

        const last = hatches().at(-1)
        assert.equal(last.source, "new draft")
        assert.equal(last.buffer_id, null)
    })

    test("a dirty owner suppresses hatch instead of mixing revisions", async () => {
        const { sourceBridge, bridge } = await mount()
        const claim = coreClaim("new source")
        sourceBridge.pub(claim)

        bridge.pub({ id: "b1", name: "one", content: "new source", claim })
        // quiet is still deferred; hatch is dirty.
        const before = pushes.length
        const turtleBridge = mock.Turtle.prototype.bridge
        void turtleBridge
        // The turtle bridge is the real instance created at mount.
        // Publish through the surface's subscribed bridge via scene? Use the
        // turtle stub bridge exported by the mounted instance.
        const surfaceTurtle = globalThis.__innerTurtle
        surfaceTurtle.bridge.pub(["hatchTurtle", { source: "old", commands: [{ old: true }], buffer_id: "wrong" }])
        assert.equal(pushes.length, before, "dirty hatch is suppressed")
    })

    test("runtime diagnostics are re-asked, not frozen in the envelope", async () => {
        const { sourceBridge, fire, flush, hatches } = await mount()
        const claim = coreClaim("fw 1")
        diagnosticsValue = [{ message: "first" }]
        sourceBridge.pub(claim)
        fire("syncShell")
        flush()

        const first = hatches().at(-1)
        assert.deepEqual(first.diagnostics, [{ message: "first" }])

        diagnosticsValue = [{ message: "second" }]
        const surfaceTurtle = globalThis.__innerTurtle
        surfaceTurtle.bridge.pub(["hatchTurtle", { source: "ignored", commands: [], buffer_id: "wrong" }])
        const second = hatches().at(-1)
        assert.deepEqual(second.diagnostics, [{ message: "second" }])
        assert.equal(second.buffer_id, "b1")
    })
    test("triggerBridge claims and commits the initial source", async () => {
        const { term, flush, fire, hatches } = await mount()
        term.triggerBridge()
        flush()
        fire("syncShell")

        const last = hatches().at(-1)
        assert.equal(last.source, "fw 1")
        assert.equal(last.buffer_id, "b1")
    })

    test("post-destroy claims cannot publish", async () => {
        const { hook, sourceBridge } = await mount()
        hook.destroyed()
        const before = pushes.length

        sourceBridge.pub(coreClaim("after destroy"))
        scene.claim({ place: "outershell", addr: "o1", name: "friend", text: "late", buffer_id: null })
        await tick()

        assert.equal(pushes.length, before)
    })

    test("a stale attend claim cannot move the light", async () => {
        const { sourceBridge } = await mount()
        const outer = { place: "outershell", addr: "o1", name: "friend", text: "draft", buffer_id: null }
        scene.claim(outer)

        const core = coreClaim("core newer")
        sourceBridge.pub(core)

        scene.attend("o1", 7, { claim: outer })
        assert.deepEqual(attendCalls, [], "stale claim is barred before the effect")

        scene.attend("b1", 2, { claim: core })
        assert.deepEqual(attendCalls, [{ addr: "b1", line: 2 }])
    })

    test("combined: stale outer runDraft cannot move light after a newer core claim", async () => {
        const both = await mountBoth()

        both.outerFire("seeOuterShell", {
            addr: "o1", origin_name: "friend", view: "watch", draft_live: true, source: "draft",
        })
        both.pressOuter("9")
        assert.ok(attendCalls.length > 0, "outer draft entry attend lands while owner")

        both.setOuterText("stale draft")
        both.outerBridge.pub({ content: "stale draft" })
        both.sourceBridge.pub(coreClaim("core newer"))

        const before = attendCalls.length
        both.flush()
        assert.equal(attendCalls.length, before, "stale outer runDraft attend is barred")

        both.innerFire("syncShell")
        const last = both.hatches().at(-1)
        assert.equal(last.source, "core newer")
        assert.equal(last.buffer_id, "b1")
    })

    test("combined: dirty outer line 2 + immediate sync carries line 2, not old line 1", async () => {
        const both = await mountBoth()

        both.outerFire("seeOuterShell", {
            addr: "o1", origin_name: "friend", view: "watch", draft_live: true, source: "line1\nline2",
        })
        both.pressOuter("9")
        assert.ok(attendCalls.length > 0, "outer draft entry attend lands while owner")

        both.setOuterText("line1\nline2 edited")
        both.setOuterLine(2)
        // Outer bridge claims the fresh departure, but runDraftQuiet has not
        // fired; the inward sync must still read the live outer caret.
        both.outerBridge.pub({ content: "line1\nline2 edited" })
        both.innerFire("syncShell")

        const last = both.hatches().at(-1)
        assert.equal(last.source, "line1\nline2 edited")
        assert.equal(last.attend.line, 2, "fresh source carries the live outer line")
        assert.equal(both.observeCalls.at(-1).attention.line, 2, "initial seat uses the same line")
    })

    test("dirty reflection cannot mint; settled empty source still can", async () => {
        const both = await mountBoth()

        both.outerFire("seeOuterShell", {
            addr: "o1", origin_name: "friend", view: "watch", draft_live: true, source: "line1",
        })
        both.pressOuter("9")
        both.setOuterText("")
        both.setOuterLine(2)
        both.outerBridge.pub({ content: "" })
        both.setOuterLine(2)
        both.setSnapPath("data:image/png;base64,AAAA")

        const dirty = await both.keep({ title: "dirty" })
        assert.equal(dirty, null, "dirty source fails closed")
        assert.equal(both.mintSnapCalls.length, 0, "mintSnap is never called without a reflection")
        assert.equal(both.snapCalls.length, 0, "no picture is taken for a missing source")

        both.flush()
        const empty = await both.keep({ title: "empty" })
        assert.equal(empty, "keep-id", "settled empty source keeps")
        assert.equal(both.mintSnapCalls.length, 1)
        assert.equal(both.mintSnapCalls[0][1].source, "", "empty is explicit, not missing")
    })

    test("delayed journal metadata cannot steal a newer outer claim", async () => {
        let release
        const gate = { promise: new Promise((resolve) => { release = resolve }) }
        const { fire, hatches } = await mount({ gate })

        const outer = { place: "outershell", addr: "o1", name: "friend", text: "draft", buffer_id: null }
        scene.claim(outer)
        scene.observe("o1", "friend", "draft", outer)

        release(null)
        await tick()
        await tick()

        fire("syncShell")
        const last = hatches().at(-1)
        assert.equal(last.source, "draft")
        assert.equal(last.buffer_id, null)
        assert.equal(adoptedArgs.at(-1)?.[1], "b1", "metadata hydration is bound to captured buf")
    })

    test("inner boot recovers an outer claim set before mount", async () => {
        const outer = { place: "outershell", addr: "o1", name: "friend", text: "early draft", buffer_id: null }
        putSource(outer)
        const { fire, hatches } = await mount()

        fire("syncShell")
        const last = hatches().at(-1)
        assert.equal(last.source, "early draft")
        assert.equal(last.buffer_id, null)
    })

    test("combined: outer draft claimed before inner boot is recovered", async () => {
        const both = await mountBoth({ deferInner: true })

        both.outerFire("seeOuterShell", {
            addr: "o1", origin_name: "friend", view: "watch", draft_live: true, source: "early draft",
        })
        both.pressOuter("9")
        await both.startInner()

        both.innerFire("syncShell")
        const last = both.hatches().at(-1)
        assert.equal(last.source, "early draft")
        assert.equal(last.buffer_id, null)
    })

    test("paced hatch binds departure claim; retired A cannot publish after B", async () => {
        deferPace = true
        const { sourceBridge, fire, flush, hatches } = await mount()

        const A = coreClaim("A")
        sourceBridge.pub(A)
        fire("syncShell")

        const B = coreClaim("B")
        sourceBridge.pub(B)
        flush()
        assert.equal(hatches().some((p) => p.source === "A"), false)

        fire("syncShell")
        flush()
        const last = hatches().at(-1)
        assert.equal(last.source, "B")
        assert.equal(last.buffer_id, "b1")
    })

    test("stale source lease cannot clear a newer producer claim", () => {
        const core = coreClaim("core")
        const outer = { place: "outershell", addr: "o1", name: "friend", text: "outer", buffer_id: null }
        const releaseCore = putSource(core)
        const releaseOuter = putSource(outer)

        releaseCore()
        assert.equal(getSource(), outer)
        releaseOuter()
        assert.equal(getSource(), null)
    })

    test("a destroyed inner releases its source claim; the next inner gets no dead draft", async () => {
        const first = await mount()
        first.sourceBridge.pub(coreClaim("dead core"))
        first.hook.destroyed()

        const second = await mount()
        second.fire("syncShell")
        const last = second.hatches().at(-1)
        assert.equal(last.source, "fw 1")
        assert.equal(last.buffer_id, "b1")
    })

    test("an outer destroyed before inner boot leaves no resurrected draft", async () => {
        const both = await mountBoth({ deferInner: true })
        both.outerFire("seeOuterShell", {
            addr: "o1", origin_name: "friend", view: "watch", draft_live: true, source: "early draft",
        })
        both.pressOuter("9")
        both.outerHook.destroyed()

        await both.startInner()
        both.innerFire("syncShell")
        const last = both.hatches().at(-1)
        assert.equal(last.source, "fw 1")
        assert.equal(last.buffer_id, "b1")
    })

    test("a failed render does not mark the claim committed", async () => {
        const { sourceBridge, fire, hatches } = await mount()
        const claim = coreClaim("boom")
        sourceBridge.pub(claim)

        failObserve = true
        assert.throws(() => fire("syncShell"))
        assert.equal(hatches().length, 0)

        failObserve = false
        fire("syncShell")
        const last = hatches().at(-1)
        assert.equal(last.source, "boom")
        assert.equal(last.buffer_id, "b1")
    })

    test("projection claim commits an honest null buffer id through mount", async () => {
        const { sourceBridge, fire, hatches } = await mount()
        const claim = { place: "coreshell", addr: "b1", name: "one", text: "kept", buffer_id: null }
        sourceBridge.pub(claim)

        fire("syncShell")
        const last = hatches().at(-1)
        assert.equal(last.source, "kept")
        assert.equal(last.buffer_id, null)
    })

    test("metadata after a pending source does not replace the render", async () => {
        const { sourceBridge, bridge, fire, flush, hatches } = await mount()
        const claim = coreClaim("source")
        sourceBridge.pub(claim)
        bridge.pub({ id: "b1", name: "one", content: "source", claim })
        bridge.pub({ id: "b1", name: "renamed", content: "source", metadata: true })

        flush()
        fire("syncShell")
        const last = hatches().at(-1)
        assert.equal(last.source, "source")
        assert.equal(last.buffer_id, "b1")
    })

})
