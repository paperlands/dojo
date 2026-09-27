// THE DEGREE LADDER (Shoot 1, id:gw-appearance).
//
// Appearance in DEGREE is a recency order with a capacity: the key just
// visited is KINDLED (order[0] — bright, running), the ones behind it are
// WARM (dimmed, waiting), and past capacity a key is EVICTED — it leaves the
// canvas. The surface performs the consequences. One relation, three
// capacities: canvas window of two is 2; editor's one-active-cell is 1;
// hearth's twelve steps are 12.
//
// Pins (Cut 1): a property of the ENTRY, not a raised capacity. Eviction is
// the tail-most past-bound entry that is NOT pinned. Pins empty ⇒ naive
// pop of the tail (today's behaviour).

// visit(order, key, { bound, pinned }) → { order, evicted }
// `order` immutable to callers: fresh array on change, SAME array on a memo
// hit — surfaces compare identity to decide whether anything happened.
//
// One options shape, not two: the number form was one call site's convenience
// and a second thing to get right. `pinned` is a Set of keys that stay.
export function visit(order, key, { bound = 2, pinned = null } = {}) {
    if (order[0] === key) return { order, evicted: null }
    const next = [key, ...order.filter((k) => k !== key)]

    // One eviction per call. Skip pinned tails — never the head.
    let evicted = null
    if (next.length > bound) {
        for (let i = next.length - 1; i >= 1; i--) {
            if (pinned && pinned.has(next[i])) continue
            evicted = next[i]
            next.splice(i, 1)
            break
        }
    }
    return { order: next, evicted }
}
