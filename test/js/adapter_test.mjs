// lvdx-4 / kc-c-wire — Promise<void>; a drop is a fact, never an exception
import { describe, test } from "node:test"
import assert from "node:assert/strict"
import { safePush } from "../../assets/js/adapter.js"

describe("adapter safePush (lvdx-4)", () => {
    test("resolves void when pushEvent succeeds (never the LV return value)", async () => {
        const el = {
            pushEvent: async (_e, _p) => "ok",
        }
        const result = await safePush(el, "hatchTurtle", { x: 1 })
        assert.equal(result, undefined)
    })

    test("swallows LiveView-not-connected rejection", async () => {
        const el = {
            pushEvent: async () => {
                throw new Error("unable to push hook event. LiveView not connected")
            },
        }
        // Must not reject
        await safePush(el, "seeWeave", {})
    })

    test("uses pushEventTo when selector given", async () => {
        let seen = null
        const el = {
            pushEventTo: async (sel, e, p) => {
                seen = { sel, e, p }
                return "to"
            },
        }
        await safePush(el, "evt", { a: 1 }, "#x")
        assert.deepEqual(seen, { sel: "#x", e: "evt", p: { a: 1 } })
    })

    test("sync throw is swallowed as resolved Promise, not undefined", async () => {
        const el = {
            pushEvent: () => {
                throw new Error("boom")
            },
        }
        const p = safePush(el, "x", {})
        assert.ok(p instanceof Promise)
        await assert.doesNotReject(p)
    })
})
