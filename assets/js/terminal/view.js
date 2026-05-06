// EditorView lifecycle — CM6 view operations.
// Stateful by necessity (EditorView is mutable), but isolated.
// Knows nothing about buffers, bridges, tabs, or persistence.

export const createInnerView = (element, cm6, extensions) => {
    const { EditorView, EditorState } = cm6;

    // CM6 cannot target a textarea directly; create a wrapper div alongside.
    const wrapper = document.createElement('div');
    wrapper.style.height = '100%';
    element.parentNode.insertBefore(wrapper, element);
    element.style.display = 'none';

    const view = new EditorView({
        state: EditorState.create({ doc: '', extensions }),
        parent: wrapper,
    });

    return { view, wrapper };
};

export const createOuterView = (element, cm6, extensions) => {
    const { EditorView, EditorState } = cm6;

    const view = new EditorView({
        state: EditorState.create({
            doc: '',
            extensions: [...extensions, EditorState.readOnly.of(true)],
        }),
        parent: element,
    });

    return { view };
};

export const createState = (cm6, doc, extensions) => {
    const { EditorState } = cm6;
    return EditorState.create({ doc, extensions });
};

export const swapState = (view, editorState) => {
    view.setState(editorState);
};

export const getContent = (view) =>
    view?.state.doc.toString() ?? '';

export const setContent = (view, content) => {
    if (!view) return;
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: content },
    });
};

export const updateOuter = (view, code) => {
    if (!view) return;
    const current = view.state.doc.toString();
    if (code === current) return;
    view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
    });
};

export const cursorToEnd = (view, cm6) => {
    const { EditorSelection } = cm6;
    const endPos = view.state.doc.length;
    view.dispatch({ selection: EditorSelection.cursor(endPos) });
};

// Toggle # comments on selected lines — single dispatch for atomic undo.
export const toggleComment = (view) => {
    const state = view.state;
    const changes = [];

    for (const range of state.selection.ranges) {
        const fromLine = state.doc.lineAt(range.from);
        const toLine = state.doc.lineAt(range.to);

        let allCommented = true;
        for (let ln = fromLine.number; ln <= toLine.number; ln++) {
            const text = state.doc.line(ln).text.trim();
            if (text && !text.startsWith('#')) { allCommented = false; break; }
        }

        for (let ln = fromLine.number; ln <= toLine.number; ln++) {
            const line = state.doc.line(ln);
            const text = line.text;
            if (allCommented) {
                changes.push({ from: line.from, to: line.to, insert: text.replace(/^(\s*)#\s?/, '$1') });
            } else {
                const indent = text.match(/^(\s*)/)[1];
                changes.push({ from: line.from, to: line.to, insert: indent + '# ' + text.slice(indent.length) });
            }
        }
    }

    if (changes.length) view.dispatch({ changes });
};

export const destroy = (view, element) => {
    view?.destroy();
    if (element) element.style.display = '';
};
