// Scalar attempts preserve waiting causes; source lifetime owns the record.
// Keyed currentness remains unresolved. (id:readout-scalar-wait)
// Run: node --test test/js/laws/readout_scalar_wait_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive, at } from "./harness.mjs"
import { createReadouts } from "../../../assets/js/turtling/laws/readout.js"

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const blocked = (frame = null) => {
    const error = new Error(frame ? "Blocked on assistant: W (mid-instant)" : "Blocked on assistant: W")
    error.blocked = true
    if (frame) error.blockedFrame = frame
    return error
}
const attempt = (readouts, id) => {
    try { return { value: readouts.value(id) } } catch (error) { return { error } }
}
const position = (frame) => [...frame.transform.deref().position]

// One authored program, the three arms of the same question.
const authored = (body) => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", `as A do\n${body}\nend\nas B do\nfw 5\nend`))
    drive(scheduler)
    return { scheduler, A: host.children.get("A"), B: host.children.get("B") }
}

test("authored: an unrelated publication does not turn a forward scalar wait into an undefined variable", () => {
    const arms = [
        ["wait only", "let sample = B.x\nfw sample\nfw 10"],
        ["with publication", "let P\nlet sample = B.x\nlet P = (1,0)\nfw sample\nfw 10"],
        ["direct read", "let P\nlet P = (1,0)\nfw B.x\nfw 10"],
    ]
    for (const [label, body] of arms) {
        const { A, B } = authored(body)
        assert.equal(A.error, null, `${label}: a wait is not an undefined variable`)
        assert.deepEqual(position(B), [5, 0, 0], `${label}: the sibling settled`)
        assert.deepEqual(position(A), [15, 0, 0], `${label}: the wait resumed and the tail ran`)
    }
})

// A parent discovered recursively during a child's ensure must carry its cause out.
const transitive = (parentFirst) => {
    let waiting = false, attempts = 0
    const readouts = createReadouts()
    const parentCompute = () => { attempts++; if (waiting) throw blocked({ name: "W" }); return 5 }
    const ids = {}
    const childCompute = () => readouts.value(ids.parent) + 1
    if (parentFirst) {
        ids.parent = readouts.register("owner", "parent", parentCompute)
        ids.child = readouts.register("owner", "child", childCompute)
    } else {
        ids.child = readouts.register("owner", "child", childCompute)
        ids.parent = readouts.register("owner", "parent", parentCompute)
    }
    return { readouts, ids, attempts: () => attempts, block: () => { waiting = true } }
}

test("transitive: both registration orders carry the parent's cause, one attempt per epoch", () => {
    for (const parentFirst of [false, true]) {
        const label = parentFirst ? "parent first" : "child first"
        const t = transitive(parentFirst)
        t.readouts.recompute({})
        assert.equal(t.attempts(), 1, `${label}: the parent ran once in the first publication`)
        assert.equal(t.readouts.value(t.ids.child), 6, `${label}: the first answer is real`)
        assert.equal(t.readouts.value(t.ids.parent), 5, `${label}: the parent's first answer is real`)
        t.block()
        t.readouts.recompute({})
        assert.equal(t.attempts(), 2, `${label}: the blocked parent is attempted once, not once per reader`)
        assert.ok(attempt(t.readouts, t.ids.child).error?.blocked, `${label}: the child carries the wait, not old + 1`)
        assert.ok(attempt(t.readouts, t.ids.parent).error?.blocked, `${label}: the parent carries the wait`)
        attempt(t.readouts, t.ids.child); attempt(t.readouts, t.ids.parent)
        assert.equal(t.attempts(), 2, `${label}: repeated same-epoch reads add no attempts`)
    }
})

test("ready sibling: a blocked scalar does not abort or hide a ready answer in the same publication", () => {
    const readouts = createReadouts()
    const seen = []
    readouts.watch((change) => seen.push(change.value))
    const blockedId = readouts.register("owner", "blocked", () => { throw blocked() })
    const readyId = readouts.register("owner", "ready", () => 7)
    readouts.recompute({})
    assert.ok(attempt(readouts, blockedId).error?.blocked, "the blocked node is a wait")
    assert.equal(readouts.value(readyId), 7, "the ready sibling still answers")
    assert.ok(seen.includes(7), "the ready sibling is announced")
})

test("losing a scalar answer announces undefined once, not a wait-shaped value", () => {
    const readouts = createReadouts(), cause = blocked(), changes = []
    let waiting = false
    const id = readouts.register("owner", "site", () => { if (waiting) throw cause; return 5 })
    readouts.watch(change => changes.push(change.value))
    readouts.recompute()
    waiting = true
    readouts.recompute()
    assert.deepEqual(changes, [5, undefined])
    assert.equal(attempt(readouts, id).error, cause, "value consumers still receive the cause")
    readouts.recompute()
    assert.deepEqual(changes, [5, undefined], "the same unavailable answer is not reannounced")
    assert.equal(readouts.list()[0].hasValue, false, "hasValue alone does not classify readiness")
})

test("falsy and absent values are answers, never waits", () => {
    const readouts = createReadouts()
    const cases = [[0, 0], [false, false], ["", ""], [null, null], [undefined, undefined]]
    const ids = cases.map(([value], i) => readouts.register("owner", `case${i}`, () => value))
    readouts.recompute({})
    for (const [i, [value, expected]] of cases.entries()) {
        const read = attempt(readouts, ids[i])
        assert.equal(read.error, undefined, `case ${i}: no wait`)
        assert.strictEqual(read.value, expected, `case ${i}: the value itself`)
    }
})

test("ordinary collected failures keep the existing NOTHING policy and attempt frequency", () => {
    const readouts = createReadouts()
    const refusal = () => { const error = new Error("point + point"); error.name = "TowerRefusal"; return error }
    let mode = "value", attempts = 0
    const id = readouts.register("owner", "site", () => { attempts++; if (mode === "value") return 5; throw refusal() })
    readouts.recompute({})
    mode = "refusal"
    readouts.recompute({})
    const read = attempt(readouts, id)
    assert.equal(read.error, undefined, "a collected domain failure is not a wait")
    assert.equal(read.value, undefined, "it is NOTHING, as before")
    attempt(readouts, id)
    assert.equal(attempts, 2, "ordinary failures also attempt once per publication")
    readouts.recompute()
    assert.equal(attempts, 3)
    const onDemand = createReadouts()
    const fresh = onDemand.register("owner", "site", () => { throw refusal() })
    assert.throws(() => onDemand.value(fresh), /point \+ point/, "an on-demand wound still throws")
})

test("a blocked answer returned by a captured compute keeps its cause before and after collection", () => {
    const readouts = createReadouts(), cause = blocked({ name: "W" })
    let attempts = 0
    const question = ["q", 1]
    const spec = {
        capture: () => question,
        compute: () => { attempts++; return { question, value: undefined, error: cause } },
    }
    const id = readouts.register("owner", "cell", spec)
    readouts.recompute({})
    assert.equal(attempts, 1)
    assert.equal(attempt(readouts, id).error, cause, "a returned blocked answer is a wait, not NOTHING")
    attempt(readouts, id)
    assert.equal(attempts, 1, "the discovered wait is not re-attempted in the same epoch")
    const demand = createReadouts(), fresh = demand.register("owner", "cell", spec)
    assert.equal(attempt(demand, fresh).error, cause, "an uncollected returned cause also throws")
    assert.equal(demand.list()[0].hasRequested, false, "the failed demand wrote no memo")
})

test("a captured compute's blocked answer is intercepted before the memo is written", () => {
    // A poisoned memo is invisible until the same question returns: it would reuse
    // an undefined answer instead of asking again. (id:laws-reactive-randomness)
    const readouts = createReadouts()
    let attempts = 0, next = blocked({ name: "W" })
    const id = readouts.register("owner", "cell", {
        initial: { question: ["old"], value: 4 },
        capture: () => ["new"],
        compute: () => {
            attempts++
            return next ? { question: ["new"], value: undefined, error: next }
                : { question: ["new"], value: 8 }
        },
    })
    readouts.recompute({})
    assert.equal(attempts, 1, "the first capture asks for a new answer")
    assert.ok(attempt(readouts, id).error?.blocked, "the blocked answer is a wait, not the retained 4")
    next = null
    readouts.recompute({})
    assert.equal(attempts, 2, "an equally new question still needs its answer")
    assert.equal(attempt(readouts, id).value, 8, "the answer is real, not a memoized undefined")
    readouts.recompute({})
    assert.equal(attempts, 2, "a settled equal question reuses its answer")
    assert.equal(attempt(readouts, id).value, 8)
})

test("preflight restores a real blocked capture without poisoning its answer or attempt epoch", () => {
    const readouts = createReadouts(), target = {}, cause = blocked(target)
    let waiting = true, captures = 0, computes = 0
    const id = readouts.register("owner", "site", {
        initial: { question: ["held"], value: 5 },
        capture: () => {
            captures++
            readouts.readsink(target)
            if (waiting) throw cause
            return ["held"]
        },
        compute: () => { computes++; return { question: ["held"], value: 99 } },
    })
    for (let i = 1; i <= 2; i++) {
        assert.equal(readouts.dependsOnFrame(() => readouts.value(id), target), true)
        assert.equal(captures, i, "each probe really attempted the blocked capture")
        assert.equal(readouts.list()[0].hasValue, true, "the probe restored the held answer")
    }
    waiting = false
    assert.equal(readouts.value(id), 5, "the real read reuses the unpoisoned held memo")
    assert.equal(captures, 3, "the probes did not stamp the real attempt epoch")
    assert.equal(computes, 0, "a complete equal capture still authorizes memo reuse")
    waiting = true
    readouts.recompute()
    assert.equal(attempt(readouts, id).error, cause, "the real publication retains the exact cause")
    waiting = false
    readouts.recompute()
    assert.equal(readouts.value(id), 5, "same-question recovery preserves the held answer")
    assert.equal(computes, 0)
})

test("authored: a wait recovers on scheduler ticks when the source settles without geometry", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", [
        "as A do", " let P", " let sample = B.x", " let P = (1,0)", " fw sample", " fw 10", "end",
        "as B do", " wait 1", "end",
    ].join("\n")))
    for (let i = 0; i < 6 && !scheduler.done; i++) scheduler.tick(i * 1000)
    const A = host.children.get("A"), B = host.children.get("B")
    assert.equal(B.error, null, "the source settled by waiting, not by moving")
    assert.deepEqual(position(B), [0, 0, 0], "no geometry publication is needed")
    assert.equal(A.error, null, "no wound")
    assert.deepEqual(position(A), [10, 0, 0], "the wait resumed on an existing tick")
})

test("authored: finished missing targets fault instead of retaining a scalar wait forever", () => {
    for (const source of ["fw C.x", "let P\nlet sample = C.x\nlet P = (1,0)\nfw sample"]) {
        const scheduler = buildWorld({ admit: pass })
        const A = scheduler.hotSwapChild("A", fork("A", source))
        for (let i = 0; i < 5; i++) scheduler.tick(i * 1000)
        assert.match(A.error?.message ?? "", /Undefined (assistant: C|variable: sample)/)
        assert.equal(A.suspension, null, "a finished missing target is no longer waiting")
        assert.equal(scheduler.done, true, "the world does not wait forever")
    }
})

test("source lifetime: release and replacement clear the cause", () => {
    const readouts = createReadouts()
    let mode = "blocked"
    const id = readouts.register("owner", "site", () => { if (mode === "blocked") throw blocked(); return 4 })
    readouts.recompute({})
    assert.ok(attempt(readouts, id).error?.blocked, "the cause is current")
    readouts.release("owner")
    assert.equal(readouts.size, 0, "release takes the node and its cause")
    mode = "value"
    const fresh = readouts.register("owner", "site", () => { if (mode === "blocked") throw blocked(); return 3 })
    readouts.recompute({})
    assert.equal(readouts.value(fresh), 3, "a fresh registration answers normally")
    mode = "blocked"
    readouts.recompute({})
    assert.ok(attempt(readouts, fresh).error?.blocked, "and can wait again on its own account")
    mode = "value"
    const replaced = readouts.register("owner", "site", () => 4)
    readouts.recompute({})
    assert.equal(readouts.value(replaced), 4, "replacement starts from a clean record")
})

test("cycle refusal dominates a coincident blocked cause, and the wait returns once the cycle breaks", () => {
    const readouts = createReadouts()
    const ids = {}
    ids.x = readouts.register("owner", "x", () => {
        const y = readouts.value(ids.y)
        throw blocked({ name: "W" })
    })
    ids.y = readouts.register("owner", "y", () => readouts.value(ids.x) + 1)
    const announced = readouts.recompute({})
    assert.ok(announced.some((change) => change.id === ids.x && change.cycle === true),
        "the proven self-dependency is still refused")
    const refused = attempt(readouts, ids.x)
    assert.equal(refused.error, undefined, "a refusal is not an indefinite wait")
    assert.equal(refused.value, undefined, "the refused node answers NOTHING")
    // Break the cycle; the input wait was real all along and must reappear.
    readouts.register("owner", "y", () => 3)
    readouts.recompute({})
    assert.ok(attempt(readouts, ids.x).error?.blocked, "the continuing real wait is visible again")
})

test("keyed: a blocked first capture creates no request, no pending and no build", () => {
    const readouts = createReadouts()
    const builds = []
    let capture = () => { throw blocked() }
    const id = readouts.register("owner", "cell", { capture: () => capture(), build: (question) => { builds.push(question); return 1 } })
    const announced = readouts.recompute({})
    assert.deepEqual(announced, [], "a failed capture is not a new question")
    assert.equal(readouts.list()[0].pending, false, "no work is authorized")
    readouts.drain()
    assert.deepEqual(builds, [], "no build(undefined)")
    // Recovery: a complete capture creates exactly one request and one build.
    capture = () => ["q", 1]
    const recovered = readouts.recompute({})
    assert.equal(recovered.filter((change) => change.id === id).length, 1, "recovery announces one request")
    readouts.drain()
    assert.deepEqual(builds, [["q", 1]], "recovery builds once")
})

test("keyed compatibility: an older pending request still builds after a blocked capture (known hazard)", () => {
    const readouts = createReadouts()
    const builds = []
    let mode = "ready"
    readouts.register("owner", "cell", {
        capture: () => { if (mode === "blocked") throw blocked(); return ["q", 1] },
        build: (question) => { builds.push(question); return 1 },
    })
    readouts.recompute({})
    mode = "blocked"
    readouts.recompute({})
    readouts.drain()
    // NOT repaired by this cut: an older request keeps its legacy build permission.
    assert.deepEqual(builds, [["q", 1]], "legacy keyed hazard, characterized not satisfied")
})

test("keyed compatibility: an older settled answer remains readable after a blocked capture (known hazard)", () => {
    const readouts = createReadouts()
    let mode = "ready"
    const id = readouts.register("owner", "cell", {
        capture: () => { if (mode === "blocked") throw blocked(); return ["q", 1] },
        build: () => 5,
    })
    readouts.recompute(); readouts.drain()
    assert.equal(readouts.value(id), 5, "settled")
    mode = "blocked"
    readouts.recompute()
    // NOT repaired by this cut: the keyed value port still exposes the settled answer.
    assert.equal(readouts.value(id), 5, "legacy keyed hazard, characterized not satisfied")
})

test("D011: a direct blocked facet read still parks its actor", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host", ["as w do", "  fw b.x", "end", "fw w.x"].join("\n")))
    scheduler.tick(0); scheduler.tick(1000)
    assert.equal(host.suspension?.kind, "dataflow", "the direct read waits")
    assert.equal(host.suspension?.on?.name, "w", "on the target, as before")
})
