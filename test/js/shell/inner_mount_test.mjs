// Real mountInner over mocked ports: claims, deferred render, readiness commit.

import { registerHooks } from "node:module"
import assert from "node:assert/strict"
import { afterEach, describe, test } from "node:test"
import { pageLaw as realPageLaw } from "../../../assets/js/weave/page.js?real"
import { buildWorld, drive, fork, worldOf } from "../laws/harness.mjs"
import { cellIdentities, parseProgram, phaseCells } from "../../../assets/js/turtling/parse.js"

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
// Opt-in real keep modules for the wire test; every other test keeps the stubs.
let handReading = { root: "a".repeat(64), signing: "ready" }
let journalGet = null
let journalProof = null
let realWire = false
let realMint = false
let realMintSnap = null
let realJournalFactory = null
let realWireCreate = null
// Keeper recovery: the mock door's explicit verbs, plus the page's consent.
let journalFactory = null
const newHandCalls = []
const confirmCalls = []
const notices = []
let nerveSink = null
let confirmAnswer = false
let newHandGate = null
let newHandThrow = null
let newHandResult = null
let mintGate = null
let mintThrow = null
globalThis.confirm = (message) => {
    confirmCalls.push(message)
    return confirmAnswer
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function deferred() {
    let resolve, reject
    const promise = new Promise((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve, reject }
}

/** Bounded wait: a fixture that never reaches its ask fails, it does not hang. */
async function until(predicate, what = "condition") {
    for (let i = 0; i < 200; i++) {
        if (predicate()) return
        await tick()
    }
    assert.fail(`timed out waiting for ${what}`)
}

/** Seat raw bytes in =self= (a legacy/keyless genesis, or a restored key). */
async function seedSelf(idb, dbName, key, value) {
    const db = await new Promise((resolve, reject) => {
        const request = idb.open(dbName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    try {
        const tx = db.transaction("self", "readwrite")
        const done = new Promise((resolve, reject) => {
            tx.oncomplete = resolve
            tx.onabort = () => reject(tx.error)
            tx.onerror = () => reject(tx.error)
        })
        const request = tx.objectStore("self").put(value, key)
        await new Promise((resolve, reject) => {
            request.onsuccess = resolve
            request.onerror = () => reject(request.error)
        })
        await done
    } finally {
        db.close()
    }
}

/** Remove one =self= record (losing a signing key). */
async function deleteSelf(idb, dbName, key) {
    const db = await new Promise((resolve, reject) => {
        const request = idb.open(dbName)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
    })
    try {
        const tx = db.transaction("self", "readwrite")
        const done = new Promise((resolve, reject) => {
            tx.oncomplete = resolve
            tx.onabort = () => reject(tx.error)
            tx.onerror = () => reject(tx.error)
        })
        const request = tx.objectStore("self").delete(key)
        await new Promise((resolve, reject) => {
            request.onsuccess = resolve
            request.onerror = () => reject(request.error)
        })
        await done
    } finally {
        db.close()
    }
}

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
        this.real = false
        this.reflectSaw = []
    }
    attachHand() { return noop }
    enableRealScheduler() {
        this.scheduler = buildWorld({ onHandInput: (seat) => this._onHandInput?.(seat) })
        this.real = true
        return this.scheduler
    }
    reflectChanged() { this.reflectSaw.push(true) }
    removeAmbient(key) { if (this.real) this.scheduler.removeChild(key) }
    upsertAmbient(key, displayName, code, options = {}) {
        if (!this.real) return
        const seat = this.scheduler.hotSwapChild(key, fork(key, code), { choices: options.choices })
        drive(this.scheduler)
        return { success: true, commandCount: 1, seat }
    }
    light() {}
    reflectGate() {}
    programFor() { return null }
    handLocalChoices(seat) { return this.real ? this.scheduler.handLocalChoices(seat) : [] }
    ailments() { return [] }
    attentionMoved() {}
    dispose() {}
    async snap() {
        snapCalls.push(true)
        // The cut is lent HERE: claim and body freeze at the ask, never after the wait.
        const lent = this.lendCut?.() ?? null
        const given = snapPath && typeof snapPath.then === "function" ? await snapPath : snapPath
        if (given == null) return lent ? { path: null, body: lent.body, claim: lent.claim } : null
        const shot = typeof given === "object" ? given : { path: given }
        return {
            path: shot.path ?? null,
            body: shot.body ?? lent?.body ?? null,
            claim: shot.claim ?? lent?.claim ?? null,
        }
    }
}

class RecorderStub {}

let useRealPageLaw = false
const mockPageLaw = () => ({
    orderOf: () => [],
    tree: () => [],
    seatOf: (addr) => addr,
    bindingsOf: (addr) => [{ root: "document", slot: addr }],
    choicesOf: () => null,
    slotsAt: () => [],
    attentionAt: () => null,
    hasPage: () => false,
    observe: (addr, { name, doc, attention, choices }) => {
        observeCalls.push({ addr, attention, choices })
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
const pageLaw = () => useRealPageLaw ? realPageLaw() : mockPageLaw()

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
    nerve: () => nerveSink,
    nerveSeat: { get: () => null, watch: stops },
    signals: {
        system: (msg) => ({ msg }),
        shout: (source, msg, payload) => ({ source, msg, payload }),
    },
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
    createJournal: () => (journalFactory
        ? journalFactory()
        : realWire && realJournalFactory ? realJournalFactory() : {
            close: noop,
            root: () => journalGate?.promise ?? Promise.resolve(null),
            local: () => [],
            list: async () => ({}),
            get: async () => journalGet,
            proof: async () => (typeof journalProof === "function" ? journalProof() : journalProof),
            hand: async () => handReading,
            newHand: async (args) => {
                newHandCalls.push(args)
                if (newHandGate) await newHandGate.promise
                if (newHandThrow) throw newHandThrow
                return newHandResult ?? { root: "b".repeat(64), changed: true }
            },
        }),
    createWire: (opts) => (realWire ? realWireCreate(opts) : { say: async () => null, announce: noop, reconnected: noop }),
    mintSnap: async (...args) => {
        if (realMint) return realMintSnap(...args)
        mintSnapCalls.push(args)
        if (mintGate) await mintGate.promise
        if (mintThrow) throw mintThrow
        return "keep-id"
    },
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
    pullWork: async () => null,
    pullLegacy: async () => null,
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
    "/keep/page.js": ["REACH", "PAGE"],
    "/keep/cell.js": ["askKeep", "peerOf", "registerDoor", "registerKeeper", "touched"],
    "/shell/session-name.js": ["sessionName"],
    "/link.js": ["forkRef", "link", "pullKeep", "pullWork", "pullLegacy"],
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
// Real keep modules, imported past the hooks; the page mock must carry PAGE first.
const { PAGE: realPage } = await import("../../../assets/js/keep/page.js?real")
mock.PAGE = realPage
const { createWire: realWireModule } = await import("../../../assets/js/keep/wire.js?real")
realWireCreate = realWireModule
const { createJournal: realJournalDoor } = await import("../../../assets/js/keep/journal.js?real")
const { createEngine } = await import("../../../assets/js/keep/journal.store.js")
const { write: keepWrite, name: keepName, read: keepRead } = await import("../../../assets/js/keep/entry.js")
const { createMemoryIDB } = await import("../keep/idb_memory.mjs")
const { genesisBytes } = await import("../../../assets/js/keep/genesis.js")
const { mintSnap: realMintSnapImport } = await import("../../../assets/js/keep/kinds/snap.js?real")
realMintSnap = realMintSnapImport
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
async function mount({ gate = null, realPage = false } = {}) {
    useRealPageLaw = realPage
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
    handReading = { root: "a".repeat(64), signing: "ready" }
    journalGet = null
    journalProof = null
    newHandCalls.length = 0
    confirmCalls.length = 0
    confirmAnswer = false
    notices.length = 0
    nerveSink = null
    newHandGate = null
    newHandThrow = null
    newHandResult = null
    mintGate = null
    mintThrow = null
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
        createBuffer: () => "fresh-buf",
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
        newHandCalls,
        confirmCalls,
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
    handReading = { root: "a".repeat(64), signing: "ready" }
    journalGet = null
    journalProof = null
    journalFactory = null
    newHandCalls.length = 0
    confirmCalls.length = 0
    confirmAnswer = false
    notices.length = 0
    nerveSink = null
    newHandGate = null
    newHandThrow = null
    newHandResult = null
    mintGate = null
    mintThrow = null
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
        adoptWork: (...args) => adoptedArgs.push(args), forkBuffer: noop, createBuffer: () => "fresh-buf", resumeMerge: noop,
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
    journalFactory = null
    deferPace = false
    failObserve = false
    confirmAnswer = false
    notices.length = 0
    nerveSink = null
    newHandResult = null
    realMint = false
})

const coreClaim = (text = "fw 1", addr = "b1") => ({
    place: "coreshell", addr, name: "one", text, buffer_id: addr,
})

describe("mountInner source claims and commits", () => {
    test("the captured base, buffer and hand root ride into the keep", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        term.currentBaseId = () => "base-A"
        term.currentWorkId = () => null
        term.projecting = () => false
        const adopted = []
        term.adoptBase = (...args) => adopted.push(args)
        snapPath = { path: "picture", body: { source: "fw 1" } }
        assert.equal(await keeper({ title: "branch" }), "keep-id")
        assert.equal(mintSnapCalls[0][0].prev, "base-A")
        assert.equal(mintSnapCalls[0][2].buffer_id, "b1")
        assert.equal(mintSnapCalls[0][2].root, handReading.root,
            "the hand read before the picture authors, not a cached door root")
        assert.deepEqual(adopted, [["keep-id", "b1", "base-A"]])
    })

    test("the live ghost carries the adopted work and exact base after a keep", async () => {
        const { term, fire, hatches } = await mount()
        fire("syncShell")
        term.currentWorkId = () => null
        term.currentBaseId = () => null
        term.projecting = () => false
        term.adoptWork = (id) => { term.currentWorkId = () => id; return id }
        term.adoptBase = (id) => { term.currentBaseId = () => id; return id }
        snapPath = { path: "picture", body: { source: "fw 1" } }
        assert.equal(await keeper({ title: "first" }), "keep-id")
        const last = hatches().at(-1)
        assert.equal(last.work_id, "keep-id")
        assert.equal(last.base_id, "keep-id")
    })

    test("a moved base/buffer during the picture mints nothing", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        let base = "base-A", buffer = "b1", finish
        term.currentBaseId = () => base
        term.currentBufferId = () => buffer
        term.currentWorkId = () => null
        term.projecting = () => false
        const adopted = []
        term.adoptBase = (...args) => adopted.push(args)
        snapPath = new Promise((resolve) => { finish = resolve })
        const pending = keeper({ title: "branch" })
        base = "base-C"
        buffer = "b2"
        finish("picture")
        assert.deepEqual(await pending, { cancelled: true }, "the stale picture is not minted")
        assert.equal(mintSnapCalls.length, 0)
        assert.deepEqual(adopted, [], "no base advance on a page that moved")
    })

    test("an outer-owned snapshot never borrows the unrelated inner editor base", async () => {
        const { term } = await mount()
        term.currentBaseId = () => "unrelated-inner-base"
        const outer = { place: "outershell", addr: "o1", name: "friend", text: "outer", buffer_id: null }
        scene.claim(outer)
        scene.observe("o1", "friend", "outer", outer)
        snapPath = { path: "picture", body: { source: "outer" } }
        assert.equal(await keeper({ title: "outer" }), "keep-id")
        assert.equal(mintSnapCalls[0][0].prev, null)
    })

    test("a newer source claim during the picture mints nothing", async () => {
        const { term, fire, sourceBridge } = await mount()
        fire("syncShell")
        term.currentBaseId = () => "base-A"
        term.projecting = () => false
        const adopted = []
        term.adoptBase = (...args) => adopted.push(args)
        let finish
        snapPath = new Promise((resolve) => { finish = resolve })
        const pending = keeper({ title: "old source" })
        sourceBridge.pub(coreClaim("new source"))
        finish("picture")
        assert.deepEqual(await pending, { cancelled: true }, "the old subject no longer owns the page")
        assert.equal(mintSnapCalls.length, 0, "a stale picture is never authored")
        assert.deepEqual(adopted, [], "newer editing intent retains its base")
    })

    test("readiness commits a dirty core claim with work and exact base", async () => {
        const { term, sourceBridge, fire, hatches } = await mount()
        const claim = coreClaim("fw 9")
        term.currentWorkId = () => "work-A"
        term.currentBaseId = () => "base-A"

        sourceBridge.pub(claim)
        fire("syncShell")

        const last = hatches().at(-1)
        assert.equal(last.source, "fw 9")
        assert.equal(last.buffer_id, "b1")
        assert.equal(last.work_id, "work-A")
        assert.equal(last.base_id, "base-A")
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
        assert.equal(last.work_id, null, "an outer draft borrows no local work")
        assert.equal(last.base_id, null, "an outer draft borrows no local base")
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

    test("a cut body is published; a later diagnostic and a foreign claim are not", async () => {
        const { sourceBridge, fire, flush, hatches } = await mount()
        const claim = coreClaim("fw 1")
        diagnosticsValue = [{ message: "first" }]
        sourceBridge.pub(claim)
        fire("syncShell")
        flush()
        assert.deepEqual(hatches().at(-1).diagnostics, [{ message: "first" }])

        const surfaceTurtle = globalThis.__innerTurtle
        const body = {
            source: "fw 1",
            commands: [],
            diagnostics: [{ message: "frozen", nest: { n: 1 } }],
            attend: null,
            buffer_id: "b1",
        }
        diagnosticsValue = [{ message: "second" }]
        surfaceTurtle.bridge.pub(["hatchTurtle", { body, path: null, claim }])
        flush()
        const published = hatches().at(-1)
        assert.equal(published.diagnostics[0].message, "frozen")
        assert.equal(published.source, "fw 1")

        const before = hatches().length
        surfaceTurtle.bridge.pub(["hatchTurtle", {
            body, path: null, claim: { id: "other" },
        }])
        flush()
        assert.equal(hatches().length, before)
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
        both.setSnapPath({ path: "data:image/png;base64,AAAA", body: { source: "" } })

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

    test("a cut lent to another owner mints nothing even when the page still matches", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        term.currentBaseId = () => "base-A"
        term.projecting = () => false
        // Same page, same source: only the cut's claim belongs to someone else.
        snapPath = {
            path: "picture",
            claim: { place: "coreshell", addr: "b1", name: "one", text: "fw 1", buffer_id: "b1" },
        }
        assert.equal(await keeper({ title: "x" }), null)
        assert.equal(snapCalls.length, 1, "the picture was asked for and refused")
        assert.equal(mintSnapCalls.length, 0, "a foreign cut is never minted")
    })

    test("a cut photographed before a newer source mints nothing", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        term.currentBaseId = () => "base-A"
        term.projecting = () => false
        // The claim is ours; the body is older than the page the keep would bind.
        snapPath = { path: "picture", body: { source: "previous source" } }
        assert.equal(await keeper({ title: "x" }), null)
        assert.equal(mintSnapCalls.length, 0, "a stale cut body is never minted")
    })

})

describe("mountInner keeper identity and origin", () => {
    const originBytes = (root) =>
        keepWrite("snap", { title: "origin" }, { root, ts: { t: 1, n: 0 } })

    test("an unavailable hand refuses without offering a key", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        handReading = { root: null, signing: "unavailable" }
        confirmAnswer = true
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        assert.equal(await keeper({ title: "x" }), null)
        assert.equal(confirmCalls.length, 0, "no keygen offer without a secure context")
        assert.equal(newHandCalls.length, 0)
        assert.equal(made.length, 0)
        assert.equal(snapCalls.length + mintSnapCalls.length, 0)
    })

    test("declining a keyless recovery leaves everything intact", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = false
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        assert.deepEqual(await keeper({ title: "x" }), { cancelled: true })
        assert.equal(confirmCalls.length, 1)
        assert.equal(newHandCalls.length, 0, "no key without consent")
        assert.equal(made.length, 0, "no buffer without consent")
        assert.equal(mintSnapCalls.length, 0)
    })

    test("a keyless hand recovers on consent, prepares a stream, and mints nothing", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        assert.deepEqual(await keeper({ title: "x" }), { prepared: { bufferId: "fresh" } })
        assert.match(confirmCalls[0], /new hand/, "a new hand, not a same-root rotation")
        assert.match(confirmCalls[0], /new work/, "the journal starts a new work")
        assert.doesNotMatch(confirmCalls[0], /new signing key/)
        assert.doesNotMatch(confirmCalls[0], /this page/i)
        assert.deepEqual(newHandCalls, [{ expectedRoot: "a".repeat(64) }])
        assert.deepEqual(made, [["one", "fw 1", null, null, null]],
            "requested source, no lineage, exact base, old buffer intact")
        assert.equal(snapCalls.length, 0, "no picture for a prepared stream")
        assert.equal(mintSnapCalls.length, 0, "recovery never mints")
    })

    test("a key restored during generation keeps the standing stream, no fork", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        newHandResult = { root: "a".repeat(64), changed: false }
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        assert.deepEqual(await keeper({ title: "x" }), { prepared: { bufferId: "b1" } },
            "the prepared target is the standing buffer")
        assert.equal(made.length, 0, "a restored key does not fork a valid stream")
        assert.equal(snapCalls.length + mintSnapCalls.length, 0, "still no auto-mint")
    })

    test("preparation copies the requested reflection, not a live editor draft", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        term.getValue = () => "live draft"
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        assert.deepEqual(await keeper({ title: "x" }), { prepared: { bufferId: "fresh" } })
        assert.deepEqual(made, [["one", "fw 1", null, null, null]],
            "the reflection asked for is copied; getValue only guards the seam")
    })

    test("the requested base rides; an outer source never borrows the inner base", async () => {
        const core = await mount()
        core.fire("syncShell")
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        core.term.currentBaseId = () => "inner-base"
        core.term.projecting = () => false
        const coreMade = []
        core.term.createBuffer = (...args) => { coreMade.push(args); return "fresh" }
        assert.deepEqual(await keeper({ title: "x", prev: "river-base" }),
            { prepared: { bufferId: "fresh" } })
        assert.equal(coreMade[0][4], "river-base", "the request's prev is the ancestry")

        const { term } = await mount()
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        term.currentBaseId = () => "inner-base"
        term.projecting = () => false
        const outer = { place: "outershell", addr: "o1", name: "friend", text: "outer", buffer_id: null }
        scene.claim(outer)
        scene.observe("o1", "friend", "outer", outer)
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        assert.deepEqual(await keeper({ title: "x" }), { prepared: { bufferId: "fresh" } })
        assert.deepEqual(made, [["one", "outer", null, null, null]],
            "no core ancestry for an outer source")
    })

    test("a keyless no-hand recovery uses the explicit null expected root", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        handReading = { root: null, signing: "none" }
        confirmAnswer = true
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        assert.deepEqual(await keeper({ title: "x" }), { prepared: { bufferId: "fresh" } })
        assert.deepEqual(newHandCalls, [{ expectedRoot: null }])
        assert.deepEqual(made, [["one", "fw 1", null, null, null]])
        assert.equal(mintSnapCalls.length, 0)
    })

    test("a stale-hand refusal prepares nothing and asks for a retry", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        const stale = new Error("keep: stale hand")
        stale.code = "stale-hand"
        newHandThrow = stale
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        assert.equal(await keeper({ title: "x" }), null)
        assert.equal(made.length, 0, "no new stream on a stale seat")
        assert.equal(mintSnapCalls.length, 0)
    })

    test("a delayed hand cannot recover a page that moved under it", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        const gate = deferred()
        handReading = gate.promise
        const pending = keeper({ title: "x" })
        await tick()
        term.currentBufferId = () => "b2"
        gate.resolve({ root: "a".repeat(64), signing: "keyless" })
        assert.deepEqual(await pending, { cancelled: true }, "an unanswered hand cannot recover a moved page")
        assert.equal(confirmCalls.length, 0)
        assert.equal(newHandCalls.length, 0)
    })

    test("a delayed newHand cannot steal focus from a newer subject", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        newHandGate = deferred()
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        const pending = keeper({ title: "x" })
        await until(() => newHandCalls.length > 0, "the hand read")
        term.currentBufferId = () => "b2"
        newHandGate.resolve()
        assert.deepEqual(await pending, { cancelled: true }, "a fresh key does not force a new tab")
        assert.equal(made.length, 0, "a fresh key does not force a new tab")
    })

    test("missing proof is unproven, not an error: consent gates the fresh stream", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        journalGet = originBytes("a".repeat(64))
        const work = keepName(journalGet)
        term.currentWorkId = () => work
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        journalProof = () => { throw new Error("keep: no retained proof") }
        confirmAnswer = false
        assert.deepEqual(await keeper({ title: "x" }), { cancelled: true })
        assert.equal(made.length, 0, "no silent fork")
        assert.equal(mintSnapCalls.length, 0)
        confirmAnswer = true
        assert.deepEqual(await keeper({ title: "x" }), { prepared: { bufferId: "fresh" } })
        assert.equal(made.length, 1, "explicit consent prepares the stream")
        assert.equal(mintSnapCalls.length, 0)
    })

    test("a delayed origin read cannot fork after the page moved", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        journalGet = originBytes("a".repeat(64))
        const work = keepName(journalGet)
        term.currentWorkId = () => work
        const gate = deferred()
        journalGet = gate.promise
        confirmAnswer = true
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        const pending = keeper({ title: "x" })
        await tick()
        term.currentBufferId = () => "b2"
        gate.resolve(originBytes("a".repeat(64)))
        assert.deepEqual(await pending, { cancelled: true }, "an unanswered origin cannot fork a moved page")
        assert.equal(made.length, 0)
        assert.equal(mintSnapCalls.length, 0)
    })

    test("a delayed proof cannot fork after the page moved", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        journalGet = originBytes("a".repeat(64))
        const work = keepName(journalGet)
        term.currentWorkId = () => work
        const gate = deferred()
        journalProof = gate.promise
        confirmAnswer = true
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        const pending = keeper({ title: "x" })
        await tick()
        term.currentBufferId = () => "b2"
        gate.resolve({ v: 1, genesis: "a".repeat(64), signature: "ab".repeat(64) })
        assert.deepEqual(await pending, { cancelled: true }, "an unanswered proof cannot fork a moved page")
        assert.equal(made.length, 0)
        assert.equal(mintSnapCalls.length, 0)
    })

    test("a rejected hand read on a moved page publishes nothing", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        nerveSink = { push: (n) => notices.push(n) }
        const gate = deferred()
        handReading = gate.promise
        const pending = keeper({ title: "x" })
        await tick()
        term.currentBufferId = () => "b2"
        gate.reject(new Error("worker gone"))
        assert.deepEqual(await pending, { cancelled: true })
        assert.deepEqual(notices, [], "an expired subject does not hear the old failure")
    })

    test("a rejected hand read on the same page speaks once", async () => {
        const { fire } = await mount()
        fire("syncShell")
        nerveSink = { push: (n) => notices.push(n) }
        handReading = Promise.reject(new Error("worker gone"))
        assert.equal(await keeper({ title: "x" }), null)
        assert.equal(notices.length, 1)
        assert.match(notices[0].msg, /journal did not answer/)
    })

    test("a rejected newHand on a moved page publishes nothing", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        nerveSink = { push: (n) => notices.push(n) }
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        newHandGate = deferred()
        const pending = keeper({ title: "x" })
        await until(() => newHandCalls.length > 0, "the hand read")
        term.currentBufferId = () => "b2"
        newHandThrow = new Error("generation failed")
        newHandGate.resolve()
        assert.deepEqual(await pending, { cancelled: true })
        assert.deepEqual(notices, [])
    })

    test("a rejected newHand on the same page speaks once", async () => {
        const { fire } = await mount()
        fire("syncShell")
        nerveSink = { push: (n) => notices.push(n) }
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        newHandThrow = new Error("generation failed")
        assert.equal(await keeper({ title: "x" }), null)
        assert.equal(notices.length, 1)
        assert.match(notices[0].msg, /could not create a new hand/)
    })

    test("a rejected put on a moved page publishes nothing and adopts nothing", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        adoptedArgs.length = 0
        nerveSink = { push: (n) => notices.push(n) }
        mintGate = deferred()
        const stale = new Error("keep: stale hand; no bytes were written")
        stale.code = "stale-hand"
        mintThrow = stale
        const pending = keeper({ title: "x" })
        await until(() => mintSnapCalls.length > 0, "the keep to reach its put")
        term.currentBufferId = () => "b2"
        mintGate.resolve()
        assert.equal(await pending, null)
        assert.deepEqual(notices, [], "an issued failure on an expired subject is silent")
        assert.equal(adoptedArgs.filter(([id]) => id === "keep-id").length, 0)
    })

    test("a closed mount's late rejection stays silent", async () => {
        const { hook, fire } = await mount()
        fire("syncShell")
        nerveSink = { push: (n) => notices.push(n) }
        const gate = deferred()
        handReading = gate.promise
        const pending = keeper({ title: "x" })
        await tick()
        hook.destroyed()
        gate.reject(new Error("worker gone"))
        assert.deepEqual(await pending, { cancelled: true })
        assert.deepEqual(notices, [])
    })

    test("a remount shares the nerve seat; the old rejection stays silent", async () => {
        const first = await mount()
        first.fire("syncShell")
        const gate = deferred()
        handReading = gate.promise
        const pending = keeper({ title: "x" })
        await tick()
        first.hook.destroyed()

        await mount()   // resets the module sink, as a new mount would
        nerveSink = { push: (n) => notices.push(n) }
        gate.reject(new Error("worker gone"))
        assert.deepEqual(await pending, { cancelled: true })
        assert.deepEqual(notices, [], "the old request cannot write the new seat")
    })

    test("preparation guidance targets only the fresh selection", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        nerveSink = { push: (n) => notices.push(n) }
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        assert.deepEqual(await keeper({ title: "x" }), { prepared: { bufferId: "fresh" } })
        assert.equal(made.length, 1)
        assert.deepEqual(notices, [], "no guidance when the page did not move to the fresh buffer")

        const { term: term2, fire: fire2 } = await mount()
        fire2("syncShell")
        nerveSink = { push: (n) => notices.push(n) }
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        term2.createBuffer = (...args) => {
            made.push(args)
            term2.currentBufferId = () => "fresh"
            return "fresh"
        }
        assert.deepEqual(await keeper({ title: "x" }), { prepared: { bufferId: "fresh" } })
        assert.equal(notices.length, 1)
        assert.match(notices[0].msg, /new hand ready/)
    })

    test("a restored hand guidance stays on its standing buffer", async () => {
        const { fire } = await mount()
        fire("syncShell")
        nerveSink = { push: (n) => notices.push(n) }
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        newHandResult = { root: "a".repeat(64), changed: false }
        assert.deepEqual(await keeper({ title: "x" }), { prepared: { bufferId: "b1" } })
        assert.equal(notices.length, 1)
        assert.match(notices[0].msg, /hand available again/)
    })

    test("an unproven origin forks a fresh null-work buffer only on consent", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        journalGet = originBytes("a".repeat(64))
        const work = keepName(journalGet)
        term.currentWorkId = () => work
        term.getBufferInfo = () => ({ name: "one" })
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        journalProof = null
        assert.deepEqual(await keeper({ title: "x" }), { cancelled: true })
        assert.match(confirmCalls[0], /continue the old work/,
            "availability language, not an inference about someone's key")
        assert.doesNotMatch(confirmCalls[0], /another signing key/)
        assert.equal(made.length, 0, "silence is not consent")
        confirmAnswer = true
        assert.deepEqual(await keeper({ title: "x" }), { prepared: { bufferId: "fresh" } })
        assert.equal(mintSnapCalls.length, 0, "no child of an unproven origin is signed")
        assert.deepEqual(made, [["one", "fw 1", null, null, null]])
    })

    test("an evidenced same-root origin keeps its work target and hand root", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        journalGet = originBytes("a".repeat(64))
        const work = keepName(journalGet)
        term.currentWorkId = () => work
        journalProof = { v: 1, genesis: "c".repeat(64), signature: "ab".repeat(64) }
        assert.equal(await keeper({ title: "x" }), "keep-id")
        assert.equal(mintSnapCalls[0][2].work_id, work)
        assert.equal(mintSnapCalls[0][2].root, handReading.root)
        assert.equal(confirmCalls.length, 0, "evidence needs no confirmation")
    })

    test("the prepared stream mints under the new hand on a second Keep", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        handReading = { root: "a".repeat(64), signing: "keyless" }
        confirmAnswer = true
        const made = []
        term.createBuffer = (...args) => { made.push(args); return "fresh" }
        assert.deepEqual(await keeper({ title: "first" }), { prepared: { bufferId: "fresh" } })
        assert.equal(made.length, 1)

        // The fresh null-work stream is now the page; recovery made it ready.
        term.currentBufferId = () => "fresh"
        term.currentWorkId = () => null
        term.getBufferInfo = () => ({ name: "one", content: "fw 1", origin: null })
        handReading = { root: "b".repeat(64), signing: "ready" }
        confirmCalls.length = 0
        assert.equal(await keeper({ title: "second" }), "keep-id")
        assert.equal(mintSnapCalls[0][2].work_id, null, "a new stream starts a new work")
        assert.equal(mintSnapCalls[0][2].buffer_id, "fresh")
        assert.equal(mintSnapCalls[0][2].root, "b".repeat(64))
        assert.equal(adoptedArgs.at(-1)[1], "fresh")
        assert.equal(confirmCalls.length, 0, "a ready second Keep needs no consent")
    })

    test("a stale hand during the put mints nothing and never retries", async () => {
        const { term, fire } = await mount()
        fire("syncShell")
        adoptedArgs.length = 0
        const stale = new Error("keep: stale hand; no bytes were written")
        stale.code = "stale-hand"
        mintThrow = stale
        assert.equal(await keeper({ title: "x" }), null)
        assert.equal(mintSnapCalls.length, 1)
        assert.equal(adoptedArgs.filter(([id]) => id === "keep-id").length, 0,
            "no adopt on stale-hand")
    })

    test("a delayed put adopts only its captured buffer, never a newer base", async () => {
        const { term, fire, sourceBridge } = await mount()
        fire("syncShell")
        adoptedArgs.length = 0
        term.currentBaseId = () => "base-A"
        term.projecting = () => false
        const bases = []
        term.adoptBase = (...args) => bases.push(args)
        mintGate = deferred()
        const pending = keeper({ title: "x" })
        await until(() => mintSnapCalls.length > 0, "the keep to reach its put")
        sourceBridge.pub(coreClaim("new source"))
        mintGate.resolve()
        assert.equal(await pending, "keep-id")
        assert.deepEqual(adoptedArgs, [["keep-id", "b1", null]],
            "the keep binds the buffer it photographed")
        assert.deepEqual(bases, [], "a newer claim keeps its base")
    })
})

describe("mountInner keeper recovery (real door + engine)", () => {
    test("a keyless tab creates a hand and prepares a stream only on confirm", async () => {
        const { idb, KeyRange } = createMemoryIDB()
        const engine = createEngine({ idb, KeyRange, dbName: "mount-recover" })
        try {
            await engine.genesis()
            const birth = genesisBytes((bytes) => bytes.fill(9), { t: 1, n: 0 })
            await seedSelf(idb, "mount-recover", "genesis", birth)
            const oldRoot = keepName(birth)
            journalFactory = () => realJournalDoor({ engine })

            const { term, fire } = await mount()
            fire("syncShell")
            assert.deepEqual(await engine.hand(), { root: oldRoot, signing: "keyless" })

            confirmAnswer = true
            const made = []
            term.createBuffer = (...args) => { made.push(args); return "fresh" }
            assert.deepEqual(await keeper({ title: "x" }), { prepared: { bufferId: "fresh" } })
            assert.equal(mintSnapCalls.length, 0, "recovery never mints")
            assert.equal(made.length, 1, "one fresh null-work stream")
            assert.deepEqual(made[0].slice(2), [null, null, null])

            const hand = await engine.hand()
            assert.equal(hand.signing, "ready")
            assert.notEqual(hand.root, oldRoot)
            assert.equal(await engine.get(oldRoot), birth, "the old public genesis survives")
        } finally {
            journalFactory = null
            await engine.close()
        }
    })
})

describe("mountInner keep composition (real keeper → mint → wire → engine)", () => {
    const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

    test("keyless prepare, then a second Keep signs a new-root origin and ships its exact proof", async () => {
        const { idb, KeyRange } = createMemoryIDB()
        const engine = createEngine({ idb, KeyRange, dbName: "mount-compose" })
        try {
            const birth = await engine.genesis()
            const R1 = keepName(birth)
            const baseBytes = keepWrite("snap", { source_id: keepName("fw 1"), title: "old base" },
                { root: R1, ts: { t: 1, n: 0 } })
            const baseId = keepName(baseBytes)
            await engine.put(baseBytes, { source: "fw 1", image: new Blob([new Uint8Array([7])]), authored: true })
            const baseProof = await engine.proof(baseBytes)
            await deleteSelf(idb, "mount-compose", "signing-key")
            assert.equal((await engine.hand()).signing, "keyless")

            realWire = true
            realMint = true
            realJournalFactory = () => realJournalDoor({ engine })
            const { hook, term, fire } = await mount()
            // No socket at birth: the old-root row stays unanswered and local.
            term.currentBaseId = () => baseId
            term.projecting = () => false
            fire("syncShell")
            assert.equal((await engine.local(R1, 10, { proved: true })).length, 1)

            // First Keep: explicit recovery prepares; it authors no moment.
            confirmAnswer = true
            const made = []
            term.createBuffer = (...args) => { made.push(args); return "fresh" }
            assert.deepEqual(await keeper({ title: "a title" }), { prepared: { bufferId: "fresh" } })
            assert.deepEqual(made, [["one", "fw 1", null, null, baseId]])
            const R2 = (await engine.hand()).root
            assert.notEqual(R2, R1)
            assert.equal((await engine.local(R2, 10, { proved: true })).length, 0,
                "preparation authors nothing")
            assert.equal((await engine.local(R1, 10, { proved: true })).length, 1,
                "the old row is untouched")

            // The prepared null-work stream is now the page; second explicit Keep.
            term.currentBufferId = () => "fresh"
            term.currentWorkId = () => null
            term.getBufferInfo = () => ({ name: "one", content: "fw 1", origin: null })
            snapPath = { path: PNG_1PX, body: { source: "fw 1", commands: [], diagnostics: [], attend: null, buffer_id: "fresh" } }
            hook.pushEvent = (name, payload) => {
                pushes.push([name, payload])
                return Promise.resolve({ id: payload.id, at: 9, node: "room" })
            }
            const id = await keeper({ title: "new work" })
            assert.equal(typeof id, "string")

            const bytes = await engine.get(id)
            const value = keepRead(bytes)
            assert.equal(value.root, R2, "authored under the new hand")
            assert.equal(value.target, undefined, "a new origin keep")
            assert.equal(value.prev, baseId, "the old retained base rides as prev")
            assert.equal(value.title, "new work")
            assert.equal(await engine.source(keepName("fw 1")), "fw 1")
            assert.ok(await engine.proof(bytes), "real proof retained")

            for (let i = 0; i < 8; i++) await tick()
            const shipped = pushes.filter(([name]) => name === "keep")
            const own = shipped.filter(([, payload]) => payload.id === id)
            const old = shipped.filter(([, payload]) => payload.id === baseId)
            assert.equal(shipped.length, 2, "new row + old-root pending row ship")
            assert.equal(own.length, 1)
            assert.equal(own[0][1].message, bytes)
            assert.deepEqual(own[0][1].proof, await engine.proof(bytes),
                "the exact stored proof, not a re-signing")
            assert.equal((await engine.local(R2, 10)).length, 0, "the answer settles the row")

            // The old hand's pending row is ours; M3 ships it with its retained proof.
            assert.equal(await engine.get(baseId), baseBytes)
            assert.deepEqual(await engine.proof(baseBytes), baseProof)
            assert.equal(old.length, 1)
            assert.equal(old[0][1].message, baseBytes)
            assert.deepEqual(old[0][1].proof, baseProof)
            assert.equal(await engine.get(R1), birth, "the old genesis is archived")
            assert.equal((await engine.local(R1, 10, { proved: true })).length, 0)
        } finally {
            realWire = false
            realMint = false
            realJournalFactory = null
            await engine.close()
        }
    })
})

describe("mountInner keep wire (real createWire + real journal)", () => {
    test("the mounted wire ships a signed local row with its proof", async () => {
        const { idb, KeyRange } = createMemoryIDB()
        const engine = createEngine({ idb, KeyRange, dbName: "mount-keep-wire" })
        const src = "fw 1"
        const root = keepName(await engine.genesis())
        const keep = keepWrite("snap", { source_id: keepName(src), title: "one" }, { root, ts: { t: 1, n: 0 } })
        await engine.put(keep, { source: src, image: new Blob([new Uint8Array([9, 9, 9])]), authored: true })
        const retainedProof = await engine.proof(keep)

        realWire = true
        realJournalFactory = () => realJournalDoor({ engine })
        try {
            const { hook, fire } = await mount()
            hook.pushEvent = (name, payload) => {
                pushes.push([name, payload])
                return Promise.resolve({ id: payload.id, at: 9, node: "room" })
            }
            fire("syncShell")
            await tick()
            assert.equal(await keeper({ title: "one" }), "keep-id")
            for (let i = 0; i < 8; i++) await tick()

            const shipped = pushes.filter(([name]) => name === "keep")
            assert.equal(shipped.length, 1, "one signed local row ships once")
            const payload = shipped[0][1]
            assert.equal(payload.message, keep)
            assert.deepEqual(payload.proof, retainedProof, "the exact retained proof, not a re-signing")
            assert.equal((await engine.local(root, 10)).length, 0, "the answer settles the row")

            // No unsigned fallback: a proof-less local row ships nothing and stays local.
            const unsigned = keepWrite("snap", { source_id: keepName(src), title: "unsigned" },
                { root, target: keepName(keep), ts: { t: 2, n: 0 } })
            await engine.put(unsigned)
            await keeper({ title: "one" })
            for (let i = 0; i < 4; i++) await tick()
            assert.equal(pushes.filter(([name]) => name === "keep").length, 1,
                "an unsigned row must not ship after the signed one")
            assert.equal((await engine.local(root, 10)).length, 1, "the unsigned row stays local")
        } finally {
            realWire = false
            realJournalFactory = null
            await engine.close()
        }
    })

    test("an unproven prefix cannot hide the signed row through the mount", async () => {
        const { idb, KeyRange } = createMemoryIDB()
        const engine = createEngine({ idb, KeyRange, dbName: "mount-keep-prefix" })
        const src = "fw 1"
        const root = keepName(await engine.genesis())
        const row = (t, title) => keepWrite("snap", { source_id: keepName(src), title },
            { root, target: "b".repeat(64), ts: { t, n: 0 } })
        for (let i = 0; i < realPage + 1; i++) await engine.put(row(2000 + i, `g${i}`))
        const signed = row(1, "signed oldest")
        await engine.put(signed, { authored: true })

        realWire = true
        realJournalFactory = () => realJournalDoor({ engine })
        try {
            const { hook, fire } = await mount()
            hook.pushEvent = (name, payload) => {
                pushes.push([name, payload])
                return Promise.resolve({ id: payload.id, at: 9, node: "room" })
            }
            fire("syncShell")
            await tick()
            assert.equal(await keeper({ title: "one" }), "keep-id")
            for (let i = 0; i < 8; i++) await tick()

            const shipped = pushes.filter(([name]) => name === "keep")
            assert.equal(shipped.length, 1, "the signed row behind the prefix ships")
            assert.equal(shipped[0][1].message, signed)
            assert.equal((await engine.local(root, 100)).length, realPage + 1,
                "unproven rows stay local facts")
        } finally {
            realWire = false
            realJournalFactory = null
            await engine.close()
        }
    })

describe("mountInner choices — the buffer origin carries the offered value", () => {
    test("a source-baseline edit in an imported buffer keeps the same choices", async () => {
        const { term, sourceBridge, bridge, flush } = await mount()
        const choices = {
            v: 1,
            inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 3, 0] } }],
        }
        term.getBufferInfo = () => ({ name: "one", content: "fw 1", origin: { choices } })
        const first = { place: "coreshell", addr: "b1", name: "one", text: "fw 1", buffer_id: "b1" }
        sourceBridge.pub(first)
        bridge.pub({ id: "b1", name: "one", content: "fw 1", claim: first })
        await tick()
        flush()
        await tick()
        assert.deepEqual(observeCalls.at(-1).choices, choices)

        const edited = { ...first, text: "fw 2" }
        sourceBridge.pub(edited)
        bridge.pub({ id: "b1", name: "one", content: "fw 2", claim: edited })
        await tick()
        flush()
        await tick()
        assert.deepEqual(observeCalls.at(-1).choices, choices,
            "editing only the source baseline does not drop the imported choice")
    })
})
})

describe("mountInner real page + scheduler lender seam", () => {
    test("actual lendCut carries source + nonempty plain choices and is a copy", async () => {
        const { term, sourceBridge, bridge, flush } = await mount({ realPage: true })
        const turtle = globalThis.__innerTurtle
        const s = turtle.enableRealScheduler()
        const src = "goto 5 0\nlet p"
        const claim = { place: "coreshell", addr: "b1", name: "one", text: src, buffer_id: "b1" }
        term.getBufferInfo = () => ({ name: "one", content: src, origin: { choices: null } })
        sourceBridge.pub(claim)
        bridge.pub({ id: "b1", name: "one", content: src, claim })
        await tick(); flush(); await tick()

        const seat = s.root.children.get("coreshell:b1")
        assert.ok(seat, "the production perform seated the authored source")
        const p = seat.children.get("p")
        assert.equal(s.requestMotion(p, { ...p.transform.deref(), position: [0, 3, 0] }, s.motionRevision).kind, "accept")
        assert.equal(turtle.reflectSaw.length, 1, "the real onHandInput reached the authored binding")

        const lent = turtle.lendCut()
        assert.ok(lent)
        assert.equal(lent.claim, claim, "the cut claim is the authored claim")
        assert.equal(lent.body.source, src)
        assert.deepEqual(lent.body.choices, {
            v: 1,
            inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 3, 0] } }],
        })

        turtle.reflectSaw.length = 0
        turtle._onHandInput("foreign:seat")
        assert.equal(turtle.reflectSaw.length, 0, "a foreign seat never opens self's gate")
        turtle._onHandInput("coreshell:b1")
        assert.equal(turtle.reflectSaw.length, 1, "the authored seat does")

        const frozen = structuredClone(lent.body.choices)
        s.offerChoices(seat, {
            v: 1,
            inputs: [{ route: { root: "document", names: ["p"] }, action: { kind: "translation", by: [0, 6, 0] } }],
        })
        assert.deepEqual(lent.body.choices, frozen, "the lent cut is a copy, not a live map")
    })

    test("actual lendCut carries a cell-root choice with its identity", async () => {
        const src = "###\n```\ngoto 5 0\nlet p\n```\n###"
        const id = cellIdentities(phaseCells(parseProgram(src)))[0].id
        const { term, sourceBridge, bridge, flush } = await mount({ realPage: true })
        const turtle = globalThis.__innerTurtle
        const s = turtle.enableRealScheduler()
        const claim = { place: "coreshell", addr: "b2", name: "cell", text: src, buffer_id: "b2" }
        term.getBufferInfo = () => ({ name: "cell", content: src, origin: { choices: null } })
        sourceBridge.pub(claim)
        bridge.pub({ id: "b2", name: "cell", content: src, claim })
        await tick(); flush(); await tick()

        const seat = s.root.children.get(`coreshell:b2#${id}`)
        assert.ok(seat, "the cell run seated")
        const p = seat.children.get("p")
        assert.equal(s.requestMotion(p, { ...p.transform.deref(), position: [0, 3, 0] }, s.motionRevision).kind, "accept")

        const lent = turtle.lendCut()
        assert.equal(lent.body.source, src)
        assert.deepEqual(lent.body.choices, {
            v: 1,
            inputs: [{ route: { root: { cell: id }, names: ["p"] }, action: { kind: "translation", by: [0, 3, 0] } }],
        })
    })
})
