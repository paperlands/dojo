// Whose position guides the reader: the peer's line or the reader's caret.
// This is local attention, not peer-update consent (id:outer-shell-attention).
// step returns acts; outer.js performs caret → halt → stir → mark → chase → claim → viewport.

export function openWatch() {
    return { user_attention: "peer", peerAt: null, ownCaret: null }
}

// Keep the reader's original caret until a click or draft entry spends it.
function stash(state, head) {
    return (state.ownCaret != null || head == null) ? state.ownCaret : head
}

export function step(state, event) {
    switch (event.kind) {
    case "open":
        return { state: openWatch() }

    // A merge view has no single peer line; attention ownership is unchanged.
    case "draftView":
        return { state: { ...state, peerAt: null }, mark: null, chase: null }

    case "peerLine": {
        const { line, docLines, head } = event
        if (line != null && (line < 1 || line > docLines)) return { state, stir: true }
        if (line === state.peerAt) return { state, stir: true, chase: line }

        const moved = { ...state, peerAt: line }
        if (state.user_attention === "reader" || line == null) {
            return { state: moved, stir: true, mark: line, chase: line }
        }
        return {
            state: { ...moved, ownCaret: stash(state, head) },
            stir: true, mark: line, chase: line, claim: line, viewport: line,
        }
    }

    case "resume": {
        const at = event.line ?? null
        const next = { ...state, user_attention: "peer", peerAt: at, ownCaret: stash(state, event.head) }
        if (at == null) return { state: next, mark: null, chase: null }
        return { state: next, mark: at, chase: at, claim: at, viewport: at }
    }

    // A click chooses a new caret; a keystroke keeps the pre-follow caret owed.
    case "hand":
        if (state.user_attention === "reader") return { state }
        return {
            state: {
                ...state,
                user_attention: "reader",
                ownCaret: event.spendCaret ? null : state.ownCaret,
            },
            halt: true,
            claim: event.caret ?? null,
        }

    case "reassert":
        return { state, claim: state.user_attention === "peer" ? state.peerAt : (event.caret ?? null) }

    // Restore the reader's caret before the editor receives the first edit.
    case "draftEnter":
        if (state.ownCaret == null) return { state }
        return { state: { ...state, ownCaret: null }, caret: state.ownCaret }

    default:
        throw new Error(`watch-law: unknown event "${event.kind}"`)
    }
}
