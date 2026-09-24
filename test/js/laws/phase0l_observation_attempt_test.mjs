// Narrow opt-in: two pure ambient coordinates in one goto; no impure replay.
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, at, drive, settle, world } from "./harness.mjs"

const accept = ({ requested }) => ({ accepted: true, transform: requested })
const positions = (trace, name) => (trace.get(name) ?? [])
    .filter(e => e.type === "path").map(e => e.points.at(-1))

test("unavailable B discards the whole attempt; new attempt reads new A and B", () => {
    const scheduler = buildWorld({ admit: accept, observeGoto: true })
    const a = scheduler.hotSwapChild("a", fork("a", ""))
    const reader = scheduler.hotSwapChild("reader", fork("reader", "goto a.x b.x\nwait 1"))
    assert.equal(reader.suspension?.kind, "dataflow")
    assert.equal(reader.observation, null, "a blocked attempt owns no retained snapshot")
    assert.equal(scheduler.requestMotion(a, at(1), scheduler.motionRevision).kind, "accept")
    scheduler.hotSwapChild("b", fork("b", "", at(5)))

    const trace = drive(scheduler)
    assert.equal(reader.error, null)
    assert.deepEqual(reader.transform.deref().position.slice(0, 2), [1, 5])
    assert.deepEqual(positions(trace, "reader"), [[1, 5, 0]])
    assert.equal(reader.observation, null)
})

test("cancelling an unavailable observation leaves no capture on its frame", () => {
    const scheduler = buildWorld({ admit: accept, observeGoto: true })
    scheduler.hotSwapChild("a", fork("a", ""))
    const reader = scheduler.hotSwapChild("reader", fork("reader", "goto a.x b.x"))
    assert.equal(reader.suspension?.kind, "dataflow")
    scheduler.removeChild("reader")
    assert.equal(reader.observation, null)
    assert.equal(scheduler.registry.has(reader.id), false)
})

test("impure goto arguments are explicitly unsupported in the narrow mode", () => {
    const scheduler = buildWorld({ admit: accept, observeGoto: true })
    scheduler.hotSwapChild("b", fork("b", "", at(5)))
    const reader = scheduler.hotSwapChild("reader", fork("reader", "goto random b.x"))
    assert.equal(reader.unresolved?.reason, "unsupported goto arguments")
    assert.equal(reader.error, null)
    assert.deepEqual(world("reader", scheduler), [0, 0, 0])
    assert.deepEqual(positions(drive(scheduler), "reader"), [])
})

test("a commit between pure reads cannot mix old A with new B or ink a stale goto", () => {
    let scheduler, changed = false
    const admit = ({ command, frame, requested }) => {
        if (command !== "hand") return accept({ requested })
        const b = frame.parent.children.get("b")
        const delta = requested.position[0] - frame.transform.deref().position[0]
        return { accepted: true, transform: requested, component: [{
            frame: b, transform: { ...b.transform.deref(), position: [delta, 0, 0] },
        }] }
    }
    scheduler = buildWorld({ admit, observeGoto: true })
    const a = scheduler.hotSwapChild("a", fork("a", ""))
    scheduler.hotSwapChild("b", fork("b", "", at(5)))
    const reader = scheduler.hotSwapChild("reader", fork("reader", "goto a.x b.x\nwait 1"), { deferStart: true })
    const original = reader.deps.mathEvaluator.resolveExternal
    reader.deps.mathEvaluator.resolveExternal = (name, args) => {
        const result = original(name, args)
        if (name === "a.x" && !changed) {
            changed = true
            assert.equal(scheduler.requestMotion(a, at(1), scheduler.motionRevision).kind, "accept")
        }
        return result
    }

    const trace = drive(scheduler)
    assert.equal(changed, true)
    assert.equal(reader.error, null)
    assert.deepEqual([world("a", scheduler)[0], world("b", scheduler)[0]], [1, 6])
    assert.deepEqual(positions(trace, "reader"), [[1, 6, 0]], "the stale [0,5] attempt drew nothing")
})

test("source edit invalidates a delayed pure goto without ink or a wound", async () => {
    let answer, attempts = 0
    const scheduler = buildWorld({ observeGoto: true, admitAsync: ({ frame, requested }) => {
        if (frame.name !== "w") return accept({ requested })
        if (++attempts === 1) return new Promise(resolve => { answer = resolve })
        return accept({ requested })
    } })
    scheduler.hotSwapChild("a", fork("a", ""))
    scheduler.hotSwapChild("b", fork("b", "", at(2)))
    const writer = scheduler.hotSwapChild("w", fork("w", "goto a.x b.x\nwait 1"))
    assert.equal(writer.suspension?.kind, "admission")
    assert.equal(writer.observation, null, "the proposal retains a base token, not the read snapshot")

    scheduler.hotSwapChild("a", fork("a", "label 'new' 0", at(5)))
    answer({ accepted: true, transform: at(0, 2) })
    await settle()
    assert.equal(writer.suspension?.verdict?.kind, "stale")
    assert.deepEqual(world("w", scheduler), [0, 0, 0])
    assert.deepEqual([...writer.channel.drain()].filter(e => e.type === "path"), [])
    assert.equal(writer.error, null)

    const trace = drive(scheduler)
    assert.equal(attempts, 2)
    assert.deepEqual(world("w", scheduler), [5, 2, 0])
    assert.deepEqual(positions(trace, "w"), [[5, 2, 0]])
    assert.equal(writer.observation, null)
})

test("repeated stale bases stop unresolved without accepting pose or ink", () => {
    let scheduler, changes = 0
    const admit = ({ command, requested }) => {
        if (command === "goto") {
            scheduler.hotSwapChild("revision", fork("revision", `label 'change${++changes}' 0`))
        }
        return accept({ requested })
    }
    scheduler = buildWorld({ admit, observeGoto: true })
    scheduler.hotSwapChild("a", fork("a", ""))
    scheduler.hotSwapChild("b", fork("b", "", at(5)))
    const reader = scheduler.hotSwapChild("reader", fork("reader", "goto a.x b.x"))
    const trace = drive(scheduler)
    assert.equal(changes, 2)
    assert.equal(reader.unresolved?.reason, "stale motion base")
    assert.equal(reader.error, null)
    assert.deepEqual(world("reader", scheduler), [0, 0, 0])
    assert.deepEqual(positions(trace, "reader"), [])
})
