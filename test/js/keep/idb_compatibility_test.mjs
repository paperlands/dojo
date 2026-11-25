import { test } from "node:test"
import assert from "node:assert/strict"
import { createEngine, reprojectJournal } from "../../../assets/js/keep/journal.store.js"
import { createMemoryIDB } from "./idb_memory.mjs"
import { engineLifecycleWalk, compatibilityWalk, refusalWalk, lifecycleWalk, maintenanceWalk, incompatibleShapes } from "./idb_compatibility_cases.mjs"

test("cold/warm old -> new -> old -> new retains bytes, proofs, keys and opaque data", { timeout: 5000 }, async () => {
    const result = await compatibilityWalk(createMemoryIDB())
    assert.ok(Object.values(result).every((value) => value === true))
})

for (const shape of Object.keys(incompatibleShapes)) {
    test(`preflight: ${shape} refuses ordinary open and maintenance without changing data`, { timeout: 5000 }, async () => {
        assert.deepEqual(await refusalWalk(createMemoryIDB(), shape), { refused: true, unchanged: true, released: true })
    })
}

test("raw IndexedDB versions, blocked upgrade and atomic abort match browser physics", { timeout: 5000 }, async () => {
    assert.deepEqual(await lifecycleWalk(createMemoryIDB()), { lowerPin: "VersionError", versionless: true, emptyCompletes: true, blocked: true, rollback: true })
})

test("ordinary single-flight, close during open and abandoned maintenance match browser physics", { timeout: 5000 }, async () => {
    assert.deepEqual(await engineLifecycleWalk(createMemoryIDB()), { blockedRepairRefuses: true, lateUpgradeAborted: true, closedOpenReleased: true, singleFlight: true })
})

test("opening is not repair; explicit maintenance is idempotent and releases its connection", { timeout: 5000 }, async () => {
    assert.deepEqual(await maintenanceWalk(createMemoryIDB()), { explicitOnly: true, idempotent: true, newerHeldSkipped: true, concurrentUpgradeSafe: true, freshCreatesTarget: true, released: true })
})

test("a failed ordinary open is shared, not retried", async () => {
    const failure = new DOMException("denied", "SecurityError")
    let calls = 0
    const idb = {
        open() {
            calls++
            const req = { error: failure }
            queueMicrotask(() => req.onerror())
            return req
        },
    }
    const j = createEngine({ idb, KeyRange: {}, random: (a) => a })
    try {
        await assert.rejects(j.hand(), (e) => e === failure)
        await assert.rejects(j.hand(), (e) => e === failure)
        assert.equal(calls, 1)
    } finally { await j.close() }
})

test("a synchronous open exception settles and remains the same refusal", async () => {
    const failure = new DOMException("storage unavailable", "SecurityError")
    const j = createEngine({ idb: { open() { throw failure } }, KeyRange: {}, random: (a) => a })
    try {
        await assert.rejects(j.hand(), (e) => e === failure)
        await assert.rejects(j.hand(), (e) => e === failure)
    } finally { await j.close() }
})

test("maintenance requires an explicit positive physical target before opening", async () => {
    let opens = 0
    const idb = { open() { opens++; throw new Error("must not open") } }
    for (const version of [undefined, null, 0, -1, 1.5, Infinity]) {
        await assert.rejects(reprojectJournal({ idb, version }), TypeError)
    }
    assert.equal(opens, 0)
})
