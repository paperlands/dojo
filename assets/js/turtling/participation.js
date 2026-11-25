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

const namedRecipe = (frame) => frame?.closed && frame.profile === 'derived' && frame.seed?.recipe != null

export function affineScope(observer) {
    if (!namedRecipe(observer)) return null
    while (namedRecipe(observer.parent)) observer = observer.parent
    return observer
}

export const affineHome = observer => affineScope(observer)?.parent ?? null

// Only a named recipe may own a witness; callers forward an identity, not a spelling.
export function localToAffine(frame, observer) {
    if (!frame?.isPlace) return false
    for (let owner = observer; namedRecipe(owner); owner = owner.parent) {
        if (frame.parent === owner) return true
    }
    return false
}

export function affineForwarded(frame, observer) {
    for (let owner = observer; namedRecipe(owner); owner = owner.parent) {
        if (frame.parent === owner) return true
        if (!owner.seed.question?.includes(frame)) return false
    }
    return true
}
export function affineWitness(frame, laws) {
    return laws.some(law => law.witnesses?.includes(frame.id))
}

export function affineHandWitness(writer, frame, laws) {
    return affineHome(frame.parent) === writer.parent && affineWitness(frame, laws)
}
