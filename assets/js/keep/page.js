// The depths the river and the wire walk (id:kb-8-page, id:kb-9, id:ka-reach).
//
// ONE DEPTH PER FOLD — not one depth in the system. kb-8-page's bound is a
// proof about a single fold: local(root, n) is exactly enough to fold
// list(root, n), SAME n on both sides. It says nothing about two folds needing
// one number, and the two here want different ones:
//
//   wire  — local(root, PAGE) ships a page; the remainder rides the next pass.
//           Human cadence; a kill mid-drain leaves the oldest unshared, which
//           is the least costly residue.
//   river — list(root, REACH) folded against local(root, REACH). It filters a
//           page of the WHOLE log down to one work, so it must reach past the
//           author's other rivers or it goes blind (id:ka-ground 4): measured
//           on 41 keeps across 12 works, PAGE=12 showed *nothing* for two
//           works that certainly had keeps.
//
// The depth a river needs is W x n — the author's work count times the seats
// it shows. REACH covers a classroom's W; past that the honest move is the
// by-target range (the door id:ka-reach deferred), never a bigger number.

/** Human handful. A child reads few things well; a drain is a handful. */
export const PAGE = 12

/**
 * How far the river reads to find one work among many (id:ka-reach).
 *
 * Clears W x n for a classroom's W. Not a guess about people — a guess about
 * how many rivers one child keeps at once, and the trigger for replacing it
 * with the by-target door is a measured W where W x n exceeds it.
 */
export const REACH = 300
