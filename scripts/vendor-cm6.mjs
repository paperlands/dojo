#!/usr/bin/env node
// Builds the CM6 vendor bundle for Dojo.
// Output: ../priv/static/vendor/cm6.js (ESM format, minified)
//
// Usage:
//   cd scripts && npm install && node vendor-cm6.mjs
//
// The output file is committed to git. CI/CD never runs this script.
// Re-run when updating CM6 versions in package.json.

import * as esbuild from "esbuild"
import { readFileSync } from "fs"

const pkg = JSON.parse(readFileSync("package.json", "utf8"))
const cm6Version = pkg.devDependencies["@codemirror/view"].replace(/[\^~]/, "")

const result = await esbuild.build({
  entryPoints: ["cm6-entry.js"],
  bundle: true,
  format: "esm",
  minify: true,
  legalComments: "none",
  outfile: "../priv/static/vendor/cm6.js",
  metafile: true,
})

// Print what was included
const outputs = Object.keys(result.metafile.outputs)
const bytes = result.metafile.outputs[outputs[0]]?.bytes ?? 0
const kb = (bytes / 1024).toFixed(1)

console.log(`Built priv/static/vendor/cm6.js — ${kb}KB (cm6 ~${cm6Version})`)
console.log(`CM6_VERSION = "${cm6Version}" (update shell.js import URL if bumping major)`)
