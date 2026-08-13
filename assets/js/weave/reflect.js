// THE BUFFER'S WHOLE TRUTH, and the sentence a friend gets.
//
// The problem: two questions share three facts (standing tree, standing
// ailments, the seat those ailments address) — and when they lived inside
// the shell surface, the only way to test them was to write them again in
// the harness. A law tested by a copy is two laws.
//
//   ask(addr, place)  → the buffer's diagnostics
//   of({ … })         → the reflect a hatch ships (D022)
//
// Nothing here touches DOM, turtle, or LiveView. The surface names its
// subject and lends its bodies; this decides.

import { diagnostics, ailmentsFor, verdict } from "./queries.js"
import { sayWound } from "./wound-view.js"

/**
 * @param {object} o
 * @param {(addr: string, place: string) => Array|null} o.tree
 *   Standing tree — a page's on the page record, a plain tab's in the parse
 *   memo: the two lifecycles the { text, ast } pair rides.
 * @param {() => Array} o.ailments  every standing walk fault on the canvas
 * @param {(addr: string, place: string) => string} o.seatOf  Slot for a document
 */
export function makeReflector({ tree, ailments, seatOf }) {
    // One diagnostics answer, asked not computed. BY PLACE: one document
    // seated twice faults differently in each (id:light-ladders-place-axis).
    const ask = (addr, place) =>
        diagnostics(
            tree(addr, place) ?? [],
            ailmentsFor(ailments(), seatOf(addr, place), addr),
            addr,
        )

    // What crosses the peer seam (D022): the authored buffer's WHOLE standing
    // tree, its diagnostics, and the verdict. Never a seat's instruction slice —
    // a page seats per cell, and the slice is not the page. Asked at reflect
    // time so there is no writer to race; the surface only names its subject.
    //
    // THE ATTENTION RIDES; THE DOCUMENT DOES NOT MOVE (D025 R1, amended).
    // `attend` is a coordinate INTO the tree that crosses beside it — the
    // author's own line, untranslated, because the watcher holds the same
    // document. No second coordinate space: nothing that can land on wrong text.
    //
    // What makes untranslated legal: `printAST` preserves LINE COUNT (the
    // healing marks exist for this). One known drift is D021's empty meadow
    // (`###\n\n###` → `###\n###`); named, not repaired here.
    //
    // Not `reflectPhase`: projecting by inhabited phase once shipped as a bug —
    // distant cells kept fences, lost bodies, and the gutted text became the
    // merge baseline of a code-review surface. A cursor move must not rewrite
    // the friend's document. Bandwidth later; not until "dormant" means NOT
    // SEATED rather than seated-with-nothing.
    //
    // attend:null is the identity — the document pointing nowhere.
    const of = ({ addr, place, source, attend = null }) => {
        const ast = tree(addr, place)
        const found = ast ? ask(addr, place) : []
        // Verdict answers WHETHER and WHICH; the sentence is said HERE so the
        // server carries words it never has to interpret (D022).
        const { state, wound } = verdict(found, addr)
        return {
            source,
            commands: ast ?? [],
            attend,
            diagnostics: found,
            state,
            message: wound ? sayWound(wound) : null,
        }
    }

    return { ask, of }
}
