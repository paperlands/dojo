// A parser's epoch changes when a definition can change an expanded tree.
// Both command reads and figure questions share this bounded memo.
const PARSE_MEMO = new WeakMap()
const MAX_MEMO = 512

export function parseMemo(parser, expr) {
    const epoch = parser.epoch ?? 0
    let entry = PARSE_MEMO.get(parser)
    if (entry === undefined || entry.epoch !== epoch) {
        entry = { epoch, map: new Map() }
        PARSE_MEMO.set(parser, entry)
    }
    const hit = entry.map.get(expr)
    if (hit !== undefined) return hit
    const tree = parser.parse(expr)
    if (entry.map.size >= MAX_MEMO) entry.map.clear()
    entry.map.set(expr, tree)
    return tree
}
