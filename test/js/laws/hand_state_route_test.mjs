// The hand slot is a partial ordinary route: a private child of an installation has no
// keyable route, so it neither aliases nor clears an ordinary nested point. (id:laws-hand-action-state)
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"
import { pointStateOf } from "../../../assets/js/turtling/laws/point_state.js"
import { createHandState } from "../../../assets/js/turtling/laws/hand_state.js"

const W = (f) => f ? frameWorldTransform(f).position.map((v) => +v.toFixed(6)) : null
const move = (s, a, position) => s.requestMotion(a, { ...a.transform.deref(), position }, s.motionRevision)
const reset = (s, a) => s.requestMotion(a, { ...a.transform.deref() }, s.motionRevision, null, { reset: true })
const seat = (s, source, key = "host", options = {}) => {
    const host = s.hotSwapChild(key, fork(key, source), options)
    drive(s)
    return host
}

// Ordinary `host/A/p` and an installation named A (parent host, NOT in host.children)
// with its own private p: same display path, different ownership.
const WITNESS = `as A do
  let p
end
def attach receiver do
  as receiver do
    let p
    wait 10
  end
end
attach A`
const ORDINARY = "as A do\n  let p\nend"

const witnessSeat = (s) => {
    const host = seat(s, WITNESS)
    return { host, ordinary: host.children.get("A").children.get("p"), install: s.installationsOf(host)[0] }
}

test("a private installation drag neither leaks into nor inherits an ordinary nested point", () => {
    const s = buildWorld()
    const { ordinary, install } = witnessSeat(s)
    const priv = install.frame.children.get("p")
    assert.ok(priv && ordinary, "both same-named points exist")

    const verdict = move(s, priv, [4, 3, 0])
    assert.equal(verdict.kind, "accept")
    assert.equal(verdict.retention, "unsupported-route", "the move publishes, retention says why not")
    assert.deepEqual(W(priv), [4, 3, 0], "geometric permission is unchanged")

    const next = seat(s, ORDINARY).children.get("A").children.get("p")
    assert.deepEqual(W(next), [0, 0, 0], "the private drag did not leak into the ordinary point")
    assert.equal(next.handBase, undefined, "the ordinary slot has no retained input")
})

test("the ordinary nested route still retains across a re-reach", () => {
    const s = buildWorld()
    const { ordinary } = witnessSeat(s)
    assert.equal(move(s, ordinary, [4, 3, 0]).kind, "accept")
    const next = seat(s, ORDINARY).children.get("A").children.get("p")
    assert.deepEqual(W(next), [4, 3, 0], "the ordinary route retains")
})

test("seeding, private explicit reset and the ordinary action never cross routes", () => {
    const s = buildWorld()
    // The ordinary action exists BEFORE the installation child is ever seeded.
    const ordinary = seat(s, ORDINARY).children.get("A").children.get("p")
    assert.equal(move(s, ordinary, [2, 0, 0]).kind, "accept")

    const { ordinary: reOrdinary, install } = witnessSeat(s)
    assert.deepEqual(W(reOrdinary), [2, 0, 0], "the ordinary point is seeded from its own action")
    const priv = install.frame.children.get("p")
    assert.deepEqual(W(priv), [0, 0, 0], "a newly seeded private point does not inherit it")
    assert.equal(priv.handBase, undefined)

    // Explicit reset intent — never coordinate equality — is the only clear.
    const resetVerdict = reset(s, priv)
    assert.equal(resetVerdict.kind, "accept")
    assert.equal(resetVerdict.retention, undefined, "a reset is not an unsupported retention")

    const after = seat(s, ORDINARY).children.get("A").children.get("p")
    assert.deepEqual(W(after), [2, 0, 0], "the ordinary action survived the private reset")
})

test("a slot follows the registration key, not the top display name", () => {
    const s = buildWorld()
    const first = seat(s, "let q", "reg")
    assert.equal(move(s, first.children.get("q"), [3, 0, 0]).kind, "accept")

    // Same key, different display name: the slot is the registration key.
    const renamed = seat(s, "let q", "reg", { fresh: true })
    renamed.name = "display"
    assert.deepEqual(W(renamed.children.get("q")), [3, 0, 0], "the same key keeps the input")

    // Same display name, different key: a different participant.
    const other = seat(s, "let q", "other")
    assert.deepEqual(W(other.children.get("q")), [0, 0, 0], "a different key does not inherit")
})

// Direct map controls: an unsupported scope must neither clear nor wildcard the ordinary map.
test("forget/prune on an unsupported scope preserve the ordinary map", () => {
    const IDENT = SE3.identity()
    let seq = 0
    const mk = (name, parent, extra = {}) => {
        let pose = { rotation: IDENT.rotation, position: [0, 0, 0] }
        const f = { id: ++seq, name, parent, children: new Map(), isPlace: true, done: true,
            generator: null, actorState: null, error: null, unresolved: null, address: `addr/${name}`,
            transform: { deref: () => pose, swap: (fn) => { pose = fn() } }, ...extra }
        parent.children?.set(name, f)
        return f
    }
    const root = mk("root", { children: new Map() }, { isPlace: false })
    root.parent = undefined
    root.children.clear()
    const host = mk("host", root, { isPlace: false })
    host.reached = new Set(["A"])
    const A = mk("A", host)
    A.reached = new Set(["p"])
    const ordinary = mk("p", A)
    const install = mk("A", host, { isPlace: false })
    install.reached = new Set(["p"])
    host.children.delete("A")
    host.children.set("A", A)
    const priv = mk("p", install)
    const world = { transform: () => IDENT,
        read: (f) => ({ position: f.transform.deref().position, rotation: f.transform.deref().rotation, time: 0 }) }
    const hands = createHandState(new Map([[ordinary.id, ordinary], [priv.id, priv]]), world)

    const plan = hands.acceptance({ frame: ordinary, reset: false },
        { pose: { rotation: IDENT.rotation, position: [2, 0, 0] }, component: [] }, [])
    plan.install()
    const privatePlan = hands.acceptance({ frame: priv, reset: false },
        { pose: { rotation: IDENT.rotation, position: [4, 3, 0] }, component: [] }, [])
    assert.equal(privatePlan.retention, "unsupported-route")

    hands.forget(priv)
    hands.prune(priv)
    const out = hands.prepare([{ frame: ordinary, pose: { rotation: IDENT.rotation, position: [0, 0, 0] } }], [])
    assert.deepEqual(out[0].pose.position, [2, 0, 0], "the ordinary action survived both calls")
})

test("an incompatible retained input leaves accepted-state facts alone and claims no receipt", () => {
    const pick = (state) => ({
        status: state.status, tag: state.tag, at: state.at, refusal: state.refusal,
        offered: state.interaction.offered, movable: state.interaction.movable,
        dof: state.interaction.dof, locus: state.interaction.locus,
    })
    const plane = "let a\nlet a.z = 0"
    const sphere = "let a\nlet a.distance = 5"

    const fresh = buildWorld()
    const a0 = seat(fresh, plane).children.get("a")
    const state0 = pointStateOf(a0, fresh)
    assert.equal(state0.status, "accepted")
    assert.equal(state0.interaction.offered, true)

    const carried = buildWorld()
    let a = seat(carried, sphere).children.get("a")
    assert.equal(move(carried, a, [0, 5, 0]).kind, "accept")
    const accepted = W(a)
    a = seat(carried, plane).children.get("a")
    const state1 = pointStateOf(a, carried)
    assert.deepEqual(W(a), [0, 0, 0], "the inapplicable input keeps the source baseline")
    assert.deepEqual(pick(state1), pick(state0), "accepted-state facts are unchanged")
    assert.notDeepEqual(accepted, W(a), "the input is not applied")
    for (const key of ["applied", "refused", "disposed", "retention"]) {
        assert.equal(key in state1, false, `no ${key} claim on the state`)
        assert.equal(key in (carried.root._lastAttempt ?? {}), false, `no ${key} claim on the last decision`)
    }
})

test("a compatible input leaves the same facts when the accepted geometry is the same", () => {
    const pick = (state) => ({
        status: state.status, tag: state.tag, at: state.at, refusal: state.refusal,
        offered: state.interaction.offered, movable: state.interaction.movable,
        dof: state.interaction.dof, locus: state.interaction.locus,
    })
    // A literal-centred sphere: the locus does not move with the run cursor.
    const sphere = "let a\nlet distance(a, (0,0,0)) = 5"

    const carried = buildWorld()
    let a = seat(carried, sphere).children.get("a")
    assert.equal(move(carried, a, [0, 5, 0]).kind, "accept")
    const accepted = W(a)
    const exact = [...frameWorldTransform(a).position]
    const state1 = pointStateOf(a, carried)
    assert.equal(state1.interaction.offered, true)

    const authored = buildWorld()
    const placed = `goto ${exact.join(" ")}\n${sphere}`
    const a2 = seat(authored, placed).children.get("a")
    assert.deepEqual(W(a2), accepted, "the same accepted geometry, reached by source")
    assert.deepEqual(pick(pointStateOf(a2, authored)), pick(state1), "input presence is not a state fact")
})
