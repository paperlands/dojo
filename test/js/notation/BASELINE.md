# Notation — Phase 0 baseline & classification

Companion to `specs/weave/notation-inquiry.org` (`notation-phases`). Phase 0's job is to
turn the probe's falsifiers into independent regression witnesses and to classify the work
so every question has one authority. This file records the baseline and the classification;
the witnesses live beside it as `*_test.mjs`.

## Baseline (full JS suite, before Phase 1)

`node --test test/js/*/*_test.mjs` → **2356 tests, 7 pre-existing red.** None touch notation;
recorded so Phase 1's "the corpus still walks" is not charged for them:

- `laws/display_test.mjs:35` — display: the side count follows the drag at the commit
- `laws/figure_binding_test.mjs:54,80,211,260,309` — figure-valued let / unused sibling / newest question / derived randomness / derived let
- `laws/read_snapshot_test.mjs:42` — `fn last A.x` bottles after a later drag

These are figure/ambient rebuild behaviours (a separate line of work). They are **not** guards
for this sequence and were untouched.

## Classification — one authority per question

| Falsifier (probe) | Kind | Authority / disposition |
|---|---|---|
| `2$+3`→5, `.5+1`→6, `u . v`→6, `(u+v).x`→20 | **Bug** — skipped ink | Phase 1 fidelity — **repaired** (exhaustive coverage) |
| `(2]` / `[2)`→2, `sin[30]`→0.5 | **Bug** — delimiter identity | Phase 1 — mismatch **refused**; strong split (indexing/vector) = tower rung 1, deferred |
| `fw (2+3) * 2` splits; `fw sin (30)` two args | **Bug** — command boundary | **Phase 2** (one expression reader) — not this pass |
| `3<2<1`→1; `-2^2`→4; `x(y+1)` vs `(x)(y+1)` | **Choice** | Phase 2 ruling (corpus-checked) |
| `0 && missing` / `1 || missing` demand the name | **Tension** | strict-lazy ⊗ dataflow-observation — decision before Phase 3 |
| `sqrt(-1)`, `1/0` → non-finite geometry | **Bug** — non-finite measure | Phase 1 — **repaired** (finite-or-refuse at the demand) |
| `sin(1e-15)`→0 after rounding | **Choice** — rounding policy | **Phase 3** (probe rounding separately) |
| `mod` loses a safe integer at the boundary | **Bug** — safe-integer intermediate | Phase 1 — **repaired** (`integerMod`/`integerDiv`) |
| `+` at −2⁵³ corrupts an exact sum | **Choice** — rounding policy | **Phase 3** (found this pass) |
| `mod3` stolen; `mod(7,3)` has no callable form | **Tension** — namespace | D019 / Phase 5 (scoped declaration visibility) |

## The three primitives Phase 1 protects

1. **Faithful representation** — a literal is not a reference, and source survives.
   A quoted word keeps its own node (`string`), so `'pi'` stays the word while `pi` is the
   constant; delimiters keep their kind; an unsupported glyph refuses at its position.
2. **Explicit admission** — a consumer accepts supported values; state stays valid.
   A movement/rotation hole demands a *finite number* (per-hole, not a global rule); a finite
   step whose *result* overflows is rejected before it becomes state, and the preceding valid
   walk stands.
3. **Coherent meaning** — every route obeys one contract. One numeric grammar
   (`mafs/number.js`) serves the lexer, the parser's fold check and the executor's shortcut,
   so `1.` is refused on every route; `//` and `mod` are exact across the safe-integer domain
   and against a BigInt oracle.

## Phase 1 — what changed

- **Exhaustive reading** (`mafs/lexer.js`): every character must be claimed; a gap refuses at
  its position. A quoted run is read as a `STRING` token, not stripped.
- **Matched delimiters** (`mafs/lexer.js`, `mafs/parse.js`, new `mafs/delimiters.js`): `(` `)`
  and `[` `]` are distinct kinds and a pair must match. Both still group and still call, so
  the corpus survives; the strong split (indexing/vector) stays deferred to tower rung 1.
- **Literal vs reference** (`mafs/parse.js`, `mafs/evaluate.js`, `turtling/executor.js`): a
  string literal is its own node and is never resolved as a name.
- **Explicit admission** (`turtling/executor.js`): `demanded` refuses a non-finite or
  non-number for a `finite` hole, per hole; a headless rehearsal still passes a nothing.
- **Valid resulting state** (`turtling/commands.js`): `requireFinite` rejects a non-finite
  proposed pose before it becomes state or an event.
- **Coherent numerics** (new `mafs/number.js`, `mafs/evaluate.js`): one number grammar; exact
  `//`/`mod` via `a - (a % b)` (moves toward zero, always safe) with `-0` normalized.

## Findings surfaced (recorded, not fixed here)

- `+` at −2⁵³ corrupts an exact sum → **Phase 3** (scalar rounding policy).
- `sin(1e-15)` → 0 after rounding → **Phase 3**.
- The command boundary (`fw (2+3) * 2`) and juxtaposition/chains/sign-power → **Phase 2**.
- `sin[30]` still reads as a call; the strong delimiter split is **rung 1**.
- `.5` and `1.` are refused everywhere (consistent); admitting them is a **Phase 2 choice**.
- A zero result no longer leaks a `-0` sign (found by the BigInt oracle).

**Witnesses:** `reader_fidelity_test.mjs`, `integer_domain_test.mjs`, `finite_measure_test.mjs`,
`primitives_test.mjs`. Full suite after: **2359 pass, 7 fail** — the same 7 baseline reds.

## Joints closed (post-review)

- **Rehearsal vs publication** (`executor.js` sets `state.rehearsal`; `commands.js`
  `requireFinite(ctx,…)`): a NOTHING pose (no world to consult) is tolerated in a rehearsal so
  vocabulary past it still registers, but a NON-FINITE number (arithmetic overflow) is refused
  on every route — even headless, where invalid simulated state can be inherited. A live walk
  refuses both. Earlier defs survive the wound (D020); defs after it do not.
- **Contract follows the resolved callable** (`executor.js` Call case): a user definition is
  resolved *before* argument admission, so the builtin's `ARG_DOMAINS` no longer leak onto a
  user `fw`.
- **Integer repair is integer-only** (`evaluate.js` `integerMod`): floating remainder keeps its
  prior approximation; the identity comment is bounded to safe integers.
- **A quote is one primitive** (`executor.js` `interpolate`): a literal and a template agree on
  every route — argument text or lowered value.

## Open, recorded (not fixed)

- **Valid state out** currently covers a proposed *position* only. Event payloads and time/
  style fields are not yet validated: `grid 'oops'` emits a NaN size; `label hi 'oops'` emits a
  NaN `textSize`. These bound the safety claim — they are not new regressions.
- **Two senses in one domain enum**: `word`/`measure` govern *name-resolution residuals*;
  `finite` governs *value admission*. Keep them separate; do not grow the enum into a
  mode-machine.
- **Expressiveness horizons**: interpolation (a value is a template of literals and slots) and
  ambient access (dotted reads, the locals-first `.` law) are the surfaces to grow next — see
  `specs/weave/notation-inquiry.org` and D018's dot law.

## Phase 2 — the command boundary (one binding rule)

**The contract** (id:gw-grammar). A line is `command word + arguments`:
- chunks split on whitespace, but a group is one chunk and a quote closes only with its own
  kind (a `)` inside `'…'` is not structural);
- a gap is an argument boundary **unless an operator binds across it** — the chunk touching
  the gap ends with an operator, or the next chunk begins with one;
- a `+`/`-` glued to an operand is a **prefix sign** (a new argument), whatever the magnitude:
  `goto 1 -2`, `1 -(2)` and `1 -pi` are each two coordinates;
- a word operator is recognized from the table (`7mod 3`, `7 mod3`), never re-approximated, so
  `model` stays a name;
- the argument text is the **original source span**, so internal spacing — and diagnostic
  offsets — are preserved.

**The command owns its contract**: each command declares how many expressions it contains
(`commandArity`), and a **surplus argument is refused, not dropped** — `fw 2 +3` and
`fn step[n] n +1` are refusals, not silently different drawings.

**Call spacing is settled (ruled): application is glued.** `sin(20)` is a call; `sin (20)`
is not a call anywhere — at the command boundary it is two arguments, and a surplus one is
refused, never silently run. The math lexer is whitespace-blind, so a *bare* `sin (20)` still
reads as a call inside one expression; that is left alone deliberately — nobody writes it, and
a whitespace-sensitive call rule is not worth its cost.

**Witnesses**: `boundary_test.mjs` — the four proofs, signs, word operators, nested quotes,
source spans, substitution, and surplus refusal.

## Scorecard — what the audit cut (this pass)

- **One command descriptor.** `commands.js` now has ONE source — `SPECS`: each callable's
  implementation, every name it answers to, and its holes (a kind per position). `COMMANDS`
  (name → implementation) and `contractOf` (name → spec) are derived views, so a name, an
  arity, and a hole kind cannot disagree, and aliases share one spec. The three tables
  (`COMMANDS` / `ARG_DOMAINS` / `ARITY`) are gone.
- **Surplus is now generic.** The check follows the resolved callable, so it applies to
  **builtins and user definitions alike** — `f 1 2` refuses, as `fw 1 2` does.
- **The boundary is decided by role, not spelling.** `startsWithOperator`/`endsWithOperator`
  lex the chunk with the shared lexer and ask for token *roles* (an operator in infix
  position bridges; a `+`/`-` followed by an operand is a prefix sign). The chunk-edge regexes
  and the duplicated word-operator recognition are gone — one recognition, in `operators.js`
  and the lexer.

**Still open (the honest remaining gap):** meaning is still a switch (`applyOperator` /
`applyFunction`), so D018's dispatch table is unbuilt and the language is not yet extensible
in *what* an operation means; and application stays non-lexical (`sin (30)` vs `sin(30)`),
which needs the caller's contract to read expressions. Those are the next cuts.

## This pass — the value/source and invocation joints

- **A computed argument is a VALUE, not source.** A `Value` node carries a computed value
  through a call; the figure build and the scheduler rebind no longer `String(...)` an answer
  back into source. `let F = label 'pi'` now shows `pi`, not `3.141592653589793`.
- **One invocation reading.** The figure path consumed `splitCommandArgs`/`splitFigureArgs`
  (arity deciding whitespace); it now consumes the SAME boundary reader (`readArguments`) as a
  command line. `let F = fw 2 + 3` walks 5, as `fw 2 + 3` does.
- **Application scope is stated, not absolute.** The boundary rule is a *command line* rule:
  outside an explicit expression region whitespace separates arguments; inside one the
  expression grammar owns whitespace. `fw sin (20)` is a surplus refusal; `fw (sin (20))` and
  a bare `sin (20)` are calls.

## Remaining joints (recorded — Phase 2 is not complete)

- **Grammatical authority, not shared recognition.** The boundary's role tests are still
  approximations (a leading prefix-capable operator with another token ⇒ a sign; any trailing
  operator ⇒ wants a right operand). A future *postfix* operation would be joined wrongly. The
  contract should distinguish: starting / continuing / completing / stopping at a caller-owned
  boundary — an explicit `readExpression(source, cursor, …)` that reports what it consumed.
- **Provenance is incomplete.** `Argument` nodes have `span: null`; the lexer's positions are
  relative to the extracted expression; a runtime error takes the statement's line. And
  recognition failures vanish into boundary guesses: `fw 2 +$ 3` reports a surplus count and
  hides the `$`; `label 'a#b'` loses its quoted content at `splitComment`. Source should travel
  as an addressed slice; a recognition failure should stay a located failure.

## The correction — one admission authority

- **Already evaluated ≠ already admitted.** The `Value` bypass at the Call dispatch pushed a
  computed value straight into the args, skipping `demanded`. A source `rt 'oops'` refused; a
  computed `Value("oops")` to `rt` (or `faceto`) accepted and produced NaN. Both argument
  forms now cross ONE admission, keyed to the resolved callable's hole. Source or value,
  admission is the same question.
- **The claim is narrowed.** This is *shared command-argument reading*, not a unified
  grammar; the math parser still owns binding inside an expression. The boundary walk must not
  grow into a second grammar.
- **The checkTree exemption was reverted** — it was dead code. The validator documents
  *source-tree* invariants; a `Value` is generated execution and never a source node.

## Still pending (visible)

- **Rebuild: later capture must agree with the first.** Rebuilds use `scheduler.js:evaluateArgs`
  (its own parse memo, direct evaluator call, failures → `undefined`), not the executor's path.
  The admission fix applies there too (same Call dispatch), but the *evaluation* authority is
  still two: names, strings, failures and binding freshness must agree across a question. A
  `todo` witness pins the obligation; the figure lifecycle reds (7) cover the wake.
