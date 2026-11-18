// Every module under assets/js/turtling must LINK: a moved export or dangling import fails here,
// not as a ReferenceError inside a law test. Only module linking is checked.
// (id:laws-free-relations-contract)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../../assets/js/turtling/', import.meta.url))

// The dev tree resolves `three` through the bundler: esbuild emits assets/js/utils/three.core.min.js,
// which is not source. A module that reaches it cannot link in a bare Node process, and the failure
// is a MISSING MODULE at exactly that path — never any other error that happens to mention it. The
// exception is the bundle, not a file or a message fragment, and the test checks that it is still
// needed in the same pass, so it can neither hide a sibling's defect nor rot.
const BUNDLE = new URL('../../../assets/js/utils/three.core.min', import.meta.url).href

const isBundlerMiss = (error) =>
    error?.code === 'ERR_MODULE_NOT_FOUND' && error.url === BUNDLE

const modules = (dir, found = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) modules(path, found)
        else if (entry.name.endsWith('.js')) found.push(path)
    }
    return found
}

test('every turtling module links, except exactly the bundler miss', async () => {
    const unlinked = []
    const excused = []
    const names = modules(ROOT).map((path) => relative(ROOT, path)).sort()
    for (const name of names) {
        try {
            await import(new URL(name, `file://${ROOT}`).href)
        } catch (error) {
            if (isBundlerMiss(error)) { excused.push({ name, error }); continue }
            unlinked.push(`${name}: ${error.code ?? ''} ${String(error.message).split('\n')[0]}`)
        }
    }
    assert.deepEqual(unlinked, [], 'a module that does not link is a broken export or a dangling import')
    // Necessity, asserted here and not in a sibling test with mutable state: the exception is
    // still used, and every use is the same missing bundle rather than some other failure.
    assert.ok(excused.length > 0, `nothing reached ${BUNDLE} any more; delete this exception`)
    for (const { name, error } of excused) {
        assert.ok(isBundlerMiss(error), `${name}: excused for a reason other than the bundler miss`)
    }
})
