// The stamp — the time and its tiebreak, minted together (id:kc-parts, build 0).
//
// The stamp rides INSIDE the entry's bytes, and the bytes are the name
// (id:kc-law 2,3). So a reissued stamp is a reissued name, and the room's
// ON CONFLICT DO NOTHING drops the second entry. `n` is what makes reissue
// impossible; same-ms ORDERING is the consequence, not the reason.
//
// One hand per process (id:kc-p-order). Keying the counter by a source string
// lets two call sites reset `n` independently and mint one stamp twice — the
// very collision `n` prevents.
//
// It cannot persist across a reload without reading the shelf, and the shelf is
// a door while this is pure (id:kc-law 8). It does not need to: a collision
// across processes requires an identical body at an identical instant, and that
// is the same page (id:kc-feynman) — dedup, not loss.

/**
 * @param {{ now?: () => number }} [io] - the clock reader; tests drive their own
 * @returns {{ stamp: () => {t: number, n: number} }}
 */
export function createStamp({ now = Date.now } = {}) {
    let t = -Infinity
    let n = 0

    function stamp() {
        const wall = now()
        // t never walks back. A backward clock is drift we accept; a reused
        // stamp is work we lose. When the two conflict, order wins.
        if (wall > t) {
            t = wall
            n = 0
        } else {
            n += 1
        }
        return { t, n }
    }

    return { stamp }
}

const hand = createStamp()

/** Epoch ms + same-ms counter. Never returns the same pair twice. */
export const stamp = () => hand.stamp()

/**
 * Order within one hand — the one place the order is defined.
 * `n` is process-local (this hand only). Across hands / peers, compare on `t`
 * alone and only ever as LWW (D008); the nerve envelope carries `t`, not `n`.
 * Tests drive time via createStamp({now}) — never a resetClock export.
 */
export function compare(a, b) {
    return a.t - b.t || a.n - b.n
}
