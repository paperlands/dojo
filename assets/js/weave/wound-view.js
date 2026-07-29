// WOUND VIEW — the sentence a diagnostic says, and nothing else.
//
// The query layer (weave/queries.js) answers FACTS: what hurt, where it lives,
// which fault the document speaks of. It authors no prose. This module is the
// one place those facts become words, so every surface that shows a wound —
// the core HUD, a friend's panel, the editor's gutter, the reflect that crosses
// the wire — says the SAME sentence about the same wound.
//
// Why the split is worth a file. The two lived together and the query grew a
// duty it could not name: a `message` field that was sometimes the parser's own
// words, sometimes the canvas's, and sometimes a sentence the query had written
// itself. A reader could not tell which, and a second surface wanting a
// different rendering had nowhere to stand. Facts on one side, words on the
// other, and the seam is `describe`.
//
// Nothing here decides anything. If a function in this file has to choose which
// wound matters or whether the document is well, it belongs in the query.

// WHERE IT HURTS, in the author's own outline — the phase whose sisters it
// stands among, her name for the cell when she gave one (D024), then the line.
// Takes a wound, never null: every caller has already chosen one.
export const placeOf = (w) => [
    [...(w.phase ?? []), w.cellName].filter(Boolean).join(" › ") || null,
    w.span?.line ? `line ${w.span.line}` : null,
].filter(Boolean).join(" · ")

// WHO IS SPEAKING — the attribution a reader sees beside the words (the lint
// gutter's `source`). Her own outline, never the machine's name: the frame's
// display name when the wound came from one, else her word for the cell, else
// the phase it stands in. null only where there is genuinely no outline — bare
// code in a plain tab — and the caller says what to call the world then.
export const sourceOf = (w) =>
    w?.source ?? w?.cellName ?? w?.phase?.[w.phase.length - 1] ?? null

// WHAT HURT, in words. A wound either carries a message it was GIVEN — the
// parser's, or the canvas's, quoted verbatim and never rewritten — or it carries
// the facts for one and this says it. The `kind` is what tells them apart.
export const describe = (w) => {
    if (w?.message != null) return w.message
    switch (w?.kind) {
    case "name":
        return w.why === "place"
            ? `"${w.word}" is a place, not a name — this cell answers to ${w.answersTo}`
            : `two cells are named "${w.word}" — this one answers to ${w.answersTo}`
    case "dependent":
        return `depends on ${w.standsOn}, which did not run`
    default:
        return ""
    }
}

// The whole sentence — where it hurts, then what hurt. The one line every nerve
// pushes and the one the reflect carries across the wire. The dash is load-
// bearing: without it a placed wound reads "line 4 boom", two facts run together.
export const sayWound = (w) => {
    const place = placeOf(w)
    const said = describe(w)
    return place ? `${place} — ${said}` : said
}
