// The page both the river and the wire walk (id:kb-8-page, id:kb-9).
//
// One depth, two callers:
//   river  — list(root, PAGE) fold against local(root, PAGE)
//   wire   — local(root, PAGE) ships a page; remainder rides the next pass
//
// Newest-first at the door. The rest of the log is not lost: it waits for
// the next fold (UI) or the next announce page (wire). Not a second sync
// protocol — the same pagination idea at two seats.

/** Human handful. A child reads few things well; a drain is a handful. */
export const PAGE = 12
