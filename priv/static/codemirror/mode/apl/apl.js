// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: https://codemirror.net/5/LICENSE
(function(mod) {
  if (typeof exports == "object" && typeof module == "object")
    mod(require("../../lib/codemirror"));
  else if (typeof define == "function" && define.amd)
    define(["../../lib/codemirror"], mod);
  else
    mod(CodeMirror);
})(function(CodeMirror) {
"use strict";

function wordObj(words) {
  var o = {};
  for (var i = 0, e = words.length; i < e; ++i) o[words[i]] = true;
  return o;
}

var keywordList = [
  "draw", "do", "fw", "rt", "hd", "lt", "show", "wait", "beColour", "jmp", "fill",
  "elsif", "END", "end", "ensure", "false", "for", "when", "loop"
], keywords = wordObj(keywordList);

var indentWords = wordObj(["do"]);
var dedentWords = wordObj(["end"]);
var closing = wordObj([")", "]", "}"]);

CodeMirror.defineMode("plang", function(config) {
  var curPunc;

  function chain(newtok, stream, state) {
    state.tokenize.push(newtok);
    return newtok(stream, state);
  }

  function tokenBase(stream, state) {
    if (stream.sol() && stream.match("=begin") && stream.eol()) {
      state.tokenize.push(readBlockComment);
      return "comment";
    }
    if (stream.eatSpace()) return null;
    var ch = stream.next(), m;
    if (ch == "`" || ch == "'" || ch == '"') {
      return chain(readQuoted(ch, "string", ch == '"' || ch == "`"), stream, state);
    } else if (ch == "/") {
      if (regexpAhead(stream))
        return chain(readQuoted(ch, "string-2", true), stream, state);
      else
        return "operator";
    } else if (ch == "#") {
      stream.skipToEnd();
      return "comment";
    } else if (ch == "<" && (m = stream.match(/^<([-~])[\`\"\']?([a-zA-Z_?]\w*)[\`\"\']?(?:;|$)/))) {
      return chain(readHereDoc(m[2], m[1]), stream, state);
    } else if (ch == "0") {
      if (stream.eat("x")) stream.eatWhile(/[\da-fA-F]/);
      else if (stream.eat("b")) stream.eatWhile(/[01]/);
      else stream.eatWhile(/[0-7]/);
      return "number";
    } else if (/\d/.test(ch)) {
      stream.match(/^[\d_]*(?:\.[\d_]+)?(?:[eE][+\-]?[\d_]+)?/);
      return "number";
    } else if (ch == "@" && stream.match(/^@?[a-zA-Z_\xa1-\uffff]/)) {
      stream.eat("@");
      stream.eatWhile(/[\w\xa1-\uffff]/);
      return "variable-2";
    } else if (ch == "$") {
      if (stream.eat(/[a-zA-Z_]/)) {
        stream.eatWhile(/[\w]/);
      } else if (stream.eat(/\d/)) {
        stream.eat(/\d/);
      } else {
        stream.next();
      }
      return "variable-3";
    } else if (/[a-zA-Z_\xa1-\uffff]/.test(ch)) {
      stream.eatWhile(/[\w\xa1-\uffff]/);
      stream.eat(/[\?\!]/);
      if (stream.eat(":")) return "atom";
      return "ident";
    } else if (ch == "|" && (state.varList || state.lastTok == "{" || state.lastTok == "do")) {
      curPunc = "|";
      return null;
    } else if (/[\(\)\[\]{}\\;]/.test(ch)) {
      curPunc = ch;
      return null;
    } else if (ch == "-" && stream.eat(">")) {
      return "arrow";
    } else if (/[=+\-\/*:\.^%<>~|]/.test(ch)) {
      var more = stream.eatWhile(/[=+\-\/*:\.^%<>~|]/);
      if (ch == "." && !more) curPunc = ".";
      return "operator";
    } else {
      return null;
    }
  }

  function regexpAhead(stream) {
    var start = stream.pos, depth = 0, next, found = false, escaped = false;
    while ((next = stream.next()) != null) {
      if (!escaped) {
        if ("[{(".indexOf(next) > -1) {
          depth++;
        } else if ("]})".indexOf(next) > -1) {
          depth--;
          if (depth < 0) break;
        } else if (next == "/" && depth == 0) {
          found = true;
          break;
        }
        escaped = next == "\\";
      } else {
        escaped = false;
      }
    }
    stream.backUp(stream.pos - start);
    return found;
  }

  return {
    startState: function() {
      return {
        tokenize: [tokenBase],
        indented: 0,
        context: {type: "top", indented: 0, blockIndent: false}, // Corrected indented to 0
        continuedLine: false,
        lastTok: null,
        varList: false,
        indentStack: [],
        dedentPending: false,
        lastIndent: 0, // Corrected initial lastIndent to 0
        nestedBlockLevel: 0
      };
    },

    token: function(stream, state) {
      curPunc = null;
      if (stream.sol()) {
        state.indented = stream.indentation();
      }

      var style = state.tokenize[state.tokenize.length-1](stream, state), kwtype;
      var thisTok = curPunc;

      if (style == "ident") {
        var word = stream.current();
        style = state.lastTok == "." ? "property"
          : keywords.propertyIsEnumerable(stream.current()) ? "keyword"
          : /^[A-Z]/.test(word) ? "tag"
          : (state.lastTok == "do" || state.lastTok == "class" || state.varList) ? "def"
          : "variable";

        if (style == "keyword") {
          thisTok = word;

          if (indentWords.propertyIsEnumerable(word)) {
            state.nestedBlockLevel++;
            state.indentStack.push(state.indented);
            state.context = {
              prev: state.context,
              type: word,
              indented: state.indented,
              blockIndent: true
            };
          } else if (dedentWords.propertyIsEnumerable(word)) {
            if (state.nestedBlockLevel > 0) {
              state.nestedBlockLevel--;
            }
            state.lastIndent = state.indentStack.length > 0 ? state.indentStack.pop() : 0;
            if (state.context && state.context.prev) {
              state.context = state.context.prev;
            }
            state.dedentPending = true; // Trigger dedent for the next line
          }
        }
      }

      if (curPunc || (style && style != "comment")) state.lastTok = thisTok;
      if (curPunc == "|") state.varList = !state.varList;

      if (/[\(\[\{]/.test(curPunc)) {
        state.context = {
          prev: state.context,
          type: curPunc,
          indented: state.indented,
          blockIndent: false
        };
      } else if (/[\)\]\}]/.test(curPunc) && state.context.prev) {
        state.context = state.context.prev;
      }

      if (stream.eol())
        state.continuedLine = (curPunc == "\\" || style == "operator");

      return style;
    },

    indent: function(state, textAfter) {
      var firstChar = textAfter && textAfter.charAt(0);
      var firstWord = textAfter && textAfter.match(/^\s*(\w+)/);

      var isDedent = firstWord && dedentWords.propertyIsEnumerable(firstWord[1]) ||
                     firstChar && closing.propertyIsEnumerable(firstChar);


      // Handle lines starting with dedent keywords/closing brackets
      if (isDedent) {
        return state.indentStack.length > 0
          ? state.indentStack[state.indentStack.length - 1]
          : state.context.indented;
      }

      // Apply pending dedent from previous line's 'end'
      if (state.dedentPending) {
        console.log(state.indentStack)
        state.dedentPending = false;
        return state.lastIndent;
      }



      // Handle continued lines
      if (state.continuedLine) {
        return state.indented + config.indentUnit;
      }

      // Indent if inside a block
      if (state.context.blockIndent) {
        return state.context.indented + config.indentUnit;
      }

      return state.indented;
    },

    electricInput: /^\s*(?:end|rescue|elsif|else|\})$/,
    lineComment: "#",
    fold: "indent"
  };
});

CodeMirror.defineMIME("text/x-plang", "plang");
CodeMirror.registerHelper("hintWords", "plang", keywordList);
});
