// Delimiter kinds — one authority for "which closer belongs to which opener".
//
// '(' ')' and '[' ']' are DISTINCT kinds. A pair must be kind-consistent: (2] is
// refused where it occurs, never silently closed. Each kind has its own job: `( )`
// groups (and, after a name, calls); `[ ]` CONSTRUCTS a vector (and, after a name,
// still calls). Indexing stays a later rung. (id:notation-array-growth)
export const GLYPH = { LPAREN: '(', RPAREN: ')', LBRACKET: '[', RBRACKET: ']' }
export const TYPE_OF_GLYPH = { '(': 'LPAREN', ')': 'RPAREN', '[': 'LBRACKET', ']': 'RBRACKET' }
export const isOpenType = (t) => t === 'LPAREN' || t === 'LBRACKET'
export const isCloseType = (t) => t === 'RPAREN' || t === 'RBRACKET'
export const closerTypeFor = (openType) => (openType === 'LPAREN' ? 'RPAREN' : 'RBRACKET')
export const glyphOf = (type) => GLYPH[type]
