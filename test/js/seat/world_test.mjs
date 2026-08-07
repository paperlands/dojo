// THE SEATING WORLD — properties over one value.
//   node --test test/js/seat/world_test.mjs
//
// page_test.mjs and light_test.mjs drive the LAW: they walk a live pageLaw and
// assert on answers. This file drives the WORLD: `step` is a function from a
// value to a value — invariants that once needed a walked sequence to observe
// are assertions about one thing you can hold.
//
// The pin on ll-audit-purity: four closure containers became one world; the
// readers (lightOf, presenceOf, record lookup) are pure functions over it.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import {
    openWorld, step, lightOf, presenceOf, slotsOf, recordFor, attentionAt, witnessesOn,
    pageLaw, nodeOf, placeOf,
    SELF, PEER, CORESHELL, OUTERSHELL,
} from "../../../assets/js/weave/page.js"
import { parseProgram, phaseCells } from "../../../assets/js/turtling/parse.js"

// ── fixtures ──────────────────────────────────────────────────────────────

const PAGE_SRC = `###
a meadow of prose

\`\`\`
fw 10
\`\`\`

* chapter

\`\`\`
rt 90
\`\`\`

\`\`\`
fw 5
\`\`\`
###`

const PLAIN_SRC = `fw 3
rt 90`

const PROGRAM_SRC = `fw 1
${PAGE_SRC}`

const lineOfCell = (src, n) => phaseCells(parseProgram(src))[n].open

const seat = (world, addr, doc, opts = {}) => step(world, {
    kind: "observe", addr, name: opts.name ?? addr, doc,
    witness: opts.witness ?? SELF, place: opts.place ?? CORESHELL,
    attention: opts.attention ?? null,
})

// Every document shape, so a property quantifies rather than illustrates.
const SHAPES = [
    ["plain", PLAIN_SRC],
    ["page", PAGE_SRC],
    ["program", PROGRAM_SRC],
]

describe("the world is one value", () => {
    test("a fresh world is empty, and names whose law it is", () => {
        const w = openWorld()
        assert.equal(w.self, SELF)
        assert.equal(w.records.size, 0)
        assert.equal(w.ladders.size, 0)
        assert.deepEqual(w.places, [])
        assert.equal(attentionAt(w), null)
    })

    test("three indices and nothing else — who, where, what", () => {
        assert.deepEqual(Object.keys(openWorld()).sort(),
            ["ladders", "places", "records", "self"])
    })

    test("a foreign self is the world's, not a parameter every reader repeats", () => {
        const w = openWorld({ self: "ada" })
        const { world } = seat(w, "@a", PLAIN_SRC, { witness: "ada" })
        assert.equal(presenceOf(world).length, 0, "her own record is never presence")
        const { world: theirs } = seat(world, "@b", PLAIN_SRC, { witness: PEER })
        assert.equal(presenceOf(theirs).length, 1)
    })
})

describe("step does not touch the world it was handed", () => {
    for (const [shape, src] of SHAPES) {
        test(`${shape}: the prior world is intact after a seating`, () => {
            const before = openWorld()
            const { world: after } = seat(before, "@a", src)

            assert.equal(before.records.size, 0, "records untouched")
            assert.equal(before.ladders.size, 0, "ladders untouched")
            assert.deepEqual(before.places, [], "the place ladder untouched")
            assert.notEqual(after, before, "and the answer is a NEW world")
            assert.ok(after.records.size > 0)
        })
    }

    test("a walk keeps every world it passed through", () => {
        const w0 = openWorld()
        const w1 = seat(w0, "@a", PAGE_SRC).world
        const w2 = seat(w1, "@a", PAGE_SRC, { attention: { line: lineOfCell(PAGE_SRC, 2) } }).world
        const w3 = step(w2, { kind: "forget", addr: "@a" }).world

        assert.equal(w0.records.size, 0)
        assert.equal(w1.records.size, 1)
        assert.equal(w2.records.size, 1)
        assert.equal(w3.records.size, 0)
        // The light at each is still readable — the whole point of a value.
        assert.equal(lightOf(w0, CORESHELL).kindled, null)
        assert.ok(lightOf(w1, CORESHELL).kindled)
        assert.equal(lightOf(w3, CORESHELL).kindled, null)
    })

    test("asking a ladder that was never visited does not seat one", () => {
        const w = openWorld()
        const law = pageLaw()
        assert.deepEqual(law.orderOf(OUTERSHELL), [])
        assert.equal(w.ladders.size, 0, "a read is not a write")
    })
})

describe("the light partitions the standing slots", () => {
    // THE PROPERTY, over one value: every slot any record has seated is either
    // kindled or warm — never neither, because the surface writes opacity for
    // exactly those two and a slot in neither keeps whatever it last had.
    const partitions = (world, where) => {
        const { kindled, warm } = lightOf(world, attentionAt(world))
        const named = new Set(warm)
        if (kindled) named.add(kindled)
        const standing = new Set([
            ...slotsOf(world, CORESHELL),
            ...slotsOf(world, OUTERSHELL),
        ])
        for (const slot of standing) {
            assert.ok(named.has(slot), `${where}: ${slot} stands but is neither kindled nor warm`)
        }
        assert.equal(named.size, standing.size, `${where}: light names a slot nothing seated`)
    }

    for (const [shape, src] of SHAPES) {
        test(`${shape}: partitioned at birth, and after a reach into every cell`, () => {
            let world = seat(openWorld(), "@a", src).world
            partitions(world, `${shape} at birth`)

            const cells = phaseCells(parseProgram(src))
            for (let i = 0; i < cells.length; i++) {
                world = seat(world, "@a", src, { attention: { line: cells[i].open } }).world
                partitions(world, `${shape} cell ${i}`)
            }
            // And out of every cell, onto prose.
            world = seat(world, "@a", src, { attention: { line: 1 } }).world
            partitions(world, `${shape} on prose`)
        })
    }

    test("two places, two witnesses: still a partition", () => {
        let world = seat(openWorld(), "@mine", PROGRAM_SRC).world
        world = seat(world, "@theirs", PAGE_SRC, { witness: PEER, place: OUTERSHELL }).world
        partitions(world, "two places")
        assert.ok(slotsOf(world, CORESHELL).length)
        assert.ok(slotsOf(world, OUTERSHELL).length)
    })
})

describe("the place ladder demotes", () => {
    // It was a scalar — a ladder that kept a head and no tail, so it could
    // promote and never let go. Emptying a place must hand the light back.
    test("emptying the looked-at place demotes it", () => {
        let world = seat(openWorld(), "@mine", PAGE_SRC).world
        world = seat(world, "@theirs", PAGE_SRC,
                     { witness: SELF, place: OUTERSHELL }).world
        assert.equal(attentionAt(world), OUTERSHELL, "the last self seating owns the look")

        world = step(world, { kind: "restore", addr: "@theirs", place: OUTERSHELL }).world
        assert.equal(attentionAt(world), CORESHELL,
            "with nothing standing there, the light falls back to where something is")
        assert.ok(!world.places.includes(OUTERSHELL))
    })

    test("a place still holding a record is never demoted", () => {
        let world = seat(openWorld(), "@a", PAGE_SRC, { place: OUTERSHELL }).world
        world = seat(world, "@b", PAGE_SRC, { witness: PEER, place: OUTERSHELL }).world
        world = step(world, { kind: "restore", addr: "@a", place: OUTERSHELL }).world
        assert.equal(attentionAt(world), OUTERSHELL, "their record still stands there")
    })

    test("forgetting the last record empties the ladder entirely", () => {
        let world = seat(openWorld(), "@a", PLAIN_SRC).world
        assert.deepEqual(world.places, [CORESHELL])
        world = step(world, { kind: "forget", addr: "@a" }).world
        assert.deepEqual(world.places, [], "nowhere left to look")
        assert.equal(lightOf(world, attentionAt(world)).kindled, null)
    })
})

describe("presence is every other witness's head", () => {
    test("self is never her own presence; a peer always is", () => {
        let world = seat(openWorld(), "@a", PAGE_SRC).world
        assert.deepEqual(presenceOf(world), [])

        world = seat(world, "@b", PAGE_SRC, { witness: PEER, place: OUTERSHELL }).world
        const seen = presenceOf(world)
        assert.equal(seen.length, 1)
        assert.equal(seen[0].witness, PEER)
        assert.equal(seen[0].addr, "@b")
        assert.equal(placeOf(seen[0].slot), OUTERSHELL)
    })

    test("a shadowed record is exactly what presence is for", () => {
        // Her draft stands over their page at the same slot: theirs does not
        // paint, and that is when saying "they are here" matters most.
        let world = seat(openWorld(), "@a", PAGE_SRC, { witness: PEER, place: OUTERSHELL }).world
        world = seat(world, "@a", PLAIN_SRC, { witness: SELF, place: OUTERSHELL }).world

        assert.equal(recordFor(world, "@a", OUTERSHELL).witness, SELF,
            "hers is the one a surface means")
        assert.equal(recordFor(world, "@a", OUTERSHELL, PEER).witness, PEER,
            "theirs is still held, asked by name")
        assert.equal(presenceOf(world).length, 1, "and still spoken")
    })
})

describe("the law asks who is here — it does not enumerate", () => {
    // `PEER` is one value for every friend, and that is honest only while the
    // ADDR names which friend (verified: the wire mints addr from the disciple
    // key). What was NOT honest is a law that walked `[self, PEER]` by hand — an
    // identity written as the set of its values, which is `own: boolean` one
    // level down. A third witness must be as forgettable as the second.
    const THIRD = "peer:bo"

    test("forget drops every witness on the addr, not the two it knows", () => {
        let world = seat(openWorld(), "@a", PAGE_SRC, { witness: SELF, place: OUTERSHELL }).world
        world = seat(world, "@a", PAGE_SRC, { witness: PEER, place: OUTERSHELL }).world
        world = seat(world, "@a", PAGE_SRC, { witness: THIRD, place: OUTERSHELL }).world
        assert.equal(world.records.size, 3, "three witnesses hold one document")

        world = step(world, { kind: "forget", addr: "@a" }).world
        assert.equal(world.records.size, 0, "a third witness is not left held")
        assert.equal(recordFor(world, "@a", OUTERSHELL, THIRD), null)
    })

    test("witnessesOn answers self first, then the rest", () => {
        let world = seat(openWorld(), "@a", PAGE_SRC, { witness: THIRD, place: OUTERSHELL }).world
        world = seat(world, "@a", PAGE_SRC, { witness: PEER, place: OUTERSHELL }).world
        world = seat(world, "@a", PAGE_SRC, { witness: SELF, place: OUTERSHELL }).world
        assert.equal(witnessesOn(world, "@a", OUTERSHELL)[0], SELF)
        assert.equal(witnessesOn(world, "@a", OUTERSHELL).length, 3)
    })

    test("presence names every witness that is not self", () => {
        let world = seat(openWorld(), "@a", PAGE_SRC, { witness: PEER, place: OUTERSHELL }).world
        world = seat(world, "@b", PAGE_SRC, { witness: THIRD, place: OUTERSHELL }).world
        const seen = presenceOf(world).map((p) => p.witness).sort()
        assert.deepEqual(seen, [PEER, THIRD].sort())
    })
})

describe("the shell is thin", () => {
    test("pageLaw and step answer the same thing from the same start", () => {
        const law = pageLaw()
        const direct = seat(openWorld(), "@a", PAGE_SRC)
        const shelled = law.observe("@a", { name: "@a", doc: PAGE_SRC, witness: SELF })

        assert.deepEqual(shelled.gone, direct.answer.gone)
        assert.deepEqual(shelled.runs.map((r) => r.slot), direct.answer.runs.map((r) => r.slot))
        assert.deepEqual(shelled.light, direct.answer.light)
        assert.equal(shelled.hatch, direct.answer.hatch)
    })

    test("the shell's world() IS the law's world", () => {
        const law = pageLaw()
        assert.equal(law.world().records.size, 0)
        law.observe("@a", { name: "@a", doc: PLAIN_SRC, witness: SELF })
        assert.equal(law.world().records.size, 1)
        assert.equal(nodeOf(slotsOf(law.world(), CORESHELL)[0]), "@a")
    })

    test("an unknown event is a fault, never a default", () => {
        assert.throws(() => step(openWorld(), { kind: "kindle" }), /unknown event "kindle"/)
        assert.throws(() => step(openWorld(), {}), /unknown event/)
    })
})
