# Notation — Phase 0 baseline & classification

Companion to `specs/weave/notation-inquiry.org` (`notation-phases`). Phase 0's job is to
turn the probe's falsifiers into independent regression witnesses and to classify the work
so every question has one authority. This file records the baseline and the classification;
the witnesses live beside it as `*_test.mjs`.

## Baseline (full JS suite, before Phase 1)

`node --test test/js/*/*_test.mjs` -> at Phase 0, **2356 tests, 7 red** in `laws/`, recorded so
Phase 1's "the corpus still walks" was not charged for them:

- `laws/display_test.mjs:35` — display: the side count follows the drag at the commit
- `laws/figure_binding_test.mjs:54,80,211,260,309` — figure-valued let / unused sibling / newest question / derived randomness / derived let
- `laws/read_snapshot_test.mjs:42` — `fn last A.x` bottles after a later drag

**Correction (later).** These seven were **fixture faults, not figure failures**. Each
fixture defined a helper named `round` — reserved as a builtin after the surface pass — and
read `//` as its old remainder meaning, so the walk stopped at
`Cannot override built-in function round` before reaching the behaviour under test.
Renaming the helper and restoring floor-to-multiple under the new `//`
(`(no // nearest) * nearest`) turned all 22 tests in the three files green with production
code and assertions untouched; the suite now walks clean. A separate rebuilt-ink witness
(`id:laws-figures-phase34-inplace`) is retained. This repair does **not** certify
figure/ambient rebuild behaviour.

**Later (D042).** `round` and `mod` are now shadowable: a child fn at the same name
and arity owns the name over the builtin, so the helper named `round` would no longer
stop the walk at `Cannot override built-in function round`.

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
| `mod3` stolen; `mod(7,3)` had no callable form | **Tension** — namespace | **resolved** — D041: `mod(a, b)` is canonical, the word carve-out is culled |

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
- **Explicit admission** (`turtling/executor.js`): `demanded` answers by what the value
  IS — *superseded by the ruling below* (Phase 1 refused a non-finite or non-number for
  a `finite` hole; that reversal is recorded at the end of this file).
- **Valid resulting state** (`turtling/commands.js`): a non-finite proposed pose never
  becomes state or an event — *superseded by the ruling below* (`requireFinite` threw;
  the pose is now dropped, not the figure).
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
- a chunk edge is classified by the shared lexer's token roles, never re-approximated, so
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

**Witnesses**: `boundary_test.mjs` — the four proofs, signs, nested quotes,
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
  and every duplicated chunk-edge spelling test are gone — one recognition, in
  `operators.js` and the lexer.

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

## Superseded and LANDED — a measure is answered by what the value IS (ruling: absent-is-zero)

Phase 1 made a non-finite or non-number movement measure *refuse* at the demand, and a
non-finite resulting pose *throw*. Measured cost: the reported shape

#+begin_example
def polygon n do
  loop 5 do
    fw 100
    rt 360/n
  end
  polygon n+1
end
polygon
#+end_example

walked one `fw 100` and then died — `No measure: 360/n is not a finite number` —
because a bare call binds the missing parameter to 0 and `360/0` is Infinity. A figure
that draws nothing is not thereby a safer figure. The rule is now three doors, one per
question, and both doors drop the ONE statement rather than the figure (D020):

| What arrives | What it is | What happens |
|---|---|---|
| nothing (absent) | no answer at all | the callable's own default — the identity (`fw` 0, `rt` 0, `goto` the origin). Quiet. |
| a non-finite number | the arithmetic ran out of road | the step is NOT TAKEN. Quiet. Never geometry. |
| a word where a measure belongs | the author's mistake | `refused` on the frame's channel, located; the siblings still run. In a closed construction (`state.strict`) it refuses instead. |

A `loop` count is guarded the same way: a count that is not a finite number is not
taken. Budgets are unchanged, and are still the honest stop for a runaway program — a
program fact, not a number fact. The tower's inherited outcomes are untouched:
`sqrt(-1)` is NaN, `1/0` is Infinity, and both stay numbers everywhere except where a
measure is asked for ([[id:tower-center-contract]]).

Witnesses: `three_doors_test.mjs` (a live walk), `finite_measure_test.mjs` (batch, plus
the program above), `primitives_test.mjs`, `contracts_test.mjs`,
`word_measure_domain_test.mjs`, `laws/relations_test.mjs`. This supersedes the
classification row `sqrt(-1)`, `1/0` → non-finite geometry.

### Landed — the arithmetic ruling, and what it cost

`[[id:tower-center-approximation-ruling]]` (Phase 3's proposal) is now implemented, and
with it the four cuts it needed:

1. **Arithmetic is the substrate's.** `+`, `-` and every builtin result stopped snapping
   to 1e14; `plus`/`minus` lost the safe-integer branch they only needed to dodge the
   snapping. Measured cost across the suite: **6 tests**, and four of them were
   `0.1 + 0.2 → 0.30000000000000004` — display residue, nothing else. The fifth was
   `sin(30) == 0.5`. The sixth *wanted* the change (`abs(1e-15) == 1e-15`).
2. **A reading is exact.** Both reading gates are gone — the executor's `x`/`y`/`z`
   constants and the scheduler's `SPATIAL`/`TEMPORAL`/`RELATIONAL` tables. Measured
   before: a 1000-step `fw 1e-14` walk left ink at 1e-11 and read back as `0`, so
   `when x > 0` was false — a figure could not see its own ink. It can now.
3. **The display is the only place that rounds for the eye.** `numerics:format`, ~12
   significant digits, never feeding back: `0.1 + 0.2` reads `0.3`, `sin(30)` reads
   `0.5`, `sin(180)` reads its actual `1.22e-16` (*shown as it is* — the display does
   not invent a zero), and a non-number is *named*, never printed as a numeral.
4. **A tolerance carries its scale.** `vec3.unit`'s degeneracy and `faceto`'s aim are
   now `eps × magnitude` — a tiny vector still has a direction, and a tiny figure
   still has a scale.

**The cost a learner must be told.** Two equalities changed and will not come back:
`sin(30) == 0.5` and `sin(180) == 0` are false. The idiom is to ask: `round(x, to)`
or a closeness test. Every reading is likewise exact now, so `A.heading == 180` after
a clean quarter turn is `179.99…` — `round(A.heading) == 180` reads true, and the
*display* reads `180` unchanged.

### Second pass — cohesion, footprint, and the fixtures that were missing

Separating concerns, and shrinking the surface while doing it:

- **One report shape, one severity home.** `turtling/report.js` mints what a hurt is
  (`report` for a fault, `notice` for the wire form); five hand-built shapes moved to
  it. Severity left the notice entirely: `weave/queries.js::KINDS` is the ONE authority,
  and its rows now cover every kind the code mints — `ink`, `motion`, `relation`,
  `unsupported`, `unresolved`, `contradiction`, `obstructed`, `stale`, `busy` had been
  answering through the unknown-kind default, i.e. by accident. My own second severity
  axis (quiet/notice/wound) is gone: a policy cell now says `told` and `stops`.
- **One health verdict.** A seat's health and the document's now come from the same
  `verdict()`, so they cannot disagree — which is the lesson `KINDS` documents, applied
  one level up. A warning is carried without calling the document unwell.
- **A malformed line is a `parse`,** the house's own kind, not a synonym for it.
- **One normalizer, two questions.** `unit(v)` answers "normalize this, or null" (an
  absolute length floor); `directionBetween(a, b)` answers "do these coincide", asked at
  the scale of the points. The sites that wrote `unit(sub(a, b)) ?? [1, 0, 0]` — with
  *"coincident: a stated direction"* in the comment — now say what they meant.
- **A run's fields are one list.** `RUN_SEED` names what dies with a run, so a new
  per-run fact cannot be left standing by a rewire, and the two lifetimes are visible
  side by side.
- **The wire's vocabulary is inspectable.** The renderer's switch became
  `MATERIALIZERS`; `EFFECTS` is exported; and `event_vocabulary_test.mjs` pins both —
  including the contract that an *undrawn* kind is ignored rather than fatal.
- **The fixtures the suite was missing** (`numeric_scale_test.mjs`): a reading at five
  scales, a direction at three, coincident pairs, the display budget, and the one door
  still silent (a compared NaN) *characterized* so fixing it is a deliberate edit. Every
  earlier numeric witness sat at scale 1 with clean values — which is exactly why a real
  regression in `unit` passed all 2434 of them.

Suite after: **2457 tests, 0 fail, 1 pre-existing todo** (+23 witnesses).

**Recorded open** (not this cut): `REALIZE_TOL` / `ACCEPT_TOL` / `REL_TOL` and
`Versor.EPSILON` are still absolute, awaiting their scale; and the **comparison door**
still erases a non-answer silently (`0/0 > 0` answers `0` with no word — the value is
gone before any consumer sees it). Readings, before and after:
`probe/tower-rounding/probe.mjs`; what is said, and where:
`probe/tower-rounding/composition.mjs`. Surface: `assets/js/turtling/numerics.js`
([[id:nav-numerics]]).

### Boundary follow-up — admission, rigidity, and fill

See `specs/weave/numeric-boundaries-review.org` for causes, repairs, costs and limits.
Added 41 witnesses: explicit absent defaults, converted/accumulated overflow, located
notices, malformed poses/directions, tiny turns, long walks, and indexed fill area
across scales (including the evaluated walk → fill route). The long-walk closing
gap at unit step size fell from about `3.85e-7` to `1.52e-10` without snapping points.

Final suite: **2498 tests, 2497 pass, 0 fail, 1 pre-existing TODO**. This is not
Phase 3 closure: compared NaN, invalid-input rebuild, world-publication overflow
and GPU float32 feature loss remain distinct obligations.
