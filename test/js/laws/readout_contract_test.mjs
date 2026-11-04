// The readout store's outcome and lifetime contract, not just its first publication.
//
// The store is a dependency graph with ONE meaning surviving evaluation, refusal,
// replacement and release:
//   ORDER      registry history never decides the answer;
//   FRESHNESS  scalar (same publication), keyed (question captured first, pending
//              answers NOTHING), and on-demand (evaluate then cache; a failure stays a
//              wound) agree;
//   REFUSAL    a definition standing on itself is refused BEFORE commitment, so the
//              preceding accepted definition survives;
//   VALIDITY   invalidity does not leak downstream;
//   OWNERSHIP  a cycle is attributed to the source, never to display metadata;
//   RECOVERY   a refusal is recomputed — break the loop and the nodes answer again.
// (id:tower-laws-cycle-contracts, id:laws-dependency-driven-place)
// Run: node --test test/js/laws/readout_contract_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { createReadouts } from "../../../assets/js/turtling/laws/readout.js"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"

// --- ORDER -------------------------------------------------------------------

function diamond(order) {
    const r = createReadouts(), ids = {}, counts = {}
    const fns = { root: (s) => s.x, left: () => r.value(ids.root) + 1, right: () => r.value(ids.root) * 2, tip: () => r.value(ids.left) + r.value(ids.right) }
    for (const name of order) ids[name] = r.register("s", name, (s) => { counts[name] = (counts[name] ?? 0) + 1; return fns[name](s) })
    r.recompute({ x: 3 })
    assert.equal(r.value(ids.tip), 10)
    assert.deepEqual(counts, Object.fromEntries(order.map((k) => [k, 1])))
}

test("a diamond computes its shared dependency once, in either registration order", () => {
    diamond(["root", "left", "right", "tip"])
    diamond(["tip", "right", "left", "root"])
})

test("a branch can switch its scalar dependency between publications", () => {
    const r = createReadouts(); let choose = true, a, b
    const c = r.register("s", "c", () => r.value(choose ? a : b))
    a = r.register("s", "a", (s) => s.a); b = r.register("s", "b", (s) => s.b)
    r.recompute({ a: 1, b: 2 }); assert.equal(r.value(c), 1)
    choose = false; r.recompute({ a: 3, b: 4 }); assert.equal(r.value(c), 4)
})

// --- REFUSAL: every member, and atomicity ------------------------------------

test("every member of an overlapping loop receives the refusal", () => {
    const r = createReadouts(); let a, b, c
    a = r.register("s", "a", () => { r.value(b); r.value(c); return 1 })
    b = r.register("s", "b", () => { r.value(a); return 2 })
    c = r.register("s", "c", () => { r.value(b); return 3 })
    const events = r.recompute()
    assert.deepEqual(new Set(events.filter((e) => e.cycle).map((e) => e.id)), new Set([a, b, c]))
})

test("invalidity does not leak: a descendant cannot publish from a refused value", () => {
    const r = createReadouts(); let a, b
    a = r.register("s", "a", () => { r.value(a); return 1 })
    b = r.register("s", "b", () => { const v = r.value(a); return v === undefined ? undefined : v + 10 })
    const events = r.recompute()
    assert.equal(r.value(b), undefined)
    assert.equal(events.some((e) => e.id === b && e.value !== undefined), false)
})

test("an on-demand cycle is a wound, not a normal value", () => {
    const r = createReadouts(); let a
    a = r.register("s", "a", () => { r.value(a); return 1 })
    assert.throws(() => r.value(a), /cycle|itself|depend/i)
})

test("an on-demand failure stays a failure on repeated reads in the same epoch", () => {
    const r = createReadouts(), id = r.register("s", "a", () => { throw new Error("failed") })
    assert.throws(() => r.value(id), /failed/)
    assert.throws(() => r.value(id), /failed/)
})

test("a cycle refusal is not latched: break it and the unchanged node answers again", () => {
    const r = createReadouts(); let a, b
    a = r.register("s", "a", () => { r.value(b); return 1 })
    b = r.register("s", "b", () => { r.value(a); return 2 })
    r.recompute()
    r.register("s", "a", () => 3)
    r.recompute()
    assert.equal(r.value(a), 3)
    assert.equal(r.value(b), 2)
})

// --- FRESHNESS: scalar, keyed, on-demand -------------------------------------

test("a scalar before a keyed input sees the new question, not the previous answer", () => {
    const r = createReadouts(); let keyed
    const out = r.register("s", "out", () => r.value(keyed))
    keyed = r.register("s", "keyed", { capture: (s) => s.q, build: (q) => q * 2 })
    r.recompute({ q: 1 }); r.drain(); r.recompute({ q: 1 })
    assert.equal(r.value(out), 2)
    r.recompute({ q: 2 })
    assert.equal(r.value(out), undefined, "a pending keyed answer is NOTHING to its reader")
})

test("a cycled keyed node never builds or publishes an answer", () => {
    const r = createReadouts(); let id
    id = r.register("s", "k", { capture: () => r.value(id) ?? 1, build: (q) => q * 2 })
    r.recompute(); const built = r.drain()
    assert.equal(built.some((e) => e.id === id && e.value !== undefined), false)
    assert.equal(r.value(id), undefined)
})

// --- REPLACEMENT and RELEASE -------------------------------------------------

test("a whole-definition replacement drops the old producer association", () => {
    const r = createReadouts(), frame = {}
    const a = r.register("s", "a", () => 1); r.produces(a, frame); r.recompute()
    r.register("s", "a", () => { r.readsink(frame); return 2 })
    const events = r.recompute()
    assert.equal(events.some((e) => e.cycle), false)
    assert.equal(r.value(a), 2)
})

test("retirement removes producer associations", () => {
    const r = createReadouts(), frame = {}
    const a = r.register("s", "a", () => 1); r.produces(a, frame)
    r.retire("s", "a")
    const b = r.register("s", "b", () => { r.readsink(frame); return 2 })
    assert.equal(r.recompute().some((e) => e.cycle), false)
    assert.equal(r.value(b), 2)
})

test("a preflight is observational: repeated or refused probes leave meaning intact", () => {
    const r = createReadouts(), frame = {}
    let calls = 0
    const id = r.register("s", "a", () => { calls++; return 7 })
    // Why: the scheduler asks `dependsOnFrame` before committing. A probe may compute a
    // node to discover its edges, but must not leave that as a cached answer.
    // (id:laws-dependency-driven-place)
    assert.equal(r.dependsOnFrame(() => r.value(id), frame), false)
    assert.equal(r.dependsOnFrame(() => r.value(id), frame), false)
    assert.equal(calls, 2, "each probe evaluates afresh; nothing is cached")
    assert.equal(r.value(id), 7)
    assert.equal(r.value(id), 7)
    assert.equal(calls, 3, "a normal read computes once, then caches")
    // A probe that DOES reach the produced frame — a refusal — still changes nothing.
    assert.equal(r.dependsOnFrame(() => { r.readsink(frame); return r.value(id) }, frame), true)
    assert.equal(r.value(id), 7)
    assert.equal(calls, 3, "the refused probe did not disturb the cached meaning")
})

test("presence is derived from the answer, never from its truthiness", () => {
    const r = createReadouts()
    const id = r.register("s", "answer", (s) => s.value)
    for (const value of [undefined, null, false, 0, "", [], undefined]) {
        r.recompute({ value })
        assert.equal(r.value(id), value)
        assert.equal(r.list()[0].hasValue, value !== undefined)
    }
})

test("a failed scalar clears its old answer and can recover without replacement", () => {
    const r = createReadouts(), changes = []
    const id = r.register("s", "answer", (s) => {
        if (s.failed) throw new Error("failed")
        return s.value
    })
    r.watch((change) => changes.push(change.value))
    r.recompute({ value: 7 })
    r.recompute({ failed: true })
    r.recompute({ failed: true })
    assert.equal(r.value(id), undefined)
    assert.equal(r.list()[0].hasValue, false)
    r.recompute({ value: 0 })
    assert.equal(r.value(id), 0)
    assert.deepEqual(changes, [7, undefined, 0])
})

// --- OWNERSHIP: the source, not the display ----------------------------------

const pass = ({ requested }) => ({ accepted: true, transform: requested })
const position = (f) => frameWorldTransform(f).position
const drag = (scheduler, frame, x) => scheduler.requestMotion(frame, {
    rotation: frame.transform.deref().rotation, position: [x, 0, 0],
}, scheduler.motionRevision)

test("an indirectly cyclic replacement is refused atomically, preserving the driver", () => {
    const scheduler = buildWorld({ admit: pass })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let B\nlet A = (B.x, 100)\nlet s = A.x + 1\nlet A = (s, 100)"))
    drive(scheduler, { maxTicks: 100 })
    const a = host.children.get("A"), b = host.children.get("B")
    assert.deepEqual(position(a), [0, 100, 0], "the preceding accepted definition stands")
    assert.ok(scheduler.errors.some((e) => /cannot be defined by itself/.test(e.message)))
    assert.equal(drag(scheduler, b, 7).kind, "accept")
    drive(scheduler, { maxTicks: 100 })
    assert.deepEqual(position(a), [7, 100, 0], "and the preceding driver still tracks")
})

test("a scalar-only assignment cycle is named against its source", () => {
    const scheduler = buildWorld({})
    scheduler.hotSwapChild("host", fork("host", "let s = 0\nlet t = s + 1\nlet s = t + 1"))
    drive(scheduler, { maxTicks: 100 })
    assert.ok(scheduler.errors.some((e) => /itself|cycle|depend/i.test(e.message)),
        "a scalar cycle has a diagnostic, not silence")
})

// --- TOPOLOGY CACHE: reuse discovery, never enforcement ----------------------

test("a cycle is refused on every publication, not only the one that found it", () => {
    const r = createReadouts(); let a, b
    a = r.register("s", "a", (s) => r.value(b) + s.v)
    b = r.register("s", "b", () => r.value(a) + 1)
    const refused = []
    r.watch((e) => { if (e.cycle) refused.push(e.id) })
    for (let k = 0; k < 5; k++) r.recompute({ v: k })
    assert.equal(r.value(a), undefined)
    assert.equal(r.value(b), undefined)
    assert.equal(refused.length, 2, "each node is refused once, on the transition")
})

test("breaking a cycle recovers both nodes — the cache sees the edge change", () => {
    const r = createReadouts(); let a, b, tangled = true
    a = r.register("s", "a", (s) => r.value(b) + s.v)
    b = r.register("s", "b", () => (tangled ? r.value(a) : 5) + 1)
    r.recompute({ v: 1 })
    assert.equal(r.value(a), undefined)
    r.recompute({ v: 1 })
    assert.equal(r.value(a), undefined, "the refusal holds across a repeat publication")
    tangled = false
    r.recompute({ v: 1 })
    assert.equal(r.value(b), 6)
    assert.equal(r.value(a), 7, "and the reader answers again")
})

test("a branch switch that forms a cycle is seen on the next publication", () => {
    const r = createReadouts(); let a, b, back = false
    a = r.register("s", "a", (s) => s.x + (back ? r.value(b) : 0))
    b = r.register("s", "b", () => r.value(a) + 1)
    r.recompute({ x: 1 })
    assert.equal(r.value(b), 2)
    back = true
    r.recompute({ x: 1 })
    assert.equal(r.value(a), undefined, "the loop is refused")
    assert.equal(r.value(b), undefined, "and its reader too")
})

test("an invalid descendant stays refused while the cycle holds", () => {
    const r = createReadouts(); let a, b, c
    a = r.register("s", "a", (s) => r.value(b) + s.v)
    b = r.register("s", "b", () => r.value(a) + 1)
    c = r.register("s", "c", () => r.value(a) * 10)
    for (let k = 0; k < 4; k++) { r.recompute({ v: k }); assert.equal(r.value(c), undefined) }
})

test("a cancelled keyed answer recovers when the cycle breaks — same question", () => {
    const r = createReadouts(); let id, tangled = true
    id = r.register("s", "k", { capture: () => { if (tangled) r.value(id); return 10 }, build: (q) => q * 2 })
    r.recompute(); r.drain()
    assert.equal(r.value(id), undefined, "the capture stands on itself and is refused")
    tangled = false
    r.recompute(); r.drain()
    assert.equal(r.value(id), 20, "the retained question is re-requested, not left settled")
})

test("a keyed descendant of a cycle recovers when the cycle breaks", () => {
    const r = createReadouts(); let c, n, id, tangled = true
    c = r.register("s", "c", () => (tangled ? r.value(c) : 0) + 1)
    n = r.register("s", "n", () => r.value(c) + 10)
    id = r.register("s", "k", { capture: () => { r.value(n); return 5 }, build: (q) => q * 3 })
    r.recompute(); r.drain()
    assert.equal(r.value(id), undefined, "invalidity propagates to the keyed descendant")
    tangled = false
    r.recompute(); r.drain()
    assert.equal(r.value(id), 15, "and it answers again once the loop is broken")
})
