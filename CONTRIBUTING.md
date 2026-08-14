# Contributing to Dojo

## Requirements

| Tool | Version | Install |
|---|---|---|
| Elixir | ~> 1.18 | [elixir-lang.org](https://elixir-lang.org/install.html) |
| OTP | 27+ | included with Elixir |

Use [asdf](https://asdf-vm.com/) or [mise](https://mise.jdx.dev/) with `.tool-versions` to pin Elixir and OTP versions.

## Setup

```sh
mix setup        # install deps, compile, build assets
mix ecto.setup   # create and migrate the database
mix test         # confirm everything works
```

## Workflow

1. Fork and create a branch: `feat/<name>`, `fix/<name>`, or `chore/<name>`
2. Write tests for your change — new behavior needs new tests; bug fixes need a test that fails before the fix
3. Run `mix format` and `mix credo --strict` — CI enforces both
4. Open a pull request against `master`

Pull requests are reviewed within a few days. Significant changes benefit from an issue first.

## Code Style

Enforced automatically:

```sh
mix format          # formatting — run before every commit
mix credo --strict  # static analysis
```

The formatter is the authority on whitespace and structure. Credo catches design smells, unsafe patterns, and naming violations. If Credo flags something you disagree with, raise it in the PR rather than suppressing the check.

## Tests

```sh
mix test                         # deterministic suite
mix test path/to/test.exs:42     # single deterministic test
bash scripts/verify/reload_test.sh # destructive reload stressors
bash scripts/verify/lan_test.sh    # Partisan cluster E2E
```

The default suite excludes tests that need a separate VM or network. The LAN E2E
runs only inside its isolated user and network namespace.

## Deploying & releasing

One workflow (`.github/workflows/ci.yml`) on every pull request:

| PR into | After green tests |
|---|---|
| `staging` | Fly deploys `paperland` |
| `release` | Fly deploys `thedojo` (prod) |
| `master` | tests only |

Re-run the **CI** workflow to re-test and re-deploy. There is no separate
deploy workflow to babysit.

**Desktop installers / GitHub Release** cut on push (merge) to `release`:

1. Bump `version:` in `mix.exs`
2. Add an entry to `CHANGELOG.md`
3. Merge (or push) to the `release` branch

That path builds Linux, Windows, and macOS (x86 + ARM) binaries and publishes
a GitHub Release. It rejects the push if the version tag already exists.
