// The journal worker — concurrent boundary, not a speedup (id:kc-env, id:kb-5).
//
// One hash per snap needs no worker. Folding the clan's history on reconnect —
// N entries mid-animation — is the operation that earns it. The render thread
// never hashes, serializes, or waits on a transaction.
//
// The engine never leaks past the door (id:kb-6). This file is plumbing only —
// it names no store, no index, no transaction; journal.store.js is the one place
// indexedDB is reached. Verbs arrive as {id, op, args}; replies as
// {id, ok, value|error}.

import { createJournal } from "./journal.store.js"
import { VERB_SET } from "./verbs.js"

const journal = createJournal()

self.onmessage = async (ev) => {
    const msg = ev.data
    if (!msg || (typeof msg.id !== "number" && typeof msg.id !== "string")) return
    const { id, op, args = [] } = msg
    if (!VERB_SET.has(op)) {
        self.postMessage({ id, ok: false, error: `unknown op: ${op}` })
        return
    }
    try {
        const value = await journal[op](...args)
        self.postMessage({ id, ok: true, value })
    } catch (e) {
        self.postMessage({
            id,
            ok: false,
            error: e && e.message ? e.message : String(e),
        })
    }
}
