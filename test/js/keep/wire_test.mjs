// The keep's one socket edge (id:kb-9, id:kc-c-wire).
//
// Invariants under test:
//   - a drop raises no exception anywhere
//   - announce drains local(root) whole, newest first, serially
//   - permanent answers mark shared; silence does not
//   - re-entry mid-drain does not double-ship concurrent drains
//   - reconnected clears the latch so a hung reply cannot block forever
//   - only wire.js in keep/ names pushEvent
//   - no navigator.onLine, no online/offline flag, no retry timer
import { describe, test, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import { createWire, KEEP_EVENT, IMAGE_EVENT } from "../../../assets/js/keep/wire.js"
import { PAGE } from "../../../assets/js/keep/page.js"
import { createJournal } from "../../../assets/js/keep/journal.js"
import { createEngine } from "../../../assets/js/keep/journal.store.js"
import { write, name, read } from "../../../assets/js/keep/entry.js"
import { createMemoryIDB } from "./idb_memory.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const KEEP_DIR = join(__dirname, "../../../assets/js/keep")

const fill = (b) => (arr) => {
    arr.fill(b)
    return arr
}

function snap(root, body, ts) {
    return write("snap", body, { root, target: "b".repeat(64), ts })
}

function freshDoor() {
    const { idb, KeyRange } = createMemoryIDB()
    let c = 0
    const engine = createEngine({
        idb,
        KeyRange,
        dbName: `wire-${Math.random().toString(36).slice(2)}`,
        random: fill(0x44),
        stamp: () => ({ t: 1_700_000_000_000 + ++c, n: 0 }),
        blobCap: 1024,
    })
    return createJournal({ engine })
}

/** Controllable pushEvent: queue replies, hang, drop, or custom. */
function makeHook(handlers = {}) {
    /** @type {Array<{ name: string, payload: object }>} */
    const log = []
    const hook = {
        log,
        liveSocket: {
            connected: true,
            isConnected() {
                return this.connected
            },
        },
        pushEvent(eventName, payload) {
            log.push({ name: eventName, payload })
            const h = handlers[eventName] ?? handlers["*"]
            if (typeof h === "function") return h(payload, eventName)
            // Default: no reply (undefined) — silence.
            return Promise.resolve(undefined)
        },
    }
    return hook
}

describe("wire: structural law", () => {
    test("only wire.js in keep/ names pushEvent (id:kb-vet finding 7)", () => {
        const hits = []
        function walk(dir) {
            for (const ent of readdirSync(dir, { withFileTypes: true })) {
                const p = join(dir, ent.name)
                if (ent.isDirectory()) walk(p)
                else if (/\.(js|mjs)$/.test(ent.name)) {
                    const src = readFileSync(p, "utf8")
                    if (src.includes("pushEvent")) hits.push(p)
                }
            }
        }
        walk(KEEP_DIR)
        assert.equal(hits.length, 1, `expected wire.js only, got ${hits.join(", ")}`)
        assert.ok(hits[0].endsWith("wire.js"))
    })

    test("no navigator.onLine, no online/offline flag, no retry timer", () => {
        const src = readFileSync(join(KEEP_DIR, "wire.js"), "utf8")
        // Strip comments — the prose may name the refusal; the code must not
        // *read* navigator.onLine, set an online flag, or arm a retry timer.
        // queueMicrotask is a yield between pages, not a backoff.
        const code = src
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/\/\/.*$/gm, "")
        assert.equal(code.includes("navigator.onLine"), false)
        assert.equal(code.includes("navigator"), false)
        assert.equal(/\bonline\s*[:=]/.test(code), false)
        assert.equal(/\boffline\s*[:=]/.test(code), false)
        assert.equal(/setTimeout|setInterval/.test(code), false)
    })

    test("page depth is shared — wire and river both import keep/page.js", () => {
        assert.equal(typeof PAGE, "number")
        assert.ok(PAGE > 0)
        const pageSrc = readFileSync(join(KEEP_DIR, "page.js"), "utf8")
        assert.match(pageSrc, /export const PAGE/)
        const wireSrc = readFileSync(join(KEEP_DIR, "wire.js"), "utf8")
        assert.match(wireSrc, /from ["']\.\/page\.js["']/)
        const riverSrc = readFileSync(
            join(KEEP_DIR, "../hooks/shell/river.js"),
            "utf8",
        )
        assert.match(riverSrc, /from ["'].*keep\/page\.js["']/)
        assert.equal(/const PAGE\s*=/.test(riverSrc), false, "river does not redefine PAGE")
    })
})

describe("wire: say — a drop is a fact", () => {
    test("resolves void on success; never throws the LV return", async () => {
        const hook = makeHook({
            hatch: async () => "ok",
        })
        const wire = createWire({ hook })
        const result = await wire.say("hatch", { x: 1 })
        assert.equal(result, "ok")
        assert.deepEqual(hook.log.map((e) => e.name), ["hatch"])
    })

    test("swallows a rejected pushEvent", async () => {
        const hook = makeHook({
            "*": async () => {
                throw new Error("unable to push hook event. LiveView not connected")
            },
        })
        const drops = []
        const wire = createWire({
            hook,
            onDrop: (n, e) => drops.push({ n, msg: e?.message }),
        })
        await assert.doesNotReject(wire.say("keep", { id: "x" }))
        const r = await wire.say("keep", { id: "x" })
        assert.equal(r, undefined)
        assert.ok(drops.length >= 1)
    })

    test("swallows a sync throw", async () => {
        const hook = {
            pushEvent() {
                throw new Error("boom")
            },
        }
        const wire = createWire({ hook })
        const p = wire.say("x", {})
        assert.ok(p instanceof Promise)
        await assert.doesNotReject(p)
        assert.equal(await p, undefined)
    })

    test("missing pushEvent is silence, not an exception", async () => {
        const wire = createWire({ hook: {} })
        assert.equal(await wire.say("keep", {}), undefined)
    })
})

describe("wire: announce — one drain, newest first, serial", () => {
    /** @type {ReturnType<typeof freshDoor>} */
    let door
    beforeEach(() => {
        door = freshDoor()
    })
    afterEach(async () => {
        await door.close()
    })

    test("ships local(root) whole, newest first, one at a time", async () => {
        const root = await door.root()
        const a = snap(root, { tag: "a" }, { t: 100, n: 0 })
        const b = snap(root, { tag: "b" }, { t: 200, n: 0 })
        const c = snap(root, { tag: "c" }, { t: 300, n: 0 })
        await door.put(a)
        await door.put(b)
        await door.put(c)

        /** @type {string[]} */
        const order = []
        let inflight = 0
        let maxInflight = 0
        const hook = makeHook({
            [KEEP_EVENT]: async (payload) => {
                inflight++
                maxInflight = Math.max(maxInflight, inflight)
                order.push(read(payload.message).tag)
                // Yield so a concurrent announce could race if the latch failed.
                await Promise.resolve()
                inflight--
                return { id: payload.id, at: 1, node: "n1" }
            },
        })
        const wire = createWire({ hook, door })
        await wire.announce()

        assert.deepEqual(order, ["c", "b", "a"], "newest first")
        assert.equal(maxInflight, 1, "serial — one in flight at a time")
        assert.equal((await door.local(root)).length, 0, "all settled")
        // Every ship carried the claim and the message.
        for (const e of hook.log.filter((x) => x.name === KEEP_EVENT)) {
            assert.equal(e.payload.id, name(e.payload.message))
        }
    })

    test("permanent shared marks local → 0; second announce ships nothing", async () => {
        const root = await door.root()
        const bytes = snap(root, { tag: "one" }, { t: 1, n: 0 })
        await door.put(bytes)

        const hook = makeHook({
            [KEEP_EVENT]: async (payload) => ({ id: payload.id, at: 42, node: "peer" }),
        })
        const wire = createWire({ hook, door })
        await wire.announce()
        assert.equal((await door.local(root)).length, 0)

        const before = hook.log.length
        await wire.announce()
        assert.equal(
            hook.log.filter((e) => e.name === KEEP_EVENT).length,
            1,
            "second announce ships nothing",
        )
        assert.equal(hook.log.length, before)
    })

    test("permanent refusal marks shared too — announce terminates", async () => {
        // The loop held_seat_logic measures: refuse without share → re-ship forever.
        const root = await door.root()
        const bytes = snap(root, { tag: "bad" }, { t: 1, n: 0 })
        const id = await door.put(bytes)

        const notes = []
        const hook = makeHook({
            [KEEP_EVENT]: async (payload) => ({ id: payload.id, at: 7, node: "n1", why: "root" }),
        })
        const wire = createWire({
            hook,
            door,
            onNote: (n) => notes.push(n),
        })
        await wire.announce()
        assert.equal((await door.local(root)).length, 0)
        assert.deepEqual(notes, [{ kind: "refused", id, why: "root" }])

        await wire.announce()
        assert.equal(
            hook.log.filter((e) => e.name === KEEP_EVENT).length,
            1,
            "refused-and-shared never re-ships",
        )
    })

    test("silence is not an answer — entry stays kept local", async () => {
        const root = await door.root()
        const bytes = snap(root, { tag: "quiet" }, { t: 1, n: 0 })
        await door.put(bytes)

        // pushEvent resolves undefined — a drop, or a server that said nothing.
        const hook = makeHook({
            [KEEP_EVENT]: async () => undefined,
        })
        const wire = createWire({ hook, door })
        await wire.announce()
        assert.equal((await door.local(root)).length, 1, "still kept local")
        // Next announce re-offers.
        await wire.announce()
        assert.equal(hook.log.filter((e) => e.name === KEEP_EVENT).length, 2)
    })

    test("first silence ends the pass — does not thrash the page", async () => {
        const root = await door.root()
        for (let i = 0; i < 10; i++) {
            await door.put(snap(root, { i }, { t: 100 + i, n: 0 }))
        }
        const hook = makeHook({
            [KEEP_EVENT]: async () => undefined,
        })
        const wire = createWire({ hook, door, page: 10 })
        await wire.announce()
        assert.equal(
            hook.log.filter((e) => e.name === KEEP_EVENT).length,
            1,
            "one drop, not ten",
        )
        assert.equal((await door.local(root)).length, 10)
    })

    test("page + chain-while-heard drains the backlog", async () => {
        const root = await door.root()
        const N = 7
        for (let i = 0; i < N; i++) {
            await door.put(snap(root, { i }, { t: 1000 + i, n: 0 }))
        }
        let ships = 0
        const hook = makeHook({
            [KEEP_EVENT]: async (payload) => {
                ships++
                return { id: payload.id, at: ships, node: "n" }
            },
        })
        const wire = createWire({ hook, door, page: 3 })
        await wire.announce()
        // Chains via queueMicrotask — wait until local is empty or timeout.
        for (let i = 0; i < 40 && (await door.local(root)).length > 0; i++) {
            await new Promise((r) => setTimeout(r, 5))
        }
        assert.equal((await door.local(root)).length, 0, "all eventually shared")
        assert.equal(ships, N, "every entry shipped once across pages")
    })

    test("full page of answers with more remaining chains; silence does not", async () => {
        const root = await door.root()
        for (let i = 0; i < 5; i++) {
            await door.put(snap(root, { i }, { t: 2000 + i, n: 0 }))
        }
        let n = 0
        const hook = makeHook({
            [KEEP_EVENT]: async (payload) => {
                n++
                // First page (3) answers; if a 4th ship happens without chain
                // from silence we'd still get answers — we answer all.
                return { id: payload.id, at: n, node: "n" }
            },
        })
        const wire = createWire({ hook, door, page: 3 })
        await wire.announce()
        // After first pass, 2 remain; chain should clear them.
        for (let i = 0; i < 40 && (await door.local(root)).length > 0; i++) {
            await new Promise((r) => setTimeout(r, 5))
        }
        assert.equal(n, 5)
        assert.equal((await door.local(root)).length, 0)
    })

    test("source rides the ship when held; image never does", async () => {
        const root = await door.root()
        const text = "to forward 10\n"
        const bytes = write(
            "snap",
            { source_id: name(text), title: null, diagnostics: [], buffer_id: null },
            { root, target: "b".repeat(64), ts: { t: 5, n: 0 } },
        )
        await door.put(bytes, { source: text })

        const hook = makeHook({
            [KEEP_EVENT]: async (payload) => ({ id: payload.id, at: 1, node: "n" }),
        })
        const wire = createWire({ hook, door })
        await wire.announce()
        const ship = hook.log.find((e) => e.name === KEEP_EVENT)
        assert.equal(ship.payload.source, text)
        assert.equal(ship.payload.image, undefined)
    })

    // ── the image follows the fact (id:kb-12a, id:kb-vet5 41) ──────────

    test("the message shares, THEN the image ships — in that order", async () => {
        const root = await door.root()
        const bytes = snap(root, { tag: "pic" }, { t: 1, n: 0 })
        await door.put(bytes, { image: new Blob([new Uint8Array([1, 2, 3])]) })

        const hook = makeHook({
            [KEEP_EVENT]: async (p) => ({ id: p.id, at: 7, node: "n" }),
        })
        const wire = createWire({ hook, door })
        await wire.announce()
        // The ship is not awaited by the drain — let its microtasks settle.
        await new Promise((r) => setTimeout(r, 0))

        const order = hook.log.map((e) => e.name)
        assert.deepEqual(order.slice(0, 2), [KEEP_EVENT, IMAGE_EVENT])

        const shipped = hook.log.find((e) => e.name === IMAGE_EVENT)
        assert.equal(shipped.payload.id, name(bytes))
        // base64 exists again only at ship — the store holds bytes.
        assert.equal(typeof shipped.payload.image, "string")
        assert.equal(globalThis.atob(shipped.payload.image).length, 3)
    })

    test("silence ships no image — before shared the blob may be the only copy", async () => {
        const root = await door.root()
        await door.put(snap(root, { tag: "quiet" }, { t: 1, n: 0 }), {
            image: new Blob([new Uint8Array([9])]),
        })

        const hook = makeHook({ [KEEP_EVENT]: async () => undefined })
        await createWire({ hook, door }).announce()
        await new Promise((r) => setTimeout(r, 0))

        assert.equal(hook.log.some((e) => e.name === IMAGE_EVENT), false)
    })

    test("a permanent refusal ships no image, and says why out loud", async () => {
        const root = await door.root()
        await door.put(snap(root, { tag: "no" }, { t: 1, n: 0 }), {
            image: new Blob([new Uint8Array([9])]),
        })

        const notes = []
        const hook = makeHook({
            [KEEP_EVENT]: async (p) => ({ id: p.id, at: 3, node: "n", why: "root" }),
        })
        await createWire({ hook, door, onNote: (n) => notes.push(n) }).announce()
        await new Promise((r) => setTimeout(r, 0))

        assert.equal(hook.log.some((e) => e.name === IMAGE_EVENT), false)
        // Keep it, or say why not — never neither (id:kb-vet5 43).
        assert.deepEqual(notes, [{ kind: "refused", id: notes[0]?.id, why: "root" }])
    })

    test("a keep with no blob held ships nothing, and the drain lives", async () => {
        const root = await door.root()
        await door.put(snap(root, { tag: "textonly" }, { t: 1, n: 0 }))

        const hook = makeHook({
            [KEEP_EVENT]: async (p) => ({ id: p.id, at: 1, node: "n" }),
        })
        await createWire({ hook, door }).announce()
        await new Promise((r) => setTimeout(r, 0))

        assert.equal(hook.log.some((e) => e.name === IMAGE_EVENT), false)
        assert.equal(hook.log.filter((e) => e.name === KEEP_EVENT).length, 1)
    })

    test("three verbs and no fourth — stand was excised (id:kb-vet5 44)", async () => {
        const wire = createWire({ hook: makeHook({}), door })
        assert.deepEqual(
            Object.keys(wire).sort(),
            ["announce", "attached", "reconnected", "say"],
        )
    })
})

describe("wire: re-entry and reconnect", () => {
    /** @type {ReturnType<typeof freshDoor>} */
    let door
    beforeEach(() => {
        door = freshDoor()
    })
    afterEach(async () => {
        await door.close()
    })

    test("a second announce while draining does not double-ship (reannounce-armed)", async () => {
        const root = await door.root()
        await door.put(snap(root, { tag: "a" }, { t: 1, n: 0 }))
        await door.put(snap(root, { tag: "b" }, { t: 2, n: 0 }))

        /** @type {((v: unknown) => void) | null} */
        let release = null
        const gate = new Promise((r) => {
            release = r
        })
        /** @type {((v: unknown) => void) | null} */
        let sawFirst = null
        const firstShip = new Promise((r) => {
            sawFirst = r
        })
        let ships = 0
        const hook = makeHook({
            [KEEP_EVENT]: async (payload) => {
                ships++
                if (ships === 1) {
                    sawFirst(undefined)
                    await gate // hold the first reply
                }
                return { id: payload.id, at: ships, node: "n" }
            },
        })
        const wire = createWire({ hook, door })
        const first = wire.announce()
        await firstShip // drain has entered the first push
        // Concurrent re-entry arms reannounce — never a second concurrent drain.
        await wire.announce()
        assert.equal(ships, 1, "second announce deferred while in flight")
        release(undefined)
        await first
        // First drain ships both; free pass finds local empty.
        assert.equal(ships, 2, "serial drain finished both")
        assert.equal((await door.local(root)).length, 0)
    })

    test("eager keep mid-drain ships on the reannounce free pass", async () => {
        const root = await door.root()
        const a = snap(root, { tag: "a" }, { t: 1, n: 0 })
        await door.put(a)

        /** @type {((v: unknown) => void) | null} */
        let release = null
        const gate = new Promise((r) => {
            release = r
        })
        /** @type {((v: unknown) => void) | null} */
        let sawFirst = null
        const firstShip = new Promise((r) => {
            sawFirst = r
        })
        /** @type {string[]} */
        const tags = []
        const hook = makeHook({
            [KEEP_EVENT]: async (payload) => {
                tags.push(read(payload.message).tag)
                if (tags.length === 1) {
                    sawFirst(undefined)
                    await gate
                }
                return { id: payload.id, at: tags.length, node: "n" }
            },
        })
        const wire = createWire({ hook, door })
        const first = wire.announce()
        await firstShip
        // Mint while the first keep is still in flight — eager re-announce.
        await door.put(snap(root, { tag: "fresh" }, { t: 2, n: 0 }))
        await wire.announce()
        assert.deepEqual(tags, ["a"], "no concurrent second drain")
        release(undefined)
        await first
        for (let i = 0; i < 40 && (await door.local(root)).length > 0; i++) {
            await new Promise((r) => setTimeout(r, 5))
        }
        assert.ok(tags.includes("fresh"), "reannounce free pass shipped the new keep")
        assert.equal((await door.local(root)).length, 0)
    })

    test("one-fact reply: shared settles, refused notes, silence ends — no UI callback", async () => {
        // Wire settles the journal only. Share-edge UI is fold-derived (river).
        const src = readFileSync(join(KEEP_DIR, "wire.js"), "utf8")
        assert.equal(src.includes("onShared"), false)

        const root = await door.root()
        const ok = snap(root, { tag: "ok" }, { t: 3, n: 0 })
        const bad = snap(root, { tag: "bad" }, { t: 2, n: 0 })
        const quiet = snap(root, { tag: "quiet" }, { t: 1, n: 0 })
        await door.put(ok)
        await door.put(bad)
        await door.put(quiet)

        const notes = []
        const hook = makeHook({
            [KEEP_EVENT]: async (payload) => {
                const tag = read(payload.message).tag
                if (tag === "quiet") return undefined
                if (tag === "bad") {
                    return { id: payload.id, at: 1, node: "n", why: "root" }
                }
                return { id: payload.id, at: 1, node: "n" }
            },
        })
        const wire = createWire({
            hook,
            door,
            onNote: (n) => notes.push(n),
        })
        // Newest first: ok shared → settle; bad refused → settle+note; quiet silence → break.
        await wire.announce()
        assert.equal((await door.local(root)).length, 1, "quiet stays kept local")
        assert.deepEqual(notes, [{ kind: "refused", id: name(bad), why: "root" }])
        // ok is shared (left local); quiet remains.
        const held = (await door.local(root)).map((x) => read(x).tag)
        assert.deepEqual(held, ["quiet"])
    })

    test("reconnected clears the latch; a hung reply cannot block the healer", async () => {
        const root = await door.root()
        const bytes = snap(root, { tag: "stuck" }, { t: 1, n: 0 })
        await door.put(bytes)

        let hang = true
        let ships = 0
        /** @type {((v: unknown) => void) | null} */
        let sawFirst = null
        const firstShip = new Promise((r) => {
            sawFirst = r
        })
        const hook = makeHook({
            [KEEP_EVENT]: (payload) => {
                ships++
                if (ships === 1) sawFirst(undefined)
                if (hang) {
                    // Never settles — the old channel's silence (id:kb-vet2 15).
                    return new Promise(() => {})
                }
                return Promise.resolve({ id: payload.id, at: 9, node: "n" })
            },
        })
        const wire = createWire({ hook, door })

        // Start a drain that will hang on the first reply.
        void wire.announce()
        await firstShip
        assert.equal(ships, 1)

        // Healer: clear latch, re-announce. Without the clear this would skip forever.
        hang = false
        await wire.reconnected()
        assert.ok(ships >= 2, "healer shipped again")
        assert.equal((await door.local(root)).length, 0, "settled after reconnect")
    })

    test("birth and reconnected are the same sentence — both call announce", async () => {
        // The surface does not grow a reconnect path distinct from birth.
        // createWire exposes one announce; reconnected is announce after clear.
        const root = await door.root()
        await door.put(snap(root, { tag: "z" }, { t: 1, n: 0 }))

        let n = 0
        const hook = makeHook({
            [KEEP_EVENT]: async (payload) => {
                n++
                return { id: payload.id, at: n, node: "n" }
            },
        })
        const wire = createWire({ hook, door })

        // birth path
        await wire.announce()
        assert.equal(n, 1)
        // after shared, local empty — reconnected still runs the sentence
        await wire.reconnected()
        assert.equal(
            hook.log.filter((e) => e.name === KEEP_EVENT).length,
            1,
            "nothing left to ship, but the path is the same function",
        )
    })
})

describe("wire: one-fact settle is fenced to the shipped id (probe W1)", () => {
    /** @type {ReturnType<typeof freshDoor>} */
    let door
    beforeEach(() => {
        door = freshDoor()
    })
    afterEach(async () => {
        await door.close()
    })

    test("a reply naming another keep does not false-share it", async () => {
        // A is newer → ships first. Reply for A claims B is shared.
        // Without the fence: B leaves local, A re-ships forever.
        const root = await door.root()
        const b = snap(root, { tag: "innocent" }, { t: 1, n: 0 })
        const a = snap(root, { tag: "shipped" }, { t: 2, n: 0 })
        const idB = await door.put(b)
        const idA = await door.put(a)

        const hook = makeHook({
            [KEEP_EVENT]: async (payload) => {
                if (payload.id === idA) {
                    return { id: idB, at: 1, node: "evil" }
                }
                // Honest reply for B if it still ships
                return { id: payload.id, at: 2, node: "n" }
            },
        })
        await createWire({ hook, door }).announce()

        const local = (await door.local(root)).map((x) => read(x).tag)
        // A was never answered under its own id → still kept local.
        assert.ok(local.includes("shipped"), "A stays local when reply names B")
        // B must not have been false-shared by A's reply. It may still ship
        // in the same drain (snapshot) and settle honestly — either still
        // local (if only the poison reply ran) or shared via its own ship.
        // The wound is: B shared WITHOUT B's id being the subject of a settle
        // from its own push. After the fence, A's poison is a no-op; B then
        // ships and settles honestly → local is only ["shipped"].
        assert.deepEqual(local, ["shipped"])
        // Next announce re-offers A only.
        await createWire({
            hook: makeHook({
                [KEEP_EVENT]: async (payload) => ({ id: payload.id, at: 9, node: "n" }),
            }),
            door,
        }).announce()
        assert.equal((await door.local(root)).length, 0)
    })
})

describe("wire: attached", () => {
    test("reads liveSocket.isConnected — nothing else", () => {
        const hook = makeHook()
        const wire = createWire({ hook })
        assert.equal(wire.attached(), true)
        hook.liveSocket.connected = false
        assert.equal(wire.attached(), false)
    })

    test("missing liveSocket is false, never a throw", () => {
        const wire = createWire({ hook: { pushEvent: async () => {} } })
        assert.equal(wire.attached(), false)
    })
})
