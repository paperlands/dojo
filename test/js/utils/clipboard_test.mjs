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

beforeEach(() => {
    delete globalThis.navigator
    delete globalThis.document
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
