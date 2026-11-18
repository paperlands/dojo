// Declared behaviour revisions: target witnesses and bounded explicit-question controls.
// The declared-behaviour revision contract is implemented; these are standing witnesses. (id:declared-behaviour-revision)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, delayedResponder, settle } from './harness.mjs'
import { frameWorldTransform } from '../../../assets/js/turtling/scheduler.js'

const position = frame => frameWorldTransform(frame).position.map(n => +n.toFixed(6))
const errors = scheduler => scheduler.errors.map(e => e.message)
const ACCEPT = ({ requested }) => ({ accepted: true, transform: requested })

function fixture(body, { named = true, question = '', breathEvery = 0, ...options } = {}) {
    const offers = [], events = []
    const scheduler = buildWorld({ breathEvery, admit: request => {
        offers.push({ command: request.command, receiver: request.frame?.id,
            from: [...request.from.position], to: [...request.requested.position] })
        return ACCEPT(request)
    }, ...options })
    const acceptedMoves = []
    scheduler.onAcceptedChange(() => {
        const fox = scheduler.root.children.get('host')?.children.get('fox')
        if (!fox) return
        const at = position(fox), previous = acceptedMoves.at(-1)?.position ?? [0, 0, 0]
        if (at.some((n, i) => n !== previous[i])) acceptedMoves.push({ position: at, revision: scheduler.motionRevision })
    })
    const host = scheduler.hotSwapChild('host', fork('host', `let rabbit
let fox
def hunt prey predator${question ? ' sample' : ''} do
  as predator do
${body}
  end
end
${named ? 'let hunting = ' : ''}hunt rabbit fox${question ? ` ${question}` : ''}`))
    const owner = named ? host.children.get('hunting') : host
    const fox = host.children.get('fox'), rabbit = host.children.get('rabbit')
    let now = 0
    const drain = () => {
        for (const frame of scheduler.registry.values()) {
            for (const event of frame.channel.drain()) {
                events.push({ frame: frame.id, run: frame.parent?.runIncarnation,
                    type: event.type, text: event.text, points: event.points })
            }
        }
    }
    drain()
    const tick = (advance = 1000) => {
        now += advance
        scheduler.tick(now)
        drain()
        scheduler.readouts.drain()
        drain()
    }
    const pump = (count = 20, advance = 1000) => {
        for (let i = 0; i < count; i++) tick(advance)
    }
    const move = (frame, xyz) => {
        const verdict = scheduler.requestMotion(frame,
            { ...frameWorldTransform(frame), position: xyz }, scheduler.motionRevision, 'world')
        assert.equal(verdict.kind, 'accept', JSON.stringify(verdict))
        scheduler.readouts.recompute()
        scheduler.readouts.drain()
        drain()
        return verdict
    }
    const installation = () => scheduler.installationsOf(owner)[0]
    const steps = () => offers.filter(o => o.command === 'fw')
    const labels = () => events.filter(e => e.type === 'label').map(e => e.text)
    return { scheduler, host, owner, fox, rabbit, events, offers, acceptedMoves, nowAt: () => now, tick, pump, move, installation, steps, labels }
}

const WAITING = `    label prey.position
    fw 1
    wait 10
    label prey.position
    fw 1`

function waiting(options = {}) {
    const w = fixture(WAITING, options)
    w.pump(2)
    assert.equal(w.installation().frame.done, false)
    assert.deepEqual(position(w.fox), [1, 0, 0], JSON.stringify({ steps: w.steps(), wait: w.installation().frame.resumeAt, labels: w.labels() }))
    assert.deepEqual(errors(w.scheduler), [])
    return w
}

function revisited(options = {}) {
    const w = waiting(options), old = w.installation(), before = w.owner.runIncarnation
    w.move(w.rabbit, [0, 5, 0])
    w.pump(2)
    return { w, old, before }
}

function assertRestart({ w, old, before }) {
    assert.equal(w.owner.runIncarnation, before + 1, 'changed consumed meaning starts a new run')
    assert.notEqual(w.installation(), old, 'the new run seats a fresh installation')
    assert.equal(w.scheduler.registry.has(old.frame.id), false, 'old reader/publication rights leave')
    assert.equal(w.installation().receiver, w.fox, 'receiver identity survives replacement')
    assert.deepEqual(position(w.fox), [2, 0, 0], 'new run starts from accepted present, not origin')
    assert.equal(w.installation().frame.elapsedTime, 10, 'fresh run starts its authored wait at local time zero')
    assert.deepEqual(errors(w.scheduler), [])
}

test('target: moving a consumed participant during a wait reconstructs hunting', () => {
    const w = fixture(`    loop 3 do
      faceto prey
      fw 3
      wait 10
    end`)
    w.pump(2)
    const old = w.installation(), before = w.owner.runIncarnation, accepted = position(w.fox)
    assert.equal(old.frame.done, false)
    assert.deepEqual(accepted, [3, 0, 0])
    w.move(w.rabbit, [0, 5, 0])
    w.pump(2)
    assert.equal(w.owner.runIncarnation, before + 1, 'implicit faceto consumes the changed question')
    assert.notEqual(w.installation(), old)
    assert.equal(w.scheduler.registry.has(old.frame.id), false)
    assert.equal(w.installation().receiver, w.fox)
    const distance = Math.hypot(...position(w.fox).map((n, i) => n - accepted[i]))
    assert.ok(Math.abs(distance - 3) < 1e-6, 'new first step begins at accepted receiver pose')
    assert.deepEqual(errors(w.scheduler), [])
})

test('a consumed installation read serves the boundary, then supersedes on change', () => {
    const { w, old, before } = revisited()
    assert.equal(w.owner.runIncarnation, before + 1, 'a changed consumed meaning starts a new run')
    assert.notEqual(w.installation(), old)
    assert.ok(w.owner.consumed.size > 0, 'the installation read is recorded in the owning question')
    w.pump(15)
    assert.deepEqual(w.labels(), ['[0, 0, 0]', '[0, 5, 0]', '[0, 5, 0]'])
    assert.deepEqual(position(w.fox), [3, 0, 0])
    assert.deepEqual(errors(w.scheduler), [])
})

test('target: a late installation encounter serves its construction boundary before recapture', () => {
    const w = fixture(`    wait 3
    label prey.position
    fw 1`)
    w.pump(2)
    assert.deepEqual(w.labels(), [])
    w.move(w.rabbit, [0, 5, 0])
    w.pump(8)
    assert.equal(w.labels()[0], '[0, 0, 0]', 'the first run never silently reads through its old capture')
    assert.ok(w.owner.runIncarnation > 1, 'discovery owes a comparison and a fresh question')
    assert.deepEqual(errors(w.scheduler), [])
})

test('control: an explicit positional question exercises the existing restart path', () => {
    assertRestart(revisited({ question: 'rabbit.position' }))
})

test('control: equal explicit question preserves installation and progress', () => {
    const w = waiting({ question: 'rabbit.position' }), old = w.installation(), run = w.owner.runIncarnation
    w.move(w.rabbit, [0, 0, 0])
    w.pump(2)
    assert.equal(w.owner.runIncarnation, run)
    assert.equal(w.installation(), old)
    assert.deepEqual(position(w.fox), [1, 0, 0])
    w.pump(15)
    assert.deepEqual(position(w.fox), [2, 0, 0])
    assert.deepEqual(errors(w.scheduler), [])
})

test('target: an unconsumed facet stays equal while the installation records its consumed y', () => {
    const w = fixture(`    label prey.y
    wait 10
    label prey.y`)
    w.pump(2)
    const old = w.installation(), run = w.owner.runIncarnation
    assert.ok(w.owner.consumed.size > 0, 'equal-question reuse must not hide missing dependency recording')
    w.move(w.rabbit, [5, 0, 0])
    w.pump(15)
    assert.equal(w.owner.runIncarnation, run)
    assert.equal(w.installation(), old)
    assert.deepEqual(w.labels(), ['0', '0'])
    assert.deepEqual(errors(w.scheduler), [])
})

test('control: changing an unconsumed spatial facet does not replace a y-only question', () => {
    const w = fixture(`    label prey.y
    wait 10
    label prey.y`, { question: 'rabbit.y' })
    w.pump(2)
    const old = w.installation(), run = w.owner.runIncarnation
    w.move(w.rabbit, [5, 0, 0])
    w.pump(15)
    assert.equal(w.owner.runIncarnation, run)
    assert.equal(w.installation(), old)
    assert.deepEqual(w.labels(), ['0', '0'])
    assert.deepEqual(errors(w.scheduler), [])
})

test('control: an external receiver motion revises the declaration from its accepted pose', () => {
    const w = waiting(), old = w.installation(), run = w.owner.runIncarnation
    w.move(w.fox, [100, 0, 0])
    w.pump(15)
    assert.equal(w.owner.runIncarnation, run + 1, 'an external receiver change revises the declaration')
    assert.notEqual(w.installation(), old)
    assert.deepEqual(position(w.fox), [102, 0, 0], 'the fresh run resumes from the accepted present')
    assert.deepEqual(errors(w.scheduler), [])
})

test('control: an ordinary call keeps its live read and reached execution', () => {
    const { w, old, before } = revisited({ named: false })
    w.pump(15)
    assert.equal(w.owner.runIncarnation, before)
    assert.equal(w.installation(), old)
    assert.deepEqual(w.labels(), ['[0, 0, 0]', '[0, 5, 0]'])
    assert.deepEqual(position(w.fox), [2, 0, 0])
    assert.deepEqual(errors(w.scheduler), [])
})

async function pending(question) {
    const responder = delayedResponder()
    const w = fixture(`    label prey.position
    fw 1`, { question, admitAsync: responder.admit })
    w.pump(2)
    assert.equal(responder.calls.length, 1, 'first run has a genuinely pending request')
    const old = w.installation(), before = w.owner.runIncarnation
    const verdict = w.scheduler.requestMotion(w.rabbit,
        { ...frameWorldTransform(w.rabbit), position: [0, 5, 0] }, w.scheduler.motionRevision, 'world')
    assert.equal(verdict.kind, 'accept', JSON.stringify(verdict))
    w.scheduler.readouts.recompute()
    w.scheduler.readouts.drain()
    w.pump(2)
    return { w, responder, old, before }
}

async function assertRevoked({ w, responder, old, before }) {
    assert.equal(w.owner.runIncarnation, before + 1)
    assert.notEqual(w.installation(), old)
    assert.equal(w.scheduler.registry.has(old.frame.id), false)
    const frozen = position(w.fox)
    responder.calls[0].resolve({ accepted: true, transform: responder.calls[0].request.requested })
    await settle()
    w.pump(2)
    assert.deepEqual(position(w.fox), frozen, 'old accepted reply cannot publish into the new run')
    const current = w.installation()
    assert.equal(current.receiver, w.fox)
    const fresh = responder.calls.find(call => call !== responder.calls[0] && call.request.frame === w.fox)
    assert.ok(fresh, 'the replacement has its own pending request')
    fresh.resolve({ accepted: true, transform: fresh.request.requested })
    await settle()
    w.pump(2)
    assert.deepEqual(position(w.fox), [1, 0, 0], 'current work still publishes; rejection is not a blanket stop')
    assert.deepEqual(errors(w.scheduler), [])
}

test('target: a consumed-input revision revokes a pending old reply', async () => {
    await assertRevoked(await pending(''))
})

test('control: explicit-question replacement revokes a pending old reply', async () => {
    await assertRevoked(await pending('rabbit.position'))
})

test('control: recursive Sierpinski replaces its private answer and preserves equal reuse', () => {
    const scheduler = buildWorld({ breathEvery: 0 })
    const host = scheduler.hotSwapChild('host', fork('host', `def triangle length step do
  when step>0 do
    loop 3 do
      fw length
      lt 120
      triangle length/2 step-1
    end
  end
end
let X
let X.y=0
let depth = round(X.x, 10)/100
let sierpinski = triangle X.x depth`))
    const X = host.children.get('X'), figure = host.children.get('sierpinski')
    let now = 0
    const paths = []
    const pump = () => {
        for (let i = 0; i < 100 && !scheduler.done; i++) {
            scheduler.tick(now += 1000)
            scheduler.readouts.drain()
            for (const frame of scheduler.registry.values()) {
                for (const event of frame.channel.drain()) {
                    if (frame === figure && event.type === 'path') paths.push({ run: figure.runIncarnation, points: event.points })
                }
            }
        }
    }
    pump()
    const first = figure.runIncarnation
    const move = x => {
        const verdict = scheduler.requestMotion(X,
            { ...frameWorldTransform(X), position: [x, 0, 0] }, scheduler.motionRevision, 'world')
        assert.equal(verdict.kind, 'accept', JSON.stringify(verdict))
        scheduler.readouts.recompute()
        scheduler.readouts.drain()
        pump()
    }
    move(100)
    assert.ok(figure.runIncarnation > first)
    assert.ok(paths.some(p => p.run > first))
    assert.deepEqual(paths.find(p => p.run > first).points[0], [0, 0, 0], 'replacement starts from birth pose')
    const shallow = figure.runIncarnation
    move(200)
    assert.ok(figure.runIncarnation > shallow, 'derived depth changes from one to two')
    assert.equal(paths.filter(p => p.run === figure.runIncarnation).length, 12, 'recursive depth-two answer has twelve steps')
    const changed = figure.runIncarnation
    move(200)
    assert.equal(figure.runIncarnation, changed)
    assert.equal(scheduler.done, true)
    assert.deepEqual(errors(scheduler), [])
})

function movingQuestion(question, breathEvery, body) {
    const w = fixture(body, { question, breathEvery })
    w.pump(2, 16)
    const start = { run: w.owner.runIncarnation, offers: w.steps().length, moves: w.acceptedMoves.length, fox: position(w.fox) }
    for (let i = 1; i <= 12; i++) {
        w.move(w.rabbit, [0, i, 0])
        w.tick(16)
    }
    const changing = { run: w.owner.runIncarnation, offers: w.steps().length, moves: w.acceptedMoves.length, fox: position(w.fox) }
    w.pump(80, 1000)
    const settled = { run: w.owner.runIncarnation, offers: w.steps().length, moves: w.acceptedMoves.length, fox: position(w.fox), done: w.installation().frame.done }
    assert.deepEqual(errors(w.scheduler), [])
    return { start, changing, settled }
}

test('boundary: explicit-position revision can starve a wait-first behaviour while input moves', t => {
    const row = movingQuestion('rabbit.position', 0, `    label prey.position
    wait 1
    fw 1`)
    t.diagnostic(JSON.stringify(row))
    assert.ok(row.changing.run > row.start.run)
    assert.equal(row.changing.moves, 0, 'every new question cancels the old authored wait')
    assert.equal(row.settled.moves, 1, 'quiescence lets the final question complete')
    assert.equal(row.settled.done, true)
})

test('boundary: a local restart re-anchors its wait at the revision cut', t => {
    const w = fixture(`    label time
    fw 1
    wait 10
    label time`, { question: 'rabbit.position' })
    w.pump(2)
    const old = w.installation()
    const cut = w.nowAt()
    const before = { run: w.owner.runIncarnation, elapsed: old.frame.elapsedTime, resumeAt: old.frame.resumeAt }
    w.move(w.rabbit, [0, 5, 0])
    w.pump(2)
    const current = w.installation()
    const after = { run: w.owner.runIncarnation, elapsed: current.frame.elapsedTime, resumeAt: current.frame.resumeAt }
    assert.equal(after.run, before.run + 1)
    assert.notEqual(current, old)
    assert.equal(after.elapsed, 10)
    assert.equal(after.resumeAt, cut + 10000,
        'the fresh run schedules its authored wait from the revision cut, not the expired anchor')
    w.pump(15)
    t.diagnostic(JSON.stringify({ cut, before, after, labels: w.labels() }))
    assert.deepEqual(errors(w.scheduler), [])
})

test('boundary: an immediate-step behaviour can accumulate effects across successive questions', t => {
    const rows = [0, 1].map(breathEvery => ({ breathEvery,
        ...movingQuestion('rabbit.position', breathEvery, `    label prey.position
    loop 3 do
      faceto prey
      fw 1
      wait 1
    end`) }))
    t.diagnostic(JSON.stringify(rows))
    for (const row of rows) {
        assert.ok(row.changing.run > row.start.run)
        assert.equal(row.settled.done, true)
    }
})

test('boundary: using accepted receiver output as a question can drive repeated self-replacement', t => {
    const w = fixture(`    label predator.position
    fw 1
    wait 1`, { question: 'fox.position' })
    for (let i = 0; i < 20; i++) w.tick(16)
    const row = { run: w.owner.runIncarnation, offers: w.steps().length, moves: w.acceptedMoves.length, fox: position(w.fox), done: w.scheduler.done, seated: !!w.installation() }
    t.diagnostic(JSON.stringify(row))
    assert.ok(row.run > 2, 'own accepted effects repeatedly change the explicit question')
    assert.ok(row.moves > 2)
    assert.equal(row.done, false, 'bounded reading is not convergence')
    assert.deepEqual(errors(w.scheduler), [])
})

test('boundary: the same recipe and participant identities can start from different accepted poses', t => {
    const scheduler = buildWorld({ breathEvery: 0 })
    const host = scheduler.hotSwapChild('host', fork('host', 'let rabbit\nlet fox'))
    const rabbit = host.children.get('rabbit'), fox = host.children.get('fox')
    let now = 0
    const source = `def hunt prey predator do
  as predator do
    fw 1
  end
end
let hunting = hunt rabbit fox`
    const attach = name => {
        const input = fork(name, source)
        input.env.scope = { rabbit, fox }
        const frame = scheduler.hotSwapChild(name, input)
        for (let i = 0; i < 10; i++) {
            scheduler.tick(now += 1000)
            scheduler.readouts.drain()
            for (const f of scheduler.registry.values()) f.channel.drain()
        }
        return frame.children.get('hunting')
    }
    const first = attach('first'), firstAnswer = position(fox)
    scheduler.removeChild('first')
    assert.deepEqual(position(fox), firstAnswer, 'withdrawal does not rewind accepted history')
    const verdict = scheduler.requestMotion(fox,
        { ...frameWorldTransform(fox), position: [100, 0, 0] }, scheduler.motionRevision, 'world')
    assert.equal(verdict.kind, 'accept')
    const second = attach('second')
    assert.equal(first.seed.question[0], rabbit)
    assert.equal(first.seed.question[1], fox)
    assert.equal(second.seed.question[0], rabbit)
    assert.equal(second.seed.question[1], fox)
    assert.deepEqual(firstAnswer, [1, 0, 0])
    assert.deepEqual(position(fox), [101, 0, 0])
    t.diagnostic(JSON.stringify({ firstAnswer, secondAnswer: position(fox), sameParticipants: true, sameRecipe: true }))
    assert.deepEqual(errors(scheduler), [])
})

// A reconstruction restarts at local zero WITHOUT catching up expired movement slots:
// the rebuilt run's waits are anchored at the revision cut, so its pace matches an
// ordinary call's. Headless fixed 16ms tick; not browser timing.
// (id:declared-behaviour-revision-clock)
test('a reconstructed behaviour keeps pace with its participants (no catch-up)', () => {
    const counts = (named, ticks = 125, advance = 16) => {
        const scheduler = buildWorld({ breathEvery: 0, admit: ({ requested }) => ({ accepted: true, transform: requested }) })
        const seen = {}
        const host = scheduler.hotSwapChild('host', fork('host', `def hunt prey predator do
  as predator do
    loop 720 do
      faceto prey
      fw 3
      wait 1/72
    end
  end
end
as rabbit do
  loop 720 do
    fw 5
    rt 1
    label rabbit 0.1
    wait 1/72
  end
end
let fox
${named ? 'let hunting = ' : ''}hunt rabbit fox`))
        for (let i = 1; i <= ticks; i++) {
            scheduler.tick(i * advance)
            scheduler.readouts.drain()
            for (const frame of scheduler.registry.values()) {
                for (const event of frame.channel.drain()) if (event.type === 'path') seen[frame.name] = (seen[frame.name] ?? 0) + 1
            }
            scheduler.readouts.drain()
        }
        return { rabbit: seen.rabbit ?? 0, fox: seen.fox ?? 0, run: host.children.get('hunting')?.runIncarnation ?? 1 }
    }
    const named = counts(true)
    assert.ok(named.run > 1, 'rabbit movement reconstructs the named behaviour')
    assert.ok(named.fox <= named.rabbit + 2, `no catch-up: fox ${named.fox} vs rabbit ${named.rabbit}`)
})

// An installation's receiver is current-world for every installation on the reader's path
// up to the frame that owns its governing question, not only the nearest one. A nested
// installation reading an ancestor's receiver is execution state, not feedback.
// (id:declared-behaviour-revision-contract)
test('an ancestor installation receiver stays current-world for a nested installation', () => {
    const scheduler = buildWorld({ breathEvery: 0, admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild('host', fork('host', `let other
def behave actor other do
  as actor do
    fw 1
    as other do
      label actor.position
    end
    wait 1
  end
end
let fox
let hunting = behave fox other`))
    for (let i = 1; i <= 80; i++) {
        scheduler.tick(i * 16)
        scheduler.readouts.drain()
        for (const frame of scheduler.registry.values()) frame.channel.drain()
        scheduler.readouts.drain()
    }
    assert.equal(host.children.get('hunting').runIncarnation, 1, 'no ancestor-receiver feedback')
    assert.deepEqual(position(host.children.get('fox')), [1, 0, 0])
    assert.deepEqual(errors(scheduler), [])
})

// Local zero is the run's own elapsed time, not a global scheduling priority: a continuously
// revised declaration must not starve an already-scheduled participant.
// (id:declared-behaviour-revision-clock)
test('continuous hand revisions do not starve a separate participant', () => {
    const scheduler = buildWorld({ breathEvery: 0, admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild('host', fork('host', `def hunt prey predator do
  as predator do
    loop 720 do
      faceto prey
      fw 3
      wait 1/72
    end
  end
end
as rabbit do
  loop 720 do
    fw 5
    rt 1
    label rabbit 0.1
    wait 1/72
  end
end
let fox
let hunting = hunt rabbit fox`))
    const counts = {}
    const drain = () => {
        scheduler.readouts.drain()
        for (const frame of scheduler.registry.values()) {
            for (const event of frame.channel.drain()) if (event.type === 'path') counts[frame.name] = (counts[frame.name] ?? 0) + 1
        }
        scheduler.readouts.drain()
    }
    let now = 0
    for (let i = 0; i < 40; i++) { now += 16.7; scheduler.tick(now); drain() }
    const before = counts.rabbit ?? 0
    const fox = host.children.get('fox')
    for (let i = 0; i < 100; i++) {
        scheduler.requestMotion(fox, { ...frameWorldTransform(fox), position: [i * 0.1, 0, 0] }, scheduler.motionRevision, 'world')
        now += 16.7; scheduler.tick(now); drain()
    }
    const during = (counts.rabbit ?? 0) - before
    assert.ok(during >= 8, `rabbit keeps moving while the hand revises: ${during}`)
    assert.ok(host.children.get('hunting').runIncarnation > 1, 'the drag does revise the declaration')
    assert.deepEqual(errors(scheduler), [])
})

// An installation's accepted effect belongs to every declaration whose realization contains
// it. A descendant's own write must not read as an external change to the governing
// declaration. (id:declared-behaviour-revision-contract)
test('a nested installation effect does not revise its governing declaration', () => {
    const run = (body) => {
        const scheduler = buildWorld({ breathEvery: 0, admit: ({ requested }) => ({ accepted: true, transform: requested }) })
        const host = scheduler.hotSwapChild('host', fork('host', `def behave target do
  as target do
${body}
    wait 1
  end
end
let fox
let hunting = behave fox`))
        let now = 0
        for (let i = 0; i < 20; i++) {
            now += 100
            scheduler.tick(now)
            scheduler.readouts.drain()
            for (const frame of scheduler.registry.values()) frame.channel.drain()
            scheduler.readouts.drain()
        }
        return { scheduler, host }
    }
    const nested = run(`    fw 1
    as target do
      fw 1
    end`)
    const flat = run(`    fw 1
    fw 1`)
    assert.equal(nested.host.children.get('hunting').runIncarnation, 1, 'no descendant-effect revision')
    assert.deepEqual(position(nested.host.children.get('fox')), position(flat.host.children.get('fox')), 'nested and flat agree')
    assert.equal(nested.scheduler.done, true)
    assert.deepEqual(errors(nested.scheduler), [])
})

// A parent's last wait is not the revision cut. A fresh run joins at the actual revision
// time, so a completed parent's stale resumeAt cannot fast-forward the new run.
// (id:declared-behaviour-revision-clock)
test('a revision uses the actual cut, not the parent\u2019s retained wait', () => {
    const scheduler = buildWorld({ breathEvery: 0, admit: ({ requested }) => ({ accepted: true, transform: requested }) })
    const host = scheduler.hotSwapChild('host', fork('host', `def behave target do
  as target do
    loop 100 do
      fw 1
      wait 1
    end
  end
  wait 1
end
let fox
let hunting = behave fox`))
    let now = 0
    const drain = () => { scheduler.readouts.drain(); for (const f of scheduler.registry.values()) f.channel.drain(); scheduler.readouts.drain() }
    for (let i = 0; i < 10; i++) { now += 500; scheduler.tick(now); drain() }
    const hunting = host.children.get('hunting'), fox = host.children.get('fox')
    assert.equal(hunting.resumeAt, 1000, 'the parent retains its completed wait')
    const cut = 5000
    scheduler.requestMotion(fox, { ...frameWorldTransform(fox), position: [100, 0, 0] }, scheduler.motionRevision, 'world')
    drain()
    for (let i = 0; i < 5; i++) { now += 100; scheduler.tick(now); drain() }
    assert.ok(hunting.runIncarnation > 1, 'the external move revises')
    assert.equal(scheduler.installationsOf(hunting)[0].frame.resumeAt, cut + 1000,
        'the fresh wait is one duration after the actual cut, not after the stale parent wait')
    assert.deepEqual(errors(scheduler), [])
})
