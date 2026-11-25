// The buffer owns the head. River must not restore or rewrite it from the
// legacy cache. Handlers + real Terminal setValue/dispatch. Crash durability
// is not claimed: collection flush stays on its own quiet path.

import { test, afterEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createContext, runInContext } from "node:vm"
import { Terminal } from "../../../assets/js/terminal.js"
import { write, name, read } from "../../../assets/js/keep/entry.js"
import { PRESENT, DRAFT } from "../../../assets/js/river/mode.js"
import { clear as clearKeeps } from "../../../assets/js/river/keeps.js"
import { readDraft, readHead, writeDraft, writeHead } from "../../../assets/js/river/memory.js"

const store = new Map()
const live = []
let workSeq = 0
globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
}
const makeEl = () => {
    const el = {
        style: {}, dataset: {}, innerHTML: "", textContent: "", id: "",
        cloneNode: () => makeEl(),
        querySelector: () => makeEl(),
        querySelectorAll: () => [],
        appendChild: () => {}, insertBefore: () => {}, removeChild: () => {}, remove: () => {},
        classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
        addEventListener() {}, removeEventListener() {},
        setAttribute() {}, getAttribute: () => null,
        scrollTo() {}, scrollIntoView() {}, click() {},
    }
    return el
}
globalThis.document = {
    createElement: () => makeEl(),
    getElementById: () => makeEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    body: makeEl(),
    documentElement: { ...makeEl(), getAttribute: () => null },
    addEventListener() {}, removeEventListener() {},
    visibilityState: "visible",
}
globalThis.window = { addEventListener() {}, removeEventListener() {} }

afterEach(() => {
    for (const term of live.splice(0)) term.destroy()
    store.clear()
})

function makeMockCm6() {
    const makeState = (doc = "") => ({
        doc: {
            toString: () => doc, length: doc.length,
            lines: doc.split("\n").length,
            lineAt: () => ({ from: 0, to: doc.length, text: doc, number: 1 }),
            line: (n) => ({ from: 0, to: doc.length, text: doc, number: n }),
        },
        selection: { main: { from: 0, to: 0, head: 0, anchor: 0 }, ranges: [{ from: 0, to: 0 }] },
        sliceDoc: (from, to) => doc.slice(from, to),
    })
    const EditorState = { create: ({ doc = "" } = {}) => makeState(doc) }
    const listeners = []
    class View {
        static updateListener = { of: (fn) => { listeners.push(fn); return [] } }
        static contentAttributes = { of: () => [] }
        static lineWrapping = []
        static scrollIntoView = () => []
        static scrollMargins = { of: () => [] }
        static domEventHandlers = () => []
        static theme = () => []
        static decorations = { from: () => [] }
        constructor({ state } = {}) { this._state = state || EditorState.create({}) }
        get state() { return this._state }
        dispatch(tr = {}) {
            const { changes, selection } = tr
            if (changes) {
                const ch = Array.isArray(changes) ? changes[0] : changes
                const old = this._state.doc.toString()
                const from = ch.from ?? 0
                const to = ch.to ?? old.length
                this._state = EditorState.create({ doc: old.slice(0, from) + (ch.insert ?? "") + old.slice(to) })
            }
            if (selection) this._state = { ...this._state, selection }
            const update = { docChanged: !!changes, selectionSet: !!selection, state: this._state, view: this }
            for (const fn of listeners) fn(update)
        }
        setState(state) { this._state = state }
        get hasFocus() { return false }
        focus() {}
        destroy() {}
        get dom() { return { addEventListener() {}, removeEventListener() {} } }
    }
    const Compartment = class { of(v) { return { _value: v } } reconfigure(v) { return { _type: "reconfigure", _value: v } } }
    return {
        EditorView: View, EditorState, EditorSelection: { cursor: () => ({}), range: () => ({}) },
        Compartment, history: () => [], defaultKeymap: [], historyKeymap: [], indentWithTab: {},
        indentOnInput: () => [], keymap: { of: (k) => k }, lineNumbers: () => [], highlightActiveLine: () => [],
        bracketMatching: () => [], foldGutter: () => [], gutter: () => [], syntaxHighlighting: () => [],
        defaultHighlightStyle: [], HighlightStyle: { define: () => [] },
        tags: new Proxy({}, { get: (_t, k) => () => k }),
        Decoration: { mark: () => ({}), line: () => ({ range: () => ({}) }), none: [] },
        ViewPlugin: { fromClass: () => [] }, RangeSetBuilder: class { add() {} finish() { return [] } },
        StateField: { define: () => [] }, StateEffect: { define: () => ({ of: (v) => ({ value: v }) }) },
        hoverTooltip: () => [], autocompletion: () => [], lintGutter: () => [],
        setDiagnostics: () => ({ effects: [] }), MergeView: class {}, unifiedMergeView: () => [],
        Text: { of: (lines) => ({ toString: () => lines.join("\n") }) },
        StreamLanguage: { define: () => [] }, foldService: { of: () => [] }, undo() {}, redo() {},
    }
}

const river = readFileSync(new URL("../../../assets/js/hooks/shell/river.js", import.meta.url), "utf8")
function grab(start, end) {
    const s = river.indexOf(start)
    const e = river.indexOf(end, s + start.length)
    if (s < 0 || e < 0) throw new Error(`slice ${start} → ${end}`)
    return river.slice(s, e)
}
const handlers = [
    grab("    function setDraft(next) {", "\n    // ── refold"),
    grab("    function reseat() {", "    /** The door's page"),
    grab("    function onCenter(where) {", "    function onSettle(where) {"),
    grab("    function onSettle(where) {", "    /** setValue:"),
    grab("    function hold(text, project, base_id = null) {", "    /** Editor holds"),
    grab("    function projectStanding() {", "    /** Fill source"),
    grab("    async function stand(id) {", "    function seatFor(id) {"),
    grab("    function drift() {", "    // ── the gesture"),
].join("\n")

const KEEP = "kept-source"
const bytes = write("snap", { source_id: name(KEEP), title: "old" }, { root: "a".repeat(64), ts: { t: 1, n: 0 } })
const keepId = name(bytes)

function deferred() {
    let resolve, reject
    const promise = new Promise((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve, reject }
}

function tick() {
    return new Promise((r) => setTimeout(r, 0))
}

function boot(head) {
    const work = `head-owner-${++workSeq}`
    store.delete("@paperlands.buffers@inner")
    const el = makeEl()
    el.parentNode = { insertBefore() {} }
    const term = new Terminal(el, makeMockCm6())
    live.push(term)
    term.inner()
    term.setValue(head)
    term.adoptWork(work, term.currentBufferId(), null)
    let pins = 0
    const pin = term.pinHead.bind(term)
    term.pinHead = (...args) => { pins += 1; return pin(...args) }
    const writes = []
    const realSet = term.setValue.bind(term)
    term.setValue = (...args) => { writes.push(args); return realSet(...args) }
    return { term, pins: () => pins, writes, work }
}

function seat({ term, source, headContent, loaded = false, work }) {
    const shell = headContent
        ? new Proxy(term, { get(t, k) {
            if (k === "headContent") return headContent
            const v = t[k]
            return typeof v === "function" ? v.bind(t) : v
        } })
        : term
    const ctx = createContext({
        PRESENT, DRAFT, read, name, clearKeeps, readDraft, writeDraft,
        term: { get: () => shell },
        root: { dataset: {} },
        say() {}, openFace() {}, refold() {}, faceOf: () => null,
        emptyView: () => ({}),
        getDoor: () => ({ source }),
        pullKeep: async () => null,
        keeps: new Map([[keepId, { bytes, source: loaded ? KEEP : null }]]),
        arena: { alive: true },
        work,
        peer: null,
        focus: "core",
        lanes: { core: new Set(), peer: new Set() },
        setFocus() {},
        at: { key: PRESENT, id: null },
        draft: null,
        lineHead: null,
        view: {},
    })
    runInContext(handlers + "\nthis.api = { onSettle, drift, reseat, stand }", ctx)
    term.bridge.sub(() => {
        if ((term.currentWorkId() ?? null) !== ctx.work) return
        ctx.api.drift()
    })
    return ctx
}

function typeNative(term, extra) {
    const doc = term.getValue()
    term.shell.dispatch({ changes: { from: doc.length, to: doc.length, insert: extra } })
}

test("a delayed source cannot restore a stale cache over keystrokes", async () => {
    const { term, pins, work } = boot("AAA")
    writeHead(work, "legacy-gap")
    const gate = deferred()
    const ctx = seat({ term, work, source: () => gate.promise })
    const pending = ctx.api.onSettle({ key: keepId, id: keepId })
    assert.equal(term.projecting(), false, "stand is still waiting")
    typeNative(term, "B")
    assert.equal(term.headContent(), "AAAB")
    gate.resolve(KEEP)
    await pending
    await tick()
    ctx.api.onSettle({ key: PRESENT, id: null })
    assert.equal(term.headContent(), "AAAB")
    assert.equal(term.getValue(), "AAAB")
    assert.equal(term.projecting(), false)
    assert.equal(pins(), 0)
    assert.equal(readHead(work), "legacy-gap")
})

test("a return to present before the source resolves keeps the typed head", async () => {
    const { term, pins, work } = boot("AAA")
    writeHead(work, "legacy-early-return")
    const gate = deferred()
    const ctx = seat({ term, work, source: () => gate.promise })
    const pending = ctx.api.onSettle({ key: keepId, id: keepId })
    typeNative(term, "B")
    ctx.api.onSettle({ key: PRESENT, id: null })
    assert.equal(term.headContent(), "AAAB")
    assert.equal(term.projecting(), false)
    gate.resolve(KEEP)
    await pending
    await tick()
    assert.equal(term.headContent(), "AAAB")
    assert.equal(term.getValue(), "AAAB")
    assert.equal(term.projecting(), false)
    assert.equal(pins(), 0)
    assert.equal(readHead(work), "legacy-early-return")
})

test("warm and cold clicks without typing leave the owned head", async () => {
    const warm = boot("AAA")
    writeHead(warm.work, "legacy-warm")
    const warmCtx = seat({ term: warm.term, work: warm.work, source: async () => KEEP, loaded: true })
    warmCtx.api.onSettle({ key: keepId, id: keepId })
    await tick()
    assert.equal(warm.term.getValue(), KEEP)
    assert.equal(warm.term.headContent(), "AAA")
    warmCtx.api.onSettle({ key: PRESENT, id: null })
    assert.equal(warm.term.headContent(), "AAA")
    assert.equal(warm.term.getValue(), "AAA")
    assert.equal(readHead(warm.work), "legacy-warm")

    const cold = boot("AAA")
    writeHead(cold.work, "legacy-cold")
    const gate = deferred()
    const coldCtx = seat({ term: cold.term, work: cold.work, source: () => gate.promise })
    const pending = coldCtx.api.onSettle({ key: keepId, id: keepId })
    gate.resolve(KEEP)
    await pending
    await tick()
    coldCtx.api.onSettle({ key: PRESENT, id: null })
    assert.equal(cold.term.headContent(), "AAA")
    assert.equal(cold.term.getValue(), "AAA")
    assert.equal(warm.pins() + cold.pins(), 0)
    assert.equal(readHead(cold.work), "legacy-cold")
})

test("an empty head wins over a leftover cache", async () => {
    const { term, pins, work } = boot("")
    writeHead(work, "legacy-empty")
    const ctx = seat({ term, work, source: async () => KEEP, loaded: true })
    ctx.api.onSettle({ key: keepId, id: keepId })
    await tick()
    ctx.api.onSettle({ key: PRESENT, id: null })
    assert.equal(term.headContent(), "")
    assert.equal(term.getValue(), "")
    assert.equal(readHead(work), "legacy-empty")
    assert.equal(pins(), 0)
})

test("a missing owner writes nothing", async () => {
    const { term, writes, work } = boot("AAA")
    writeHead(work, "legacy-missing")
    const before = writes.length
    const ctx = seat({
        term,
        work,
        source: async () => KEEP,
        loaded: true,
        headContent: () => undefined,
    })
    ctx.api.onSettle({ key: keepId, id: keepId })
    await tick()
    const mid = writes.length
    ctx.api.onSettle({ key: PRESENT, id: null })
    assert.equal(writes.length, mid, "undefined headContent is not an empty program")
    assert.ok(writes.length >= before)
    assert.equal(readHead(work), "legacy-missing")
    assert.equal(term.pinHead !== undefined, true)
})

test("a rejected or switched read does not project onto the head", async () => {
    const rejected = boot("AAA")
    writeHead(rejected.work, "legacy-rejected")
    const gate = deferred()
    const ctx = seat({ term: rejected.term, work: rejected.work, source: () => gate.promise })
    const pending = ctx.api.onSettle({ key: keepId, id: keepId })
    gate.reject(new Error("no source"))
    await pending
    await tick()
    assert.equal(rejected.term.headContent(), "AAA")
    assert.equal(rejected.term.projecting(), false)
    assert.equal(readHead(rejected.work), "legacy-rejected")

    const moved = boot("AAA")
    writeHead(moved.work, "legacy-switched")
    const wait = deferred()
    const movedCtx = seat({ term: moved.term, work: moved.work, source: () => wait.promise })
    const hanging = movedCtx.api.onSettle({ key: keepId, id: keepId })
    typeNative(moved.term, "B")
    moved.term.adoptWork("other-work", moved.term.currentBufferId(), moved.work)
    movedCtx.api.reseat()
    wait.resolve(KEEP)
    await hanging
    await tick()
    assert.equal(moved.term.headContent(), "AAAB")
    assert.equal(moved.term.projecting(), false)
    assert.equal(moved.pins(), 0)
    assert.equal(readHead(moved.work), "legacy-switched")
    assert.equal(readHead("other-work"), null)
})

test("reseat and a remount do not land the legacy cache", () => {
    const { term, pins, work } = boot("live")
    writeHead(work, "legacy-reseat")
    const ctx = seat({ term, work, source: async () => KEEP, loaded: true })
    term.adoptWork("other-work", term.currentBufferId(), work)
    assert.equal(ctx.api.reseat(), true)
    assert.equal(term.headContent(), "live")
    assert.equal(pins(), 0)
    assert.equal(readHead(work), "legacy-reseat")

    const again = seat({ term, source: async () => KEEP, loaded: true, work: null })
    assert.equal(again.api.reseat(), true, "a fresh mount wears the standing work without pinning")
    assert.equal(term.headContent(), "live")
    assert.equal(pins(), 0)
    assert.equal(readHead(work), "legacy-reseat")
})

test("a present edit does not consume the legacy cache", () => {
    const { term, work } = boot("AAA")
    writeHead(work, "legacy-present")
    const ctx = seat({ term, work, source: async () => KEEP, loaded: true })
    typeNative(term, "C")
    ctx.api.drift()
    ctx.api.onSettle({ key: PRESENT, id: null })
    assert.equal(term.headContent(), "AAAC")
    assert.equal(readHead(work), "legacy-present")
})

test("typing on a loaded keep becomes that work's draft, not the head", async () => {
    const { term, work } = boot("AAA")
    writeHead(work, "legacy-loaded-draft")
    const ctx = seat({ term, work, source: async () => KEEP, loaded: true })
    ctx.api.onSettle({ key: keepId, id: keepId })
    await tick()
    assert.equal(term.projecting(), true)
    const before = term.headContent()
    typeNative(term, "!")
    assert.equal(term.projecting(), true, "native dispatch does not clear projection")
    assert.equal(term.headContent(), before)
    assert.equal(term.getValue(), KEEP + "!")
    assert.equal(readDraft(work)?.from, keepId)
    assert.equal(readDraft(work)?.text, KEEP + "!")
    assert.equal(readHead(work), "legacy-loaded-draft")
})
