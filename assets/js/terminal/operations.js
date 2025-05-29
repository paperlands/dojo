// Core primitive: text transformation with history control
const transform = (doc, range, text, origin = null) => {
    doc.replaceRange(text, range.from, range.to || range.from, origin);
    return { from: range.from, to: doc.posFromIndex(doc.indexFromPos(range.from) + text.length) };
};

// Core primitive: visual feedback
const flash = (doc, range, duration = 1500) => {
    try {
        const marker = doc.markText(range.from, range.to, { className: 'flash-highlight' });
        setTimeout(() => marker.clear(), duration);
    } catch (e) { /* ignore */ }
};

// Core primitive: context extraction
const getContext = (shell) => {
    const doc = shell.getDoc();
    const cursor = doc.getCursor();
    const line = doc.getLine(cursor.line) || "";
    const token = shell.getTokenAt(cursor);
    const indent = token?.state?.indented || 0;

    return { doc, cursor, line, indent,
             selection: { from: doc.getCursor('from'), to: doc.getCursor('to'), text: doc.getSelection() }
           };
};

//  a command registry
const commands = {
    undo: (shell) => shell.undo(),

    // Command insertion with replacement logic and proper history grouping
    cmd: (shell, { command: cmd, args = [] , batch = true}) => {
        const { doc, cursor, line, indent } = getContext(shell);
        const argText = formatArgs(cmd, args);
        const currentCmd = line.trim().split(" ")[0];

        if (currentCmd === cmd && batch) {
            // Replace current line - use atomic origin for single undo event
            const newText = "".padEnd(indent) + cmd + argText;
            const range = transform(doc,
                                    { from: { line: cursor.line, ch: 0 }, to: { line: cursor.line, ch: line.length } },
                                    newText,
                                    "*replace-" + cmd // Atomic operation - groups with other *replace-cmd operations
                                   );
            flash(doc, range);
        }
        else if ((currentCmd === "lt" || currentCmd === "rt") && (cmd === "lt" || cmd ==="rt") && batch) {
            const newText = "".padEnd(indent) + cmd + argText;
            const range = transform(doc,
                                    { from: { line: cursor.line, ch: 0 }, to: { line: cursor.line, ch: line.length } },
                                    newText,
                                    "*replace-rotate" // Atomic operation - groups with other *replace-cmd operations
                                   );
            flash(doc, range);
        }

        else {
            // Append new line - default undo behavior
            const newText = `\n${"".padEnd(indent)}${cmd}${argText}`;
            const range = transform(doc, { from: { line: cursor.line, ch: line.length } }, newText, "*replace-" + cmd);
            flash(doc, { from: { line: cursor.line + 1, ch: 0 }, to: range.to });
        }
    },

    // Control structure wrapping - atomic operation
    ctrl: (shell, { control: ctrl, args = [] }) => {
        const { doc, selection, indent } = getContext(shell);
        if (!selection.text.trim()) return;

        const argText = formatArgs(ctrl, args) || " 1";
        const baseIndent = " ".repeat(indent);
        const innerIndent = " ".repeat(indent + 2);

        const wrapped = [
            `${baseIndent}${ctrl}${argText} do`,
            selection.text.split('\n').map(l => l.trim() ? `${innerIndent}${l.trim()}` : l).join('\n'),
            `${baseIndent}end`
        ].join('\n');

        const range = transform(doc, selection, wrapped, "*wrap-ctrl"); // Atomic wrap operation
        flash(doc, range);
    }
};

// Argument formatting - simple and extensible
const formatArgs = (cmd, args) =>
      args.reduce((acc, arg) => {
          if(Number.isInteger(arg)) return arg ? `${acc} ${arg}` : acc
          const el = document.getElementById(`cmdparam-${cmd}-${arg}`);
          const val = el?.value || el?.defaulted || arg || "";
          return val ? `${acc} ${val}` : acc;
      }, "");

// The entire public API
const execute = (shell, instruction) => {
    try {
        if (instruction.command === "undo") return commands.undo(shell);
        if (instruction.command) return commands.cmd(shell, instruction);
        if (instruction.control) return commands.ctrl(shell, instruction);
    } catch (error) {
        console.error("Operation failed:", error);
    }
};

// Usage
// execute(shell, { command: "move", args: ["forward"] });
// execute(shell, { control: "repeat", args: ["3"] });
// execute(shell, { command: "undo" });

export { execute, commands, transform, flash, getContext };
