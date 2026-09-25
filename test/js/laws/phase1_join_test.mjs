// Phase 1c — join and keep, under the being act.
//
// `let A` is a being act: a new identity seats at the walk's state, and an
// existing one adopts the current head's state. Identity and body are kept; the
// hand's earlier move is revised by a later reach. Joining (`as`) attaches a head
// to that same identity. The ordinary (undeclared) re-entry is the control.
//
// (id:laws-ordered-birth, id:laws-decl-join-repair, id:laws-order-lifetime)
// Run: node --test test/js/laws/phase1_join_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { reparseProgram } from "../../../assets/js/turtling/parse.js"
import { createGesture } from "../../../assets/js/turtling/laws/gesture.js"
import { frameWorldTransform, worldTransform } from "../../../assets/js/turtling/scheduler.js"
import { exposed, freePoint, pointCandidates } from "../../../assets/js/turtling/laws/batch.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const pos = (frame) => frame.transform.deref().position.map((n) => +n.toFixed(6))
const at = (frame, ...want) => assert.deepEqual(pos(frame), want)

// `let a`, walk 50, pause, re-reach `let a`, then join and step. The hand moves
// the free point during the pause; the second being act adopts the walk's state.
const REVISED = "let a\nfw 50\nwait 1\nlet a\nas a do\n  fw 1\nend"
// The same shape without the second reach: the hand's move survives into joining.
const KEPT = "let a\nwait 1\nas a do\n  fw 1\nend"

// `buildWorld()` installs no responder: an existence declaration's own admission
// is the identity, so the hand may move the free point.
function walk(source) {
    const spec = fork("host", source)
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", spec)
    const a = host.children.get("a")
    assert.equal(freePoint(a), true, "a reached let is a free point")
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(a, { rotation: a.transform.deref().rotation,
        position: [3, 0, 0] }, revision).kind, "accept")
    drive(scheduler)
    return { spec, scheduler, host, a }
}

test("acceptance: a re-reached let revises the being to the current head state", () => {
    const { a } = walk(REVISED)
    // born [0,0,0]; walk to [50,0,0]; hand moves it to [3,0,0]; the second
    // `let a` adopts [50,0,0]; joining adds fw 1 from there.
    at(a, 51, 0, 0)
    assert.equal(freePoint(a), false, "as a gave that same identity a head")
})

test("acceptance: the revised and joined identity is the registry's", () => {
    const { scheduler, a } = walk(REVISED)
    assert.equal(scheduler.registry.get(a.id), a, "one live identity, never a stale frame")
    assert.equal(a.isPlace, true, "it remains the declared place")
})

test("acceptance: same-play re-seat and green-tree edit retain identity and geometry", () => {
    const { spec, scheduler, host, a } = walk(REVISED)
    const held = scheduler.hotSwapChild("host", spec)
    assert.equal(held, host, "an unchanged seed holds the seat")
    assert.equal(held.children.get("a"), a, "and the same identity")
    at(a, 51, 0, 0)

    // A whitespace-only edit reuses the source node: the seat and the accepted
    // geometry survive without a restart.
    const edited = reparseProgram(REVISED.replace("  fw 1", "    fw 1"), REVISED, spec.code.ast)
    const green = scheduler.hotSwapChild("host", { ...spec, code: { ...spec.code, ast: edited } })
    assert.equal(green, host, "a green-tree edit retained the seat")
    assert.equal(green.children.get("a"), a)
    at(a, 51, 0, 0)
})

test("acceptance: without a later reach the hand's move survives into joining", () => {
    const { a } = walk(KEPT)
    // born [0,0,0]; the hand moves it to [3,0,0]; as a joins from there; fw 1.
    at(a, 4, 0, 0)
})

test("acceptance: fresh play reconstructs without inherited hand state", () => {
    const { scheduler, a } = walk(KEPT)
    const next = scheduler.hotSwapChild("host", fork("host", KEPT), { fresh: true })
    drive(scheduler)
    const again = next.children.get("a")
    assert.notEqual(again, a, "a fresh play realizes anew")
    assert.notEqual(again.id, a.id)
    assert.equal(freePoint(again), false, "the reconstructed a is headed again")
    at(again, 1, 0, 0)             // no [3,0,0] hand contribution: fw 1 from the origin
})

test("acceptance: equal positions are not one identity", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let a\nlet b\nas a do\n  fw 0\nend"))
    drive(scheduler)
    const a = host.children.get("a")
    const b = host.children.get("b")
    assert.notEqual(a, b)
    assert.notEqual(a.id, b.id)
    at(a, 0, 0, 0)
    at(b, 0, 0, 0)
    assert.equal(scheduler.registry.get(a.id), a)
    assert.equal(scheduler.registry.get(b.id), b)
})

test("acceptance: removing the introduction keeps a surviving headed identity", () => {
    // The declaring scope is rewired without the let: exposure goes, the head stays.
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", [
        "as s do", "  let a", "  as a do", "    fw 1", "  end", "end",
        "wait 1",
        "as s do", "end",
    ].join("\n")))
    drive(scheduler)
    const s = host.children.get("s")
    const a = s.children.get("a")
    assert.ok(a, "the headed identity survived the rewiring")
    assert.equal(a.isPlace, true, "it was seated as a place")
    assert.equal(freePoint(a), false, "and it keeps its head")
    assert.equal(exposed(a), false, "the current batch no longer exposes it")
    at(a, 1, 0, 0)
})

test("control: ordinary undeclared re-entry still re-places and restarts", () => {
    const scheduler = buildWorld()
    scheduler.hotSwapChild("host", fork("host", [
        "as a do", "  goto 3 0", "  rt 90", "end",
        "goto 20 0", "rt 45",
        "as a do", "  fw 1", "end",
    ].join("\n")))
    drive(scheduler)
    const a = find(scheduler.root, "a")
    at(a, 1, 0, 0)                 // the body restarted at identity
    assert.deepEqual(a.origin.position.map((n) => +n.toFixed(6)), [20, 0, 0],
        "ordinary re-entry re-places at the caller")
})

// Phase 1d — the meaning in play. (id:laws-build-p1d-verdict)

test("acceptance: a turned walk orients a never-headed point", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host", "rt 90\nfw 100\nlet A\nas A do\n  fw 50\nend"))
    drive(scheduler)
    const a = host.children.get("A")
    // The being act adopts the head's state, so A is born turned and its body
    // walks along that heading: rt 90 → fw along −y.
    assert.deepEqual(frameWorldTransform(a).position.map((n) => +n.toFixed(6)), [0, -150, 0],
        "the first body starts along the adopted heading")
})

test("acceptance: a touch selects the topmost coincident point", () => {
    const scheduler = buildWorld()
    const host = scheduler.hotSwapChild("host", fork("host", "let a\nlet b"))
    drive(scheduler)
    const a = host.children.get("a")
    const b = host.children.get("b")
    assert.deepEqual(pointCandidates([a, b]).map((f) => f.name), ["b", "a"],
        "the most recently introduced is on top")

    const view = {
        project: (w) => ({ x: w[0] * 100, y: w[1] * 100 }),
        rayAt: (x, y) => ({ origin: [x / 100, y / 100, 5], direction: [0, 0, -1] }),
        facing: () => [0, 0, -1],
    }
    const gesture = createGesture({
        candidates: () => pointCandidates([...scheduler.registry.values()])
            .map((f) => ({ name: f.name, frame: f })),
        anchorOf: (f) => frameWorldTransform(f),
        birthOf: (f) => worldTransform(f),
        registered: (f) => scheduler.registry.get(f.id) === f,
        canTouch: freePoint,
        requestMotion: (f, pose, rev) => scheduler.requestMotion(f, pose, rev),
        revision: () => scheduler.motionRevision,
        wake: () => {},
        project: view.project,
        rayAt: view.rayAt,
        facing: view.facing,
        capture: () => {},
        release: () => {},
        setControls: () => {},
        controlsEnabled: () => true,
        onReadout: () => {},
    })
    const at = view.project(frameWorldTransform(a).position)
    assert.equal(gesture.pointerDown({ pointerId: 1, x: at.x, y: at.y }).frame, b,
        "the top point is claimed")
    gesture.pointerCancel({ pointerId: 1 })

    // Drag the top point away; the one beneath becomes the only candidate there.
    const rev = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(b, { rotation: b.transform.deref().rotation,
        position: [2, 0, 0] }, rev).kind, "accept")
    const at2 = view.project(frameWorldTransform(a).position)
    assert.equal(gesture.pointerDown({ pointerId: 2, x: at2.x, y: at2.y }).frame, a,
        "then the point beneath")
})
