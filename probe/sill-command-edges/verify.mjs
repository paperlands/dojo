// probe-status: active
import assert from 'node:assert/strict'
import { Group, Vector3 } from '../../assets/js/utils/three-entry.js'
import { createCompositor } from '../../assets/js/turtling/compositor.js'
import { createMaterialCache } from '../../assets/js/turtling/render/line/material-cache.js'
import { createFocus } from '../../assets/js/turtling/focus.js'
import { createDial } from '../../assets/js/hooks/shell/dial.js'
import { SE3 } from '../../assets/js/turtling/se3.js'
import { frameWorldTransform } from '../../assets/js/turtling/scheduler.js'
import { parseProgram, reparseProgram } from '../../assets/js/turtling/parse.js'
import { copyChoices } from '../../assets/js/turtling/laws/hand_choices.js'
import { buildWorld, fork } from '../../test/js/laws/harness.mjs'

const source = 'fw 1\nwait 0.1\nfw 2\nwait 1\nfw 3'

function bench(reseat = () => false, program = source, options = {}) {
    const scheduler = buildWorld({ capacity: 512, clock: () => 0 })
    const compositor = createCompositor(scheduler, {
        scene: new Group(), camera: { position: new Vector3(0, 0, 1000) },
        materials: createMaterialCache(), requestRender() {}, viewOffset: () => SE3.identity(),
    }, { focus: createFocus(scheduler), createText: () => { throw Error('no labels') } })
    scheduler.root._onSeatChange = () => compositor.verifyHold()
    const dial = createDial({ scheduler, compositor }, {
        seat: () => ({ slot: 'A' }), authority: () => true,
        prepareReplay: (play) => (prepare) => reseat(play, prepare), ...options,
    })
    scheduler.hotSwapChild('A', fork('A', program), { fresh: true, deferStart: true })
    compositor.advance(0)
    return { scheduler, compositor, dial }
}

{
    let reseats = 0
    const { scheduler, dial, compositor } = bench(() => { reseats++; return true })
    const reading = dial.read()
    const occupant = scheduler.root.children.get('A')
    const run = occupant.run
    scheduler.hotSwapChild('B', fork('B', 'wait 1'), { deferStart: true })
    assert.equal(reading.pause(), false, 'sharing blocks a solo command')
    assert.equal(reading.replay(), false, 'sharing blocks restarting')
    scheduler.removeChild('B')
    assert.equal(scheduler.root.children.get('A'), occupant)
    assert.equal(occupant.run, run)
    const oldPause = reading.pause()
    if (oldPause) assert.equal(dial.read().resume(), true, 'release this probe’s pause')
    const oldReplay = reading.replay()
    console.log('solo → shared → solo; no intervening paint:', { oldPause, oldReplay, reseats })
    dial.close()
    compositor.dispose()
}

{
    const { dial, compositor } = bench()
    dial.catchLine(3)
    compositor.advance(100)
    const painted = dial.read()
    const holder = compositor.holdOwner
    assert.equal(painted.caught, true)
    assert.ok(holder)
    assert.equal(painted.replay(), false)
    const after = dial.read()
    const sameLease = compositor.holdOwner === holder
    const stillHeld = compositor.held
    const paintedResume = painted.resume()
    assert.deepEqual({ sameLease, stillHeld, caught: after.caught, paintedResume },
        { sameLease: true, stillHeld: true, caught: true, paintedResume: true })
    console.log('refused restart from caught stop:', {
        sameLease, stillHeld, caught: after.caught, phase: after.phase, paintedResume,
    })
    dial.close()
    compositor.dispose()
}

{
    const { scheduler, compositor, dial } = bench()
    dial.catchLine(3)
    scheduler.hotSwapChild('A', fork('A', 'fw 1\nwait 0.1\nfw 9\nfw 2\nwait 1'), { fresh: true, deferStart: true })
    dial.syncCatch()
    const before = dial.catchReading()
    compositor.advance(100)
    const after = dial.catchReading()
    console.log('line 3 selected; edit inserts a different valid command on line 3:', {
        before, after, displayCaught: dial.read()?.caught, held: compositor.held,
    })
    dial.close()
    compositor.dispose()
}

{
    // Two reads of B.x around the catch: preserve the executed prefix, change what the next read sees.
    const program = 'let B\nfw (1+B.x)\nwait 0.1\nfw (2+B.x)\nwait 1'
    const { scheduler, compositor, dial } = bench(undefined, program)
    dial.catchLine(4)
    compositor.advance(100)
    const actor = scheduler.root.children.get('A')
    const point = actor.children.get('B')
    const run = actor.run
    const h = scheduler.lastTickTime
    const x = () => frameWorldTransform(actor).position[0]
    const before = x()
    assert.equal(dial.read().caught, true)
    const hand = scheduler.requestMotion(point, {
        rotation: point.transform.deref().rotation, position: [8, 0, 0],
    }, scheduler.motionRevision)
    assert.equal(hand.kind, 'accept')
    assert.equal(dial.read().caught, true, 'hand does not consume the catch')
    assert.equal(scheduler.lastTickTime, h, 'hand does not spend playback time')
    assert.equal(before, 1)
    assert.equal(x(), before, 'the held prefix is not replayed')
    dial.catchLine(4)
    compositor.advance(100)
    assert.equal(scheduler.root.children.get('A'), actor)
    assert.equal(actor.run, run)
    assert.equal(x(), 11, 'the not-yet-run statement reads the new B.x')
    console.log('catch → touch → continue:', { h, prefix: before, B: frameWorldTransform(point).position[0], continued: x() })
    dial.close()
    compositor.dispose()
}

{
    const { scheduler, compositor, dial } = bench()
    compositor.advance(100)
    const reading = dial.read()
    assert.equal(reading.pause(), true)
    const holder = compositor.holdOwner
    const occupant = scheduler.root.children.get('A')
    const run = occupant.run
    // The two relevant native calls in upsertAmbient's order; no browser stage.
    compositor.beginPlay()
    const result = scheduler.hotSwapChild('A', fork('A', source), {
        fresh: true, choices: { v: 1, inputs: null }, deferStart: true,
    })
    assert.equal(result, occupant, 'invalid choice never seats a successor')
    assert.equal(occupant.run, run)
    console.log('beginPlay → invalid fresh seat:', {
        sameOccupant: true, sameLease: compositor.holdOwner === holder, held: compositor.held,
    })
    dial.close()
    compositor.dispose()
}

{
    const { scheduler, compositor, dial } = bench()
    dial.catchLine(3)
    const frame = scheduler.root.children.get('A')
    scheduler.hotSwapChild('B', fork('B', 'wait 1'), { deferStart: true })
    const breakLineBeforeRead = frame.batch.breakLine
    const reading = dial.catchReading()
    console.log('gutter projection on stale catch:', {
        reading, breakLineBeforeRead, breakLineAfterRead: frame.batch.breakLine,
    })
    dial.close()
    compositor.dispose()
}

{
    let attempts = 0
    const { scheduler, compositor, dial } = bench(() => { attempts++; return false }, source, {
        prepareReplay: () => null,
    })
    dial.catchLine(3)
    compositor.advance(100)
    const frame = scheduler.root.children.get('A')
    const lease = compositor.holdOwner
    const breakLineBefore = frame.batch.breakLine
    const painted = dial.read()
    assert.equal(painted.caught, true)
    assert.equal(painted.replay(), false)
    assert.equal(attempts, 0, 'a refused recipe never reaches the mutation')
    assert.equal(compositor.holdOwner, lease, 'the stop retains the exact lease')
    assert.equal(dial.catchReading().hit, true)
    assert.equal(frame.batch.breakLine, breakLineBefore, 'the stop still owns the same executor position')
    assert.equal(painted.resume(), true, 'the already-painted Continue still works')
    console.log('preflight refusal preserves receipt, hit, breakpoint, and painted Continue', { breakLineBefore })
    dial.close()
    compositor.dispose()
}

{
    // A scheduler-valid seed commits; the later evaluation wound is not an admission refusal.
    const faulting = 'wait 0.1\nnope'
    let holderAtNativeEntry
    const b = bench((_play, prepare) => {
        holderAtNativeEntry = b.compositor.holdOwner
        // Model upsertAmbient's committed path with native calls but no browser stage.
        b.compositor.beginPlay()
        b.scheduler.hotSwapChild('A', fork('A', faulting), { fresh: true, deferStart: true,
            choices: { v: 1, inputs: [] },
        })
        prepare?.()
        b.compositor.flush()
        return true
    })
    const { scheduler, compositor, dial } = b
    dial.catchLine(3)
    compositor.advance(100)
    const oldFrame = scheduler.root.children.get('A')
    const oldRun = oldFrame.run
    const oldLease = compositor.holdOwner
    const painted = dial.read()
    assert.equal(painted.caught, true)
    assert.ok(oldLease)
    assert.equal(painted.replay(), true, 'a committed replacement is a successful Restart')
    const fresh = scheduler.root.children.get('A')
    assert.notEqual(fresh.id, oldFrame.id)
    assert.notEqual(fresh.run, oldRun)
    assert.notEqual(compositor.holdOwner, oldLease)
    assert.equal(painted.resume(), false, 'the predecessor cannot release anything in the new play')
    if (compositor.held) assert.equal(dial.read().resume(), true)
    compositor.advance(100)
    compositor.advance(200)
    assert.equal(dial.read().phase, 'fault', 'the new execution owns the fault')
    assert.equal(holderAtNativeEntry, oldLease, 'no release before the native fresh-play door')
    console.log('admitted faulting restart:', { oldLeaseAtNativeEntry: holderAtNativeEntry === oldLease,
        newIncarnation: true, phase: dial.read().phase, held: compositor.held })
    dial.close()
    compositor.dispose()
}

{
    // Structurally valid envelopes from page law must still be materialized before native seating.
    const cellOffer = { v: 1, inputs: [{
        route: { root: { cell: 'other' }, names: ['B'] }, action: { kind: 'translation', by: [1, 0, 0] },
    }] }
    assert.ok(copyChoices(cellOffer), 'a cell offer passes the portable envelope validator')
    const { scheduler, compositor, dial } = bench()
    const old = scheduler.root.children.get('A')
    assert.equal(scheduler.hotSwapChild('A', fork('A', source), { fresh: true, choices: cellOffer }), old,
        'native admission requires a materialized document-root offer')
    console.log('portable-valid cell offer still refuses at native admission (page law normally binds it)')
    dial.close()
    compositor.dispose()
}

{
    const prior = parseProgram(source)
    const site = prior[2]
    const before = site.span.line
    const edited = reparseProgram('# a note\n' + source, source, prior)
    assert.equal(edited[3], site, 'the green parser reuses the same site object')
    assert.equal(before, 3)
    assert.equal(site.span.line, 4, 'the adopted object moves, including through old references')
    console.log('green-node reuse is not source-version identity:', { sameObject: true, before, after: site.span.line })
}

function documentBench() {
    let doc = Object.freeze({ text: source })
    const b = bench((_play, prepare) => {
        b.compositor.beginPlay()
        b.scheduler.hotSwapChild('A', fork('A', source), { fresh: true, deferStart: true })
        prepare?.()
        b.compositor.flush()
        return true
    }, source, { docOf: () => doc })
    return { ...b, edit(text = '# inserted\n' + source) { doc = Object.freeze({ text }) } }
}

{
    const b = documentBench()
    const frame = b.scheduler.root.children.get('A')
    b.dial.catchLine(3)
    assert.equal(frame.batch.breakLine, 3)
    b.edit()
    b.dial.disarm()
    assert.equal(frame.batch.breakLine, null, 'the edit edge disarms a live unhit site')
    assert.equal(b.dial.catchReading(), null)
    b.edit(source) // same bytes after undo are not the original selection
    b.dial.syncCatch()
    b.compositor.advance(100)
    assert.equal(b.compositor.held, false, 'neither the edit nor its undo re-arms the row')
    assert.equal(frameWorldTransform(frame).position[0], 3, 'old play continued during the quiet window')
    b.dial.close()
    b.compositor.dispose()
}

for (const command of ['resume', 'replay']) {
    const b = documentBench()
    b.dial.catchLine(3)
    b.compositor.advance(100)
    const old = b.scheduler.root.children.get('A')
    const lease = b.compositor.holdOwner
    const stopped = b.dial.read()
    assert.equal(stopped.caught, true)
    b.edit()
    b.dial.disarm()
    b.compositor.advance(110) // an unrelated display drive must not consume the acquired stop
    b.compositor.flush()
    assert.equal(b.compositor.holdOwner, lease, 'a document edit does not release an acquired stop')
    assert.equal(b.dial.catchReading().hit, false, 'the hit is not live in the new document')
    assert.equal(stopped[command](), true)
    const current = b.scheduler.root.children.get('A')
    assert.equal(current === old, command === 'resume')
    assert.equal(current.batch.breakLine, null, 'continuing or restarting cannot re-arm the old row')
    if (b.compositor.held) assert.equal(b.dial.read().resume(), true, 'release the ordinary fresh pause')
    b.compositor.advance(100)
    b.compositor.advance(200)
    assert.equal(b.compositor.held, false)
    assert.equal(frameWorldTransform(current).position[0], 3)
    console.log(`document edit at hit → ${command}: retained exact stop until command; no re-arm`)
    b.dial.close()
    b.compositor.dispose()
}

{
    const b = documentBench()
    const frame = b.scheduler.root.children.get('A')
    b.dial.catchLine(3)
    const republish = b.dial.disarm() // content publication with NO change to the document
    const sameDocStillArmed = frame.batch.breakLine === 3
    if (!sameDocStillArmed) b.dial.catchLine(3)
    b.edit()                         // actual editor transaction
    b.compositor.advance(100)        // a drive beats the after-paint bridge delivery
    const hitBeforeBridge = b.compositor.held
    assert.equal(hitBeforeBridge, false, 'the source witness stops a stale arm before drive')
    assert.equal(frame.batch.breakLine, null, 'the drive retires the old trigger without any notification')
    assert.equal(sameDocStillArmed, true, 'republication of unchanged source does not retire the trigger')
    const lateDisarm = b.dial.disarm()
    console.log('same-document publication and delayed edit delivery:', {
        republish, sameDocStillArmed, hitBeforeBridge, lateDisarm,
    })
    b.dial.close()
    b.compositor.dispose()
}
