// The vocabulary is the fence (specs link-actions, id:la-vocabulary).
//
// la-green asked a reader to run two greps by hand. A fence nobody runs is
// prose; these tests run it. Every word a surface reads must be declared,
// and the engine must stay the only reader of the address.
//
// Run: node --test test/js/link/vocabulary_test.mjs

import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { WORDS } from "../../../assets/js/link.js"
import { SERVER } from "../../../assets/js/kernel/link.js"

const ASSETS = fileURLToPath(new URL("../../../assets/js", import.meta.url))

// The two seats allowed to touch the address: the engine, and the singleton
// that seeds and writes it.
const ENGINE = ["kernel/link.js", "link.js"]

function sources(dir = ASSETS, at = "", ext = ".js") {
    const out = []
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules") continue
        const full = join(dir, entry)
        const rel = at ? `${at}/${entry}` : entry
        if (statSync(full).isDirectory()) out.push(...sources(full, rel, ext))
        else if (entry.endsWith(ext)) out.push({ rel, text: readFileSync(full, "utf8") })
    }
    return out
}

const TREE = sources()

describe("every word a surface speaks is declared (id:la-vocabulary)", () => {
    test("link.read / link.carry name only declared words", () => {
        const undeclared = []
        for (const { rel, text } of TREE) {
            for (const m of text.matchAll(/\blink\.(?:read|carry)\(\s*["'`]([^"'`]+)["'`]/g)) {
                if (!(m[1] in WORDS)) undeclared.push(`${rel}: ${m[1]}`)
            }
        }
        assert.deepEqual(undeclared, [], "add the row to WORDS before reading the word")
    })

    test("one word, one owner — no two client surfaces share a word", () => {
        // A word is owned by exactly one file; two readers is a design fault
        // the table must be able to name, so read the tree back against it.
        const readers = new Map()
        for (const { rel, text } of TREE) {
            if (ENGINE.includes(rel)) continue
            for (const m of text.matchAll(/\blink\.(?:read|carry)\(\s*["'`]([^"'`]+)["'`]/g)) {
                if (!readers.has(m[1])) readers.set(m[1], new Set())
                readers.get(m[1]).add(rel)
            }
        }
        for (const [word, files] of readers) {
            assert.equal([...files].join(", "), WORDS[word], `${word} is read off its owner`)
        }
    })

    test("a server word has no client reader", () => {
        for (const [word, owner] of Object.entries(WORDS)) {
            if (owner !== SERVER) continue
            for (const { rel, text } of TREE) {
                if (ENGINE.includes(rel)) continue
                assert.ok(
                    !text.includes(`link.read("${word}")`),
                    `${rel} reads ${word}, which the server owns`,
                )
            }
        }
    })
})

describe("mount is the whole enactment (id:la-law)", () => {
    // Nothing patches, so every navigation replaces the main view and births
    // the hook again. A listener does not add an enactment — it races one.
    for (const probe of ["phx:navigate", "popstate"]) {
        test(`no surface listens for ${probe}`, () => {
            const found = TREE.filter((f) => f.text.includes(probe)).map((f) => f.rel)
            assert.deepEqual(found, [], "the remount re-reads the address by itself")
        })
    }

    // Watch the PREMISE, not the conclusion. Mount-only is safe *because*
    // nothing patches — the one LiveView path that keeps a hook alive across
    // a URL change. The day something patches, this red is the re-argument.
    test("nothing patches — the premise mount-only rests on", () => {
        const lib = fileURLToPath(new URL("../../../lib", import.meta.url))
        const patches = []
        for (const { rel, text } of sources(lib, "", ".ex")) {
            for (const m of text.matchAll(/push_patch|<\.link[^>]*\spatch=/g)) {
                patches.push(`${rel}: ${m[0]}`)
            }
        }
        assert.deepEqual(
            patches,
            [],
            "a patch keeps the hook alive across a URL change — ?fork would stop re-enacting (id:la-law)",
        )
    })
})

describe("no second engine (id:la-not)", () => {
    for (const probe of ["location.search", "URLSearchParams", "history.replaceState", "history.pushState"]) {
        test(`${probe} lives only in the engine`, () => {
            const found = TREE.filter((f) => f.text.includes(probe)).map((f) => f.rel)
            assert.deepEqual(
                found.filter((rel) => !ENGINE.includes(rel)),
                [],
                "a surface parsing or writing location itself is the regression",
            )
        })
    }
})
