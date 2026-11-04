// Copy text — the async way when the browser offers it, the oldest way when
// it does not. A denied clipboard is a fallback, never a throw.
import { describe, test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { copyText } from "../../../assets/js/utils/clipboard.js"

/** Minimal document: enough for one detached textarea. */
function stubDoc({ copies = true, execCommand = true } = {}) {
    const made = []
    const body = { appendChild: (el) => made.push(el) }
    globalThis.document = {
        body,
        createElement: () => {
            const el = {
                style: {},
                value: "",
                attrs: {},
                setAttribute: (k, v) => { el.attrs[k] = v },
                select: () => { el.selected = true },
                remove: () => { el.gone = true },
            }
            return el
        },
    }
    if (execCommand) globalThis.document.execCommand = () => copies
    return made
}

function deferred() {
    let resolve, reject
    const promise = new Promise((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve, reject }
}

function nativePrepared({ write } = {}) {
    const items = []
    const writes = []
    globalThis.ClipboardItem = class {
        constructor(data) {
            this.data = data
            items.push(this)
        }
    }
    const consume = write ?? (async (list) => { await list[0].data["text/plain"] })
    globalThis.navigator = {
        clipboard: {
            write: async (list) => {
                writes.push(list)
                return consume(list)
            },
        },
    }
    return { items, writes }
}

beforeEach(() => {
    delete globalThis.navigator
    delete globalThis.document
    delete globalThis.ClipboardItem
})

describe("copyText: one verb, always answers", () => {
    test("the async clipboard takes it — no textarea is born", async () => {
        const wrote = []
        globalThis.navigator = { clipboard: { writeText: async (t) => wrote.push(t) } }
        const made = stubDoc()
        assert.equal(await copyText("hello"), true)
        assert.deepEqual(wrote, ["hello"])
        assert.equal(made.length, 0)
    })

    test("no clipboard at all → the textarea way, then it leaves no trace", async () => {
        globalThis.navigator = {}
        const made = stubDoc()
        assert.equal(await copyText("hello"), true)
        assert.equal(made.length, 1)
        assert.equal(made[0].value, "hello")
        assert.equal(made[0].selected, true)
        assert.equal(made[0].gone, true)
    })

    test("a denied clipboard falls through, it does not throw", async () => {
        globalThis.navigator = {
            clipboard: { writeText: async () => { throw new Error("denied") } },
        }
        const made = stubDoc()
        assert.equal(await copyText("hello"), true)
        assert.equal(made.length, 1)
    })

    test("neither way works → false, and still no throw", async () => {
        globalThis.navigator = {}
        stubDoc({ execCommand: false })
        assert.equal(await copyText("hello"), false)
    })

    test("execCommand refusing is an answer, not a crash", async () => {
        globalThis.navigator = {}
        stubDoc({ copies: false })
        assert.equal(await copyText("hello"), false)
    })
})

describe("copyText: prepared promise starts the native write in the gesture", () => {
    test("write starts before the URL resolves and carries text/plain", async () => {
        const text = deferred()
        const { items, writes } = nativePrepared()
        const pending = copyText(text.promise)
        await Promise.resolve()
        assert.equal(writes.length, 1)
        assert.equal(items.length, 1)
        text.resolve("hello")
        assert.equal(await pending, true)
        const blob = await items[0].data["text/plain"]
        assert.equal(blob.type, "text/plain")
        assert.equal(await blob.text(), "hello")
    })

    test("a prepared rejection is false; the native write rejects, no fallback", async () => {
        const text = deferred()
        const { writes } = nativePrepared()
        const made = stubDoc()
        const pending = copyText(text.promise)
        text.reject(new Error("not live"))
        assert.equal(await pending, false)
        assert.equal(writes.length, 1)
        assert.equal(made.length, 0)
    })

    test("unsupported prepared backend refuses and still observes a later rejection", async () => {
        globalThis.navigator = {}
        const made = stubDoc()
        const text = deferred()
        assert.equal(await copyText(text.promise), false)
        assert.equal(made.length, 0, "no textarea fallback")
        text.reject(new Error("late stale"))
        await Promise.resolve()
        await Promise.resolve()
    })

    test("an early ClipboardItem constructor throw refuses and observes later rejection", async () => {
        globalThis.ClipboardItem = class {
            constructor() { throw new Error("no item") }
        }
        globalThis.navigator = { clipboard: { write: async () => {} } }
        const text = deferred()
        assert.equal(await copyText(text.promise), false)
        text.reject(new Error("late stale"))
        await Promise.resolve()
        await Promise.resolve()
    })

    test("an early write throw refuses and observes later rejection", async () => {
        globalThis.ClipboardItem = class { constructor(data) { this.data = data } }
        globalThis.navigator = { clipboard: { write: () => { throw new Error("denied") } } }
        const text = deferred()
        assert.equal(await copyText(text.promise), false)
        text.reject(new Error("late stale"))
        await Promise.resolve()
        await Promise.resolve()
    })

    test("prepared non-string refuses, never Blob('null')", async () => {
        const text = deferred()
        const { items } = nativePrepared()
        const pending = copyText(text.promise)
        text.resolve(null)
        assert.equal(await pending, false)
        await assert.rejects(items[0].data["text/plain"], /prepared text/)
    })
})
