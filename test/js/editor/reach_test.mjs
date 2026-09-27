// THE REACH under scroll (editor/reach.js, id:gw-cell) — scrolling reaches a
// cell and moves the cursor into it, but ONLY for a reader: an unfocused shell
// with nothing selected. Scroll never determines the cursor of someone editing.
//
// The fake view models one CM6 rule, because breaking it is silent: `dispatch`
// throws inside CM6's own update cycle, and CM6 swallows the throw. That ran the
// cell while the cursor never moved — kindled, unlit.

import { test, describe } from "node:test"
import assert from "node:assert"

import { mountReach } from "../../../assets/js/editor/reach.js"

// A DOM-free CM6 `state.doc` stand-in (same shape as lit_tokenizer_test's).
function mkDoc(src) {
    const objs = []
    let pos = 0
    for (const [i, text] of src.split("\n").entries()) {
        const from = pos, to = pos + text.length
        pos = to + 1                                          // +1 for the newline
        objs.push({ text, number: i + 1, from, to })
    }
    return {
        lines:  objs.length,
        length: pos,
        line:   (n) => objs[n - 1],
        lineAt: (p) => objs.find((o) => p >= o.from && p <= o.to) || objs[objs.length - 1],
    }
}

// A CM6 EditorView stand-in that keeps the ONE invariant this organ can break:
// `dispatch` throws while an update is in progress, and requestMeasure swallows
// what its callbacks throw (CM6's logException) — so a misplaced plant is
// silent, exactly as it was in the browser.
const LINE_H = 10   // every line the same height, so a pixel span IS a line span

function mkView(src, { bottomLine, topLine = 1, head = 0, anchor = head, focused = false }) {
    const doc = mkDoc(src)
    const view = {
        state: { doc, selection: { main: { head, anchor, empty: head === anchor } } },
        hasFocus: focused,                                 // a cursor active in the shell
        destroyed: false,
        dom: new EventTarget(),
        // The viewport as a LINE window: [topLine … bottomLine] visible, which is
        // all the organ reads it for. scrollTop/clientHeight and the height map
        // agree by construction, as they do in CM6.
        topLine, bottomLine,
        scrollDOM: new EventTarget(),
        lineBlockAtHeight: (h) => doc.line(Math.min(Math.floor(h / LINE_H) + 1, doc.lines)),
        phase: "idle",                                     // idle | measuring | updating
        dispatched: [],                                    // { anchor, phase } per transaction
        swallowed: [],                                     // what CM6 would have logged
        requestMeasure({ read, write }) {
            view.phase = "measuring"
            let measured
            try { measured = read() } catch (e) { view.swallowed.push(String(e.message)); view.phase = "idle"; return }
            view.phase = "updating"                        // CM6 writes in the Updating state
            try { write(measured) } catch (e) { view.swallowed.push(String(e.message)) }
            view.phase = "idle"
        },
        dispatch(spec) {
            if (view.phase !== "idle") {
                throw new Error("Calls to EditorView.update are not allowed while an update is in progress")
            }
            const anchor = spec.selection.anchor
            view.dispatched.push({ anchor, phase: view.phase })
            view.state = { doc, selection: { main: { head: anchor, anchor, empty: true } } }
        },
    }
    // Defined after the view they read — Object.assign would run them at once.
    Object.defineProperties(view.scrollDOM, {
        scrollTop:    { get: () => (view.topLine - 1) * LINE_H },
        clientHeight: { get: () => (view.bottomLine - view.topLine + 1) * LINE_H },
    })
    return view
}

// Let pace(120) fire and the deferred plant land. The FIRST gesture of a stream
// fires on the next macrotask; a later one waits out the pacing interval.
const settle = (ms = 5) => new Promise((r) => setTimeout(r, ms))
const PACE = 150

// ### fences a meadow; every non-blank line lives inside it, so this is a PAGE
// (bare code would make it a program, which never scroll-previews).
const PAGE = [
    "###",              // 1
    "```",              // 2  cell 1 opens
    "fw 100",           // 3
    "```",              // 4
    "between",          // 5
    "```",              // 6  cell 2 opens
    "rt 90",            // 7
    "```",              // 8
    "###",              // 9
].join("\n")

describe("the reach — scrolling kindles a cell AND lights it", () => {
    test("the reached cell is published and the caret planted inside it", async () => {
        const view = mkView(PAGE, { topLine: 5, bottomLine: 9 })  // cell 1 carried off the top
        const reached = []
        const reach = mountReach(view, { gate: () => true, publish: (line) => reached.push(line) })

        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle()

        assert.deepEqual(reached, [6], "the eyeline cell — its opening line, not an ordinal")
        assert.deepEqual(view.dispatched.map((d) => d.anchor), [view.state.doc.line(7).to],
            "the caret is PLANTED in the reached cell — the editor light has no second gate")
        assert.deepEqual(view.swallowed, [], "nothing was thrown into CM6's logException")
        reach.cleanup()
    })

    test("the plant lands OUTSIDE CM6's update cycle", async () => {
        const view = mkView(PAGE, { bottomLine: 7 })
        const reach = mountReach(view, { gate: () => true, publish: () => {} })

        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle()

        assert.equal(view.dispatched.length, 1)
        assert.equal(view.dispatched[0].phase, "idle",
            "a transaction dispatched from read/write is refused and silently lost")
        reach.cleanup()
    })

    test("a planted caret never blocks the next scroll reach", async () => {
        const view = mkView(PAGE, { bottomLine: 3 })   // cell 1 under the eyeline
        const reached = []
        const reach = mountReach(view, { gate: () => true, publish: (line) => reached.push(line) })

        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle()
        assert.deepEqual(reached, [2])                 // cell 1, caret planted at line 3

        view.topLine = 5; view.bottomLine = 9          // she scrolled on
        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle(PACE)
        assert.deepEqual(reached, [2, 6], "the caret the gesture itself planted is not 'hers'")
        reach.cleanup()
    })

    test("cells packed into one viewport light TOP first — each gets its own window", async () => {
        // Three cells at once, nothing between them but a line. Reading the
        // lowest visible cell would skip 1 and 2 forever: the bottom edge can
        // always be pushed further down (press Enter), but a cell can always be
        // brought to the TOP edge, so the top is what every cell can reach.
        //                 1      2      3       4      5      6       7      8      9       10
        const TIGHT = ["###", "```", "fw 1", "```", "```", "fw 2", "```", "```", "fw 3", "```", "###"].join("\n")
        const view = mkView(TIGHT, { topLine: 1, bottomLine: 11 })   // all three on screen
        const reached = []
        const reach = mountReach(view, { gate: () => true, publish: (line) => reached.push(line) })

        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle()
        assert.deepEqual(reached, [2], "cell 1 — the topmost, not the last one in view")

        view.topLine = 5                               // cell 1 off the top
        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle(PACE)
        assert.deepEqual(reached, [2, 5], "cell 2 — its own turn under the eyeline")

        view.topLine = 8                               // cell 2 off the top
        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle(PACE)
        assert.deepEqual(reached, [2, 5, 8], "cell 3 — no cell skipped")
        reach.cleanup()
    })

    test("a cursor in the shell holds the light — scroll does not speak at all", async () => {
        // The child's caret in cell 1 and the shell focused: typing at its foot scrolls
        // the doc, and the light must not slide off the cell he is writing.
        const view = mkView(PAGE, { bottomLine: 7, topLine: 2, focused: true,
                                    head: mkDoc(PAGE).line(3).from })
        const reached = []
        const reach = mountReach(view, { gate: () => true, publish: (line) => reached.push(line) })

        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle()

        assert.deepEqual(reached, [], "cell 2's fence is in view, but the cursor is hers")
        assert.deepEqual(view.dispatched, [], "her caret is not moved out from under her")
        reach.cleanup()
    })

    test("her cell scrolled clean out of sight still does not hand the light on", async () => {
        // The same focused caret in cell 1, scrolled off the top. Visibility is
        // NOT the test — a cursor in the shell is a cursor in the shell, and
        // scroll must never determine it. (An out-of-view horizon used to hand
        // the light on here; that stole the caret mid-edit.)
        const view = mkView(PAGE, { bottomLine: 8, topLine: 5, focused: true,
                                    head: mkDoc(PAGE).line(3).from })
        const reached = []
        const reach = mountReach(view, { gate: () => true, publish: (line) => reached.push(line) })

        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle()

        assert.deepEqual(reached, [], "no publish — the shell is being written in")
        assert.deepEqual(view.dispatched, [], "no plant")
        reach.cleanup()
    })

    test("a click landing mid-gesture cancels the plant", async () => {
        // The plant is deferred a microtask past the measure; focus can arrive
        // in that gap, and the reach asks again where it lands.
        const view = mkView(PAGE, { bottomLine: 7 })
        const reached = []
        const reach = mountReach(view, { gate: () => true, publish: (line) => reached.push(line) })

        view.scrollDOM.dispatchEvent(new Event("scroll"))
        view.hasFocus = true                           // he clicked into the shell
        await settle()

        assert.deepEqual(reached, [], "the gesture is dropped, not raced")
        assert.deepEqual(view.dispatched, [])
        reach.cleanup()
    })

    test("the caret rests on the cell's last inside line, at its end — ready to write", async () => {
        const view = mkView(PAGE, { topLine: 5, bottomLine: 9 })
        const reach = mountReach(view, { gate: () => true, publish: () => {} })

        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle()

        const doc = view.state.doc
        const at = doc.lineAt(view.state.selection.main.head)
        assert.equal(at.number, 7, "the last line INSIDE the fences (cell 2 spans 6…8)")
        assert.equal(at.text, "rt 90")
        assert.equal(view.state.selection.main.head, at.to, "at its END — she types onward, not before")
        // The property that makes it essential: the child's first keystroke must not land
        // on a fence. A broken fence un-pages the document and takes every
        // sibling cell down with it.
        assert.ok(!at.text.trimStart().startsWith("```"), "never parked on a ``` fence")
        reach.cleanup()
    })

    test("a cell with nothing inside rests at its opener — and is still safe to write", async () => {
        //                1     2      3        4      5     6      7      8
        const EMPTY = ["###", "```", "```", "prose", "```", "fw 1", "```", "###"].join("\n")
        const view = mkView(EMPTY, { bottomLine: 3 })   // the empty cell, opened at 2
        const reach = mountReach(view, { gate: () => true, publish: () => {} })

        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle()

        const at = view.state.doc.lineAt(view.state.selection.main.head)
        assert.equal(at.number, 2, "the opener — there is no line inside to rest on")
        assert.equal(view.state.selection.main.head, at.to,
            "at its END, so a keystroke makes ```word — CELL_OPEN takes an info word, " +
            "and the cell survives. The degenerate case needs no clamp of its own.")
        reach.cleanup()
    })

    test("an active selection is his — scroll never steals it", async () => {
        // A real range selected (a drag, a pending cut): the fence in view
        // would normally reach and plant, but an edit is in flight. Unfocused,
        // so it is the SELECTION alone doing the vetoing — a range outlives the
        // focus that made it.
        const doc = mkDoc(PAGE)
        const view = mkView(PAGE, { bottomLine: 7, head: doc.line(1).from, anchor: doc.line(3).from })
        const reached = []
        const reach = mountReach(view, { gate: () => true, publish: (line) => reached.push(line) })

        view.scrollDOM.dispatchEvent(new Event("scroll"))
        await settle()

        assert.deepEqual(reached, [], "nothing published — the reach did not fire")
        assert.deepEqual(view.dispatched, [], "her selection is untouched")
        reach.cleanup()
    })

    test("teardown drops the gesture in flight — nothing reaches a dead surface", async () => {
        const view = mkView(PAGE, { bottomLine: 7 })
        const reached = []
        const reach = mountReach(view, { gate: () => true, publish: (line) => reached.push(line) })

        view.scrollDOM.dispatchEvent(new Event("scroll"))
        reach.cleanup()                                // the surface goes away mid-gesture
        await settle()

        assert.deepEqual(reached, [])
        assert.deepEqual(view.dispatched, [])
    })
})
