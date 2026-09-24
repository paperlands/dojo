// Phase 0c: who owns a suspended logical instant?
// Run: node --test test/js/laws/phase0c_instant_ownership_test.mjs
//
// The counterexample (D027 R2.5b ⊗ D011):
//
//   as child do  fw 10; fw 2; wait 1  end   -- a suspended descendant
//   fw 5; wait 1                            -- the enclosing frame
//
// Seat `observer` (executing `fw outer.x`) first, then `outer`. Under identity
// admission — `accept every requested transform` — the child parks mid-instant
// at `fw 10`. `visitPostOrderMotionFirst` sorts only a node's IMMEDIATE children
// by `midInstant`, so `outer` (no instant of its own) is not treated as owning
// the instant its descendant is suspended inside. The observer runs first and
// reads `outer.x = 0`; `outer` later settles at 5.
//
//   admission absent   → observer reads 5
//   accept everything  → observer reads 0     (no error either way)
//
// The law under assay, stated once:
//   *A suspended instant is owned by a SUBTREE, not by one frame. Every frame
//    on the spawn stack of the suspension owns it, and every scheduling door —
//    tick, inline drain, seat — must not let a reader pass an owner.*
//   (id:output-ledger-r2-instant, R2.5b; D011)
//
// This fence pins the counterexample and widens the differential to the other
// park causes, seat paths and lifecycle edges the same joint opened. It is green
// only while two roots hold:
//   1. observation is a synchronization point — a read of a subtree still inside
//      an instant suspends (the spawn stack owns the instant); and
//   2. the first wait anchors to the frame's birth on the shared axis — in all
//      three birth paths: spawn, rewire, and a fresh seat — never to wall now, so
//      consumed ticks cannot drift a frame's frontier past a sibling's.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot, resolveBinding } from "../../../assets/js/turtling/scheduler.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const deps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

function fork(name, source, targetFrame = null) {
    return {
        name, origin: SE3.identity(), frame: targetFrame,
        style: { color: "#000000", thickness: 2, down: true, showTurtle: 10 },
        code: { ast: parseProgram(source), functions: {} },
        env: { userspace: new Map(), loopCounter: 0, scope: {} },
    }
}

// Identity admission: accept whatever the command asked for and change nothing.
// Any observable difference from `admission absent` is the admission protocol
// leaking into the figure, never a language decision.
const acceptAll = ({ requested }) => ({ accepted: true, transform: requested })

function buildWorld(specs, { admit, capacity = 16 } = {}) {
    const scheduler = createScheduler(metaRoot(), {
        createDeps: deps,
        execOpts: { color: "#000000", strokeMax: 1, breathEvery: 1 },
        channelCapacity: capacity,
        motionAdmission: admit,
        onShout: () => {},
    })
    for (const spec of specs) {
        scheduler.hotSwapChild(spec.key, fork(spec.name, spec.src, spec.targetFrame))
    }
    return scheduler
}

// One Output/Sync event reduced to what a sibling can read.
function observable(event) {
    switch (event.type) {
        case "path": return { type: "path", points: event.points }
        case "head": return { type: "head", position: event.position }
        case "beat": return { type: "beat", time: event.time }
        case "label": return { type: "label", text: event.text, position: event.position }
        case "clear": return { type: "clear" }
        case "error": return { type: "error", message: event.message }
        default: return { type: event.type }
    }
}

// Full observable trace per address + final pose + lifecycle. Not just endpoints.
function observe(specs, opts = {}) {
    const scheduler = buildWorld(specs, opts)
    const trace = new Map()

    for (let i = 0; i < (opts.maxTicks ?? 400) && !scheduler.done; i++) {
        scheduler.tick(i * 1000)
        for (const frame of scheduler.registry.values()) {
            const key = frame.address ?? frame.name
            if (!trace.has(key)) trace.set(key, [])
            trace.get(key).push(...frame.channel.drain())
        }
    }

    const frames = {}
    for (const frame of scheduler.registry.values()) {
        if (frame === scheduler.root) continue
        const key = frame.address ?? frame.name
        frames[key] = {
            trace: (trace.get(key) ?? []).map(observable),
            final: [...frame.transform.deref().position],
            done: frame.done,
            error: frame.error?.message ?? null,
        }
    }

    return {
        frames,
        done: scheduler.done,
        errors: scheduler.errors.map((e) => `${e.name}: ${e.message}`),
    }
}

const canonical = (run) => JSON.parse(JSON.stringify(run))

// A frame owns a suspended instant when it is inside an admitted motion, or
// parked for a reason that is a refusal (credit / residency) rather than a
// breath or a language wait.

// ---------------------------------------------------------------------------
// The named regression
// ---------------------------------------------------------------------------

const NESTED = [
    { key: "observer", name: "observer", src: "fw outer.x" },
    { key: "outer", name: "outer", src: "as child do\n  fw 10\n  fw 2\n  wait 1\nend\nfw 5\nwait 1" },
]

test("nested spawn: identity admission is invisible — a sibling must not read an unfinished enclosing frame", () => {
    const without = canonical(observe(NESTED, { admit: undefined }))
    const withAdmit = canonical(observe(NESTED, { admit: acceptAll }))

    assert.deepEqual(
        withAdmit,
        without,
        "identity admission changed an observable: the figure is f(program, seed), not f(admission)"
    )
    // The counterexample's own endpoints, so the failure reads itself.
    assert.deepEqual(withAdmit.frames["observer"].final, without.frames["outer"].final)
    assert.deepEqual(withAdmit.frames["observer"].final, [5, 0, 0])
})

test("ownership of a suspended instant spans the spawn stack (a read of the enclosing frame suspends)", () => {
    const scheduler = buildWorld(NESTED, { admit: acceptAll })
    const observer = scheduler.root.children.get("observer")
    const outer = scheduler.root.children.get("outer")
    const child = outer?.children.get("child")

    assert.ok(child && child.midInstant, "the nested child is parked mid-instant")
    assert.ok(outer && !outer.midInstant, "the enclosing frame is not itself marked — ownership is a subtree property")

    assert.throws(
        () => resolveBinding(observer, "outer.x"),
        (e) => e.blocked === true,
        "a read of the enclosing frame must suspend while its descendant is mid-instant"
    )
})

// ---------------------------------------------------------------------------
// Other park causes reach the same joint
// ---------------------------------------------------------------------------

// `reader` is source-first, so it is registered before `writer`. A credit park
// in `writer` leaves it mid-instant; the reader must not read it there.
const READER_FIRST = [{
    key: "main",
    name: "main",
    src: "as reader do\n  fw writer.x\nend\nas writer do\n  fw 10\n  beColour 0.3\n  fw 2\n  wait 1\nend",
}]

test("a credit park owns its instant too: reader-first is capacity-invariant", () => {
    const tight = canonical(observe(READER_FIRST, { admit: undefined, capacity: 1 }))
    const wide = canonical(observe(READER_FIRST, { admit: undefined, capacity: 4096 }))

    assert.deepEqual(
        tight,
        wide,
        "capacity entered the figure through a mid-instant cross-ambient read"
    )
})

// `hotSwapChild` drains a newly seated frame inline. A writer already seated and
// parked mid-instant must not be readable by the frame seated after it.
const WRITER_SEATED_FIRST = [
    { key: "writer", name: "writer", src: "fw 10\nfw 2\nwait 1" },
    { key: "observer", name: "observer", src: "fw writer.x" },
]

test("seat order must not decide the figure (writer seated before its reader)", () => {
    const run = canonical(observe(WRITER_SEATED_FIRST, { admit: acceptAll }))

    assert.deepEqual(
        run.frames["observer"].final,
        run.frames["writer"].final,
        "a reader seated after a mid-instant writer read a partial pose; seat order is not a language decision"
    )
})

// `hotSwapChild` drains a newly seated frame inline and collects its
// `deferredShouts`, but never flushes them — so a frame already in the tree
// misses a shout made while a later frame is first seated.
const SHOUT_AT_SEAT = [
    { key: "ear", name: "ear", src: "loop 2 do\n  when 'go' do\n    fw 1\n  end\n  wait 1\nend" },
    { key: "crier", name: "crier", src: "shout 'go' 1\nwait 10" },
]

test("a shout made during an inline seat drain reaches the tree", () => {
    const run = canonical(observe(SHOUT_AT_SEAT, { admit: undefined }))

    assert.equal(
        run.frames["ear"].final[0],
        1,
        "the crier's first shout was never delivered to the already-seated ear"
    )
})

// The first `wait` must anchor to the frame's logical birth, not to wall `now`:
// a park before that wait used to drift the clock and let the reader sample a
// future pose. Capacity is the probe; logical time must not move.
test("looped cross-ambient reads are capacity-invariant (the first wait anchors to birth)", () => {
    const specs = [{
        key: "main",
        name: "main",
        src: "as a do\n  loop 3 do\n    fw b.x\n    wait 1\n  end\nend\nas b do\n  loop 3 do\n    fw 1\n    wait 1\n  end\nend",
    }]
    const tight = canonical(observe(specs, { admit: undefined, capacity: 1 }))
    const wide = canonical(observe(specs, { admit: undefined, capacity: 4096 }))
    assert.deepEqual(tight, wide, "capacity changed a looped cross-ambient read — the clock drifted")
})

// A fresh seat is a fresh clock at the axis origin, like a spawn and a rewire.
// Pre-wait computation — admission parks especially — must not drift the
// frontier ahead of a sibling's and let a reader sample an earlier instant.
test("asymmetric pre-wait work does not drift the frontier (a fresh seat anchors at the origin)", () => {
    const specs = [
        { key: "writer", name: "writer", src: "fw 1\nfw 1\nwait 1\nfw 1" },
        { key: "observer", name: "observer", src: "wait 1\nfw writer.x" },
    ]
    const without = canonical(observe(specs, { admit: undefined }))
    const withAdmit = canonical(observe(specs, { admit: acceptAll }))
    assert.deepEqual(withAdmit, without, "the fresh-seat clock drifted; the reader sampled an earlier instant")
})

// A dataflow suspension is part of the instant: a frame waiting on a dependency
// owns its instant, so a third frame's read propagates the wait. A wait-for cycle
// (the target already waits on the reader) resolves to the logically-prior pose
// instead — the read that would close the cycle is the one let through. (D011)
test("a dataflow-blocked frame owns its instant (suspension propagates)", () => {
    const specs = [{
        key: "main",
        name: "main",
        src: "as a do\n  fw b.x\nend\nas c do\n  fw a.x\nend\nas b do\n  fw 5\nend",
    }]
    const run = canonical(observe(specs, { admit: undefined }))
    assert.deepEqual(run.frames["main/c"].final, [5, 0, 0])
})

test("a wait-for cycle falls back to the logically-prior pose instead of hanging", () => {
    const specs = [{
        key: "main",
        name: "main",
        src: "as a do\n  fw b.x\nend\nas b do\n  fw a.x\nend",
    }]
    const run = canonical(observe(specs, { admit: undefined, maxTicks: 60 }))
    assert.equal(run.done, true, "the cycle resolved rather than deadlocked")
    assert.deepEqual(run.frames["main/a"].final, [0, 0, 0])
    assert.deepEqual(run.frames["main/b"].final, [0, 0, 0])
})

// A forward reference across siblings is a dataflow dependency, not a typo. An
// admission park can end the inline drain before the parent spawns the name, and
// the parked child then runs in the tick before the parent resumes. It must keep
// suspending until the parent spawns it — never die with "Undefined assistant".
test("a sibling forward reference survives an admission park (no premature wound)", () => {
    const specs = [{
        key: "main",
        name: "main",
        src: "as a do\n  fw 1\n  fw b.x\nend\nas b do\n  fw 1\n  fw a.x\nend",
    }]
    const run = canonical(observe(specs, { admit: acceptAll }))
    assert.equal(run.frames["main/a"].error, null)
    assert.equal(run.frames["main/b"].error, null)
    assert.equal(run.done, true)
})

// The classic cyclic pursuit — three mice on a triangle, each facing the next.
// It is the integration case: every read is cross-ambient, the ring is a
// wait-for cycle, and the figure must not care which admission the scheduler
// runs or how much credit it has. The spiral is f(program, seed) or it is noise.
const PURSUIT = [{
    key: "main",
    name: "main",
    src: "as a do\n  loop 12 do\n    faceto b.x b.y\n    fw 2\n    wait 1\n  end\nend\ngoto 40 0\nas b do\n  loop 12 do\n    faceto c.x c.y\n    fw 2\n    wait 1\n  end\nend\ngoto 20 35\nas c do\n  loop 12 do\n    faceto a.x a.y\n    fw 2\n    wait 1\n  end\nend",
}]

test("cyclic pursuit is invariant across admission and credit", () => {
    const without = canonical(observe(PURSUIT, { admit: undefined, capacity: 4096 }))
    const withAdmit = canonical(observe(PURSUIT, { admit: acceptAll, capacity: 4096 }))
    const tight = canonical(observe(PURSUIT, { admit: undefined, capacity: 1 }))
    assert.deepEqual(withAdmit, without, "admission changed the pursuit")
    assert.deepEqual(tight, without, "credit changed the pursuit")
})

// A mutual-read cycle inside one instant is resolved SYNCHRONOUSLY (Jacobi):
// every member reads the pose it held before the instant began, so no edge reads
// another's same-instant commit. The alternative — per-edge fallback — is a mixed
// Jacobi/Gauss-Seidel step whose result flips with admission. (laws.org:
// "reordering the same truths does not change the set")
test("a mutual read inside one instant sees the pre-instant pose, not the peer's same-instant commit", () => {
    const specs = [{
        key: "main",
        name: "main",
        src: "as a do\n  fw 1\n  fw b.x\n  wait 1\nend\nas b do\n  fw 1\n  fw a.x\n  wait 1\nend",
    }]
    const without = canonical(observe(specs, { admit: undefined }))
    const withAdmit = canonical(observe(specs, { admit: acceptAll }))
    assert.deepEqual(withAdmit, without, "admission changed the mutual read")
    assert.deepEqual(without.frames["main/a"].final, [1, 0, 0], "a reads b's pre-instant 0")
    assert.deepEqual(without.frames["main/b"].final, [1, 0, 0], "b reads a's pre-instant 0")
})

test("a mutual-read cycle is mode-independent (admission and credit)", () => {
    const specs = [{
        key: "main",
        name: "main",
        src: "as a do\n  loop 10 do\n    fw 2\n    fw [b.x * 0.5]\n    wait 1\n  end\nend\nas b do\n  loop 10 do\n    fw 1\n    fw [a.x * 0.5]\n    wait 1\n  end\nend",
    }]
    const without = canonical(observe(specs, { admit: undefined, capacity: 4096 }))
    const withAdmit = canonical(observe(specs, { admit: acceptAll, capacity: 4096 }))
    const tight = canonical(observe(specs, { admit: undefined, capacity: 1 }))
    assert.deepEqual(withAdmit, without, "admission changed a mutual-read cycle")
    assert.deepEqual(tight, without, "credit changed a mutual-read cycle")
})

// ---------------------------------------------------------------------------
// Differential matrix — identity admission vs none, complete observable traces
// ---------------------------------------------------------------------------

const MATRIX = {
    nested: NESTED,

    nested_deep: [
        { key: "observer", name: "observer", src: "fw outer.x" },
        { key: "outer", name: "outer", src: "as mid do\n  as inner do\n    fw 10\n  end\n  fw 2\n  wait 1\nend\nfw 5\nwait 1" },
    ],

    inline_sibling: [{
        key: "main",
        name: "main",
        src: "as reader do\n  fw writer.x\nend\nas writer do\n  fw 10\n  fw 2\n  wait 1\nend",
    }],

    cross_read_loop: [{
        key: "main",
        name: "main",
        src: "as a do\n  loop 3 do\n    fw b.x\n    wait 1\n  end\nend\nas b do\n  loop 3 do\n    fw 1\n    wait 1\n  end\nend",
    }],

    shout: [{
        key: "main",
        name: "main",
        src: "as crier do\n  shout 'go' 1\n  wait 1\n  shout 'go' 2\n  wait 1\nend\nas ear do\n  loop 2 do\n    when 'go' do\n      fw 1\n    end\n    wait 1\n  end\nend",
    }],

    wait_and_loop: [
        { key: "a", name: "main", src: "loop 3 do\n  fw 1\n  wait 1\nend" },
        { key: "b", name: "other", src: "loop 3 do\n  rt 30\n  wait 1\nend" },
    ],

    completion: [
        { key: "a", name: "main", src: "fw 10\nfw 2" },
    ],

    failure: [
        { key: "observer", name: "observer", src: "fw outer.x" },
        { key: "outer", name: "outer", src: "as child do\n  fw 10\nend\nfw nope\nwait 1" },
    ],

    rewire: [{
        key: "main",
        name: "main",
        src: "loop 2 do\n  as k do\n    fw 10\n  end\n  wait 1\nend",
    }],
}

describe("differential: identity admission vs none, complete observable traces", () => {
    for (const [label, specs] of Object.entries(MATRIX)) {
        test(label, () => {
            const without = canonical(observe(specs, { admit: undefined }))
            const withAdmit = canonical(observe(specs, { admit: acceptAll }))

            assert.deepEqual(
                withAdmit,
                without,
                `${label}: identity admission changed the observable trace`
            )
        })
    }
})
