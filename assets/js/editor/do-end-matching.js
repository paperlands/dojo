// do/end pair highlighting — marks matching do and end keywords when the cursor
// rests on either. Uses pure depth counting (same algorithm as a stack-based
// bracket matcher) so nested blocks are handled correctly.
//
// Zero static imports — receives cm6 at call time (same pattern as theme.js).

export const createDoEndMatchingExtension = (cm6) => {
    const { StateField, Decoration, EditorView, RangeSetBuilder } = cm6;

    const matchMark    = Decoration.mark({ class: 'cm-matchingBracket' });
    const nonmatchMark = Decoration.mark({ class: 'cm-nonmatchingBracket' });
    const blockLine    = Decoration.line({ class: 'cm-matched-block' });

    // Return the keyword word under or adjacent to `pos`, or null.
    const keywordAt = (state, pos) => {
        const line   = state.doc.lineAt(pos);
        const text   = line.text;
        const ch     = pos - line.from;
        const isWord = (c) => /[a-zA-Z_]/.test(c ?? '');

        // cursor may be just past the word end — step back one if needed
        let at = (!isWord(text[ch]) && isWord(text[ch - 1])) ? ch - 1 : ch;

        if (!isWord(text[at])) return null;
        let start = at, end = at;
        while (start > 0 && isWord(text[start - 1])) start--;
        while (end < text.length && isWord(text[end])) end++;

        const word = text.slice(start, end);
        if (word !== 'do' && word !== 'end') return null;
        return { word, from: line.from + start, to: line.from + end, lineNum: line.number };
    };

    // Find last occurrence of \bdo\b in lineText; return character offset or -1.
    const lastDoOffset = (lineText) => {
        const re = /\bdo\b/g;
        let pos = -1, m;
        while ((m = re.exec(lineText)) !== null) pos = m.index;
        return pos;
    };

    const compute = (state) => {
        const at = keywordAt(state, state.selection.main.head);
        if (!at) return Decoration.none;
        const { word, from, to, lineNum } = at;
        const lines = state.doc.lines;

        // Keywords that open a new block (must end with `end`)
        const OPENER = /\b(do|if|while|loop|def|when)\b/;

        // Helper: build decorations for a matched do/end pair, including
        // block-line markers on every line between them for indent guide glow.
        const buildMatch = (doFrom, doTo, endFrom, endTo, doLineNum, endLineNum) => {
            const b = new RangeSetBuilder();
            // Decorations must be added in document order.
            // Line decorations go at line.from; marks span the keyword.
            for (let ln = doLineNum; ln <= endLineNum; ln++) {
                const l = state.doc.line(ln);
                b.add(l.from, l.from, blockLine);
                if (ln === doLineNum)  b.add(doFrom, doTo, matchMark);
                if (ln === endLineNum) b.add(endFrom, endTo, matchMark);
            }
            return b.finish();
        };

        if (word === 'do') {
            let depth = 1;
            for (let ln = lineNum + 1; ln <= lines; ln++) {
                const next = state.doc.line(ln);
                const t = next.text.trim();
                if (!t) continue;
                if (OPENER.test(t)) depth++;
                if (/^end\b/.test(t)) {
                    if (--depth === 0) {
                        const endIndent = next.text.search(/\S/);
                        return buildMatch(from, to, next.from + endIndent, next.from + endIndent + 3, lineNum, ln);
                    }
                }
            }
        } else { // 'end'
            let depth = 1;
            for (let ln = lineNum - 1; ln >= 1; ln--) {
                const prev = state.doc.line(ln);
                const t = prev.text.trim();
                if (!t) continue;
                if (/^end\b/.test(t)) depth++;
                if (OPENER.test(t)) {
                    if (--depth === 0) {
                        const doPos = lastDoOffset(prev.text);
                        if (doPos < 0) continue;
                        return buildMatch(prev.from + doPos, prev.from + doPos + 2, from, to, ln, lineNum);
                    }
                }
            }
        }

        // No match found — orphan do/end
        const b = new RangeSetBuilder();
        b.add(from, to, nonmatchMark);
        return b.finish();
    };

    return StateField.define({
        create: (state) => compute(state),
        update: (deco, tr) => (tr.docChanged || tr.selection) ? compute(tr.state) : deco,
        provide: (f) => EditorView.decorations.from(f),
    });
};
