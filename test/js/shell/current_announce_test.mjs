// The readiness demand, pure: no DOM, no clock, no socket, no queue.
// Run with: node --test test/js/shell/current_announce_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createCurrentAnnounce } from "../../../assets/js/hooks/shell/current-announce.js"

describe("current announce — one latest read, never a backlog", () => {
    test("sync before hydration waits for a local wake, then sends CURRENT once", () => {
        let current = null
        let reads = 0
        const sent = []
        const announce = createCurrentAnnounce({
            read: () => { reads++; return current },
            send: (c) => sent.push(c),
        })

        announce.sync(() => {})
        announce.sync(() => {})
        assert.deepEqual(sent, [], "nothing sends before hydration")
        assert.equal(reads, 2, "each request asks whether the body stands yet")

        current = { source: "fw 60" }
        announce.wake()
        assert.deepEqual(sent, [{ source: "fw 60" }])

        announce.wake()
        assert.equal(sent.length, 1, "a settled demand does not replay")
    })

    test("sync flushes a pending quiet edit and announces exactly once", () => {
        let current = null
        const sent = []
        const announce = createCurrentAnnounce({ read: () => current, send: (c) => sent.push(c) })

        announce.sync(() => {}) // an earlier readiness demand, still unhydrated

        // The quiet callback: local content lands, then wakes the demand.
        const flush = () => {
            current = { source: "fw 120" }
            announce.wake()
        }

        announce.sync(flush)
        assert.deepEqual(sent, [{ source: "fw 120" }])
    })

    test("a valid empty document is a document, not a missing one", () => {
        const sent = []
        const announce = createCurrentAnnounce({ read: () => ({ source: "" }), send: (c) => sent.push(c) })

        announce.sync(() => {})
        assert.deepEqual(sent, [{ source: "" }])
    })

    test("release before hydration severs the demand and the flush", () => {
        let current = null
        let reads = 0
        let flushes = 0
        const sent = []
        const announce = createCurrentAnnounce({
            read: () => { reads++; return current },
            send: (c) => sent.push(c),
        })

        announce.sync(() => {})
        announce.release()

        current = { source: "fw 120" }
        announce.wake()
        announce.sync(() => { flushes++ })

        assert.deepEqual(sent, [])
        assert.equal(reads, 1, "post-release sync reads nothing")
        assert.equal(flushes, 0, "post-release sync flushes nothing")
    })

    test("a release during read cannot be followed by a send", () => {
        const sent = []
        let announce
        announce = createCurrentAnnounce({
            read: () => { announce.release(); return { source: "fw 120" } },
            send: (c) => sent.push(c),
        })

        announce.sync(() => {})
        assert.deepEqual(sent, [])
    })

    test("a newer request during read retires the older answer", () => {
        let current = { source: "old" }
        const sent = []
        let announce
        announce = createCurrentAnnounce({
            read: () => {
                const value = current
                if (value.source === "old") {
                    current = { source: "new" }
                    announce.sync(() => {}) // newer request lands during this read
                }
                return value
            },
            send: (c) => sent.push(c),
        })

        announce.sync(() => {})
        assert.deepEqual(sent, [{ source: "new" }], "the older read never publishes last")
    })
})
