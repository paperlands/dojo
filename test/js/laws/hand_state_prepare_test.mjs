// prepare's fast path is an identity decision: no ELIGIBLE candidate with a retained input
// returns the SAME array, and one sampled placement feeds overrides and output.
// (id:laws-hand-action-state)
import { test } from "node:test"
import assert from "node:assert/strict"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { createHandState } from "../../../assets/js/turtling/laws/hand_state.js"

let seq = 0
const IDENT = SE3.identity()
const place = (frame, position) => frame.transform.swap(() => ({ rotation: IDENT.rotation, position }))

const frameOf = (name, parent, overrides = {}) => {
    let pose = { rotation: IDENT.rotation, position: [0, 0, 0] }
    const frame = {
        id: ++seq, name, parent, children: new Map(), isPlace: true, done: true,
        generator: null, actorState: null, error: null, unresolved: null, address: `addr/${name}`,
        transform: { deref: () => pose, swap: (fn) => { pose = fn() } },
        ...overrides,
    }
    parent.children.set(name, frame)
    return frame
}

const world = () => {
    const root = frameOf("root", { children: new Map() })
    root.parent = undefined
    root.children.clear()
    root.isPlace = false
    const registry = new Map()
    const seat = (key, names) => {
        const s = frameOf(key, root)
        s.isPlace = false
        s.reached = new Set(names)
        for (const name of names) registry.set(frameOf(name, s).id, s.children.get(name))
        return s
    }
    const w = {
        transform: () => IDENT,
        read: (frame, overrides) => {
            const pose = overrides?.get(frame) ?? frame.transform.deref()
            return { position: pose.position, rotation: pose.rotation, time: 0 }
        },
    }
    return { root, registry, seat, world: w }
}

const accept = (hands, frame, position, laws = []) => {
    const plan = hands.acceptance(
        { frame, reset: false },
        { pose: { rotation: frame.transform.deref().rotation, position }, component: [] },
        laws,
    )
    assert.ok(plan?.install, "the move is accepted on an ordinary route")
    plan.install()
}

const counter = (w) => {
    const original = w.transform
    const state = { samples: 0 }
    w.transform = (frame) => { state.samples++; return original(frame) }
    return state
}

test("no matching slot returns the original poses array; a match samples once", () => {
    const { registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["p"])
    const other = seat("other", ["q"])
    place(host.children.get("p"), [0, 0, 0])
    const p = host.children.get("p"), q = other.children.get("q")
    accept(hands, p, [2, 0, 0])

    const samples = counter(w)
    const foreign = [{ frame: q, pose: { rotation: IDENT.rotation, position: [0, 0, 0] } }]
    assert.equal(hands.prepare(foreign, []), foreign, "no-match returns the SAME array")
    assert.equal(samples.samples, 0, "no-match samples no placement")

    const matched = [{ frame: p, pose: { rotation: IDENT.rotation, position: [0, 0, 0] } }]
    const prepared = hands.prepare(matched, [])
    assert.notEqual(prepared, matched, "a match rebuilds the entry list")
    assert.equal(samples.samples, 1, "one placement sample per eligible entry")
    assert.deepEqual(prepared[0].pose.position, [2, 0, 0])
    assert.deepEqual(prepared[0].handBase.position, [0, 0, 0], "the unadjusted baseline is kept")
})

test("ineligible entries neither probe slots nor match: root and body-owned", () => {
    const { root, registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["p"])
    const p = host.children.get("p")
    place(p, [0, 0, 0])
    accept(hands, p, [2, 0, 0])

    // A parentless root: slot probing here would read parent.children of undefined.
    const rootEntry = [{ frame: root, pose: { rotation: IDENT.rotation, position: [0, 0, 0] } }]
    assert.equal(hands.prepare(rootEntry, []), rootEntry, "a root is not a hand destination")

    // The same slot, but a body owns the position now: ineligible, so not a match.
    const owned = frameOf("p", host, { generator: () => 0 })
    const ownedEntry = [{ frame: owned, pose: { rotation: IDENT.rotation, position: [0, 0, 0] } }]
    assert.equal(hands.prepare(ownedEntry, []), ownedEntry, "a body-owned slot does not match")
})

test("a stated-world entry is sampled once and keeps its accepted rotation", () => {
    const { registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["p"])
    const p = host.children.get("p")
    place(p, [0, 0, 0])
    accept(hands, p, [2, 0, 0])

    const samples = counter(w)
    const worldPose = { rotation: IDENT.rotation, position: [2, 0, 0] }
    const prepared = hands.prepare([{ frame: p, pose: worldPose, stated: true, ref: "world" }], [])
    assert.equal(samples.samples, 1, "a stated entry crosses the placement once")
    assert.deepEqual(prepared[0].pose.position, [4, 0, 0])
    assert.ok(prepared[0].handBaseWorld, "the stated shape keeps its world baseline")
    assert.deepEqual(prepared[0].pose.rotation, worldPose.rotation, "the accepted rotation is untouched")
})

test("a foreign sibling is still an unadjusted override for the matched locus", () => {
    const { registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["A"])
    const other = seat("other", ["B"])
    const A = host.children.get("A"), B = other.children.get("B")
    place(A, [5, 0, 0])
    place(B, [0, 0, 0])
    const law = { feature: "distance", endpoints: [A.id, B.id], frame: host.id, scope: host.id,
        expression: { type: "distance", references: [A.id, B.id], radius: 5 } }
    accept(hands, A, [0, 5, 0], [law])          // a quarter turn on the sphere about B

    const poses = [
        { frame: A, pose: { rotation: IDENT.rotation, position: [15, 0, 0] } },
        { frame: B, pose: { rotation: IDENT.rotation, position: [10, 0, 0] } },
    ]
    const prepared = hands.prepare(poses, [law])
    // The sphere is about B's UNADJUSTED override (10,0): (15,0) turns to (10,5), not (0,15).
    assert.deepEqual(prepared[0].pose.position.map((v) => +v.toFixed(6)), [10, 5, 0])
    assert.equal(prepared[1], poses[1], "the sibling entry is untouched")
})
