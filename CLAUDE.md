# CLAUDE.md

**Dojo** — LOGO for the networked era. Phoenix/LiveView, Partisan clustering, PaperLang turtles. This file is a kernel: commands, dispatch, constraints. Knowledge lives in the org constellation and loads on demand.

## Commands

```bash
mix setup                        # Install deps and compile assets
mix test                         # All Elixir tests (path:line for one)
node --test test/js/<file>.mjs   # JS tests (zero-npm, node:test)
mix format                       # Before committing
mix release                      # Production release (Burrito)

# Dev server (with clustering)
iex --sname dojo --cookie enterthedojo --dbg pry -S mix phx.server
```

## Classify Before Exploring (Cynefin)

- **Simple** (rename, typo, config) — act directly, no exploration.
- **Complicated** (feature in known module, known-symptom bug) — LSP navigate → read target → implement.
- **Complex** (new subsystem, cross-cutting, distributed) — first: is causation established? If not, diagnostic spike before solutions. Check `specs/decisions/` and `specs/tensions/`, invoke the **kumite** skill.
- **Chaotic** (incident, corruption) — stabilize first, reflect after.

## Navigation Keymap

Look up by intent; don't re-read whole files.

| Intent | Tool |
|---|---|
| **Where does X live?** — locate code | **Grep + Read first** (fastest, no cold-boot risk); fire lookups in parallel. The `dojo/nav` bridge is for *citing* `[[id:]]` links when authoring docs, not first-pass discovery — see `navigation.org::nav-tool-decision-tree` |
| Symbol → definition / references / type / file outline | `LSP` tool: goToDefinition, findReferences, hover, documentSymbol |
| Find symbol across workspace | `LSP` workspaceSymbol — scope the query (`Dojo.`); `experiments/` pollutes results; on `:noconnection` (Expert cold boot) retry once |
| What a module is *for* — architecture, lenses, ids | `emacsclient --eval '(dojo/section-for-module "Dojo.Table")'` · `(dojo/list-modules)` · `(dojo/list-lenses)` · `(dojo/list-ids)` · `(dojo/heading-body "id")` — spans root `*.org` + `specs/**/*.org` |
| Runtime state, eval, logs, Ecto schemas | Tidewave MCP (live when phx.server is up) |
| Browser/JS runtime, live shell play | chrome-devtools MCP — read `codex/play.org` first |
| JS performance | `test/js/profile/` rig (its README.org explains) |
| Dependency docs | Tidewave `get_docs` / `search_package_docs`; offline: `mix usage_rules.docs Mod.fun` |
| Strings, HEEx templates, config, comments | Grep / Glob |
| Partisan internals | Grep `/home/putra/Repos/partisan/src/` — custom fork, LSP won't index it |

## Hard Constraints

- Partisan changes go to the fork at `/home/putra/Repos/partisan/`, never `deps/`. Dev workflow: `PARTISAN_PATH=/home/putra/Repos/partisan mix ...`
- `mix format` before committing; `mix credo --strict` for static analysis.
- Design/architecture work follows Kumite — invoke the **kumite** skill; commit reasoning as `kumite(<phase>): <what happened>`.
- Plans, strategy, and architecture docs are org-mode in the constellation, anchored for the bridge: `:ID:` on major sections, `:MODULE:` on code sections, `:LENS:` on perspectives, `[[id:...]]` links between nodes.

## Spawning Agents

Subagents do **not** inherit this file. Spawn project work as the `kohai` agent
(`.claude/agents/kohai.md`) — it carries the keymap, the bridge, and an OODA
"Paths Taken" report contract, keeping parallel work introspectable and steerable.

## The Constellation

- `navigation.org` — code lookup hotpaths (`:KEYWORDS:` + `:PATH:`); when you add code worth finding, add its hotpath in the same change; `scripts/nav_verify.sh` / `(dojo/nav-verify)` keep it vital
- `ARCHITECTURE_NEUE.org` — what Dojo is, how we think, module anatomy (`:MODULE:`-anchored)
- `specs/` — Kumite reasoning: `decisions/` (check before designing), `tensions/` (active forces), `_meta/` (framework + lenses)
- `codex/` — PaperLang pattern language; `codex/play.org` is the live-shell play protocol

Env vars: `PORT` (4000), `PARTISAN_NAME`, `PARTISAN_PORT` (9090).
