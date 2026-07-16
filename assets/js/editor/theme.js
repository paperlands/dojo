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
//
// The literate faces (id:gw-grammar) — meta.lit rendered, never a second store:
//   "comment"    → tags.comment          (inked prose — the margin & the meadow)
//   "lineComment"→ tags.lineComment      (the `#` / `###` markers, dissolving)
//   "heading1..6"→ tags.heading1..6      (`* name` — a chapter, deeper = smaller)
//   "link"       → tags.link             ([[portal]] — a glowing word)
//   "strong"     → tags.strong           (*strong*)
//   "emphasis"   → tags.emphasis         (/lean/)
//   "quote"      → tags.quote            (`| …` — a quotation in another's voice)
//   "monospace"  → tags.monospace        (=code= inline & `> …` snippet — mono +
//                                         faded; rides atop the inner's own
//                                         linting via a compound tag)
//   (no new tag) — a ``` … ``` fenced block is a full code CELL: its lines carry
//                  the ordinary code tags at FULL strength (no monospace fade), so
//                  they render exactly like buffer code. Groundwork for evaluable,
//                  scrollable notebook cells.

// The reading font for inked prose. Code stays mono; prose rides in a book face,
// so a lit line reads as woven — writing beside making — not commented-out code.
const PROSE_FONT = 'ui-serif, Georgia, "Iowan Old Style", "Palatino Linotype", serif';
const CODE_FONT  = '"FiraCode", ui-monospace, monospace';

// The editor's base type size and line rhythm — pinned, not inherited. Without
// this, `.cm-content` falls back to whatever font-size cascades in and a `normal`
// line-height, so the caret height rides FiraCode's compact intrinsic metrics and
// reads short while typing — only heading lines (which set an explicit `em` size)
// looked right. Pinning the floor makes the caret deterministic and lets headings
// scale up from a known base; prose and portals ride it. 1.6 gives the typing
// caret a comfortable reading height.
const BASE_FONT_SIZE   = '16px';
const BASE_LINE_HEIGHT = '1.6';

// Heading type scale — one ~1.2 (minor-third) modular scale over the code base,
// shared by both themes so chapter hierarchy reads consistently: each level ≈1.2×
// the next, moderate enough not to break the editor's line rhythm. `em` here is
// relative to BASE_FONT_SIZE, so the whole scale rises with the pinned floor.
const H1 = '1.58em', H2 = '1.32em', H3 = '1.1em';

// ---------------------------------------------------------------------------
// Abbott — warm dark theme (ported from abbott.vim)
// ---------------------------------------------------------------------------

const abbottDark = ({ EditorView, HighlightStyle, syntaxHighlighting, tags }) => [
    EditorView.theme({
        '&': {
            backgroundColor: 'rgba(35, 28, 20, .1)',  // bistre
            color:           '#48c0a3',                // pastel_chartreuse
            fontFamily:      '"FiraCode", ui-monospace,  monospace',
            fontSize:        BASE_FONT_SIZE,           // pin the floor — caret & prose no longer inherit small
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
            'caret-color': "#a0ea00",
            lineHeight:    BASE_LINE_HEIGHT,           // the line box the caret rides — a comfortable typing height
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
        // Bracket matching (parens, braces, brackets)
        '&.cm-focused .cm-matchingBracket': {
            backgroundColor: 'oklch(0.188 0.0813 315.13 / 0.8)',
            color: 'oklch(0.992 0.015 100)',
            fontWeight:  'bold',
        },
        '.cm-matchingBracket': {
            outline: '1px solid oklch(0.992 0.015 100 / 0.5)',
        },
        '&.cm-focused .cm-nonmatchingBracket': {
            background: '#f80450',
            color:      '#231c14',
        },
        '.cm-nonmatchingBracket': {
            background: '#f80450',
            color:      '#231c14',
        },
        '.cm-matched-block .cm-indent-guide': {
            backgroundImage: 'linear-gradient(to right, oklch(0.992 0.015 100 / 0.6) 1px, transparent 1px)',
        },
        // Code cells (id:gw-grammar): the cursor's cell is live; the rest recede.
        '.cm-cell-inactive': { opacity: '0.38' },                          // inert — dimmed, not evaluated
        '.cm-cell-active':   { backgroundColor: 'rgba(160, 234, 0, 0.05)' }, // the live cell — faint chartreuse

    }, { dark: true }),

    syntaxHighlighting(HighlightStyle.define([
        { tag: tags.keyword,                                        color: '#d80450', fontWeight: 'bold', fontFamily: CODE_FONT }, // crimson
        { tag: tags.number,                                         color: '#D42A04', fontFamily: CODE_FONT },                    // cinnabar
        { tag: [tags.variableName,
                tags.special(tags.variableName),
                tags.definition(tags.variableName),
                tags.standard(tags.name)],                          color: '#D3D05B', fontFamily: CODE_FONT },                    // periwinkle
        { tag: tags.comment,                                        color: '#fbb32f', fontStyle: 'italic', fontFamily: PROSE_FONT }, // inked prose
        { tag: [tags.string, tags.regexp],                          color: '#e6a2f3', fontFamily: CODE_FONT },                    // lavender
        { tag: tags.atom,                                           color: '#fef3b4', fontFamily: CODE_FONT },                    // vanilla_cream
        { tag: [tags.bracket, tags.propertyName],                   color: '#fef3b4', fontFamily: CODE_FONT },
        { tag: tags.operator,                                       fontWeight: 'bold', fontFamily: CODE_FONT },
        { tag: tags.tagName,                                        color: '#d80450', fontWeight: 'bold', fontFamily: CODE_FONT }, // crimson
        { tag: tags.typeName,                                       color: '#24a507', fontFamily: CODE_FONT },                    // forest_green
        { tag: tags.meta,                                           color: '#ec6c99', fontFamily: CODE_FONT },                    // french_pink
        { tag: tags.invalid,                                        color: '#00ff7f', fontFamily: CODE_FONT },                    // seafoam_green
        // The literate faces — the margin dissolves, the chapter rises, the word glows.
        { tag: tags.lineComment,                                    color: 'rgba(251,179,47,0.3)', fontSize: '0.8em' }, // the `#`/`###`/`|`/`>`/`=` markers — dim AND smaller, dissolving
        { tag: tags.heading1,                                       color: '#ffd479', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H1 }, // a chapter
        { tag: tags.heading2,                                       color: '#ffd479', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H2 }, // a section
        { tag: tags.heading3,                                       color: '#ffd479', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H3 }, // a passage
        { tag: tags.heading,                                        color: '#ffd479', fontWeight: 'bold', fontFamily: PROSE_FONT }, // deeper (h4+)
        { tag: tags.strong,                                         color: '#fbb32f', fontWeight: 'bold', fontFamily: PROSE_FONT },
        { tag: tags.emphasis,                                       color: '#fbb32f', fontStyle: 'italic', fontFamily: PROSE_FONT },
        { tag: tags.quote,                                          color: '#c2b280', fontStyle: 'italic', fontFamily: PROSE_FONT }, // another's voice — set-off, recessive flax
        { tag: tags.monospace,                                      fontFamily: CODE_FONT, opacity: '0.6' }, // faded — rides atop the inner's linting
        { tag: tags.link,                                           color: '#e6a2f3', textDecoration: 'underline', textShadow: '0 0 6px rgba(230,162,243,0.7)', fontSize: 'inherit' }, // a glowing word — rides the local text size, never shrinks
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
            fontSize: BASE_FONT_SIZE,                  // pin the floor — caret & prose no longer inherit small
        },
        '.cm-content': {
            lineHeight: BASE_LINE_HEIGHT,              // the line box the caret rides — a comfortable typing height
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
        // Bracket matching (parens, braces, brackets)
        '&.cm-focused .cm-matchingBracket': {
            backgroundColor: 'oklch(92.43% 0.1151 95.75 / 0.8)',
            color: 'oklch(0.088 0.0413 315.13)',
            fontWeight: 'bold',
        },
        '.cm-matchingBracket': {
            outline: '1px solid oklch(0.088 0.0413 315.13 / 0.5)',
        },
        '&.cm-focused .cm-nonmatchingBracket': {
            background: '#f85552',
            color: '#ffffff',
        },
        '.cm-nonmatchingBracket': {
            background: '#f85552',
            color: '#ffffff',
        },
        // Code cells (id:gw-grammar): the cursor's cell is live; the rest recede.
        '.cm-cell-inactive': { opacity: '0.42' },                          // inert — dimmed, not evaluated
        '.cm-cell-active':   { backgroundColor: 'rgba(141, 161, 1, 0.07)' }, // the live cell — faint green
    }, { dark: false }),

    syntaxHighlighting(HighlightStyle.define([
        { tag: tags.keyword,                                        color: '#E34234' },
        { tag: tags.number,                                         color: '#5c6a72' },
        { tag: [tags.variableName,
                tags.special(tags.variableName),
                tags.definition(tags.variableName)],                color: '#8da101' },
        { tag: tags.comment,                                        color: '#C89B40', fontStyle: 'italic', fontFamily: PROSE_FONT }, // inked prose
        { tag: [tags.string, tags.regexp],                          color: '#dfa000' },
        { tag: tags.atom,                                           color: '#df69ba' },
        { tag: [tags.bracket, tags.propertyName],                   color: '#5c6a72' },
        { tag: tags.operator,                                       color: '#f57d26' },
        { tag: tags.tagName,                                        color: '#f57d26' },
        { tag: tags.typeName,                                       color: '#3a94c5' },
        { tag: tags.meta,                                           color: '#35a77c' },
        { tag: tags.invalid,                                        color: '#f85552' },
        // The literate faces — the margin dissolves, the chapter rises, the word glows.
        { tag: tags.lineComment,                                    color: 'rgba(200,155,64,0.35)', fontSize: '0.8em' }, // the `#`/`###`/`|`/`>`/`=` markers — dim AND smaller, dissolving
        { tag: tags.heading1,                                       color: '#8da101', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H1 }, // a chapter
        { tag: tags.heading2,                                       color: '#8da101', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H2 }, // a section
        { tag: tags.heading3,                                       color: '#8da101', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H3 }, // a passage
        { tag: tags.heading,                                        color: '#8da101', fontWeight: 'bold', fontFamily: PROSE_FONT }, // deeper (h4+)
        { tag: tags.strong,                                         color: '#C89B40', fontWeight: 'bold', fontFamily: PROSE_FONT },
        { tag: tags.emphasis,                                       color: '#C89B40', fontStyle: 'italic', fontFamily: PROSE_FONT },
        { tag: tags.quote,                                          color: '#829181', fontStyle: 'italic', fontFamily: PROSE_FONT }, // another's voice — set-off, recessive sage
        { tag: tags.monospace,                                      fontFamily: CODE_FONT, opacity: '0.6' }, // faded — rides atop the inner's linting
        { tag: tags.link,                                           color: '#3a94c5', textDecoration: 'underline', textShadow: '0 0 5px rgba(58,148,197,0.5)', fontSize: 'inherit' }, // a glowing word — rides the local text size, never shrinks
    ])),
];

// ---------------------------------------------------------------------------
// Public map — keyed by the option string used in Terminal.setOption('theme', x)
// ---------------------------------------------------------------------------

export const themes = {
    abbott:     abbottDark,
    everforest: everforestLight,
};
