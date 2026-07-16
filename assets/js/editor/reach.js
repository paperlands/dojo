// =============================================================================
// THE REACH — one gesture, N surfaces (gw-appearance law 1; id:gw-cell,
// Shoot 1). The ``` cell the reader is AT is the sibling ambient that runs,
// under the SAME law the editor light follows (code-cell-activation.js):
//
//   1. the cursor's cell, when the cursor rests in one — the cursor is the gate;
//   2. else, inside the meadow, the last reach holds — prose keeps the light;
//   3. out of the fence, on bare code, the reach is NONE (published as null):
//      cells are previews and the program takes priority — she is making.
//
// Scrolling drives the reach only on a PAGE-shaped document (every non-blank
// line inside a meadow — the pressed-fragment shape): the LAST SEEN cell —
// the newest opening fence in view (posAtCoords reads the lowest visible
// line in one call) — and the caret is PLANTED at the reached cell's door,
// so the editor light follows the one cursor law: no second gate. A buffer
// with bare code never scroll-previews — a preview is cursor-only. A planted
// caret never blocks the next scroll reach; any real mouse/key interaction
// adopts the cursor again.
//
// This module is wiring only — the laws live in plang-mode.js (findProse /
// cellAt / lastSeenCell, views over the one prose walk). Surfaces differ
// only in their gate and where the reach lands: the outershell publishes
// scene.cell for the watched page; the inner shell publishes for her own
// literate tab. Same organ, shared behaviour.
// =============================================================================

import { findProse, cellAt, lastSeenCell, inMeadowRange, isPageDoc } from "./plang-mode.js"
import { temporal } from "../utils/temporal.js"

// mountReach(view, { gate, publish }) → { reset, cleanup }
//   view    — the CM6 EditorView the gesture reads (cursor, scroll, doc)
//   gate    — () => boolean: may the reach publish right now?
//   publish — (idx) => void: the reach — a 0-based cell index, or null when
//             the cursor stands on bare code (all cells rest); fires only
//             when the reached cell changes.
export function mountReach(view, { gate, publish }) {
    let lastIdx = 0      // a fresh page opens at its first cell, already lit
    let plantedPos = -1  // caret the scroll gesture planted — not "hers"

    const reach = (idx) => {
        if (idx === lastIdx) return
        lastIdx = idx
        publish(idx)
    }

    const onCursor = () => {
        if (!gate() || !view.state) return
        plantedPos = -1                     // a real interaction — the cursor is hers again
        const { cells, meadows } = findProse(view.state.doc)
        const line = view.state.doc.lineAt(view.state.selection.main.head).number
        const active = cellAt(cells, line)
        if (active) reach(cells.indexOf(active))
        else if (!inMeadowRange(meadows, line)) reach(null)   // bare code — cells rest
        // else: inside the meadow, prose keeps the last reach
    }

    const onScroll = () => {
        if (!gate() || !view.state) return
        const state = view.state
        const { cells, meadows } = findProse(state.doc)
        if (!cells.length) return
        if (!isPageDoc(state.doc, meadows)) return   // a program never scroll-previews
        const head = state.selection.main.head
        const curLine = state.doc.lineAt(head).number
        if (cellAt(cells, curLine) && head !== plantedPos) return   // a real cursor is the gate
        // The lowest visible line — CM6 answers in one call.
        const rect = view.scrollDOM.getBoundingClientRect()
        const pos = view.posAtCoords({ x: rect.left + 8, y: rect.bottom - 4 }, false)
        if (pos == null) return
        const bottomLine = state.doc.lineAt(Math.min(pos, state.doc.length)).number
        const cell = lastSeenCell(cells, bottomLine)
        const idx = cells.indexOf(cell)
        if (idx === -1 || idx === lastIdx) return
        reach(idx)
        // Plant the caret at the reached cell's door — the editor light
        // follows through the one cursor law, no second gate.
        plantedPos = state.doc.line(cell.open).from
        view.dispatch({ selection: { anchor: plantedPos } })
    }

    const onCursorDebounced = temporal.debounce(onCursor, 80)
    const onScrollDebounced = temporal.debounce(onScroll, 120)
    view.dom.addEventListener('mouseup', onCursorDebounced)
    view.dom.addEventListener('keyup', onCursorDebounced)
    view.scrollDOM.addEventListener('scroll', onScrollDebounced, { passive: true })

    return {
        // A page (re)opens at its kindled cell (0); a program opens with its
        // previews at rest (null). The caret is hers again either way.
        reset(idx = 0) { lastIdx = idx; plantedPos = -1 },
        cleanup() {
            view.dom.removeEventListener('mouseup', onCursorDebounced)
            view.dom.removeEventListener('keyup', onCursorDebounced)
            view.scrollDOM.removeEventListener('scroll', onScrollDebounced)
        },
    }
}
