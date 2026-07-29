// WOUND VIEW — the sentence a diagnostic says, and nothing else (D022:
// diagnostics are the wounds). queries.js answers the facts; this is the one
// place they become words, so the HUD, a friend's panel, the gutter and a
// crossed-wire reflect all say the SAME sentence about the same wound.
//
// Why a file: `message` used to answer for the parser, the canvas, AND this
// module's own prose, with no way to tell which apart — a reader couldn't,
// and a second surface wanting different wording had nowhere to stand. Facts
// on one side (the query), words on the other (here); the seam is `describe`.
//
// Decides nothing: a choice about which wound matters belongs in the query.

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

// WHAT HURT, in words. A wound with its own `message` speaks it verbatim
// (the parser's or the canvas's own words, never rewritten); otherwise this
// composes the sentence from the facts, keyed by `kind`.
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
