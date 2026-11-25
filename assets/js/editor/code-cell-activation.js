// Cursor-driven code-cell activation (id:gw-grammar).
//
// The cell the cursor rests in is ACTIVE — full strength, and the only cell a
// notebook would evaluate; every other ``` … ``` cell is inert. THE CURSOR LAW
// lives next to the geometry it reads (kindleCell, plang-mode.js, id:gw-cell) and
// that walk is shared, so fold, dim and eval never grow a second one:
//   stepActivation   edit / cursor move / peer move → one value (the memo)
//   paintPlan        which VISIBLE lines carry which mark — pure, countable
//   ViewPlugin       those decorations, over visibleRanges
//
// The field carries STATE ONLY; the view paints viewport-wide, never document-wide
// (|plan| <= 2 * visible + 1, activation_paint_test.mjs). A naive findCells per
// cursor move is ~191µs on 5k lines (test/js/profile/linter_bench.mjs), hence the
// memo: an unchanged active cell returns the SAME object, and a move replaces it.
//
// THE PEER RIDES THE SAME FIELD (D025 R6): the friend's attention arrives as a
// line, painted in the same walk — no second field, no second gate (D021's bound,
// honoured on the surface it was written for). The peer mark COMPOSES with
// active/inactive, so a cell that is both costs no branch and no extra range;
// while the watcher FOLLOWS, the peer's cell IS the seated cell — "spotlight only
// when not following" is a coincidence of the geometry, not a guard anyone writes.
//
// Scroll-focus needs no gate: the reach organ (reach.js, in both shells) plants the
// caret where the reader scrolled, so one cursor law lights scrolling too
// (gw-appearance law 1) — and only for a READER: where there is a cursor, the
// cursor decides alone. CM6 arrives at call time, never as a static import.

import { findProse, cellAt, kindleCell } from "./plang-mode.js";


// A peer's line is a datum from THEIR document. Validate it as a line number
// and nothing more: a fractional or out-of-range value must not reach
// `doc.line()`, and a number is not news the editor may rebase on its own.
export const peerLineAt = (peerLine, lines) =>
    Number.isInteger(peerLine) && peerLine >= 1 && peerLine <= lines ? peerLine : null;
// open-line: cheap equality within one doc snapshot (the memo key). Across
// edits the held CELL travels by its OPENER — a position mapped through the
// edit — because `coord` is an address in ONE revision, never an identity
// (id:gw-cell, D021).
const keyOf = (cell) => (cell ? cell.open : null);

// The four marks, in ONE place: `paintPlan` names them, the view builds them.
// A mark that exists in one and not the other is now a typo you can see.
const MARKS = Object.freeze({
    active: 'active',
    inactive: 'inactive',
    peerCell: 'peerCell',
    peerLine: 'peerLine',
});

// The opener of the held cell, in the CURRENT document's coordinates. Only the
// ChangeSet can carry a position across an edit; without one there is nothing
// sound to do, so we fall back to the old line number and say so.
const heldAnchor = (prev, changes, doc) => {
    if (!prev) return null;
    if (prev.anchor != null && changes) {
        const at = changes.mapPos(prev.anchor, 1);
        return at <= doc.length ? doc.lineAt(at).number : null;
    }
    return prev.held ? prev.held.open : null;
};

const anchorOf = (doc, cell) => (cell ? doc.line(cell.open).from : null);

// Pure state transition for the activation field — no decorations, no CM6.
//   - first parse / doc edit  → re-walk the cell + meadow indexes; the held cell
//                               travels by its opener MAPPED through `changes`.
//   - cursor move             → reuse the cached indexes; a new value only when the
//                               active cell changed, else the SAME object (memo hit).
//   - peer move               → a new value; the line is finer than a cell and must
//                               follow the friend exactly.
//
// THE PEER'S DATUM IS A LINE, and only a line is kept. A line is TOTAL — every
// position in the document has one, so it means something in prose, on bare
// code, between cells, and inside them alike. The CELL is derived from it at
// build time and never stored: derive, don't duplicate.
//
// Across steps the hold is TWO things: `anchor` (the opener's offset, mapped
// through each edit) and `held` (this revision's cell object). `key` is only the
// projection held.open — never a cross-edit identity (id:gw-cell).
export function stepActivation(prev, facts) {
    const { docChanged, selectionChanged, doc, headLine, peerLine = null, changes = null } = facts;

    if (!prev || docChanged) {
        const { cells, meadows } = findProse(doc);
        const held = heldAnchor(prev, changes, doc);
        const active = kindleCell(cells, meadows, headLine, held, !prev);
        return {
            cells, meadows, anchor: anchorOf(doc, active), held: active, peerLine,
        };
    }

    if (selectionChanged || peerLine !== prev.peerLine) {
        const active = kindleCell(prev.cells, prev.meadows, headLine, keyOf(prev.held), false);
        const key = keyOf(active);
        // Memo hit — the SAME object, no rebuild, no allocation. The move path
        // is untouched by the peer key: the watcher's own cursor never changes
        // `peerLine`, so it reaches this line exactly as it always did.
        if (key === keyOf(prev.held) && peerLine === prev.peerLine) return prev;
        return {
            cells: prev.cells, meadows: prev.meadows, anchor: anchorOf(doc, active), held: active, peerLine,
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

// INSTRUMENT: how many ranges the last paint built, and for how many lines. A
// document that grows must not grow these (activation_paint_test pins the same
// bound without a DOM; probe/keystroke-latency/paint_check.sh pins it in one).
export const paintStats = { ranges: 0, plan: 0 };

const sortedByFrom = (ranges) => {
    for (let i = 1; i < ranges.length; i++) if (ranges[i].from < ranges[i - 1].from) return false;
    return true;
};

// WHICH VISIBLE LINES CARRY WHICH MARK — pure, so it can be counted.
//
// O(visible lines + cells passed), never O(cells): the cell cursor only moves
// forward as lines ascend, and a line no cell contains emits nothing. This is
// the whole performance argument in one function — the geometry stays
// document-wide, the PAINT is viewport-wide.
//
// Four marks are possible, so the cardinality bound a test can assert is:
//   |plan| <= 2 * visible lines + 1   (active|inactive + peerCell, plus the peer line)
export function paintPlan(doc, cells, active, peerLine, ranges) {
    // PRECONDITION: ranges ascend by `from` (CM6's visibleRanges and viewport
    // both do). The cell cursor only moves forward, so an unsorted list would
    // silently under-paint; normalize instead of trusting the caller.
    const ordered = sortedByFrom(ranges) ? ranges : [...ranges].sort((a, b) => a.from - b.from);
    const marks = new Map();
    const peerAt = peerLineAt(peerLine, doc.lines);
    const peerIn = peerAt == null ? null : cellAt(cells, peerAt);
    const add = (line, mark) => {
        const found = marks.get(line);
        if (found) found.push(mark);
        else marks.set(line, [mark]);
    };

    let cell = 0;
    const spans = [];
    for (const range of ordered) {
        const from = doc.lineAt(range.from).number;
        const to = doc.lineAt(range.to).number;
        spans.push(from, to);
        for (let line = from; line <= to; line++) {
            while (cell < cells.length && cells[cell].end < line) cell++;
            if (cell >= cells.length) break;
            if (cells[cell].open > line) continue;
            add(line, cells[cell] === active ? MARKS.active : MARKS.inactive);
            if (cells[cell] === peerIn) add(line, MARKS.peerCell);
        }
        if (cell >= cells.length && peerAt == null) break;
    }

    // The friend's line is painted only when it is DRAWN: a bounded plan may not
    // decorate a line off the screen any more than any other.
    let seen = false;
    for (let i = 0; i < spans.length; i += 2) if (peerAt != null && peerAt >= spans[i] && peerAt <= spans[i + 1]) seen = true;
    if (seen) add(peerAt, MARKS.peerLine);

    return Array.from(marks, ([line, mark]) => ({ line, marks: mark }))
        .sort((a, b) => a.line - b.line);
}

export const createCodeCellActivationExtension = (cm6) => {
    const { StateField, StateEffect, Decoration, ViewPlugin } = cm6;

    peerCell ??= StateEffect.define();

    // Two marks, one walk, two different claims (D025 R6): `.cm-peer-line` is the
    // DATUM — total, it lands in prose, between cells, or in a body and means the
    // same everywhere; `.cm-peer-cell` is DERIVED from it, and absent outside a fence.
    const LINE = {
        [MARKS.inactive]: Decoration.line({ class: 'cm-cell-inactive' }),  // inert — dimmed
        [MARKS.active]:   Decoration.line({ class: 'cm-cell-kindled' }),   // the live cell
        [MARKS.peerCell]: Decoration.line({ class: 'cm-peer-cell' }),      // the peer's focus — the cell they are kindling
        [MARKS.peerLine]: Decoration.line({ class: 'cm-peer-line' }),      // THE PEER — exactly where they are
    };


    const facts = (state, docChanged, selectionChanged, peerLine, changes = null) => ({
        docChanged, selectionChanged, peerLine, changes,
        doc:      state.doc,
        headLine: state.doc.lineAt(state.selection.main.head).number,
    });

    const field = StateField.define({
        create:  (state)    => stepActivation(null, facts(state, true, false, null)),
        update:  (prev, tr) => {
            let peerLine = prev.peerLine ?? null;
            for (const e of tr.effects) if (e.is(peerCell)) peerLine = e.value ?? null;
            // The ChangeSet is the only thing that can carry the held opener
            // across an edit; `tr.startState.doc` is the document it maps FROM.
            return stepActivation(prev,
                facts(tr.state, tr.docChanged, !!tr.selection, peerLine, tr.docChanged ? tr.changes : null));
        },
    });

    // Paint only what is on screen. `visibleRanges` — not `viewport` — is the
    // set CM6 actually draws: folds hide ranges, and a hidden line must cost
    // nothing. The field above stays the one owner of the geometry.
    const paint = (view) => {
        const v = view.state.field(field, false);
        if (!v) return Decoration.none;
        const ranges = [];
        // `visibleRanges` at mount can still be empty; the viewport is the safe
        // seed, and the first viewport update repaints the exact drawn set.
        const drawn = view.visibleRanges.length ? view.visibleRanges : [view.viewport];
        const plan = paintPlan(view.state.doc, v.cells, v.held, v.peerLine, drawn);
        for (const { line, marks } of plan) {
            const at = view.state.doc.line(line).from;
            for (const mark of marks) ranges.push(LINE[mark].range(at));
        }
        paintStats.ranges = ranges.length;
        paintStats.plan = plan.length;
        // true — sort: the peer's line may sit anywhere, including outside every cell.
        return Decoration.set(ranges, true);
    };

    const painter = ViewPlugin.fromClass(class {
        constructor(view) { this.decorations = paint(view); }
        update(update) {
            const before = update.startState.field(field);
            const after = update.state.field(field);
            // A fold moves `visibleRanges` without moving the doc: repaint on geometry too.
            if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged || before !== after) {
                this.decorations = paint(update.view);
            }
        }
    }, { decorations: (plugin) => plugin.decorations });

    return [field, painter];
};
