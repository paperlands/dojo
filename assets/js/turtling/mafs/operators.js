// The surface is fixed here; scoped word declarations come later. (id:tower-surface)
/**
 * @typedef {Object} Operator
 * @property {string} lexeme
 * @property {boolean} word
 * @property {'infix'|'prefix'} fixity
 * @property {'left'|'right'} assoc
 * @property {number} prec
 */

/** @type {ReadonlyArray<Readonly<Operator>>} */
export const OPERATOR_ROWS = Object.freeze([
    { lexeme: '||',  word: false, fixity: 'infix', assoc: 'left',  prec: 1 },
    { lexeme: '&&',  word: false, fixity: 'infix', assoc: 'left',  prec: 2 },
    { lexeme: '|',   word: false, fixity: 'infix', assoc: 'left',  prec: 3 },
    { lexeme: '&',   word: false, fixity: 'infix', assoc: 'left',  prec: 4 },
    { lexeme: '===', word: false, fixity: 'infix', assoc: 'left',  prec: 5 },
    { lexeme: '!==', word: false, fixity: 'infix', assoc: 'left',  prec: 5 },
    { lexeme: '==',  word: false, fixity: 'infix', assoc: 'left',  prec: 5 },
    { lexeme: '!=',  word: false, fixity: 'infix', assoc: 'left',  prec: 5 },
    { lexeme: '>=',  word: false, fixity: 'infix', assoc: 'left',  prec: 6 },
    { lexeme: '>',   word: false, fixity: 'infix', assoc: 'left',  prec: 6 },
    { lexeme: '<=',  word: false, fixity: 'infix', assoc: 'left',  prec: 6 },
    { lexeme: '<',   word: false, fixity: 'infix', assoc: 'left',  prec: 6 },
    { lexeme: '+',   word: false, fixity: 'infix', assoc: 'left',  prec: 7 },
    { lexeme: '-',   word: false, fixity: 'infix', assoc: 'left',  prec: 7 },
    { lexeme: '*',   word: false, fixity: 'infix', assoc: 'left',  prec: 8 },
    { lexeme: '/',   word: false, fixity: 'infix', assoc: 'left',  prec: 8 },
    { lexeme: '//',  word: false, fixity: 'infix', assoc: 'left',  prec: 8 },
    { lexeme: 'mod', word: true,  fixity: 'infix', assoc: 'left',  prec: 8 },
    { lexeme: '^',   word: false, fixity: 'infix', assoc: 'right', prec: 9 },
    { lexeme: '+',   word: false, fixity: 'prefix', assoc: 'right', prec: 10 },
    { lexeme: '-',   word: false, fixity: 'prefix', assoc: 'right', prec: 10 },
    { lexeme: '!',   word: false, fixity: 'prefix', assoc: 'right', prec: 10 },
].map(Object.freeze))

const byFixity = { infix: new Map(), prefix: new Map() }
const vocabulary = new Map()
for (const row of OPERATOR_ROWS) {
    byFixity[row.fixity].set(row.lexeme, row)
    vocabulary.set(row.lexeme, row)
}

export const getOperator = (lexeme, fixity) => byFixity[fixity]?.get(lexeme)
export const isOperatorLexeme = (lexeme) => vocabulary.has(lexeme)
export const OPERATOR_LEXEMES = Object.freeze(
    [...vocabulary.keys()].sort((a, b) => b.length - a.length)
)

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const alternatives = (word) => OPERATOR_LEXEMES
    .filter((lexeme) => vocabulary.get(lexeme).word === word)
    .map(escapeRegex).join('|')

// Digits may touch words (7mod3); letters, underscores and dotted names may not.
export const WORD_OPERATOR_PATTERN = `(?:${alternatives(true)})(?![a-zA-Z_]|[0-9]*\\.[a-zA-Z])`
export const SYMBOL_OPERATOR_PATTERN = `(?:${alternatives(false)})`
