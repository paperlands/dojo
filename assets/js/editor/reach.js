// THE REACH — the child's attention, published as a line (the cell shape rule
// id:gw-cell; attention is the address, D021). Mounted by both shells; they
// differ only in `gate` and `publish`.
//
//   cursor in a cell        → that cell
//   cursor in prose         → the last one holds
//   cursor on bare code     → none (null): the child is making, not reading
//   scrolling, on a page    → the cell under the eyeline (the topmost that is
//                              enough on screen to be read), and the cursor moves
//                              into it — but only while the shell holds no
//                              cursor of the child's own
//
// SCROLL NEVER DETERMINES THE CURSOR. A shell with the cursor in it is being
// written in, and its scrolling is a byproduct of the writing — typing at a
// cell's foot scrolls the doc — so reading that scroll as attention would move
// the caret out from under an edit. The cursor law owns the cursor whenever
// there is one; scroll speaks only for a reader, and one test says which the
// child is: the shell is unfocused and nothing is selected.
//
// The laws are plang-mode.js; this file is only wiring.

import {
    findProse, cellAt, eyelineCell, cellBodyEnd, inMeadowRange, isPageDoc,
} from "./plang-mode.js"
import { temporal } from "../utils/temporal.js"

// mountReach(view, { gate, publish }) → { reset, pause, cleanup }
//   gate    — () => boolean: may this publish now?
//   publish — (line | null) => void: fires only when the cell changes.
//   pause   — (ms) => void: stand down while someone ELSE drives the viewport.
export function mountReach(view, { gate, publish }) {
    let attending = null   // the line we last published
    let dead = false
    let hushedUntil = 0

    // A scroll someone ELSE is driving is not the child's. A deadline, not a
    // flag, so a lost release cannot mute the eyeline for the session.
    const hushed = () => performance.now() < hushedUntil

    const attend = (line) => {
        if (line === attending) return
        attending = line
        publish(line)
    }

    // READING, not making: no cursor in the shell (an unfocused editor) and no
    // selection to steal — a range is an edit in flight, and it outlives the
    // focus that made it. Asked again where a gesture lands: the plant is
    // deferred a microtask, and a click can arrive in between.
    const reading = () => !view.hasFocus && view.state.selection.main.empty

    // Scrolling reached this cell: publish it and move the cursor to where the
    // child would write in it, so the editor light follows the one cursor law.
    // One precondition covers every line we touch — a cell whose closing line
    // the doc has lost is a cell that no longer exists.
    const enter = (cell) => {
        if (dead || view.destroyed || hushed() || !reading()) return
        const doc = view.state.doc
        if (cell.end > doc.lines) return
        attend(cell.open)
        view.dispatch({ selection: { anchor: doc.line(cellBodyEnd(cell)).to } })
    }

    const onCursor = () => {
        if (!gate() || !view.state) return
        const { cells, meadows } = findProse(view.state.doc)
        const line = view.state.doc.lineAt(view.state.selection.main.head).number
        const cell = cellAt(cells, line)
        if (cell) attend(cell.open)
        else if (!inMeadowRange(meadows, line)) attend(null)
        // else: prose — the last cell holds
    }

    const onScroll = () => {
        if (!gate() || !view.state || hushed() || !reading()) return
        const state = view.state
        const { cells, meadows } = findProse(state.doc)
        if (!cells.length) return
        if (!isPageDoc(state.doc, meadows)) return   // a program never scroll-previews
        // Read geometry in CM6's measure phase. Called straight out of the
        // scroll callback it forces a layout every time — measured at 362ms of
        // reflow across one typing burst, because typing at the foot of a doc
        // scrolls it.
        view.requestMeasure({
            read: () => {
                const lineOf = (h) => state.doc.lineAt(view.lineBlockAtHeight(h).from).number
                const top = view.scrollDOM.scrollTop
                const first = lineOf(top)
                const last = lineOf(top + view.scrollDOM.clientHeight - 1)
                const cell = eyelineCell(cells, first, last)
                return cell && cell.open !== attending ? cell : null
            },
            // Not in the write phase: CM6 throws on a dispatch inside its own
            // update cycle and swallows the throw, which ran the cell while the
            // cursor never moved — kindled, unlit.
            write: (cell) => { if (cell) queueMicrotask(() => enter(cell)) },
        })
    }

    const onCursorPaced = temporal.pace(onCursor, 80)
    const onScrollPaced = temporal.pace(onScroll, 120)
    view.dom.addEventListener('mouseup', onCursorPaced)
    view.dom.addEventListener('keyup', onCursorPaced)
    view.scrollDOM.addEventListener('scroll', onScrollPaced, { passive: true })

    return {
        // A page reopens with nothing attended, so the first gesture speaks; a
        // caller may seed the line it already knows.
        reset(line = null) { attending = line },
        // Someone else is driving the viewport — hold still until they land.
        // `pause(0)` releases at once, so a driver hands back the moment its own
        // scroll settles rather than waiting out the deadline.
        pause(ms = 0) { hushedUntil = ms > 0 ? performance.now() + ms : 0 },
        cleanup() {
            dead = true
            view.dom.removeEventListener('mouseup', onCursorPaced)
            view.dom.removeEventListener('keyup', onCursorPaced)
            view.scrollDOM.removeEventListener('scroll', onScrollPaced)
            onCursorPaced.cancel()
            onScrollPaced.cancel()
        },
    }
}
