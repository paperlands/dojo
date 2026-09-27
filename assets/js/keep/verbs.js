// The journal's public verbs — one list, both sides of the door (id:kb-6).
// Door and worker must agree; a second copy is two lists waiting to drift.

export const VERBS = Object.freeze([
    "put",
    "get",
    "list",
    "local",
    "share",
    "image",
    "source",
    "genesis",
])

export const VERB_SET = new Set(VERBS)
