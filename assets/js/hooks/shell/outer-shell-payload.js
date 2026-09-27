// seeOuterShell envelope — one shape, two producers (server + client).
//
// Server dual: OuterShell.payload/2 (lib/dojo_web/live/layout/outer_shell.ex).
// Turtle fields + shell overlay { addr, origin_name, view, stream }.
// OUTER_SHELL_KEYS stays in lockstep; sparse objects are not the contract — nils are.

/** Full envelope keys — present even when the value is null. */
export const OUTER_SHELL_KEYS = [
    "state",
    "path",
    "commands",
    "attend",
    "diagnostics",
    "source",
    "time",
    "buffer_id",
    "addr",
    "origin_name",
    "view",
    "stream",
]

/**
 * Build the full seeOuterShell detail. Partial input fills defaults so a
 * library open and a friend hatch speak the same shape.
 *
 * @param {Record<string, unknown>} partial
 * @returns {Record<string, unknown>}
 */
export function outerShellPayload(partial = {}) {
    return {
        state: partial.state ?? null,
        path: partial.path ?? null,
        commands: partial.commands ?? [],
        attend: partial.attend ?? null,
        diagnostics: partial.diagnostics ?? [],
        source: partial.source ?? null,
        time: partial.time ?? null,
        buffer_id: partial.buffer_id ?? null,
        addr: partial.addr ?? null,
        origin_name: partial.origin_name ?? null,
        view: partial.view ?? "watch",
        stream: partial.stream ?? true,
    }
}

/**
 * Client origin of a surface event. LiveView's handleEvent is a window
 * listener on `phx:${name}` (detail = payload) — server push_event and
 * Elixir JS.dispatch (bubbles default true) land on the same door.
 *
 * @param {string} name  bare event name, no "phx:" prefix
 * @param {unknown} [detail]
 */
export function dispatchPhx(name, detail = {}) {
    window.dispatchEvent(new CustomEvent(`phx:${name}`, { detail }))
}
