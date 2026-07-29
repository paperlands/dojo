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

// Keystroke path — is the outershell drafting? No DOM walk.
export function outerDrafting() {
    return !!get("outershell")?.drafting?.()
}
