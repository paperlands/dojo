// Expanded syntax belongs to its authored term and the parser's vocabulary epoch.
// Unowned/dynamic spellings use a bounded fallback. (id:runtime-authored-term-lifetime)
const PARSE_MEMO = new WeakMap()
const MAX_MEMO = 512

export function parseMemo(parser, expr, term = null) {
    const epoch = parser.epoch ?? 0
    let entry = PARSE_MEMO.get(parser)
    if (entry === undefined || entry.epoch !== epoch) {
        entry = { epoch, map: new Map(), terms: new WeakMap() }
        PARSE_MEMO.set(parser, entry)
    }
    let cache = entry.map
    if (term !== null && (typeof term === 'object' || typeof term === 'function')) {
        cache = entry.terms.get(term)
        if (!cache) { cache = new Map(); entry.terms.set(term, cache) }
    }
    const hit = cache.get(expr) ?? entry.map.get(expr)
    if (hit !== undefined) { cache.set(expr, hit); return hit }
    const tree = parser.parse(expr)
    if (entry.map.size >= MAX_MEMO) entry.map.clear()
    entry.map.set(expr, tree)
    cache.set(expr, tree)
    return tree
}
