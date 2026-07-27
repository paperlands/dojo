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

// THE PEER'S CELL RIDES THIS SAME FIELD (D025 R6). A watched friend's attention
// arrives as a line; the cell it falls in is painted `.cm-peer-cell` — one
// `findProse`, one `RangeSet`, one `build()`, TWO KEYS. Never a second
// decoration field over the same walk, and never a second gate: D021's bound,
// honoured on the surface it was written for.
//
// The peer mark COMPOSES with active/inactive instead of racing it — four
// static line decorations, so a cell that is both costs no branch and no extra
// range. While the watcher is FOLLOWING, the peer's cell is the seated cell, so
// the two coincide and there is nothing extra to see; "spotlight only when not
// following" is a coincidence of the geometry, not a guard anyone writes.

import { findProse, cellAt, inMeadowRange } from "./plang-mode.js";

const keyOf = (cell) => (cell ? cell.open : null);   // open-line uniquely ids a cell within one doc snapshot

// Pure state transition for the activation field. `build(doc, cells, active, peerLine)`
// makes the decoration set; `none` is the empty-decoration sentinel.
//   - first parse / doc edit  → re-walk the cell + meadow indexes, rebuild decorations.
//   - cursor move             → reuse the cached indexes; rebuild ONLY when the active
//                               cell changed, else return `prev` unchanged (memo hit).
//   - peer move               → rebuild; the line mark is finer than a cell and must
//                               follow the friend exactly.
//
// THE PEER'S DATUM IS A LINE, and only a line is kept. A line is TOTAL — every
// position in the document has one, so it means something in prose, on bare
// code, between cells, and inside them alike. The CELL is derived from it at
// build time and never stored: derive, don't duplicate.
export function stepActivation(prev, facts, build, none) {
    const { docChanged, selectionChanged, doc, headLine, peerLine = null } = facts;
    const paints = (cells) => cells.length || peerLine != null;

    if (!prev || docChanged) {
        const { cells, meadows } = findProse(doc);           // the one walk, both indexes
        const active = cellAt(cells, headLine)
            ?? (inMeadowRange(meadows, headLine) ? cells[0] : null)  // first light — prose only
            ?? null;
        return {
            deco: paints(cells) ? build(doc, cells, active, peerLine) : none,
            cells, meadows, key: keyOf(active), peerLine,
        };
    }

    if (selectionChanged || peerLine !== prev.peerLine) {
        const active = cellAt(prev.cells, headLine)          // cached indexes — no re-walk
            ?? (inMeadowRange(prev.meadows, headLine)
                ? prev.cells.find((c) => c.open === prev.key) // sticky: prose moves keep the light
                : null)                                       // out of the fence, on code: all cells rest
            ?? null;
        const key = keyOf(active);
        // Memo hit — the SAME object, no rebuild, no allocation. The move path
        // is untouched by the peer key: the watcher's own cursor never changes
        // `peerLine`, so it reaches this line exactly as it always did.
        if (key === prev.key && peerLine === prev.peerLine) return prev;
        return {
            deco: paints(prev.cells) ? build(doc, prev.cells, active, peerLine) : none,
            cells: prev.cells, meadows: prev.meadows, key, peerLine,
        };
    }

    return prev;
}

// The peer's line, as an effect. Defined when the extension is built, because
// this module takes CM6 at call time and never imports it — the same pattern
// theme.js uses. One effect type serves both shells; effects are typed, not
// instanced, and only the outer surface ever dispatches one.
let peerCell = null;

// Set (or clear, with null) the peer's attention on a view. Idempotent: the
// field's memo returns the same value object when the cell does not change, so
// a repeat is free. The caller sets this where it sets the DOCUMENT — the mark
// belongs to the text on screen, not to the view, so a draft that swaps the
// document clears it in the same breath instead of by a separate condition.
export function setPeerCell(view, line) {
    if (!view || view.destroyed || !peerCell) return;
    view.dispatch({ effects: peerCell.of(line ?? null) });
}

export const createCodeCellActivationExtension = (cm6) => {
    const { StateField, StateEffect, Decoration, EditorView } = cm6;

    peerCell ??= StateEffect.define();

    const LINE = {
        inactive:  Decoration.line({ class: 'cm-cell-inactive' }),   // inert — dimmed
        active:    Decoration.line({ class: 'cm-cell-active' }),     // the live cell
        peerCell:  Decoration.line({ class: 'cm-peer-cell' }),       // his focus — the cell he is kindling
        peerLine:  Decoration.line({ class: 'cm-peer-line' }),       // HIM — exactly where he is
    };

    // TWO MARKS, ONE WALK, and they say different things.
    //
    //   .cm-peer-line — the friend, on his LINE. Total: it lands in prose,
    //                   between cells, on bare code, or inside a body, and
    //                   means the same thing everywhere. This is the datum.
    //   .cm-peer-cell — the cell that line falls in, when it falls in one:
    //                   his FOCUS, spoken in the same language the canvas
    //                   already speaks for a kindled cell. Derived, never
    //                   stored, and simply absent when he stands outside a
    //                   fence — which is itself true, and says he is making.
    //
    // Ranges collected and sorted rather than pushed through a builder,
    // because the friend's line may sit anywhere — including outside every
    // cell, where a cell-ordered walk has no place to put it.
    const build = (doc, cells, active, peerLine) => {
        const ranges = [];
        const lines = doc.lines;
        const peerAt = peerLine != null && peerLine >= 1 && peerLine <= lines ? peerLine : null;
        const peerIn = peerAt == null ? null : cellAt(cells, peerAt);

        for (const cell of cells) {                          // cells are already in document order
            const mark = cell === active ? LINE.active : LINE.inactive;
            const focus = cell === peerIn ? LINE.peerCell : null;
            for (let ln = cell.open; ln <= Math.min(cell.end, lines); ln++) {
                const { from } = doc.line(ln);
                ranges.push(mark.range(from));               // line decorations sit at line start
                if (focus) ranges.push(focus.range(from));
            }
        }
        if (peerAt != null) ranges.push(LINE.peerLine.range(doc.line(peerAt).from));

        return Decoration.set(ranges, true);                 // true — sort; the peer's line lands anywhere
    };

    const facts = (state, docChanged, selectionChanged, peerLine) => ({
        docChanged, selectionChanged, peerLine,
        doc:      state.doc,
        headLine: state.doc.lineAt(state.selection.main.head).number,
    });

    return StateField.define({
        create:  (state)    => stepActivation(null, facts(state, true, false, null), build, Decoration.none),
        update:  (prev, tr) => {
            let peerLine = prev.peerLine ?? null;
            for (const e of tr.effects) if (e.is(peerCell)) peerLine = e.value ?? null;
            return stepActivation(prev, facts(tr.state, tr.docChanged, !!tr.selection, peerLine), build, Decoration.none);
        },
        provide: (f)        => EditorView.decorations.from(f, (v) => v.deco),
    });
};
