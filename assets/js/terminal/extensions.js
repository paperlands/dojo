// CM6 extension array builder.
// Pure factory — receives CM6 module + callback channels.
// Returns { extensions, compartments }. Does NOT capture any external `this`.

import { createPlangExtensions } from "../editor/plang-mode.js"
import { createIndentGuidesExtension } from "../editor/indent-guides.js"
import { createDoEndMatchingExtension } from "../editor/do-end-matching.js"

export const buildExtensions = (cm6, {
    onDocChange,
    onSelectionChange,
    onSwitchNext,
    onSwitchPrev,
    onToggleComment,
} = {}) => {
    const {
        EditorView,
        EditorSelection,
        keymap,
        lineNumbers,
        highlightActiveLine,
        foldGutter,
        bracketMatching,
        history,
        defaultKeymap,
        historyKeymap,
        indentWithTab,
        indentOnInput,
        Compartment,
        syntaxHighlighting,
        defaultHighlightStyle,
        gutter,
    } = cm6;

    const themeCompartment = new Compartment();
    const langCompartment = new Compartment();
    const mergeCompartment = new Compartment();

    const extensions = [
        // Layout: editor fills container, scroller handles overflow
        EditorView.theme({
            '&': { height: '100%' },
            '.cm-scroller': { overflow: 'auto' },
        }),

        lineNumbers(),
        highlightActiveLine(),
        foldGutter({ openText: '▾', closedText: '▸' }),
        bracketMatching(),
        indentOnInput(),
        history(),
        EditorView.lineWrapping,
        // Reserve bottom margin so cursor doesn't sit flush against mobile keyboard edge
        EditorView.scrollMargins.of(() => ({ bottom: 32 })),

        // Mobile: keyboard opens on focus — nudge a space in/out to trigger
        // CM6's natural scroll-to-cursor (the only thing that actually works)
        EditorView.domEventHandlers({
            focus: (event, view) => {
                setTimeout(() => {
                    if (!view.hasFocus) return;
                    const end = view.state.doc.length;
                    view.dispatch({ changes: { from: end, insert: ' ' }, scrollIntoView: true });
                    view.dispatch({ changes: { from: end, to: end + 1, insert: '' } });
                }, 100);
                return false;
            },
        }),

        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),

        // Gutter mousedown → select whole line
        gutter({
            domEventHandlers: {
                mousedown: (view, line) => {
                    view.dispatch({ selection: EditorSelection.range(line.from, line.to) });
                    view.focus();
                    return true;
                }
            }
        }),

        // Keyboard shortcuts — dispatched via callbacks, not `this`
        keymap.of([
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
            { key: 'Ctrl-/', run: (view) => { onToggleComment?.(view); return true; } },
            { key: 'Ctrl-.', run: () => { onSwitchNext?.(); return true; } },
            { key: 'Ctrl-,', run: () => { onSwitchPrev?.(); return true; } },
        ]),

        // Doc change → three separate effects wired by the coordinator
        EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                onDocChange?.(update.state.doc.toString());
            }
        }),

        // Selection change → single callback channel
        EditorView.updateListener.of((update) => {
            if (update.selectionSet) {
                onSelectionChange?.(update.state.selection);
            }
        }),

        // Mobile: suppress autocorrect/autocapitalize
        EditorView.contentAttributes.of({
            autocorrect: 'off',
            autocapitalize: 'none',
            spellcheck: 'false',
        }),

        // Visual aids
        createIndentGuidesExtension(cm6),
        createDoEndMatchingExtension(cm6),

        // Compartment slots — reconfigured live by the coordinator
        themeCompartment.of([]),
        langCompartment.of([]),
        mergeCompartment.of([]),
    ];

    const compartments = { theme: themeCompartment, lang: langCompartment, merge: mergeCompartment };

    return { extensions, compartments };
};

// Re-apply compartment values after setState() resets them.
// Isolated here so the coordinator doesn't need to know about plang imports.
export const reapplyCompartments = (view, compartments, cm6, themeKey, themes) => {
    const effects = [
        compartments.lang.reconfigure(createPlangExtensions(cm6)),
    ];
    if (themeKey && themes[themeKey]) {
        effects.push(compartments.theme.reconfigure(themes[themeKey](cm6)));
    }
    view.dispatch({ effects });
};
