// One authority for what a numeric literal is. The lexer, the parser's fold
// check, and the executor's numeric shortcut all read this pattern, so a
// literal's spelling has exactly one meaning on every route. A leading sign is
// a unary operator in the lexer; it is admitted here only because folded values
// arrive already signed. (phase 1: coherent meaning)
export const NUMBER_PATTERN = '\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?'
const NUMERIC_VALUE_RE = new RegExp(`^-?${NUMBER_PATTERN}$`)
export const isNumericLiteral = (str) => typeof str === 'string' && NUMERIC_VALUE_RE.test(str)
