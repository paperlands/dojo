// weave/ladder.js — THE DEGREE LADDER (Shoot 1, id:gw-appearance).
//
// Appearance in DEGREE is a recency order with a capacity: the key just
// visited is KINDLED (order[0] — bright, running), the ones behind it are
// WARM (dimmed, waiting), and past the capacity a key is EVICTED — it leaves
// the canvas. The surface performs the consequences. One relation, three
// capacities: the canvas's window of two is 2, the editor's one-active-cell
// law is 1, the hearth's twelve steps are 12.

// visit(order, key, capacity) → { order, entered, evicted }
// `order` is immutable to callers: a fresh array on change, the SAME array on a
// memo hit — surfaces compare identity to decide whether anything happened.
export function visit(order, key, capacity = 2) {
    if (order[0] === key) return { order, entered: null, evicted: null }
    const next = [key, ...order.filter((k) => k !== key)]
    const entered = order.includes(key) ? null : key
    const evicted = next.length > capacity ? next.pop() : null
    return { order: next, entered, evicted }
}
