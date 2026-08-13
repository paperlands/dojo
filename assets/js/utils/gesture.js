// Two-finger gesture arbitration — pure, THREE-free; testable like temporal.js.
//
// Two fingers carry four degrees of freedom, and only three of them are
// independent meanings: how far apart they are (SPAN), where their midpoint sits
// (DRIFT), and how their connecting line turns (TWIST). Applying all three at
// once is what makes a pinch feel finicky — midpoint drift during a pinch is
// systematic, not noise, because the thumb has less reach than the forefinger.
//
// So: nothing happens until one channel has travelled `slop` pixels, and that
// channel then owns the gesture until the fingers lift. The caller decides what
// span/drift/twist MEAN — this module never names a camera.
//
// All three channels are measured in ONE unit, pixels of finger travel, with
// twist as the arc a finger traced about the midpoint (|Δangle| · span/2). One
// number tunes all three, and two edge cases fall out of the geometry instead of
// needing their own rules: fingers close together cannot win on twist (tiny arc,
// exactly where the angle is noisiest), and fingers far apart win on a small
// deliberate twist (long arc, where the intent is unambiguous).

export const SPAN = 'span'
export const DRIFT = 'drift'
export const TWIST = 'twist'

const TWO_PI = Math.PI * 2

// Shortest signed angle, so a twist across ±π reads as a small turn, not a full one.
export function wrapAngle(a) {
    while (a > Math.PI) a -= TWO_PI
    while (a < -Math.PI) a += TWO_PI
    return a
}

// The gesture's state as one sample. `a` and `b` are {x, y} in a consistent
// order — swapping them flips `angle` by π, which is harmless for span and
// midpoint but inverts every twist reading.
export function frameOf(a, b) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    return {
        span: Math.sqrt(dx * dx + dy * dy),
        cx: (a.x + b.x) * 0.5,
        cy: (a.y + b.y) * 0.5,
        angle: Math.atan2(dy, dx)
    }
}

// How far each channel has travelled from `base`, in pixels.
export function travelFrom(base, frame) {
    return {
        [SPAN]: Math.abs(frame.span - base.span),
        [DRIFT]: Math.sqrt((frame.cx - base.cx) ** 2 + (frame.cy - base.cy) ** 2),
        [TWIST]: Math.abs(wrapAngle(frame.angle - base.angle)) * frame.span * 0.5
    }
}

// The arbiter. `begin` on every new two-finger gesture; `decide` per move.
// `decide` returns null while the gesture is still undecided, then the winning
// channel for the rest of the gesture. A tie is broken in span > drift > twist
// order — arbitrary but fixed, so behaviour never depends on float noise.
//
// `slop` is a parameter of the DECISION, not of the arbiter, so a caller holding
// it as a live setting can never end up deciding against a stale copy.
export function createArbiter() {
    let base = null
    let channel = null

    return {
        get channel() { return channel },

        begin(frame) {
            base = frame
            channel = null
        },

        decide(frame, slop) {
            if (channel !== null) return channel
            if (base === null || frame === null) return null

            const travel = travelFrom(base, frame)
            let winner = null
            for (const c of [SPAN, DRIFT, TWIST]) {
                if (travel[c] < slop) continue
                if (winner === null || travel[c] > travel[winner]) winner = c
            }
            channel = winner
            return winner
        }
    }
}
