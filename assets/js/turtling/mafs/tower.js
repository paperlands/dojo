// The semantic center: one operation, ordered values, one value or an honest
// refusal. Grammar binds expressions, evaluation obtains values, operations
// combine here, consumers admit the results — frames, observation and lifetimes
// stay outside, so algebra and situation remain legible apart. (id:tower-center)

// A result is an operand: anything this center returns can be handed straight
// back in. That is why it is depth and not a catalogue — component algorithms
// reach the same door, so a vector keeps working when its components stop being
// JavaScript numbers. (id:tower-sota, L6 kingdon)


export const toRadians = (degrees) => degrees * (Math.PI / 180)
export const toDegrees = (radians) => radians * (180 / Math.PI)

// Arithmetic is the substrate's, and nothing else. The center once snapped every sum
// and every builtin result to 1e14, which made the arithmetic incoherent on its own
// terms — `1e-15 * 1` survived while `1e-15 + 0` vanished, and `1 + 1e-15` lost a tail
// double precision held. What a learner SEES is the display's business
// (numerics:format), which never feeds back. (id:tower-center-approximation-ruling)

// Integer division and remainder, moved verbatim. For SAFE INTEGERS with a
// nonzero divisor the quotient and remainder are exact, so
// `(a // b) * b + mod(a, b) = a` holds — a statement about the operands, NOT a
// promise that the language's own * and + stay exact outside the safe range.
function integerMod(a, b) {
    if (Number.isSafeInteger(a) && Number.isSafeInteger(b) && b !== 0) {
        const m = a % b
        if (m !== 0 && (m < 0) !== (b < 0)) return m + b
        return m === 0 ? 0 : m   // normalize the -0 `a % b` can leave
    }
    return ((a % b) + b) % b
}
function integerDiv(a, b) {
    if (Number.isSafeInteger(a) && Number.isSafeInteger(b) && b !== 0) {
        const m = a % b
        const qt = (a - m) / b
        const q = (m !== 0 && (m < 0) !== (b < 0)) ? qt - 1 : qt
        return q === 0 ? 0 : q   // normalize the -0 a negative divisor would leave
    }
    return Math.floor(a / b)
}

// The substrate the codebase already wears (id:tower-tension-repr): numbers, plain
// arrays as vectors, strings, booleans. A new species declares itself through
// `kind`, never by being threaded through a switch.
export function baseTypeOf(value) {
    if (typeof value === 'number') return 'number'
    if (typeof value === 'string') return 'string'
    if (typeof value === 'boolean') return 'boolean'
    if (Array.isArray(value)) return 'vector'
    return 'unknown'
}

// Applicability and failure have one authority, but the failures stay classified:
// a missing meaning is not a broken domain, and neither is a value of two kinds.
export class TowerRefusal extends Error {
    constructor(op, types, detail) {
        super(detail ?? `no meaning for ${op} over ${types.join(' and ')}`)
        this.name = 'TowerRefusal'
        this.op = op
        this.types = types
    }
}

// An operation's own domain was not met — the shape of the question, not the
// availability of arithmetic. dot is rank-one; a ragged or empty vector is this,
// not a missing multiplication that happens to be found late.
export class DomainRefusal extends Error {
    constructor(op, wanted, got) {
        super(`${op} needs ${wanted}, got ${got}`)
        this.name = 'DomainRefusal'
        this.op = op
        this.wanted = wanted
        this.got = got
    }
}

// Two registered recognizers claimed one value. Kinds are dispatch species, not
// every mathematical category a value belongs to — a rational that is also real
// is one kind, not two. Overlapping recognizers are a defect to fix, never a
// precedence to guess. (id:tower-center-boundaries)
export class KindAmbiguity extends Error {
    constructor(kinds) {
        super(`value belongs to two kinds at once: ${kinds.join(' and ')}`)
        this.name = 'KindAmbiguity'
        this.kinds = kinds
    }
}

// Installation ends before evaluation depends on the table. A later define would
// reinterpret a computation already in flight, so it refuses. (id:tower-center-life)
export class RegistrySealed extends Error {
    constructor(what) {
        super(`registry is sealed; ${what} after installation would reinterpret an existing computation`)
        this.name = 'RegistrySealed'
    }
}

export function createTower() {
    // The map, and the set of owned names, live only in this closure. Nothing
    // outside can reach the mutable registry: `define` is the one write path, and
    // inspection hands back copies or handler references, never the live map.
    const table = new Map()
    const names = new Set()
    const kinds = []
    let sealed = false

    const api = {
        get sealed() { return sealed },

        // Installation ends here. Diagnosis and instrumentation may redefine while
        // building; once sealed, the registry a run uses is stable.
        seal() { sealed = true; return api },

        // New mathematics enters through the values: describe a kind, register its
        // meanings. A registered recognizer takes precedence over the built-in
        // classifier, so a species can deliberately take over plain values.
        kind(name, is) {
            if (sealed) throw new RegistrySealed('kind')
            kinds.push([name, is])
            return api
        },

        // A value has one kind or it has none. Registered recognizers come before
        // the built-ins; if two of them both claim the value, the center refuses
        // rather than let registration order decide. (id:tower-center-boundaries)
        typeOf(value) {
            const claimed = kinds.filter(([, is]) => is(value)).map(([name]) => name)
            if (claimed.length > 1) throw new KindAmbiguity(claimed)
            return claimed[0] ?? baseTypeOf(value)
        },

        // The one write path. It refuses once sealed, so no later installation can
        // reinterpret a computation already in flight. (id:tower-center-life)
        define(op, types, fn) {
            if (sealed) throw new RegistrySealed('define')
            table.set(`${op}:${types.join(':')}`, fn)
            names.add(op)
            return api
        },

        // Does the center own this operation's name, whatever the operands? A
        // resolved callable is identified before applicability is tested, so a
        // known name never leaks to another resolver. (id:tower-center-identity)
        known(op) { return names.has(op) },

        // Read-only inspection for instrumentation: a snapshot is a copy, so a
        // caller cannot mutate the registry by holding it.
        keys() { return [...table.keys()] },
        get(op, types) { return table.get(`${op}:${types.join(':')}`) },

        // The one door: a direct meaning wins, otherwise the refusal names the
        // kinds. No promotion fallback — an unearned convenience manufactures an
        // answer, and grade embedding is a decision, not a hook. (id:tower-center-spike)
        apply(op, ...args) {
            const types = args.map((arg) => api.typeOf(arg))
            const handler = table.get(`${op}:${types.join(':')}`)
            if (handler) return handler(...args)
            throw new TowerRefusal(op, types)
        },
    }

    return api
}

// A frozen descriptor — the record and any nested arity list are immutable, so no
// caller can edit the shared authority after the fact. (id:tower-center-authority)
const builtin = (name, arity, fn, shadowable = false) => Object.freeze({
    name,
    arity: Array.isArray(arity) ? Object.freeze([...arity]) : arity,
    fn,
    shadowable,
})

// The authoritative scalar builtin signatures: name, accepted arity, meaning.
// The parser reserves these names and checks their arity from the SAME list the
// evaluator dispatches from, so the two owners cannot disagree.
// (id:notation-phase-center)
export const SCALAR_BUILTINS = Object.freeze([
    builtin('sin', 1, (x) => Math.sin(toRadians(x))),
    builtin('cos', 1, (x) => Math.cos(toRadians(x))),
    builtin('tan', 1, (x) => Math.tan(toRadians(x))),
    builtin('asin', 1, (x) => toDegrees(Math.asin(x))),
    builtin('acos', 1, (x) => toDegrees(Math.acos(x))),
    builtin('atan', 1, (x) => toDegrees(Math.atan(x))),
    builtin('sqrt', 1, (x) => Math.sqrt(x)),
    builtin('log', 1, (x) => Math.log(x)),
    builtin('exp', 1, (x) => Math.exp(x)),
    builtin('abs', 1, (x) => Math.abs(x)),
    builtin('atan2', 2, (y, x) => toDegrees(Math.atan2(y, x))),
    builtin('round', [1, 2], (x, to = 1) => Math.round(x / to) * to, true),
    builtin('mod', 2, (a, b) => integerMod(a, b), true),
])

// A builtin the child may shadow: define your own fn at the same arity and it owns
// that name+arity over the center's. =round= and =mod= are conveniences of policy
// and spelling, so they yield to the child's own word; the rest stay reserved, so
// the surface cannot be redefined by accident. (id:tower-center-shadowable)
export const SHADOWABLE_BUILTINS = Object.freeze(
    SCALAR_BUILTINS.filter((b) => b.shadowable).map((b) => b.name)
)

// ── The scalar species and text ─────────────────────────────────────────────
// `number` and `boolean` are the scalar kinds; `string` is text. A boolean is a
// truth value, not a number, yet it must compose — `!` produces one, and it can
// meet `&&`, `==`, an arithmetic operator or a numerical builtin. The ruling
// (id:tower-center-scalars): *truth assessment and selection* range over every
// value kind (number, boolean, string) and keep native semantics; *arithmetic and
// order* ask for numbers, where a boolean contributes its value 0/1. Strings join
// truth, equality and order but not arithmetic: `+` is numeric, so `'a' + 'b'` refuses
// rather than silently concatenating by a JavaScript accident.
const SCALAR_KINDS = ['number', 'boolean']
const VALUE_KINDS = ['number', 'boolean', 'string']
const TEXT_KINDS = ['string']
const asNum = (value) => typeof value === 'boolean' ? (value ? 1 : 0) : value
// Safe integers need no branch: the substrate's + and - are exact there, and nowhere
// else does this center claim exactness more than double precision already gives.
const plus = (a, b) => a + b
const minus = (a, b) => a - b

// Every ordered tuple of the given arity over a kind set — the explicit closure of
// an operator over its species, never an implicit fallback.
const tuplesOf = (kinds, arity) => {
    let tuples = [[]]
    for (let i = 0; i < arity; i++) tuples = tuples.flatMap((prefix) => kinds.map((kind) => [...prefix, kind]))
    return tuples
}
const across = (tower, op, kinds, fn) => {
    for (const types of tuplesOf(kinds, 2)) tower.define(op, types, fn)
}
const acrossUnary = (tower, op, kinds, fn) => {
    for (const types of tuplesOf(kinds, 1)) tower.define(op, types, fn)
}

// The scalar floor: every operator and builtin the evaluator used to hold in a
// switch, now registrations. Moved verbatim — safe integers stay exact, `+`/`-`
// round on the float branch, `*`/`/` do not, builtins round. (id:tower-synth-dispatch)
export function installScalarFloor(tower) {
    across(tower, '+', SCALAR_KINDS, (a, b) => plus(asNum(a), asNum(b)))
    across(tower, '-', SCALAR_KINDS, (a, b) => minus(asNum(a), asNum(b)))
    across(tower, '*', SCALAR_KINDS, (a, b) => asNum(a) * asNum(b))
    across(tower, '/', SCALAR_KINDS, (a, b) => asNum(a) / asNum(b))
    across(tower, '^', SCALAR_KINDS, (a, b) => Math.pow(asNum(a), asNum(b)))
    across(tower, '//', SCALAR_KINDS, (a, b) => integerDiv(asNum(a), asNum(b)))

    // Logical selection ranges over every value kind; bitwise stays numeric.
    across(tower, '&&', VALUE_KINDS, (a, b) => a && b)
    across(tower, '||', VALUE_KINDS, (a, b) => a || b)
    across(tower, '&', SCALAR_KINDS, (a, b) => a & b)
    across(tower, '|', SCALAR_KINDS, (a, b) => a | b)

    // Identity compares the values as they are; loose equality does its own
    // coercion. Neither borrows `asNum`, or `true === 1` would become 1.
    across(tower, '===', VALUE_KINDS, (a, b) => a === b ? 1 : 0)
    across(tower, '!==', VALUE_KINDS, (a, b) => a !== b ? 1 : 0)
    across(tower, '==', VALUE_KINDS, (a, b) => a == b ? 1 : 0)
    across(tower, '!=', VALUE_KINDS, (a, b) => a != b ? 1 : 0)

    // Order is arithmetic's cousin: a boolean is its value 0/1.
    across(tower, '>=', SCALAR_KINDS, (a, b) => asNum(a) >= asNum(b) ? 1 : 0)
    across(tower, '>', SCALAR_KINDS, (a, b) => asNum(a) > asNum(b) ? 1 : 0)
    across(tower, '<=', SCALAR_KINDS, (a, b) => asNum(a) <= asNum(b) ? 1 : 0)
    across(tower, '<', SCALAR_KINDS, (a, b) => asNum(a) < asNum(b) ? 1 : 0)
    // Text orders lexicographically (alphanumeric); mixed text/number has no honest
    // common order and refuses. (id:tower-center-scalars)
    across(tower, '>=', TEXT_KINDS, (a, b) => a >= b ? 1 : 0)
    across(tower, '>', TEXT_KINDS, (a, b) => a > b ? 1 : 0)
    across(tower, '<=', TEXT_KINDS, (a, b) => a <= b ? 1 : 0)
    across(tower, '<', TEXT_KINDS, (a, b) => a < b ? 1 : 0)

    acrossUnary(tower, '+', SCALAR_KINDS, (x) => +asNum(x))
    acrossUnary(tower, '-', SCALAR_KINDS, (x) => -asNum(x))
    // `!` keeps its boolean result; it is the one prefix whose answer feeds back
    // as a truth, so it ranges over every value kind.
    acrossUnary(tower, '!', VALUE_KINDS, (x) => !x)

    // Numerical builtins participate in the same widening: a boolean argument is
    // its value 0/1, so `sqrt(!0)` is 1. (id:tower-center-scalars)
    for (const { name, arity, fn } of SCALAR_BUILTINS) {
        for (const n of (Array.isArray(arity) ? arity : [arity])) {
            for (const types of tuplesOf(SCALAR_KINDS, n)) {
                tower.define(name, types, (...args) => fn(...args.map(asNum)))
            }
        }
    }

    return tower
}
