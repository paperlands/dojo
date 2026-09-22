// Host door (D030). Source fence — a live walk is scripts/verify/host_play.sh.
import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const src = readFileSync(new URL("../../../assets/js/host.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

describe("host door", () => {
    test("play is the verb, and onBeat is not a parameter", () => {
        assert.match(src, /export function createHatch\(canvas, \{ caps \} = \{\}\)/)
        assert.match(src, /async play\(program\)/)
        assert.equal(/function createHatch\([^)]*onBeat/.test(src), false)
        assert.equal(/\bseat\(/.test(src), false)
    })

    test("finished is the other fact, and a new play supersedes the old one", () => {
        assert.match(src, /finished/)
        assert.match(src, /scheduler\?\.done/)
        assert.match(src, /new Error\("superseded"\)/)
        assert.match(src, /new Error\("hatch disposed"\)/)
    })

    test("a refusal names the wound's line", () => {
        assert.match(src, /wound\?\.span\?\.line/)
        assert.match(src, /\(line \$\{line\}\)/)
    })

    test("caps ride into the turtle, the recorder does not", () => {
        assert.match(src, /new Turtle\(canvas, \{ caps \}\)/)
        assert.equal(/recorder/.test(src), false)
    })
})
