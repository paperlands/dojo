// The feel: the numbers a play tunes, kept apart from the numbers that are true.
// (id:laws-decl-interface)
//
// Every constant here is a policy, not a truth — change it and the hand, the ring
// or the fade answers differently, but no geometry moves. The conditioning and
// placement tolerances (GRAZE, REL_TOL, REALIZE_TOL) stay with the geometry they
// guard, because those say what is representable, not what feels right.

// The hit radius, in CSS pixels. ONE constant: the gesture tests with it and the
// pin draws its ring at it, so the drawn ring is the touchable disc.
// (id:laws-decl-handle)
export const HIT_RADIUS = 18

// A still finger is a click. Two pixels is enough; more is a deadzone.
export const DRAG_SLOP = 2

// How fast a drawn pixel of hand spends a cone point's height, and how much of the
// remaining height error one move closes. (D039)
export const CONE_RATE = 0.5
export const CONE_EASE = 0.35

// The ball's own landmarks: the arc where a detent's pull reaches zero, and the arc
// it sits exactly on. (D037)
export const DETENT_BAND = 0.18          // radians; ~10°
export const DETENT_HOLD = 0.06          // radians; ~3.4°

// How long a refusal's text lingers after the hand lets go. (id:laws-decl-interface)
export const VERDICT_DECAY_MS = 360
