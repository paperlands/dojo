// A distance is undirected: neither endpoint is the answer, and the hand is offered
// only what the point's own state offers. Following is an installed policy, never a
// secret of endpoint spelling, and a headed declaring scope is never a hand's target.
// (id:laws-freedom, id:laws-build-p2d, id:laws-decl-point-agent, id:codex-prim-communication)
//
// Run: node --test test/js/laws/follower_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform, worldTransform } from "../../../assets/js/turtling/scheduler.js"
import { createGesture } from "../../../assets/js/turtling/laws/gesture.js"
import { stateOf } from "../../../assets/js/turtling/laws/constraints.js"
import { exposed } from "../../../assets/js/turtling/laws/batch.js"
import { sphere as sphereSet, point as pointSet } from "../../../assets/js/turtling/laws/meet.js"

const find = (frame, name) => {
    if (frame.name === name) return frame
    for (const child of frame.children.values()) {
        const hit = find(child, name)
        if (hit) return hit
    }
    return null
}
const pos = (frame) => frameWorldTransform(frame).position.map((n) => +n.toFixed(2))
const drag = (scheduler, frame, x) => scheduler.requestMotion(frame,
    // The drag speaks world positions; the door converts to the frame it must write.
    { rotation: frame.transform.deref().rotation, position: [x, 0, 0] }, scheduler.motionRevision, 'world').kind

// The offer rule, in one place for the fence: role, truth and status decide
// interaction. It is the same rule `turtle._stateOf` runs; kept here so the witness
// goes through the gesture's own door instead of around it. (id:laws-decl-point-agent)
const offer = (scheduler, frame) => {
    const headed = frame.generator != null || frame.actorState != null
    const constraints = []
    for (const law of scheduler.laws.active()) {
        if (law.feature === "distance" && (law.endpoints[0] === frame.id || law.endpoints[1] === frame.id)) {
            const otherId = law.endpoints[0] === frame.id ? law.endpoints[1] : law.endpoints[0]
            const other = scheduler.registry.get(otherId)
            if (other) {
                const at = frameWorldTransform(other).position
                const radius = law.predicate
                // The record carries its OWN resolved set; the policy fact stays separate.
                // (D058)
                constraints.push({ feature: "distance", otherHeld: other.generator != null || other.actorState != null,
                    set: radius > 0 ? sphereSet(at, radius) : pointSet(at) })
            }
        } else if (law.feature === "position" && law.endpoints[0] === frame.id) {
            constraints.push({ pinned: true, set: pointSet(frameWorldTransform(frame).position) })
        }
    }
    return stateOf({ at: frameWorldTransform(frame).position, headed, exposed: exposed(frame), constraints })
}

// A pixel screen at 100× with a straight-down ray, so a world point names a pixel.
const gestureFor = (scheduler, frames) => {
    const requests = []
    return createGesture({
        candidates: () => frames.filter((f) => offer(scheduler, f).interaction.offered).map((f) => ({ name: f.name, frame: f })),
        anchorOf: (frame) => frameWorldTransform(frame),
        birthOf: (frame) => worldTransform(frame),
        registered: (frame) => scheduler.registry.get(frame.id) === frame,
        canTouch: (frame) => offer(scheduler, frame).interaction.offered,
        requestMotion: (frame, pose, revision) => {
            requests.push({ frame, pose })
            return scheduler.requestMotion(frame, pose, revision)
        },
        revision: () => scheduler.motionRevision,
        wake: () => {},
        project: (world) => ({ x: world[0] * 100, y: world[1] * 100 }),
        rayAt: (x, y) => ({ origin: [x / 100, y / 100, 5], direction: [0, 0, -1] }),
        facing: () => [0, 0, -1],
        capture: () => {},
        release: () => {},
        setControls: () => {},
        controlsEnabled: () => true,
        onReadout: () => {},
    })
}

// One fixture, two spellings. Identity, scope, owner, predicate and request are
// held constant; only the order the law stores its ends changes. A=0, B=5, |AB|=5.
// BOTH fixtures are role-symmetric: two free points, one law, spelled either way. The
// earlier pair headed a different node in each, so it compared two different situations
// while claiming to compare one scenario.
const AB = "let A\njmp 5\nlet B\nlet distance(A,B)=5"
const BA = "let A\njmp 5\nlet B\nlet distance(B,A)=5"

test("undirected: one request lands one way whichever end the law stored first", () => {
    const run = (src) => {
        const scheduler = buildWorld({})
        const host = scheduler.hotSwapChild("host", fork("host", src))
        drive(scheduler)
        const A = find(host, "A")
        const B = find(host, "B")
        const law = scheduler.laws.active().find((l) => l.feature === "distance")
        assert.deepEqual([pos(A), pos(B)], [[0, 0, 0], [5, 0, 0]], "the fixture starts the same")
        assert.equal(drag(scheduler, A, 20), "accept")
        return { ends: law.endpoints.join(","), a: pos(A), b: pos(B) }
    }
    const one = run(AB)
    const two = run(BA)
    assert.notEqual(one.ends, two.ends, "the two laws really do spell their ends differently")
    assert.deepEqual(one.a, two.a, "the request moves A to one place, not two")
    assert.deepEqual(one.b, two.b, "and the answering B lands in one place")
    // The wish is the objective and the partner answers: A carries to the request and B
    // holds the length. Neither answer is a secret of how the law spelled its ends.
    // (id:laws-freedom, id:laws-free-relations-f2)
    assert.deepEqual(one.a, [20, 0, 0], "A carries to the wish")
    assert.deepEqual(one.b, [15, 0, 0], "B answers to keep the length")
})

// A headed declaring scope is never a hand's target, and a coincident point whose
// reference is held is pinned. The gesture offers neither; only the free sphere point
// is claimed. (id:laws-decl-point-agent)
test("gesture: the hand is offered only what the point's state offers", () => {
    const sphere = buildWorld({})
    const sphereHost = sphere.hotSwapChild("host", fork("host", "let H\njmp 5\nlet A\nas A do\n  let H.distance = 5\nend"))
    drive(sphere)
    const sphereH = find(sphereHost, "H")
    const sphereA = find(sphereHost, "A")
    assert.equal(offer(sphere, sphereH).interaction.offered, true, "a free point on its sphere is offered")
    assert.equal(offer(sphere, sphereA).interaction.offered, false, "the headed reference is not a hand's target")
    const sphereGesture = gestureFor(sphere, [sphereH, sphereA])
    const down = sphereGesture.pointerDown({ pointerId: 1, x: pos(sphereH)[0] * 100, y: 0 })
    assert.equal(down.claimed, true, "the gesture claims the offered point, not the headed one")

    const pin = buildWorld({})
    const pinHost = pin.hotSwapChild("host", fork("host", "let H\njmp 5\nlet A\nas A do\n  let H.distance = 0\nend"))
    drive(pin)
    const pinH = find(pinHost, "H")
    const pinA = find(pinHost, "A")
    assert.equal(offer(pin, pinH).truth.pinned, true, "a coincidence with a held reference pins")
    assert.equal(offer(pin, pinH).interaction.offered, false, "and is not offered")
    assert.equal(offer(pin, pinA).interaction.offered, false)
    assert.equal(gestureFor(pin, [pinH, pinA]).pointerDown({ pointerId: 1, x: 0, y: 0 }).claimed, false,
        "the gesture claims neither")
})

test("following is an installed policy, not endpoint spelling", () => {
    // The policy: A is the leader, H its follower. It is a scheduler-level responder;
    // the law itself is not a direction. (id:laws-build-p2d)
    const follow = (leader, dependent) => ({ command, requested, frame }) => {
        if (command !== "hand" || frame.name !== leader) return { accepted: true, transform: requested }
        const dep = frame.parent.children.get(dependent)
        return { accepted: true, transform: requested, component: [
            { frame: dep, transform: { rotation: dep.transform.deref().rotation, position: requested.position } },
        ] }
    }
    const scheduler = buildWorld({ admit: follow("A", "H") })
    const host = scheduler.hotSwapChild("host", fork("host", "let H\njmp 100\nlet A\nas A do\n  let H.distance = 0\nend"))
    drive(scheduler)
    const A = find(host, "A")
    const H = find(host, "H")
    assert.equal(drag(scheduler, A, 50), "accept")
    assert.deepEqual(pos(A), [50, 0, 0], "the policy lets the touched reference take the request")
    assert.deepEqual(pos(H), [50, 0, 0], "and the declared policy makes its dependent follow")
})

test("built-in: dragging the dependent projects it, it does not drive", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", "let H\njmp 100\nlet A\nas A do\n  let H.distance = 0\nend"))
    drive(scheduler)
    const H = find(host, "H")
    assert.equal(drag(scheduler, H, 30), "accept", "a request is admitted")
    assert.deepEqual(pos(H), [100, 0, 0], "but it is projected back onto its reference")
    assert.equal(scheduler.laws.active().length, 1, "still one coupling")
})
