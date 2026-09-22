// The instrument seam — application machinery out of the language's eager path.
// Run with: node --test test/js/stage/instruments_test.mjs
//
// WHY THIS EXISTS. The recorder (video export, still capture) is an application
// tool, and it drags mediabunny (418 KB) with it. While the stage imported it
// eagerly, a host bundle for the landing page could not be one file: the export
// path was on the closure. The seam that fixed it is a *shape* — the recorder
// arrives through `instruments`, resolved lazily, and the shell opts in.
//
// This test is the regression fence. It reads SOURCE rather than importing,
// because importing the stage needs WebGL and because the failure it guards is
// exactly a re-imported module edge: silent, and only visible in a bundle that
// nobody rebuilds until release.

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8")

// Comments name members in prose; only code counts as a read.
const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const STAGE = stripComments(read("../../../assets/js/turtling/stage.js"))
const TURTLE = stripComments(read("../../../assets/js/turtling/turtle.js"))
const INNER = stripComments(read("../../../assets/js/hooks/shell/inner.js"))

describe("the instrument seam", () => {
    test("stage.js does not import the recorder", () => {
        assert.equal(
            /from\s+["'][^"']*export\/recorder\.js["']/.test(STAGE),
            false,
            "the recorder is back on the stage's eager path — a host bundle will carry mediabunny again",
        )
    })

    test("the stage takes instruments and resolves the recorder lazily", () => {
        assert.match(
            STAGE,
            /createStage\(\s*canvas,\s*bridge,\s*instruments\s*=\s*\{\}\s*\)/,
            "createStage must take instruments, defaulting to none",
        )
        assert.match(STAGE, /instruments\.recorder/, "the recorder must come from instruments")
        assert.match(
            STAGE,
            /get recorder\(\)\s*\{\s*return recorder\s*\}/,
            "stage.recorder must peek; a status read must not construct the encoder",
        )
        assert.match(
            STAGE,
            /if \(recorderResolved\) recorder\?\.destroy/,
            "dispose destroys a built recorder and must not construct one",
        )
        assert.match(
            STAGE,
            /const video = recorder \? await recorder\.stopRecording/,
            "stopping must peek; it must not construct a recorder that never started",
        )
        assert.match(
            STAGE,
            /await rec\.startRecording\(\)/,
            "record must await the encoder, not drop its rejection",
        )
        // Lazy: resolved on first record or snapshot, not at construction.
        assert.match(STAGE, /recorderResolved/, "the recorder resolution must be memoised")

    })
    test("the turtle forwards instruments to the stage", () => {
        assert.match(
            TURTLE,
            /constructor\(\s*canvas,\s*options\s*=\s*\{\}\s*\)/,
            "Turtle must accept options",
        )
        assert.match(
            TURTLE,
            /createStage\(\s*canvas,\s*this\.bridge,\s*options\.instruments\s*\)/,
            "Turtle must forward options.instruments into createStage",
        )
    })

    test("the shell opts in, so recording is not silently lost", () => {
        assert.match(
            INNER,
            /from\s+["'][^"']*turtling\/export\/recorder\.js["']/,
            "the shell must import the recorder it opts into",
        )
        assert.match(
            INNER,
            /instruments:\s*\{\s*recorder:/,
            "the shell must pass the recorder instrument — otherwise recording dies quietly",
        )
    })

    test("no bare recorder read remains (a host supplies no instrument)", () => {
        assert.equal(
            /this\.stage\.recorder\.\w/.test(TURTLE),
            false,
            "this.stage.recorder.x throws when there is no instrument; read once and guard",
        )
        assert.match(
            TURTLE,
            /const recording = !!this\.stage\.recorder\?\./,
            "the keep-loop recording flag must be null-safe",
        )
    })
})
