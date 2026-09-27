// Caption mode (id:kr-ready). Classes only via applyMode.

/** Seat under the sun / column key — never a keep id. */
export const PRESENT = "present"
export const DRAFT = "draft"

/** Mode classes on `.river-sky`. has-mirror is fold geometry, not chrome. */
export const MODE_CLASSES = Object.freeze([
    "at-open",
    "at-keep",
    "is-shared",
    "is-ready",
    "is-keeping",
])

/**
 * @typedef {{
 *   seat: "present" | "draft" | "keep",
 *   shared: boolean,
 *   ready: boolean,
 *   sealing: string | null,
 * }} Mode
 */

/** Present and draft — the open east. Not a keep. */
export function isOpen(seat) {
    return seat === "present" || seat === "draft"
}

/**
 * @param {Element} root
 * @param {Mode} mode
 */
export function applyMode(root, mode) {
    const want = classSetOf(mode)
    for (const c of MODE_CLASSES) root.classList.toggle(c, want.has(c))
    // Draft-only chrome (drop) reads the attribute; open vs keep is the class.
    if (isOpen(mode.seat) && mode.sealing == null) root.dataset.seat = mode.seat
    else delete root.dataset.seat
}

/**
 * Pure: mode → class names. CSS selectors are the dual of this set.
 * @param {Mode} mode
 * @returns {Set<string>}
 */
export function classSetOf(mode) {
    const out = new Set()
    if (mode.sealing != null) {
        out.add("at-keep")
        out.add("is-keeping")
        return out
    }
    if (isOpen(mode.seat)) out.add("at-open")
    else out.add("at-keep")
    if (mode.shared) out.add("is-shared")
    if (mode.ready) out.add("is-ready")
    return out
}

/**
 * Mode from seat + caption. Ready = non-empty caption at open seat, not sealing.
 * @param {{ at: {key: string, id: string|null}, sharedIds: Set<string>, sealing?: string | null, caption?: string }} truths
 * @returns {Mode}
 */
export function modeOf({ at, sharedIds, sealing = null, caption = "" }) {
    const seat = seatOf(at)
    const seal = sealing ?? null
    const onKeep = seat === "keep" && !!at.id
    const ready =
        seal == null &&
        isOpen(seat) &&
        caption.trim().length > 0
    return {
        seat,
        shared: onKeep && sharedIds.has(at.id),
        ready,
        sealing: seal,
    }
}

/**
 * @param {{key: string, id?: string|null}} at
 * @returns {"present"|"draft"|"keep"}
 */
export function seatOf(at) {
    if (at?.key === PRESENT) return "present"
    if (at?.key === DRAFT) return "draft"
    return "keep"
}
