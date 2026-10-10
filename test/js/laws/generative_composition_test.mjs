// Same slot revises; distinct names/scopes construct distinct things.
// Predictions and iterations: id:laws-generative-experiments.
import { test } from "node:test"
import assert from "node:assert/strict"
import { buildWorld, fork, drive, ends, nz } from "./harness.mjs"
import { collectErrors, parseProgram } from "../../../assets/js/turtling/parse.js"
import { frameWorldTransform } from "../../../assets/js/turtling/scheduler.js"
import { createReadouts } from "../../../assets/js/turtling/laws/readout.js"

function run(source, opts = {}) {
    assert.deepEqual(collectErrors(parseProgram(source)), [], "healthy construction parses")
    const scheduler = buildWorld(opts)
    const host = scheduler.hotSwapChild("host", fork("host", source))
    const trace = drive(scheduler, { maxTicks: 60 })
    return { scheduler, host, trace }
}
const clean = ({ scheduler }) => {
    assert.deepEqual(scheduler.errors.map(e => e.message), [])
    assert.equal(scheduler.done, true)
}
const position = frame => nz(frameWorldTransform(frame).position)

for (const capacity of [2, 64]) {
    for (const pause of ["", "wait 1/24"]) {
        test(`G1: changed inputs revise one figure (capacity ${capacity}, ${pause || "no wait"})`, () => {
            const result = run(`loop 3 do\n let F = fw count+1\n ${pause}\nend`, { capacity })
            clean(result)
            const F = result.host.children.get("F")
            assert.equal(result.host.children.size, 1)
            assert.equal(F.runIncarnation, 3, "three reached questions, one enduring identity")
            assert.deepEqual(ends(result.trace, "F").at(-1), [3, 0, 0])
            assert.deepEqual(result.scheduler.readouts.list().find(n => n.keyed).question, [3],
                "the reached iteration belongs to the declaration, not the later cursor")
        })
    }
}

test("G1: equal inputs reuse the attached construction", () => {
    const result = run("loop 3 do\n let F = fw 2\n wait 1/24\nend")
    clean(result)
    assert.equal(result.host.children.get("F").runIncarnation, 1)
    assert.deepEqual(ends(result.trace, "F"), [[2, 0, 0]])
})

test("G1: a changed recipe replaces one figure even with equal inputs", () => {
    const result = run(`def first d do\n fw d\nend\ndef second d do\n fw d*2\nend\nlet F = first 2\nlet F = second 2`)
    clean(result)
    assert.equal(result.host.children.size, 1)
    assert.equal(result.host.children.get("F").runIncarnation, 2)
    assert.deepEqual(ends(result.trace, "F").at(-1), [4, 0, 0])
})

test("G1: redefining the same recipe replaces its equal-input answer", () => {
    const result = run(`def line d do\n fw d\nend\nlet F = line 2\ndef line d do\n fw d*2\nend\nlet F = line 2`)
    clean(result)
    assert.equal(result.host.children.get("F").runIncarnation, 2)
    assert.deepEqual(ends(result.trace, "F").at(-1), [4, 0, 0])
})

test("G1: refusal preserves the accepted anchor as well as the pose", () => {
    const control = run("let F = fw 5\nlet F.distance = 5\nfw 10")
    const refused = run("let F = fw 5\nlet F.distance = 5\nfw 10\nlet F")
    const before = control.host.children.get("F")
    const after = refused.host.children.get("F")
    assert.deepEqual(position(after), position(before))
    assert.deepEqual(after.birthPose, before.birthPose)
    assert.ok(refused.scheduler.errors.some(e => /conflicts/.test(e.message)))
})

for (const fails of [false, true]) {
    test(`G1: replaced readout definition cannot settle its old ${fails ? "failure" : "answer"}`, () => {
        const store = createReadouts()
        const seen = []
        store.watch(change => { if (!change.pending) seen.push(change.value) })
        const id = store.register("owner", "slot", {
            capture: () => [1],
            build: () => {
                store.register("owner", "slot", { capture: () => [1], build: () => 2 })
                store.recompute({})
                if (fails) throw new Error("retired failure")
                return 1
            },
        })
        store.recompute({})
        store.drain()
        assert.equal(store.value(id), undefined, "old work has no publication rights")
        assert.equal(store.list()[0].pending, true)
        assert.equal(store.list()[0].failure, null)
        assert.deepEqual(seen, [])
        store.drain()
        assert.equal(store.value(id), 2)
        assert.deepEqual(seen, [2])
    })
}

test("G1: replacing a definition with the same callback still retires the old installation", () => {
    const store = createReadouts()
    let replaced = false
    const capture = () => [1]
    const build = () => {
        if (!replaced) {
            replaced = true
            store.register("owner", "slot", { capture, build })
            store.recompute({})
            return 1
        }
        return 2
    }
    const id = store.register("owner", "slot", { capture, build })
    store.recompute({})
    store.drain()
    assert.equal(store.value(id), undefined)
    store.drain()
    assert.equal(store.value(id), 2)
})

const births = {
    direct: "let A",
    helper: "mark",
    conditional: "when 1 do\n let A\nend",
}
for (const [route, statement] of Object.entries(births)) {
    test(`G2: ${route} repeated birth revisits one caller-owned slot`, () => {
        const result = run(`def mark do\n let A\nend\nloop 3 do\n fw 10\n ${statement}\nend`)
        clean(result)
        assert.equal(result.host.children.size, 1)
        assert.deepEqual(position(result.host.children.get("A")), [30, 0, 0])
    })
}

for (const [label, source, names] of [
    ["defined word", 'fn name "hello"\nloop 3 do\n fw 10\n let name\nend', ["hello"]],
    ["count", 'loop 3 do\n fw 10\n let count\nend', ["0", "1", "2"]],
    ["interpolation", 'loop 3 do\n fw 10\n let "part[count]"\nend', ["part0", "part1", "part2"]],
    ["helper parameter", 'def mark name do\n let name\nend\nloop 3 do\n fw 10\n mark "hello"\nend', ["hello"]],
]) {
    test(`G2: ${label} births use resolved names, not source spellings`, () => {
        const result = run(source)
        clean(result)
        assert.equal(result.host.unresolved, null)
        assert.deepEqual([...result.host.children.keys()], names)
        assert.equal(new Set([...result.host.children.values()].map(f => f.id)).size, names.length)
        for (const [i, name] of names.entries()) {
            const child = result.host.children.get(name)
            assert.deepEqual(position(child), [names.length === 1 ? 30 : (i + 1) * 10, 0, 0])
            assert.equal(result.host.reached.has(name), true)
        }
    })
}

test("G2: let and as resolve the same name and join the same place", () => {
    const result = run('fn name "hello"\nfw 10\nlet name\nas name do\n fw 2\nend')
    clean(result)
    assert.equal(result.host.unresolved, null)
    assert.deepEqual([...result.host.children.keys()], ["hello"])
    assert.deepEqual(position(result.host.children.get("hello")), [12, 0, 0])
})

const laws = {
    direct: "let A.distance = count+1",
    helper: "reach count+1",
    conditional: "when 1 do\n let A.distance = count+1\nend",
    parameter: 'on "A" count+1',
    parameter_conditional: 'when 1 do\n on "A" count+1\nend',
    forwarded: 'forward "A" count+1',
}
for (const [route, statement] of Object.entries(laws)) {
    test(`G2: ${route} repeated law replaces one addressed relationship`, () => {
        const result = run(`let A\ndef reach d do\n let A.distance = d\nend\ndef on subject d do\n let subject.distance = d\nend\ndef forward subject d do\n on subject d\nend\nloop 3 do\n ${statement}\nend`)
        clean(result)
        const active = result.scheduler.laws.active()
        assert.equal(active.length, 1)
        assert.equal(active[0].predicate, 3)
        assert.deepEqual(position(result.host.children.get("A")), [3, 0, 0])
    })
}

test("G2: repeated point definitions revise the same pin", () => {
    const result = run("loop 3 do\n let P = (count+1,0,0)\nend")
    clean(result)
    assert.equal(result.host.children.size, 1)
    assert.deepEqual(position(result.host.children.get("P")), [3, 0, 0])
    assert.equal(result.scheduler.laws.count(), 1)
})

test("G2: a later false branch does not withdraw a reached law", () => {
    const result = run("let A\nlet A.distance = 5\nwhen 0 do\n let A.distance = 7\nend")
    clean(result)
    assert.equal(result.scheduler.laws.active()[0].predicate, 5)
})

test("G3: distinct owned figures have independent local parts and laws", () => {
    const result = run("def unit d do\n let A\n let A.distance = d\nend\nlet left = unit 5\nlet right = unit 7")
    clean(result)
    const left = result.host.children.get("left")
    const right = result.host.children.get("right")
    assert.notEqual(left.children.get("A").id, right.children.get("A").id)
    assert.deepEqual(position(left.children.get("A")), [5, 0, 0])
    assert.deepEqual(position(right.children.get("A")), [7, 0, 0])
    assert.equal(result.scheduler.laws.count(), 2)
    result.scheduler.removeChild("host")
    assert.equal(result.scheduler.laws.count(), 0)
    assert.equal(result.scheduler.readouts.size, 0)
})

test("G3: explicit indexed scopes construct distinct things without indexed let syntax", () => {
    const result = run('loop 3 do\n as "part[count]" do\n let A\n let A.distance = count+1\n end\nend')
    clean(result)
    assert.deepEqual([...result.host.children.keys()], ["part0", "part1", "part2"])
    const ids = []
    for (let i = 0; i < 3; i++) {
        const A = result.host.children.get(`part${i}`).children.get("A")
        ids.push(A.id)
        assert.deepEqual(position(A), [i+1, 0, 0])
    }
    assert.equal(new Set(ids).size, 3)
    assert.equal(result.scheduler.laws.count(), 3)
})

test("G1: changing a captured call binding changes the bound definition", () => {
    const result = run('def held unused do\n fw length\nend\ndef make length do\n let F = held 0\nend\nmake 1\nmake 2')
    clean(result)
    assert.equal(result.host.children.get("F").runIncarnation, 2)
    assert.deepEqual(ends(result.trace, "F").at(-1), [2, 0, 0])
})

test("G1: a changed nested helper invalidates the attached code organ", () => {
    const result = run('def twig d do\n fw d\nend\ndef branch d do\n twig d\nend\nlet F = branch 2\ndef twig d do\n fw d*2\nend\nlet F = branch 2')
    clean(result)
    assert.equal(result.host.children.get("F").runIncarnation, 2)
    assert.deepEqual(ends(result.trace, "F").at(-1), [4, 0, 0])
})

test("G1: inherited display style is part of an attached construction", () => {
    const result = run('let F = fw 2\nhide\nlet F = fw 2')
    clean(result)
    const F = result.host.children.get("F")
    assert.equal(F.runIncarnation, 2)
    assert.equal(F.actorState.style.showTurtle, false)
    assert.deepEqual(ends(result.trace, "F").at(-1), [2, 0, 0])
})

test("G1: capacity one preserves the final geometry even when it cannot hold the path", () => {
    const result = run('loop 3 do\n let F = fw count+1\nend', { capacity: 1 })
    clean(result)
    assert.deepEqual(nz(result.host.children.get("F").transform.deref().position), [3, 0, 0])
    assert.deepEqual(result.scheduler.readouts.list().find(n => n.keyed).question, [3])
})

test("G2: nested iteration restores the outer count and captures each declaration", () => {
    const result = run('loop 2 do\n loop 2 do\n let inner = fw count+10\n end\n let outer = fw count+20\nend')
    clean(result)
    assert.deepEqual(ends(result.trace, "inner").at(-1), [11, 0, 0])
    assert.deepEqual(ends(result.trace, "outer").at(-1), [21, 0, 0])
})

test("G2: forwarding a subject through helpers preserves its selected identity", () => {
    const result = run('let A\nlet B\ndef reach subject radius do\n let subject.distance = radius\nend\ndef forward subject radius do\n reach subject radius\nend\nforward "A" 5\nforward "B" 7')
    clean(result)
    const A = result.host.children.get("A"), B = result.host.children.get("B")
    assert.deepEqual(position(A), [5, 0, 0])
    assert.deepEqual(position(B), [7, 0, 0])
    assert.equal(result.scheduler.laws.count(), 2)
    assert.ok(result.scheduler.laws.active().some(law => law.endpoints.includes(A.id)))
    assert.ok(result.scheduler.laws.active().some(law => law.endpoints.includes(B.id)))
})

test("G2: a numeric subject is refused rather than substituted or coerced", () => {
    const result = run('let A\ndef reach subject do\n let subject.distance = 5\nend\nreach 0')
    assert.ok(result.scheduler.errors.some(e => /law subject must name a thing/.test(e.message)))
    assert.equal(result.scheduler.laws.count(), 0)
    assert.deepEqual(position(result.host.children.get("A")), [0, 0, 0])
})

test("G3: revising one owned answer leaves its sibling and sibling's identities intact", () => {
    const result = run('def unit d do\n let A\n let A.distance = d\nend\nlet left = unit 5\nlet right = unit 7\nlet left = unit 6')
    clean(result)
    const left = result.host.children.get("left"), right = result.host.children.get("right")
    assert.equal(left.runIncarnation, 2)
    assert.equal(right.runIncarnation, 1)
    assert.deepEqual(position(left.children.get("A")), [6, 0, 0])
    assert.deepEqual(position(right.children.get("A")), [7, 0, 0])
    assert.equal(result.scheduler.laws.count(), 2)
    for (const law of result.scheduler.laws.active()) {
        for (const id of law.endpoints) assert.ok(result.scheduler.registry.has(id), "no retired endpoint")
    }
})

test("G3: an omitted branch retires its old owned parts and their obligations", () => {
    const result = run('def maybe d do\n when d > 0 do\n let A\n let A.distance = d\n end\nend\nlet F = maybe 5\nlet F = maybe 0')
    clean(result)
    const F = result.host.children.get("F")
    assert.equal(F.runIncarnation, 2)
    assert.equal(F.children.size, 0)
    assert.equal(result.scheduler.laws.count(), 0)
    assert.equal(result.scheduler.registry.size, 3, "root, host and F only")
})

test("G2: a quoted hyphenated subject is selected without parsing its name as arithmetic", () => {
    const result = run('let A-1\ndef reach subject do\n let subject.distance = 5\nend\nreach "A-1"')
    clean(result)
    assert.deepEqual(position(result.host.children.get("A-1")), [5, 0, 0])
    assert.ok(result.scheduler.laws.active()[0].endpoints.includes(result.host.children.get("A-1").id))
})

for (const offset of [0, 10]) {
    test(`G1: equal-input reuse preserves its observable answer at a ${offset}-unit placement`, () => {
        const result = run(`let F = fw 2\nlabel F.x\nfw ${offset}\nlet F = fw 2\nlabel F.x`)
        clean(result)
        const F = result.host.children.get("F")
        assert.equal(F.runIncarnation, 1)
        assert.deepEqual(position(F), [offset+2, 0, 0])
        assert.deepEqual(result.trace.get("host").filter(e => e.type === "label").map(e => e.text),
            ["2", String(offset+2)])
        assert.deepEqual(nz(F.origin.position), [offset, 0, 0], "the entire figure is placed, not just its head")
        assert.deepEqual(nz(F.transform.deref().position), [2, 0, 0])
    })
}

test("G1: refused construction placement preserves the entire accepted answer", () => {
    const control = run('let F = fw 2\nlet F.position = (2,0,0)\nfw 10')
    const refused = run('let F = fw 2\nlet F.position = (2,0,0)\nfw 10\nlet F = fw 2')
    const before = control.host.children.get("F"), after = refused.host.children.get("F")
    assert.deepEqual(position(after), position(before))
    assert.deepEqual(after.origin, before.origin)
    assert.deepEqual(after.transform.deref(), before.transform.deref())
    assert.deepEqual(after.birthPose, before.birthPose)
    assert.equal(after.runIncarnation, 1)
    assert.equal(refused.scheduler.laws.count(), 1)
    assert.ok(refused.scheduler.errors.some(e => /conflicts/.test(e.message)))
})

test("G3: reused placement carries local parts and laws without reconstructing them", () => {
    const result = run('def unit d do\n let A\n let A.distance = d\nend\nlet F = unit 5\nfw 10\nlet F = unit 5')
    clean(result)
    const F = result.host.children.get("F")
    const A = F.children.get("A")
    assert.equal(F.runIncarnation, 1)
    assert.deepEqual(position(F), [10, 0, 0])
    assert.deepEqual(position(A), [15, 0, 0])
    assert.equal(result.scheduler.laws.count(), 1)
    assert.deepEqual(result.scheduler.laws.active()[0].endpoints, [A.id, F.id])
})

for (const statement of ['let A.distance = 5', 'reach "A" 5', 'as nested do\n reach "A" 5\nend']) {
    test(`G3: a closed construction cannot install an outside law through ${statement.split("\n")[0]}`, () => {
        const result = run(`let A\ndef reach subject d do\n let subject.distance = d\nend\ndef held do\n ${statement}\nend\nlet F = held`)
        assert.ok(result.scheduler.errors.some(e => /outside.*region|outside law target/.test(e.message)))
        assert.deepEqual(position(result.host.children.get("A")), [0, 0, 0])
        assert.equal(result.scheduler.laws.count(), 0)
    })
}

for (const next of [1, 2]) {
    test(`G1: an owned figure waiting at an instant boundary can be ${next === 1 ? "reused" : "superseded"}`, () => {
        const result = run(`def slow d do\n fw d\n wait 1/24\n fw d\nend\nlet F = slow 1\nlet F = slow ${next}`)
        clean(result)
        const F = result.host.children.get("F")
        assert.equal(F.runIncarnation, next)
        assert.deepEqual(position(F), [2*next, 0, 0])
        assert.deepEqual(result.scheduler.readouts.list().find(n => n.keyed).question, [next])
    })
}

test("G1: a loop supersedes the same private recipe while its body waits", () => {
    const result = run('def slow d do\n fw d\n wait 1/24\n fw d\nend\nloop 3 do\n let F = slow count+1\nend')
    clean(result)
    assert.equal(result.host.children.get("F").runIncarnation, 3)
    assert.deepEqual(position(result.host.children.get("F")), [6, 0, 0])
    assert.deepEqual(result.scheduler.readouts.list().find(n => n.keyed).question, [3])
})

test("G1: relocating a reused waiting answer preserves its remaining local walk", () => {
    const result = run('def slow d do\n fw d\n wait 1/24\n fw d\nend\nlet F = slow 1\nfw 10\nlet F = slow 1')
    clean(result)
    const F = result.host.children.get("F")
    assert.equal(F.runIncarnation, 1)
    assert.deepEqual(nz(F.origin.position), [10, 0, 0])
    assert.deepEqual(nz(F.transform.deref().position), [2, 0, 0])
    assert.deepEqual(position(F), [12, 0, 0])
})

test("G1: placing an owned value does not authorize running open-process correction", () => {
    const result = run('as runner do\n fw 1\n wait 1/24\n fw 1\nend\nlet runner.position = (10,0,0)')
    assert.ok(result.scheduler.errors.some(e => /running member; settled configurations only/.test(e.message)))
    assert.deepEqual(position(result.host.children.get("runner")), [2, 0, 0])
    assert.equal(result.scheduler.laws.count(), 0)
})

test("G1: a non-owner cannot place another scope's waiting private value", () => {
    const result = run('def slow d do\n fw d\n wait 1/24\n fw d\nend\ndef place subject do\n let subject.position = (10,0,0)\nend\nlet F = slow 1\nas intruder do\n place "F"\nend')
    assert.ok(result.scheduler.errors.some(e => /running member; settled configurations only/.test(e.message)))
    assert.deepEqual(position(result.host.children.get("F")), [2, 0, 0])
    assert.equal(result.scheduler.laws.count(), 0)
})
