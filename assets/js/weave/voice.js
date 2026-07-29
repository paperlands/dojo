// VOICE — the RHYTHM of a wound, and nothing else. queries.js answers the
// facts, wound-view.js says the words; this says them ONCE.
//
// Why it is a file. A standing wound is one fact, but every surface learns it
// again on every breath — a friend hatches on each keystroke, and the child's
// own page re-evaluates at 20 ms. Without a rhythm, one broken line becomes a
// drumbeat; with one hand-rolled per surface, the child's HUD and a friend's
// panel disagree about how loud the same wound is. One clock, both surfaces.
//
// The law: a wound speaks when it ARRIVES and stays quiet while it STANDS. A
// wound that heals and returns is news again, so the ledger is rebuilt from the
// living set each pass — never appended to.

// WHAT MAKES TWO WOUNDS THE SAME WOUND. Not object identity: every ask rebuilds
// the list. The four facts a reader could tell apart — what kind of hurt, whose
// frame, in what words, on which line.
const mark = (w) =>
    `${w.kind}:${w.address ?? "?"}:${w.message ?? ""}:${w.span?.line ?? "?"}`

// say(wounds, utter) — utter() is called for the wounds that are NEW since the
// last pass. forget() re-arms everything: call it when the SOURCE changes, so a
// wound heard from the wire cannot silence the identical wound from our own run.
export function sayOnce() {
    let spoken = new Set()
    return {
        say(wounds, utter) {
            const live = new Set()
            for (const w of wounds ?? []) {
                const at = mark(w)
                live.add(at)
                if (!spoken.has(at)) utter(w)
            }
            spoken = live
        },
        forget() { spoken = new Set() },
    }
}
