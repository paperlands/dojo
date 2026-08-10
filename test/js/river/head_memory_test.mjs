// Head memory — unkept present, so refresh cannot kill the head.
import { describe, test, beforeEach } from "node:test"
import assert from "node:assert/strict"
import { readHead, writeHead } from "../../../assets/js/river/head-memory.js"

const WORK = "w".repeat(64)
const OTHER = "o".repeat(64)

const mem = new Map()
globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)) },
    removeItem: (k) => { mem.delete(k) },
    clear: () => { mem.clear() },
}

beforeEach(() => mem.clear())

describe("head memory: the unkept present per work", () => {
    test("round-trip holds the head buffer text", () => {
        writeHead(WORK, "label 'mine' 10\n")
        assert.equal(readHead(WORK), "label 'mine' 10\n")
    })

    test("works do not share a head", () => {
        writeHead(WORK, "fw 1")
        writeHead(OTHER, "fw 2")
        assert.equal(readHead(WORK), "fw 1")
        assert.equal(readHead(OTHER), "fw 2")
    })

    test("null clears; missing is null", () => {
        writeHead(WORK, "x")
        writeHead(WORK, null)
        assert.equal(readHead(WORK), null)
        assert.equal(readHead(null), null)
    })
})
