// Production hatch, snap, and the keeper's mint. Fake GL is not a GPU proof.
// The body that leaves is the whole lent reflect, including state.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createContext, runInContext } from "node:vm"
import { createCapture, copyBody, copyLayers, copyValue, makeSurface, publishCapture } from "../../../assets/js/turtling/capture.js"
import { mintSnap } from "../../../assets/js/keep/kinds/snap.js"
import { askKeep, registerKeeper } from "../../../assets/js/keep/cell.js"
import { createFocus } from "../../../assets/js/turtling/focus.js"

const stageSrc = readFileSync(new URL("../../../assets/js/turtling/stage.js", import.meta.url), "utf8")
const turtleSrc = readFileSync(new URL("../../../assets/js/turtling/turtle.js", import.meta.url), "utf8")
const innerSrc = readFileSync(new URL("../../../assets/js/hooks/shell/inner.js", import.meta.url), "utf8")

function grab(src, start, end) {
    const s = src.indexOf(start)
    const e = src.indexOf(end, s + start.length)
    if (s < 0 || e < 0) throw new Error(`slice ${start} → ${end}`)
    return src.slice(s, e)
}

const hatchStart = stageSrc.indexOf("hatch(bridge, lend) {")
const hatchEnd = stageSrc.lastIndexOf("return which.promise", stageSrc.indexOf("dispose() {"))
const hatchFn = "function " + stageSrc.slice(hatchStart, hatchEnd) + "return which.promise\n}"
// The three production methods the keep path rides, sliced verbatim.
const snapFn = "function " + grab(turtleSrc, "snap() {", "reflectChanged()").replace(/,\s*$/, "")
const turtleHatchFn = "function " + grab(turtleSrc, "hatch() {", "snap() {")
const disposeFn = "function " + grab(turtleSrc, "dispose() {", "// Compose the compositor's reframe")
const keeperMintFn = grab(innerSrc, "const shot = await turtle.snap?.() ?? null", "if (!id) {")
const owedFn = "function owed() { " + grab(turtleSrc, "if (this._snapOwed) {", "} else if (verdict.reason)") + " } }"
const warnings = []
const dispose = runInContext(`(${disposeFn})`, createContext({
    document: { removeEventListener() {} },
    console: { warn: (...args) => warnings.push(args) },
}))

function gl(kind, opts = {}) {
    const polls = []
    const freed = { sync: 0, buffer: 0 }
    let release = false
    let cutPixel = 1
    let queries = 0
    let bound = null // the PBO this cut enqueued into
    const ctx = {
        RGBA: 1, UNSIGNED_BYTE: 2, PIXEL_PACK_BUFFER: 3, STREAM_READ: 4,
        SYNC_GPU_COMMANDS_COMPLETE: 5, TIMEOUT_EXPIRED: 6, WAIT_FAILED: 7, BUFFER_SIZE: 8,
        // A real allocation: the bound buffer remembers the bytes it actually holds.
        createBuffer: () => (opts.nullBuffer ? null : { bytes: 0, pixel: 0 }),
        bindBuffer(_target, buffer) { bound = buffer },
        bufferData(_target, size) { if (bound) bound.bytes = opts.allocSize ?? size },
        flush() {},
        deleteSync() { freed.sync++ }, deleteBuffer() { freed.buffer++ },
        isContextLost: () => opts.lost === true,
        getBufferParameter(_target, pname) { queries++; return pname === 8 && bound ? bound.bytes : 0 },
        readPixels(_x, _y, _w, _h, _f, _t, pixels) {
            if (opts.readThrows > 0) { opts.readThrows--; throw new Error("readback lost") }
            // Enqueue freezes this cut's pixel in its own buffer; a later setPixel
            // must not rewrite what a pending cut already photographed.
            if (pixels && typeof pixels === "object") pixels[0] = cutPixel
            else if (bound) bound.pixel = cutPixel
        },
        clientWaitSync: () => (release ? 0 : 6),
        fenceSync: () => (opts.nullFence ? null : {}),
        getBufferSubData(_t, _o, pixels) {
            if (opts.subThrows > 0) { opts.subThrows--; throw new Error("readback lost") }
            pixels[0] = bound ? bound.pixel : cutPixel
        },
    }
    if (kind === "gl1") delete ctx.fenceSync
    // A context that cannot answer the extent question must fail closed, never
    // be treated as "allocated" because the call is absent.
    if (opts.noQuery) delete ctx.getBufferParameter
    return {
        ctx, opts, polls, freed,
        get queries() { return queries },
        release() { release = true },
        setPixel(n) { cutPixel = n },
    }
}

function world(kind, opts) {
    const caps = createCapture()
    const sent = []
    const box = {
        disposed: false,
        meta: { frame: "A" },
        snapshot: { save: false, title: null },
        layers: [],
    }
    const gpu = gl(kind, opts)
    const scope = {
        caps, copyBody, copyLayers, copyValue, makeSurface,
        canvas: opts?.canvas ?? { width: 1, height: 1 },
        stage: {
            renderstate: box,
            markLayers: () => box.layers,
        },
        ctx: gpu.ctx,
        disposed: false,
        queueMicrotask, Uint8Array,
        setTimeout: (fn) => { gpu.polls.push(fn) },
        getRecorder: () => box.recorder,
    }
    box.recorder = {
        takeSnapshot: async ({ pixels }) => ({ trimmed: `pic-${pixels[0]}`, full: `full-${pixels[0]}` }),
    }
    const vm = createContext(scope)
    const hatch = runInContext(`(${hatchFn})`, vm)
    return { caps, box, gpu, sent, hatch, vm, bridge: { pub: (event) => sent.push(event) } }
}

const owner = { id: "owner-A" }
function seen(source = "program-A") {
    return {
        source, commands: [{ value: source, meta: { nest: { n: 1 } } }],
        diagnostics: [{ message: source, nest: { n: 1 } }],
        attend: { line: 2 }, state: "success", message: null, buffer_id: "buf-a",
    }
}

test("GL1 and GL2 publish the whole lent body, and a later save belongs to the next cut", async () => {
    for (const kind of ["gl1", "gl2"]) {
        const rig = world(kind)
        const body = seen()
        const pending = rig.hatch(rig.bridge, () => ({ body, claim: owner }))
        body.commands[0].meta.nest.n = 7
        body.state = "error"
        rig.box.snapshot = { save: true, title: "late" }
        rig.box.meta.frame = "B"
        if (kind === "gl2") {
            assert.equal(rig.gpu.polls.length, 1)
            rig.gpu.release()
            rig.gpu.polls.shift()()
        }
        const shot = await pending
        assert.equal(shot.body.state, "success", kind)
        assert.equal(shot.body.commands[0].meta.nest.n, 1, kind)
        assert.equal(shot.body.message, null, kind)
        assert.equal(shot.path, "pic-1", kind)
        assert.equal(shot.claim, owner, kind)
        const local = rig.sent.find((event) => event[0] === "hatchTurtle")[1]
        const pushed = []
        publishCapture(local, (wire) => pushed.push(wire))
        assert.equal(pushed[0].state, "success", kind)
        assert.equal(pushed[0].message, null, kind)
        assert.equal("claim" in pushed[0], false, kind)
        assert.equal(rig.sent.some((event) => event[0] === "saveRecord"), false, kind)
    }
})

test("a clone or sized-layer failure settles the handed picture null", async () => {
    const rig = world("gl1")
    const handed = rig.caps.picture()
    const bad = { source: "A", state: "success", commands: [], blow: () => {} }
    assert.equal(await rig.hatch(rig.bridge, () => ({ body: bad, claim: owner })), null)
    assert.equal(await handed, null)

    const sized = world("gl1")
    const waiting = sized.caps.picture()
    sized.box.layers = [{ width: 2, height: 2 }]
    const made = sized.hatch(sized.bridge, () => ({ body: seen(), claim: owner }))
    assert.equal(await made, null)
    assert.equal(await waiting, null)
    assert.equal(sized.sent.length, 0)
})

test("encode failure and dispose settle that activation, not a later demand", async () => {
    const failed = world("gl1")
    failed.box.recorder = { takeSnapshot: async () => { throw new Error("encode died") } }
    const active = failed.hatch(failed.bridge, () => ({ body: seen(), claim: owner }))
    const later = failed.caps.picture()
    const result = await Promise.race([active, new Promise((r) => setTimeout(() => r("hung"), 50))])
    if (result === "hung") throw new Error(`polls=${failed.gpu.polls.length} sent=${failed.sent.length}`)
    assert.equal(result, null)
    let moved = false
    later.then(() => { moved = true })
    await Promise.resolve()
    assert.equal(moved, false)

    const dead = world("gl2")
    const pending = dead.hatch(dead.bridge, () => ({ body: seen(), claim: owner }))
    assert.equal(dead.gpu.polls.length, 1)
    dead.vm.disposed = true
    dead.gpu.polls.shift()()
    assert.equal(await pending, null)
    // Closing cancels a fresh demand outright; it does not wait on a dead stage.
    dead.caps.close()
    assert.equal(await dead.caps.picture(), null)
})

const settled = (active) => Promise.race([active, new Promise((r) => setTimeout(() => r("hung"), 50))])

test("a GPU readback throw cancels the handed cut instead of hatching forever", async () => {
    for (const kind of ["gl1", "gl2"]) {
        const rig = world(kind, { readThrows: 1 })
        const handed = rig.caps.picture()
        const result = await settled(rig.hatch(rig.bridge, () => ({ body: seen(), claim: owner })))
        assert.equal(result, null, kind)
        assert.equal(await settled(handed), null, kind)
        assert.equal(rig.caps.hatching, false, kind)
        assert.equal(rig.sent.length, 0, kind)
    }
})

test("a failed async readback frees the fence and buffer, and the next cut still reads", async () => {
    const rig = world("gl2", { subThrows: 1 })
    const active = rig.hatch(rig.bridge, () => ({ body: seen(), claim: owner }))
    rig.gpu.release()
    assert.equal(rig.gpu.polls.length, 1)
    rig.gpu.polls.shift()()
    assert.equal(await settled(active), null)
    assert.equal(rig.caps.hatching, false)
    assert.deepEqual(rig.gpu.freed, { sync: 1, buffer: 1 })
    assert.equal(rig.sent.length, 0)

    // The fault belonged to that activation: the next draw may hatch again.
    const again = rig.hatch(rig.bridge, () => ({ body: seen(), claim: owner }))
    assert.equal(rig.gpu.polls.length, 1)
    rig.gpu.polls.shift()()
    const shot = await settled(again)
    assert.equal(shot.path, "pic-1")
    assert.equal(rig.sent.filter((event) => event[0] === "hatchTurtle").length, 1)
})

test("a dirty owner publishes nothing, and snap waits for the next draw", async () => {
    const rig = world("gl1")
    assert.equal(await rig.hatch(rig.bridge, () => null), null)
    assert.equal(rig.sent.length, 0)

    // Executed production methods, not a pattern match: snap sets the debt, the
    // render block spends it, and an active cut refuses to be displaced.
    const caps = rig.caps
    const turtle = {
        stage: {
            get hatching() { return caps.hatching },
            picture: () => caps.picture(),
            hatch: (bridge, lend) => rig.hatch(bridge, lend),
        },
        bridge: rig.bridge,
        lendCut: () => ({ body: seen(), claim: owner }),
        _snapOwed: false,
        _lastHatchAt: 0,
        requestRender() { this.renders = (this.renders ?? 0) + 1 },
        snap: runInContext(`(${snapFn})`, createContext({})),
        hatch: runInContext(`(${turtleHatchFn})`, createContext({ performance: { now: () => 1 } })),
    }
    const owed = runInContext(`(${owedFn})`, createContext({}))

    const active = rig.hatch(rig.bridge, () => ({ body: seen(), claim: owner }))
    assert.equal(caps.hatching, true, "cut A is in flight")
    const demanded = turtle.snap.call(turtle)
    assert.equal(turtle._snapOwed, true, "a keep's picture is owed, not issued")
    owed.call(turtle)
    assert.equal(turtle._snapOwed, true, "an active cut keeps the owed picture waiting")
    assert.equal(rig.sent.length, 0, "no second cut is issued while A runs")
    let issued = false
    demanded.then(() => { issued = true })
    await Promise.resolve()
    assert.equal(issued, false, "the unissued slot is not B until a draw spends the debt")

    await active
    assert.equal(caps.hatching, false, "A settled")
    assert.equal(rig.sent.filter((e) => e[0] === "hatchTurtle").length, 1, "A published")
    owed.call(turtle)
    assert.equal(turtle._snapOwed, false, "the next draw spends the owed picture")
    const shot = await settled(demanded)
    assert.equal(shot.path, "pic-1", "the keep's demand is the NEXT cut")
    assert.equal(rig.sent.filter((e) => e[0] === "hatchTurtle").length, 2, "A and B each published once")
})

test("the keeper mints the cut body, not a later reflection", async () => {
    const shot = {
        path: "data:image/png;base64,QQ==",
        body: { source: "cut-A", state: "success", commands: [{ value: "A" }], diagnostics: [], attend: null },
        claim: owner,
    }
    const puts = []
    const door = { root: async () => "r".repeat(64), put: async (bytes, opts) => { puts.push(opts); return "kept" } }
    const keeper = grab(innerSrc, "const shot = await turtle.snap?.() ?? null", "const ids = {")
    const ctx = createContext({
        turtle: { snap: async () => shot },
        held: () => true,
        say() {},
        claim: owner,
        seen: { source: "cut-A" },
    })
    const result = runInContext(`(async () => {\n${keeper}\nreturn { path, document }\n})()`, ctx)
    const got = await result
    assert.equal(got.document.state, "success")
    assert.equal(got.document.source, "cut-A")
    const id = await mintSnap({ title: "keep" }, got.document, { root: "r".repeat(64), buffer_id: "buf" }, door, got.path)
    assert.equal(id, "kept")
    assert.equal(puts[0].source, "cut-A")
})

function teardown(overrides = {}) {
    const caps = createCapture()
    const calls = []
    // The real light register: dispose rebinds it, so the fixture can witness it.
    const root = { address: "root", children: new Map([["frame", {}]]), parent: null }
    const focus = createFocus({ root, registry: new Map() })
    focus.light = { kindled: "nested" }
    const ambient = { address: "nested", parent: root }
    const turtle = {
        _disposed: false,
        _handRequested: true,
        _onVisibilityChange: null,
        _onControlsActive: null,
        stage: {
            controls: { removeEventListener: () => calls.push("controls") },
            dispose() { calls.push("stage"); caps.close() },
        },
        _handle: { dispose() { calls.push("handle") } },
        _overlay: { dispose() { calls.push("overlay") } },
        compositor: { dispose() { calls.push("compositor") } },
        scheduler: {
            root: { children: new Map([["frame", {}]]) },
            removeChild: () => calls.push("admission"),
        },
        focus,
        onBeat: () => {},
        _stopHeartbeat() { calls.push("heartbeat") },
    }
    Object.assign(turtle, typeof overrides === "function" ? overrides(turtle) : overrides)
    return { caps, calls, turtle, focus, ambient }
}

test("a failing handle, compositor, admission or control cannot skip stage closure", async () => {
    const admissions = []
    const controls = []
    for (const [name, overrides] of [
        ["compositor", { compositor: { dispose() { throw new Error("gl lost") } } }],
        ["handle", { _handle: { dispose() { throw new Error("hand lost") } } }],
        // One parked frame that cannot go must not keep its sibling or the stage.
        ["admission", {
            scheduler: {
                root: { children: new Map([["one", {}], ["two", {}]]) },
                removeChild(key) {
                    admissions.push(key)
                    if (key === "one") throw new Error("frame lost")
                },
            },
        }],
        // The first listener removal fails; its two siblings must still be attempted.
        ["controls", (t) => ({
            stage: {
                ...t.stage,
                controls: {
                    removeEventListener(ev) {
                        controls.push(ev)
                        if (ev === "start") throw new Error("listener lost")
                    },
                },
            },
        })],
    ]) {
        const { caps, calls, turtle, focus, ambient } = teardown(overrides)
        const pending = caps.picture()
        warnings.length = 0
        admissions.length = 0
        controls.length = 0
        dispose.call(turtle)
        assert.equal(turtle._disposed, true, name)
        assert.ok(calls.includes("stage"), `${name}: the stage still closed`)
        if (name === "admission") assert.deepEqual(admissions, ["one", "two"], "each admission attempted")
        if (name === "controls") assert.deepEqual(controls, ["start", "change", "end"], "all three listeners attempted")
        if (name !== "admission") assert.ok(calls.includes("admission"), `${name}: admissions still released`)
        assert.equal(focus.inFocusedSubtree(ambient), false, `${name}: the light register still unbound`)
        assert.equal(warnings.length, 1, `${name}: the failure was reported`)
        assert.equal(await settled(pending), null, `${name}: the handed picture settles`)
        assert.equal(caps.hatching, false, name)
    }
})

test("a healthy teardown attempts every release, once", async () => {
    const { caps, calls, turtle, focus, ambient } = teardown()
    const pending = caps.picture()
    assert.equal(focus.inFocusedSubtree(ambient), true, "the register is bound before teardown")
    dispose.call(turtle)
    assert.deepEqual(calls, [
        "heartbeat", "controls", "controls", "controls",
        "handle", "overlay", "compositor", "admission", "stage",
    ], "dependency order preserved, stage last")
    assert.equal(await settled(pending), null)
    assert.equal(focus.inFocusedSubtree(ambient), false, "teardown unbinds the light register")
    const attempted = calls.length
    dispose.call(turtle)
    assert.equal(calls.length, attempted, "death is final")
})

test("a dispose inside the save callback cannot publish the cut", async () => {
    const rig = world("gl1")
    rig.box.snapshot = { save: true, title: "late" }
    const pub = rig.bridge.pub
    rig.bridge.pub = (event) => {
        pub(event)
        // A listener is control transfer: the viewer dies inside the save callback.
        if (event[0] === "saveRecord") { rig.vm.disposed = true; rig.caps.close() }
    }
    const shot = await settled(rig.hatch(rig.bridge, () => ({ body: seen(), claim: owner })))
    assert.equal(shot, null, "the closed stage cancels this cut")
    assert.equal(rig.sent.filter((e) => e[0] === "saveRecord").length, 1, "the save itself happened")
    assert.equal(rig.sent.some((e) => e[0] === "hatchTurtle"), false, "no hatch after death")
})

test("staging allocation is validated once per cut, before any read/encode/save/hatch", async () => {
    const cases = [
        ["null buffer", { nullBuffer: true }],
        ["null fence", { nullFence: true }],
        ["skipped allocation", { allocSize: 0 }],
        ["wrong extent", { canvas: { width: 2, height: 1 }, allocSize: 4 }],
        ["lost context", { lost: true }],
        ["zero-width canvas", { canvas: { width: 0, height: 1 } }],
        ["no staging query API", { noQuery: true }],
    ]
    for (const [name, opts] of cases) {
        const rig = world("gl2", opts)
        rig.box.snapshot = { save: true, title: "t" }
        const handed = rig.caps.picture()
        const cut = await settled(rig.hatch(rig.bridge, () => ({ body: seen(), claim: owner })))
        assert.equal(cut, null, `${name}: the cut is refused`)
        assert.equal(await settled(handed), null, `${name}: the handed picture settles null`)
        assert.equal(rig.caps.hatching, false, `${name}: the stage is not left hatching`)
        assert.equal(rig.sent.some((e) => e[0] === "saveRecord"), false, `${name}: nothing is saved`)
        assert.equal(rig.sent.some((e) => e[0] === "hatchTurtle"), false, `${name}: nothing is published`)
        assert.equal(rig.gpu.polls.length, 0, `${name}: no fence was waited on`)
        if (name === "lost context" || name === "zero-width canvas") {
            assert.equal(rig.gpu.queries, 0, `${name}: refused before any staging query`)
        }
    }
})

test("an all-zero readback is a legitimate picture, not a failure", async () => {
    const rig = world("gl2", {})
    rig.gpu.setPixel(0)
    rig.box.snapshot = { save: true, title: "empty" }
    const cut = rig.hatch(rig.bridge, () => ({ body: seen(), claim: owner }))
    rig.gpu.release()
    assert.equal(rig.gpu.polls.length, 1)
    rig.gpu.polls.shift()()
    const shot = await settled(cut)
    assert.equal(shot.path, "pic-0", "zero pixels are pixels")
    assert.equal(rig.sent.filter((e) => e[0] === "hatchTurtle").length, 1)
    assert.equal(rig.sent.filter((e) => e[0] === "saveRecord").length, 1)
})

test("one staging query per cut: never per poll, never on the synchronous branch", async () => {
    const async_ = world("gl2", {})
    const cut = async_.hatch(async_.bridge, () => ({ body: seen(), claim: owner }))
    assert.equal(async_.gpu.queries, 1, "one query when the cut is enqueued")
    assert.equal(async_.gpu.polls.length, 1)
    async_.gpu.polls.shift()()            // TIMEOUT_EXPIRED: reschedules, adds no query
    assert.equal(async_.gpu.polls.length, 1)
    assert.equal(async_.gpu.queries, 1, "a poll asks nothing")
    async_.gpu.release()
    async_.gpu.polls.shift()()
    assert.equal(async_.gpu.queries, 1, "completing asks nothing")
    assert.equal((await settled(cut)).path, "pic-1")

    const sync = world("gl1", {})
    const shot = await settled(sync.hatch(sync.bridge, () => ({ body: seen(), claim: owner })))
    assert.equal(shot.path, "pic-1")
    assert.equal(sync.gpu.queries, 0, "no staging buffer exists to query")
})

test("a refused staging does not wedge the stage: the next draw cuts", async () => {
    const rig = world("gl2", { allocSize: 0 })
    const refused = await settled(rig.hatch(rig.bridge, () => ({ body: seen(), claim: owner })))
    assert.equal(refused, null)
    assert.equal(rig.gpu.freed.buffer, 1, "the refused cut freed the buffer it was given")

    rig.gpu.opts.allocSize = undefined
    rig.gpu.release()
    const next = rig.hatch(rig.bridge, () => ({ body: seen(), claim: owner }))
    assert.equal(rig.gpu.polls.length, 1)
    rig.gpu.polls.shift()()
    const shot = await settled(next)
    assert.equal(shot.path, "pic-1")
    assert.equal(rig.sent.filter((e) => e[0] === "hatchTurtle").length, 1)
})

test("full path: an active cut keeps the keep waiting, and B mints once with B's bytes", async () => {
    const rig = world("gl2")
    const caps = rig.caps
    // A path a keep can store: the recorder derives its bytes from THIS cut's pixels.
    const pixelsSeen = []
    rig.box.recorder = {
        takeSnapshot: async ({ pixels }) => {
            pixelsSeen.push(pixels[0])
            const url = `data:image/png;base64,${pixels[0] === 1 ? "AQ==" : "Ag=="}`
            return { trimmed: url, full: url }
        },
    }
    const turtle = {
        stage: {
            get hatching() { return caps.hatching },
            picture: () => caps.picture(),
            hatch: (bridge, lend) => rig.hatch(bridge, lend),
        },
        bridge: rig.bridge,
        lendCut: () => ({ body: seen("cut-B"), claim: owner }),
        _snapOwed: false,
        _lastHatchAt: 0,
        requestRender() {},
        snap: runInContext(`(${snapFn})`, createContext({})),
        hatch: runInContext(`(${turtleHatchFn})`, createContext({ performance: { now: () => 1 } })),
    }
    const owed = runInContext(`(${owedFn})`, createContext({}))

    // A enqueues at pixel 1; the PBO freezes that value at that moment.
    rig.gpu.setPixel(1)
    const activeA = rig.hatch(rig.bridge, () => ({ body: seen("cut-A"), claim: owner }))
    assert.equal(rig.gpu.polls.length, 1)
    // The picture moves on while A's fence is still pending: its bytes must not.
    rig.gpu.setPixel(2)

    const puts = []
    const door = {
        root: async () => "r".repeat(64),
        put: async (bytes, opts) => { puts.push(opts); return "kept" },
    }
    const keepCtx = createContext({
        turtle, held: () => true, say() {}, claim: owner, seen: { source: "cut-B" },
        eligible: false, handRoot: "r".repeat(64),
        captured: { workId: null, bufferId: "b1" },
        mintSnap: (...args) => mintSnap(...args),
        journal: door, arena: { alive: true },
    })
    const keeper = runInContext(`(async (ask) => {\n${keeperMintFn}\nreturn { id, path, document }\n})`, keepCtx)
    const releaseKeeper = registerKeeper(keeper)
    try {
        const kept = askKeep("keep", {})
        assert.equal(await settled(kept), "hung", "the keep waits on the unissued picture")

        owed.call(turtle)
        assert.equal(rig.gpu.polls.length, 1, "no second readback while A is active")
        assert.equal(puts.length, 0, "nothing is minted before a draw")

        rig.gpu.release()
        rig.gpu.polls.shift()()
        const aShot = await settled(activeA)
        assert.equal(aShot.path, "data:image/png;base64,AQ==", "A published its own frozen bytes")
        assert.equal(caps.hatching, false, "A closed the stage")
        assert.equal(puts.length, 0, "A's completion alone mints nothing")

        owed.call(turtle)
        assert.equal(rig.gpu.polls.length, 1, "the next draw enqueues B")
        rig.gpu.polls.shift()()
        const keptResult = await settled(kept)
        assert.equal(keptResult.id, "kept")
        assert.equal(keptResult.path, "data:image/png;base64,Ag==", "B's own bytes, not A's frozen copy")
        assert.equal(keptResult.document.source, "cut-B")
        assert.equal(puts.length, 1, "one B mint, no retry")
        assert.equal(puts[0].source, "cut-B", "the minted document is B's")
        assert.deepEqual(pixelsSeen, [1, 2], "each cut read the pixels it enqueued")
    } finally {
        releaseKeeper()
    }
})
