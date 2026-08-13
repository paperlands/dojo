// The terminals cell — Terminals by role, not by dunder (id:gw-t-dom-registry).
// Role is data (id:lex-unmarked): one createCell() per surface name already in the DOM.

import { createCell } from "../../kernel/cell.js"

const cells = { coreshell: createCell(), outershell: createCell() }

// An unmarked role is a fault, and it says so — reaching cells[role] blind
// dies with "cannot read properties of undefined", which names nothing.
function cellFor(role) {
    const cell = cells[role]
    if (!cell) throw new Error(`term-cell: no role "${role}" — expected coreshell or outershell`)
    return cell
}

export function register(role, term) {
    return cellFor(role).register(term)
}

export function get(role) {
    return cellFor(role).get()
}

// {get, watch} — the shape attach() claims, for a surface that must wait for
// a Terminal that mounts after it (kernel/attach.js).
export function seatOf(role) {
    const cell = cellFor(role)
    return { get: () => cell.get(), watch: (fn) => cell.watch(fn) }
}

// Keystroke path — is the outershell drafting? No DOM walk.
export function outerDrafting() {
    return !!get("outershell")?.drafting?.()
}
