// CM6 theme factories for Dojo — abbott (dark) and everforest (light).
//
// Architecture:
//   - Zero static imports — all CM6 APIs injected at call time via the cm6 module
//     object (same pattern as plang-mode.js). This avoids any static dependency on
//     the dynamically-imported vendor bundle.
//   - Each factory receives { EditorView, HighlightStyle, syntaxHighlighting, tags }
//     and returns an extension array for themeCompartment.reconfigure().
//
// CM5 → Lezer tag mapping (StreamLanguage.define maps CM5 token names):
//   "keyword"    → tags.keyword          (plang commands: fw, rt, lt, draw, def…)
//   "number"     → tags.number
//   "variable"   → tags.variableName
//   "variable-2" → tags.special(tags.variableName)
//   "def"        → tags.definition(tags.variableName)
//   "builtin"    → tags.standard(tags.name)
//   "comment"    → tags.comment
//   "string"     → tags.string
//   "string-2"   → tags.regexp
//   "atom"       → tags.atom
//   "bracket"    → tags.bracket
//   "property"   → tags.propertyName
//   "operator"   → tags.operator
//   "tag"        → tags.tagName          (PascalCase identifiers)
//   "type"       → tags.typeName
//   "meta"       → tags.meta
//   "link"       → tags.link
//   "error"      → tags.invalid

// ---------------------------------------------------------------------------
// Abbott — warm dark theme (ported from abbott.vim)
// ---------------------------------------------------------------------------

const abbottDark = ({ EditorView, HighlightStyle, syntaxHighlighting, tags }) => [
    EditorView.theme({
        '&': {
            backgroundColor: 'rgba(35, 28, 20, .1)',  // bistre
            color:           '#48c0a3',                // pastel_chartreuse
            fontFamily:      '"FiraCode", ui-monospace,  monospace',
        },
        // Indent guide marks — drawn by createIndentGuidesExtension on leading whitespace
        '.cm-indent-guide': {
            backgroundImage: 'linear-gradient(to right, rgba(251,179,47,0.42) 1px, transparent 1px)',
        },
        '.cm-gutters': {
            backgroundColor: 'rgba(35, 28, 20, .1)',
            border:          'none',
        },
        '.cm-lineNumbers .cm-gutterElement': { color: '#FF9933' },     // brand saffron
        '.cm-cursor':        { color: '#a0ea00' }, // chartreuse
        '.cm-editor .cm-content':  {
            'caret-color': "#a0ea00"
        },
        '&.cm-focused .cm-selectionBackground': { background: 'rgba(0, 197, 90, 0.4)' },
        '.cm-selectionBackground':              { background: 'rgba(0, 197, 90, 0.4)' },
        '.cm-activeLine':      { backgroundColor: 'rgba(60, 48, 34, 0.3)' }, // chocolate, semi-transparent so guides show
        '.cm-activeLineGutter':{ backgroundColor: '#3c3022' },
        '.cm-widgetBuffer': { color: '#fbb32f' },                   // marigold
        // Fold gutter markers: ▾ open, ▸ closed — brand saffron
        '.cm-foldGutter .cm-gutterElement span': {
            cursor:     'pointer',
            fontSize:   '16px',
            color:      '#FF9933',
            marginLeft: '-1px',
            lineHeight: '1.4',
            display:    'block',
        },
        // Fold placeholder: show ❦ (floral heart) instead of default "…"
        '.cm-foldPlaceholder': {
            fontSize:      '0',
            background:    'transparent',
            border:        'none',
            padding:       '0 2px',
            cursor:        'pointer',
            verticalAlign: 'middle',
        },
        '.cm-foldPlaceholder::after': {
            content:    '"❦"',
            fontSize:   '12px',
            lineHeight: '0.3',
            color:      '#fbb32f',
            cursor:     'pointer',
        },
        '&.cm-focused .cm-matchingBracket': {
            backgroundColor: '#24a507',
            color: '#fef3b4',
            fontWeight:  'bold',
        },
        // optional: style when editor is not focused
        '.cm-matchingBracket': {
            // background:  '',
     
            outline: '1px solid #2a9153',
            
        },
        '&.cm-focused .cm-nonmatchingBracket': {
            
            color:      '#ff0000 !important',
        },
        '.cm-nonmatchingBracket': {
            background: '#f80450',
            color:      '#231c14',
        },
    }, { dark: true }),

    syntaxHighlighting(HighlightStyle.define([
        { tag: tags.keyword,                                        color: '#d80450', fontWeight: 'bold' }, // crimson
        { tag: tags.number,                                         color: '#D42A04' },                    // cinnabar
        { tag: [tags.variableName,
                tags.special(tags.variableName),
                tags.definition(tags.variableName),
                tags.standard(tags.name)],                          color: '#D3D05B' },                    // periwinkle
        { tag: tags.comment,                                        color: '#fbb32f', fontStyle: 'italic' }, // marigold
        { tag: [tags.string, tags.regexp],                          color: '#e6a2f3' },                    // lavender
        { tag: tags.atom,                                           color: '#fef3b4' },                    // vanilla_cream
        { tag: [tags.bracket, tags.propertyName],                   color: '#fef3b4' },
        { tag: tags.operator,                                       fontWeight: 'bold' },
        { tag: tags.tagName,                                        color: '#d80450', fontWeight: 'bold' }, // crimson
        { tag: tags.typeName,                                       color: '#24a507' },                    // forest_green
        { tag: tags.meta,                                           color: '#ec6c99' },                    // french_pink
        { tag: tags.link,                                           color: '#e6a2f3' },                    // lavender
        { tag: tags.invalid,                                        color: '#00ff7f' },                    // seafoam_green
    ])),
];

// ---------------------------------------------------------------------------
// Everforest — light theme (ported from everforest.css)
// ---------------------------------------------------------------------------

const everforestLight = ({ EditorView, HighlightStyle, syntaxHighlighting, tags }) => [
    EditorView.theme({
        '&': {
            backgroundColor: 'rgba(253, 246, 227, .1)',
            color: '#5c6a72',
            fontFamily: '"FiraCode", monospace',
        },
        // Indent guide marks — drawn by createIndentGuidesExtension on leading whitespace
        '.cm-indent-guide': {
            backgroundImage: 'linear-gradient(to right, rgba(141,161,1,0.38) 1px, transparent 1px)',
        },
        '.cm-gutters': {
            backgroundColor: 'rgba(253, 246, 227, .1)',
            border: 'none',
        },
        '.cm-lineNumbers .cm-gutterElement': { color: 'rgba(164, 173, 158, 0.63)' },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#5c6a72' },
        '&.cm-focused .cm-selectionBackground': { background: 'rgba(230, 226, 204, 0.63)' },
        '.cm-selectionBackground': { background: 'rgba(230, 226, 204, 0.63)' },
        '.cm-activeLine': { backgroundColor: 'rgba(239, 235, 212, 0.44)' },
        '.cm-activeLineGutter': { backgroundColor: 'rgba(239, 235, 212, 0.44)' },
        // Fold gutter markers: sage green for light theme
        '.cm-foldGutter .cm-gutterElement span': {
            cursor: 'pointer',
            fontSize: '16px',
            color: '#8da101',
            marginLeft: '-1px',
            lineHeight: '1.4',
            display: 'block',
        },
        // Fold placeholder: ❦ in amber with sage shadow for light theme
        '.cm-foldPlaceholder': {
            fontSize: '0',
            background: 'transparent',
            border: 'none',
            padding: '0 2px',
            cursor: 'pointer',
            verticalAlign: 'middle',
        },
        '.cm-foldPlaceholder::after': {
            content: '"❦"',
            fontSize: '12px',
            lineHeight: '0.3',
            color: '#C89B40',
            cursor: 'pointer',
        },
        '&.cm-focused .cm-matchingBracket': {
            background: 'rgba(50, 50, 50, 0.7)',
        },
        '.cm-matchingBracket': {
            background: '',
            color: '#a0ea00 !important',
            fontWeight: 'bold',
            outline: '1px solid #a0ea00',
        },
        '&.cm-focused .cm-nonmatchingBracket': {
            background: 'rgba(250, 250, 250, 0.8)',
            color: '#ff0000 !important',
        },
        '.cm-nonmatchingBracket': {
            background: '#f85552',
            color: '#ffffff !important',
            
        },
    }, { dark: false }),

    syntaxHighlighting(HighlightStyle.define([
        { tag: tags.keyword,                                        color: '#E34234' },
        { tag: tags.number,                                         color: '#5c6a72' },
        { tag: [tags.variableName,
                tags.special(tags.variableName),
                tags.definition(tags.variableName)],                color: '#8da101' },
        { tag: tags.comment,                                        color: '#C89B40', fontStyle: 'italic' },
        { tag: [tags.string, tags.regexp],                          color: '#dfa000' },
        { tag: tags.atom,                                           color: '#df69ba' },
        { tag: [tags.bracket, tags.propertyName],                   color: '#5c6a72' },
        { tag: tags.operator,                                       color: '#f57d26' },
        { tag: tags.tagName,                                        color: '#f57d26' },
        { tag: tags.typeName,                                       color: '#3a94c5' },
        { tag: tags.meta,                                           color: '#35a77c' },
        { tag: tags.link,                                           color: '#3a94c5', textDecoration: 'underline' },
        { tag: tags.invalid,                                        color: '#f85552' },
    ])),
];

// ---------------------------------------------------------------------------
// Public map — keyed by the option string used in Terminal.setOption('theme', x)
// ---------------------------------------------------------------------------

export const themes = {
    abbott:     abbottDark,
    everforest: everforestLight,
};
