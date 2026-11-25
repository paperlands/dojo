// Door-level identity: cache identity, error metadata, closed-door silence.
import { test } from "node:test"
import assert from "node:assert/strict"
import { createJournal } from "../../../assets/js/keep/journal.js"
import { write, name } from "../../../assets/js/keep/entry.js"

class FakeWorker {
    constructor() {
        this.sent = []
        this.onmessage = null
        this.onerror = null
        this.onmessageerror = null
    }
    postMessage(message) { this.sent.push(message) }
    terminate() { this.terminated = true }
    reply(index, data) { this.onmessage?.({ data: { id: this.sent[index].id, ...data } }) }
}

function door() {
    const worker = new FakeWorker()
    const journal = createJournal({ Worker: function Worker() { return worker }, workerUrl: "fake" })
    return { journal, worker }
}

const genesis = (t) => write("genesis", { nonce: "ab".repeat(32) }, { ts: { t, n: 0 } })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

test("an old root reply cannot repopulate the cache after newHand", async () => {
    const { journal, worker } = door()
    const oldBytes = genesis(1), newBytes = genesis(2)
    const first = journal.root()
    const replacing = journal.newHand({ expectedRoot: null })
    assert.equal(worker.sent[1].op, "newHand")
    assert.deepEqual(worker.sent[1].args, [{ expectedRoot: null }])

    worker.reply(1, { ok: true, value: { root: name(newBytes), changed: true } })
    assert.equal((await replacing).root, name(newBytes))
    worker.reply(0, { ok: true, value: oldBytes })
    assert.equal(await first, name(oldBytes), "the old caller sees its stale answer")

    await flush()
    const fresh = journal.root()
    assert.equal(worker.sent.length, 3, "the cache was cleared; a new genesis read runs")
    worker.reply(2, { ok: true, value: newBytes })
    assert.equal(await fresh, name(newBytes))
    await journal.close()
})

test("a stale-hand refusal clears the cache so a retry can read again", async () => {
    const { journal, worker } = door()
    const bytes = genesis(1)
    journal.root()
    worker.reply(0, { ok: true, value: bytes })
    await flush()

    const replacing = journal.newHand({ expectedRoot: name(bytes) })
    worker.reply(1, { ok: false, error: "keep: stale hand", name: "Error", code: "stale-hand" })
    await assert.rejects(replacing, (error) => error.code === "stale-hand")

    const retry = journal.root()
    assert.equal(worker.sent.length, 3, "retry reads genesis, not the stale cache")
    worker.reply(2, { ok: true, value: bytes })
    assert.equal(await retry, name(bytes))
    await journal.close()
})

test("hand forwards and preserves name/code through the worker envelope", async () => {
    const { journal, worker } = door()
    const reading = journal.hand()
    assert.equal(worker.sent[0].op, "genesis", "warm root is the first request")
    assert.equal(worker.sent[1].op, "hand")
    worker.reply(1, { ok: false, error: "keep: signing requires a secure context", name: "Error" })
    await assert.rejects(reading, (error) => /secure context/.test(error.message) && error.name === "Error")
    await journal.close()
})

test("a closed door cannot publish a refreshed identity", async () => {
    const { journal, worker } = door()
    const replacing = journal.newHand({ expectedRoot: null })
    await journal.close()
    worker.reply(1, { ok: true, value: { root: "f".repeat(64), changed: true } })
    await assert.rejects(replacing, /closed/)
    await assert.rejects(journal.root(), /closed/)
})
