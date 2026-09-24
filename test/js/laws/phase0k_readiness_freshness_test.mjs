// Phase 0k characterization: dependency readiness and admission freshness
// are different questions. Neither probe installs a language-level let.
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, at, drive, settle, world } from "./harness.mjs"

test("D011: a command retains its first argument while a later name is not ready", () => {
    const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const a = scheduler.hotSwapChild("a", fork("a", ""))
    const reader = scheduler.hotSwapChild("reader", fork("reader", "goto a.x b.x\nwait 1"))
    assert.equal(reader.suspension?.kind, "dataflow", "b is not seated yet")

    const verdict = scheduler.requestMotion(a, at(1), scheduler.motionRevision)
    assert.equal(verdict.kind, "accept")
    scheduler.hotSwapChild("b", fork("b", "", at(5)))
    drive(scheduler)

    assert.equal(reader.error, null)
    assert.deepEqual(reader.transform.deref().position.slice(0, 2), [0, 5],
        "a.x was read before the pause; b.x came from the later configuration")
    assert.deepEqual(world("a", scheduler).slice(0, 2), [1, 0])
})

test("characterization: a blocked command retains an already sampled random argument", () => {
    const original = Math.random
    let samples = 0
    Math.random = () => (++samples === 1 ? 0.25 : 0.75)
    try {
        const scheduler = buildWorld({ admit: ({ requested }) => ({ accepted: true, transform: requested }) })
        const reader = scheduler.hotSwapChild("reader", fork("reader", "goto random b.x\nwait 1"))
        assert.equal(reader.suspension?.kind, "dataflow")
        assert.equal(samples, 1)
        scheduler.hotSwapChild("b", fork("b", "", at(5)))
        drive(scheduler)
        assert.equal(reader.error, null)
        assert.equal(reader.transform.deref().position[0], 0.25)
        assert.equal(samples, 1, "restarting this attempt would repeat an impure argument")
    } finally {
        Math.random = original
    }
})

test("admission: a delayed reply can outlive an edited dependency it used", async () => {
    let answer
    const scheduler = buildWorld({ admitAsync: ({ frame }) => {
        if (frame.name !== "w") return { accepted: true, transform: at(0) }
        return new Promise(resolve => { answer = resolve })
    } })
    const first = scheduler.hotSwapChild("a", fork("a", "", at(0)))
    scheduler.hotSwapChild("w", fork("w", "goto 2 0\nwait 1"))
    const writer = scheduler.root.children.get("w")
    assert.equal(writer.suspension?.kind, "admission")
    assert.equal(world("a", scheduler)[0], 0)

    // The pending responder chose w=2 using the old a=0. Reseating changes
    // the dependency but not w's run or sequence, which are its only fences.
    scheduler.hotSwapChild("a", fork("a", "label 'new' 0", at(5)))
    assert.equal(scheduler.motionRevision, 0, "source replacement is not a motion revision")
    assert.notEqual(scheduler.root.children.get("a"), first)
    answer({ accepted: true, transform: at(2) })
    await settle()
    drive(scheduler)

    assert.equal(writer.error, null)
    assert.equal(world("a", scheduler)[0], 5)
    assert.equal(world("w", scheduler)[0], 2)
    assert.equal(Math.abs(world("a", scheduler)[0] - world("w", scheduler)[0]), 3,
        "the hypothetical two-unit relation was not rechecked at admission")
})
