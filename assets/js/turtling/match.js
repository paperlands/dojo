// Pattern matching for event names — pure string scanning.
// Shared between executor (when handler) and nerve (signal filter).
// Literal characters match literally, [var] captures up to next literal (or end).
// [_] matches but discards. Numeric captures coerce to number.
// No brackets → exact match. No special treatment of dots.
// Returns null (no match) or object of captured bindings.
export function matchPattern(pattern, eventName) {
    if (!pattern.includes('[')) {
        return pattern === eventName ? {} : null
    }

    const captures = {}
    let pi = 0, ei = 0
    const plen = pattern.length
    const elen = eventName.length

    while (pi < plen) {
        if (pattern[pi] === '[') {
            const close = pattern.indexOf(']', pi + 1)
            if (close === -1) return null
            const name = pattern.slice(pi + 1, close)
            pi = close + 1

            // Find next literal to bound capture
            let nextLit = null
            if (pi < plen && pattern[pi] !== '[') {
                const nb = pattern.indexOf('[', pi)
                nextLit = nb === -1 ? pattern.slice(pi) : pattern.slice(pi, nb)
            }

            const end = nextLit
                ? eventName.indexOf(nextLit, ei)
                : elen

            if (end === -1 || end <= ei) return null
            if (name !== '_') {
                const raw = eventName.slice(ei, end)
                const num = Number(raw)
                captures[name] = isNaN(num) ? raw : num
            }
            ei = end
        } else {
            const nb = pattern.indexOf('[', pi)
            const litEnd = nb === -1 ? plen : nb
            if (!eventName.startsWith(pattern.slice(pi, litEnd), ei)) return null
            ei += litEnd - pi
            pi = litEnd
        }
    }

    return ei === elen ? captures : null
}
