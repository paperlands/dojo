// The terminals cell — Terminals by role, not by dunder (id:gw-t-dom-registry).
//
// Two roles, same idiom as stage-cell: the inner buffer (your code) and the
// outer review surface (a friend's). wireRegistry is the one write door;
// readers import getInner / getOuter / outerDrafting — never document.getElementById
// for a terminal. Count of __-props only ever decreases.

import { createCell } from "../../kernel/cell.js"

const inner = createCell()
const outer = createCell()

export function registerInner(term) {
    return inner.register(term)
}

export function getInner() {
    return inner.get()
}

export function registerOuter(term) {
    return outer.register(term)
}

export function getOuter() {
    return outer.get()
}

// Keystroke path — is the outer drafting? No DOM walk.
export function outerDrafting() {
    return !!outer.get()?.drafting?.()
}
