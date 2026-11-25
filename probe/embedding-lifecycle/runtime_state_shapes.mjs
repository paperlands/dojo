// probe-status: concluded
// Distinguish a retained fact, a query at H, and a scoped work budget.
import assert from 'node:assert/strict'
import { buildWorld, fork, delayedResponder } from '../../test/js/laws/harness.mjs'
import { worldProgress } from '../../assets/js/turtling/vitals.js'

function inspect(scheduler, H) {
    const frame = scheduler.root.children.get('host')
    return {
        H, dueAt: frame.resumeAt, suspension: frame.suspension?.kind ?? null,
        held: scheduler.held, atCut: scheduler.atCut, done: scheduler.done,
        settledThrough: scheduler.isSettledThrough(H), progress: worldProgress(scheduler).phase,
    }
}

let workNow = 0
const scheduler = buildWorld({ clock: () => workNow, strokeMax: 0, breathEvery: 64 })
scheduler.hotSwapChild('host', fork('host', 'fw 1\nwait 0.1\nfw 1'), { fresh: true, deferStart: true })
let expired, scope
const off = scheduler.onAcceptedChange(() => {
    workNow = 2
    const outerBefore = expired()
    const inner = scheduler.withSlice(8, check => check())
    const outerAfter = expired()
    scope = { outerBefore, inner, outerAfter }
})
scheduler.withSlice(1, check => { expired = check; scheduler.tick(0) })
off()
assert.equal(scope.outerBefore, true, 'the outer budget has expired')
assert.equal(scope.inner, false, 'the inner has a new budget')
// Do not pin the defect as a contract: a future repair should report `restored`.
console.log('nested work scope:', { ...scope, restored: scope.outerBefore === scope.outerAfter })

const waiting = inspect(scheduler, 40), due = inspect(scheduler, 100)
scheduler.held = true
const held = inspect(scheduler, 40)
scheduler.held = false
scheduler.tick(100)
const ended = inspect(scheduler, 100)
const responder = delayedResponder()
const pending = buildWorld({ admitAsync: responder.admit, clock: () => 0 })
pending.hotSwapChild('host', fork('host', 'fw 1'), { fresh: true, deferStart: true })
pending.tick(0)
const admission = inspect(pending, 0)
pending.removeChild('host')
assert.ok([waiting, due, held, admission].every(row => row.progress === 'building' && !row.done))
assert.ok(waiting.settledThrough && !due.settledThrough && due.atCut)
assert.deepEqual(held, { ...waiting, held: true })
assert.ok(!admission.atCut && admission.suspension === 'admission')
assert.ok(ended.done)
console.table({ waiting, due, held, admission, ended })
