// The CAST of the river — fixed atoms, invented nowhere else (id:kr-atoms).
//
//   rail · seat · present · draft · ring-open · ring-settled · ripple
//
// TWO WORDS ONLY (id:kc-lexicon):
//   kept local → ring-open + breath        shared → ring-settled, breath ends
// The ring is four square edges (command-deck corners), lit by --near.
// Present and draft are not keeps: no open/settled word, never in the journal.

const NS = "river"

/** One keep's place on the rail. */
export function seat({ water = false } = {}) {
    const el = div(`${NS}-seat` + (water ? ` ${NS}-water` : ""))
    el.appendChild(div(`${NS}-face`))
    el.appendChild(span(`${NS}-ring`))
    return el
}

/**
 * The open east — the present (id:kr-meridian).
 * A dotted circle, not keep-corners; no open/settled word yet.
 */
export function present() {
    const el = div(`${NS}-seat ${NS}-present`)
    el.appendChild(div(`${NS}-open`))
    return el
}

/**
 * East of present — a local draft from a past keep. Not a keep: no journal,
 * no share. Face sits inside the dotted circle (figure, then ring).
 */
export function draft() {
    const el = div(`${NS}-seat ${NS}-draft`)
    el.appendChild(div(`${NS}-face`))
    el.appendChild(div(`${NS}-open`))
    return el
}

/** A seat's place with no keep — the other line reached further. */
export function slot() {
    return div(`${NS}-slot`)
}

/** One column: this line above, the sibling mirrored beneath. */
export function column(key) {
    const el = div(`${NS}-col`)
    el.dataset.key = key
    return el
}

/** The meet — the only mark provenance ever gets (id:kr-mirror). */
export function ripple() {
    const el = span(`${NS}-ripple`)
    el.textContent = "≈≈"
    el.setAttribute("aria-hidden", "true")
    return el
}

/**
 * kept local | shared — and the face picture.
 * Clearing the picture is as necessary as setting it under a swap.
 * Draft seats have no ring; they only wear a face.
 */
export function wear(seatEl, { kept, face = null }) {
    const ring = seatEl.querySelector(`.${NS}-ring`)
    if (ring) {
        ring.classList.toggle(`${NS}-ring-open`, kept)
        ring.classList.toggle(`${NS}-ring-settled`, !kept)
    }
    const el = seatEl.querySelector(`.${NS}-face`)
    if (el) el.style.backgroundImage = face ? `url(${face})` : ""
    seatEl.classList.toggle("has-face", !!face)
}

function div(cls) {
    const el = document.createElement("div")
    el.className = cls
    return el
}

function span(cls) {
    const el = document.createElement("span")
    el.className = cls
    return el
}
