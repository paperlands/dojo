// The surface is fixed here; scoped word declarations come later. (id:tower-surface)
/**
 * @typedef {Object} Operator
 * @property {string} lexeme
 * @property {'infix'|'prefix'} fixity
 * @property {'left'|'right'} assoc
 * @property {number} prec
 */

/** @type {ReadonlyArray<Readonly<Operator>>} */
export const OPERATOR_ROWS = Object.freeze([
    { lexeme: '||',  fixity: 'infix', assoc: 'left',  prec: 1 },
    { lexeme: '&&',  fixity: 'infix', assoc: 'left',  prec: 2 },
    { lexeme: '|',   fixity: 'infix', assoc: 'left',  prec: 3 },
    { lexeme: '&',   fixity: 'infix', assoc: 'left',  prec: 4 },
    { lexeme: '===', fixity: 'infix', assoc: 'left',  prec: 5 },
    { lexeme: '!==', fixity: 'infix', assoc: 'left',  prec: 5 },
    { lexeme: '==',  fixity: 'infix', assoc: 'left',  prec: 5 },
    { lexeme: '!=',  fixity: 'infix', assoc: 'left',  prec: 5 },
    { lexeme: '>=',  fixity: 'infix', assoc: 'left',  prec: 6 },
    { lexeme: '>',   fixity: 'infix', assoc: 'left',  prec: 6 },
    { lexeme: '<=',  fixity: 'infix', assoc: 'left',  prec: 6 },
    { lexeme: '<',   fixity: 'infix', assoc: 'left',  prec: 6 },
    { lexeme: '+',   fixity: 'infix', assoc: 'left',  prec: 7 },
    { lexeme: '-',   fixity: 'infix', assoc: 'left',  prec: 7 },
    { lexeme: '*',   fixity: 'infix', assoc: 'left',  prec: 8 },
    { lexeme: '/',   fixity: 'infix', assoc: 'left',  prec: 8 },
    { lexeme: '//',  fixity: 'infix', assoc: 'left',  prec: 8 },
    { lexeme: '^',   fixity: 'infix', assoc: 'right', prec: 9 },
    { lexeme: '+',   fixity: 'prefix', assoc: 'right', prec: 10 },
    { lexeme: '-',   fixity: 'prefix', assoc: 'right', prec: 10 },
    { lexeme: '!',   fixity: 'prefix', assoc: 'right', prec: 10 },
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
export const OPERATOR_PATTERN = `(?:${OPERATOR_LEXEMES.map(escapeRegex).join('|')})`
