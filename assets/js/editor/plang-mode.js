// PaperLang (plang) language mode for CodeMirror 6.
//
// Architecture:
//   - This module has NO static imports of CM6 — it receives {StreamLanguage, foldService}
//     as arguments so it can be used after the vendor bundle is dynamically imported.
//   - Tokenizer is a CM5-compatible StreamParser, adapted for StreamLanguage.define().
//   - Folding is indent-based (equivalent to CM5's fold: "indent") via foldService.
//
// Usage:
//   import { createPlangExtensions } from "./editor/plang-mode.js"
//   // After CM6 is loaded:
//   const extensions = createPlangExtensions(cm6)
//   view.dispatch({ effects: langCompartment.reconfigure(extensions) })

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const INDENT_UNIT = 2; // spaces per indent level (PaperLang convention)

function wordSet(words) {
    const o = {};
    for (let i = 0; i < words.length; i++) o[words[i]] = true;
    return o;
}

export const keywordList = [
    "draw",  "as", "def", "label", "erase", "goto", "do", "fw", "rt", "dive", "roll",
    "hd", "hide", "grid", "lt", "show", "wait", "beColour", "jmp", "fill",
    "jmpto", "faceto", "END", "end", "ensure", "for", "when", "loop", "bold", "fn"
];

const keywords    = wordSet(keywordList);
const indentWords = wordSet(["do"]);
const dedentWords = wordSet(["end"]);
const closing     = wordSet([")", "]", "}"]);

// ---------------------------------------------------------------------------
// Tokenizer internals
// ---------------------------------------------------------------------------

// Module-level: safe in single-threaded JS because token() completes
// synchronously before the next call.
let curPunc = null;

function chain(newtok, stream, state) {
    state.tokenize.push(newtok);
    return newtok(stream, state);
}

function readQuoted(quote, style, embed) {
    return function(stream, state) {
        let escaped = false, ch;

        if (state.context.type === 'read-quoted-paused') {
            state.context = state.context.prev;
            stream.eat("}");
        }

        while ((ch = stream.next()) != null) {
            if (ch === quote && !escaped) {
                state.tokenize.pop();
                break;
            }
            if (embed && ch === "#" && !escaped) {
                if (stream.eat("{")) {
                    if (quote === "}") {
                        state.context = { prev: state.context, type: 'read-quoted-paused' };
                    }
                    state.tokenize.push(tokenBaseUntilBrace());
                    break;
                } else if (/[@$]/.test(stream.peek())) {
                    state.tokenize.push(tokenBaseOnce());
                    break;
                }
            }
            escaped = !escaped && ch === "\\";
        }
        return style;
    };
}

function tokenBaseUntilBrace() {
    let depth = 1;
    return function(stream, state) {
        if (stream.peek() === "}") {
            depth--;
            if (depth === 0) {
                state.tokenize.pop();
                return null;
            }
        } else if (stream.peek() === "{") {
            depth++;
        }
        return tokenBase(stream, state);
    };
}

function tokenBaseOnce() {
    let done = false;
    return function(stream, state) {
        if (done) { state.tokenize.pop(); return null; }
        done = true;
        return tokenBase(stream, state);
    };
}

function regexpAhead(stream) {
    const start = stream.pos;
    let depth = 0, next, found = false, escaped = false;
    while ((next = stream.next()) != null) {
        if (!escaped) {
            if ("[{(".indexOf(next) > -1) {
                depth++;
            } else if ("]})".indexOf(next) > -1) {
                depth--;
                if (depth < 0) break;
            } else if (next === "/" && depth === 0) {
                found = true;
                break;
            }
            escaped = next === "\\";
        } else {
            escaped = false;
        }
    }
    stream.backUp(stream.pos - start);
    return found;
}

function tokenBase(stream, state) {
    if (stream.sol() && stream.match("=begin") && stream.eol()) {
        state.tokenize.push(readBlockComment);
        return "comment";
    }
    if (stream.eatSpace()) return null;

    const ch = stream.next();
    if (ch === "`" || ch === "'" || ch === '"') {
        return chain(readQuoted(ch, "string", ch === '"' || ch === "`"), stream, state);
    } else if (ch === "/") {
        return regexpAhead(stream)
            ? chain(readQuoted(ch, "string-2", true), stream, state)
            : "operator";
    } else if (ch === "#") {
        stream.skipToEnd();
        return "comment";
    } else if (ch === "0") {
        if (stream.eat("x"))      stream.eatWhile(/[\da-fA-F]/);
        else if (stream.eat("b")) stream.eatWhile(/[01]/);
        else                      stream.eatWhile(/[0-7]/);
        return "number";
    } else if (/\d/.test(ch)) {
        stream.match(/^[\d_]*(?:\.[\d_]+)?(?:[eE][+-]?[\d_]+)?/);
        return "number";
    } else if (ch === "@" && stream.match(/^@?[a-zA-Z_\xa1-\uffff]/)) {
        stream.eat("@");
        stream.eatWhile(/[\w\xa1-\uffff]/);
        return "variable-2";
    } else if (ch === "$") {
        if (stream.eat(/[a-zA-Z_]/))      stream.eatWhile(/\w/);
        else if (stream.eat(/\d/))        stream.eat(/\d/);
        else                              stream.next();
        return "variable-3";
    } else if (/[a-zA-Z_\xa1-\uffff]/.test(ch)) {
        stream.eatWhile(/[\w\xa1-\uffff]/);
        stream.eat(/[?!]/);
        if (stream.eat(":")) return "atom";
        return "ident";
    } else if (ch === "|" && (state.varList || state.lastTok === "{" || state.lastTok === "do")) {
        curPunc = "|";
        return null;
    } else if (/[()[\]{}\\;]/.test(ch)) {
        curPunc = ch;
        return null;
    } else if (ch === "-" && stream.eat(">")) {
        return "arrow";
    } else if (/[=+\-/*:.^%<>~|]/.test(ch)) {
        const more = stream.eatWhile(/[=+\-/*:.^%<>~|]/);
        if (ch === "." && !more) curPunc = ".";
        return "operator";
    }
    return null;
}

function readBlockComment(stream, state) {
    if (stream.sol() && stream.match("=end") && stream.eol()) {
        state.tokenize.pop();
    } else {
        stream.skipToEnd();
    }
    return "comment";
}

// ---------------------------------------------------------------------------
// StreamParser spec (passed to StreamLanguage.define)
// ---------------------------------------------------------------------------

const plangModeSpec = {
    name: "plang",

    startState() {
        return {
            tokenize:        [tokenBase],
            indented:        0,
            context:         { type: "top", indented: 0, blockIndent: false },
            continuedLine:   false,
            lastTok:         null,
            varList:         false,
            indentStack:     [],
            dedentPending:   false,
            lastIndent:      0,
            nestedBlockLevel: 0,
        };
    },

    token(stream, state) {
        curPunc = null;
        if (stream.sol()) state.indented = stream.indentation();

        const style   = state.tokenize[state.tokenize.length - 1](stream, state);
        let thisTok   = curPunc;
        let kwtype    = style;

        if (style === "ident") {
            const word = stream.current();
            kwtype = state.lastTok === "." ? "property"
                : keywords.propertyIsEnumerable(word)   ? "keyword"
                : /^[A-Z]/.test(word)                   ? "tag"
                : (state.lastTok === "do" || state.lastTok === "class" || state.varList) ? "def"
                : "variable";

            if (kwtype === "keyword") {
                thisTok = word;
                if (indentWords.propertyIsEnumerable(word)) {
                    state.nestedBlockLevel++;
                    state.indentStack.push(state.indented);
                    state.context = {
                        prev:        state.context,
                        type:        word,
                        indented:    state.indented,
                        blockIndent: true,
                    };
                    state.dedentPending = false;
                } else if (dedentWords.propertyIsEnumerable(word)) {
                    if (state.nestedBlockLevel > 0) state.nestedBlockLevel--;
                    state.lastIndent = state.indentStack.length > 0 ? state.indentStack.pop() : 0;
                    if (state.context && state.context.prev) state.context = state.context.prev;
                    state.dedentPending = true;
                    if (state.nestedBlockLevel === 0) state.dedentPending = false;
                }
            }
        }

        if (curPunc || (style && style !== "comment")) state.lastTok = thisTok;
        if (curPunc === "|") state.varList = !state.varList;

        if (/[([{]/.test(curPunc)) {
            state.context = {
                prev:        state.context,
                type:        curPunc,
                indented:    state.indented,
                blockIndent: false,
            };
        } else if (/[)\]}]/.test(curPunc) && state.context.prev) {
            state.context = state.context.prev;
        }

        if (stream.eol()) state.continuedLine = (curPunc === "\\" || style === "operator");

        return kwtype;
    },

    indent(state, textAfter) {
        const firstChar = textAfter && textAfter.charAt(0);
        const firstWord = textAfter && textAfter.match(/^\s*(\w+)/);

        const isDedent = (firstWord && dedentWords.propertyIsEnumerable(firstWord[1])) ||
                         (firstChar && closing.propertyIsEnumerable(firstChar));

        if (isDedent) {
            return state.indentStack.length > 0
                ? state.indentStack[state.indentStack.length - 1]
                : state.context.indented;
        }

        if (state.dedentPending) {
            state.dedentPending = false;
            return state.lastIndent;
        }

        if (state.continuedLine) return state.indented + INDENT_UNIT;
        if (state.context.blockIndent) return state.context.indented + INDENT_UNIT;

        return state.indented;
    },

    electricInput: /^\s*(?:end|rescue|elsif|else|\})$/,
    lineComment: "#",
};

// ---------------------------------------------------------------------------
// Indent-based fold service
// Equivalent to CM5's fold: "indent" — folds from line end to the last
// consecutive line that has strictly greater indentation.
// ---------------------------------------------------------------------------

function indentFoldService(state, lineStart, lineEnd) {
    const line   = state.doc.lineAt(lineStart);
    const indent = line.text.search(/\S/);
    if (indent < 0) return null; // blank line — not foldable

    let foldTo = -1;

    for (let i = lineEnd + 1; i < state.doc.length; ) {
        const next       = state.doc.lineAt(i);
        const nextIndent = next.text.search(/\S/);

        if (nextIndent < 0) {
            // blank line — skip but keep the fold range open
            i = next.to + 1;
            continue;
        }

        if (nextIndent <= indent) {
                // Include the closing `end` in the fold so the block collapses
                // completely: `repeat 4 do ❦` with end hidden.
                if (foldTo > lineEnd && nextIndent === indent && /^\s*end\b/.test(next.text)) {
                    foldTo = next.to;
                }
                break;
            }

        foldTo = next.to;
        i = next.to + 1;
    }

    return foldTo > lineEnd ? { from: lineEnd, to: foldTo } : null;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

// Returns an extension array ready for langCompartment.reconfigure().
// All CM6 APIs are injected to avoid static imports of the dynamic vendor bundle.
export const createPlangExtensions = ({ StreamLanguage, foldService }) => [
    StreamLanguage.define(plangModeSpec),
    foldService.of(indentFoldService),
];
