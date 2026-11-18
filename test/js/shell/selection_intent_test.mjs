// The local installation capability: opened by the producer, acknowledged only
// by its correlated request, released with its owner. No wire token, no clock.

import { describe, test } from "node:test"
import assert from "node:assert/strict"

import {
    createSelectionIntent,
    completeSelection,
    requestSelection,
    installSelection,
    releaseSelection,
    selection,
} from "../../../assets/js/hooks/shell/selection-intent.js"

const local = (addr = "a1") => ({ addr, origin_name: addr, view: "watch", draft_live: true })

function deferred() {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

describe("selection intent — one local installation, one correlated ack", () => {
    test("a local departure is accepted but does not ack itself", () => {
        const intent = createSelectionIntent()
        const payload = local()
        const token = intent.open(payload)

        intent.arrive("seeOuterShell", payload)
        assert.equal(intent.accepted(payload), true)
        assert.equal(intent.pending(), token, "local dispatch never clears pending")

        const server = local()
        intent.arrive("seeOuterShell", server)
        assert.equal(intent.accepted(server), false, "server events wait for the request")

        assert.equal(intent.ack(token), true)
        assert.equal(intent.pending(), null)

        const later = local()
        intent.arrive("seeOuterShell", later)
        assert.equal(intent.accepted(later), true)
    })

    test("an older completion cannot clear a newer incarnation", () => {
        const intent = createSelectionIntent()
        const first = intent.open(local())
        const second = intent.open(local())

        assert.equal(intent.ack(first), false)
        assert.equal(intent.pending(), second)
        assert.equal(intent.ack(second), true)
        assert.equal(intent.pending(), null)
    })

    test("drop keeps pending; owner release retires it and stale completions", () => {
        const intent = createSelectionIntent()
        const token = intent.open(local())

        // A failed request does not clear: stale B must not win.
        assert.equal(intent.accepted(local("b1")), false)

        intent.release()
        assert.equal(intent.ack(token), false)
        assert.equal(intent.accepted(local("b1")), false)
    })

    test("local close + canonical receipt clears pending without resurrecting a decision", () => {
        const intent = createSelectionIntent()
        const token = intent.open(local())
        const stale = local("b1")
        intent.arrive("seeOuterShell", stale)
        assert.equal(intent.accepted(stale), false)

        const close = { local: true }
        intent.arrive("outerClose", close)
        assert.equal(intent.acceptedClose(close), true)
        const receipt = intent.pending()

        const closed = { addr: null, view: "watch", draft_live: true, follow_peer: true }
        assert.deepEqual(completeSelection(intent, receipt, closed), closed)
        assert.equal(intent.pending(), null)
        assert.equal(intent.accepted(stale), false, "already-rejected payload stays rejected")
        const next = local("c1")
        intent.open(next)
        assert.equal(intent.accepted(next), true)
        assert.equal(intent.ack(token), false)
    })
    test("completion validates the exact descriptor before ack", () => {
        const intent = createSelectionIntent()
        const payload = local()
        const token = intent.open(payload)
        const valid = { addr: payload.addr, view: "watch", draft_live: true, follow_peer: true }

        assert.equal(completeSelection(intent, token, undefined), null)
        assert.equal(completeSelection(intent, token, { view: "watch" }), null)
        assert.equal(completeSelection(intent, token, { ...valid, view: "bogus" }), null)
        assert.equal(completeSelection(intent, token, { ...valid, addr: "other" }), null)
        assert.equal(intent.pending(), token, "invalid replies never clear protection")

        assert.deepEqual(completeSelection(intent, token, valid), valid)
        assert.equal(intent.pending(), null)
    })

    test("a valid reply for an old token cannot clear the newer one", () => {
        const intent = createSelectionIntent()
        const first = intent.open(local())
        const second = intent.open(local())
        const valid = { addr: "a1", view: "watch", draft_live: true, follow_peer: true }

        assert.equal(completeSelection(intent, first, valid), null)
        assert.equal(intent.pending(), second)
        assert.deepEqual(completeSelection(intent, second, valid), valid)
    })

    test("replacement releases the previous controller; stale cleanup keeps the new", () => {
        const first = createSelectionIntent()
        installSelection(first)
        const token = first.open(local())

        const second = createSelectionIntent()
        installSelection(second)

        assert.equal(selection(), second)
        assert.equal(completeSelection(first, token, { addr: "a1", view: "watch", draft_live: true, follow_peer: true }), null)
        assert.equal(first.pending(), null)

        releaseSelection(first)
        assert.equal(selection(), second, "stale release cannot clear the new owner")

        releaseSelection(second)
        assert.equal(selection(), null)
    })

    test("non-object arrivals fail closed without corrupting the current selection", () => {
        const intent = createSelectionIntent()

        assert.equal(intent.open("not-an-object"), null)
        assert.doesNotThrow(() => intent.arrive("outerIntent", null))
        assert.doesNotThrow(() => intent.arrive("seeOuterShell", "primitive"))
        assert.equal(intent.accepted(null), false)
        assert.equal(intent.accepted("primitive"), false)

        const token = intent.open(local())
        assert.doesNotThrow(() => intent.arrive("seeOuterShell", 42))
        assert.equal(intent.pending(), token, "malformed arrival cannot clear pending")
        assert.equal(intent.accepted(42), false)
        assert.equal(intent.ack(token), true)

        // The explicit closed descriptor is a map and remains supported.
        const closed = { addr: null, view: "watch", draft_live: true, follow_peer: true }
        intent.arrive("outerIntent", closed)
        assert.equal(intent.accepted(closed), true)
    })

    test("an open+ack after a queued local close revokes the old close", () => {
        const intent = createSelectionIntent()
        const closePayload = { local: true }
        intent.arrive("outerClose", closePayload)
        assert.equal(intent.acceptedClose(closePayload), true)

        const openPayload = local("a1")
        const token = intent.open(openPayload)
        intent.arrive("seeOuterShell", openPayload)
        assert.equal(intent.ack(token), true)

        assert.equal(intent.acceptedClose(closePayload), false, "old close cannot re-clear A")
    })

    test("a local replacement retires an older queued server document", () => {
        const intent = createSelectionIntent()
        const oldDoc = local("b1")
        intent.arrive("seeOuterShell", oldDoc)
        assert.equal(intent.accepted(oldDoc), true, "paused watch body stays valid")

        intent.open(local("a1"))
        assert.equal(intent.accepted(oldDoc), false, "older document cannot reclaim A")
    })

    test("a server notify cannot close a newer pending local open", () => {
        const intent = createSelectionIntent()
        const token = intent.open(local("a1"))
        const notify = {}

        intent.arrive("outerClose", notify)
        assert.equal(intent.acceptedClose(notify), false)
        assert.equal(intent.pending(), token)
    })

    test("close completion uses the canonical closed selector", () => {
        const intent = createSelectionIntent()
        const closePayload = { local: true }
        intent.arrive("outerClose", closePayload)
        const token = intent.pending()

        const closed = { addr: null, view: "watch", draft_live: true, follow_peer: true }
        assert.equal(completeSelection(intent, token, undefined), null)
        assert.equal(completeSelection(intent, token, { addr: "a1", view: "watch", draft_live: true, follow_peer: true }), null)
        assert.equal(intent.pending(), token)

        assert.deepEqual(completeSelection(intent, token, closed), closed)
        assert.equal(intent.pending(), null)
    })

    test("a server close notify is accepted only with no newer receipt", () => {
        const intent = createSelectionIntent()
        const notify = {}
        intent.arrive("outerClose", notify)
        assert.equal(intent.acceptedClose(notify), true)
        assert.equal(intent.pending(), null)
    })

    test("readiness supersede keeps the local owner and a fresh receipt", () => {
        const intent = createSelectionIntent()
        const payload = local("a1")
        const token = intent.open(payload)
        intent.arrive("seeOuterShell", payload)

        const receipt = intent.supersede("a1")
        assert.notEqual(receipt, token)
        assert.equal(intent.pending(), receipt)
        assert.equal(intent.accepted(payload), true, "queued local document still seats")
        assert.equal(intent.ack(token), false, "old receipt cannot ack the retry")

        assert.equal(intent.ack(receipt), true)
        assert.equal(intent.accepted(payload), true)
    })

    test("close retry preserves the owner while replacing the receipt", () => {
        const intent = createSelectionIntent()
        const closePayload = { local: true }
        intent.arrive("outerClose", closePayload)
        const old = intent.pending()
        const receipt = intent.supersede(null)
        const closed = { addr: null, view: "watch", draft_live: true, follow_peer: true }

        assert.notEqual(receipt, old)
        assert.equal(intent.acceptedClose(closePayload), true)
        assert.equal(completeSelection(intent, old, closed), null, "old close receipt cannot ack")
        assert.deepEqual(completeSelection(intent, receipt, closed), closed)
    })

    test("a stale close receipt cannot clear a newer open or retry", () => {
        const intent = createSelectionIntent()
        intent.arrive("outerClose", { local: true })
        const stale = intent.pending()
        const closed = { addr: null, view: "watch", draft_live: true, follow_peer: true }
        const valid = { addr: "a1", view: "watch", draft_live: true, follow_peer: true }

        const opened = intent.open(local("a1"))
        assert.equal(completeSelection(intent, stale, closed), null)
        assert.equal(intent.pending(), opened, "stale close receipt cannot clear a newer open")

        const retry = intent.supersede("a1")
        assert.equal(completeSelection(intent, opened, valid), null)
        assert.equal(intent.pending(), retry, "superseded receipt cannot ack the retry")
        assert.deepEqual(completeSelection(intent, retry, valid), valid)
        assert.equal(intent.pending(), null)
    })

    test("release retires a pending completion", () => {
        const intent = createSelectionIntent()
        const token = intent.open(local())
        intent.release()
        const valid = { addr: "a1", view: "watch", draft_live: true, follow_peer: true }
        assert.equal(completeSelection(intent, token, valid), null)
        assert.equal(intent.pending(), null)
    })

    test("requestSelection sends synchronously and applies once after ack", async () => {
        const intent = createSelectionIntent()
        const token = intent.open(local())
        const reply = deferred()
        let sent = 0
        const applied = []
        let pendingAtApply

        const settled = requestSelection(
            intent,
            token,
            () => { sent++; return reply.promise },
            (descriptor) => {
                applied.push(descriptor)
                pendingAtApply = intent.pending()
            },
        )
        assert.equal(sent, 1, "send leaves in the calling stack")
        assert.equal(intent.pending(), token)
        assert.deepEqual(applied, [])

        const valid = { addr: "a1", view: "watch", draft_live: true, follow_peer: true }
        reply.resolve(valid)
        await settled

        assert.deepEqual(applied, [valid])
        assert.equal(pendingAtApply, null, "ack precedes apply")
        assert.equal(intent.pending(), null)
    })

    test("a missing, malformed, or failed transport keeps the fence", async () => {
        const valid = { addr: "a1", view: "watch", draft_live: true, follow_peer: true }
        const cases = [
            ["undefined", () => undefined],
            ["number", () => 42],
            ["truthy non-function then", () => ({ ...valid, then: true })],
            ["sync throw", () => { throw new Error("socket") }],
            ["rejection", () => Promise.reject(new Error("socket"))],
        ]

        for (const [name, send] of cases) {
            const intent = createSelectionIntent()
            const token = intent.open(local())
            let applied = 0
            await requestSelection(intent, token, send, () => applied++)
            assert.equal(applied, 0, `${name}: accept never runs`)
            assert.equal(intent.pending(), token, `${name}: fence survives`)
        }
    })

    test("a stale completion applies nothing after supersede or release", async () => {
        const valid = { addr: "a1", view: "watch", draft_live: true, follow_peer: true }
        const superseded = deferred()
        const intent = createSelectionIntent()
        const token = intent.open(local())
        let applied = 0
        const settling = requestSelection(intent, token, () => superseded.promise, () => applied++)
        const newer = intent.supersede("a1")
        superseded.resolve(valid)
        await settling
        assert.equal(applied, 0)
        assert.equal(intent.pending(), newer)

        const released = deferred()
        const second = createSelectionIntent()
        const secondToken = second.open(local())
        const releasing = requestSelection(second, secondToken, () => released.promise, () => applied++)
        second.release()
        released.resolve(valid)
        await releasing
        assert.equal(applied, 0)
        assert.equal(second.pending(), null)
    })

    test("a null controller still sends and consumes a rejection", async () => {
        let sent = 0
        let applied = 0
        await requestSelection(
            null,
            null,
            () => { sent++; return Promise.reject(new Error("socket")) },
            () => applied++,
        )
        assert.equal(sent, 1)
        assert.equal(applied, 0)
    })

    test("owner is the subject; a receipt supersede never changes it", () => {
        const intent = createSelectionIntent()
        const owner = intent.open(local("a1"))

        assert.equal(intent.current(), owner)
        assert.equal(intent.owns(owner), true)

        const receipt = intent.supersede("a1")
        assert.notEqual(receipt, owner)
        assert.equal(intent.current(), owner, "readiness replaces the receipt only")
        assert.equal(intent.owns(owner), true)
        assert.equal(intent.owns(receipt), false)

        intent.release()
        assert.equal(intent.current(), null)
        assert.equal(intent.owns(owner), false)
    })

    test("install writes a body only under the exact owner subject", () => {
        const intent = createSelectionIntent()
        const owner = intent.open({ addr: "a1", view: "watch", draft_live: true })
        const body = local("a1")

        assert.equal(intent.install(owner, body), true)
        assert.equal(intent.current(), owner, "install never replaces the owner")
        assert.equal(intent.accepted(body), true)
        assert.equal(intent.install(owner, local("a2")), false, "subject mismatch refuses")
        assert.equal(intent.install({ addr: "a1" }, body), false, "foreign token refuses")
        assert.equal(intent.install(owner, "not-an-object"), false)
    })

    test("malformed or missing subjects never become an owner", () => {
        const intent = createSelectionIntent()

        intent.arrive("outerIntent", {})
        intent.arrive("seeOuterShell", { view: "watch" })
        assert.equal(intent.current(), null, "missing subjects do not establish ownership")

        const next = local("b1")
        intent.arrive("seeOuterShell", next)
        assert.equal(intent.current()?.addr, "b1", "a valid selection still lands")
        assert.equal(intent.accepted(next), true)

        const closed = createSelectionIntent()
        closed.arrive("outerIntent", { addr: null, view: "watch", draft_live: true, follow_peer: true })
        assert.equal(closed.current()?.addr, null, "an explicit closed selector is closed")
    })

    test("a malformed selector cannot establish an owner; a valid bootstrap can", () => {
        const intent = createSelectionIntent()

        intent.arrive("outerIntent", { addr: "x", view: "bogus", draft_live: true, follow_peer: true })
        assert.equal(intent.current(), null, "bogus view does not establish an owner")

        intent.arrive("outerIntent", { addr: null, view: "watch" })
        assert.equal(intent.current(), null, "an incomplete closed selector is refused")

        const valid = { addr: "b1", view: "watch", draft_live: true, follow_peer: true }
        intent.arrive("outerIntent", valid)
        assert.equal(intent.current()?.addr, "b1", "a valid bootstrap still lands")
        assert.equal(intent.accepted(valid), true)
    })

    test("a replacement controller fails unknown payloads closed", () => {
        const first = createSelectionIntent()
        installSelection(first)
        const payload = local("a1")
        first.arrive("seeOuterShell", payload)
        assert.equal(first.accepted(payload), true)

        const second = createSelectionIntent()
        installSelection(second)

        assert.equal(second.accepted(payload), false, "no decision survives a replacement")
        releaseSelection(second)
    })

})
