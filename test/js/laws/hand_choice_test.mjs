// A held record's choices are an OFFERED layer under session-local choices. Presence,
// replacement and reset are per slot; a mask never reveals a weaker layer.
// (id:laws-construction-input)
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

const pose = (position) => ({ rotation: IDENT.rotation, position })
const accept = (hands, frame, position, laws = []) => {
    const plan = hands.acceptance(
        { frame, reset: false },
        { pose: pose(position), component: [] },
        laws,
    )
    assert.ok(plan?.install, "the move is accepted on an ordinary route")
    plan.install()
}
const reset = (hands, frame) => {
    const plan = hands.acceptance(
        { frame, reset: true },
        { pose: frame.transform.deref(), component: [] },
        [],
    )
    assert.ok(plan?.install, "reset is an accepted intent")
    plan.install()
}
const translation = (x) => ({ kind: "translation", by: [x, 0, 0] })

test("offer copies at the boundary and flattens one seat's effective choices", () => {
    const { registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["p"])
    const p = host.children.get("p")
    place(p, [0, 0, 0])

    const action = translation(2)
    const names = ["p"]
    assert.equal(hands.offer(host, [{ names, action }]), true)
    action.by[0] = 99
    names.push("forged")

    const prepared = hands.prepare([{ frame: p, pose: pose([0, 0, 0]) }], [])
    assert.deepEqual(prepared[0].pose.position, [2, 0, 0], "the offer was copied, not aliased")
    assert.deepEqual(hands.choices(host), [{ names: ["p"], action: translation(2) }])
    hands.seed(p)
    assert.equal(hands.hasInput(p), true)
})

test("a sparse or nested non-seat offer admits nothing", () => {
    const { registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["A"])
    const A = host.children.get("A")
    place(A, [0, 0, 0])

    assert.equal(hands.offer(host, [{ names: Array(1), action: translation(2) }]), false)
    assert.equal(hands.offer(A, [{ names: ["p"], action: translation(2) }]), false,
        "a nested frame is not a seat")
    assert.deepEqual(hands.choices(host), [])
})

test("an untouched offer is replaced per slot, never compounded", () => {
    const { registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["p"])
    const p = host.children.get("p")
    place(p, [0, 0, 0])

    hands.offer(host, [{ names: ["p"], action: translation(2) }])
    assert.deepEqual(hands.prepare([{ frame: p, pose: pose([0, 0, 0]) }], [])[0].pose.position, [2, 0, 0])
    hands.offer(host, [{ names: ["p"], action: translation(5) }])
    assert.deepEqual(hands.prepare([{ frame: p, pose: pose([0, 0, 0]) }], [])[0].pose.position, [5, 0, 0],
        "the second offer replaces the first; it is not 2+5")
})

test("a local choice wins an untouched offered update", () => {
    const { registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["p"])
    const p = host.children.get("p")
    place(p, [0, 0, 0])

    hands.offer(host, [{ names: ["p"], action: translation(2) }])
    hands.prepare([{ frame: p, pose: pose([0, 0, 0]) }], [])
    accept(hands, p, [3, 0, 0])
    hands.offer(host, [{ names: ["p"], action: translation(5) }])

    assert.deepEqual(hands.prepare([{ frame: p, pose: pose([0, 0, 0]) }], [])[0].pose.position, [3, 0, 0])
    assert.deepEqual(hands.choices(host), [{ names: ["p"], action: translation(3) }])
})

test("reset leaves a mask that outlives handBase and suppresses later offers", () => {
    const { registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["p"])
    const p = host.children.get("p")
    place(p, [0, 0, 0])

    hands.offer(host, [{ names: ["p"], action: translation(3) }])
    assert.deepEqual(hands.prepare([{ frame: p, pose: pose([0, 0, 0]) }], [])[0].pose.position, [3, 0, 0])
    reset(hands, p)

    assert.equal(p.handBase, null, "reset clears the retained baseline")
    assert.equal(hands.hasInput(p), false, "a mask is not a retained action")
    assert.deepEqual(hands.choices(host), [], "a mask is not offered as a choice")
    assert.deepEqual(hands.prepare([{ frame: p, pose: pose([7, 0, 0]) }], [])[0].pose.position, [7, 0, 0],
        "the inherited 3 is suppressed")

    hands.offer(host, [{ names: ["p"], action: translation(9) }])
    assert.deepEqual(hands.prepare([{ frame: p, pose: pose([7, 0, 0]) }], [])[0].pose.position, [7, 0, 0],
        "a later offer does not reveal through the mask")
})

test("an incompatible local choice does not fall through to an offered family", () => {
    const { registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["A"])
    const other = seat("other", ["B"])
    const A = host.children.get("A"), B = other.children.get("B")
    place(A, [5, 0, 0])
    place(B, [0, 0, 0])
    const law = { feature: "distance", endpoints: [A.id, B.id], frame: host.id, scope: host.id,
        expression: { type: "distance", references: [A.id, B.id], radius: 5 } }

    accept(hands, A, [0, 5, 0], [law])                  // local sphere choice
    hands.offer(host, [{ names: ["A"], action: translation(5) }])   // offered translation

    const prepared = hands.prepare([{ frame: A, pose: pose([5, 0, 0]) }], [law])
    const out = prepared[0].pose.position.map((v) => +v.toFixed(6))
    assert.deepEqual(out, [0, 5, 0], "the local sphere is interpreted, not the offered translation")
    assert.notDeepEqual(out, [10, 0, 0])
})

test("a malformed later entry admits nothing, leaving the old offer intact", () => {
    const { registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["p"])
    const p = host.children.get("p")
    place(p, [0, 0, 0])

    hands.offer(host, [{ names: ["p"], action: translation(2) }])
    assert.equal(hands.offer(host, [
        { names: ["p"], action: translation(5) },
        { names: ["p"], action: null },
    ]), false)
    assert.deepEqual(hands.prepare([{ frame: p, pose: pose([0, 0, 0]) }], [])[0].pose.position, [2, 0, 0])
    assert.equal(hands.offer(host, [
        { names: ["p"], action: translation(5) },
        { names: ["p"], action: translation(6) },
    ]), false, "duplicate routes are refused")
})

test("an offer is scoped to its seat, and a dormant family stays present but unapplied", () => {
    const { registry, seat, world: w } = world()
    const hands = createHandState(registry, w)
    const host = seat("host", ["p"])
    const other = seat("other", ["q"])
    const p = host.children.get("p"), q = other.children.get("q")
    place(p, [0, 0, 0])
    place(q, [0, 0, 0])

    const sphere = { kind: "sphere", rotation: { w: Math.SQRT1_2, x: 0, y: 0, z: Math.SQRT1_2 } }
    hands.offer(host, [{ names: ["p"], action: sphere }])

    assert.deepEqual(hands.choices(other), [], "another seat is not sampled")
    const prepared = hands.prepare([{ frame: p, pose: pose([0, 0, 0]) }], [])
    assert.deepEqual(prepared[0].pose.position, [0, 0, 0], "no sphere locus: dormant")
    assert.ok(prepared[0].handBase, "the baseline is retained")
    hands.seed(p)
    assert.equal(hands.hasInput(p), true, "presence is not application")

    hands.forget(host)
    assert.equal(hands.hasInput(p), false)
    assert.deepEqual(hands.choices(host), [])
})
