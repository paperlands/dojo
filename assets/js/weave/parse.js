// weave/parse.js — THE PRESS (Shoot 0, id:gw-play; the table at id:gw-grammar).
//
// Org is the press-side face of a fragment; the living buffer is literate
// PaperLang. This module IS the mechanical table between them: org text in,
// literate PaperLang text out. The output is a buffer — fork the page and you
// hold its source — and turtling/parse.js's parseProgram is the ONE parser
// that turns it into the AST-with-lit that weave/page.js renders. Text → text,
// pure: no DOM, no fetch, no cache, no second grammar (id:gw-t-substrate —
// the repo is the press, the browser is the reader).
//
// The table (id:gw-grammar "The transpile is the press"):
//
//   org (the press)                  literate PaperLang (the living buffer)
//   -------------------------------  --------------------------------------
//   * / ** / … Headline              * / ** name — inside the meadow   [⊗ Q3 naming law]
//                                    D019: the outline is the ambient tree —
//                                    a headline also SCOPES: cells under it
//                                    inherit the chapter's rehearsed
//                                    namespace (sectionCells ⊗ drainNamespace),
//                                    down the outline, never sideways
//   prose paragraph                  meadow text (### … ###)
//   #+BEGIN_QUOTE … #+END_QUOTE      | line — the bar (id:gw-cell), one per line
//   #+BEGIN_SRC paperlang … #+END    ``` cell INSIDE the meadow (id:gw-cell) —
//                                    code re-entering code-space: full-strength
//                                    linting, cursor-gated, foldable. The
//                                    sibling-ambient split (Shoot 1) is derived
//                                    from the AST downstream (splitCells) —
//                                    the press emits ONE representation
//   [[id:frag-x]] / [[id:frag-x][w]] [[frag-x]] — the id: scheme stripped,
//                                    NOTHING more: the press knows one file and
//                                    never guesses a foreign name. id → name is
//                                    the resolver's work (weave/resolve.js);
//                                    the renderer displays the resolved name
//   =code= / *bold* / /lean/         verbatim — render sugar, same both sides
//   :PROPERTIES: drawer, #+keyword   dropped (the machine's share) — except
//                                    :ID: and #+title, harvested once
//
// Adjacent prose blocks share one meadow, and a src block no longer closes it:
// the cell rides INSIDE the meadow as ``` … ``` — the pressed page is one
// clearing with figures standing in it, never a fence per line.

// Strip the id: scheme from portal targets; description half, if any, rides.
//   [[id:frag-x]]       → [[frag-x]]
//   [[id:frag-x][word]] → [[frag-x][word]]
//   [[name]]            → unchanged
function rewritePortals(text) {
    return text.replace(
        /\[\[id:([^\]\[]+)\](\[[^\]]*\])?\]/g,
        (_, id, desc) => `[[${id}]${desc || ''}]`,
    )
}

function headlineText(line) {
    const m = line.match(/^\*+\s+(.*)$/)
    return m ? m[1].replace(/\s*\*+\s*$/, '').trim() : null
}

// Org title-style decoration: `* SPIRALS *` → `* SPIRALS`. Trailing stars
// after whitespace are the press's book-title flourish, not content — fold
// them so the meadow headline and the page <h1> speak the same word.
function foldHeadline(line) {
    if (!/^\*+\s/.test(line)) return line
    return line.replace(/\s+\*+\s*$/, '')
}

// Press a fragment's org source into its literate buffer.
//   transpile(orgText) → { id, title, source }
//     id     — the top node's :ID: ("frag-spiral"); null when absent
//     title  — #+title, else the top headline text — the page's display word
//     source — literate PaperLang, ready for parseProgram or a forked tab.
//              The ``` cells ride INSIDE it; the sibling-ambient split is
//              DERIVED downstream from the one AST (turtling/parse.js
//              splitCells), never emitted as a second representation here.
export function transpile(orgText) {
    const lines = String(orgText ?? '').split(/\r\n|\r|\n/)
    let id = null
    let title = null
    let topHeadline = null
    // body | drawer | quote | src
    let mode = 'body'
    const prose = []
    const out = []

    const flushProse = () => {
        // Trim leading/trailing blanks so fences hug the ink, but keep
        // internal paragraph breaks — a meadow is a place.
        while (prose.length && prose[0] === '') prose.shift()
        while (prose.length && prose[prose.length - 1] === '') prose.pop()
        if (!prose.length) return
        out.push('###')
        for (const p of prose) out.push(p)
        out.push('###')
        prose.length = 0
    }

    for (const raw of lines) {
        const trimmed = raw.trim()

        if (mode === 'drawer') {
            if (/^:END:\s*$/i.test(trimmed)) {
                mode = 'body'
                continue
            }
            if (id == null) {
                const m = trimmed.match(/^:ID:\s*(.+)$/i)
                if (m) id = m[1].trim()
            }
            continue
        }

        if (mode === 'quote') {
            if (/^#\+END_QUOTE/i.test(trimmed)) {
                mode = 'body'
                continue
            }
            // One bar per line; empty quote lines stay as bare bars.
            prose.push(trimmed === '' ? '|' : `| ${rewritePortals(trimmed)}`)
            continue
        }

        if (mode === 'src') {
            if (/^#\+END_SRC/i.test(trimmed)) {
                prose.push('```')
                mode = 'body'
                continue
            }
            // Cell code — indent preserved so the child's buffer matches the
            // author's; the line rides the meadow, inside its ``` fences.
            prose.push(raw.replace(/\s+$/, ''))
            continue
        }

        // ── body ──────────────────────────────────────────────────────────
        if (/^:PROPERTIES:\s*$/i.test(trimmed)) {
            mode = 'drawer'
            continue
        }
        if (/^#\+BEGIN_QUOTE/i.test(trimmed)) {
            mode = 'quote'
            continue
        }
        if (/^#\+BEGIN_SRC\b/i.test(trimmed)) {
            // The cell opens INSIDE the meadow — the fence flips back locally
            // (id:gw-cell); the meadow does not close around it.
            prose.push('```')
            mode = 'src'
            continue
        }
        if (/^#\+/i.test(trimmed)) {
            const m = trimmed.match(/^#\+title:\s*(.+)$/i)
            if (m && title == null) title = m[1].trim()
            // All other #+keywords are the machine's share — dropped.
            continue
        }
        // Org comment lines (# …) — not the margin; drop.
        if (/^#(?:\s|$)/.test(trimmed)) continue

        if (trimmed === '') {
            // Paragraph break inside a gathering meadow; ignore leading blanks.
            if (prose.length) prose.push('')
            continue
        }

        if (topHeadline == null && /^\*+\s/.test(trimmed)) {
            topHeadline = headlineText(trimmed)
        }

        // Headlines and prose share the meadow; portals rewritten in place.
        // Fold org star-decoration on headlines so `* SPIRALS *` does not
        // ride a trailing star into the living buffer / page heading.
        const ink = /^\*+\s/.test(trimmed)
            ? foldHeadline(rewritePortals(trimmed))
            : rewritePortals(trimmed)
        prose.push(ink)
    }

    // Auto-close any open fence-like mode at EOF (src/quote without END).
    if (mode === 'src') prose.push('```')
    flushProse()

    return {
        id,
        title: title ?? topHeadline,
        source: out.join('\n'),
    }
}
