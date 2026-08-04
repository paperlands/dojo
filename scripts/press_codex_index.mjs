#!/usr/bin/env node
// Press the codex fragment drawers into codex/fragments/index.json
// (served at /codex/index.json via the priv/static/codex symlink).
//
// The corpus's one GENERATED projection (Q2, <2026-07-12>): id → entry.
// Rebuildable, the machine's share — never hand-kept, never a second
// namespace. Rides the Phase 2 asset task (mix assets.build / assets.deploy)
// so a rename in codex/fragments/ re-presses the map the resolver walks by.
//
// Each entry is the fragment's whole drawer face, pressed flat so any
// fragment can stand as a door (the Pattern Language stance: enter anywhere,
// walk up to context, down to detail):
//
//   name       — file stem relative to the fragments root (spirals, primitives/control/as)
//   title      — #+title, else the top headline text, else the name
//   type       — :TYPE: (pattern | primitive | reference)
//   tags       — #+FILETAGS: atoms, minus the scaffolding (codex/fragment/primitive);
//                the tag groups DERIVE from these (weave/fragments.js tagGroups)
//   theme      — :THEME: verbatim (the author's grouping phrase)
//   invariance — :INVARIANCE: (invariant | progress | tentative — APL's asterisks)
//   state      — :STATE: (seed | germinating | interwoven)
//   primitive  — :PRIMITIVE: (gesture | state | member), primitives only
//   of         — :OF: family id, primitives only
//   toward     — :TOWARD: vision id, unwrapped from its [[id:…]] portal
//   links      — [[id:…]] targets in the BODY, in reading order, deduped,
//                self excluded (the fragment's own outward threads)
//   backlinks  — inversion of links across the index (who threads here) —
//                the "broader patterns" face, computed, never authored
//
// Laws of the press:
//   - Files without an :ID: in their first drawer are skipped (they cannot
//     join the id-face map).
//   - Underscore paths (_variants/, _anything) are the WORKSHOP: never
//     walked, never pressed. The shelf stays behind the shop door.
//   - Property/keyword lines never leak into links; only body prose is read.
//
// Modes:
//   (default)  press and write the index
//   --check    press in memory and diff against the file on disk — silent
//              and exit 0 when vital, loud and exit 1 when stale
//              (nav_verify's stance, applied to the pressed projection).

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises"
import { join, relative, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const FRAGMENTS = join(ROOT, "codex", "fragments")
const OUT = join(FRAGMENTS, "index.json")

// Filetags that carry no grouping information: the corpus mark and the
// type echo (type already stands in the entry).
const SCAFFOLD_TAGS = new Set(["codex", "fragment", "primitive"])

// Drawer keys pressed into the entry, in the order the entry wears them.
const DRAWER_FACE = [
    ["TYPE", "type"],
    ["THEME", "theme"],
    ["INVARIANCE", "invariance"],
    ["STATE", "state"],
    ["PRIMITIVE", "primitive"],
    ["OF", "of"],
    ["TOWARD", "toward"],
]

async function* walkOrg(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
        if (e.name.startsWith("_")) continue // the workshop stays in the shop
        const path = join(dir, e.name)
        if (e.isDirectory()) {
            yield* walkOrg(path)
        } else if (e.isFile() && e.name.endsWith(".org")) {
            yield path
        }
    }
}

// Unwrap a drawer value: `[[id:frag-roundness]]` → `frag-roundness`,
// `[[id:x][label]]` → `x`; bare values pass through untouched.
function unwrapId(value) {
    const m = value.match(/^\[\[id:([^\]\[]+?)\](?:\[[^\]]*\])?\]$/)
    return m ? m[1].trim() : value
}

// Harvest one fragment's face from its org text.
// Properties come from the FIRST drawer only (section drawers below belong
// to their sections); links come from body lines only (never drawers or
// #+keywords, so :TOWARD: portals don't masquerade as threads).
export function harvest(text) {
    const props = {}
    let title = null
    let topHeadline = null
    let tags = []
    const links = []
    const seen = new Set()

    let inDrawer = false
    let firstDrawerDone = false

    for (const raw of text.split(/\r\n|\r|\n/)) {
        const line = raw.trim()
        if (inDrawer) {
            if (/^:END:\s*$/i.test(line)) {
                inDrawer = false
                firstDrawerDone = true
                continue
            }
            if (!firstDrawerDone) {
                const m = line.match(/^:([A-Za-z_-]+):\s*(.+)$/)
                if (m && props[m[1].toUpperCase()] == null) {
                    props[m[1].toUpperCase()] = m[2].trim()
                }
            }
            continue
        }
        if (/^:PROPERTIES:\s*$/i.test(line)) { inDrawer = true; continue }
        if (line.startsWith("#+")) {
            let m
            if (title == null && (m = line.match(/^#\+title:\s*(.+)$/i))) {
                title = m[1].trim()
            } else if ((m = line.match(/^#\+filetags:\s*(.+)$/i))) {
                tags = m[1].split(":").map(t => t.trim())
                    .filter(t => t && !SCAFFOLD_TAGS.has(t.toLowerCase()))
            }
            continue
        }
        if (topHeadline == null) {
            const m = line.match(/^\*+\s+(.*)$/)
            if (m) {
                topHeadline = m[1].replace(/\s*\*+\s*$/, "").trim()
                continue
            }
        }
        // Body prose: gather the outward threads.
        for (const m of raw.matchAll(/\[\[id:([^\]\[]+?)\](?:\[[^\]]*\])?\]/g)) {
            const target = m[1].trim()
            if (!seen.has(target)) { seen.add(target); links.push(target) }
        }
    }

    return { id: props.ID ?? null, title: title ?? topHeadline, props, tags, links }
}

// Press every fragment under `root` into the index object: id → entry,
// alphabetical by id, backlinks inverted across the pressed set.
export async function press(root = FRAGMENTS) {
    const index = {}
    for await (const path of walkOrg(root)) {
        const rel = relative(root, path)
        const name = rel.replace(/\.org$/i, "").replace(/\\/g, "/")
        const { id, title, props, tags, links } = harvest(await readFile(path, "utf8"))
        if (!id) continue
        const entry = { name, title: title ?? name }
        for (const [key, face] of DRAWER_FACE) {
            if (props[key] != null) entry[face] = unwrapId(props[key])
        }
        if (tags.length) entry.tags = tags
        entry.links = links.filter(t => t !== id)
        index[id] = entry
    }

    // Backlinks: who threads here, across the pressed set only.
    for (const id of Object.keys(index)) {
        const inbound = Object.keys(index)
            .filter(other => other !== id && index[other].links.includes(id))
            .sort()
        if (inbound.length) index[id].backlinks = inbound
    }

    // Stable key order for clean diffs.
    return Object.fromEntries(
        Object.entries(index).sort(([a], [b]) => a.localeCompare(b)),
    )
}

function render(index) {
    return JSON.stringify(index, null, 2) + "\n"
}

async function main() {
    const check = process.argv.includes("--check")
    const pressed = await press()

    if (check) {
        let onDisk = null
        try {
            onDisk = JSON.parse(await readFile(OUT, "utf8"))
        } catch {
            console.error(`STALE codex index: ${relative(ROOT, OUT)} missing or unreadable — run \`mix press.codex\``)
            process.exit(1)
        }
        const drift = []
        for (const id of Object.keys(pressed)) {
            if (!(id in onDisk)) drift.push(`  + ${id} (pressed but absent from index.json)`)
            else if (JSON.stringify(onDisk[id]) !== JSON.stringify(pressed[id]))
                drift.push(`  ~ ${id} (entry drifted from its drawer)`)
        }
        for (const id of Object.keys(onDisk)) {
            if (!(id in pressed)) drift.push(`  - ${id} (in index.json but no longer pressed)`)
        }
        if (drift.length) {
            console.error(`STALE codex index — run \`mix press.codex\`:`)
            for (const line of drift) console.error(line)
            process.exit(1)
        }
        return // silent when vital
    }

    await mkdir(dirname(OUT), { recursive: true })
    await writeFile(OUT, render(pressed), "utf8")
    const n = Object.keys(pressed).length
    console.log(`pressed ${n} fragment${n === 1 ? "" : "s"} → ${relative(ROOT, OUT)}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main().catch((err) => {
        console.error(err)
        process.exit(1)
    })
}
