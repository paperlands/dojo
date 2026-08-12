// The work fold — ofWork, the lines, the meet, the columns (id:kr-fold,
// id:kr-mirror). Pure: no journal, no DOM, no mocks to build.
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
    columnsOf,
    lineOf,
    linesOf,
    meetOf,
    mirrorOf,
    newerKeep,
    ofWork,
} from "../../../assets/js/keep/work.js"
import { name, write } from "../../../assets/js/keep/entry.js"

const ROOT = "r".repeat(64)
const WORK = "w".repeat(64)
const OTHER = "o".repeat(64)

// A snap as authored: target is the work, prev absent until a fork mints it.
function snap(tag, { work = WORK, t = 100, prev } = {}) {
    const body = { source_id: name(tag), diagnostics: [], buffer_id: null }
    if (prev !== undefined) body.prev = prev
    return write("snap", body, { root: ROOT, target: work, ts: { t, n: 0 } })
}

// list() hands the page newest-first; so does every fold over it.
const newestFirst = (...bytes) => [...bytes].reverse()

describe("ofWork: the work's keeps among a page of the author's history", () => {
    test("keeps this work, drops the rest, preserves list's order", () => {
        const a = snap("a", { t: 1 })
        const b = snap("b", { t: 2 })
        const elsewhere = snap("x", { work: OTHER, t: 3 })
        const c = snap("c", { t: 4 })
        const listed = newestFirst(a, b, elsewhere, c)

        const versions = ofWork(listed, WORK)
        assert.deepEqual(versions, [c, b, a])
        assert.deepEqual(ofWork(listed, OTHER), [elsewhere])
    })

    test("an empty work is an empty strip, never an error", () => {
        assert.deepEqual(ofWork([], WORK), [])
        assert.deepEqual(ofWork([snap("a")], "z".repeat(64)), [])
    })

    test("no work_id folds to nothing — never the whole log", () => {
        // A shell with no current buffer must not paint another work's river.
        const listed = [snap("a"), snap("b", { work: OTHER })]
        assert.deepEqual(ofWork(listed, null), [])
        assert.deepEqual(ofWork(listed, undefined), [])
        assert.deepEqual(ofWork(listed, ""), [])
    })

    test("an unreadable message is not this work's — it does not throw", () => {
        const good = snap("a")
        assert.deepEqual(ofWork(["{not json", good], WORK), [good])
    })

    test("page honesty: the fold shows only what the page held (id:kb-8-page)", () => {
        // Ten keeps of this work exist; the page carried the newest three.
        const all = Array.from({ length: 10 }, (_, i) => snap(`k${i}`, { t: i }))
        const page = newestFirst(...all.slice(7))
        assert.equal(ofWork(page, WORK).length, 3)
    })
})

describe("newerKeep: author order, pure (id:kb-8)", () => {
    test("the later ts wins", () => {
        const older = snap("a", { t: 1 })
        const newer = snap("b", { t: 9 })
        assert.equal(newerKeep(older, newer), newer)
        assert.equal(newerKeep(newer, older), newer)
    })

    test("a missing side loses; unreadable loses", () => {
        const good = snap("a", { t: 5 })
        assert.equal(newerKeep(null, good), good)
        assert.equal(newerKeep(good, null), good)
        assert.equal(newerKeep(good, "{not json"), good)
    })
})

describe("the lines: prev when minted, author order until then (id:kr-mirror)", () => {
    test("with no prev anywhere the river is ONE line, newest at the head", () => {
        const a = snap("a", { t: 1 })
        const b = snap("b", { t: 2 })
        const c = snap("c", { t: 3 })
        const versions = [c, b, a]

        const { heads } = linesOf(versions)
        assert.deepEqual(heads, [name(c)], "one head — the river un-forked")
        assert.deepEqual(lineOf(versions, name(c)), [c, b, a])
    })

    test("a fork mints prev, and then two heads stand", () => {
        //        a ── b ── c        (this line)
        //             └─── d ── e   (the sibling)
        const a = snap("a", { t: 1, prev: null })
        const b = snap("b", { t: 2, prev: name(a) })
        const c = snap("c", { t: 3, prev: name(b) })
        const d = snap("d", { t: 4, prev: name(b) })
        const e = snap("e", { t: 5, prev: name(d) })
        const versions = [e, d, c, b, a]

        const { heads } = linesOf(versions)
        assert.deepEqual(new Set(heads), new Set([name(c), name(e)]))
        assert.deepEqual(lineOf(versions, name(c)), [c, b, a])
        assert.deepEqual(lineOf(versions, name(e)), [e, d, b, a])
    })

    test("first fork on a still-linear river: prev on the new keep only", () => {
        // a─b─c linear (no prev keys); e forks from b
        const a = snap("a", { t: 1 })
        const b = snap("b", { t: 2 })
        const c = snap("c", { t: 3 })
        const e = snap("e", { t: 4, prev: name(b) })
        const versions = [e, c, b, a]

        const { heads } = linesOf(versions)
        assert.deepEqual(new Set(heads), new Set([name(c), name(e)]))
        assert.deepEqual(lineOf(versions, name(c)), [c, b, a], "old head walks by time")
        assert.deepEqual(lineOf(versions, name(e)), [e, b, a], "fork walks prev then time")
        assert.equal(meetOf(lineOf(versions, name(c)), lineOf(versions, name(e))), name(b))
    })

    test("a prev outside the page is a foot, not a broken link", () => {
        // The parent is under the horizon; the line simply ends there.
        const gone = snap("gone", { t: 0, prev: null })
        const a = snap("a", { t: 1, prev: name(gone) })
        const b = snap("b", { t: 2, prev: name(a) })
        assert.deepEqual(lineOf([b, a], name(b)), [b, a])
    })

    test("a cycle cannot hang the reader", () => {
        // No honest mint makes one; a reader that trusts that hangs the frame.
        const a = snap("a", { t: 1, prev: "self" })
        const versions = [a]
        const { parent } = linesOf(versions)
        parent.set(name(a), name(a))
        assert.equal(lineOf(versions, name(a)).length, 1)
    })
})

describe("the meet: derived at the reader, never stored", () => {
    test("the latest keep two lines share", () => {
        const a = snap("a", { t: 1, prev: null })
        const b = snap("b", { t: 2, prev: name(a) })
        const c = snap("c", { t: 3, prev: name(b) })
        const d = snap("d", { t: 4, prev: name(b) })
        const versions = [d, c, b, a]

        const meet = meetOf(lineOf(versions, name(c)), lineOf(versions, name(d)))
        assert.equal(meet, name(b), "the fork point, not the oldest ancestor")
    })

    test("lines that never met have no meet", () => {
        const a = snap("a", { t: 1, prev: null })
        const z = snap("z", { t: 2, prev: null })
        assert.equal(meetOf([a], [z]), null)
    })
})

describe("mirrorOf: this line, and the nearest sibling by meet", () => {
    test("one line — no water at all", () => {
        const a = snap("a", { t: 1 })
        const b = snap("b", { t: 2 })
        const m = mirrorOf([b, a])
        assert.equal(m.head, name(b))
        assert.deepEqual(m.line, [b, a])
        assert.deepEqual(m.sibling, [])
        assert.equal(m.meet, null)
    })

    test("the nearest sibling is the one that walked with us longest", () => {
        // trunk a─b─c ; near forks at c ; far forks at a
        const a = snap("a", { t: 1, prev: null })
        const b = snap("b", { t: 2, prev: name(a) })
        const c = snap("c", { t: 3, prev: name(b) })
        const mine = snap("mine", { t: 4, prev: name(c) })
        const near = snap("near", { t: 5, prev: name(c) })
        const far = snap("far", { t: 6, prev: name(a) })
        const versions = [far, near, mine, c, b, a]

        const m = mirrorOf(versions, name(mine))
        assert.equal(m.siblingHead, name(near), "one mirror at a time — the nearest")
        assert.equal(m.meet, name(c))
    })

    test("the head is the shell's choice; a swap is only this field moving", () => {
        const a = snap("a", { t: 1, prev: null })
        const mine = snap("mine", { t: 2, prev: name(a) })
        const theirs = snap("theirs", { t: 3, prev: name(a) })
        const versions = [theirs, mine, a]

        const before = mirrorOf(versions, name(mine))
        const after = mirrorOf(versions, before.siblingHead)
        assert.equal(after.head, name(theirs))
        assert.equal(after.siblingHead, name(mine), "the two trade places")
        assert.equal(after.meet, before.meet, "the meet is the same keep either way")
    })

    test("an empty fold yields an empty mirror, not a throw", () => {
        assert.deepEqual(mirrorOf([]), {
            head: null,
            line: [],
            sibling: [],
            siblingHead: null,
            meet: null,
        })
    })
})

describe("columnsOf: the geometry the swap rides (id:kr-mirror)", () => {
    test("one line — oldest first, west to east, no water", () => {
        const a = snap("a", { t: 1 })
        const b = snap("b", { t: 2 })
        const cols = columnsOf([b, a], [], null)
        assert.deepEqual(cols.map((c) => c.sky), [a, b])
        assert.deepEqual(cols.map((c) => c.water), [null, null])
        assert.equal(cols.some((c) => c.meet), false)
    })

    test("beneath the trunk the water is the sky exactly; past the meet it is not", () => {
        const a = snap("a", { t: 1, prev: null })
        const b = snap("b", { t: 2, prev: name(a) })
        const mine = snap("mine", { t: 3, prev: name(b) })
        const theirs = snap("theirs", { t: 4, prev: name(b) })
        const versions = [theirs, mine, b, a]
        const m = mirrorOf(versions, name(mine))
        const cols = columnsOf(m.line, m.sibling, m.meet)

        assert.deepEqual(cols.map((c) => c.sky), [a, b, mine])
        assert.deepEqual(cols.map((c) => c.water), [a, b, theirs])
        assert.deepEqual(cols.map((c) => c.trunk), [true, true, false])
        // Exactly one ripple, and it marks where two lines become two.
        assert.deepEqual(cols.map((c) => c.meet), [false, true, false])
    })

    test("THE TRUNK HOLDS STILL — a swap re-keys nothing it shares", () => {
        // The whole mechanism: trunk keys are keep ids, divergent keys are
        // positions. Trading the lines therefore leaves the trunk's DOM alone.
        const a = snap("a", { t: 1, prev: null })
        const b = snap("b", { t: 2, prev: name(a) })
        const mine = snap("mine", { t: 3, prev: name(b) })
        const theirs = snap("theirs", { t: 4, prev: name(b) })
        const versions = [theirs, mine, b, a]

        const before = mirrorOf(versions, name(mine))
        const after = mirrorOf(versions, before.siblingHead)
        const keysBefore = columnsOf(before.line, before.sibling, before.meet).map((c) => c.key)
        const keysAfter = columnsOf(after.line, after.sibling, after.meet).map((c) => c.key)

        assert.deepEqual(keysBefore, keysAfter, "every column keeps its key")
        assert.deepEqual(keysBefore.slice(0, 2), [name(a), name(b)], "trunk keyed by keep")
        assert.equal(keysBefore[2], "div:0", "the future keyed by distance past the meet")

        // And the contents did trade.
        const skyBefore = columnsOf(before.line, before.sibling, before.meet).at(-1)
        const skyAfter = columnsOf(after.line, after.sibling, after.meet).at(-1)
        assert.equal(skyBefore.sky, mine)
        assert.equal(skyAfter.sky, theirs)
        assert.equal(skyAfter.water, mine)
    })

    test("a sibling that went further leaves an empty slot in the sky", () => {
        const a = snap("a", { t: 1, prev: null })
        const mine = snap("mine", { t: 2, prev: name(a) })
        const t1 = snap("t1", { t: 3, prev: name(a) })
        const t2 = snap("t2", { t: 4, prev: name(t1) })
        const versions = [t2, t1, mine, a]
        const m = mirrorOf(versions, name(mine))
        const cols = columnsOf(m.line, m.sibling, m.meet)

        assert.equal(cols.length, 3)
        assert.deepEqual(cols.map((c) => c.sky), [a, mine, null])
        assert.deepEqual(cols.map((c) => c.water), [a, t1, t2])
    })
})

describe("structural greps: the fold never writes (id:kc-p-fold)", () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, "../../../assets/js/keep/work.js"), "utf8")

    test("no storage, no verb, no cached lane index", () => {
        assert.equal(/\bindexedDB\b/.test(src), false)
        assert.equal(/journal\.store/.test(src), false)
        assert.equal(/\bawait\b/.test(src), false, "a fold is synchronous")
        for (const word of ["listByTarget", "cache", "count", "syncing", "pending"]) {
            assert.equal(
                new RegExp(`\\b${word}\\b`).test(src),
                false,
                `work.js must not name ${word}`,
            )
        }
    })
})
