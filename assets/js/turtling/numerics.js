// THE NUMERIC SURFACE — one place a value's condition is named, and one place a
// consumer says what it may do about it. Two questions, deliberately apart:
//
//   SPECIES   | what kind of thing is it?   the tower owns this (baseTypeOf)
//   CONDITION | what condition is it in?    this module owns this
//
// A condition is a FACT about a value, never a verdict about the caller. The verdict
// belongs to the CONSUMER, named once in the table below — so the consumers this table
// names share one predicate, one policy table and one report shape, and a caller keeps
// only the refusal and reporting that are its own. Richer domains keep their own
// authorities: a rigid pose (=SE3.isValid=), a distance's nonnegativity, a GPU
// coordinate. (id:tower-center-approximation)
//
// Its only import is the report shape, itself a leaf: mafs/, laws/ and turtling/
// all reach this without a cycle.
import { notice } from "./report.js"

export const NOTHING = "nothing"     // no answer arrived — a truth, not a wound
export const FINITE = "finite"       // an ordinary number
export const INFINITE = "infinite"   // the arithmetic ran off the number line
export const NAN = "nan"             // the arithmetic produced no number at all
export const NOT_NUMBER = "not-a-number"   // a word, a vector, an object: not a number

export const conditionOf = (value) => {
    if (value === null || value === undefined) return NOTHING
    if (typeof value !== "number") return NOT_NUMBER
    if (Number.isFinite(value)) return FINITE
    return Number.isNaN(value) ? NAN : INFINITE
}

// A message names what it refused. A vector is shown by its STRUCTURE, not by
// JavaScript's lossy String — which renders [null] as '' and a hole as ''. The
// display is a projection for the eye, never a claim of value equality.
// (id:notation-array-growth)
export const spellingOf = (v) => typeof v === "string" ? `'${v}'` : Array.isArray(v) ? format(v) : String(v)


// ── The policy table: the doctrine, in one place ────────────────────────────
// A consumer names itself and gets its answers. `what` names the thing not taken, for
// the sentence the author reads.
// What a consumer may DO, as three orthogonal facts rather than a word. A value is
// taken or the statement is refused; `told` says whether the author is owed a notice;
// `stops` says whether the pass can carry on. HOW LOUD a notice is, is not here: the
// kind's severity lives in one place, weave/queries.js::severityOf. (report.js)
const TAKE = Object.freeze({ verdict: "take" })
const TAKE_DEFAULT = Object.freeze({ verdict: "take", identity: true })
const refuse = (told, stops = false) => Object.freeze({ verdict: "refuse", told, stops })

// The BASE every consumer narrows: a live walk's answer for a measure. It is the
// conservative one — a hole with no answer takes the callable's default and still
// draws, arithmetic that ran out of road is skipped and TOLD, and a word where a
// number belongs is refused and told. A new consumer declares only its differences,
// and a new CONDITION lands in one place: `conditionOf` and its sentence below.
const BASE = Object.freeze({
    what: "the value",
    nothing: TAKE_DEFAULT, finite: TAKE, infinite: refuse(true), nan: refuse(true),
    [NOT_NUMBER]: refuse(true),
})

const POLICY = Object.freeze({
    // A live walk: the base, unanswered.
    walk: BASE,
    // The headless pass that builds the vocabulary judges WORDS, so a word where a
    // measure belongs stops it — and that pass is where a seat's diagnostics come
    // from. A skipped step is quiet here: this pass publishes no ink to miss it.
    vocabulary: Object.freeze({ ...BASE, what: "the word",
        infinite: refuse(false), nan: refuse(false), [NOT_NUMBER]: refuse(true, true) }),
    // A closed construction: a declaration that cannot mean what it says is not a figure.
    construction: Object.freeze({ ...BASE, what: "the build",
        infinite: refuse(false), nan: refuse(false), [NOT_NUMBER]: refuse(true, true) }),
    // A condition and a count are DECISIONS: no brand is taken from no answer, and the
    // author hears why when the answer was a number-shaped non-answer. A nothing is an
    // answer, so it takes no branch quietly. (ruling: nothing-is-not-a-measure)
    condition: Object.freeze({ ...BASE, what: "the branch", nothing: refuse(false) }),
    count: Object.freeze({ ...BASE, what: "the loop", nothing: refuse(false) }),
    // Display: the text a figure writes. It rounds for the eye, and a non-number is
    // NAMED rather than printed as a numeral — the author is told. (ruling 5)
    display: Object.freeze({ ...BASE, what: "the numeral", nothing: TAKE, [NOT_NUMBER]: TAKE }),
})

const say = (condition, { what, expr, value }) => {
    const where = expr || "the value"
    if (condition === INFINITE) return `No measure: ${where} left the number line, so ${what} is not taken`
    if (condition === NAN) return `No measure: ${where} has no answer, so ${what} is not taken`
    if (condition === NOT_NUMBER) return `No measure: ${where} is ${spellingOf(value)}, and ${what} needs a number`
    return `No measure: ${where} is nothing`
}


// ── The one door ───────────────────────────────────────────────────────────
// Ask about a value as a given consumer. Three verdicts, and a notice when the author
// is owed one. Never a throw from here: what a refusal DOES is the caller's, and the
// caller knows whether its pass can carry on.
export function demand(value, { as = "walk", span = null, expr = null } = {}) {
    const policy = POLICY[as] ?? POLICY.walk
    const condition = conditionOf(value)
    const answer = policy[condition] ?? TAKE
    return {
        condition,
        verdict: answer.verdict,
        value: answer.identity ? undefined : value,
        stops: answer.stops === true,
        notice: answer.told === true
            ? notice({ kind: condition, message: say(condition, { what: policy.what, expr, value }), span, expr })
            : null,
    }
}

// A numeric hole or converted result: return its measure/default, or refuse the statement.
// The executor catches this refusal and locates its notice; the finite path allocates nothing.
export function measure(value, options) {
    if (conditionOf(value) === FINITE) return value
    const answer = demand(value, options)
    if (answer.verdict === "take") return answer.value
    const error = new Error(answer.notice?.message ?? `No measure: ${options?.expr ?? "the value"}`)
    error.refusal = answer
    error.kind = answer.condition
    throw error
}


// ── The display gate ───────────────────────────────────────────────────────
// The ONE place a value rounds for the eye, and it never feeds back: the stored value
// keeps every bit, and nothing computed reads this back. The budget is stated (~12
// significant digits) and it is spent cheaply: a spelling that ALREADY fits is the
// answer, and only a residue-laden one is re-rounded. Measured, min-of-N per value:
// String 9-17 ns · this 13 ns on a round value and ~300 ns on a residue · the search
// it replaced 59 ns on a round value but *3665 ns* on 1/3 — a cost that scaled with the
// number, which is the worst shape a display cost can have. (ruling 5; id:nav-numerics)
const BUDGET = 12

// A non-number is never printed as a numeral: it is NAMED.
export function format(value) {
    // A vector has structure; printing it as its components' text would erase that.
    // A singleton carries the terminal comma it was written with, so the display
    // reads back as the vector and not as grouping. (id:notation-array-growth)
    if (Array.isArray(value)) return `[${value.map(format).join(", ")}${value.length === 1 ? "," : ""}]`
    if (typeof value !== "number") return String(value)
    if (!Number.isFinite(value)) return Number.isNaN(value) ? "not a number" : value < 0 ? "-infinity" : "infinity"
    const text = String(value)
    // No decimal spelling this short can carry more than `BUDGET` significant digits.
    return text.length <= BUDGET ? text : String(Number(value.toPrecision(BUDGET)))
}

