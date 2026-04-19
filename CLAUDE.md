# CLAUDE.md

## Commands

```bash
mix setup                  # Install deps and compile assets
mix test                   # Run all tests
mix test path:line         # Run a single test
mix format                 # Format code
mix release                # Build production release (multi-platform via Burrito)

# Start development server (with clustering support)
iex --sname dojo --cookie enterthedojo --dbg pry -S mix phx.server
```

## How to Work in This Codebase

### Classify Before Exploring

Before touching code, classify the task's complexity (Cynefin):

| Domain | Signal | Approach |
|--------|--------|----------|
| **Simple** | Rename, typo fix, config change | Act directly. No exploration needed. |
| **Complicated** | Add feature to existing module, fix bug with known symptoms | LSP navigate → read target → implement. |
| **Complex** | New subsystem, cross-cutting change, distributed behavior | **First question: Is causation established?** If a symptom is described but mechanism is unknown, diagnostic spike first (trace source code), solution proposals after. Probe judiciously and assidiously. Read `specs/tensions/` and `specs/decisions/` for prior art but don't be dogmatic. |
| **Chaotic** | Production incident, data corruption, reframing, paradigm shift | Act first to stabilize, reflect after. Rethink from first principles and patterns, research deeply for prior art.|

This classification determines how many tokens you spend understanding context. Simple tasks should not trigger deep exploration. Complex tasks should check `specs/` before rediscovering what's already been decided.

### Navigate with Semantics, Not Text

Use LSP as the primary navigation tool — it understands structure, not just strings:

| Need | Tool | NOT |
|------|------|----|
| Find where something is defined | `goToDefinition` | Grepping for `defmodule`/`def` |
| Find all call sites | `findReferences` | Grepping the function name |
| Understand a function before modifying it | `hover` | Reading the whole file |
| Map a file's structure | `documentSymbol` | Skimming with Read |
| Find a module by name | `workspaceSymbol` | Globbing for filenames |
| Trace call graphs | `incomingCalls`/`outgoingCalls` | Recursive grep |

Fall back to Grep/Glob only for: string literals, config values, comments, non-Elixir files, HEEx templates, or when LSP errors.

For dependency documentation, use `mix usage_rules.docs Module.function` instead of reading source in `deps/`.

### Cross-Repository Navigation
Partisan source lives at `/home/putra/Repos/partisan/src/` (not `deps/partisan/`). LSP won't index it — use Grep for Partisan-specific exploration.

### Kumite: Cognitive Protocol

This project uses a structured reasoning framework in `specs/`. Before significant design work:

1. Check `specs/decisions/` — has this already been decided?
2. Check `specs/tensions/` — is there an active tension on this topic?
3. If the task is Complex (Cynefin), work through Kumite phases: ORIENT → EXPLORE → SYNTHESIZE → DECIDE → SPECIFY → IMPLEMENT → REFLECT
4. Name tensions as they arise with `[⊗]` — don't resolve prematurely
5. Use `[⏚] GROUND` to connect abstract reasoning to concrete code
6. Use `[⚡] SPIKE` when reasoning stalls — build something small, let empirical data break the deadlock

Cognitive lenses in `specs/_meta/lenses/` shape how to evaluate options:
- **Pragmatist** — What ships? What's reversible? Write code that reveals the most about the problem first.
- **Architect** — Does this strengthen existing centers? Keep the core empty, the periphery alive. Flow over obstruction.
- **Systems** — Design how modules communicate, not their internal properties. Where are the feedback loops? Leverage points?
- **Adversarial** — Stress-test the design, what is the initial state, what fails at the nth step. Think extremes . What would guarantee failure?
- **Educator** — Sovereignty, autonomy, explorability. Structures that empower inhabitants and the ecosystem.

Commit convention for reasoning work: `kumite(<phase>): <what happened>`

### Design Principles

- Diagnose before designing — in Complex/Chaotic domains, establish the causal mechanism *before* proposing architecture. If causation is unknown, the first probe must trace source code and mechanism, not propose solutions.
- Write code that reveals the most about the problem first — steer the ship in fog
- Minimize primitive count for agility; distinguish primitives that confer greatest flexibility
- Design how modules communicate rather than their internal properties
- If there's clearly a right way, do the right way. Discipline solves it.
- Liberate well-defined structures: visibility, autonomy, tractability, explorability
- Self healing , let it crash, fault tolerant.

## Technique

- Abstracting out concurrency — concurrent programs are, in some sense, more diecult to write than sequential programs. Instead of writing one module which has both concurrent and sequential code I show how to structure the code into two modules, one of which has all the concurrent code, the other having only purely sequential code. Behaviours should be abstracted out as generics to be battle tested independently of application logic.

- Every thing is a process and they only interact by exchanging messages.  The key in making great and growable systems is much more to design how its modules communicate rather than what their internal properties and behaviors should be. When we interface Erlang programs to external sodware it is often convenient to write an interface program which maintains the illusion that“everything is a process.” This preserves isolation and coherence while allowing for interdependence and harmony.

- Error Handling
  - Let some other process do the error recovery. The error-handling code and the code which has the error execute within different threads of control. The code which solves the problem is not cluttered up with the code which handles the exception. The processes that are supposed to do things (the workers) do not have to worry about error handling with supervisors shepherding their lifecycle. The linked processes which receive these failure signals may or may not intercept and process these signals as if they were normal interprocess messages.
  - If you can’t do what you want to do, die.
  - Let it crash.
  - Do not program defensively.
  
- To design and build a fault-tolerant system, you must understand how the system should work, how it might fail, and what kinds of errors can occur. Error detection is an essential component of fault tolerance. That is, if you know an error has occurred, you might be able to tolerate it by replacing the ocending component, using an alternative means of computation, or raising an exception. However, you want to avoid adding unnecessary complexity to enable fault tolerance because that complexity could result in a less reliable system.We say a system is fault-tolerant if its programs can be properly executed despite the occurrence of logic faults

- Intentional programming — this is a programming style where the programmer can easily see from the code exactly what the programmer intended, rather than by guessing at the meaning from a superficial analysis of the code.When reading thousands of lines of code like this we begin to worry about intentionality—we ask ourselves the question “what did the programmer intend by this line of code?”

## Architecture

**Dojo** — LOGO for the networked era. Phoenix/LiveView application for collaborative learning and exploration of mathematics with distributed clustering.

[Developing in](./ARCHITECTURE.org)

### Module Map

```
Clustering           State                  Web                    World
─────────────        ─────────────          ─────────────          ─────────────
NetworkMonitor       Table (tuplespace)     ShellLive (/shell)     World (1D CA)/Conways (2D GoL)
MDNS.Discovery       TableRegistry          BootLive (/welcome)    Live Coding IDE (shell.js)
MDNS.Packet          Cache (Nebulex)        PageController (/)     Turtle (graphics/geometry) turtle.js
PartisanPubSub       Gate (Presence)        Router
```

### Key Relationships

- **Partisan** replaces Erlang distribution. Custom fork at `paperlands/partisan`. Nodes discover via mDNS (`_erlang._tcp.local`), exchange metadata through DNS TXT records.
- **NetworkMonitor** → polls interface IPs every 3s → hot-swaps Partisan TCP listeners on change → disconnects stale peers (WiFi roaming support)
- **Table** → GenServer per Disciple (user) → registered in TableRegistry → sharded via PartitionSupervisor → Dojo.Class (DynamicSupervisor) → 10-min TTL → cross-node RPC via Partisan
- **Gate** → wraps Phoenix.Tracker → PubSub broadcasts join/leave
- **Cache** → Nebulex + Shards backend → primary persistence (Ecto repo minimally used)

### Supervision Tree

```
Dojo.Supervisor
├── DojoWeb.Telemetry
├── Registry (Dojo.TableRegistry)
├── PubSub.Supervisor
│   ├── Phoenix.PubSub (Partisan adapter)
│   └── Dojo.Gate (Phoenix.Tracker)
├── DNSCluster
├── Finch
├── Dojo.Cache (Nebulex)
├── Task.Supervisor
├── PartitionSupervisor → Dojo.Class (DynamicSupervisor)
├── DojoWeb.Endpoint
└── Dojo.Cluster.NetworkMonitor
```

### Environment Variables

- `PORT` — HTTP listen port (default 4000)
- `PARTISAN_NAME` — Partisan node identifier
- `PARTISAN_PORT` — Partisan peer networking port (default 9090)

<!-- usage-rules-start -->
<!-- usage_rules-start -->
## usage_rules usage
_A config-driven dev tool for Elixir projects to manage AGENTS.md files and agent skills from dependencies_

## Using Usage Rules

Many packages have usage rules, which you should *thoroughly* consult before taking any
action. These usage rules contain guidelines and rules *directly from the package authors*.
They are a great source of knowledge for making decisions.

## Modules & functions in the current app and dependencies

When looking for docs for modules & functions that are dependencies of the current project,
or for Elixir itself, use `mix usage_rules.docs`

```
# Search a whole module
mix usage_rules.docs Enum

# Search a specific function
mix usage_rules.docs Enum.zip

# Search a specific function & arity
mix usage_rules.docs Enum.zip/1
```


## Searching Documentation

You should also consult the documentation of any tools you are using, early and often. The best 
way to accomplish this is to use the `usage_rules.search_docs` mix task. Once you have
found what you are looking for, use the links in the search results to get more detail. For example:

```
# Search docs for all packages in the current application, including Elixir
mix usage_rules.search_docs Enum.zip

# Search docs for specific packages
mix usage_rules.search_docs Req.get -p req

# Search docs for multi-word queries
mix usage_rules.search_docs "making requests" -p req

# Search only in titles (useful for finding specific functions/modules)
mix usage_rules.search_docs "Enum.zip" --query-by title
```


<!-- usage_rules-end -->
<!-- usage_rules:elixir-start -->
## usage_rules:elixir usage
# Elixir Core Usage Rules

## Pattern Matching
- Use pattern matching over conditional logic when possible
- Prefer to match on function heads instead of using `if`/`else` or `case` in function bodies
- `%{}` matches ANY map, not just empty maps. Use `map_size(map) == 0` guard to check for truly empty maps

## Error Handling
- Use `{:ok, result}` and `{:error, reason}` tuples for operations that can fail
- Avoid raising exceptions for control flow
- Use `with` for chaining operations that return `{:ok, _}` or `{:error, _}`

## Common Mistakes to Avoid
- Elixir has no `return` statement, nor early returns. The last expression in a block is always returned.
- Don't use `Enum` functions on large collections when `Stream` is more appropriate
- Avoid nested `case` statements - refactor to a single `case`, `with` or separate functions
- Don't use `String.to_atom/1` on user input (memory leak risk)
- Lists and enumerables cannot be indexed with brackets. Use pattern matching or `Enum` functions
- Prefer `Enum` functions like `Enum.reduce` over recursion
- When recursion is necessary, prefer to use pattern matching in function heads for base case detection
- Using the process dictionary is typically a sign of unidiomatic code
- Only use macros if explicitly requested
- There are many useful standard library functions, prefer to use them where possible

## Function Design
- Use guard clauses: `when is_binary(name) and byte_size(name) > 0`
- Prefer multiple function clauses over complex conditional logic
- Name functions descriptively: `calculate_total_price/2` not `calc/2`
- Predicate function names should not start with `is` and should end in a question mark.
- Names like `is_thing` should be reserved for guards

## Data Structures
- Use structs over maps when the shape is known: `defstruct [:name, :age]`
- Prefer keyword lists for options: `[timeout: 5000, retries: 3]`
- Use maps for dynamic key-value data
- Prefer to prepend to lists `[new | list]` not `list ++ [new]`

## Mix Tasks

- Use `mix help` to list available mix tasks
- Use `mix help task_name` to get docs for an individual task
- Read the docs and options fully before using tasks

## Testing
- Run tests in a specific file with `mix test test/my_test.exs` and a specific test with the line number `mix test path/to/test.exs:123`
- Limit the number of failed tests with `mix test --max-failures n`
- Use `@tag` to tag specific tests, and `mix test --only tag` to run only those tests
- Use `assert_raise` for testing expected exceptions: `assert_raise ArgumentError, fn -> invalid_function() end`
- Use `mix help test` to for full documentation on running tests

## Debugging

- Use `dbg/1` to print values while debugging. This will display the formatted value and other relevant information in the console.

<!-- usage_rules:elixir-end -->
<!-- usage_rules:otp-start -->
## usage_rules:otp usage
# OTP Usage Rules

## GenServer Best Practices
- Keep state simple and serializable
- Handle all expected messages explicitly
- Use `handle_continue/2` for post-init work
- Implement proper cleanup in `terminate/2` when necessary

## Process Communication
- Use `GenServer.call/3` for synchronous requests expecting replies
- Use `GenServer.cast/2` for fire-and-forget messages.
- When in doubt, use `call` over `cast`, to ensure back-pressure
- Set appropriate timeouts for `call/3` operations

## Fault Tolerance
- Set up processes such that they can handle crashing and being restarted by supervisors
- Use `:max_restarts` and `:max_seconds` to prevent restart loops

## Task and Async
- Use `Task.Supervisor` for better fault tolerance
- Handle task failures with `Task.yield/2` or `Task.shutdown/2`
- Set appropriate task timeouts
- Use `Task.async_stream/3` for concurrent enumeration with back-pressure

## Lifecycle
- Observe proper lifecycle, garbage collection and shepherding of processes. Steer towards self healing and fault tolerance depending on expected user behaviour
<!-- usage_rules:otp-end -->
<!-- usage-rules-end -->
