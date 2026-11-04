// A work's history is indexed by its exact origin, not the active hand.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createContext, runInContext } from "node:vm"
import { pageRootOf } from "../../../assets/js/hooks/shell/river.js"
import { write, name } from "../../../assets/js/keep/entry.js"
import { REACH } from "../../../assets/js/keep/page.js"
import { adoptWork, ofWork } from "../../../assets/js/keep/work.js"

const ROOT = "a".repeat(64), OTHER = "b".repeat(64)
const origin = write("snap", { title: "birth" }, { root: ROOT, ts: { t: 1, n: 0 } })
const work = name(origin)
const child = write("snap", { title: "child" }, { root: ROOT, target: work, ts: { t: 2, n: 0 } })

test("a known origin keeps its history visible after the active hand changes", () => {
    assert.equal(pageRootOf({ origin, work, fallback: OTHER }), ROOT)
})

test("a child is not an origin; unknown or unreadable falls back", () => {
    assert.equal(pageRootOf({ origin: child, work: name(child), fallback: OTHER }), OTHER)
    assert.equal(pageRootOf({ origin: null, work, fallback: OTHER }), OTHER)
    assert.equal(pageRootOf({ origin: "not json", work: name("not json"), fallback: OTHER }), OTHER)
})

// ── the consumer, not just the pure law ─────────────────────────────
const riverSource = readFileSync(
    new URL("../../../assets/js/hooks/shell/river.js", import.meta.url), "utf8")
const readStart = riverSource.indexOf("    async function readPage(alive) {")
const readEnd = riverSource.indexOf("\n    /** Index the page", readStart)
assert.ok(readStart >= 0 && readEnd > readStart, "readPage must keep one owner")
const readPageSource = riverSource.slice(readStart, readEnd)
const ghostStart = riverSource.indexOf("    async function readGhostPage(alive) {")
const ghostEnd = riverSource.indexOf("\n    /** The door's page", ghostStart)
assert.ok(ghostStart >= 0 && ghostEnd > ghostStart, "readGhostPage must keep one owner")
const readGhostPageSource = riverSource.slice(ghostStart, ghostEnd)
const NO_PAGE = Object.freeze({ versions: [], held: [] })

function harness(door, peer = null, pulls = {}) {
    const context = createContext({
        NO_PAGE,
        REACH,
        pageRootOf,
        ofWork,
        adoptWork,
        work,
        name,
        peer,
        focus: peer ? "peer" : "core",
        pullHistory: pulls.history ?? (async () => null),
        pullKeep: pulls.base ?? (async () => null),
        term: { get: () => ({ currentBufferId: () => "b1", adoptWork: () => {} }) },
        getDoor: () => door,
    })
    runInContext(readPageSource + "\n" + readGhostPageSource, context)
    return (which = "readPage") => runInContext(`${which}(() => true)`, context)
}

test("known-origin history reads without read-or-minting a current signer", async () => {
    let rootCalls = 0, listedAt = null
    const door = {
        get: async (id) => (id === work ? origin : null),
        root: () => { rootCalls += 1; throw new Error("a signer must not be read") },
        list: async (root) => { listedAt = root; return [child] },
        local: async () => [],
    }
    const page = await harness(door)()
    assert.equal(rootCalls, 0, "door.root must not be asked for known history")
    assert.equal(listedAt, ROOT, "the page is indexed at the origin's root")
    assert.deepEqual(page.versions, [child])
    assert.equal(page.held.length, 0)
})

test("a ghost page pulls target history and its exact cross-work base", async () => {
    const base = write("snap", { title: "base" }, { root: ROOT, ts: { t: 9, n: 0 } })
    const ghost = { work, base: name(base) }
    const page = await harness({}, ghost, {
        history: async () => ({ keeps: [{ message: child }], next: null }),
        base: async () => ({ message: base, source: "fw 1" }),
    })("readGhostPage")
    assert.equal(page.versions.join("\n"), [child, base].join("\n"))
    assert.equal(page.held.length, 0)
})

test("an unknown origin falls back to the active root exactly once", async () => {
    let rootCalls = 0, listedAt = null
    const door = {
        get: async () => null,
        root: async () => { rootCalls += 1; return OTHER },
        list: async (root) => { listedAt = root; return [child] },
        local: async () => [],
    }
    const page = await harness(door)()
    assert.equal(rootCalls, 1, "the fallback is asked only when origin cannot index")
    assert.equal(listedAt, OTHER)
    assert.deepEqual(page.versions, [child], "ofWork still filters by the work id")
})
