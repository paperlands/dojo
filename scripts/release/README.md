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
It uses logical program time, not wall-clock time. Events are not state subscriptions.

The canvas's content box is the surface, not the window. Author its size in CSS;
the runtime follows resizing and keeps each canvas's overlay beside that canvas.
An unsized canvas keeps its initial box; a CSS-collapsed canvas stays collapsed.

## Read, propose, subscribe

```js
const control = createWorld(controlCanvas, { interactive: true })
const run = await control.play('let A\nlet A.y = 0\nlet A.z = 0\nlet length = A.x')
await run.finished

const stop = control.interaction.subscribe('length', answer => {
    if (answer.kind === 'value') output.textContent = String(answer.value)
})
const verdict = control.interaction.propose('A', [80, 0, 0])
if (verdict.kind !== 'accept') console.log(verdict.kind, verdict.message)
// stop() cancels delivery immediately; it is safe to call more than once.
```

| Operation                         | Meaning                                      |
|-----------------------------------|----------------------------------------------|
| `read('length')`                   | Read a top-level named value                 |
| `read('A', 'position')`            | Read a top-level place's PaperLang property   |
| `subscribe('length', fn)`          | Observe a named value                        |
| `subscribe('A', 'bearing', fn)`     | Observe a place property                     |
| `propose('A', [x, y, z])`           | Request a world-space position for a free point |

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
