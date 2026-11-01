// THE HAND'S ONE THRESHOLD. Every surface that pans under a drag counts the
// same: below DRAG_PX a press is a decision (tap, open, keep); above it the
// press was travel and no click may follow. The river's wheel and the disciple
// strip share this number on purpose — two pan surfaces, one gesture law.
// (Tests pin the number at the wheel; the strip reads it from here.)

/** Pointer travel before a press counts as a pan, not a tap. */
export const DRAG_PX = 5
