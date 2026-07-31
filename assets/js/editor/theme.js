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
//   "def"        → tags.definition(tags.variableName)  (the name a `def` opens)
//   "builtin"    → tags.standard(tags.name)
//   "comment"    → tags.comment
//   "string"     → tags.string
//   "bracket"    → tags.bracket
//   "property"   → tags.propertyName
//   "operator"   → tags.operator
//   "tag"        → tags.tagName          (PascalCase identifiers)
//   "type"       → tags.typeName
//   "meta"       → tags.meta
//   "link"       → tags.link
//   "error"      → tags.invalid
// Ruby leftovers (variable-2 / string-2 / atom) never emit from plang — dropped.
//
// The literate faces (id:gw-grammar) — meta.lit rendered, never a second store:
//   "comment"    → tags.comment          (inked prose — the margin & the meadow)
//   "lineComment"→ tags.lineComment      (the `#` / `###` markers, dissolving)
//   "heading1..6"→ tags.heading1..6      (`* name` — a phase, deeper = smaller)
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
// shared by both themes so phase hierarchy reads consistently: each level ≈1.2×
// the next, moderate enough not to break the editor's line rhythm. `em` here is
// relative to BASE_FONT_SIZE, so the whole scale rises with the pinned floor.
const H1 = '1.58em', H2 = '1.32em', H3 = '1.1em';

// ---------------------------------------------------------------------------
// Abbott — warm dark theme (ported from abbott.vim)
//
// Melded with the twilight harmony (paperlands.github.io tailwind.config.js)
// along one warm arc — leaf (145°) → chartreuse → gold → cinnabar → crimson —
// so blood-crimson keywords and leaf-sage text read as two ends of one
// turning leaf, never as complements (teal is banished; crimson's true
// complement). The bistre ground is the arc's desaturated midpoint — soil.
// Creator's laws: keywords keep blood crimson; errors are RED; portals are
// VIOLET (mystery, kin to the hyperlink) — the one deliberate off-arc voice.
// ---------------------------------------------------------------------------

const PHOSPHOR  = 'rgb(240 168 61)';    // glowing amber — error-marker glow
const ERROR_RED = 'oklch(0.63 0.21 25)'; // the error voice — red, the creator's law
const GOLD      = 'rgb(241 219 164)';   // pale gold — tooltip text
const DIM       = 'rgb(93 83 102)';     // violet-grey — tooltip source label

const abbottDark = ({ EditorView, HighlightStyle, syntaxHighlighting, tags }) => [
    EditorView.theme({
        '&': {
            backgroundColor: 'rgba(35, 28, 20, .1)',  // bistre — the soil
            color:           'oklch(0.76 0.10 145)',   // leaf sage — warmed off teal, crimson's complement no more
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
        // The everforest selector shape — `.cm-editor .cm-content` never
        // matches inside theme scoping (the scope class IS the editor).
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#a0ea00' }, // chartreuse
        '.cm-content':  {
            caretColor: '#a0ea00',
            lineHeight: BASE_LINE_HEIGHT,              // the line box the caret rides — a comfortable typing height
        },
        '&.cm-focused .cm-selectionBackground': { background: 'rgba(160, 234, 0, 0.22)' }, // your touch is chartreuse — caret's kin, de-tealed
        '.cm-selectionBackground':              { background: 'rgba(160, 234, 0, 0.22)' },
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
        '.cm-cell-inactive': { opacity: '0.38' },                            // inert — dimmed, not evaluated
        '.cm-cell-kindled':  { backgroundColor: 'rgba(160, 234, 0, 0.05)' }, // the live cell — faint chartreuse

        // THE FRIEND (D025 R6) — violet, from the one `--peer-ink` token that
        // also lights the firefly, so his line and his glyph cannot drift apart.
        // Far from the warm chartreuse of your own light: the one thing it must
        // say at a glance is "someone else".
        //   .cm-peer-line — the friend, on their line. Total: it means the
        //                   same in prose, on bare code, and inside a body.
        //   .cm-peer-cell — their FOCUS: the cell that line kindles. A RIGHT
        //                   rule: the left margin is already spoken for (line
        //                   numbers, folds, the lint spark), and the right is
        //                   where the friend lives — the firefly hangs on that
        //                   same edge, so his marks share one margin.
        '.cm-peer-line': {
            backgroundColor: 'color-mix(in oklab, var(--peer-ink) 16%, transparent)',
            boxShadow: 'inset -1px 0 0 color-mix(in oklab, var(--peer-ink) 50%, transparent)',
        },
        '.cm-peer-cell': {
            boxShadow: 'inset -2px 0 0 color-mix(in oklab, var(--peer-ink) 75%, transparent)',
            backgroundColor: 'color-mix(in oklab, var(--peer-ink) 4%, transparent)',
        },
        // The friend's line is never dimmed away, even when its cell rests.
        '.cm-peer-cell.cm-cell-inactive': { opacity: '0.62' },
        '.cm-peer-line.cm-cell-inactive':  { opacity: '0.85' },

        // Diagnostics ink (id:cmp-first-surface) — an error is a play
        // surface (D020): loud in the ink, spoken in the theme's own ember,
        // never stock lint red. Gutter: ✶ death, ! warning. content only
        // paints on ::before — stock CM6 uses content:url(svg) on the element.
        '.cm-lintRange-error': {
            backgroundImage: 'none',
            textDecoration: 'underline wavy oklch(0.63 0.21 25 / 0.85)',
            textUnderlineOffset: '3px',
            backgroundColor: 'oklch(0.63 0.21 25 / 0.08)',
        },
        '.cm-lint-marker': {
            width: '0.75em',
            height: '1em',
        },
        '.cm-lint-marker-error': {
            content: 'none',
            '&:before': {
                content: '"✶"',
                color: ERROR_RED,
                textShadow: `0 0 6px ${PHOSPHOR}99`,
                fontSize: '10px',
                lineHeight: '1.4',
            },
        },
        '.cm-lint-marker-warning': {
            content: 'none',
            '&:before': {
                content: '"!"',
                color: PHOSPHOR,
                fontWeight: '700',
                fontSize: '10px',
                lineHeight: '1.4',
            },
        },
        '.cm-tooltip': {
            backgroundColor: 'rgb(22 15 27 / 0.96)',
            border: '1px solid rgb(240 168 61 / 0.25)',
            color: GOLD,
        },
        '.cm-diagnostic': {
            padding: '3px 8px',
            fontFamily: CODE_FONT,
            fontSize: '12px',
        },
        '.cm-diagnostic-error': { borderLeft: `2px solid ${ERROR_RED}` },
        '.cm-diagnosticSource': {
            color: DIM,
            fontSize: '10px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
        },

    }, { dark: true }),

    syntaxHighlighting(HighlightStyle.define([
        { tag: tags.keyword,                                        color: '#d80450', fontWeight: 'bold', fontFamily: CODE_FONT }, // crimson
        { tag: tags.number,                                         color: '#D42A04', fontFamily: CODE_FONT },                    // cinnabar
        { tag: [tags.variableName,
                tags.definition(tags.variableName),
                tags.standard(tags.name)],                          color: '#D3D05B', fontFamily: CODE_FONT },                    // periwinkle
        { tag: tags.comment,                                        color: '#fbb32f', fontStyle: 'italic', fontFamily: PROSE_FONT }, // inked prose
        { tag: tags.string,                                         color: '#e6a2f3', fontFamily: CODE_FONT },                    // lavender
        { tag: [tags.bracket, tags.propertyName],                   color: '#fef3b4', fontFamily: CODE_FONT },
        { tag: tags.operator,                                       fontWeight: 'bold', fontFamily: CODE_FONT },
        { tag: tags.tagName,                                        color: '#d80450', fontWeight: 'bold', fontFamily: CODE_FONT }, // crimson
        { tag: tags.typeName,                                       color: 'oklch(0.68 0.14 140)', fontFamily: CODE_FONT },       // forest green, lifted into the band
        { tag: tags.meta,                                           color: '#ec6c99', fontFamily: CODE_FONT },                    // french_pink — the arc's rose end
        { tag: tags.invalid,                                        color: ERROR_RED, fontFamily: CODE_FONT },                    // the error voice — red, the creator's law
        // The literate faces — the margin dissolves, the phase rises, the word glows.
        { tag: tags.lineComment,                                    color: 'rgba(251,179,47,0.3)', fontSize: '0.8em' }, // the `#`/`###`/`|`/`>`/`=` markers — dim AND smaller, dissolving
        { tag: tags.labelName,                                      color: '#fbb32f', fontStyle: 'italic', fontFamily: PROSE_FONT, fontSize: '0.85em', letterSpacing: '0.06em' }, // a cell's NAME on its fence (D024) — the author's word, lit while the ``` dissolves
        { tag: tags.heading1,                                       color: '#ffd479', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H1 }, // a section
        { tag: tags.heading2,                                       color: '#ffd479', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H2 }, // a section
        { tag: tags.heading3,                                       color: '#ffd479', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H3 }, // a passage
        { tag: tags.heading,                                        color: '#ffd479', fontWeight: 'bold', fontFamily: PROSE_FONT }, // deeper (h4+)
        { tag: tags.strong,                                         color: '#fbb32f', fontWeight: 'bold', fontFamily: PROSE_FONT },
        { tag: tags.emphasis,                                       color: '#fbb32f', fontStyle: 'italic', fontFamily: PROSE_FONT },
        { tag: tags.quote,                                          color: '#c2b280', fontStyle: 'italic', fontFamily: PROSE_FONT }, // another's voice — set-off, recessive flax
        { tag: tags.monospace,                                      fontFamily: CODE_FONT, opacity: '0.6' }, // faded — rides atop the inner's linting
        { tag: tags.link,                                           color: '#e6a2f3', textDecoration: 'underline', textShadow: '0 0 6px rgba(230,162,243,0.7)', fontSize: 'inherit' }, // the portal glows violet — mystery, kin to the hyperlink
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
        '.cm-cell-inactive': { opacity: '0.42' },                            // inert — dimmed, not evaluated
        '.cm-cell-kindled':  { backgroundColor: 'rgba(141, 161, 1, 0.07)' }, // the live cell — faint green

        // The friend (D025 R6) — the same `--peer-ink` violet, which the token
        // already deepens for paper, carried in at the weight everforest wants.
        '.cm-peer-line': {
            backgroundColor: 'color-mix(in oklab, var(--peer-ink) 14%, transparent)',
            boxShadow: 'inset 0 -1px 0 color-mix(in oklab, var(--peer-ink) 45%, transparent)',
        },
        '.cm-peer-cell': {
            boxShadow: 'inset -2px 0 0 color-mix(in oklab, var(--peer-ink) 70%, transparent)',
            backgroundColor: 'color-mix(in oklab, var(--peer-ink) 4%, transparent)',
        },
        '.cm-peer-cell.cm-cell-inactive': { opacity: '0.66' },
        '.cm-peer-line.cm-cell-inactive':  { opacity: '0.88' },

        // Diagnostics ink (id:cmp-first-surface) — errors RED, warnings amber
        // (everforest). Same gutter glyphs as dark: ✶ and !.
        '.cm-lintRange-error': {
            backgroundImage: 'none',
            textDecoration: 'underline wavy rgba(248, 85, 82, 0.75)',
            textUnderlineOffset: '3px',
            backgroundColor: 'rgba(248, 85, 82, 0.07)',
        },
        '.cm-lint-marker': {
            width: '0.75em',
            height: '1em',
        },
        '.cm-lint-marker-error': {
            content: 'none',
            '&:before': {
                content: '"✶"',
                color: '#f85552',
                fontSize: '10px',
                lineHeight: '1.4',
            },
        },
        '.cm-lint-marker-warning': {
            content: 'none',
            '&:before': {
                content: '"!"',
                color: '#dfa000',
                fontWeight: '700',
                fontSize: '10px',
                lineHeight: '1.4',
            },
        },
        '.cm-tooltip': {
            backgroundColor: '#fdf6e3',
            border: '1px solid rgb(217 111 55 / 0.35)',
            color: '#5c6a72',
        },
        '.cm-diagnostic': {
            padding: '3px 8px',
            fontFamily: CODE_FONT,
            fontSize: '12px',
        },
        '.cm-diagnostic-error': { borderLeft: '2px solid rgba(248, 85, 82, 0.9)' },
        '.cm-diagnosticSource': {
            color: '#829181',
            fontSize: '10px',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
        },
    }, { dark: false }),

    syntaxHighlighting(HighlightStyle.define([
        { tag: tags.keyword,                                        color: '#E34234' },
        { tag: tags.number,                                         color: '#5c6a72' },
        { tag: [tags.variableName,
                tags.definition(tags.variableName)],                color: '#8da101' },
        { tag: tags.comment,                                        color: '#C89B40', fontStyle: 'italic', fontFamily: PROSE_FONT }, // inked prose
        { tag: tags.string,                                         color: '#dfa000' },
        { tag: [tags.bracket, tags.propertyName],                   color: '#5c6a72' },
        { tag: tags.operator,                                       color: '#f57d26' },
        { tag: tags.tagName,                                        color: '#f57d26' },
        { tag: tags.typeName,                                       color: '#3a94c5' },
        { tag: tags.meta,                                           color: '#35a77c' },
        { tag: tags.invalid,                                        color: '#f85552' },
        // The literate faces — the margin dissolves, the phase rises, the word glows.
        { tag: tags.lineComment,                                    color: 'rgba(200,155,64,0.35)', fontSize: '0.8em' }, // the `#`/`###`/`|`/`>`/`=` markers — dim AND smaller, dissolving
        { tag: tags.labelName,                                      color: '#C89B40', fontStyle: 'italic', fontFamily: PROSE_FONT, fontSize: '0.85em', letterSpacing: '0.06em' }, // a cell's NAME on its fence (D024) — the author's word, lit while the ``` dissolves
        { tag: tags.heading1,                                       color: '#8da101', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H1 }, // a section
        { tag: tags.heading2,                                       color: '#8da101', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H2 }, // a section
        { tag: tags.heading3,                                       color: '#8da101', fontWeight: 'bold', fontFamily: PROSE_FONT, fontSize: H3 }, // a passage
        { tag: tags.heading,                                        color: '#8da101', fontWeight: 'bold', fontFamily: PROSE_FONT }, // deeper (h4+)
        { tag: tags.strong,                                         color: '#C89B40', fontWeight: 'bold', fontFamily: PROSE_FONT },
        { tag: tags.emphasis,                                       color: '#C89B40', fontStyle: 'italic', fontFamily: PROSE_FONT },
        { tag: tags.quote,                                          color: '#829181', fontStyle: 'italic', fontFamily: PROSE_FONT }, // another's voice — set-off, recessive sage
        { tag: tags.monospace,                                      fontFamily: CODE_FONT, opacity: '0.6' }, // faded — rides atop the inner's linting
        { tag: tags.link,                                           color: '#df69ba', textDecoration: 'underline', textShadow: '0 0 5px rgba(223,105,186,0.5)', fontSize: 'inherit' }, // the portal glows violet — mystery, kin to the hyperlink (everforest purple)
    ])),
];

// ---------------------------------------------------------------------------
// Public map — keyed by the option string used in Terminal.setOption('theme', x)
// ---------------------------------------------------------------------------

export const themes = {
    abbott:     abbottDark,
    everforest: everforestLight,
};
