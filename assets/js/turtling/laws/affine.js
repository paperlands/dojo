import { finite3 } from './vec3.js'
import { ACCEPT_TOL } from './realize.js'

// The first affine grammar has no hidden chart: world points, displacements,
// and a literal zero vector. Retain every read, even one that cancels.
export function affineSyntax(lhs, rhs) {
    const subjects = [], weights = []
    function visit(node, sign) {
        if (node?.type === 'operand' && /^[A-Za-z_][\w-]*\.position$/.test(node.value)) {
            subjects.push(node.value.slice(0, -'.position'.length))
            weights.push(sign)
            return 1 // affine degree: a point translates with its chart
        }
        if (node?.type === 'vector' && node.children.length >= 2 && node.children.length <= 3 &&
            node.children.every((c) => c.type === 'literal' && c.value === 0)) return 0
        if (node?.type !== 'operator' || !['+', '-'].includes(node.value) || node.children.length !== 2) return null
        const a = visit(node.children[0], sign)
        const b = visit(node.children[1], node.value === '+' ? sign : -sign)
        if (a == null || b == null || node.value === '-' && a < b) return null
        const degree = node.value === '+' ? a + b : a - b
        return degree <= 1 ? degree : null
    }
    const l = visit(lhs, 1), r = visit(rhs, -1)
    return l != null && l === r && subjects.length > 0 && subjects.length <= 64 ? { subjects, weights } : null
}

export function affineCoefficients(term) {
    const result = new Map()
    for (let i = 0; i < term.references.length; i++) {
        const id = term.references[i]
        result.set(id, (result.get(id) ?? 0) + term.value[i])
    }
    for (const [id, coefficient] of result) if (coefficient === 0) result.delete(id)
    return result
}

export function affineResidual(term, read) {
    const d = [0, 0, 0], origin = read(term.references[0])
    if (!finite3(origin)) return NaN
    for (let i = 0; i < term.references.length; i++) {
        const at = read(term.references[i])
        if (!finite3(at)) return NaN
        for (let j = 0; j < 3; j++) d[j] += term.value[i] * (at[j] - origin[j])
    }
    return Math.hypot(...d) / (Math.hypot(...affineCoefficients(term).values()) || 1)
}

const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0)

// Project the previous positions onto the equalities over the admitted axes.
// A dependent or ill-conditioned row is never a contradiction certificate.
export function affineProject(terms, read, axesOf, witnesses = new Set()) {
    const rows = terms.map(affineCoefficients)
    const positions = new Map()
    for (const term of terms) for (const id of term.references) {
        if (positions.has(id)) continue
        const at = read(id)
        if (!finite3(at)) return null
        positions.set(id, at)
    }
    if (rows.length > 32 || positions.size > 32) return null
    const result = new Map([...positions].filter(([id]) => axesOf(id).length > 0).map(([id, at]) => [id, [...at]]))
    for (let j = 0; j < 3; j++) {
        const movable = [...result.keys()].filter((id) => axesOf(id).includes(j))
        const locals = movable.filter(id => witnesses.has(id)), ports = movable.filter(id => !witnesses.has(id))
        const ids = [...locals, ...ports]
        const equations = []
        for (const terms of rows) {
            const scale = Math.hypot(...terms.values())
            if (scale === 0) continue
            const origin = positions.get(terms.keys().next().value)[j]
            let rhs = 0
            for (const [id, c] of terms) rhs -= (c / scale) * (positions.get(id)[j] - origin)
            equations.push([...ids.map(id => (terms.get(id) ?? 0) / scale), rhs])
        }
        // Eliminate private changes before minimizing movement of ports. A missing
        // pivot means those private axes do not have a unique answer. (id:laws-two-turns)
        const pivots = []
        for (let i = 0; i < locals.length; i++) {
            let best = -1
            for (let k = 0; k < equations.length; k++) {
                if (best < 0 || Math.abs(equations[k][i]) > Math.abs(equations[best][i])) best = k
            }
            if (best < 0 || Math.abs(equations[best][i]) <= 1e-10) return null
            const [pivot] = equations.splice(best, 1)
            const normalized = pivot.map(x => x / pivot[i])
            pivots.push(normalized)
            for (const row of equations) {
                const k = row[i]
                for (let h = i; h < row.length; h++) row[h] -= k * normalized[h]
            }
        }
        const basis = []
        for (const row of equations) {
            const a = row.slice(locals.length, -1)
            let b = row.at(-1)
            for (const [u, v] of basis) {
                const k = dot(a, u)
                for (let i = 0; i < a.length; i++) a[i] -= k * u[i]
                b -= k * v
            }
            const norm = Math.hypot(...a)
            if (norm <= 1e-10) {
                if (Math.abs(b) > ACCEPT_TOL) return null
                continue
            }
            basis.push([a.map((v) => v / norm), b / norm])
        }
        const change = Array(ids.length).fill(0)
        for (const [u, v] of basis) for (let i = 0; i < ports.length; i++) change[locals.length + i] += v * u[i]
        for (let i = pivots.length - 1; i >= 0; i--) change[i] = pivots[i].at(-1) - dot(change, pivots[i])
        for (let i = 0; i < ids.length; i++) result.get(ids[i])[j] += change[i]
    }
    return [...result.values()].every(finite3) ? result : null
}
