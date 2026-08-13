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
    namesOf,
    newerKeep,
    ofWork,
} from "../../../assets/js/keep/work.js"
import { name, write } from "../../../assets/js/keep/entry.js"
import { PAGE, REACH } from "../../../assets/js/keep/page.js"

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

// ONE DEPTH PER FOLD, NOT ONE DEPTH IN THE SYSTEM (id:ka-reach).
//
// The river filters a page of the WHOLE log down to one work, so at the wire's
// depth it goes blind: measured on 41 real keeps across 12 works, PAGE=12
// showed *nothing* for two works that certainly had keeps (id:ka-ground 4).
// ka-reach ruled the split and it did not land for a day — so this is the
// fence that would have caught that, in the form the wound actually took.
describe("REACH: the river reads past the author's other rivers (id:ka-reach)", () => {
    // The shape the wound actually has on real data: works are not visited
    // round-robin. One river is busy and recent; older ones sit behind it. A
    // round-robin generator puts every work inside the newest PAGE and proves
    // nothing — the first cut of this test did exactly that and passed the
    // wrong way.
    const OLD = "0".padStart(64, "0")
    const busyLogWithAnOldRiver = (oldKeeps, busyKeeps) => {
        const all = []
        let t = 0
        for (let i = 0; i < oldKeeps; i++) all.push(snap(`old${i}`, { work: OLD, t: ++t }))
        for (let i = 0; i < busyKeeps; i++) {
            all.push(snap(`busy${i}`, { work: `${1 + (i % 5)}`.padStart(64, "0"), t: ++t }))
        }
        return all.reverse() // newest-first, as list() hands it over
    }

    test("at the wire's depth an old work is wholly invisible; at REACH it is whole", () => {
        const log = busyLogWithAnOldRiver(3, PAGE + 8)

        assert.equal(
            ofWork(log.slice(0, PAGE), OLD).length,
            0,
            "the wound: at PAGE the river shows an empty history for a work that has keeps",
        )
        assert.equal(ofWork(log.slice(0, REACH), OLD).length, 3, "at REACH the work is whole")
    })

    test("REACH clears W x n for a classroom's W", () => {
        assert.ok(REACH > PAGE, "the river reads deeper than the wire drains")
        assert.ok(REACH >= 12 * PAGE, `REACH must clear W x n; got ${REACH}`)
    })

    test("[structural] the river folds at REACH, the wire drains at PAGE", () => {
        const read = (p) =>
            readFileSync(join(dirname(fileURLToPath(import.meta.url)), p), "utf8")
                .replace(/\/\*[\s\S]*?\*\//g, "")
                .replace(/^\s*\/\/.*$/gm, "")

        const river = read("../../../assets/js/hooks/shell/river.js")
        const wire = read("../../../assets/js/keep/wire.js")
        const link = read("../../../assets/js/link.js")

        // Same depth on BOTH sides of the fold — that is kb-8-page's proof.
        assert.ok(/list\([^)]*REACH\)/.test(river), "river lists at REACH")
        assert.ok(/local\([^)]*REACH\)/.test(river), "river folds local at REACH")
        assert.ok(!/\bPAGE\b/.test(river), "the river must not drain-depth its fold")

        assert.ok(/\bPAGE\b/.test(wire), "the wire still drains a human handful")
        assert.ok(!/\bREACH\b/.test(wire), "the wire must not ship a river's depth")

        // The fork word resolves against the local journal at the same depth,
        // or an older work's own link round-trips for bytes already held.
        assert.ok(/list\([^)]*REACH\)/.test(link), "the fork word reads at REACH")
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
        // Ids ride out so columnsOf need not re-hash (id:ka-passes).
        assert.deepEqual(mirrorOf([]), {
            head: null,
            line: [],
            lineIds: [],
            sibling: [],
            siblingIds: [],
            siblingHead: null,
            meet: null,
        })
    })

    test("lineIds are the line's names, in the line's order", () => {
        const a = snap("a", { t: 1 })
        const b = snap("b", { t: 2 })
        const m = mirrorOf([b, a])
        assert.deepEqual(m.lineIds, m.line.map(name), "ids parallel the bytes")
    })
})

// Pin the collapse: precomputed ids change nothing, and hashing actually stops (id:ka-passes).
// Counted, never timed — a timing test passes on a fast machine (id:kb-5).
describe("the page is named once (id:ka-passes)", () => {
    const page = () => [snap("c", { t: 3 }), snap("b", { t: 2 }), snap("a", { t: 1 })]

    test("namesOf is the page's ids, parallel and in order", () => {
        const v = page()
        assert.deepEqual(namesOf(v), v.map(name))
    })

    test("precomputed ids change nothing — linesOf, lineOf, mirrorOf", () => {
        const v = page()
        const ids = namesOf(v)
        assert.deepEqual(linesOf(v, ids), linesOf(v))
        assert.deepEqual(mirrorOf(v, undefined, ids), mirrorOf(v))
        assert.deepEqual(lineOf(v, ids[0], ids), lineOf(v, ids[0]))
    })

    test("precomputed keys change nothing — columnsOf, one line and two", () => {
        const v = page()
        const m = mirrorOf(v)
        assert.deepEqual(
            columnsOf(m.line, m.sibling, m.meet, { line: m.lineIds, sibling: m.siblingIds }),
            columnsOf(m.line, m.sibling, m.meet),
            "one line",
        )
        const forked = snap("d", { t: 4, prev: name(v[2]) })
        const f = mirrorOf([forked, ...v])
        assert.deepEqual(
            columnsOf(f.line, f.sibling, f.meet, { line: f.lineIds, sibling: f.siblingIds }),
            columnsOf(f.line, f.sibling, f.meet),
            "two lines and a meet",
        )
    })

    test("[structural] the river's fold names the page in exactly one place", () => {
        // ESM namespaces are read-only; work.js closes over `name`. Fence is structural (id:kb-vet4).
        const src = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), "../../../assets/js/river/fold.js"),
            "utf8",
        ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

        const names = src.match(/namesOf\(/g) ?? []
        assert.equal(names.length, 1, "the page is named ONCE in the river fold")

        // held is a different page — one `.map(name)` (id:kb-8-page).
        const maps = src.match(/(\w+)\.map\(name\)/g) ?? []
        assert.deepEqual(maps, ["held.map(name)"], "only the held page is named separately")
        assert.ok(
            /mirrorOf\([^)]*ids\)/.test(src) && /columnsOf\([^)]*lineIds/.test(src),
            "the ids are threaded into both work folds, not re-derived",
        )
    })

    test("kc-law 3 is unmoved: every id the fold hands back names its bytes", async () => {
        const { fold } = await import("../../../assets/js/river/fold.js")
        const v = page()
        const out = fold(v, [v[0]])

        assert.equal(out.newestId, name(v[0]), "newest is the page's first name")
        for (const id of out.keptLocal) {
            assert.ok(v.some((b) => name(b) === id), "a kept id names a keep on the page")
        }
        for (const c of out.columns) {
            if (c.sky) assert.equal(c.key, name(c.sky), "a column's key IS its keep's name")
        }
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
        // Trunk keys are keep ids; divergent keys are positions. A swap leaves the trunk's DOM alone.
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
