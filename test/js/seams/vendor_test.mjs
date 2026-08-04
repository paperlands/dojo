// Vendored files are immutable, and version claims must be true.
//
// scripts/vendor_verify.sh holds the actual rules. This test exists so they are
// ENFORCED rather than merely available: CI already runs `node --test test/js/`
// (.github/workflows/ci.yml, the zero-npm js job), so riding that path costs no
// new CI step and no second hook. A rule that runs only when someone remembers
// to run it is a convention, not a guarantee.
//
// Pure shell + node:child_process — the js CI job installs nothing, so this must
// never reach for scripts/node_modules.

import { test, describe } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../../../", import.meta.url))

describe("vendored files", () => {
    test("have not drifted from their recorded hashes", () => {
        try {
            execFileSync("bash", ["scripts/vendor_verify.sh"], {
                cwd: ROOT,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "pipe"]
            })
        } catch (err) {
            // The script says exactly what moved and how to put it right;
            // surface that verbatim rather than a bare exit code.
            assert.fail(`scripts/vendor_verify.sh reported drift:\n\n${err.stderr || err.message}`)
        }
    })
})
