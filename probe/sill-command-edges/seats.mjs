// probe-status: active
import assert from 'node:assert/strict'
import { Group, Vector3 } from '../../assets/js/utils/three-entry.js'
import { createCompositor } from '../../assets/js/turtling/compositor.js'
import { createMaterialCache } from '../../assets/js/turtling/render/line/material-cache.js'
import { createFocus } from '../../assets/js/turtling/focus.js'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { allDone, frameWorldTransform } from '../../assets/js/turtling/scheduler.js'
import { currentPlay, seatOf } from '../../assets/js/turtling/playback.js'
import { createDial } from '../../assets/js/hooks/shell/dial.js'
import { pageLaw, CORESHELL, OUTERSHELL, SELF } from '../../assets/js/weave/page.js'
import { buildWorld, fork } from '../../test/js/laws/harness.mjs'

const source = 'fw 1\nwait 0.1\nfw 2\nwait 1\nfw 3'
const alternate = 'fw 4\nwait 0.2\nfw 8\nwait 1\nfw 16'
const x = frame => frameWorldTransform(frame).position[0]

function bench() {
    const law = pageLaw()
    const scheduler = buildWorld({ capacity: 512, clock: () => 0 })
    const compositor = createCompositor(scheduler, {
        scene: new Group(), camera: { position: new Vector3(0, 0, 1000) },
        materials: createMaterialCache(), requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), createText: () => { throw Error('no labels') } })
    const turtle = { scheduler, compositor }
    scheduler.root._onSeatChange = () => compositor.verifyHold()
    const selection = { addr: 'A', grantPlace: CORESHELL }
    const recipes = new Map()
    const seat = () => ({ slot: law.seatOf(selection.addr, CORESHELL) })
    let reseats = 0
    const dial = createDial(turtle, {
        seat,
        authority: slot => selection.grantPlace === CORESHELL && seat().slot === slot,
        reseat: (play, prepare) => {
            reseats++
            compositor.beginPlay()
            scheduler.hotSwapChild(play.seat, recipes.get(play.seat), { fresh: true, deferStart: true })
            prepare?.()
            compositor.flush()
            return true
        },
    })
    function observe(addr, place, code) {
        const answer = law.observe(addr, { place, doc: code, name: addr, witness: SELF })
        for (const gone of answer.gone) scheduler.removeChild(gone)
        for (const run of answer.runs) {
            const recipe = fork(run.name, run.code)
            recipe.code.ast = run.nodes ?? recipe.code.ast
            recipes.set(run.slot, recipe)
            scheduler.hotSwapChild(run.slot, recipe, { choices: run.choices, deferStart: true })
        }
        return answer
    }
    observe('A', CORESHELL, source)
    compositor.advance(0)
    return { law, turtle, scheduler, compositor, selection, dial, observe, reseats: () => reseats,
        frame: (addr, place = CORESHELL) => scheduler.root.children.get(law.seatOf(addr, place)),
        close() { dial.close(); compositor.dispose() },
    }
}

{
    const b = bench()
    const aSlot = b.law.seatOf('A', CORESHELL)
    const aPlay = { seat: aSlot, ...seatOf(b.turtle, aSlot) }
    const paintedA = b.dial.read()
    // Deliberately do not rotate the dial's epoch; isolate selection and play checks.
    b.selection.addr = 'B'
    assert.equal(b.dial.read(), null, 'B is selected but no B play has been admitted')
    assert.equal(currentPlay(b.turtle, aPlay), true, 'A is still the same solo runtime occupant')
    assert.equal(paintedA.replay(), false, 'runtime currency alone cannot authorize the old selection')
    const landed = b.observe('B', CORESHELL, alternate)
    assert.ok(landed.gone.includes(aSlot), 'the plain coreshell ladder evicts A when B seats')
    b.compositor.advance(100)
    assert.equal(currentPlay(b.turtle, aPlay), false, 'A is no longer a runtime occupant')
    assert.equal(paintedA.replay(), false)
    assert.equal(b.reseats(), 0)
    const oldB = b.frame('B')
    const paintedB = b.dial.read()
    assert.ok(paintedB, 'the admitted B is visible')
    b.compositor.advance(150)
    assert.equal(b.frame('B'), oldB, 'advance alone kept the incarnation')
    assert.equal(paintedB.replay(), true)
    assert.notEqual(b.frame('B'), oldB)
    assert.equal(b.reseats(), 1)
    const paintedB2 = b.dial.read()
    b.observe('B', CORESHELL, source)
    b.compositor.advance(200)
    assert.equal(paintedB2.replay(), false, 'same address and grant, new occupant')
    assert.equal(b.reseats(), 1)
    console.log('quiet-window model: empty B, old A denied before eviction; B accepts across advance; same-slot edit fences B')
    b.close()
}

{
    const b = bench()
    const core = b.frame('A')
    const painted = b.dial.read()
    assert.equal(painted.pause(), true, 'before claim or seating, a real core grant can still act')
    b.selection.grantPlace = OUTERSHELL
    b.dial.ended()
    assert.equal(b.compositor.held, false, 'outer claim ends the old core grant before seating')
    assert.equal(b.dial.read().can.hold, false, 'solo core remains visible but not authorized')
    assert.equal(painted.pause(), false)
    const outer = b.observe('A', OUTERSHELL, alternate)
    assert.deepEqual(outer.gone, [], 'outer draft does not evict its same-address core play')
    assert.ok(b.frame('A', OUTERSHELL))
    for (let t = 10; t <= 220 && x(core) === 1; t += 10) b.compositor.advance(t)
    assert.equal(b.frame('A'), core)
    assert.equal(x(core), 3, 'the installed core continuation advances under outer light')
    assert.equal(b.dial.read().phase, 'running')
    assert.equal(b.dial.read().can.hold, false)
    assert.equal(b.dial.read().can.replay, false)
    console.log('outer claim first: core remains visible without control; same actor advanced 1→3')
    b.close()
}

{
    const b = bench()
    const core = b.frame('A')
    const old = b.dial.read()
    // Deliberately invert the shell order: outer seating before the grant edge.
    b.observe('A', OUTERSHELL, alternate)
    assert.equal(b.frame('A'), core)
    assert.equal(old.pause(), false, 'a second root refuses hold even under the unrotated grant')
    assert.equal(old.replay(), false, 'same incarnation does not mean a solo stage')
    assert.equal(b.compositor.held, false)
    assert.equal(b.dial.read().can.hold, false)
    console.log('outer seat first, grant unchanged: topology alone blocks both core commands')
    b.close()
}

{
    const b = bench()
    // A simple root with no descendants can finish while a neighbor still waits.
    b.observe('A', CORESHELL, 'fw 1\nwait 0.1\nfw 2')
    b.observe('A', OUTERSHELL, 'wait 1\nfw 9')
    const core = b.frame('A')
    for (let t = 10; t <= 200; t += 10) b.compositor.advance(t)
    assert.equal(core.done, true)
    assert.equal(x(core), 3)
    assert.equal(b.frame('A', OUTERSHELL).done, false)
    const phase = b.dial.read().phase
    const ms = b.dial.read().ms
    b.compositor.advance(210)
    console.log('a finished core with live outer neighbor:', {
        coreDone: core.done, phase, clockAdvanced: b.dial.read().ms > ms,
    })
    b.close()
}

const completionCases = [
    ['child', 'as Kid do\nwait 1\nfw 1\nend\nfw 5', (_, frame) => frame.children.get('Kid')],
    ['installation', 'let A\ndef attach receiver do\nas receiver do\nwait 1\nfw 1\nend\nend\nattach A',
        (scheduler, frame) => scheduler.installationsOf(frame)[0].frame],
]

for (const [kind, code, descendantOf] of completionCases) {
    const s = buildWorld({ breathEvery: 0 })
    const seat = s.hotSwapChild('short', fork('short', code))
    s.hotSwapChild('long', fork('long', 'wait 5\nfw 1'))
    const ticks = []
    for (const now of [0, 999, 1000, 2000, 5000]) {
        s.tick(now)
        for (const frame of s.registry.values()) frame.channel.drain()
        s.readouts.drain()
        ticks.push({ now, body: seat.done, descendant: descendantOf(s, seat)?.done,
            subtree: allDone(seat), settledThrough: s.isSettledThrough(now), stageEnd: s.end })
    }
    assert.deepEqual(ticks[0], { now: 0, body: true, descendant: false,
        subtree: false, settledThrough: true, stageEnd: null })
    assert.equal(ticks[1].subtree, false)
    assert.equal(ticks[3].subtree, true)
    assert.equal(ticks[3].stageEnd, null, 'the completed play cannot recover its time from stageEnd')
    assert.equal(ticks[4].stageEnd, 5000)
    assert.equal(s.errors.length, 0)
    console.log(kind + ' completion versus world settlement', ticks)
}
