// A retained hand input is interpreted ONCE, from the source's own reference: a replay may not
// lose it (a dormant curved wish) and may not let its earlier effect pass as the source.
// (id:laws-hand-action-state)
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, drive, worldOf } from "./harness.mjs"
import { worldTransform } from "../../../assets/js/turtling/scheduler.js"
import { toLocalPoint, toWorldPoint } from "../../../assets/js/turtling/localize.js"
import { createHandState } from "../../../assets/js/turtling/laws/hand_state.js"
import { SE3, AXIS_Z } from "../../../assets/js/turtling/se3.js"

const near = (actual, expected) => assert.ok(Math.hypot(...actual.map((x, i) => x - expected[i])) < 1e-9,
    `${[...actual].map((n) => +n.toFixed(9))} != ${expected}`)
const placement = (frame) => worldTransform(frame)
// The door speaks the frame's own chart: state the wish as a WORLD point and cross once.
const drag = (s, frame, world) => s.requestMotion(frame,
    { ...frame.transform.deref(), position: toLocalPoint(placement(frame), world) }, s.motionRevision)
const home = (s, frame) => s.handHome(frame).position
const homeWorld = (s, frame) => toWorldPoint(placement(frame), home(s, frame))
const reset = (s, frame) => s.requestMotion(frame,
    { ...frame.transform.deref(), position: home(s, frame) }, s.motionRevision, null, { reset: true })

const WITNESS = "let B=(0,0,0)\ngoto 5 0\nlet a\nlet distance(a,B)=5"
const INVALID = "let B=(0,0,0)\ngoto 4 0\nlet a\nlet distance(a,B)=5"
const FREE = "goto 5 0\nlet a"
const PLANE = "goto 5 0\nlet a\nlet a.y = 3"

function seat(s, src, { fresh = false, origin, key = "host" } = {}) {
    const host = s.hotSwapChild(key, fork(key, src, origin), { fresh })
    drive(s)
    assert.deepEqual(s.errors, [])
    return host
}

test("a dormant sphere wish survives an identical replay", () => {
    const s = buildWorld()
    let host = seat(s, WITNESS)
    const a = host.children.get("a")
    near(worldOf(a), [5, 0, 0])
    assert.equal(drag(s, a, [0, 5, 0]).kind, "accept")
    near(worldOf(a), [0, 5, 0])
    host = seat(s, WITNESS, { fresh: true })
    const replayed = host.children.get("a")
    near(worldOf(replayed), [0, 5, 0])
    near(homeWorld(s, replayed), [5, 0, 0])
    host = seat(s, WITNESS, { fresh: true })
    near(worldOf(host.children.get("a")), [0, 5, 0])
    assert.equal(reset(s, host.children.get("a")).kind, "accept")
    near(worldOf(host.children.get("a")), [5, 0, 0])
})

test("with no input the replay keeps the law's own answer", () => {
    const s = buildWorld()
    seat(s, WITNESS)
    const host = seat(s, WITNESS, { fresh: true })
    near(worldOf(host.children.get("a")), [5, 0, 0])
})

test("an initially unsatisfied geometry retains the same wish", () => {
    const s = buildWorld()
    let host = seat(s, INVALID)
    const a = host.children.get("a")
    near(worldOf(a), [5, 0, 0])
    assert.equal(drag(s, a, [0, 5, 0]).kind, "accept")
    host = seat(s, INVALID, { fresh: true })
    near(worldOf(host.children.get("a")), [0, 5, 0])
    near(homeWorld(s, host.children.get("a")), [5, 0, 0])
})

test("a translation the sphere cannot express does not steer the law", () => {
    const s = buildWorld()
    let host = seat(s, FREE)
    const a = host.children.get("a")
    assert.equal(drag(s, a, [5, 3, 0]).kind, "accept")
    near(worldOf(a), [5, 3, 0])
    host = seat(s, WITNESS)
    near(worldOf(host.children.get("a")), [5, 0, 0])
    near(homeWorld(s, host.children.get("a")), [5, 0, 0])
})

test("a translation already expressed at birth is not applied twice", () => {
    const s = buildWorld()
    let host = seat(s, "let a")
    const a = host.children.get("a")
    assert.equal(drag(s, a, [2, 0, 0]).kind, "accept")
    host = seat(s, "let B=(7,0,0)\nlet a\nlet distance(a,B)=5")
    const replayed = host.children.get("a")
    near(worldOf(replayed), [2, 0, 0])
    near(homeWorld(s, replayed), [2, 0, 0])
    assert.equal(reset(s, replayed).kind, "accept")
    near(worldOf(replayed), [2, 0, 0])
})

test("a family that leaves the field is left alone, not doubled", () => {
    const s = buildWorld()
    let host = seat(s, FREE)
    const a = host.children.get("a")
    assert.equal(drag(s, a, [5, 3, 0]).kind, "accept")
    host = seat(s, PLANE)
    near(worldOf(host.children.get("a")), [5, 3, 0])
    near(homeWorld(s, host.children.get("a")), [5, 3, 0])
})

test("a sphere wish is inapplicable on a plane field and stays retained", () => {
    const s = buildWorld()
    let host = seat(s, WITNESS)
    const a = host.children.get("a")
    assert.equal(drag(s, a, [0, 5, 0]).kind, "accept")
    host = seat(s, PLANE)
    near(worldOf(host.children.get("a")), [5, 3, 0])
})

test("either authored spelling admits the same mover", () => {
    for (const src of [WITNESS, "let B=(0,0,0)\ngoto 5 0\nlet a\nlet distance(B,a)=5"]) {
        const s = buildWorld()
        let host = seat(s, src)
        const a = host.children.get("a")
        assert.equal(drag(s, a, [0, 5, 0]).kind, "accept")
        host = seat(s, src, { fresh: true })
        near(worldOf(host.children.get("a")), [0, 5, 0])
    }
})

test("a radius edit rebases the retained turn against the fixed anchor", () => {
    const s = buildWorld()
    let host = seat(s, WITNESS)
    const a = host.children.get("a")
    assert.equal(drag(s, a, [0, 5, 0]).kind, "accept")
    host = seat(s, "let B=(0,0,0)\ngoto 5 0\nlet a\nlet distance(a,B)=10")
    near(worldOf(host.children.get("a")), [0, 10, 0])
    assert.equal(reset(s, host.children.get("a")).kind, "accept")
    near(worldOf(host.children.get("a")), [10, 0, 0])
})

test("the source baseline, not the input's pose, becomes the baseline", () => {
    // The 3-4-5 point the translation reached is already lawful; it is still not the source.
    const s = buildWorld()
    let host = seat(s, "let a")
    const a = host.children.get("a")
    assert.equal(drag(s, a, [4, 4, 0]).kind, "accept")
    near(worldOf(a), [4, 4, 0])
    host = seat(s, "let B=(7,0,0)\nlet a\nlet distance(a,B)=5")
    const replayed = host.children.get("a")
    near(worldOf(replayed), [2, 0, 0])
    near(homeWorld(s, replayed), [2, 0, 0])
    // A compatible field again: the retained translation is still there, from the source.
    host = seat(s, "let a")
    const free = host.children.get("a")
    near(worldOf(free), [4, 4, 0])
    assert.equal(reset(s, free).kind, "accept")
    near(worldOf(free), [0, 0, 0])
})

test("the named meet draws its reference from the source, not the accepted pose", () => {
    const s = buildWorld()
    let host = seat(s, FREE)
    const a = host.children.get("a")
    assert.equal(drag(s, a, [5, 3, 0]).kind, "accept")
    host = seat(s, "let B=(0,0,0)\ngoto 5 0\nlet a\nlet a.z = 0\nlet distance(a,B)=5")
    near(worldOf(host.children.get("a")), [5, 0, 0])
    near(homeWorld(s, host.children.get("a")), [5, 0, 0])
})

test("an unrelated seat's retained input cannot reach this law", () => {
    const s = buildWorld()
    seat(s, WITNESS)
    const other = seat(s, "goto 1 0\nlet p", { key: "other" })
    const p = other.children.get("p")
    assert.equal(drag(s, p, [1, 3, 0]).kind, "accept")
    const host = seat(s, WITNESS, { fresh: true })
    near(worldOf(host.children.get("a")), [5, 0, 0])
    near(worldOf(p), [1, 3, 0])
})

test("a coupled free pair stays outside this seam", () => {
    // Both endpoints free: the isolated leaf's topology does not apply, so nothing is replayed.
    const src = "let A\njmp 5\nlet B\nlet distance(A,B)=5"
    const s = buildWorld()
    let host = seat(s, src)
    const A = host.children.get("A"), B = host.children.get("B")
    assert.equal(drag(s, A, [1, 0, 0]).kind, "accept")
    assert.equal(drag(s, B, [4, 3, 0]).kind, "accept")
    host = seat(s, src, { fresh: true })
    near(worldOf(host.children.get("A")), [0, 0, 0])
    near(worldOf(host.children.get("B")), [5, 0, 0])
})

test("a translated and rotated declaring parent answers the same wish", () => {
    // The parent's chart is not the world chart, so the door's basis is its placement, not origin.
    const origin = SE3.compose({ rotation: SE3.identity().rotation, position: [7, -3, 2] },
        SE3.rotateLocal(SE3.identity(), AXIS_Z, 37))
    const s = buildWorld()
    let host = seat(s, "goto 5 0\nlet a", { origin })
    const birth = worldOf(host.children.get("a"))
    // A pinned anchor five away holds the accepted prefix, so this stays the isolated leaf.
    const anchor = [birth[0] - 5, birth[1], birth[2]]
    const src = `let B=(${anchor.join(", ")})\ngoto 5 0\nlet a\nlet distance(a,B)=5`
    host = seat(s, src, { origin, fresh: true })
    const a = host.children.get("a")
    near(worldOf(a), birth)
    const turn = SE3.rotateLocal(SE3.identity(), AXIS_Z, 90).rotation
    const reach = birth.map((v, i) => v - anchor[i])
    const wish = anchor.map((v, i) => v + turn.rotateVec(reach[0], reach[1], reach[2])[i])
    assert.equal(drag(s, a, wish).kind, "accept")
    near(worldOf(a), wish)
    host = seat(s, src, { origin, fresh: true })
    near(worldOf(host.children.get("a")), wish)
    near(homeWorld(s, host.children.get("a")), birth)
})

test("the retained-input query is narrow: absence is false, never an error", () => {
    const IDENT = SE3.identity()
    let seq = 0
    const frameOf = (name, parent) => {
        let pose = { rotation: IDENT.rotation, position: [0, 0, 0] }
        const frame = { id: ++seq, name, parent, children: new Map(), isPlace: true, done: true,
            generator: null, actorState: null, error: null, unresolved: null, address: `addr/${name}`,
            transform: { deref: () => pose, swap: (fn) => { pose = fn() } } }
        parent.children.set(name, frame)
        return frame
    }
    const root = { id: ++seq, name: "root", children: new Map(), parent: undefined, isPlace: false }
    const seatFrame = frameOf("seat", root)
    seatFrame.isPlace = false
    seatFrame.reached = new Set(["p"])
    const p = frameOf("p", seatFrame)
    const hands = createHandState(new Map([[p.id, p]]),
        { transform: () => IDENT,
            read: (frame, overrides) => ({ ...(overrides?.get(frame) ?? frame.transform.deref()), time: 0 }) })
    const plan = hands.acceptance({ frame: p, reset: false },
        { pose: { rotation: IDENT.rotation, position: [2, 0, 0] }, component: [] }, [])
    assert.ok(plan?.install, "the move is accepted on an ordinary route")
    plan.install()
    assert.equal(hands.size, 1, "the store is not empty")
    assert.equal(hands.hasInput(null), false)
    assert.equal(hands.hasInput(undefined), false)
    assert.equal(hands.hasInput(p), true)
})

// --- the named meet: source order, its own baseline, and its out-of-domain boundary ---

const planeFirst = (d) => `let B=(0,0,0)\ngoto 5 0\nlet a\nlet a.z = 0\nlet ${d}=5`
const pairFirst = (d) => `let B=(0,0,0)\ngoto 5 0\nlet a\nlet ${d}=5\nlet a.z = 0`
const lawsOf = (s) => [...s.laws.active()].map((law) => law.feature).sort()

test("source order no longer decides whether a lawful named meet keeps its wish", () => {
    for (const src of [planeFirst("distance(a,B)"), planeFirst("distance(B,a)"),
        pairFirst("distance(a,B)"), pairFirst("distance(B,a)")]) {
        const s = buildWorld()
        let host = seat(s, src)
        const a = host.children.get("a")
        assert.equal(drag(s, a, [0, 5, 0]).kind, "accept")
        near(worldOf(a), [0, 5, 0])
        host = seat(s, src, { fresh: true })
        near(worldOf(host.children.get("a")), [0, 5, 0])
        near(homeWorld(s, host.children.get("a")), [5, 0, 0])
    }
})

test("the same four sources with no input keep the law's own answer", () => {
    for (const src of [planeFirst("distance(a,B)"), planeFirst("distance(B,a)"),
        pairFirst("distance(a,B)"), pairFirst("distance(B,a)")]) {
        const s = buildWorld()
        seat(s, src)
        const host = seat(s, src, { fresh: true })
        near(worldOf(host.children.get("a")), [5, 0, 0])
    }
})

test("a lawful translation on a plane lands on its own program baseline, twice", () => {
    // The 3-4-5 point is lawful but it is not the source: (2,0,0) is, in either order.
    const s = buildWorld()
    let host = seat(s, "let a")
    assert.equal(drag(s, host.children.get("a"), [4, 4, 0]).kind, "accept")
    near(worldOf(host.children.get("a")), [4, 4, 0])
    for (const src of ["let B=(7,0,0)\nlet a\nlet a.z = 0\nlet distance(a,B)=5",
        "let B=(7,0,0)\nlet a\nlet distance(a,B)=5\nlet a.z = 0"]) {
        host = seat(s, src, { fresh: true })
        near(worldOf(host.children.get("a")), [2, 0, 0])
    }
    host = seat(s, "let a", { fresh: true })
    near(worldOf(host.children.get("a")), [4, 4, 0])
})

test("the band case commits the source reference with its input dormant, and restores it", () => {
    // z sits 1e-9 outside the radius-5 sphere: a band-valid world whose nominal meet is
    // tangent-band (uncertain), not empty.
    const src = "let B=(0,0,0)\ngoto 0 0\nlet a\nlet a.z = 5.000000001\nlet distance(a,B)=5"
    const s = buildWorld()
    let host = seat(s, src)
    const a = host.children.get("a")
    assert.equal(drag(s, a, [0.001, 0, 5.000000001]).kind, "accept")
    const accepted = worldOf(a)
    const base = homeWorld(s, a)
    const delta = accepted.map((v, i) => v - base[i])   // the ACCEPTED choice, not the request
    assert.ok(Math.hypot(...delta) > 1e-6, "the acquisition actually moved the point")
    host = seat(s, src, { fresh: true })
    const replayed = host.children.get("a")
    assert.deepEqual(s.errors, [])
    assert.equal(lawsOf(s).length, 3, "all three rows stand")
    near(worldOf(replayed), [0, 0, 5.000000001], "the source reference is the committed answer")
    near(homeWorld(s, replayed), [0, 0, 5.000000001], "its baseline stands too")
    host = seat(s, "let a", { fresh: true })            // a compatible, unconstrained slot
    near(worldOf(host.children.get("a")), delta, "the dormant input restores from its baseline")
})

test("a large translated circle with no input keeps baseline, anchor and rows", () => {
    const S = 1e11
    const src = `let B=(${S}, ${S}, 0)\njmp 5\nlet a\nlet a.z = 0\nlet distance(a,B)=5`
    const origin = { rotation: SE3.identity().rotation, position: [S, S, 0] }
    const s = buildWorld()
    let host = seat(s, src, { origin })
    near(worldOf(host.children.get("a")), [S + 5, S, 0])
    near(worldOf(host.children.get("B")), [S, S, 0])
    assert.deepEqual(lawsOf(s), ["coordinate", "distance", "position"])
    host = seat(s, src, { origin, fresh: true })
    near(worldOf(host.children.get("a")), [S + 5, S, 0])
    near(worldOf(host.children.get("B")), [S, S, 0])
    assert.deepEqual(lawsOf(s), ["coordinate", "distance", "position"])
})

// The refusal itself needs the small-origin acquisition first, so it has its own test below.
test("a large translated circle keeps prefix, laws and input through a typed refusal", () => {
    const S = 1e11
    const smallSrc = "let B=(0,0,0)\njmp 5\nlet a\nlet a.z = 0\nlet distance(a,B)=5"
    const bigSrc = `let B=(${S}, ${S}, 0)\njmp 5\nlet a\nlet a.z = 0\nlet distance(a,B)=5`
    const origin = { rotation: SE3.identity().rotation, position: [S, S, 0] }
    const s = buildWorld()
    let host = seat(s, smallSrc)
    assert.equal(drag(s, host.children.get("a"), [5 * Math.SQRT1_2, 5 * Math.SQRT1_2, 0]).kind, "accept")
    host = s.hotSwapChild("host", fork("host", bigSrc, origin), { fresh: true })  // the refusal is the point
    drive(s)
    const a = host.children.get("a"), B = host.children.get("B")
    assert.equal(s.errors.length, 1)
    assert.equal(s.errors[0].kind, "rejected", "the refusal keeps its original typed semantics")
    assert.equal(s.errors[0].message, "the candidate fails its original truths")
    assert.deepEqual([...s.laws.active()].map((law) => law.feature).sort(), ["coordinate", "position"],
        "only the refused distance row is missing")
    near(worldOf(B), [S, S, 0], "the held anchor did not move")
    near(worldOf(a), [S + 5, S, 0], "the prefix stands, no partial geometry")
    host = seat(s, smallSrc, { fresh: true })
    near(worldOf(host.children.get("a")), [5 * Math.SQRT1_2, 5 * Math.SQRT1_2, 0],
        "the retained input survives for a compatible small-origin context")
})

test("a two-point tie stays outside this entry", () => {
    // A and B each carry a row: the meet names no single point, so the seam declines and the
    // replay is the bare source answer, exactly as before this repair.
    const src = "let A\njmp 5\nlet B\nlet A.z = 0\nlet B.z = 0\nlet distance(A,B)=5"
    const s = buildWorld()
    let host = seat(s, src)
    const A = host.children.get("A")
    assert.equal(drag(s, A, [5, 5, 0]).kind, "accept")
    host = seat(s, src, { fresh: true })
    near(worldOf(host.children.get("A")), [0, 0, 0])
    near(worldOf(host.children.get("B")), [5, 0, 0])
})
