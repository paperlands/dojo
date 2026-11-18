// A portable offer is plain input, never publication authority; a receiver binds
// and interprets it, and the originals plus rights still decide. (id:laws-construction-input)
import { copyAction } from "./action.js"

// A sparse array's .every skips holes; admitted names must be dense strings.
const denseNames = (names) =>
    Array.isArray(names) && names.length > 0 &&
    Array.from({ length: names.length }, (_, i) => names[i])
        .every((name) => typeof name === "string" && name.length > 0)
const validRoot = (root) =>
    root === "document" ||
    (root != null && typeof root === "object" && !Array.isArray(root) &&
        typeof root.cell === "string" && root.cell.length > 0)

const validRoute = (route) =>
    route != null && typeof route === "object" && !Array.isArray(route) &&
    validRoot(route.root) &&
    denseNames(route.names)

const routeKey = (route) => JSON.stringify([
    route.root === "document" ? ["document"] : ["cell", route.root.cell],
    route.names,
])

export const copyRoute = (route) => ({
    root: route.root === "document" ? "document" : { cell: route.root.cell },
    names: [...route.names],
})

// `null` is legacy/unspecified, NOT explicit empty. An object at v1 is an offer.
export function validChoices(choices) {
    if (choices == null) return true
    if (typeof choices !== "object" || Array.isArray(choices)) return false
    if (choices.v !== 1 || !Array.isArray(choices.inputs)) return false
    const seen = new Set()
    for (const entry of choices.inputs) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false
        if (!validRoute(entry.route)) return false
        if (!copyAction(entry.action)) return false
        const key = routeKey(entry.route)
        if (seen.has(key)) return false
        seen.add(key)
    }
    return true
}

// Copy at the ownership boundary; invalid input admits nothing.
export function copyChoices(choices) {
    if (choices == null) return null
    if (!validChoices(choices)) return null
    return {
        v: 1,
        inputs: choices.inputs.map(({ route, action }) => ({
            route: copyRoute(route),
            action: copyAction(action),
        })),
    }
}

// Capture keeps held offers canonical; resident LOCAL actions/masks replace routes.
// Dormant offered roots survive, while evicted local choices do not. (id:laws-construction-input)
export function captureChoices(held, bindings, localOf, resident = () => true) {
    const scopes = Array.isArray(bindings) ? bindings : []
    if (!scopes.length && held == null) return null
    const base = held == null ? { v: 1, inputs: [] } : copyChoices(held)
    if (!base) return null
    const keyOf = (root) => root === "document" ? "document" : `cell:${root.cell}`
    // Every validated held offer stays data, even for a cell the current source
    // renamed or removed. Local overrides apply only at known resident routes.
    const inputs = base.inputs.map((entry) => ({
        route: copyRoute(entry.route),
        action: copyAction(entry.action),
    }))
    const sameRoute = (entry, root, names) =>
        keyOf(entry.route.root) === keyOf(root) &&
        JSON.stringify(entry.route.names) === JSON.stringify(names)
    for (const { root, slot } of scopes) {
        if (!resident(slot)) continue
        for (const { names, action } of localOf(slot) ?? []) {
            for (let i = inputs.length - 1; i >= 0; i--) {
                if (sameRoute(inputs[i], root, names)) inputs.splice(i, 1)
            }
            if (action == null) continue                 // explicit identity mask
            const copied = copyAction(action)
            if (copied) inputs.push({ route: copyRoute({ root, names }), action: copied })
        }
    }
    return { v: 1, inputs }
}
