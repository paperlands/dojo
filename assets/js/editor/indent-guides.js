// Indent guide decorations — vertical golden lines in leading whitespace of
// indented blocks (do/end, def/end). Marks the first character of each
// indent level so CSS can draw a thin vertical line there.
//
// Zero static imports — receives cm6 module object at call time (same
// pattern as plang-mode.js and theme.js).

const INDENT_SIZE = 2; // PaperLang uses 2-space indentation

export const createIndentGuidesExtension = (cm6) => {
    const { ViewPlugin, RangeSetBuilder, Decoration } = cm6;

    const guideMark = Decoration.mark({ class: 'cm-indent-guide' });

    const scan = (view) => {
        const builder = new RangeSetBuilder();
        const { from, to } = view.viewport;
        const state = view.state;

        for (let pos = from; pos <= to;) {
            const line = state.doc.lineAt(pos);
            const text = line.text;

            // Count leading spaces only (PaperLang uses spaces, not tabs)
            let indent = 0;
            while (indent < text.length && text[indent] === ' ') indent++;

            // Only mark non-blank indented lines — blank lines and
            // lines at column 0 get no guides (guides are "between blocks").
            if (indent > 0 && indent < text.length) {
                const levels = Math.floor(indent / INDENT_SIZE);
                for (let level = 0; level < levels; level++) {
                    const guidePos = line.from + level * INDENT_SIZE;
                    builder.add(guidePos, guidePos + 1, guideMark);
                }
            }

            pos = line.to + 1;
        }

        return builder.finish();
    };

    return ViewPlugin.fromClass(
        class {
            constructor(view) { this.decorations = scan(view); }
            update(update) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = scan(update.view);
                }
            }
        },
        { decorations: (v) => v.decorations }
    );
};
