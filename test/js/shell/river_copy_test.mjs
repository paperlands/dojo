// Actual copy callback: live gate, selection/epoch, clipboard boundary.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { name, read, write } from "../../../assets/js/keep/entry.js"
import { bytesOf } from "../../../assets/js/river/keeps.js"
import { copyText as nativeCopyText } from "../../../assets/js/utils/clipboard.js"

const source = readFileSync(new URL("../../../assets/js/hooks/shell/river.js", import.meta.url), "utf8")
const marker = 'arena.on(copy, "click", async (e) => {'
const start = source.indexOf(marker)
assert.ok(start >= 0, "the copy gesture must still have one owner")
const end = source.indexOf("\n        })", start)
assert.ok(end > start)
const callback = `(async function(e) {${source.slice(start + marker.length, end)}\n})`

const root = "a".repeat(64)
const origin = write("snap", { source_id: name("fw 1") }, { root, ts: { t: 1, n: 0 } })
const work = name(origin)
const child = write("snap", { source_id: name("fw 2") }, { root, target: work, ts: { t: 2, n: 0 } })
const id = name(child)

function deferred() {
    let resolve
    const promise = new Promise(done => { resolve = done })
    return { promise, resolve }
}

function fixture(live = async () => `work:${work}`) {
    const writes = []
    const painted = []
    const rearmed = []
    const asked = []
    const scope = {
        epoch: 1,
        copyAttempt: 0,
        arena: { alive: true },
        at: { key: "kept", id },
        view: { newestId: id },
        keeps: new Map([[id, { bytes: child }]]),
        name, read, bytesOf,
        liveForkRef: (ask) => { asked.push(ask); return live(ask) },
        copyText: async (url) => {
            try {
                const text = await url
                writes.push(text)
                return true
            } catch {
                return false
            }
        },
        link: { address: ({ fork }) => `http://fixture/?fork=${encodeURIComponent(fork)}` },
        copy: { classList: { add: value => painted.push(value) }, title: "copy link" },
        uncopy: () => rearmed.push(true),
    }
    const click = runInNewContext(callback, scope)
    return { scope, writes, painted, rearmed, asked, click: () => click({ preventDefault() {}, stopPropagation() {} }) }
}

function ref(url) {
    return new URL(url, "http://fixture/").searchParams.get("fork")
}

test("copy asks the live gate for the selected id/work and copies its answer", async () => {
    const f = fixture()
    await f.click()
    assert.equal(f.asked.length, 1)
    assert.equal(f.asked[0].id, id)
    assert.equal(f.asked[0].work, work)
    assert.equal(ref(f.writes[0]), `work:${work}`)
    assert.deepEqual(f.painted, ["is-copied"])
})

test("a not-live answer copies nothing", async () => {
    const f = fixture(async () => null)
    await f.click()
    assert.deepEqual(f.writes, [])
    assert.deepEqual(f.painted, [])
})

test("a false clipboard result is not painted as copied", async () => {
    const f = fixture()
    f.scope.copyText = async (url) => {
        const text = await url
        f.writes.push(text)
        return false
    }
    await f.click()
    assert.equal(f.writes.length, 1)
    assert.equal(f.asked.length, 1, "no fallback live check")
    assert.deepEqual(f.painted, [])
    assert.deepEqual(f.rearmed, [])
    assert.equal(f.scope.copy.title, "copy link")
})

test("a retired owner cannot copy when the live check completes late", async () => {
    const held = deferred()
    const f = fixture(() => held.promise)
    const pending = f.click()
    f.scope.arena.alive = false
    held.resolve(`keep:${id}`)
    await pending
    assert.deepEqual(f.writes, [])
    assert.deepEqual(f.rearmed, [])
})

test("a late head change cannot publish a stale live link", async () => {
    const held = deferred()
    const f = fixture(() => held.promise)
    const pending = f.click()
    f.scope.view.newestId = "e".repeat(64)
    held.resolve(`keep:${id}`)
    await pending
    assert.deepEqual(f.writes, [])
})

test("a new epoch retires the pending copy effect", async () => {
    const held = deferred()
    const f = fixture(() => held.promise)
    const pending = f.click()
    f.scope.epoch++
    held.resolve(`keep:${id}`)
    await pending
    assert.deepEqual(f.writes, [])
})

test("changing the selected keep cannot copy or paint the obsolete selection", async () => {
    const held = deferred()
    const f = fixture(() => held.promise)
    const pending = f.click()
    f.scope.at = { key: "kept", id: work }
    held.resolve(`keep:${id}`)
    await pending
    assert.deepEqual(f.writes, [])
    assert.deepEqual(f.painted, [])
})

test("retirement during clipboard completion cannot repaint or rearm a dead owner", async () => {
    const clipboard = deferred()
    const called = deferred()
    const f = fixture(async () => `keep:${id}`)
    f.scope.copyText = async (url) => {
        const text = await url
        f.writes.push(text)
        called.resolve()
        await clipboard.promise
    }
    const pending = f.click()
    await called.promise
    f.scope.arena.alive = false
    clipboard.resolve()
    await pending
    assert.equal(f.writes.length, 1, "the already-issued native request cannot be retracted")
    assert.deepEqual(f.painted, [])
    assert.deepEqual(f.rearmed, [])
})

test("overlapping clicks: newer attempt retires older payload and paint", async () => {
    const held = []
    const f = fixture(() => {
        const d = deferred()
        held.push(d)
        return d.promise
    })
    const first = f.click()
    const second = f.click()
    assert.equal(held.length, 2)
    held[0].resolve(`keep:${id}`)
    held[1].resolve(`keep:${work}`)
    await Promise.all([first, second])
    assert.equal(f.writes.length, 1)
    assert.equal(ref(f.writes[0]), `keep:${work}`)
    assert.equal(f.painted.length, 1)
})

test("actual prepared helper starts the native write before the live answer", async () => {
    const held = deferred()
    const f = fixture(() => held.promise)
    f.scope.copyText = nativeCopyText
    const items = []
    const writes = []
    globalThis.ClipboardItem = class {
        constructor(data) {
            this.data = data
            items.push(this)
        }
    }
    const originalNavigator = globalThis.navigator
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        writable: true,
        value: {
            clipboard: {
                write: async (list) => {
                    writes.push(list)
                    await list[0].data["text/plain"]
                },
            },
        },
    })
    try {
        const pending = f.click()
        await Promise.resolve()
        assert.equal(writes.length, 1, "native write starts inside the gesture")
        held.resolve(`keep:${id}`)
        await pending
        assert.equal(f.painted.length, 1)
        assert.equal(ref(await (await items[0].data["text/plain"]).text()), `keep:${id}`)
    } finally {
        delete globalThis.ClipboardItem
        Object.defineProperty(globalThis, "navigator", {
            value: originalNavigator,
            configurable: true,
            writable: true,
        })
    }
})
