// Paint — morph in place, never flash-replace (id:kr-helios), and the one
// property the swap rests on: THE TRUNK HOLDS STILL (id:kr-mirror).
import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { installDom, makeEl } from "./dom-shim.mjs"
import { name, write } from "../../../assets/js/keep/entry.js"

const ROOT = "r".repeat(64)
const WORK = "w".repeat(64)

let uninstall
let paint
let columnsOf
let mirrorOf

beforeEach(async () => {
    uninstall = installDom()
    // atoms.js reaches for document at call time, but importing under a live
    // global keeps the shim honest about what the module actually touches.
    ;({ paint } = await import("../../../assets/js/river/paint.js"))
    ;({ columnsOf, mirrorOf } = await import("../../../assets/js/keep/work.js"))
})

afterEach(() => uninstall())

function snap(tag, { t = 1, prev } = {}) {
    const body = { source_id: name(tag), diagnostics: [], buffer_id: null }
    if (prev !== undefined) body.prev = prev
    return write("snap", body, { root: ROOT, target: WORK, ts: { t, n: 0 } })
}


const allShared = () => false
const noFace = () => null

function sky(col) {
    return col.querySelector('[data-place="sky"]')
}

describe("paint: the rail receives, it never wipes", () => {
    test("a new keep arrives; the standing seats are the SAME elements", () => {
        const rail = makeEl()
        const a = snap("a", { t: 1 })
        const b = snap("b", { t: 2 })

        paint(rail, columnsOf([b, a], [], null), { kept: allShared, faceOf: noFace })
        const before = [...rail.children]
        assert.equal(before.length, 2)

        const c = snap("c", { t: 3 })
        const { arrived } = paint(rail, columnsOf([c, b, a], [], null), { kept: allShared, faceOf: noFace })

        assert.equal(rail.children.length, 3)
        assert.equal(rail.children[0], before[0], "the oldest seat was never rebuilt")
        assert.equal(rail.children[1], before[1])
        assert.deepEqual(arrived, [name(c)], "only the new keep arrives")
    })

    test("two words only — kept local breathes, shared rests", () => {
        const rail = makeEl()
        const a = snap("a", { t: 1 })
        const b = snap("b", { t: 2 })
        const mine = new Set([name(b)])

        paint(rail, columnsOf([b, a], [], null), { kept: (id) => mine.has(id), faceOf: noFace })

        const rings = rail.children.map((c) => sky(c).querySelector(".river-ring"))
        assert.equal(rings[0].classList.contains("river-ring-settled"), true)
        assert.equal(rings[1].classList.contains("river-ring-open"), true)
        assert.equal(rings[1].classList.contains("river-ring-settled"), false)

        // The room answers: the ring settles, in place, on the same element.
        mine.clear()
        paint(rail, columnsOf([b, a], [], null), { kept: allShared, faceOf: noFace })
        assert.equal(rings[1].classList.contains("river-ring-settled"), true)
        assert.equal(rings[1].classList.contains("river-ring-open"), false)
    })

    test("anything that is not a column is swept — the rail holds columns only", () => {
        const rail = makeEl()
        const stray = makeEl()
        stray.className = "river-stray"
        rail.appendChild(stray)

        paint(rail, columnsOf([snap("a")], [], null), { kept: allShared, faceOf: noFace })
        assert.equal(rail.children.length, 1)
        assert.equal(rail.children[0].dataset.key != null, true)
    })

    test("a seat wears a face and a ring — the face clears under a swap", () => {
        const rail = makeEl()
        const a = snap("a", { t: 1 })
        const pics = new Map([[name(a), "blob:one"]])

        paint(rail, columnsOf([a], [], null), {
            kept: allShared,
            faceOf: (id) => pics.get(id) ?? null,
        })
        const seat = sky(rail.children[0])
        assert.ok(seat.querySelector(".river-ring"), "the ring is always there")
        assert.equal(seat.querySelector(".river-face").style.backgroundImage, "url(blob:one)")
        assert.equal(seat.classList.contains("has-face"), true)

        pics.clear()
        paint(rail, columnsOf([a], [], null), { kept: allShared, faceOf: noFace })
        assert.equal(seat.querySelector(".river-face").style.backgroundImage, "")
        assert.equal(seat.classList.contains("has-face"), false)
    })

    test("the east is always open — the present stands even on an empty river", () => {
        const rail = makeEl()
        const openEast = {
            key: "present",
            sky: null,
            water: null,
            trunk: false,
            meet: false,
            present: true,
        }

        paint(rail, [openEast], { kept: allShared, faceOf: noFace })
        assert.equal(rail.children.length, 1)
        const seat = sky(rail.children[0])
        assert.equal(seat.dataset.kind, "present")
        assert.ok(seat.querySelector(".river-open"), "a place, not an absence")
        assert.equal(seat.querySelector(".river-ring"), null, "it has no word yet")

        // A keep lands west of it; the open east keeps its element and its place.
        const standing = rail.children[0]
        paint(rail, [...columnsOf([snap("a")], [], null), openEast], { kept: allShared, faceOf: noFace })
        assert.equal(rail.children.length, 2)
        assert.equal(rail.children[1], standing, "the present was never rebuilt")
        assert.equal(sky(rail.children[0]).dataset.kind, "seat")
    })

    test("draft sits past the present — face, no keep ring, not in the journal", () => {
        const rail = makeEl()
        const openEast = {
            key: "present",
            sky: null,
            water: null,
            trunk: false,
            meet: false,
            present: true,
        }
        const draftCol = {
            key: "draft",
            sky: null,
            water: null,
            trunk: false,
            meet: false,
            draft: true,
            face: "blob:last",
        }

        paint(rail, [...columnsOf([snap("a")], [], null), openEast, draftCol], {
            kept: allShared,
            faceOf: noFace,
        })
        assert.equal(rail.children.length, 3)
        assert.equal(rail.children[0].dataset.key, name(snap("a")))
        assert.equal(rail.children[1].dataset.key, "present")
        assert.equal(rail.children[2].dataset.key, "draft")

        const d = sky(rail.children[2])
        assert.equal(d.dataset.kind, "draft")
        assert.ok(d.querySelector(".river-face"), "the figure seat")
        assert.equal(d.querySelector(".river-ring"), null, "no open/settled word")
        assert.equal(d.querySelector(".river-face").style.backgroundImage, "url(blob:last)")
        assert.equal(d.classList.contains("has-face"), true)

        // Drop the draft; present holds its element.
        const presentEl = rail.children[1]
        paint(rail, [...columnsOf([snap("a")], [], null), openEast], {
            kept: allShared,
            faceOf: noFace,
        })
        assert.equal(rail.children.length, 2)
        assert.equal(rail.children[1], presentEl, "present never rebuilt")
    })
})

describe("the mirror and the swap (id:kr-mirror)", () => {
    // trunk a─b ; then two futures.
    const a = snap("a", { t: 1, prev: null })
    const b = snap("b", { t: 2, prev: name(a) })
    const mine = snap("mine", { t: 3, prev: name(b) })
    const theirs = snap("theirs", { t: 4, prev: name(b) })
    const versions = [theirs, mine, b, a]

    function render(rail, head) {
        const m = mirrorOf(versions, head)
        paint(rail, columnsOf(m.line, m.sibling, m.meet), { kept: allShared, faceOf: noFace })
        return m
    }

    test("beneath the trunk the water is the sky exactly; the meet ripples once", () => {
        const rail = makeEl()
        render(rail, name(mine))

        const waters = rail.children.map((c) => c.querySelector('[data-place="water"]'))
        assert.equal(waters[0].dataset.id, sky(rail.children[0]).dataset.id)
        assert.equal(waters[1].dataset.id, sky(rail.children[1]).dataset.id)
        assert.notEqual(waters[2].dataset.id, sky(rail.children[2]).dataset.id)

        // Out of focus past the meet — light, not a third word.
        assert.equal(waters[1].classList.contains("foggy"), false)
        assert.equal(waters[2].classList.contains("foggy"), true)

        const ripples = rail.children.map((c) => c.querySelector(".river-ripple")).filter(Boolean)
        assert.equal(ripples.length, 1, "the only mark provenance ever gets")
        assert.equal(rail.children[1].querySelector(".river-ripple") != null, true)
    })

    test("SWAP: the futures trade places and the trunk's elements never move", () => {
        const rail = makeEl()
        const first = render(rail, name(mine))
        const trunk = [rail.children[0], rail.children[1]]
        const trunkSeats = trunk.map(sky)
        const future = rail.children[2]
        const futureSeat = sky(future)

        assert.equal(sky(future).dataset.id, name(mine))

        // Touch the water: the shell's head becomes the sibling's.
        render(rail, first.siblingHead)

        assert.equal(rail.children[0], trunk[0], "the common past is common")
        assert.equal(rail.children[1], trunk[1])
        assert.deepEqual(rail.children.map(sky), [...trunkSeats, futureSeat])
        assert.deepEqual(
            trunkSeats.map((s) => s.dataset.id),
            [name(a), name(b)],
            "the trunk still shows the same keeps",
        )

        // Only the future changed, and it changed IN PLACE.
        assert.equal(futureSeat.dataset.id, name(theirs))
        assert.equal(future.querySelector('[data-place="water"]').dataset.id, name(mine))
    })

    test("a sibling that went further leaves a slot, not a seat", () => {
        const t1 = snap("t1", { t: 3, prev: name(b) })
        const t2 = snap("t2", { t: 4, prev: name(t1) })
        const only = snap("only", { t: 5, prev: name(b) })
        const fold = [only, t2, t1, b, a]

        const rail = makeEl()
        const m = mirrorOf(fold, name(only))
        paint(rail, columnsOf(m.line, m.sibling, m.meet), { kept: allShared, faceOf: noFace })

        const last = rail.children.at(-1)
        assert.equal(sky(last).dataset.kind, "slot", "our line reached no further")
        assert.equal(sky(last).dataset.id, undefined)
        assert.equal(last.querySelector('[data-place="water"]').dataset.id, name(t2))
    })

    test("the water folds away when the river is one line again", () => {
        const rail = makeEl()
        render(rail, name(mine))
        assert.equal(rail.children[0].querySelector('[data-place="water"]') != null, true)

        // A fold with no sibling: every column is sky alone.
        paint(rail, columnsOf([b, a], [], null), { kept: allShared, faceOf: noFace })
        for (const col of rail.children) {
            assert.equal(col.querySelector('[data-place="water"]').dataset.kind, "slot")
            assert.equal(col.querySelector(".river-ripple"), null)
        }
    })
})
