// The light rig — one sun lights the river (id:kr-light, id:kr-rig).
//
// Truth on this surface is two words forever: KEPT LOCAL and SHARED. Everything
// else a child feels here is LIGHT, and light is legal because it adds no
// vocabulary. Helios is the precedent — five sky seats over one boolean phase
// (id:nav-nerve-helios).
//
// Pure and synchronous. Nothing about the light is ever stored (id:kr-light 3):
// a mood is a function of edges the fold already owns, and a seat's dim is a
// function of distance from the sun. No seat owns a lamp — if a seat must be
// brighter, the sun moves.

/** The sky over the whole strip. Four moods, and there is no fifth. */
export const MOODS = Object.freeze(["rest", "waking", "ignite", "settle"])

/**
 * Which sky stands over this river.
 *
 * Edges win over holds: a land or a share is a thing that just happened, and
 * the mood it lights decays back into the standing weather (id:kr-moods).
 *
 * @param {{keptLocal?: number, landing?: boolean, settling?: boolean}} truths
 * @returns {"rest"|"waking"|"ignite"|"settle"}
 */
export function moodOf({ keptLocal = 0, landing = false, settling = false } = {}) {
    if (landing) return "ignite"
    if (settling) return "settle"
    return keptLocal > 0 ? "waking" : "rest"
}

/**
 * The rig — custom properties the strip root sets once per mood.
 * Seats READ these; they never write them (id:kr-rig NOT).
 * Sun size and wash live here so CSS does not dual-author the light.
 *
 * @param {string} mood
 * @returns {{[prop: string]: string}}
 */
export function rigOf(mood) {
    switch (mood) {
        case "waking":
            return { "--sun-size": "300px", "--river-wash": "12%" }
        case "ignite":
            return { "--sun-size": "400px", "--river-wash": "16%" }
        case "settle":
            return { "--sun-size": "330px", "--river-wash": "9%" }
        default:
            return { "--sun-size": "340px", "--river-wash": "7%" }
    }
}

/**
 * Write mood onto the strip root — dataset + rig. One verb for the sky.
 * @param {HTMLElement} root
 * @param {string} mood
 */
export function paintSky(root, mood) {
    root.dataset.mood = mood
    for (const [prop, value] of Object.entries(rigOf(mood))) {
        root.style.setProperty(prop, value)
    }
}

/**
 * A seat's brightness, from its distance to the meridian alone.
 *
 * The sun is pinned at the center and the river slides beneath it
 * (id:kr-meridian), so distance from the center IS distance from the sun.
 *
 * @param {number} t - |dx| / half-width, clamped to [0,1]
 * @returns {{dim: number}} dim 1→0.55
 */
export function shadeOf(t) {
    const d = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0))
    return { dim: 1 - 0.45 * d }
}

/**
 * How near the meridian this seat stands, in SEATS — not in fractions of the
 * strip. 1 at the sun, 0 one seat away, and nothing in between is a jump.
 *
 * Distance in seats, because that is what the eye counts: the neighbour of the
 * active seat must read as fully inactive however wide the strip happens to
 * be. Selection corners and open-circle light ride this one number.
 *
 * @param {number} dx - seat center minus meridian, in px
 * @param {number} pitch - one seat's stride (seat width + gap), in px
 * @returns {number} 0…1
 */
export function nearness(dx, pitch) {
    if (!Number.isFinite(dx) || !Number.isFinite(pitch) || pitch <= 0) return 0
    return Math.min(1, Math.max(0, 1 - Math.abs(dx) / pitch))
}

