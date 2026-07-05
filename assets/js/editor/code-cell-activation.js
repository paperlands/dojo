// Cursor-driven code-cell activation (id:gw-grammar).
//
// The cell the cursor rests in is ACTIVE — full strength, and the only cell a
// notebook would evaluate. Every other ``` … ``` cell is inert: dimmed, and not
// evaluated. As the cursor moves, activation follows, so the buffer reads as one
// live cell among quiet neighbours — the first move toward a scrollable, adaptive
// notebook. The active cell computed here is the same one a future evaluator gates
// on: cellAt(findCells(doc), cursorLine).
//
// PERFORMANCE (why the field value is { deco, cells, key }, not just deco):
// activation recomputes on every cursor move, and a naive findCells + RangeSet
// rebuild is ~191µs/move on a 5k-line buffer (see test/js/profile/linter_bench.mjs)
// — enough to make arrow keys grind. So we cache the cell index across selection
// changes (it only changes on edits) and rebuild decorations ONLY when the active
// cell actually changes; an unchanged cursor cell returns the SAME value object —
// zero allocation, no RangeSet churn. Measured ~443× faster on the move path.
//
// Zero static imports of CM6 — received at call time (same pattern as theme.js);
// the cell walk lives in plang-mode.js so fold, dim, and eval share one source.

import { findCells, cellAt } from "./plang-mode.js";

const keyOf = (cell) => (cell ? cell.open : null);   // open-line uniquely ids a cell within one doc snapshot

// Pure state transition for the activation field. `build(doc, cells, active)` makes
// the decoration set; `none` is the empty-decoration sentinel.
//   - first parse / doc edit → re-walk the cell index and rebuild decorations.
//   - cursor move only       → reuse the cached index; rebuild ONLY when the active
//                              cell changed, else return `prev` unchanged (memo hit).
export function stepActivation(prev, facts, build, none) {
    const { docChanged, selectionChanged, doc, headLine } = facts;

    if (!prev || docChanged) {
        const cells  = findCells(doc);
        const active = cells.length ? cellAt(cells, headLine) : null;
        return { deco: cells.length ? build(doc, cells, active) : none, cells, key: keyOf(active) };
    }

    if (selectionChanged) {
        const active = cellAt(prev.cells, headLine);            // cached index — no re-walk
        const key    = keyOf(active);
        if (key === prev.key) return prev;                      // memo hit — no rebuild, no allocation
        return { deco: build(doc, prev.cells, active), cells: prev.cells, key };
    }

    return prev;
}

export const createCodeCellActivationExtension = (cm6) => {
    const { StateField, Decoration, EditorView, RangeSetBuilder } = cm6;

    const inactiveLine = Decoration.line({ class: 'cm-cell-inactive' }); // dimmed, inert
    const activeLine   = Decoration.line({ class: 'cm-cell-active' });   // the live cell

    const build = (doc, cells, active) => {
        const b = new RangeSetBuilder();
        for (const cell of cells) {                          // cells are already in document order
            const mark = cell === active ? activeLine : inactiveLine;
            for (let ln = cell.open; ln <= cell.end; ln++) {
                const { from } = doc.line(ln);
                b.add(from, from, mark);                     // line decorations sit at line start
            }
        }
        return b.finish();
    };

    const facts = (state, docChanged, selectionChanged) => ({
        docChanged, selectionChanged,
        doc:      state.doc,
        headLine: state.doc.lineAt(state.selection.main.head).number,
    });

    return StateField.define({
        create:  (state)    => stepActivation(null, facts(state, true, false), build, Decoration.none),
        update:  (prev, tr) => stepActivation(prev, facts(tr.state, tr.docChanged, tr.selection), build, Decoration.none),
        provide: (f)        => EditorView.decorations.from(f, (v) => v.deco),
    });
};
