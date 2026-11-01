// The keep answer belongs to the subject that asked (id:ownership-o1).
// Elapsed time is not evidence; only the answered outcome settles the seal.
// Actual commitKeep + sealGuard source, boundary controlled.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createContext, runInContext } from "node:vm"

const source = readFileSync(new URL("../../../assets/js/hooks/shell/river.js", import.meta.url), "utf8")
const start = source.indexOf("    function commitKeep() {")
assert.ok(start >= 0, "the keep gesture must still have one owner")
const end = source.indexOf("\n    /** A tap on the seat already under the sun keeps", start)
assert.ok(end > start)
const commitSource = source.slice(start, end)

const guardOpen = "    const sealGuard = temporal.quiet("
const guardStart = source.indexOf(guardOpen)
assert.ok(guardStart >= 0, "the elapsed-time guard must still exist")
const guardBodyStart = guardStart + guardOpen.length
const guardBodyEnd = source.indexOf(", BEAT.KEEP_GUARD_MS)", guardBodyStart)
assert.ok(guardBodyEnd > guardBodyStart)
const guardSource = source.slice(guardBodyStart, guardBodyEnd)

function fixture() {
    let current = "old"
    let seal = { mine: 1 }
    const misses = []
    const seals = []
    const notices = []
    let finish
    const answered = new Promise((resolve) => { finish = resolve })
    const scope = {
        DRAFT: "draft",
        ready: () => true,
        message: { value: "a title" },
        at: { key: "kept", id: "keep1" },
        draft: null,
        setDraft: () => {},
        beginSeal: (title) => {
            seal = { mine: 1 }
            scope.seal = seal
            scope.message.value = ""
            seals.push(title)
        },
        seal: null,
        sealGuard: { cancel: () => seals.push("guard") },
        miss: (title) => misses.push(title),
        endSeal: () => { seal = null; scope.seal = null; seals.push("end") },
        term: { get: () => ({ currentBufferId: () => current }) },
        askKeep: () => answered,
        sessionName: () => "self",
        peerOf: () => null,
        say: () => {},
        arena: { alive: true },
        notices,
        S: { system: (msg) => ({ msg }) },
        nerve: () => ({ push: (message) => notices.push(message) }),
    }
    scope.seal = seal
    const context = createContext(scope)
    runInContext(commitSource, context)
    const guard = runInContext(`(${guardSource})`, context)
    return {
        scope,
        notices,
        misses,
        seals,
        move: (id) => { current = id },
        answer: (value) => finish(value),
        run: () => runInContext("commitKeep()", context),
        guard: () => guard(),
    }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test("a failed ask blushes the subject that asked", async () => {
    const f = fixture()
    assert.equal(f.run(), true)
    f.answer(null)
    await tick()
    assert.deepEqual(f.misses, ["a title"])
    assert.equal(f.scope.message.value, "", "miss owns the restore")
})

test("a moved subject never hears the old ask's null", async () => {
    const f = fixture()
    f.run()
    f.move("other")
    f.answer(null)
    await tick()
    assert.deepEqual(f.misses, [])
    assert.deepEqual(f.seals, ["a title", "end"], "the old seal ends quietly")
    assert.equal(f.scope.message.value, "", "the new subject keeps its own word")
})

test("a prepared stream ends the old seal and takes the caption back", async () => {
    const f = fixture()
    f.run()
    f.move("fresh")
    f.answer({ prepared: { bufferId: "fresh" } })
    await tick()
    assert.deepEqual(f.misses, [])
    assert.deepEqual(f.seals, ["a title", "end"])
    assert.equal(f.scope.message.value, "a title", "the second Keep keeps its caption")
})

test("a prepared standing buffer (restored hand) keeps the caption in place", async () => {
    const f = fixture()
    f.run()
    f.answer({ prepared: { bufferId: "old" } })
    await tick()
    assert.deepEqual(f.misses, [])
    assert.deepEqual(f.seals, ["a title", "end"])
    assert.equal(f.scope.message.value, "a title")
})

test("preparation does not hand the caption to a subject it did not prepare", async () => {
    const f = fixture()
    f.run()
    f.move("elsewhere")
    f.answer({ prepared: { bufferId: "fresh" } })
    await tick()
    assert.deepEqual(f.misses, [])
    assert.equal(f.scope.message.value, "", "no caption on an unrelated subject")
})

test("a refold that ended the old seal cannot bury the prepared caption", async () => {
    const f = fixture()
    f.run()
    f.move("fresh")
    // createBuffer's refold may end the old seal before the ask resolves.
    f.scope.endSeal()
    f.answer({ prepared: { bufferId: "fresh" } })
    await tick()
    assert.deepEqual(f.seals, ["a title", "end"], "no duplicate end")
    assert.equal(f.scope.message.value, "a title", "the prepared stream keeps its word")
})

test("refold-before-reply never overwrites a newer seal or a fresh caption", async () => {
    const f = fixture()
    f.run()
    f.move("fresh")
    f.scope.endSeal()
    f.scope.message.value = "typed after the refold"
    f.answer({ prepared: { bufferId: "fresh" } })
    await tick()
    assert.deepEqual(f.seals, ["a title", "end"])
    assert.equal(f.scope.message.value, "typed after the refold",
        "a freshly entered caption is not replaced")
})

test("a genuine id still ends quietly when the selection moved during the put", async () => {
    const f = fixture()
    f.run()
    f.move("elsewhere")
    f.answer("keep2")
    await tick()
    assert.deepEqual(f.misses, [], "a committed keep is not a failure")
    assert.deepEqual(f.seals, ["a title", "end"], "the old seal ends, the new seat untouched")
})

test("a cancelled offer returns the caption without the failure blush", async () => {
    const f = fixture()
    f.run()
    f.answer({ cancelled: true })
    await tick()
    assert.deepEqual(f.misses, [], "cancelling is not a storage failure")
    assert.deepEqual(f.seals, ["a title", "end"])
    assert.equal(f.scope.message.value, "a title", "the declined gesture is not lost")
})

test("a kept id cancels the guard and reports no miss", async () => {
    const f = fixture()
    f.run()
    f.answer("keep2")
    await tick()
    assert.deepEqual(f.misses, [])
    assert.deepEqual(f.seals, ["a title", "guard"])
})

test("a newer seal owns the seat; the old answer is silent", async () => {
    const f = fixture()
    f.run()
    f.scope.seal = { mine: 2 }
    f.answer({ prepared: { bufferId: "fresh" } })
    await tick()
    assert.deepEqual(f.seals, ["a title"])
    assert.equal(f.scope.message.value, "")
})

test("the elapsed-time guard waits; it never infers failure", () => {
    const f = fixture()
    f.run()
    f.guard()
    assert.equal(f.notices.length, 1)
    assert.match(f.notices[0].msg, /not confirmed yet/)
    assert.match(f.notices[0].msg, /still waiting/)
    assert.deepEqual(f.misses, [], "time is not evidence of failure")
    assert.deepEqual(f.seals, ["a title"], "the seal stays open for the real answer")
    assert.equal(f.scope.message.value, "", "no caption write from the guard")
})

test("after the guard waits, a prepared answer still restores the caption", async () => {
    const f = fixture()
    f.run()
    f.guard()
    f.move("fresh")
    f.answer({ prepared: { bufferId: "fresh" } })
    await tick()
    assert.deepEqual(f.misses, [])
    assert.deepEqual(f.seals, ["a title", "end"])
    assert.equal(f.scope.message.value, "a title")
})

test("after the guard waits, a cancelled answer still restores the caption", async () => {
    const f = fixture()
    f.run()
    f.guard()
    f.answer({ cancelled: true })
    await tick()
    assert.deepEqual(f.misses, [])
    assert.deepEqual(f.seals, ["a title", "end"])
    assert.equal(f.scope.message.value, "a title")
})

test("a dead mount writes no stale draft or caption from a late answer", async () => {
    const f = fixture()
    f.run()
    f.scope.arena.alive = false
    f.move("fresh")
    f.answer({ prepared: { bufferId: "fresh" } })
    await tick()
    assert.deepEqual(f.seals, ["a title"], "no end, no guard cancel")
    assert.deepEqual(f.misses, [])
    assert.equal(f.scope.message.value, "")

    const g = fixture()
    g.run()
    g.scope.arena.alive = false
    g.answer(null)
    await tick()
    assert.deepEqual(g.misses, [], "a remount shares the bufferId; the old null is silent")
    assert.equal(g.scope.message.value, "")
})
