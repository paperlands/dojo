// Probe-only roles: a data consumer resolves writer -> receiver and declaration source
// by IDs, not by address/isPlace heuristics or runtime handles.
// (id:codex-play-eyes, id:being-facets-p4-sequence, id:laws-free-relations-installed-receiver)
//
// Run: node --test test/js/laws/probe_roles_test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildWorld, fork, drive } from './harness.mjs'
import { attachProbe } from '../../../assets/js/turtling/probe.js'

const SRC = `def march a b stride do
  as a do
    wait 1
    jmp stride
  end
end
let A0
jmp 5
let A1
let distance(A0,A1)=5
jmp 30
let B0
jmp 5
let B1
let distance(B0,B1)=5
wait 1
let first = march A0 A1 2
let second = march B0 B1 3
`

function seat() {
    const scheduler = buildWorld({})
    const host = scheduler.hotSwapChild('host', fork('host', SRC))
    drive(scheduler, { maxTicks: 20 })
    const previous = globalThis.window
    globalThis.window = {}
    attachProbe({ scheduler, _stateOf: () => null }, { orderOf: () => null })
    const read = () => globalThis.window.__probe.read()
    const restore = () => {
        if (previous === undefined) delete globalThis.window
        else globalThis.window = previous
    }
    return { scheduler, host, read, restore }
}
const byId = (rows, id) => rows.find((row) => row.id === id)
const installs = (scheduler) => [...scheduler.registry.values()].filter((f) => f.installation === true)
const isId = (x) => typeof x === 'number' && Number.isFinite(x)

// Pure data decoder: ids only, no names, no runtime handles.
const decode = (rows) => rows.filter((row) => row.installation === true).map((writer) => {
    const receiver = rows.find((row) => row.id === writer.receiverId)
    const source = rows.find((row) => row.id === writer.sourceId)
    return { writer: writer.id, writerName: writer.name,
        receiver: writer.receiverId, receiverName: receiver ? receiver.name : null,
        receiverResolved: !!receiver,
        source: writer.sourceId, sourceName: source ? source.name : null,
        sourceResolved: !!source }
}).sort((a, b) => a.writer - b.writer)

test('probe-only rows resolve duplicate-named installations to receiver and source ids', () => {
    const ctx = seat()
    try {
        const rows = ctx.read().ambients
        const expected = installs(ctx.scheduler).map((f) => ({
            writer: f.id, receiver: f.receiver.id, source: f.installationRecord.source.id,
            writerName: f.name, receiverName: f.receiver.name,
            sourceName: f.installationRecord.source.name,
        }))
        assert.equal(expected.length, 2)
        for (const want of expected) {
            const writer = byId(rows, want.writer)
            assert.ok(writer, `writer ${want.writer} is a row`)
            assert.equal(writer.installation, true)
            assert.equal(writer.name, want.writerName)
            assert.equal(writer.receiverId, want.receiver)
            assert.equal(writer.sourceId, want.source)
            assert.ok(isId(writer.receiverId) && isId(writer.sourceId))
            const receiver = byId(rows, writer.receiverId)
            const source = byId(rows, writer.sourceId)
            assert.ok(receiver, 'the receiver id names a row in the SAME read')
            assert.ok(source, 'the source id names a row in the SAME read')
            assert.equal(receiver.installation, false)
            assert.equal(receiver.name, want.receiverName)
            assert.equal(source.name, want.sourceName)
            assert.notEqual(receiver.id, writer.id)
            assert.equal(receiver.name, writer.name, 'duplicate names are present by design')
        }
        for (const row of rows) {
            if (row.installation === true) continue
            assert.equal(row.receiverId, null)
            assert.equal(row.sourceId, null)
        }

        // A consumer that sees ONLY JSON: discover writers, join receiver/source by id.
        const decoded = decode(JSON.parse(JSON.stringify(ctx.read().ambients)))
        const oracle = installs(ctx.scheduler).map((f) => ({ writer: f.id, writerName: f.name,
            receiver: f.receiver.id, receiverName: f.receiver.name, receiverResolved: true,
            source: f.installationRecord.source.id, sourceName: f.installationRecord.source.name,
            sourceResolved: true,
        })).sort((a, b) => a.writer - b.writer)
        assert.deepEqual(decoded, oracle, 'decoder and runtime oracle agree without runtime ids')
    } finally { ctx.restore() }
})

test('decoder identity semantics: a missing receiver row is missing, never a namesake', () => {
    // Data-only. This is decoder/identity semantics, not runtime retirement.
    const ctx = seat()
    try {
        const rows = JSON.parse(JSON.stringify(ctx.read().ambients))
        const writer = rows.find((row) => row.installation === true)
        const receiver = rows.find((row) => row.id === writer.receiverId)
        const withoutReceiver = rows.filter((row) => row.id !== writer.receiverId)
        withoutReceiver.push({ ...receiver, id: 999999, name: receiver.name,
            installation: false, receiverId: null, sourceId: null })
        const decoded = decode(withoutReceiver).find((row) => row.writer === writer.id)
        assert.equal(decoded.receiver, writer.receiverId, 'the retained id is still reported')
        assert.equal(decoded.receiverName, null, 'a namesake row does not satisfy the id')
        assert.equal(decoded.receiverResolved, false)
    } finally { ctx.restore() }
})

test('a supported withdrawal removes the writer row, keeps beings and the other writer', () => {
    const ctx = seat()
    try {
        const first = ctx.host.children.get('first')
        const second = ctx.host.children.get('second')
        const [record] = ctx.scheduler.installationsOf(first)
        const [other] = ctx.scheduler.installationsOf(second)
        assert.ok(record && other)
        const writerId = record.frame.id, otherId = other.frame.id
        const receiverIds = [record.receiver.id, other.receiver.id]
        assert.equal(ctx.scheduler.retireInstallation(first, record.site), true)
        drive(ctx.scheduler, { maxTicks: 5 })
        const after = ctx.read().ambients
        assert.equal(byId(after, writerId), undefined, 'the retired writer row is gone')
        assert.ok(byId(after, otherId), 'the other writer remains')
        assert.ok(byId(after, otherId).installation === true)
        for (const id of receiverIds) assert.ok(byId(after, id), 'both original beings remain')
    } finally { ctx.restore() }
})

test('read is pure and its role fields are plain JSON', () => {
    const ctx = seat()
    try {
        const runIds = () => [...ctx.scheduler.registry.values()]
            .map((f) => [f.id, f.run ?? null, f.runIncarnation ?? null])
        const before = {
            rev: ctx.scheduler.motionRevision, config: ctx.scheduler.root._configurationRevision,
            attempt: ctx.scheduler.root._lastAttempt, done: ctx.scheduler.done,
            tick: ctx.scheduler.lastTickTime, runs: runIds(),
        }
        const first = ctx.read()
        const second = ctx.read()
        assert.equal(ctx.scheduler.motionRevision, before.rev)
        assert.equal(ctx.scheduler.root._configurationRevision, before.config)
        assert.equal(ctx.scheduler.root._lastAttempt, before.attempt)
        assert.equal(ctx.scheduler.done, before.done)
        assert.equal(ctx.scheduler.lastTickTime, before.tick)
        assert.deepEqual(runIds(), before.runs, 'read changes no frame run or incarnation')
        for (const rows of [first.ambients, second.ambients]) {
            for (const row of rows) {
                assert.ok(row.installation === true || row.installation === false)
                assert.ok(row.receiverId === null || isId(row.receiverId))
                assert.ok(row.sourceId === null || isId(row.sourceId))
                assert.equal(typeof row.installation, 'boolean')
            }
        }
        assert.deepEqual(JSON.parse(JSON.stringify(first.ambients)), first.ambients,
            'role fields survive a plain JSON round trip')
    } finally { ctx.restore() }
})
