// Rebases the render epoch so a wall-clock jump after an idle-out (RAF
// throttling) folds into epoch instead of fast-forwarding the animation.
// Split from compositor.js so it's testable without THREE. (specs/eye-ambient.org)

// Decide the epoch for this frame. When the gap since the previous advance
// exceeds the idle floor, the loop actually stopped (an idle-out, not a slow
// frame): fold the gap into epoch — keeping one normal frame of progress — so
// `now` continues from where it paused rather than jumping by the idle duration.
// Otherwise epoch is unchanged. `epoch`/`lastWallT` are null before the first
// advance; in that case epoch is established by the caller.
//
//   epoch, lastWallT : previous epoch and wall timestamp (null until first frame)
//   t                : this frame's wall timestamp
//   frameMs          : one vsync frame (Render.Loop frameInterval, ~16.7ms)
//   idleGapMs        : RAF background-throttle floor — gaps past this are idle-outs
export function rebaseEpoch(epoch, lastWallT, t, frameMs, idleGapMs) {
    if (epoch === null || lastWallT === null) return epoch
    const gap = t - lastWallT
    return gap > idleGapMs ? epoch + (gap - frameMs) : epoch
}

// The idle floor as a function of the loop's vsync cadence. A RUNNING RAF loop
// emits frames between frameMs (foreground 60Hz) and the browser's hidden-tab
// throttle (~1s); a gap past the floor means the loop stopped. Derived from the
// frame model, not a magic constant: the larger of 1s (the throttle floor) and a
// few normal frames (so very low refresh rates still classify correctly).
export function idleFloorMs(frameMs) {
    return Math.max(1000, frameMs * 4)
}
