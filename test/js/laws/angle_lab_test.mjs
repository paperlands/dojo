// Rung B, LABORATORY INTEGRATION (id:relationships-rung-angle).
//
// The opening holds through the existing admission seam: drag either arm, the
// other rotates, and the scheduler's own independent validator checks it. The
// candidate producer is the pure analytic `realizeAngle` from
// laws/relationships.js; `validateAngle` is the separate check.
//
// LABELLED LABORATORY: the required angle is a closure constant here, not yet an
// authored law spelling. This is the stepping stone to `let angle A V B = 60`,
// which needs the address/pipeline work named in specs/compiler/relationships.org.
//
// Run: node --test test/js/laws/angle_lab_test.mjs
import { test } from "node:test"
import assert from "node:assert/strict"

import { buildWorld, fork, drive } from "./harness.mjs"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { realizeAngle, validateAngle } from "../../../assets/js/turtling/laws/relationships.js"

const SOURCE = [
    "let V",
    "fw 3",
    "let A",
    "home",
    "rt 90",
    "fw 4",
    "let B",
    "home",
].join("\n")

const at3 = (v) => v.map((n) => +n.toFixed(3))
const wpos = (host, name) => [...frameWorldTransform(host.children.get(name)).position]

function seat(admit, validate) {
    const scheduler = buildWorld({ admit, validate, settledOnly: false })
    scheduler.hotSwapChild("host", fork("host", SOURCE))
    drive(scheduler)
    const host = scheduler.root.children.get("host")
    return { scheduler, host }
}

function angleResponder(getWant, record) {
    return ({ requested, frame }) => {
        const host = frame.parent
        const who = frame.name
        if (who !== "A" && who !== "B") return { accepted: true, transform: requested }
        const want = getWant()
        const here = [...requested.position]
        const other = who === "A" ? "B" : "A"
        const otherWorld = wpos(host, other)
        // The writer meets the hand; the other arm rotates to hold the opening.
        // The writer meets the hand (it is the fixed arm here); the OTHER arm
        // is the one that rotates. A-drive and B-drive differ only by sign.
        const fixed = here
        const moving = otherWorld
        const out = realizeAngle({ vertex: wpos(host, "V"), fixed, moving }, who === "A" ? want : -want)
        record.push({ who, here, to: out.ok ? out.pose : null, ok: out.ok, reason: out.reason ?? null })
        if (!out.ok) return { accepted: false }
        const otherFrame = host.children.get(other)
        return {
            accepted: true,
            transform: { rotation: requested.rotation, position: here },
            component: [{ frame: otherFrame, transform: {
                rotation: otherFrame.transform.deref().rotation, position: out.pose } }],
        }
    }
}

const angleValidator = (getWant) => ({ request, writer, entries }) => {
    const host = writer.parent
    const poseAt = (name) => {
        if (writer.name === name) return [...request.requested.position]
        const member = entries.find((e) => e.frame.name === name)
        if (member) return [...member.pose.position]
        const frame = host.children?.get(name)
        return frame ? wpos(host, name) : null
    }
    const V = host.children?.get("V") ? wpos(host, "V") : null
    const A = poseAt("A"), B = poseAt("B")
    if (!V || !A || !B) return true          // not seated yet: nothing to check
    return validateAngle({ vertex: V, fixed: A, moving: B }, getWant()).ok
}

const drag = (scheduler, host, name, position) => {
    const frame = host.children.get(name)
    return scheduler.requestMotion(frame,
        // The lab drags in WORLD coordinates: the request names its frame.
        { rotation: frame.transform.deref().rotation, position }, scheduler.motionRevision, 'world')
}

test("either arm can drive; the other rotates and the opening holds", () => {
    let want = 60
    const record = []
    const { scheduler, host } = seat(angleResponder(() => want, record), angleValidator(() => want))
    const B0 = wpos(host, "B")

    const first = drag(scheduler, host, "A", [3, 1, 0])
    assert.equal(first.kind, "accept", "the hand's move is accepted")
    const A1 = wpos(host, "A"), B1 = wpos(host, "B")
    assert.deepEqual(at3(A1), [3, 1, 0], "the writer met the hand")
    assert.equal(validateAngle({ vertex: wpos(host, "V"), fixed: A1, moving: B1 }, want).ok, true, "the opening is 60")
    assert.notDeepEqual(at3(B1), at3(B0), "and the other arm moved")

    // now drag the OTHER arm; the first rotates instead
    const second = drag(scheduler, host, "B", [1, 3, 0])
    assert.equal(second.kind, "accept")
    const A2 = wpos(host, "A"), B2 = wpos(host, "B")
    assert.deepEqual(at3(B2), [1, 3, 0], "the other arm met the hand this time")
    assert.equal(validateAngle({ vertex: wpos(host, "V"), fixed: A2, moving: B2 }, want).ok, true)
    assert.notDeepEqual(at3(A2), at3(A1), "the first arm rotated to hold it")
})

test("changing the required angle is a re-realisation, not a lie", () => {
    let want = 60
    const record = []
    const { scheduler, host } = seat(angleResponder(() => want, record), angleValidator(() => want))
    drag(scheduler, host, "A", [3, 1, 0])
    const before = wpos(host, "B")
    want = 90                                     // a law revision, spelled by the caller for now
    const next = drag(scheduler, host, "A", [3, 1, 0])
    assert.equal(next.kind, "accept")
    const A = wpos(host, "A"), B = wpos(host, "B")
    assert.equal(validateAngle({ vertex: wpos(host, "V"), fixed: A, moving: B }, 90).ok, true)
    assert.notDeepEqual(at3(B), at3(before), "B re-realised to the new opening")
})

test("a zero-length arm refuses with the producer's reason, not an arbitrary angle", () => {
    let want = 60
    const record = []
    const { scheduler, host } = seat(angleResponder(() => want, record), angleValidator(() => want))
    const refused = drag(scheduler, host, "A", [0, 0, 0])   // A onto the vertex: no direction
    assert.notEqual(refused.kind, "accept", "no invented angle")
    assert.match(record.at(-1).reason ?? "", /no direction|zero length/)
})
