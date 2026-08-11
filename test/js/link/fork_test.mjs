// link.js forkRef — the fork word's ladder (specs link-actions, id:la-fork).
// Run: node --test test/js/link/fork_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { forkRef, shareForkRef } from "../../../assets/js/link.js"
import { name, write } from "../../../assets/js/keep/entry.js"

const TS = { t: 1000, n: 0 }
const ROOT = "b".repeat(64)
const WORK = "c".repeat(64)

const snap = (over = {}) =>
    write("snap", { source_id: "s1", title: "the chase", ...over.body },
        { root: ROOT, target: over.target ?? WORK, ts: TS })

// A term that answers like the real one: forkKeep finds-or-creates, and the
// test reads back WHAT it was asked, which is the contract under test.
function fakeTerm({ forks = {} } = {}) {
    const asked = { forkKeep: [], forkBuffer: [], select: [] }
    return {
        asked,
        forkKeep(ask) { asked.forkKeep.push(ask); return typeof ask.source === "string" || ask.found ? "kept-buf" : null },
        forkBuffer(ask) { asked.forkBuffer.push(ask); return "fork-buf" },
        findFork(addr) { return forks[addr] ?? null },
        opBufferHandler(op) { asked.select.push(op) },
    }
}

function fakeDoor({ keeps = {}, listed = [], sources = {} } = {}) {
    const wrote = { put: [], share: [] }
    return {
        wrote,
        async root() { return ROOT },
        async get(id) { return keeps[id] ?? null },
        async list() { return listed },
        async source(id) { return sources[id] ?? null },
        async put(bytes, extras) { wrote.put.push({ bytes, extras }); return name(bytes) },
        async share(id, fact) { wrote.share.push({ id, fact }) },
    }
}

const CORPUS_INDEX = { "frag-the-chase": { name: "the-chase", title: "The Chase" } }
const fakeCorpus = () => ({
    async index() { return CORPUS_INDEX },
    async fetch(n) { return n === "the-chase" ? "* THE CHASE\norg text" : null },
    press: () => ({ id: "frag-the-chase", title: "The Chase", source: "fw 100" }),
})

describe("shareForkRef — mint the fork word (id:la-fork-pull)", () => {
    const KEEP = "a".repeat(64)
    const OLDER = "d".repeat(64)
    const HEAD = "e".repeat(64)

    test("HEAD of the work shares the work_id — always latest at open", () => {
        assert.equal(shareForkRef(KEEP, { workId: WORK, headId: KEEP }), WORK)
    })

    test("an older keep is commit-specific — pins that keep's id", () => {
        assert.equal(shareForkRef(OLDER, { workId: WORK, headId: HEAD }), OLDER)
    })

    test("no work id falls back to the keep — still a valid face", () => {
        assert.equal(shareForkRef(KEEP, { workId: null, headId: KEEP }), KEEP)
        assert.equal(shareForkRef(KEEP, { headId: KEEP }), KEEP)
    })

    test("no keep is quiet null", () => {
        assert.equal(shareForkRef(null, { workId: WORK, headId: HEAD }), null)
        assert.equal(shareForkRef("", { workId: WORK, headId: HEAD }), null)
    })
})

describe("hex64 — a minted continuant", () => {
    test("a keep id lands its work and its source on forkKeep", async () => {
        const bytes = snap()
        const term = fakeTerm()
        const door = fakeDoor({ keeps: { [name(bytes)]: bytes }, sources: { s1: "fw 50" } })
        const landed = await forkRef(name(bytes), { door, term, say: () => {} })
        assert.equal(landed, "kept-buf")
        assert.deepEqual(term.asked.forkKeep, [{ work_id: WORK, source: "fw 50", name: "the chase" }])
    })

    test("a bare work id re-enters through the newest picture", async () => {
        const newest = snap({ body: { title: "later" } })
        const older = write("snap", { source_id: "s0", title: "earlier" },
            { root: ROOT, target: WORK, ts: { t: 1, n: 0 } })
        const term = fakeTerm()
        const door = fakeDoor({ listed: [newest, older], sources: { s1: "fw 50" } })
        const landed = await forkRef(WORK, { door, term, say: () => {} })
        assert.equal(landed, "kept-buf")
        assert.deepEqual(term.asked.forkKeep, [{ work_id: WORK, source: "fw 50", name: "later" }])
    })

    test("a tombstone still asks — find-only, source null, and says why", async () => {
        const bytes = snap()
        const said = []
        const term = fakeTerm()
        const door = fakeDoor({ keeps: { [name(bytes)]: bytes }, sources: {} })
        const landed = await forkRef(name(bytes), { door, term, say: (...a) => said.push(a) })
        assert.equal(landed, null)
        assert.equal(term.asked.forkKeep[0].source, null)
        assert.ok(said.length >= 1, "the wound is spoken")
    })

    test("nothing kept under the ref settles null and says so", async () => {
        const said = []
        const term = fakeTerm()
        const landed = await forkRef("d".repeat(64), { door: fakeDoor(), term, say: (...a) => said.push(a) })
        assert.equal(landed, null)
        assert.ok(said.length >= 1)
    })

    test("a throwing door is a fact, never an exception", async () => {
        const said = []
        const term = fakeTerm()
        const door = { async get() { throw new Error("dead worker") } }
        const landed = await forkRef("e".repeat(64), { door, term, say: (...a) => said.push(a) })
        assert.equal(landed, null)
        assert.equal(term.asked.forkKeep.length, 0)
        assert.ok(said.length >= 1)
    })
})

describe("the hand decides the gesture (id:la-fork-hand)", () => {
    const OTHER = "9".repeat(64)
    const foreign = (over = {}) =>
        write("snap", { source_id: "s1", title: "theirs", ...over.body },
            { root: OTHER, target: over.target ?? WORK, ts: TS })

    test("another hand's keep is a peer fork — forkBuffer by the river, never forkKeep", async () => {
        const bytes = foreign()
        const term = fakeTerm()
        const door = fakeDoor({ keeps: { [name(bytes)]: bytes }, sources: { s1: "fw 7" } })
        const landed = await forkRef(name(bytes), { door, term, say: () => {} })
        assert.equal(landed, "fork-buf")
        assert.equal(term.asked.forkKeep.length, 0, "a foreign hand never rejoins")
        assert.deepEqual(term.asked.forkBuffer,
            [{ source: "fw 7", name: "theirs", addr: WORK, time: TS.t }])
    })

    test("a pulled foreign keep is still kept, then peer-forked", async () => {
        const bytes = foreign()
        const term = fakeTerm()
        const door = fakeDoor()
        const pull = async () => ({ id: name(bytes), message: bytes, source: "fw 7", at: 5, node: "n1" })
        const landed = await forkRef(name(bytes), { door, term, pull, say: () => {} })
        assert.equal(landed, "fork-buf")
        assert.equal(door.wrote.put.length, 1, "the answer is kept — the link works offline next visit")
        assert.equal(term.asked.forkKeep.length, 0)
        assert.equal(term.asked.forkBuffer[0].addr, WORK)
    })

    test("a foreign tombstone still finds the fork already made", async () => {
        const bytes = foreign()
        const term = fakeTerm({ forks: { [WORK]: "held-buf" } })
        const door = fakeDoor({ keeps: { [name(bytes)]: bytes }, sources: {} })
        const landed = await forkRef(name(bytes), { door, term, say: () => {} })
        assert.equal(landed, "held-buf")
        assert.deepEqual(term.asked.select, [{ op: "select", target: "held-buf" }])
        assert.equal(term.asked.forkBuffer.length, 0)
    })

    test("a foreign tombstone with nothing held settles null and says so", async () => {
        const bytes = foreign()
        const said = []
        const term = fakeTerm()
        const door = fakeDoor({ keeps: { [name(bytes)]: bytes }, sources: {} })
        const landed = await forkRef(name(bytes), { door, term, say: (...a) => said.push(a) })
        assert.equal(landed, null)
        assert.ok(said.length >= 1)
    })

    test("my own keep still rejoins — the same-hand law is untouched", async () => {
        const bytes = snap()
        const term = fakeTerm()
        const door = fakeDoor({ keeps: { [name(bytes)]: bytes }, sources: { s1: "fw 50" } })
        const landed = await forkRef(name(bytes), { door, term, say: () => {} })
        assert.equal(landed, "kept-buf")
        assert.equal(term.asked.forkBuffer.length, 0)
    })
})

describe("pull — beyond this machine (id:la-fork-pull)", () => {
    test("a local miss pulls, keeps the answer, and forks with the pulled source", async () => {
        const bytes = snap()
        const term = fakeTerm()
        const door = fakeDoor()
        const pull = async () => ({ id: name(bytes), message: bytes, source: "fw 9", at: 5, node: "n1" })
        const landed = await forkRef(name(bytes), { door, term, pull, say: () => {} })
        assert.equal(landed, "kept-buf")
        assert.deepEqual(term.asked.forkKeep, [{ work_id: WORK, source: "fw 9", name: "the chase" }])
        assert.deepEqual(door.wrote.put, [{ bytes, extras: { source: "fw 9" } }])
        assert.deepEqual(door.wrote.share, [{ id: name(bytes), fact: { at: 5, node: "n1" } }])
    })

    test("a work face pulls the HEAD of the chain — target must be the ref", async () => {
        const bytes = snap({ body: { title: "head" } })
        const term = fakeTerm()
        const door = fakeDoor()
        const pull = async () => ({ id: name(bytes), message: bytes, source: "fw 9", at: 7, node: "n1" })
        const landed = await forkRef(WORK, { door, term, pull, say: () => {} })
        assert.equal(landed, "kept-buf")
        assert.equal(term.asked.forkKeep[0].work_id, WORK)
        assert.equal(door.wrote.put.length, 1)
    })

    test("a work face re-pulls HEAD even when a local keep already stands", async () => {
        // The first visit accepted an old keep; without re-pull the HEAD link
        // freezes that artifact forever (the user's two-link "same initial").
        const older = write("snap", { source_id: "s0", title: "first" },
            { root: ROOT, target: WORK, ts: { t: 1, n: 0 } })
        const head = write("snap", { source_id: "s1", title: "later" },
            { root: ROOT, target: WORK, ts: { t: 2000, n: 0 } })
        const term = fakeTerm()
        const door = fakeDoor({
            listed: [older],
            keeps: { [name(older)]: older },
            sources: { s0: "fw 1", s1: "fw 99" },
        })
        const pull = async () => ({ id: name(head), message: head, source: "fw 99", at: 9, node: "n1" })
        const landed = await forkRef(WORK, { door, term, pull, say: () => {} })
        assert.equal(landed, "kept-buf")
        assert.deepEqual(term.asked.forkKeep, [{ work_id: WORK, source: "fw 99", name: "later" }])
        assert.equal(door.wrote.put.length, 1, "the newer HEAD is kept")
        assert.equal(door.wrote.put[0].bytes, head)
    })

    test("a work face keeps a newer local head when the room is behind", async () => {
        const local = write("snap", { source_id: "s1", title: "mine" },
            { root: ROOT, target: WORK, ts: { t: 5000, n: 0 } })
        const room = write("snap", { source_id: "s0", title: "old share" },
            { root: ROOT, target: WORK, ts: { t: 1, n: 0 } })
        const term = fakeTerm()
        const door = fakeDoor({
            listed: [local],
            keeps: { [name(local)]: local },
            sources: { s1: "fw local", s0: "fw room" },
        })
        const pull = async () => ({ id: name(room), message: room, source: "fw room", at: 1, node: "n1" })
        await forkRef(WORK, { door, term, pull, say: () => {} })
        assert.deepEqual(term.asked.forkKeep, [{ work_id: WORK, source: "fw local", name: "mine" }])
        assert.equal(door.wrote.put.length, 0, "local already newer — no re-accept of the room's past")
    })

    test("a keep face stays pinned — does not chase HEAD", async () => {
        const older = write("snap", { source_id: "s0", title: "pinned" },
            { root: ROOT, target: WORK, ts: { t: 1, n: 0 } })
        const head = write("snap", { source_id: "s1", title: "later" },
            { root: ROOT, target: WORK, ts: { t: 2000, n: 0 } })
        const term = fakeTerm()
        const door = fakeDoor({
            keeps: { [name(older)]: older },
            sources: { s0: "fw 1", s1: "fw 99" },
        })
        // Pull would answer HEAD if asked; keep face must not ask for work HEAD.
        let pulled = 0
        const pull = async () => {
            pulled++
            return { id: name(head), message: head, source: "fw 99", at: 9, node: "n1" }
        }
        await forkRef(name(older), { door, term, pull, say: () => {} })
        assert.equal(pulled, 0, "commit-specific never re-pulls")
        assert.deepEqual(term.asked.forkKeep, [{ work_id: WORK, source: "fw 1", name: "pinned" }])
    })

    test("a lying room lands nothing — wrong bytes are refused at the reader", async () => {
        const bytes = snap()
        const said = []
        const term = fakeTerm()
        const door = fakeDoor()
        const wrongRef = "9".repeat(64)
        const pull = async () => ({ id: wrongRef, message: bytes, source: "fw 9", at: 5, node: "n1" })
        const landed = await forkRef(wrongRef, { door, term, pull, say: (...a) => said.push(a) })
        assert.equal(landed, null)
        assert.equal(door.wrote.put.length, 0, "nothing accepted")
        assert.deepEqual(term.asked.forkKeep, [{ work_id: wrongRef, source: null, name: null }],
            "still a find — a buffer bearing the work would answer")
        assert.ok(said.length >= 1)
    })

    test("a room that does not hold the ref is spoken; the find still runs", async () => {
        const said = []
        const term = fakeTerm()
        const door = fakeDoor()
        const landed = await forkRef("d".repeat(64), { door, term, pull: async () => null, say: (...a) => said.push(a) })
        assert.equal(landed, null)
        assert.equal(term.asked.forkKeep.length, 1)
        assert.ok(said.length >= 1)
    })

    test("a throwing pull is a fact, never an exception", async () => {
        const term = fakeTerm()
        const door = fakeDoor()
        const landed = await forkRef("d".repeat(64), { door, term, pull: async () => { throw new Error("net") }, say: () => {} })
        assert.equal(landed, null)
        assert.equal(door.wrote.put.length, 0)
    })

    test("an answer without a fact is kept local — put without share", async () => {
        const bytes = snap()
        const term = fakeTerm()
        const door = fakeDoor()
        const pull = async () => ({ id: name(bytes), message: bytes, source: "fw 9" })
        await forkRef(name(bytes), { door, term, pull, say: () => {} })
        assert.equal(door.wrote.put.length, 1)
        assert.equal(door.wrote.share.length, 0, "no fact, no share — put then share stays the order")
    })
})

describe("a corpus word", () => {
    test("a name presses the page onto forkBuffer under ~/name", async () => {
        const term = fakeTerm()
        const landed = await forkRef("the-chase", { term, corpus: fakeCorpus(), say: () => {} })
        assert.equal(landed, "fork-buf")
        assert.deepEqual(term.asked.forkBuffer,
            [{ source: "fw 100", name: "The Chase", addr: "~/the-chase" }])
    })

    test("an id-face resolves through the index to the same landing", async () => {
        const term = fakeTerm()
        const landed = await forkRef("frag-the-chase", { term, corpus: fakeCorpus(), say: () => {} })
        assert.equal(landed, "fork-buf")
        assert.equal(term.asked.forkBuffer[0].addr, "~/the-chase")
    })

    test("an unborn word settles null and says so", async () => {
        const said = []
        const term = fakeTerm()
        const landed = await forkRef("no-such-page", { term, corpus: fakeCorpus(), say: (...a) => said.push(a) })
        assert.equal(landed, null)
        assert.equal(term.asked.forkBuffer.length, 0)
        assert.ok(said.length >= 1)
    })
})

describe("the floor", () => {
    test("no terminal standing is spoken, not thrown", async () => {
        const said = []
        assert.equal(await forkRef("x", { say: (...a) => said.push(a) }), null)
        assert.ok(said.length >= 1)
    })

    test("no door for a hex64 ref is spoken, not thrown", async () => {
        const said = []
        assert.equal(await forkRef("f".repeat(64), { term: fakeTerm(), say: (...a) => said.push(a) }), null)
        assert.ok(said.length >= 1)
    })

    test("an empty ref is quiet null", async () => {
        assert.equal(await forkRef("", { term: fakeTerm() }), null)
        assert.equal(await forkRef(null, { term: fakeTerm() }), null)
    })
})
