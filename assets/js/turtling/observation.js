// Owned observation facts: copy enumerable data, freeze copies; ids are projected first.
// Decision and law observations never alias runtime handles. (id:scheduler-observation-ownership)
export function snapshotFact(value) {
    if (value === null || typeof value !== 'object') return value
    if (Array.isArray(value)) return Object.freeze(value.map(snapshotFact))
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, part]) => [key, snapshotFact(part)])))
}
