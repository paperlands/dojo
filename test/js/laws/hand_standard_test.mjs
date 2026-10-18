// The STANDARD hand: a point dragged by requestMotion, with nothing installed.
//
// These are the two controls the laboratory adapter's counterexample probe carried
// (now probe/composted/free-point-follow/composition_contract.mjs), stated against the ordinary door
// so they survive the experiment's removal. Nothing here imports the laboratory.
// (id:laws-free-relations-compositional-center, id:laws-figures-phase34-ref)
//
// Run: node --test test/js/laws/hand_standard_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, drive, worldOf } from "./harness.mjs"
import { frameWorldTransform, worldTransform } from "../../../assets/js/turtling/scheduler.js"
import { SE3, AXIS_Z } from "../../../assets/js/turtling/se3.js"

const gap = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]))
const r6 = (v) => v.map((n) => +n.toFixed(6))
const heading = (frame) => frameWorldTransform(frame).rotation.rotateVec(1, 0, 0)

function build(source) {
    const scheduler = buildWorld({})            // the ordinary door: no responder installed
    const host = scheduler.hotSwapChild("host", fork("host", source))
    drive(scheduler)
    assert.deepEqual(scheduler.errors, [])
    return { scheduler, at: (name) => host.children.get(name) }
}

test("a request stated in a named frame lands at that frame's world point", () => {
    // R stands 15 past B at 20, so a request for 3 IN R is world 23 — a frame, not an offset
    // from the writer. The follower is carried to 5 behind the writer, still bound.
    const { scheduler, at } = build("let A\njmp 5\nlet B\nlet distance(A,B)=5\njmp 15\nlet R")
    assert.deepEqual(r6(worldOf(at("R"))), [20, 0, 0], "the named frame stands where it was declared")
    const verdict = scheduler.requestMotion(at("B"),
        { rotation: SE3.identity().rotation, position: [3, 0, 0] }, scheduler.motionRevision, "R")
    assert.equal(verdict.kind, "accept", `verdict ${verdict.kind} ${verdict.message ?? ""}`)
    assert.equal(scheduler.root._lastAttempt.gate.status, "valid")
    assert.deepEqual(r6(worldOf(at("B"))), [23, 0, 0], "the writer landed on the named frame's point")
    assert.deepEqual(r6(worldOf(at("A"))), [18, 0, 0], "the follower kept its bond")
    assert.ok(Math.abs(gap(worldOf(at("A")), worldOf(at("B"))) - 5) < 1e-9)
})

test("a pinned partner does not erase the writer's REQUESTED turn", () => {
    // A turn is the writer's own intent: a partner that cannot move changes where the pair may
    // sit, never the heading the writer asked for. (The laboratory adapter's fallback answered
    // with the ACCEPTED heading here; this is the behaviour that replaces it.)
    const turn = SE3.rotateLocal(SE3.identity(), AXIS_Z, 20).rotation
    const { scheduler, at } = build("let A=(0,0,0)\nlet B\nlet distance(A,B)=5")
    const writer = at("B")
    const before = heading(writer)
    const verdict = scheduler.requestMotion(writer,
        { rotation: turn, position: frameWorldTransform(writer).position }, scheduler.motionRevision, "world")
    assert.equal(verdict.kind, "accept", `verdict ${verdict.kind} ${verdict.message ?? ""}`)
    const landed = heading(writer)
    assert.ok(gap(turn.rotateVec(1, 0, 0), landed) < 1e-9,
        `landed ${landed} but the request asked for ${turn.rotateVec(1, 0, 0)}`)
    assert.ok(gap(before, landed) > 1e-6, "the writer actually turned")
    assert.deepEqual(r6(worldOf(at("A"))), [0, 0, 0], "the pinned partner did not move")
})

test("the same turn on a free pair lands identically: the pin changed no heading right", () => {
    const turn = SE3.rotateLocal(SE3.identity(), AXIS_Z, 20).rotation
    const { scheduler, at } = build("let A\njmp 5\nlet B\nlet distance(A,B)=5")
    const writer = at("B")
    const verdict = scheduler.requestMotion(writer,
        { rotation: turn, position: frameWorldTransform(writer).position }, scheduler.motionRevision, "world")
    assert.equal(verdict.kind, "accept")
    assert.ok(gap(turn.rotateVec(1, 0, 0), heading(writer)) < 1e-9, "a free partner preserves the turn too")
})

// --- migrated from the retired encounter: the invariants that were never about the adapter ---

test("either endpoint leads, and an unchanged request invents no further motion", () => {
    const { scheduler, at } = build("let A\njmp 5\nlet B\nlet distance(A,B)=5")
    const wish = (frame, position) => scheduler.requestMotion(frame,
        { ...frameWorldTransform(frame), position }, scheduler.motionRevision, "world")
    assert.equal(wish(at("B"), [8, 0, 0]).kind, "accept")
    assert.ok(Math.abs(gap(worldOf(at("A")), [3, 0, 0])) < 1e-9, "the partner was carried")
    const revision = scheduler.motionRevision
    assert.equal(wish(at("B"), [8, 0, 0]).kind, "accept", "an unchanged request is still lawful")
    assert.equal(scheduler.motionRevision, revision, "and it invents no commit")
    assert.equal(wish(at("A"), [3, 0, 0]).kind, "accept", "the other endpoint leads too")
    assert.ok(Math.abs(gap(worldOf(at("B")), [8, 0, 0])) < 1e-9)
})

test("a rotated and translated parent answers the same world wish the same way", () => {
    const origin = SE3.compose({ rotation: SE3.identity().rotation, position: [7, -3, 2] },
        { rotation: SE3.rotateLocal(SE3.identity(), AXIS_Z, 37).rotation, position: [0, 0, 0] })
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", "let A\njmp 5\nlet B\nlet distance(A,B)=5", origin))
    drive(scheduler)
    const B = host.children.get("B")
    const wish = SE3.apply(origin, [9, 4, 0])
    assert.equal(scheduler.requestMotion(B, { ...frameWorldTransform(B), position: wish },
        scheduler.motionRevision, "world").kind, "accept")
    assert.ok(gap(worldOf(B), wish) < 1e-9, `landed ${worldOf(B)} not ${wish}`)
    assert.ok(Math.abs(gap(worldOf(host.children.get("A")), wish) - 5) < 1e-9, "the bond holds in the rotated room")
})

test("a parent-frame ceiling certifies the same expanded poses that publish", () => {
    const origin = SE3.compose({ rotation: SE3.identity().rotation, position: [7, -3, 2] },
        SE3.rotateLocal(SE3.identity(), AXIS_Z, 37))
    const seen = []
    let capture = false
    const scheduler = buildWorld({ validate: ({ request, entries, entriesRef }) => {
        if (capture) {
            // The ceiling reads ONE convention and it is the request's own: the entries and
            // `request.requested` are both in `request.ref`. (id:laws-figures-phase34-hand-frame)
            assert.equal(request.ref, "parent")
            assert.equal(entriesRef, request.ref)
            seen.push(entries.map(({ frame, pose }) => ({ frame, pose })))
        }
        return true
    } })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\njmp 5\nlet B\nlet distance(A,B)=5", origin))
    drive(scheduler)
    assert.deepEqual(scheduler.errors, [])
    capture = true
    const B = host.children.get("B")
    const requested = { rotation: SE3.identity().rotation, position: [8, 2, 0] }
    assert.equal(scheduler.requestMotion(B, requested, scheduler.motionRevision, "parent").kind, "accept")
    // ONE certification, and it is of the expanded candidate: the writer's stated pose plus
    // every member the continuation moved. The un-expanded proposal is never certified.
    assert.deepEqual(seen.map((entries) => entries.map(({ frame }) => frame.name)), [["B", "A"]])
    // The writer's declared pose is the request's, unchanged by the round trip through its own chain.
    assert.ok(gap(seen.at(-1)[0].pose.position, requested.position) < 1e-9, "the stated offer survives")
    for (const { frame, pose } of seen.at(-1)) {
        const certifiedWorld = SE3.compose(origin, pose)
        assert.ok(gap(worldOf(frame), certifiedWorld.position) < 1e-9, `${frame.name}: certified position`)
        assert.ok(gap(heading(frame), certifiedWorld.rotation.rotateVec(1, 0, 0)) < 1e-9,
            `${frame.name}: certified heading`)
    }
    assert.ok(gap(worldOf(B), SE3.apply(origin, requested.position)) < 1e-9, "the request's effective world pose")
})

test("a pin clamps the writer to the lawful place instead of moving the pin", () => {
    // The standard hand answers a pinned partner by keeping the pin and clamping the writer —
    // an accepted answer, not a silent move of something that cannot move.
    const { scheduler, at } = build("let A=(0,0,0)\nlet B\nlet distance(A,B)=5")
    drive(scheduler)
    const B = at("B")
    const verdict = scheduler.requestMotion(B, { ...frameWorldTransform(B), position: [1, 0, 0] },
        scheduler.motionRevision, "world")
    assert.equal(verdict.kind, "accept", `verdict ${verdict.kind} ${verdict.message ?? ""}`)
    assert.deepEqual(r6(worldOf(at("A"))), [0, 0, 0], "the pin did not move")
    assert.ok(Math.abs(gap(worldOf(B), [0, 0, 0]) - 5) < 1e-9, "the writer kept the bond")
})

test("zero distance keeps two identities, and a retired source is never touched", () => {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild("host", fork("host", "let A\njmp 5\nlet B\nlet distance(A,B)=0"))
    drive(scheduler)
    const A = host.children.get("A"), B = host.children.get("B")
    assert.notEqual(A.id, B.id, "coincidence is one position, never one identity")
    assert.ok(gap(worldOf(A), worldOf(B)) < 1e-9, "the zero bond is met")
    const verdict = scheduler.requestMotion(B, { ...frameWorldTransform(B), position: [4, 0, 0] },
        scheduler.motionRevision, "world")
    assert.equal(verdict.kind, "accept")
    // retire the source, then ask an identity that has left the world
    scheduler.hotSwapChild("host", fork("host", "let X\nlet Y"))
    const stale = scheduler.requestMotion(B, { ...frameWorldTransform(B), position: [9, 0, 0] },
        scheduler.motionRevision, "world")
    assert.equal(stale.kind, "stale", "a retired identity is not a destination")
})

test("the ceiling sees exactly what will publish, and a rejected member refuses the whole edit", () => {
    // An unchanged disconnected point is never LISTED, so it cannot be waved through — and when
    // the ceiling rejects a member the writer carries, the whole edit is refused, not published
    // in halves. (The retired adapter's counterexample was a candidate that listed it.)
    const seen = []
    const source = "let A\njmp 5\nlet B\nlet distance(A,B)=5\njmp 5\nlet D"
    const hand = (validate) => {
        const scheduler = buildWorld({ validate })
        const host = scheduler.hotSwapChild("host", fork("host", source))
        drive(scheduler)
        return { scheduler, host }
    }
    const permit = hand(({ entries }) => {
        seen.push(entries.map((e) => e.frame.name))
        return true
    })
    seen.length = 0                                    // the source's own seeding motions are not the edit
    assert.equal(permit.scheduler.requestMotion(permit.host.children.get("B"),
        { ...frameWorldTransform(permit.host.children.get("B")), position: [8, 0, 0] },
        permit.scheduler.motionRevision, "world").kind, "accept")
    // The hand door certifies the candidate that will actually publish, ONCE, after the
    // continuation is the last producer. A call naming only the writer is the regression; a
    // second call about an intermediate proposal is the other one. (D063)
    assert.deepEqual(seen, [["B", "A"]], "one certification, and it is the publishable candidate")
    assert.ok(seen[0].every((n) => n === "A" || n === "B"),
        `an identity outside the edit was listed: ${JSON.stringify(seen)}`)

    // A ceiling that refuses any edit carrying a follower never sees one: the writer alone is
    // not a candidate the door certifies, so this refusal is about the pair, not about halves.
    const refuse = hand(({ entries }) => entries.every((e) => e.frame === entries[0].frame))
    const B = refuse.host.children.get("B"), D = refuse.host.children.get("D")
    const before = { a: r6(worldOf(refuse.host.children.get("A"))), b: r6(worldOf(B)), d: r6(worldOf(D)),
        revision: refuse.scheduler.motionRevision }
    const out = refuse.scheduler.requestMotion(B,
        { ...frameWorldTransform(B), position: [8, 0, 0] }, before.revision, "world")
    assert.notEqual(out.kind, "accept", "a refused member refuses the edit")
    assert.equal(refuse.scheduler.motionRevision, before.revision, "nothing was published")
    assert.deepEqual(r6(worldOf(B)), before.b, "the writer did not publish alone")
    assert.deepEqual(r6(worldOf(refuse.host.children.get("A"))), before.a)
    assert.deepEqual(r6(worldOf(D)), before.d, "the disconnected point never moved")
})

test("a malformed proposal is refused at the input boundary, never sanitized by the continuation", () => {
    // One request shape, every convention. A missing rotation used to escape as a TypeError thrown
    // from inside the continuation (compose reads `rotation.w`), and a four-coordinate position used
    // to be quietly rebuilt into a valid three-coordinate pose and published. Both are input faults,
    // and the same validity authority is asked here as on the effective candidate. (D063)
    const source = "let A\njmp 5\nlet B\nlet distance(A,B)=5"
    const malformed = [
        ["missing rotation", () => ({ position: [3, 0, 0] })],
        ["four coordinates", (A) => ({ rotation: A.transform.deref().rotation, position: [3, 0, 0, 99] })],
        ["short position", (A) => ({ rotation: A.transform.deref().rotation, position: [3, 0] })],
        ["non-finite", (A) => ({ rotation: A.transform.deref().rotation, position: [3, 0, Infinity] })],
    ]
    for (const [label, pose] of malformed) {
        for (const ref of [null, "world", "parent"]) {
            const scheduler = buildWorld({})
            const host = scheduler.hotSwapChild("host", fork("host", source))
            drive(scheduler)
            const A = host.children.get("A")
            const before = { a: r6(worldOf(A)), b: r6(worldOf(host.children.get("B"))),
                revision: scheduler.motionRevision }
            const out = scheduler.requestMotion(A, pose(A), scheduler.motionRevision, ref)
            assert.equal(out.kind, "fault", `${label} in ${String(ref)}`)
            assert.deepEqual({ a: r6(worldOf(A)), b: r6(worldOf(host.children.get("B"))),
                revision: scheduler.motionRevision }, before, `${label} in ${String(ref)}: nothing publishes`)
        }
    }
})

test("an installed responder's candidate is certified once, in the request's own convention", () => {
    // With a responder installed there is no continuation, so the certified view is the
    // responder's candidate RE-EXPRESSED in `request.ref`. One call, one convention, and the
    // certified world pose is the published one — the acknowledged step beyond the double-fire fix.
    for (const ref of ["world", "own", null]) {
        const seen = []
        const scheduler = buildWorld({
            admit: ({ requested }) => ({ accepted: true, transform: requested }),
            validate: ({ request, entries, entriesRef }) => {
                seen.push({ ref: request.ref ?? null, entriesRef, entries })
                return true
            },
        })
        const host = scheduler.hotSwapChild("host", fork("host", "let A"))
        drive(scheduler)
        const A = host.children.get("A")
        seen.length = 0   // the source's own seating is not this edit
        const base = ref === "world" || ref == null ? SE3.identity() : worldTransform(A)
        const stated = { rotation: SE3.identity().rotation, position: SE3.apply(base, [3, 0, 0]) }
        assert.equal(scheduler.requestMotion(A, stated, scheduler.motionRevision, ref).kind, "accept",
            `ref ${String(ref)}`)
        assert.equal(seen.length, 1, `ref ${String(ref)}: one certification`)
        assert.equal(seen[0].entriesRef, ref ?? "own", "the ceiling reads the request's own convention")
        assert.equal(seen[0].ref, ref ?? null)
        const certifiedWorld = SE3.apply(base, seen[0].entries[0].pose.position)
        assert.ok(gap(r6(worldOf(A)), r6(certifiedWorld)) < 1e-9,
            `ref ${String(ref)}: the certified world pose is the published one`)
    }
})

test("the same world wish in 'world' and in 'own' lands identically", () => {
    // One meaning, two spellings: a request that names a frame states a POSITION. Reading the
    // world rotation and storing it as a local one would apply the parent twice.
    const origin = SE3.compose({ rotation: SE3.identity().rotation, position: [4, 2, 0] },
        { rotation: SE3.rotateLocal(SE3.identity(), AXIS_Z, 37).rotation, position: [0, 0, 0] })
    const wishWorld = { rotation: SE3.rotateLocal(SE3.identity(), AXIS_Z, 20).rotation,
        position: SE3.apply(origin, [9, 1, 0]) }
    const landed = []
    for (const ref of ["world", "own"]) {
        const scheduler = buildWorld({})
        const host = scheduler.hotSwapChild("host", fork("host", "let A\njmp 5\nlet B\nlet distance(A,B)=5", origin))
        drive(scheduler)
        const B = host.children.get("B")
        const base = ref === "world" ? SE3.identity() : worldTransform(B)
        const stated = SE3.compose(SE3.invert(base), wishWorld)
        assert.equal(scheduler.requestMotion(B, stated, scheduler.motionRevision, ref).kind, "accept", ref)
        landed.push({ ref, position: r6(worldOf(B)),
            heading: r6(frameWorldTransform(B).rotation.rotateVec(1, 0, 0)) })
    }
    assert.deepEqual(landed[1].position, landed[0].position, "the same wish is the same point")
    assert.deepEqual(landed[1].heading, landed[0].heading, "and the same heading")
})

test("an installed admission owns the answer: the continuation is never silently substituted", () => {
    // A custom door that answers without a component must NOT be topped up by the built-in
    // continuation: the request either publishes what its owner proposed or is refused.
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild("host", fork("host",
        "let A\njmp 5\nlet B\njmp 5\nlet C\nlet distance(A,B)=5\nlet distance(B,C)=5"))
    drive(scheduler)
    const A = host.children.get("A"), B = host.children.get("B")
    const before = { a: r6(worldOf(A)), b: r6(worldOf(B)), revision: scheduler.motionRevision }
    const out = scheduler.requestMotion(B, { ...frameWorldTransform(B), position: [8, 3, 0] },
        before.revision, "world")
    assert.notEqual(out.kind, "accept", "a bare answer that breaks the law is refused, not repaired")
    assert.equal(scheduler.motionRevision, before.revision, "nothing published")
    assert.deepEqual(r6(worldOf(A)), before.a, "no follower was quietly moved")
    assert.deepEqual(r6(worldOf(B)), before.b)
})
