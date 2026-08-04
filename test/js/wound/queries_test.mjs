// The diagnostics query's memo law (weave/queries.js, id:cmp-memo-grain).
// Run with:
//   node --test test/js/wound/queries_test.mjs
//
// What this pins: memoization at the REUSE-UNIT grain, where green-tree
// adoption preserves identity — the memo-hit proof is object identity of
// answers (an untouched unit answers the ===-same array across an edit; a
// fresh unit answers a new one); walk ailments are never memoized (a live
// read cannot go stale) and join the answer span-true; and ailmentsFor
// filters the one error scan to a buffer by its address top segment — the
// plain tab itself or its page cells, never a sibling tab's line 7.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { parseProgram, reparseProgram } from "../../../assets/js/turtling/parse.js"
import { nodeDiagnostics, diagnostics, ailmentsFor, verdict, primaryWound, announcements, standingAilments, fingerprint, severityOf, KINDS, everyWound } from "../../../assets/js/weave/queries.js"
import { describe as sayOf, sayWound } from "../../../assets/js/weave/wound-view.js"

describe("the memo law — identity at the reuse grain", () => {
    test("asking twice answers the ===-same array (the memo-hit proof)", () => {
        const [unit] = parseProgram("for do")
        assert.equal(unit.type, "Error")
        const first = nodeDiagnostics(unit)
        assert.equal(nodeDiagnostics(unit), first, "literally the same object")
        assert.equal(first.length, 1)
    })

    test("an edit to unit k leaves units ≠ k answering their old arrays", () => {
        const before = "fw 10\nfor do\nrt 90"
        const prev = parseProgram(before)
        const answers = prev.map(nodeDiagnostics)

        const after = "fw 10\nfor do\nrt 45"
        const next = reparseProgram(after, before, prev)

        assert.equal(next[0], prev[0], "adoption carried the clean unit")
        assert.equal(next[1], prev[1], "adoption carried the broken unit")
        assert.equal(nodeDiagnostics(next[0]), answers[0])
        assert.equal(nodeDiagnostics(next[1]), answers[1])
        assert.notEqual(next[2], prev[2], "the edited unit is fresh")
        assert.notEqual(nodeDiagnostics(next[2]), answers[2],
            "a fresh unit computes anew — a missed reuse costs recompute, never a wrong answer")
    })

    test("the whole answer concatenates unit truths with live ailments, unmemoized", () => {
        const ast = parseProgram("fw 10\nfor do")
        const ailment = {
            message: "Undefined property: x",
            span: { line: 1, endLine: 1 },
            kind: "walk",
            name: "coil",
        }
        const answer = diagnostics(ast, [ailment])
        assert.equal(answer.length, 2)
        assert.equal(answer[0].kind, "parse")
        assert.deepEqual(answer[1], {
            message: "Undefined property: x",
            span: { line: 1, endLine: 1 },
            kind: "walk",
            source: "coil",
            // A diagnostic is ADDRESSED: an ailment without an address of its own
            // falls back to the buffer's key (null when unasked). This is what
            // lets a surface break at the CELL that died, not across the page.
            address: null,
            // …and LOCATED: the answer is whole, so no surface has to derive
            // where a diagnostic lives. Bare code has no outline and no cells, so
            // the phase is empty and the slot is null — the honest answer.
            phase: [],
            cell: null,
            // Her word for this place, when she named it (D024). Bare code has
            // no fences to name, so null — beside the index, never instead of
            // it: a display string and a machine handle are two things.
            cellName: null,
        })
        assert.notEqual(diagnostics(ast, [ailment])[1], answer[1],
            "ailments are read live each ask, never memoized")
    })

    test("a diagnostic names the frame that died — the cell, not the page", () => {
        const ast = parseProgram("fw 10\nfor do")
        const answer = diagnostics(ast, [
            { message: "Function nosuchthing not defined", span: { line: 12 },
              kind: "walk", name: "wounded", address: "buf1#cell2" },
        ], "buf1")
        assert.equal(answer.length, 2)
        // The walk fault keeps its OWN address: the surface can say "cell 2
        // died" instead of reddening the whole page (the cascade).
        assert.equal(answer[1].address, "buf1#cell2")
        // A parse error has no frame; its address is the document's key and
        // its true place is the span.
        assert.equal(answer[0].address, "buf1")
    })
})

describe("ailmentsFor — a buffer's standing ailments by address", () => {
    const errors = [
        { address: "buf1", message: "a", span: { line: 2 } },
        { address: "buf1#cell2/coil", message: "b", span: { line: 7 } },
        { address: "buf2/coil", message: "c", span: { line: 7 } },
        { address: "buf10", message: "d", span: { line: 1 } },
    ]

    test("the plain tab and its page cells answer; siblings never leak their lines", () => {
        assert.deepEqual(ailmentsFor(errors, "buf1").map((e) => e.message), ["a", "b"])
        assert.deepEqual(ailmentsFor(errors, "buf2").map((e) => e.message), ["c"])
    })

    test("a key that is a prefix of another key stays its own buffer", () => {
        assert.deepEqual(ailmentsFor(errors, "buf10").map((e) => e.message), ["d"])
    })

    test("no scheduler, no key — the empty answer, never a throw", () => {
        assert.deepEqual(ailmentsFor(null, "buf1"), [])
        assert.deepEqual(ailmentsFor(errors, null), [])
    })
})

// TWO CELLS, ONE NAME (D024 rule 2). Silence here would seat two figures in one
// frame invisibly — the exact bug the decision exists to end — so the collision
// is a WOUND: visible, located, and hers to fix. The healthy cells still run.
describe("a duplicate cell name is said out loud", () => {
    // ONE PHASE. The same word under two different phases is two cells and no
    // wound — the name is a label, the section is what makes it mean a place.
    const dup = "###\n* one\n```spiral\nfw 1\n```\n```spiral\nfw 2\n```\n###"

    test("the later claimant is named in a diagnostic, at its own fence", () => {
        const found = diagnostics(parseProgram(dup), [], "b1")
        const collision = found.filter((w) => w.kind === "name")
        assert.equal(collision.length, 1, "one wound — the FIRST cell keeps the word freely")
        assert.equal(collision[0].why, "duplicate")
        assert.equal(collision[0].word, "spiral", "the FACTS ride the wound")
        assert.equal(collision[0].answersTo, "1.2", "…and what it answers to instead")
        assert.equal(collision[0].message, undefined, "the query authors no prose")
        assert.equal(collision[0].span.line, 6, "located on the offending opener")
        assert.equal(collision[0].address, "b1")
    })

    test("the same word under two phases is silent — no wound at all", () => {
        const scoped = "###\n* one\n```spiral\nfw 1\n```\n** two\n```spiral\nfw 2\n```\n###"
        assert.deepEqual(diagnostics(parseProgram(scoped), [], "b1"), [])
    })

    test("a page that names nothing is unwounded, and pays no walk for the asking", () => {
        const clean = "###\n```\nfw 1\n```\n```\nfw 2\n```\n###"
        assert.deepEqual(diagnostics(parseProgram(clean), [], "b1"), [])
    })

    test("the same name in one section is still one collision, not two", () => {
        const twice = "###\n```s\nfw 1\n```\n```s\nfw 2\n```\n```s\nfw 3\n```\n###"
        const found = diagnostics(parseProgram(twice), [], "b1")
        assert.equal(found.filter((w) => w.kind === "name").length, 2,
            "the first holds the name; both later claimants are marked")
    })
})

// THE HATCH CARRIES THE FAULT — a watcher must never have to RUN the code to
// learn there is an error in it. Before this, a page whose tenant cell died
// reflected `success` with a null message, so a FOLLOWING watcher was told
// nothing and only a draft — which re-runs the code on her own canvas — could
// surface it. Runtime standing in for a fact the author already knew.
describe("the verdict — a document with a dead cell is not well", () => {
    const walk = (address, message = "Function f not defined", line = 7) =>
        ({ message, span: { line }, kind: "walk", name: "wow", address })

    test("a CELL's death reddens the document, and says where", () => {
        const ast = parseProgram("###\n* Arrowhead\n** wow\n```wow\nf\n```\n###")
        const found = diagnostics(ast, [walk("b1#1.1.wow", "Function f not defined", 5)], "b1")
        const v = verdict(found, "b1")
        assert.equal(v.state, "error", "the page speaks its tenant's wound")
        assert.equal(v.wound.message, "Function f not defined", "it hands back the WOUND")
        const said = sayWound(v.wound)
        assert.match(said, /Arrowhead/, "the view locates it — the reader is elsewhere")
        assert.match(said, /line 5/)
    })

    test("the buffer's OWN fault is preferred — the most specific thing it can say", () => {
        const ast = parseProgram("fw 1")
        const found = diagnostics(ast, [walk("b1#1.cell", "tenant died", 1), walk("b1", "mine died", 1)], "b1")
        assert.equal(verdict(found, "b1").wound.message, "mine died")
    })

    test("a parse wound reddens the document — a watcher must not be told ☀︎", () => {
        const ast = parseProgram("for do\n  fw 100\nend")
        const found = diagnostics(ast, [], "b1")
        const parse = found.find((w) => w.kind === "parse")
        assert.ok(parse, "the parse wound stands")
        const v = verdict(found, "b1")
        assert.equal(v.state, "error", "the peer seam names the broken line")
        assert.equal(v.wound, primaryWound(found, "b1"))
        assert.equal(v.wound.kind, "parse")
        assert.match(v.wound.message, /number of loops after 'for'/)
    })
})

// ONE SELECTOR, TWO READERS. The child's own HUD and the reflect that reaches
// his friend must name the SAME fault. They used to choose independently — the
// HUD took the first walk wound, the verdict preferred the buffer's own — so a
// page could say two different things about itself depending on who asked.
describe("primaryWound — the document names one fault", () => {
    const walk = (address, message) => ({ message, span: { line: 1 }, kind: "walk", address })
    const found = [walk("b1#1.cell", "tenant died"), walk("b1", "mine died")]

    test("the buffer's own fault wins — the most specific thing it can say", () => {
        assert.equal(primaryWound(found, "b1").message, "mine died")
    })

    test("with no fault of its own, the first tenant's stands", () => {
        assert.equal(primaryWound([walk("b1#1.cell", "tenant died")], "b1").message, "tenant died")
    })

    test("the verdict speaks of exactly that wound — never a second choice", () => {
        assert.equal(verdict(found, "b1").wound, primaryWound(found, "b1"),
            "one selector feeds both, so the two readers cannot diverge")
    })

    test("a parse wound is a fault the document names", () => {
        const parse = { kind: "parse", message: "x", address: "b1" }
        assert.equal(primaryWound([parse], "b1"), parse)
    })

    test("a dependent alone is not a fault", () => {
        assert.equal(primaryWound([{ kind: "dependent", message: "x" }], "b1"), null)
    })
})

// WHAT COUNTS AS A FAULT — one list, so no two surfaces disagree about what is
// worth a sentence. A vocabulary that never rehearsed is not a lesser kind of
// silence than a frame that died: in both, the code did not happen. A parse
// wound is the same news for a watcher (the peer used to be told ☀︎). The panel
// used to shout a rehearsal wound while the wash stayed green and the wire said
// `success`, because the verdict read `walk` alone.
describe("announcements — the wounds a surface says out loud", () => {
    const walk = { kind: "walk", message: "f not defined", span: { line: 3 }, address: "b1" }
    const rehearsal = { kind: "rehearsal", message: "boom", span: { line: 1 }, address: "b1#1.c" }
    const parse = { kind: "parse", message: "looking for end", span: { line: 2 } }
    const dependent = { kind: "dependent", standsOn: "base", severity: "warning", address: "b1#1.d" }

    test("a death and a failed rehearsal both speak", () => {
        assert.deepEqual(announcements([walk, rehearsal]), [walk, rehearsal])
    })

    test("a parse wound is a shout too — the watcher must not be told ☀︎", () => {
        assert.deepEqual(announcements([parse]), [parse])
    })

    test("a dependent is a warning, not news to say out loud", () => {
        assert.deepEqual(announcements([dependent]), [])
    })

    test("nothing to say about nothing", () => {
        assert.deepEqual(announcements([]), [])
        assert.deepEqual(announcements(null), [])
    })

    test("a rehearsal-only failure is a fault — wash, wire and sentence agree", () => {
        const v = verdict([rehearsal], "b1")
        assert.equal(v.state, "error", "the document is not well")
        assert.equal(v.wound, rehearsal)
        assert.equal(primaryWound([rehearsal], "b1"), rehearsal,
            "one selector feeds the verdict and the HUD alike")
    })

    test("the buffer's own death still outranks a tenant's rehearsal", () => {
        const mine = { ...walk, address: "b1", message: "mine died" }
        assert.equal(primaryWound([rehearsal, mine], "b1").message, "mine died")
    })
})

// WHO THE DEAD CELL TOOK WITH IT (D019's edge, walked backward). A cell that
// died leaves every cell inheriting its vocabulary standing on a definition
// that never ran — and the page seats LAZILY, so without this the child learns
// it only by reaching each one and watching it die.
describe("a dead cell names its dependents", () => {
    //  * top          → its cell defines the vocabulary
    //  ** under       → inherits it  (dependent)
    //  * beside       → does NOT inherit — a sister phase, never sideways
    const SRC = [
        "###", "* top", "```base", "fn f do end", "```",
        "** under", "```child", "f", "```",
        "* beside", "```sister", "f", "```", "###",
    ].join("\n")
    const deadAtBase = [{ message: "boom", span: { line: 4 }, kind: "walk", address: "b1#1.base" }]

    // A CHILD OF THE DEATH, never a peer (rustc SubDiagnostic / LSP
    // relatedInformation): the dominoes are the shape of the one that fell.
    test("the dependent hangs UNDER the wound that caused it", () => {
        const found = diagnostics(parseProgram(SRC), deadAtBase, "b1")
        assert.deepEqual(found.filter((w) => w.kind === "dependent"), [],
            "never at the top level, where a reader would count it as its own problem")
        const [walk] = found.filter((w) => w.kind === "walk")
        assert.equal(walk.children.length, 1, "it hangs on the death that caused it")
        assert.equal(walk.children[0].kind, "dependent")
    })

    test("the dependent is warned, at its own fence, addressed to its own cell", () => {
        const found = diagnostics(parseProgram(SRC), deadAtBase, "b1")
        const dep = everyWound(found).filter((w) => w.kind === "dependent")
        assert.equal(dep.length, 1, "only the cell that INHERITS — a sister phase is untouched")
        assert.equal(dep[0].address, "b1#1.1.child", "addressed to the dependent, not the dead one")
        assert.equal(dep[0].standsOn, "base", "and it names what it stands on")
        assert.equal(dep[0].span.line, 7, "inked at its own opening fence")
        assert.equal(severityOf(dep[0]), "warning", "it did not itself fail")
        assert.equal(dep[0].severity, undefined, "and carries no literal — the KIND decides")
    })

    test("a dependent is not a death — the verdict never sees it", () => {
        const found = diagnostics(parseProgram(SRC), [], "b1")
        assert.deepEqual(everyWound(found).filter((w) => w.kind === "dependent"), [],
            "no walk fault, no dependents")
        const hurt = diagnostics(parseProgram(SRC), deadAtBase, "b1")
        assert.equal(verdict(hurt, "b1").state, "error")
        assert.equal(verdict(hurt, "b1").wound.message, "boom",
            "the verdict speaks the WALK fault, never the warning it caused")
    })

    test("a cell carrying its own fault is not also called a dependent", () => {
        const both = [...deadAtBase,
            { message: "its own", span: { line: 7 }, kind: "walk", address: "b1#1.1.child" }]
        const found = diagnostics(parseProgram(SRC), both, "b1")
        assert.deepEqual(everyWound(found).filter((w) => w.kind === "dependent"), [],
            "its own wound is the more specific thing to say")
    })

    test("vocabulary flows DOWN the outline, never sideways (D019)", () => {
        const found = diagnostics(parseProgram(SRC), deadAtBase, "b1")
        assert.ok(!everyWound(found).some((w) => w.kind === "dependent" && w.address.includes("sister")),
            "a sister phase inherits nothing, so it is not compromised")
    })
})

// THE WIRE CARRIES INTERPRETABLE WOUNDS — the genericity test.
//
// The turtle used to publish `{ state, message: errors[0].message }`: one
// arbitrary string, and a receiver could only reprint it. It now publishes the
// LIST, each wound addressed to the frame it belongs to. This pins that a remote
// shell can isolate regions from the payload ALONE — no tree, no scheduler, no
// runtime — which is the whole point of sending wounds instead of a sentence.
describe("a remote isolates regions from the wire alone", () => {
    // Exactly what was captured crossing the socket (page → server → watcher).
    const payload = [
        { kind: "walk", address: "buf#1.base", span: { line: 4 },
          message: "Function f not defined", cellName: "base" },
        { kind: "dependent", address: "buf#1.1.child", span: { line: 7 },
          severity: "warning", standsOn: "base", cellName: "child" },
    ]

    // The whole interpretation, on a receiver that holds nothing else.
    const regions = (wounds) => {
        const by = new Map()
        for (const w of wounds) by.set(w.address, [...(by.get(w.address) ?? []), w])
        return by
    }

    test("every wound names a region, and the regions are the frame keys", () => {
        const by = regions(payload)
        assert.deepEqual([...by.keys()], ["buf#1.base", "buf#1.1.child"],
            "addresses ARE the canvas's own keys — nothing to resolve or look up")
    })

    test("the dead region and the compromised one are told apart by kind alone", () => {
        const by = regions(payload)
        assert.equal(by.get("buf#1.base")[0].kind, "walk", "this one died")
        assert.equal(by.get("buf#1.1.child")[0].kind, "dependent", "this one stands on it")
        assert.equal(by.get("buf#1.1.child")[0].standsOn, "base",
            "and it says WHICH — a fact, so a remote may render it in its own words")
    })

    test("severity separates a death from a warning without reading any prose", () => {
        assert.equal(payload.find((w) => w.kind === "walk").severity, undefined,
            "absent means error — toDiagnostics' own default")
        assert.equal(payload.find((w) => w.kind === "dependent").severity, "warning")
    })

    test("nothing here needed a tree, a scheduler, or a message to parse", () => {
        // The locating already happened at the author. A receiver reads fields.
        for (const w of payload) {
            assert.ok(w.address, "addressed")
            assert.ok(w.span?.line, "placed")
            assert.ok(w.kind, "kinded")
        }
    })
})

// THREE HOLDERS, ONE LAW: a fault stands until the thing that raised it runs
// again. Frames hold their own (the scheduler clears on re-run); a SEAT that
// threw has no frame at all, so the turtle holds it per address; a phase's
// broken vocabulary is held per address too. This join is the ONE place that
// plurality is allowed to exist — nothing downstream may learn of it.
describe("standingAilments — three holders, one list", () => {
    const w = (message, line, address) => ({ message, span: { line }, address, kind: "walk" })

    test("nothing held is an empty list, not a crash", () => {
        assert.deepEqual(standingAilments(), [])
        assert.deepEqual(standingAilments({}), [])
    })

    test("a seat that threw stands beside a frame that died", () => {
        const got = standingAilments({
            frames: [w("frame died", 3, "a")],
            seats: [w("seating threw", 1, "b")],
        })
        assert.equal(got.length, 2)
        assert.deepEqual(got.map((x) => x.address), ["a", "b"])
    })

    test("a seat fault is a wound like any other — one shape, one list", () => {
        const [only] = standingAilments({ seats: [w("boom", 2, "pond")] })
        assert.equal(only.kind, "walk")
        assert.equal(only.address, "pond")
        assert.equal(only.span.line, 2)
    })

    test("map iterators are accepted, since that is how the turtle holds them", () => {
        const seats = new Map([["pond", w("boom", 2, "pond")]])
        assert.equal(standingAilments({ seats: seats.values() }).length, 1)
    })

    // Many cells of a phase share ONE vocabulary, so a broken line there is one
    // diagnostic, not one per cell that reads it.
    test("rehearsals dedupe by where the hurt lives", () => {
        const got = standingAilments({
            rehearsals: [w("no such word", 4, "p#c1"), w("no such word", 4, "p#c2")],
        })
        assert.equal(got.length, 1, "one broken line, one diagnostic")
    })

    test("but two different broken lines are two diagnostics", () => {
        const got = standingAilments({
            rehearsals: [w("no such word", 4, "p#c1"), w("no such word", 9, "p#c2")],
        })
        assert.equal(got.length, 2)
    })

    test("frames and seats never dedupe — two addresses, two hurts", () => {
        const got = standingAilments({
            frames: [w("boom", 1, "a"), w("boom", 1, "b")],
            seats: [w("boom", 1, "c")],
        })
        assert.equal(got.length, 3, "same words, different tenants")
    })

    // The dedupe is a RULE ABOUT VOCABULARY, not about words. Two tabs can throw
    // the identical message on the identical line and they are two hurts, in two
    // places, each wanting its own ink — folding seats into the rehearsal dedupe
    // would silently drop one of them.
    test("two seats with identical words on identical lines are two hurts", () => {
        const got = standingAilments({
            seats: [w("boom", 1, "pond"), w("boom", 1, "meadow")],
        })
        assert.equal(got.length, 2, "the address is what tells them apart")
        assert.deepEqual(got.map((x) => x.address), ["pond", "meadow"])
    })

    test("the address rule filters the joined list, as it does any other", () => {
        const all = standingAilments({
            frames: [w("frame", 1, "mine")],
            seats: [w("seat", 2, "theirs")],
        })
        assert.deepEqual(ailmentsFor(all, "mine").map((x) => x.message), ["frame"])
    })
})

// WHICH WOUND IS WHICH — a fact, so it lives beside the other facts. It was
// `mark` in voice.js, one word away from this file's own `marks` (the outline
// print every locate shares).
describe("fingerprint — what makes two wounds the same wound", () => {
    const w = (o) => ({ kind: "walk", address: "a", message: "boom", span: { line: 1 }, ...o })

    test("the same four facts are the same wound", () => {
        assert.equal(fingerprint(w()), fingerprint(w()))
    })

    test("another line is another wound", () => {
        assert.notEqual(fingerprint(w()), fingerprint(w({ span: { line: 2 } })))
    })

    test("another frame is another wound", () => {
        assert.notEqual(fingerprint(w()), fingerprint(w({ address: "b" })))
    })

    test("another kind of hurt in the same place is another wound", () => {
        assert.notEqual(fingerprint(w()), fingerprint(w({ kind: "parse" })))
    })

    test("a placeless, wordless wound still has a fingerprint", () => {
        assert.equal(typeof fingerprint({ kind: "walk" }), "string")
    })
})

// SEVERITY IS THE VERDICT AXIS — one field, not two that must agree.
//
// They were two (a FAULT set and a severity literal) and they had already
// drifted: `name` carried no severity, so the gutter defaulted it to "error"
// and inked it RED, while the verdict — reading its own list — called the
// document well and painted a watching friend ☀︎. Same class of lie the parse
// widening was made to kill, alive on a different kind.
describe("the wound vocabulary — one row per kind", () => {
    test("every kind has a severity, and it is one of two words", () => {
        for (const [kind, row] of Object.entries(KINDS)) {
            assert.ok(["error", "warning"].includes(row.severity), `${kind}: ${row.severity}`)
        }
    })

    test("what breaks the run is an error; what stands beside it is a warning", () => {
        assert.equal(severityOf({ kind: "parse" }), "error")
        assert.equal(severityOf({ kind: "walk" }), "error")
        assert.equal(severityOf({ kind: "rehearsal" }), "error")
        assert.equal(severityOf({ kind: "name" }), "warning")
        assert.equal(severityOf({ kind: "dependent" }), "warning")
    })

    // A hurt we cannot name must not be quietly downgraded to a warning.
    test("an unknown kind is an error, not a warning", () => {
        assert.equal(severityOf({ kind: "something-new" }), "error")
        assert.equal(severityOf({}), "error")
        assert.equal(severityOf(null), "error")
    })

    test("announcements IS the severity filter — there is no second list", () => {
        const wounds = Object.keys(KINDS).map((kind) => ({ kind }))
        const said = announcements(wounds).map((w) => w.kind)
        assert.deepEqual(said, ["parse", "walk", "rehearsal"])
        for (const w of announcements(wounds)) assert.equal(severityOf(w), "error")
    })
})

// THE LIE, PINNED. A document whose only wound is a name collision: the gutter
// must show a WARNING and the verdict must call the document well — the two
// answers agreeing because they read the same field.
describe("a name collision no longer inks red on a healthy document", () => {
    const dup = "###\n* one\n```spiral\nfw 1\n```\n```spiral\nfw 2\n```\n###"

    test("the collision is warned, not errored", () => {
        const found = diagnostics(parseProgram(dup), [], "b1")
        const collision = found.find((w) => w.kind === "name")
        assert.ok(collision, "still said out loud (D024 rule 2)")
        assert.equal(severityOf(collision), "warning")
    })

    test("and the document is well — no friend is told otherwise", () => {
        const found = diagnostics(parseProgram(dup), [], "b1")
        assert.equal(verdict(found, "b1").state, "success")
        assert.deepEqual(announcements(found), [], "nothing worth a sentence")
    })
})
