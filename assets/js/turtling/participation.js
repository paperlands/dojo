// A requester addresses a subject through its enclosing region.
// Scope permits an encounter, not movement or publication. (id:participation-language)
import { isBeing } from './frame.js'

function regionOf(requester) {
    let region = requester
    for (let parent = requester.parent; parent && parent.closed; parent = parent.parent) region = parent
    return region
}

// Within is containment, never the open-context exemption. (id:participation-language)
export function isWithinRegion(requester, subject) {
    const region = regionOf(requester)
    for (let node = subject; node; node = node.parent) if (node === region) return true
    return false
}

// Supplied to the enclosing region, by exact identity in its current question.
// Its presence in the world is separate from the subject's. (id:participation-language)
export function isSuppliedParticipant(requester, subject, registry) {
    const region = regionOf(requester)
    return isBeing(subject) && registry != null && registry.get(region.id) === region &&
        region.seed?.question?.some(input => input === subject) === true
}

// May names scope policy only; callers retain their own lifetime/refusal order.
// (id:participation-language)
export function mayAddressParticipant(requester, subject, registry) {
    return !requester.closed || isWithinRegion(requester, subject) ||
        isSuppliedParticipant(requester, subject, registry)
}
