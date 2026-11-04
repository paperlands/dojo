// The cut is a value the owner lent. Pace checks the same claim object again.

import { test } from "node:test"
import assert from "node:assert/strict"
import {
    copyBody, copyLayers, copySurface, createCapture, currentDemand, publishCapture,
} from "../../../assets/js/turtling/capture.js"

function claim(id) {
    return { id }
}

function lend(owner, source, extra = {}) {
    return {
        body: {
            source,
            commands: extra.commands ?? [{ value: source, meta: { nest: { n: 1 } } }],
            diagnostics: extra.diagnostics ?? [{ message: source, nest: { n: 1 } }],
            attend: extra.attend ?? { line: 1 },
            buffer_id: extra.buffer_id ?? "buf",
        },
        claim: owner,
    }
}

test("the same owner publishes the frozen cut; a replaced owner is dropped", () => {
    const owner = claim("A")
    const lent = lend(owner, "program-A")
    const body = copyBody(lent.body)
    lent.body.commands[0].meta.nest.n = 9
    lent.body.diagnostics[0].nest.n = 9
    const pushes = []
    const claims = []
    const pace = (payload, got) => {
        claims.push(got)
        if (got && got !== owner) return
        pushes.push(payload)
    }
    assert.equal(publishCapture({ body, path: "picture-A", claim: owner }, pace), true)
    assert.equal(pushes[0].source, "program-A")
    assert.equal(pushes[0].commands[0].meta.nest.n, 1)
    assert.equal(pushes[0].diagnostics[0].nest.n, 1)
    assert.equal(pushes[0].path, "picture-A")
    assert.equal(claims[0], owner)
    assert.equal("claim" in pushes[0], false)

    const before = pushes.length
    publishCapture({ body, path: "picture-A", claim: claim("B") }, pace)
    assert.equal(pushes.length, before)
    assert.equal(publishCapture({ source: "unbound-payload", path: "picture-A" }, pace), false)
})

test("a disposed picture is null, and an old completion cannot settle the next cut", async () => {
    const caps = createCapture()
    const waiting = caps.picture()
    const active = caps.begin({ body: { source: "A" }, claim: claim("A") })
    caps.close()
    assert.equal(await waiting, null)
    assert.equal(await active.promise, null)
    assert.equal(await caps.picture(), null)
    const later = createCapture()
    const first = later.begin({ body: { source: "A" }, claim: claim("A") })
    later.finish(first, "path-A")
    const second = later.picture()
    later.fail(first)
    let settled = false
    second.then(() => { settled = true })
    await Promise.resolve()
    assert.equal(settled, false)
    later.finish(later.begin(null), null)
    assert.equal(await second, null)
})

test("an active cut stays A while a keep waits for the next draw", async () => {
    const caps = createCapture()
    const ownerA = claim("A")
    const active = caps.begin({
        body: copyBody(lend(ownerA, "A").body),
        claim: ownerA,
        save: { save: false },
    })
    const keep = caps.picture()
    assert.notEqual(keep, active.promise)
    assert.equal(caps.hatching, true)
    caps.finish(active, "path-A")
    assert.equal((await active.promise).body.source, "A")
    assert.equal((await active.promise).path, "path-A")
    const ownerB = claim("B")
    const liveSave = { save: true, title: "after" }
    const save = structuredClone(liveSave)
    liveSave.title = "mutated"
    const next = caps.begin({
        body: copyBody(lend(ownerB, "B").body),
        claim: ownerB,
        save,
    })
    assert.equal(next.promise, keep)
    assert.equal(next.cut.save.title, "after")
    caps.finish(next, "path-B")
    assert.equal((await keep).body.source, "B")
    assert.equal((await keep).path, "path-B")
    assert.equal((await keep).claim, ownerB)
})

test("two asks before the cut share one unissued promise", async () => {
    const caps = createCapture()
    const first = caps.picture()
    const second = caps.picture()
    assert.equal(first, second)
    assert.equal(caps.hatching, false)
    const issued = caps.begin({ body: copyBody(lend(claim("A"), "shared").body), claim: claim("A") })
    caps.finish(issued, "once")
    assert.equal(await first, await second)
    assert.equal((await first).path, "once")
})

test("a marker layer is drawn onto a new surface, not aliased", () => {
    const source = { width: 2, height: 1, pixels: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }
    const copy = copySurface(source, (width, height) => {
        const pixels = new Uint8Array(width * height * 4)
        return {
            width, height, pixels,
            getContext: () => ({ drawImage(layer) { pixels.set(layer.pixels) } }),
        }
    })
    source.pixels[0] = 9
    source.width = 0
    assert.equal(copy.pixels[0], 1)
    assert.equal(copy.width, 2)
    assert.equal(copySurface({ width: 0, height: 1 }, () => ({})), undefined)
    assert.equal(copyLayers([{ width: 2, height: 1 }], () => null), null)
})

test("a doc-only demand stays current and carries no picture", () => {
    const demand = currentDemand({ source: "now", commands: [], state: "success" }, "buf")
    assert.equal(demand.path, null)
    assert.equal(demand.source, "now")
    assert.equal(demand.buffer_id, "buf")
    assert.equal(demand.work_id, null)
    assert.equal(demand.base_id, null)
    assert.equal(demand.state, "success")
})

test("a live demand carries its work and exact editing base", () => {
    const demand = currentDemand({ source: "now" }, "buf", "work", "base")
    assert.equal(demand.work_id, "work")
    assert.equal(demand.base_id, "base")
})
