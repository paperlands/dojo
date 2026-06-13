// CM6 operations — text transformation, context extraction, command dispatch.
//
// Position model:
//   CM5 used {line: 0-indexed, ch} objects throughout.
//   CM6 uses integer character offsets. All positions entering/leaving this
//   module are in CM5 {line, ch} form (for API compatibility with commands)
//   but internally converted to/from offsets via posToOffset / offsetToPos.

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

const posToOffset = (state, pos) =>
    state.doc.line(pos.line + 1).from + pos.ch;

const offsetToPos = (state, offset) => {
    const line = state.doc.lineAt(offset);
    return { line: line.number - 1, ch: offset - line.from };
};

// ---------------------------------------------------------------------------
// Structural indent — nesting depth from do/end pairs
// ---------------------------------------------------------------------------

// Scan lines 1..lineNumber counting do-terminated and end-starting lines.
// Returns indent in spaces (depth * 2, matching PaperLang convention).
const structuralIndent = (doc, lineNumber) => {
    let depth = 0;
    for (let ln = 1; ln <= lineNumber; ln++) {
        const text = doc.line(ln).text.trim();
        if (!text || text.startsWith('#')) continue;
        if (/\bdo\s*$/.test(text)) depth++;
        if (/^end\b/.test(text)) depth--;
    }
    return Math.max(0, depth) * 2;
};

// ---------------------------------------------------------------------------
// Core primitives
// ---------------------------------------------------------------------------

// Text replacement. Returns the new end position as {line, ch}.
const transform = (view, range, text, _origin = null) => {
    const state = view.state;
    const from = posToOffset(state, range.from);
    const to   = range.to ? posToOffset(state, range.to) : from;
    view.dispatch({ changes: { from, to, insert: text } });
    // Compute resulting end position from the updated state
    const newOffset = from + text.length;
    return { from: range.from, to: offsetToPos(view.state, newOffset) };
};

// Move cursor to end of inserted range, scroll into view, and illuminate
// every changed line so students see exactly what code was inserted.
// For single-line cmd: flashes one line. For ctrl blocks: flashes the whole block.
const flash = (view, range, cm6) => {
    if (!view || !range || !cm6) return;
    const { EditorSelection, EditorView } = cm6;
    const endOffset = posToOffset(view.state, range.to);
    view.dispatch({
        selection: EditorSelection.cursor(endOffset),
        effects: EditorView.scrollIntoView(endOffset, { y: 'nearest' }),
    });
    // After CM6 re-renders, animate every line in the changed range.
    // range uses 0-indexed line numbers (from offsetToPos); doc.line() is 1-indexed.
    requestAnimationFrame(() => {
        const state    = view.state;
        const fromLine = range.from.line;
        const toLine   = range.to.line;
        for (let ln = fromLine; ln <= toLine; ln++) {
            try {
                const lineDoc = state.doc.line(ln + 1);
                const at      = view.domAtPos(lineDoc.from);
                const node    = at.node.nodeType === 3 ? at.node.parentElement : at.node;
                const el      = node?.closest?.('.cm-line');
                if (el) el.animate(
                    [{ backgroundColor: 'rgba(255, 255, 255, 0.24)' }, { backgroundColor: '' }],
                    { duration: 700, easing: 'ease-out' }
                );
            } catch (_) { /* line not in viewport — skip */ }
        }
    });
};

// Context snapshot: current cursor, line text, selection, indent.
const getContext = (view) => {
    const state = view.state;
    const cursorOffset = state.selection.main.head;
    const lineInfo     = state.doc.lineAt(cursorOffset);
    const line         = lineInfo.text;
    const lineNum      = lineInfo.number - 1; // 0-indexed
    const ch           = cursorOffset - lineInfo.from;
    const indent       = line.match(/^(\s*)/)[1].length;
    const structIndent = structuralIndent(state.doc, lineInfo.number);

    const selFrom     = state.selection.main.from;
    const selTo       = state.selection.main.to;
    const selFromLine = state.doc.lineAt(selFrom);
    const selToLine   = state.doc.lineAt(selTo);

    return {
        view,
        cursor: { line: lineNum, ch },
        line,
        indent,
        structIndent,
        selection: {
            from: { line: selFromLine.number - 1, ch: selFrom - selFromLine.from },
            to:   { line: selToLine.number   - 1, ch: selTo   - selToLine.from   },
            text: state.sliceDoc(selFrom, selTo),
        }
    };
};

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

const commands = {
    // undo: delegate to CM6 command from @codemirror/commands
    undo: (view, _instruction, cm6) => cm6.undo(view),

    // Command insertion — replace current line or append a new one.
    cmd: (view, { command: cmd, args = [], batch = true }, cm6) => {
        const { view: v, cursor, line, indent, structIndent } = getContext(view);
        const argText    = formatArgs(args || []);
        const currentCmd = line.trim().split(" ")[0];

        if (currentCmd === cmd && batch) {
            const newText = "".padEnd(indent) + cmd + argText;
            const range = transform(v,
                { from: { line: cursor.line, ch: 0 }, to: { line: cursor.line, ch: line.length } },
                newText);
            flash(v, range, cm6);
        } else if ((currentCmd === "lt" || currentCmd === "rt") && (cmd === "lt" || cmd === "rt") && batch) {
            const newText = "".padEnd(indent) + cmd + argText;
            const range = transform(v,
                { from: { line: cursor.line, ch: 0 }, to: { line: cursor.line, ch: line.length } },
                newText);
            flash(v, range, cm6);
        } else {
            const newText = `\n${"".padEnd(structIndent)}${cmd}${argText}`;
            const range = transform(v, { from: { line: cursor.line, ch: line.length } }, newText);
            flash(v, { from: { line: cursor.line + 1, ch: 0 }, to: range.to }, cm6);
        }
    },

    // Control structure wrapping — wraps selection in do/end block.
    // Full-line intelligent: expands selection to line boundaries and reads
    // lines from the document, so indent handling is pure regardless of
    // where the user's cursor landed during selection.
    ctrl: (view, { control: ctrl, args = [] }, cm6) => {
        const { view: v, selection, structIndent } = getContext(view);
        const { EditorSelection } = cm6;
        const state = v.state;

        const argText = formatArgs(args) || " 1";

        const hasSelection = selection.text.trim().length > 0;
        let lines = [];
        let fullSel = selection;

        if (hasSelection) {
            const fromLine = selection.from.line;
            let toLine = selection.to.line;
            // Selection ending at col 0 means cursor wrapped to next line — exclude it
            if (selection.to.ch === 0 && toLine > fromLine) toLine--;

            // Read full lines from document — not from selection text
            for (let ln = fromLine; ln <= toLine; ln++) {
                const text = state.doc.line(ln + 1).text;
                if (text.trim()) lines.push(text);
            }
            // Expand selection to full line boundaries for clean replacement
            const lastLineInfo = state.doc.line(toLine + 1);
            fullSel = {
                from: { line: fromLine, ch: 0 },
                to:   { line: toLine, ch: lastLineInfo.text.length },
                text: state.sliceDoc(state.doc.line(fromLine + 1).from, lastLineInfo.to),
            };
        }

        // Derive indent from selection context, not cursor position.
        // The selected lines know their own depth — wrapper sits at their
        // outermost level, body nudges in by 2.
        const hasBody = lines.length > 0;
        const baseIndent = hasBody
            ? " ".repeat(Math.min(...lines.map(l => l.match(/^(\s*)/)[1].length)))
            : " ".repeat(structIndent);

        const structure = hasBody
            ? [`${baseIndent}${ctrl}${argText} do`,
               lines.map(l => "  " + l).join('\n'),
               `${baseIndent}end`]
            : [`${baseIndent}${ctrl}${argText} do`,
               `${baseIndent}end`];

        if (ctrl === "def") {
            structure.push(`${argText}`.trim());
        }

        let wrapped = structure.join('\n');
        if (!hasSelection) wrapped = "\n" + wrapped;

        const range = transform(v, fullSel, wrapped);

        if (hasBody) {
            flash(v, range, cm6);
            // Move cursor to end of wrapped body
            const targetLine = range.to.line - (ctrl === "def" ? 2 : 1);
            if (targetLine >= 0) {
                const lineInfo = view.state.doc.line(targetLine + 1);
                const pos = Math.min(lineInfo.from + 100, lineInfo.to);
                view.dispatch({ selection: EditorSelection.cursor(pos) });
            }
        } else {
            // No selection — cursor on the `do` line so next cmd goes inside the block.
            // structuralIndent at the do line yields the inner indent level.
            const doLine = range.from.line + 1; // 0-indexed
            const lineInfo = view.state.doc.line(doLine + 1); // 1-indexed
            view.dispatch({ selection: EditorSelection.cursor(lineInfo.to) });
            flash(v, range, cm6);
        }
        view.focus();
    },
};

// ---------------------------------------------------------------------------
// Argument formatting
// ---------------------------------------------------------------------------

// Pure string builder — args are already resolved values.
// DOM lookup responsibility lives upstream in shell.js.
const formatArgs = (args = []) =>
    args.reduce((acc, arg) => arg ? `${acc} ${arg}` : acc, "");

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const execute = (view, instruction, cm6) => {
    try {
        if (instruction.command === "undo") return commands.undo(view, instruction, cm6);
        if (instruction.command)            return commands.cmd(view, instruction, cm6);
        if (instruction.control)            return commands.ctrl(view, instruction, cm6);
    } catch (error) {
        console.error("Operation failed:", error);
    }
};

export { execute, commands, transform, flash, getContext, structuralIndent };
