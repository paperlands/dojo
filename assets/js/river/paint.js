// Paint the columns — morph in place, never flash-replace (id:kr-helios).
//
// A new keep ARRIVES into the rail; the rail does not wipe. So this is a
// reconcile keyed by the fold's own keys (id:kr-mirror): trunk columns are
// keyed by their keep's id and are reused untouched, divergent columns are
// keyed by distance past the meet and trade contents in place. That is why a
// swap moves the futures and leaves the trunk standing — the keys say so, and
// no animation has to be told which seats are common.

import { name } from "../keep/entry.js"
import { column, draft, present, ripple, seat, slot, wear } from "./atoms.js"

const PLACES = ["sky", "water"]

/**
 * @param {HTMLElement} rail - the scrolling wheel
 * @param {{key: string, sky: string|null, water: string|null, trunk: boolean, meet: boolean, present?: boolean, draft?: boolean, face?: string|null}[]} columns
 * @param {{kept: (id: string) => boolean, faceOf: (id: string) => string|null}} law
 * @returns {{seats: Map<string, HTMLElement>, arrived: string[]}} sky seats by keep id
 */
export function paint(rail, columns, { kept, faceOf }) {
    const held = new Map()
    // A stray is anything that is not a column — the empty river's word is the
    // only one, and it must not survive the first keep.
    const strays = []
    for (const el of rail.children) {
        if (el.dataset?.key) held.set(el.dataset.key, el)
        else strays.push(el)
    }
    for (const el of strays) el.remove()

    const seats = new Map()
    const arrived = []

    for (const col of columns) {
        let el = held.get(col.key)
        const fresh = !el
        if (fresh) el = column(col.key)
        held.delete(col.key)
        el.classList.toggle("is-present", !!col.present)
        el.classList.toggle("is-draft", !!col.draft)

        const skySeat = fill(el, "sky", col.sky, {
            present: col.present,
            draft: col.draft,
            face: col.face ?? null,
            kept,
            faceOf,
        })
        fill(el, "water", col.water, { water: true, kept, faceOf, fog: !col.trunk })
        mark(el, col.meet)

        if (skySeat && col.sky) {
            const id = name(col.sky)
            seats.set(id, skySeat)
            if (fresh) arrived.push(id)
        }
        // appendChild on a standing child is a move, not a rebuild — the DOM
        // node, its animations and its place all survive the reorder.
        rail.appendChild(el)
    }

    for (const el of held.values()) el.remove()
    return { seats, arrived }
}

// One surface of one column. Absence is a slot of the same size, so the
// message stays whole where a line reached less far than its sibling.
function fill(col, place, bytes, {
    water = false,
    present: isPresent = false,
    draft: isDraft = false,
    face = null,
    kept,
    faceOf,
    fog = false,
}) {
    const wanted = bytes
        ? "seat"
        : isDraft && place === "sky"
            ? "draft"
            : isPresent && place === "sky"
                ? "present"
                : "slot"
    let el = col.querySelector(`[data-place="${place}"]`)

    if (!el || el.dataset.kind !== wanted) {
        const made = wanted === "seat"
            ? seat({ water })
            : wanted === "present"
                ? present()
                : wanted === "draft"
                    ? draft()
                    : slot()
        made.dataset.place = place
        made.dataset.kind = wanted
        if (el) el.replaceWith(made)
        else insert(col, place, made)
        el = made
    }

    if (!bytes) {
        delete el.dataset.id
        if (wanted === "draft") wear(el, { kept: false, face })
        return wanted === "present" || wanted === "draft" ? el : null
    }

    const id = name(bytes)
    el.dataset.id = id
    wear(el, { kept: kept(id), face: faceOf(id) })
    if (water) el.classList.toggle("foggy", fog)
    return el
}

// Sky above the waterline, water below — order is the geometry (id:kr-geo).
function insert(col, place, el) {
    if (place === PLACES[0]) col.prepend(el)
    else {
        const rip = col.querySelector(".river-ripple")
        if (rip) col.insertBefore(el, rip)
        else col.appendChild(el)
    }
}

function mark(col, isMeet) {
    const standing = col.querySelector(".river-ripple")
    if (isMeet && !standing) col.appendChild(ripple())
    if (!isMeet && standing) standing.remove()
}
