// Spike: is a letter truth? — the fourth citizen of the D027 taxonomy.
// Run: node --test test/js/runtime/mailbox_spike_test.mjs
//
// D027 R2 ruled that every bound declares itself `rate` or `truth`, and audited
// five. `maxMailbox` (8192, drop-oldest, scheduler.js) was left unruled because
// a delivered message is neither Output, Sync, nor Directive — it is data a
// program READS. This file asks the world which class it belongs to.
//
// Predictions before measurement:
//   M1  A shout is BROADCAST to every frame, and `when` removes only matching
//       letters — so an ambient with no matching `when` accumulates mail it can
//       never read, without bound, until the cap.
//   M2  Drop-oldest then discards the oldest UNREAD letter — which for a real
//       listener is precisely the one it was about to read. Garbage never
//       leaves; truth does.
//   M3  Therefore the figure changes: a listener under flood draws a different
//       picture than the same listener whose mail survived. That makes the
//       mailbox a TRUTH bound, and silent drop-oldest a bug by construction.

import { test, describe } from "node:test"
import assert from "node:assert/strict"

import { createScheduler, metaRoot } from "../../../assets/js/turtling/scheduler.js"
import { parseProgram } from "../../../assets/js/turtling/parse.js"
import { Parser } from "../../../assets/js/turtling/mafs/parse.js"
import { Evaluator } from "../../../assets/js/turtling/mafs/evaluate.js"
import { drainNamespace } from "../../../assets/js/turtling/executor.js"

const realDeps = () => ({ mathParser: new Parser(), mathEvaluator: new Evaluator() })

function world(src, { maxMailbox } = {}) {
    const scheduler = createScheduler(metaRoot(), {
        rootName: "world",
        rootHears: [],
        createDeps: realDeps,
        execOpts: { color: "#e77808" },
        onShout: () => {},
    })
    const child = scheduler.hotSwapChild("buf", {
        name: "main", code: { ast: parseProgram(src), functions: null },
        style: { color: "#e77808" }, env: null,
    })
    if (maxMailbox !== undefined) {
        for (const f of scheduler.registry.values()) f.maxMailbox = maxMailbox
    }
    return { scheduler, child }
}

function run(scheduler, { frames = 4000, maxMailbox } = {}) {
    const paths = new Map()
    let now = 0
    for (let i = 0; i < frames && !scheduler.done; i++) {
        // New frames are born mid-run; hold the cap on them too.
        if (maxMailbox !== undefined) {
            for (const f of scheduler.registry.values()) f.maxMailbox = maxMailbox
        }
        scheduler.tick(now)
        for (const a of scheduler.registry.values()) {
            for (const ev of a.channel.drain()) {
                if (ev.type !== "path") continue
                const k = a.name || String(a.id)
                paths.set(k, (paths.get(k) || 0) + 1)
            }
        }
        now += 16
    }
    return paths
}

const mailboxDepths = (scheduler) => {
    const d = {}
    for (const f of scheduler.registry.values()) d[f.name || f.id] = f.mailbox.length
    return d
}

describe("SPIKE: what is a letter?", () => {
    // A shouter and a deaf sibling. The sibling has no `when` at all, so every
    // letter it receives is unreadable by construction.
    const deafWorld = [
        "as crier do",
        "  loop 300 do",
        "    shout 'tick'",
        "    wait 0.01",
        "  end",
        "end",
        "as deaf do",
        "  loop 300 do",
        "    fw 1",
        "    wait 0.01",
        "  end",
        "end",
    ].join("\n")

    test("M1 — a deaf ambient is no longer buried in mail it cannot read", () => {
        // MEASURED BEFORE THE GATE: { origin: 299, main: 299, crier: 300, deaf: 300 }
        // — four mailboxes filling with letters no `when` could ever match, while
        // the cap evicted a real listener's oldest letter to make room.
        const { scheduler } = world(deafWorld)
        run(scheduler)
        const depths = mailboxDepths(scheduler)
        console.log("      [mailbox depths, deaf world]", JSON.stringify(depths))
        for (const [name, depth] of Object.entries(depths)) {
            assert.equal(depth, 0, `${name} holds ${depth} letters it never asked to hear`)
        }
    })

    // Letters that DIFFER. The first fixture used eight identical `go`s, and the
    // ear could not tell which one it got — so dropping the oldest of a heap of
    // interchangeable mail cost nothing and the figure never moved. Prediction M3
    // died there. Give each letter a distinct payload and ask again: now the ear
    // walks the distance it was TOLD to walk, and a lost letter is a lost stroke.
    const namedLetters = [
        "as crier do",
        // Wait first: deferred shouts are delivered to a sibling AT SPAWN, before
        // its own first line runs, so a cap the ear sets would arrive too late to
        // matter. Let the ear wake and set its cap, then start calling.
        "  wait 0.03",
        "  shout 'go' 10",
        "  wait 0.01",
        "  shout 'go' 20",
        "  wait 0.01",
        "  shout 'go' 30",
        "  wait 0.01",
        "  shout 'go' 40",
        "  wait 0.01",
        "  shout 'go' 50",
        "  wait 0.01",
        "  shout 'go' 60",
        "  wait 0.01",
        "  shout 'go' 70",
        "  wait 0.01",
        "  shout 'go' 80",
        "end",
        "as ear do",
        "  limitMessage CAP",
        "  loop 8 do",
        "    wait 0.05",
        "    when 'go' v do",
        "      fw v",
        "    end",
        "  end",
        "end",
    ].join("\n")

    // Total distance the ear walks — the figure, in one number.
    function earWalk(maxMailbox) {
        // The cap must be set by the PROGRAM: the ear frame is born inside the
        // first tick, so a harness that stamps frames beforehand misses it —
        // and silently measures the default 8192 instead. (First run of this
        // assay did exactly that and reported "no loss".)
        const { scheduler } = world(namedLetters.replace("CAP", String(maxMailbox)))
        let walked = 0
        let now = 0
        for (let i = 0; i < 2000 && !scheduler.done; i++) {
            scheduler.tick(now)
            for (const a of scheduler.registry.values()) {
                for (const ev of a.channel.drain()) {
                    if (ev.type !== "path" || a.name !== "ear") continue
                    const p0 = ev.points[0], p1 = ev.points[ev.points.length - 1]
                    walked += Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
                }
            }
            now += 16
        }
        return Math.round(walked)
    }

    test("M3 — with letters that differ, the cap moves the FIGURE", () => {
        // THE RULING MEASUREMENT. Under drop-oldest: roomy 360, tight 270 — the
        // ear silently lost letters it would have read, so a letter is TRUTH and
        // the cap was a truth bound dropping in silence. Under the wound it is
        // louder still (tight ≈ 10: the ear stops the moment it is overwhelmed),
        // which is the point — the child is told, instead of quietly drawing a
        // different picture. (id:mailbox-truth)
        const roomy = earWalk(8192)
        const tight = earWalk(4)
        console.log(`      [ear walked] roomy: ${roomy}  tight(cap 4): ${tight}`)
        assert.notEqual(roomy, tight,
            "if these agree, the cap never costs the ear a letter it would have read")
        assert.ok(roomy > tight, "the roomy ear hears more and walks further")
    })

    test("M4 — a `when` hidden inside a def still hears", () => {
        // The gate is only safe if the listen-set is a SUPERSET. This exact case
        // shipped broken for one commit: `functions` is a plain object, not a Map,
        // so reading it as a Map found nothing, the ear's listen-set came back
        // empty, and it heard nothing and drew nothing.
        const src = [
            "def listen do",
            "  when 'go' v do",
            "    fw v",
            "  end",
            "end",
            "as crier do",
            "  wait 0.03",
            "  shout 'go' 40",
            "end",
            "as ear do",
            "  loop 6 do",
            "    listen",
            "    wait 0.02",
            "  end",
            "end",
        ].join("\n")

        const ns = drainNamespace(parseProgram(src), realDeps())
        const scheduler = createScheduler(metaRoot(), {
            rootName: "world", createDeps: realDeps,
            execOpts: { color: "#e77808" }, onShout: () => {},
        })
        scheduler.hotSwapChild("buf", {
            name: "main", code: { ast: parseProgram(src), functions: ns.functions },
            style: { color: "#e77808" }, env: null,
        })

        let walked = 0
        let now = 0
        for (let i = 0; i < 500 && !scheduler.done; i++) {
            scheduler.tick(now)
            for (const a of scheduler.registry.values()) {
                for (const ev of a.channel.drain()) {
                    if (ev.type !== "path" || a.name !== "ear") continue
                    const p0 = ev.points[0], p1 = ev.points[ev.points.length - 1]
                    walked += Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
                }
            }
            now += 16
        }
        const ear = [...scheduler.registry.values()].find((f) => f.name === "ear")
        assert.deepEqual(ear.listensFor, ["go"], "a def's `when` belongs to the listen-set")
        assert.equal(Math.round(walked), 40, "and the ear walks what it was told")
    })

    test("M5 — a listener that cannot keep up is WOUNDED, never silently trimmed", () => {
        // The sender cannot be blocked (a listener that never reaches its `when`
        // would stall the world through the instant law), so the honest move on a
        // full box is to say so. Loud, located, per D020.
        const src = [
            "as crier do",
            "  wait 0.02",
            "  loop 40 do",
            "    shout 'go' 1",
            "  end",
            "end",
            "as ear do",
            "  limitMessage 4",
            "  loop 40 do",
            "    wait 0.05",
            "    when 'go' do",
            "      fw 1",
            "    end",
            "  end",
            "end",
        ].join("\n")
        const { scheduler } = world(src)
        run(scheduler, { frames: 400 })
        const ear = [...scheduler.registry.values()].find((f) => f.name === "ear")
        assert.equal(ear.error?.kind, "ink", "a full mailbox is a wound, not a silent trim")
        assert.match(ear.error.message, /hearing more than it can hold/)
        assert.ok(ear.mailbox.length <= 4, "and the box never grows past its limit")
    })
})
