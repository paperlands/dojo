#!/usr/bin/env node
// Builds the CM6 vendor bundle for Dojo.
// Output: ../priv/static/vendor/cm6.js (ESM format, minified) + cm6.manifest.json
//
// Usage:
//   cd scripts && npm install && node vendor-cm6.mjs
//
// The output file is committed to git. CI/CD never runs this script.
// Re-run when updating CM6 versions in package.json.

import * as esbuild from "esbuild"
import { createHash } from "crypto"
import { readFileSync, writeFileSync } from "fs"

const OUT = "../priv/static/vendor/cm6.js"
const MANIFEST = "../priv/static/vendor/cm6.manifest.json"

// The RESOLVED version, never the `^6.36.3` range in package.json. The range's
// floor drifted seven minors below what actually shipped and nobody saw it,
// because the build printed the floor.
const version = JSON.parse(
  readFileSync("node_modules/@codemirror/view/package.json", "utf8"),
).version

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex")

await esbuild.build({
  entryPoints: ["cm6-entry.js"],
  bundle: true,
  format: "esm",
  minify: true,
  legalComments: "none",
  outfile: OUT,
})

// Provenance rides in a sidecar, not a banner inside cm6.js: the bundle stays
// byte-identical to a plain esbuild run, so anyone can rebuild and diff.
const bundle = readFileSync(OUT)
const digest = sha256(bundle)

// The consumer's `?v=` token. CONTENT-ADDRESSED, not just the version: widening
// cm6-entry.js, or any of the nine bundled packages moving, changes the bytes
// while `@codemirror/view` stays put — a version-only token would serve a stale
// cache and a one-package token would speak for eight packages it never saw.
const token = `${version}-${digest.slice(0, 8)}`

writeFileSync(
  MANIFEST,
  JSON.stringify(
    {
      version,
      token,
      sha256: digest,
      entryHash: sha256(readFileSync("cm6-entry.js")),
      // The artifact hash proves nobody hand-edited cm6.js. This one proves the
      // committed artifact came from the committed lockfile.
      lockfileHash: sha256(readFileSync("package-lock.json")),
    },
    null,
    2,
  ) + "\n",
)

const kb = (bundle.length / 1024).toFixed(1)
console.log(`Built ${OUT} — ${kb}KB (@codemirror/view ${version})`)
console.log(`Wrote ${MANIFEST}`)
console.log(
  `Consumer token: assets/js/hooks/shell/core.js must import '/vendor/cm6.js?v=${token}'`,
)
console.log(`Check with: ./scripts/vendor_verify.sh`)
