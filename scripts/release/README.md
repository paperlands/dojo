# PaperLang on your canvas

Standalone PaperLang: turtles, three.js, orbit controls and text, without the Dojo
page, editor, terminal, recorder or npm runtime dependencies. Requires a browser
DOM and WebGL; import only on the client in SSR applications.

## Import

The canonical browser entry is first-party raw ESM on PaperLand:

```js
import { createWorld } from 'https://paperland.sg/paperlang/0.6.js'
```

`/paperlang/0.6.js` follows the pinned `0.6` line (patch updates within it);
`/paperlang/latest.js` follows the latest published line. Both are CORS-enabled
(`access-control-allow-origin: *`). A restrictive CSP must allow
`https://paperland.sg` as a script source. The first-party URLs name an immutable
generation and serve its source and licences beside it.

Dojo's extensionless `/paperlang/0.6` and `/paperlang/latest` remain
compatibility pointers; they redirect to the `.js` URLs above, never to a CDN.

npm is an independent distribution channel:

```sh
npm install @paperland/paperlang
```

```js
import { createWorld } from '@paperland/paperlang'
```

Use an exact npm version/lockfile when byte-for-byte pinning matters. Both
channels carry the same release artifact.

Give each canvas its own container and an explicit CSS size:

```html
<div><canvas style="display:block;width:640px;height:400px"></canvas></div>
```

Troika may fetch fonts at runtime; bundled rendering is not an offline text
rendering guarantee. Account for font requests in network/CSP policy.

## One canvas, one owner

`createWorld(canvas)` creates the place where the program's turtles and
relationships live. It owns one canvas-bound execution and interaction lifecycle;
keep it while that surface is mounted, and dispose it when the surface leaves.

```js
import { createWorld } from '@paperland/paperlang'

const world = createWorld(document.querySelector('canvas'))
try {
    const run = await world.play('fw 80\nrt 90\nfw 80')
    await run.finished
} catch (error) {
    console.error(error.message, error.wound?.span)
}
// Keep the world alive while its canvas is mounted; dispose on unmount.
window.addEventListener('pagehide', () => world.dispose(), { once: true })
```

`play` means accepted and started, not finished or painted. `run.finished`
resolves only when the scheduler ended without a fatal wound; a late wound rejects
with `error.reason === 'fatal'` and `error.wound.span`. It may never end for a waiting
or unbounded program. A new `play` rejects earlier pending completion with
`error.reason === 'superseded'`. `dispose` is idempotent and rejects pending completion
with `error.reason === 'disposed'` (message `world disposed`).
Handle completion rejections even when you do not need to await the drawing.
Replacement is not an atomic swap of visible drawings.

`caps` sets host ceilings per world; a program cannot raise them with `limitCommand`
or `limitRecurse`. `law` is an experimental laboratory seam, not a stable extension API.
`onBeat(fn)` installs one event callback; `null` removes it. Each temporal joint carries
all source lines walked since the preceding beat, including repeated occurrences.
It uses logical program time, not wall-clock time. Beats are delivered in pass order
after native ink has been applied and reclaimed; delivery is not proof of paint.
A callback may play again; that pass’s beats wait behind the pending ones. Replacing
a source or disposing the world revokes its undelivered beats. `onBeat` reads the
current callback at each delivery; one throwing callback is logged and does not
cancel the pass. A beat is an occurrence report, not a snapshot of ink at its time.

The canvas's content box is the surface, not the window. Author its size in CSS;
the runtime follows resizing and keeps each canvas's overlay beside that canvas.
An unsized canvas keeps its initial box; a CSS-collapsed canvas stays collapsed.

## Pause one live play (unreleased)

`run.pause()` and `run.resume()` return `true` only when they change the current
run's state. Repeats and calls on a completed, superseded or disposed run return
`false`. Every new play starts unpaused, including when it replaces a held play.
An attempted replacement still follows the existing refusal rules.

Pause holds program steps, authored waits and pending figure builds after the
synchronous work already in progress. An asynchronous program admission may
answer, but its result does not apply until resumed. Already delivered effects
are not undone. The camera and frame requests still work. Explicit hand input
can change an accepted pose and its immediate readings and display while paused.
Page and work clocks keep running; resume does not catch up elapsed pause time.
The run's original `finished` promise stays in force. This is not seek, replay
or a freeze of the canvas.

## Wheel policy: a drawing beside a scrolling page (unreleased)

```js
const pageWorld = createWorld(canvas, { input: { wheel: 'modifier' } })
```

| `input.wheel` | A wheel event over the canvas |
|---------------|-------------------------------|
| `'always'` (default) | The camera zooms; the event's default is prevented, as today. |
| `'modifier'` | Ctrl+wheel and Cmd+wheel zoom. Plain, Shift-only and Alt-only wheels are left to the page/browser. Trackpad pinch that arrives as Ctrl+wheel still zooms. |
| `'none'` | No wheel zoom, including wheel events generated by trackpad pinch. Native touch/pointer gestures remain unchanged. |

The policy is normalized and frozen once at construction. A misspelt value, or any
`input` key other than `wheel`, throws a `TypeError` before a Turtle, a stage or a
WebGL context exists; `input.orbit` / `input.pan` are not silently assumed. Camera
pan, orbit, dolly and two-finger gestures are unchanged under every policy, and
`interactive` still governs free-point gestures only.
This is not a frozen-camera mode: a program's authored eye or `view.fit()` can
still change the view.

A non-prevented wheel event proves the host did not intercept it, not that the page
scrolled: real scrolling depends on ancestors, CSS and the browser. Touch policy is
out of scope here; this option covers wheel events only.

## Observe the view, compose an overlay (unreleased)

```js
import { createWorld, projectPoint, unprojectRay } from '@paperland/paperlang'

const world = createWorld(canvas)
const off = world.onFrame(({ view }) => {
    const point = projectPoint(view, [40, 20, 0])
    if (point) drawAnnotation(point.x, point.y)
})
world.requestFrame() // request another render, for example while an overlay fades
const saved = world.view.snapshot()
const ray = unprojectRay(saved, 100, 80)
// On unmount: off(); world.dispose().
```

A view is frozen plain data: `worldToView` and `projection` are column-major
16-number arrays; `width`/`height` are the rendering surface's CSS content sizes,
not device pixels. `dpr` labels the applied renderer ratio (capped at 2), not the
raw `devicePixelRatio`. Coordinates are local to that content
box, with `(0,0)` at its top-left. Client/page placement belongs to your DOM layout;
no client rectangle or live camera object is retained in the view.

`status` is `ready`, `collapsed`, `transformed`, or `unavailable`. Projection
returns `null` for unavailable surfaces, non-finite points, points behind the eye
or outside the near/far and image bounds. Unprojection returns a world-space ray
with an eye origin and unit direction, or `null`. Unsupported CSS transforms are
not guessed. The native authored eye and manual offset are already composed into
`worldToView`; consumers must not apply them again.

`view.snapshot()` reads the last rendered view, not current execution state or a
restorable camera rig. Before any render, it captures the current projection with
`frame: null` and `time: null`; that is not proof of paint. Later `frame` is this
world's render sequence and `time` is the render-loop wall timestamp in milliseconds,
not logical program time. `view.project(point)` and `view.unproject(x,y)` are
conveniences over that same last view. JSON/structured-cloned views remain usable
with the exported helpers even after the world is disposed.

`onFrame` observes completed native frames; it does not keep an idle world running.
Registration requests a frame, and `requestFrame()` explicitly requests another.
The frozen callback envelope and its view are shared by all observers of that
frame. Removal is immediate/idempotent; an observer added during delivery waits
for a later frame. Synchronous observer failures are isolated and logged; async
callbacks handle their own rejections. Subscriptions survive `play()` replacement
and retire on disposal. After disposal, view reads return `null`, and frame
registration/requesting do nothing.

The view is a projection observation, not an atomic mathematical snapshot.
`interaction.read` remains live inside a frame callback: a prior sibling may have
changed accepted state or replaced the source. Where the page owns observer order,
sample its selected facts before exposing mutators or yielding. Stored facts never
authorize later actions; current native acceptance still governs requests.

`view.fit()` requests native framing and returns a boolean: `true` when native
point/locus bounds were applied, `false` when no targets exist or after disposal.
It requests a frame itself; callers need not pair it with `requestFrame()`. The
last rendered view is unchanged until another frame arrives. It returns no pose
and does not restore a camera or fit arbitrary retained ink. Bounds and direction
pass through the existing effective reframe; their mathematical radius is unchanged.

There is still no figure export, camera restoration, independent program layers
or replay/clock control. Existing `play()` behavior is unchanged.

## Read, propose, subscribe

```js
const control = createWorld(controlCanvas, { interactive: true })
const run = await control.play('let A\nlet A.y = 0\nlet A.z = 0\nlet length = A.x')
await run.finished

const stop = control.interaction.subscribe('length', answer => {
    if (answer.kind === 'value') output.textContent = String(answer.value)
})
const verdict = control.interaction.propose(['host', 'A'], [80, 0, 0])
if (verdict.kind !== 'accept') console.log(verdict.kind, verdict.message)
// stop() cancels delivery immediately; it is safe to call more than once.
```

| Operation                         | Meaning                                      |
|-----------------------------------|----------------------------------------------|
| `read('length')`                   | Read a top-level named value                 |
| `read(['host'], 'heading')`        | Read the main turtle's PaperLang property     |
| `subscribe('length', fn)`          | Observe a named value                        |
| `subscribe(['host', 'A'], 'bearing', fn)` | Observe an addressed frame property    |
| `propose(['host', 'A'], [x, y, z])` | Request a world-space position for a free point |

Read answers are `{kind: 'value', value}`, `missing`, `unsupported` (with a
message), or `retired` after disposal. Values are finite numbers, strings,
booleans, `null`, or frozen finite numeric vectors of their original dimension.
`null` is a real reading, such as a bearing at coincidence. Do not treat it as
zero. Runtime frames, functions, and chart metadata do not cross this boundary.

A proposal needs exactly three finite coordinates. Native laws may project it
to an admissible position, so read the accepted value rather than echoing the
request. Headed turtles are unsupported. Dependent points still obey their defining
relationships; a proposal cannot break a binding. An `accept` verdict does not
promise that the canvas has already repainted.
Other verdicts include `missing`, `unsupported`, `busy`, `stale`, `refuse`,
`unresolved`, `fault`, and `retired`. There is no automatic retry or queue.

`interactive: true` enables native free-point gestures. `false` is the host
default; programmatic reads and proposals still work. This flag does not disable
camera orbit controls. Bearing and other relational readings use PaperLang's
observer/reference semantics; do not reconstruct them with page-side geometry.

Subscribe *after successful play*; waiting for `run.finished` is not required.
The first callback runs synchronously, delivering exactly the current `read` answer.
Later callbacks observe changes to the same supported facts, including availability,
delayed declarations, ordinary actor motion, and law-governed changes. Equal answers
are deduplicated. This observes accepted state, not every intermediate mutation or
command occurrence: use `onBeat` for line-walk events and `run.finished` for completion.

Delivery closes at runtime acceptance boundaries: after the whole geometry/law
installation and dependent-value recomputation, or after a scheduler slice and its
readout recomputation. No page-side geometry model or mutation watchers are needed.
Cancellation takes effect immediately, including mid-fan; calling it twice is safe.
Adding a subscription mid-fan delivers its initial reading immediately, but does not
join that fan. Any new `play` attempt retires old subscriptions, even if it fails;
subscribe again after successful replacement. Disposal retires them without a final
callback; subsequent `read` returns `retired`.

Callbacks observe. A synchronous same-world proposal returns `busy` during /any/
callback, including initial delivery; it is not queued or retried. Defer a proposal
to a microtask or later event if desired, then read its actual verdict. Synchronous
observer exceptions cannot undo acceptance or silence siblings. Async callbacks
must handle their own rejected promises; the runtime does not await them.

### Frame key paths (unreleased)

A frame target is an array of exact tree keys: `['host']` is the main turtle,
`['host', 'A']` its child A, and `[]` the fixed world datum. Nested frames use more
keys. Names are not split or interpreted: `['host', 'A/B']` is a literal named
child, distinct from `['host', 'A', 'B']`. Empty and Unicode names are valid keys.
`world` and `origin` retain their language meanings inside PaperLang; they are
not magic path entries. The first key is the program's registration key, not
its display name (`host` in this standalone world).
Reads and proposals stay within that program's seat; a path into another seat
answers `missing`. The datum is readable, but is not a steering target.

```js
const run = await world.play(source) // submit the exact editor source, unchanged
const off = world.interaction.subscribe(['host'], 'heading', answer => {
    if (answer.kind === 'value') renderHeading(answer.value)
})
// No `as walker` wrapper, injected readout, command discount or line remapping.
```

The path chooses the target, not a new coordinate system. Position is world-valued;
orientation uses the host program's birth reference, as existing property readings
do. Heading is a compass bearing: initially 90°, after `rt 90` it is 180°. A vertical
nose has `heading: null`; `elevation` still names its tilt. Hidden turtles remain
readable. The caller owns formatting, including rounding and any net-turn display.

Paths denote live bindings, not run identities. Subscriptions copy/freeze their
path once; mutating the caller's array cannot retarget them. Every play attempt
still retires old subscriptions. A failed play is not a rollback: a subsequent
live read can describe its installed prefix, while a new subscription requires
successful acceptance. Retained answers remain inert data after disposal.
Registration checks readiness before inspecting caller path entries, then rechecks
source ownership after copying. Reentrant disposal installs no listener; replacement
throws the same `reason: 'superseded'` error shape as play supersession. The existing
not-ready error has no `reason`. A proposal invalidated during path copying returns
`stale`; reads intentionally describe the world current after copying. No automatic
retry is appropriate: a replacement may have different native laws.

This is a breaking target-shape change: frame reads/subscriptions/proposals need
paths, not bare names or serialized execution addresses. A malformed path or a
frame path without a property throws `TypeError`; a well-formed absent path returns
`missing`. `read(name)` / `subscribe(name, fn)` still read top-level named values.
The same path resolver serves proposals, but the existing native free-point gate
still refuses the main turtle, datum and headed actors. Reading grants no motion
permission. No new clock, mutable frame handle or state cache is introduced.

These are live accepted-state observations, not guaranteed rendered-head snapshots.
A program's same-instant self-read can precede a pending turn; `yield` / `wait 0`
closes that boundary. `onFrame` supplies a frozen view, not a frozen mathematical
world. Projecting a later reading through that view does not prove frame alignment.

## Compose controls with drawings, not a second model

Use a persistent interactive control world and a separate drawing-only world.
Replay only the drawing when an accepted input changes, never the declarations
of the held control. Ordinary `fw` is not a reactive command.

```js
const drawing = createWorld(drawingCanvas)
let revision = 0
async function redraw(length) {
    const mine = ++revision
    try {
        const run = await drawing.play(`fw ${length}`)
        await run.finished
    } catch (error) {
        if (mine === revision) report(error)
    }
}
const stopDrawing = control.interaction.subscribe('length', answer => {
    if (answer.kind === 'value' && typeof answer.value === 'number')
        void redraw(answer.value)
})
// On unmount: stopDrawing(); control.dispose(); drawing.dispose().
```

For several readouts driving one drawing, coalesce callbacks into one scheduled
redraw and reread the accepted inputs together. Do not maintain a competing
geometry model, invent a slider range that the source did not state, or turn
render failures into accepted values. DOM/keyboard accessibility, scheduling,
and presentation belong to your page; mathematical acceptance belongs to the
runtime.

## License and source

GNU AGPL version 3; see [LICENSE](LICENSE). Retain `NOTICE.txt`, `licenses/` and
`host.mjs.LEGAL.txt` when redistributing. Bundled dependencies retain their own
notices; the source snapshot does not waive applicable AGPL source obligations.

`release.json` identifies the commit, dirty-source revision, source digest and
per-file hashes. `sources/` contains the actual build inputs, including the locked
build tooling. PaperLang shares Dojo's release version; a
local version string alone does not prove a clean release.

Build, reproduce and publish: [release runbook](sources/scripts/release/host.org).
