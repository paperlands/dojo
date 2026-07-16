// weave/ladder.js — THE DEGREE LADDER (Shoot 1, id:gw-appearance).
//
// Appearance in DEGREE is a recency order with a capacity: the key just
// visited is KINDLED (order[0] — bright, running), the ones behind it are
// WARM (dimmed, waiting), and past the capacity a key is EVICTED — it leaves
// the canvas. One pure transition; the surface performs the consequences
// (mount entered, dim the warm, remove the evicted). The canvas's window of
// two is capacity 2; the editor's one-active-cell law is the same relation
// at capacity 1; the hearth's twelve steps are its cousin at 12.
//
// Pure and import-light (the focus.js extraction law): no DOM, no turtle —
// testable headlessly, shared by any surface that seats degree.

// visit(order, key, capacity) → { order, entered, evicted }
//   order   — recency list, kindled first; treat as immutable (a fresh array
//             is returned on change; the same array on a memo hit).
//   entered — key newly present (the surface mounts it), else null.
//   evicted — key pushed past the capacity (the surface removes it), else null.
export function visit(order, key, capacity = 2) {
    if (order[0] === key) return { order, entered: null, evicted: null }
    const next = [key, ...order.filter((k) => k !== key)]
    const entered = order.includes(key) ? null : key
    const evicted = next.length > capacity ? next.pop() : null
    return { order: next, entered, evicted }
}
