// THE ONE SHAPE A HURT ARRIVES IN — a wound that stopped a pass, a notice beside a
// figure that still draws, a line that did not parse. Minted here so the five places
// that report one cannot disagree about its fields.
//
// Two readers, deliberately elsewhere:
//   weave/queries.js    names the KINDS and judges their SEVERITY — the one home,
//                       because two tables that must agree is a place they can disagree.
//   weave/wound-view.js says the sentence — quoting a message, or composing one.
//
// So a report carries FACTS and no verdict: no severity of its own (that would be a
// second home), only where it happened and what kind of hurt it is.
export const report = ({ kind, message = null, span = null, expr = null }) =>
    ({ kind, message, span, expr })

// The wire form: a report that is SAID rather than fatal — it rides a frame's channel
// and stands in its notice list. A malformed line and a refused measure are the same
// kind of thing to a reader.
export const notice = (fields) => ({ type: "notice", ...report(fields) })
