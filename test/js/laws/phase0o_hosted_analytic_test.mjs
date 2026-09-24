// One hosted analytic world: source-spawned actors, no scheduling wait in the source.
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, at, nz } from "./harness.mjs"
import { frameWorldTransform, worldTransform, takeSync } from "../../../assets/js/turtling/scheduler.js"
import { SE3 } from "../../../assets/js/turtling/se3.js"

const source = (rotated = false) => `${rotated ? "rt 90\n" : ""}jmpto 5 0
as b do
end
jmpto 0 0
as a b do
  fw 1
  fw 2
end
as witness do
  fw a.distance
end`
const pos = (f) => nz(frameWorldTransform(f).position)
const close = (a, b) => assert.ok(a.every((n, i) => Math.abs(n - b[i]) < 1e-8), `${a} != ${b}`)

function scenario(rotated) {
    const requests = []
    const admit = ({ frame, requested, command }) => {
        if (frame.name !== "a") return { accepted: true, transform: requested }
        const b = frame.parent.children.get("b")
        assert.ok(b, "the initial five-unit pair exists before a's first action")
        const before = [pos(frame), pos(b)]
        close([Math.hypot(...before[0].map((n, i) => n - before[1][i]))], [5])
        // One deliberately corrected first move. The responder's answer is in
        // each actor's birth frame, not the host's world or b's drawing frame.
        const accepted = { ...requested, position: command === "fw" && requests.length === 0
            ? [2, 0, 0] : requested.position }
        const delta = SE3.apply(worldTransform(frame), accepted.position)
            .map((n, i) => n - before[0][i])
        const nextWorld = before[1].map((n, i) => n + delta[i])
        const component = { frame: b, transform: {
            ...b.transform.deref(), position: SE3.unapply(worldTransform(b), nextWorld),
        } }
        requests.push({ address: frame.address, command, requested: requested.position,
            accepted: accepted.position, before, component: component.transform.position,
            revision: frame.parent.parent._configurationRevision })
        return { accepted: true, transform: accepted, component: [component] }
    }
    const validate = ({ writer, entries }) => {
        if (writer.name !== "a") return entries.length === 1
        const b = writer.parent.children.get("b")
        if (entries.length !== 2 || !entries.some(e => e.frame === b)) return false
        const next = (f) => SE3.compose(worldTransform(f), entries.find(e => e.frame === f).pose).position
        const aWorld = next(writer), bWorld = next(b)
        const aDelta = aWorld.map((n, i) => n - pos(writer)[i])
        const bDelta = bWorld.map((n, i) => n - pos(b)[i])
        return Math.abs(Math.hypot(...aWorld.map((n, i) => n - bWorld[i])) - 5) < 1e-8 &&
            aDelta.every((n, i) => Math.abs(n - bDelta[i]) < 1e-8)
    }
    const scheduler = buildWorld({ admit, validate })
    const host = scheduler.hotSwapChild("seat", fork("host", source(rotated), at(30, 7)))
    const trace = new Map()
    const drain = () => {
        for (const f of scheduler.registry.values()) {
            const events = f.channel.drain()
            if (events.length) trace.set(f.id, [...(trace.get(f.id) ?? []), ...events])
        }
    }
    drain()
    for (let i = 0; i < 40 && !scheduler.done; i++) { scheduler.tick(i * 1000); drain() }
    assert.equal(scheduler.done, true)
    assert.deepEqual(scheduler.errors, [])
    return { scheduler, host, a: host.children.get("a"), b: host.children.get("b"),
        witness: host.children.get("witness"), requests, trace }
}

for (const rotated of [false, true]) {
    test(`hosted pair without a wait, declaring frame ${rotated ? "rotated" : "translated"}`, () => {
        const { scheduler, host, a, b, witness, requests, trace } = scenario(rotated)
        assert.equal(a.parent, host)
        assert.equal(a.targetFrame, "b")
        assert.deepEqual(requests.map(r => [r.address, r.requested[0], r.accepted[0]]),
            [["seat/a", 1, 2], ["seat/a", 4, 4]])
        assert.deepEqual(nz(a.transform.deref().position), [4, 0, 0])
        close(b.transform.deref().position, [4, 0, 0])
        assert.deepEqual(nz(witness.transform.deref().position), [4, 0, 0],
            "a sibling reads the accepted final distance, not the requested first step")
        const ink = (trace.get(b.id) ?? []).filter(e => e.type === "path" && e.sourceId === a.id)
        const endpoints = ink.map(e => e.points)
        assert.equal(endpoints.length, 2)
        ;[[-5, -3], [-3, -1]].forEach(([start, end], i) => {
            close(endpoints[i][0], rotated ? [start + 5, -5, 0] : [start, 0, 0])
            close(endpoints[i].at(-1), rotated ? [end + 5, -5, 0] : [end, 0, 0])
        })
        assert.deepEqual((trace.get(a.id) ?? []).filter(e => e.type === "path"), [])
        const base = worldTransform(a)
        close(pos(a), SE3.apply(base, [4, 0, 0]))
        close(pos(b), SE3.apply(worldTransform(b), [4, 0, 0]))
        close(pos(a), rotated ? [30, 3, 0] : [34, 7, 0])
        close(pos(b), rotated ? [35, 3, 0] : [39, 7, 0])
        const oldRevision = scheduler.motionRevision
        const target = { ...a.transform.deref(), position: [5, 0, 0] }
        const answer = scheduler.requestMotion(a, target, oldRevision)
        assert.equal(answer.kind, "accept")
        close(pos(a), SE3.apply(base, [5, 0, 0]))
        close(pos(b), SE3.apply(worldTransform(b), [5, 0, 0]))
        close(pos(a), rotated ? [30, 2, 0] : [35, 7, 0])
        close(pos(b), rotated ? [35, 2, 0] : [40, 7, 0])
        const head = takeSync(a).find(e => e.type === "head")
        close(head.position, rotated ? [5, -5, 0] : [0, 0, 0]) // b's declaring frame
        close(SE3.apply(worldTransform(b), head.position), pos(a))
        const visibleRotation = worldTransform(b).rotation.multiply(head.rotation)
        const expectedRotation = frameWorldTransform(a).rotation
        close([visibleRotation.w, visibleRotation.x, visibleRotation.y, visibleRotation.z],
            [expectedRotation.w, expectedRotation.x, expectedRotation.y, expectedRotation.z])
        const bHead = takeSync(b).find(e => e.type === "head")
        close(bHead.position, [5, 0, 0])
        if (!rotated) console.log("HOSTED_ANALYTIC_TRACE=" + JSON.stringify({
            sourceRevision: 1, // fixture provenance, not a scheduler source-revision API
            identity: { a: [a.address, a.id], b: [b.address, b.id] },
            requests: requests.map(r => ({ requested: r.requested, accepted: r.accepted, component: r.component })),
            observed: { a: pos(a), b: pos(b), witness: pos(witness) },
            visibleHead: { frame: b.address, position: nz(head.position),
                rotation: [head.rotation.w, head.rotation.x, head.rotation.y, head.rotation.z] },
            motionRevision: scheduler.motionRevision,
            configurationRevision: scheduler.root._configurationRevision,
        }))
        assert.deepEqual(b.channel.drain().filter(e => e.type === "path"), [], "hand does not repaint deposited ink")
        assert.equal(scheduler.requestMotion(a, target, oldRevision).kind, "stale")
        scheduler.removeChild("seat")
        assert.equal(scheduler.requestMotion(a, target, scheduler.motionRevision).kind, "stale")
    })
}

test("source edit, fresh play and removal invalidate pending nested admission", async () => {
    const pending = []
    const scheduler = buildWorld({ admitAsync: ({ frame, requested }) => {
        if (frame.name !== "a") return { accepted: true, transform: requested }
        return new Promise(resolve => pending.push(resolve))
    } })
    const program = "as b do\nend\nas a do\n  fw 1\nend"
    const seat = (src, options) => scheduler.hotSwapChild("seat", fork("host", src), options)
    const first = seat(program)
    const oldA = first.children.get("a")
    assert.equal(oldA.suspension?.kind, "admission")
    const edited = seat(program + "\nlabel 'edited' 0")
    assert.notEqual(edited, first)
    const editedA = edited.children.get("a")
    pending[0]({ accepted: true, transform: at(50) })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(pos(oldA), [0, 0, 0])
    assert.equal(editedA.suspension?.kind, "admission")
    const fresh = seat(program + "\nlabel 'edited' 0", { fresh: true })
    assert.notEqual(fresh, edited)
    pending[1]({ accepted: true, transform: at(50) })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(pos(editedA), [0, 0, 0])
    const freshA = fresh.children.get("a")
    assert.equal(freshA.suspension?.kind, "admission")
    scheduler.removeChild("seat")
    pending[2]({ accepted: true, transform: at(50) })
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(pos(freshA), [0, 0, 0])
    assert.equal(scheduler.registry.has(freshA.id), false)
    assert.equal(scheduler.requestMotion(freshA, at(1), scheduler.motionRevision).kind, "stale")
})

test("a hand transaction cannot import a component member from another hosted seat", () => {
    let other
    const scheduler = buildWorld({ admit: ({ frame, requested }) => ({
        accepted: true, transform: requested, component: [{ frame: other, transform: requested }],
    }) })
    const first = scheduler.hotSwapChild("left", fork("host", "as a do\nend"))
    const second = scheduler.hotSwapChild("right", fork("host", "as b do\nend"))
    const a = first.children.get("a")
    other = second.children.get("b")
    const revision = scheduler.motionRevision
    assert.equal(scheduler.requestMotion(a, at(1), revision).kind, "unresolved")
    assert.equal(scheduler.motionRevision, revision)
    assert.deepEqual(pos(a), [0, 0, 0])
    assert.deepEqual(pos(other), [0, 0, 0])
})
