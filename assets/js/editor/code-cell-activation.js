// Cursor-driven code-cell activation (id:gw-grammar).
//
// The cell the cursor rests in is ACTIVE — full strength, and the only cell a
// notebook would evaluate; every other ``` … ``` cell is inert: dimmed, not
// evaluated. THE CURSOR LAW (the cell shape rule, id:gw-cell):
//
//   1. the cursor's cell, when the cursor rests in one — the cursor is the gate;
//   2. else, inside the meadow, the cell already active stays — moving through
//      prose never drops the light (the child is reading);
//   3. out of the fence, on bare code, NO cell is active and none would be
//      evaluated (the child is making — the cells rest);
//   4. on first light in prose space, the FIRST cell — a fresh page opens with
//      its first figure lit, matching the sibling ambient the canvas mounts.
//
// Scroll-focus needs no second gate: the reach organ (editor/reach.js, mounted
// by both shells) plants the caret in the cell the reader scrolled to, so this
// one cursor law lights the editor for scrolling too — one attention center, N
// surfaces (gw-appearance law 1). And it plants only for a READER (an unfocused
// shell, nothing selected): where there is a cursor, the cursor decides alone.
//
// PERFORMANCE (why the field value is { deco, cells, key }, not just deco):
// activation recomputes on every cursor move, and a naive findCells + RangeSet
// rebuild is ~191µs/move on a 5k-line buffer (see test/js/profile/linter_bench.mjs)
// — enough to make arrow keys grind. So we cache the cell index across selection
// changes (it only changes on edits) and rebuild decorations ONLY when the active
// cell actually changes; an unchanged active cell returns the SAME value object —
// zero allocation, no RangeSet churn. Measured ~443× faster on the move path.
//
// Zero static imports of CM6 — received at call time (same pattern as theme.js);
// the cell walk lives in plang-mode.js so fold, dim, and eval share one source.

import { findProse, cellAt, inMeadowRange } from "./plang-mode.js";

const keyOf = (cell) => (cell ? cell.open : null);   // open-line uniquely ids a cell within one doc snapshot

// Pure state transition for the activation field. `build(doc, cells, active)` makes
// the decoration set; `none` is the empty-decoration sentinel.
//   - first parse / doc edit → re-walk the cell + meadow indexes, rebuild decorations.
//   - cursor move only       → reuse the cached indexes; rebuild ONLY when the active
//                              cell changed, else return `prev` unchanged (memo hit).
export function stepActivation(prev, facts, build, none) {
    const { docChanged, selectionChanged, doc, headLine } = facts;

    if (!prev || docChanged) {
        const { cells, meadows } = findProse(doc);           // the one walk, both indexes
        const active = cellAt(cells, headLine)
            ?? (inMeadowRange(meadows, headLine) ? cells[0] : null)  // first light — prose only
            ?? null;
        return { deco: cells.length ? build(doc, cells, active) : none, cells, meadows, key: keyOf(active) };
    }

    if (selectionChanged) {
        const active = cellAt(prev.cells, headLine)          // cached indexes — no re-walk
            ?? (inMeadowRange(prev.meadows, headLine)
                ? prev.cells.find((c) => c.open === prev.key) // sticky: prose moves keep the light
                : null)                                       // out of the fence, on code: all cells rest
            ?? null;
        const key = keyOf(active);
        if (key === prev.key) return prev;                   // memo hit — no rebuild, no allocation
        return { deco: build(doc, prev.cells, active), cells: prev.cells, meadows: prev.meadows, key };
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
        update:  (prev, tr) => stepActivation(prev, facts(tr.state, tr.docChanged, !!tr.selection), build, Decoration.none),
        provide: (f)        => EditorView.decorations.from(f, (v) => v.deco),
    });
};
