// THE WATCHER'S LAW — pure decision; no DOM, no view, no scene.
//
// The problem: two hands share one panel. A friend's line wants the light
// (so you can see where they are); your hand wants it back the moment you
// type or click. Mixing those without a latch left following ending on its
// own first scroll, and drafting landing where the friend sat (D021, D023,
// D025 R5/R7). Wiring is outer.js; glide and firefly are peer-attention.js.
// This file only decides.
//
// ONE LATCH (`following`). Three doors:
//   open / resume  → peer's line owns attend + viewport
//   hand           → watcher's hand owns attend; peer only paints
//   draftEnter     → hand is about to write, so caret goes home first
//
// Mark and firefly track their line in EVERY state — that is the panel
// telling the truth, not a decision. Only claim and viewport are the latch's
// to give.
//
// step(state, event) → { state, ...acts }. An act named is performed;
// anything unnamed does not happen. `null` is real (unmark, unclaim), not
// absence. The surface performs in one fixed order:
//
//   caret → halt → stir → mark → chase → claim → viewport
//
// Every reading the law needs rides the event. The law never looks.

export function openWatch() {
    return { following: true, peerAt: null, ownCaret: null }
}

// First place the watcher was sitting before follow moved them. Held until
// spent — a later arrival must not overwrite the place they chose.
function stash(state, head) {
    return (state.ownCaret != null || head == null) ? state.ownCaret : head
}

export function step(state, event) {
    switch (event.kind) {

    // New friend: re-arm; nothing of the last one is owed.
    case "open":
        return { state: openWatch() }

    // Draft is a diff, not a document — no line to stand on.
    case "draftView":
        return { state: { ...state, peerAt: null }, mark: null, chase: null }

    case "peerLine": {
        const { line, docLines, head } = event
        // Meta can name a line before the body arrives; past-end is not yet true.
        if (line != null && (line < 1 || line > docLines)) return { state, stir: true }
        // Same line they already hold: re-measure the firefly, do not re-arrive.
        if (line === state.peerAt) return { state, stir: true, chase: line }

        const moved = { ...state, peerAt: line }
        if (!state.following || line == null) {
            return { state: moved, stir: true, mark: line, chase: line }
        }
        return {
            state: { ...moved, ownCaret: stash(state, head) },
            stir: true, mark: line, chase: line, claim: line, viewport: line,
        }
    }

    // Firefly click: peer owns the light again, from wherever the hand left it.
    case "resume": {
        const at = event.line ?? null
        const next = { ...state, following: true, peerAt: at, ownCaret: stash(state, event.head) }
        if (at == null) return { state: next, mark: null, chase: null }
        return { state: next, mark: at, chase: at, claim: at, viewport: at }
    }

    // Mousedown or keystroke in this panel. Hand takes the light. A CLICK also
    // spends the stash — the watcher just said where they want to be.
    case "hand":
        if (!state.following) return { state }
        return {
            state: {
                ...state,
                following: false,
                ownCaret: event.spendCaret ? null : state.ownCaret,
            },
            halt: true,
            claim: event.caret ?? null,
        }

    // Their line while following; the hand's caret once it intervened.
    case "reassert":
        return { state, claim: state.following ? state.peerAt : (event.caret ?? null) }

    // ONE door into drafting. Following parked the caret on their cell; that
    // must not become where the watcher writes.
    case "draftEnter":
        if (state.ownCaret == null) return { state }
        return { state: { ...state, ownCaret: null }, caret: state.ownCaret }

    default:
        throw new Error(`watch-law: unknown event "${event.kind}"`)
    }
}
