import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { at, buildWorld, fork, worldOf } from './harness.mjs'
import { SE3 } from '../../../assets/js/turtling/se3.js'
import { worldTransform } from '../../../assets/js/turtling/scheduler.js'

const source = readFileSync(new URL('../../../scripts/play/rungs/midpoint-parallelogram.plang', import.meta.url), 'utf8')
const sub = (a, b) => a.map((v, i) => v - b[i])
const half = (a) => a.map((v) => v / 2)
const near = (a, b) => assert.ok(Math.hypot(...sub(a, b)) < 1e-7, `${a} ≠ ${b}`)
const edges = ['AB', 'BC', 'CD', 'DA', 'MN', 'NO', 'QO', 'MQ']

function play() {
    const scheduler = buildWorld()
    let now = 0, host
    const ink = new Map()
    function settle() {
        for (let i = 0; i < 64; i++) {
            scheduler.tick(now += 1000)
            for (const frame of scheduler.registry.values()) {
                for (const e of frame.channel.drain()) {
                    if (e.type === 'path') ink.set(frame.name, e.points.map(p => SE3.apply(worldTransform(frame), p)))
                }
            }
            if (scheduler.done && scheduler.isSettledThrough(now)) break
        }
        assert.equal(scheduler.done, true)
        assert.equal(scheduler.isSettledThrough(now), true)
        assert.deepEqual(scheduler.errors, [])
    }
    function seat(program) {
        ink.clear()
        host = scheduler.hotSwapChild('host', fork('host', program))
        settle()
    }
    const point = name => host.children.get(name)
    const position = name => worldOf(point(name))
    function move(name, x, y) {
        assert.equal(scheduler.requestMotion(point(name), at(x, y), scheduler.motionRevision, 'world').kind, 'accept')
        settle()
    }
    const vector = (a, b) => sub(position(b), position(a))
    const checkInk = () => {
        for (const edge of edges) {
            assert.ok(ink.has(edge), edge)
            near(ink.get(edge)[0], position(edge[0]))
            near(ink.get(edge).at(-1), position(edge[1]))
        }
    }
    return { seat, point, position, move, vector, checkInk }
}

test('moving and crossing the corners preserves both opposite vectors and redraws the incident ink', () => {
    const p = play()
    p.seat(source)
    const verify = () => {
        near(p.vector('M', 'N'), half(p.vector('A', 'C')))
        near(p.vector('Q', 'O'), p.vector('M', 'N'))
        near(p.vector('M', 'Q'), half(p.vector('B', 'D')))
        near(p.vector('N', 'O'), p.vector('M', 'Q'))
        p.checkInk()
    }
    verify()
    const untouched = p.point('QO').runIncarnation
    p.move('B', 8, -95)
    assert.equal(p.point('QO').runIncarnation, untouched)
    verify()
    p.move('C', -135, 45)
    verify()
    p.move('D', -8, 95)
    verify()
})

test('the same initial picture can lack the midpoint premise: freeze M, then try the same drag', () => {
    const p = play()
    p.seat(source)
    const points = 'ABCDMNOQ'.split('')
    const initial = Object.fromEntries(points.map(n => [n, p.position(n)]))
    p.seat(source.replace('((A.x+B.x)/2, (A.y+B.y)/2)', '(-85, 7.5)'))
    for (const n of points) near(p.position(n), initial[n])
    near(p.vector('M', 'N'), p.vector('Q', 'O'))
    p.move('B', 8, -95)
    p.checkInk()
    near(p.position('M'), initial.M)
    assert.ok(Math.hypot(...sub(p.vector('M', 'N'), p.vector('Q', 'O'))) > 50)
})
