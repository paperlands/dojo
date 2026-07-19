// checkTree self-test — the lint must catch what it claims to catch, and
// pass the whole living grammar. Run with: node --test test/js/check_tree_test.mjs

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { parseProgram, reparseProgram } from "../../assets/js/turtling/parse.js"
import { checkTree, treeKey } from "./check_tree.mjs"

const CORPUS = [
    "fw 10",
    "loop 4 do\nfw 10\nrt 90\nend",
    "def grow n do\nfw n\nend\ngrow 5",
    "as sky do\nfw 5\nend",
    "when 'ping' p do\nfw p\nend",
    "###\na meadow\n```\nfw 10\n```\n###",
    "fw 10 # a margin note",
    "loop 3 do\nfw 1",            // unterminated — error node with children
    "end",                        // stray end — error node
    "as do\nfw 1\nend",           // broken head
]

describe("checkTree — the seam lint", () => {
    test("the living grammar passes whole, parse and reparse", () => {
        for (const text of CORPUS) {
            const ast = parseProgram(text)
            checkTree(ast)
            const edited = text + "\nbk 2"
            const reparsed = reparseProgram(edited, text, ast)
            checkTree(reparsed)
        }
    })

    test("an unledgered meta key is caught (the unnamed primitive)", () => {
        const ast = parseProgram("fw 10")
        ast[0].meta.smuggled = true
        assert.throws(() => checkTree(ast), /unledgered meta key 'smuggled'/)
    })

    test("a missing span is caught", () => {
        const ast = parseProgram("fw 10")
        ast[0].span = null
        assert.throws(() => checkTree(ast), /bad span/)
    })

    test("treeKey ignores sanctioned span adoption, catches content mutation", () => {
        const ast = parseProgram("fw 10\nrt 90")
        const before = treeKey(ast)
        ast[1].span.line = 99                    // the red overlay may move
        assert.equal(treeKey(ast), before)
        ast[0].value = "bk"                      // the content may not
        assert.notEqual(treeKey(ast), before)
    })
})
