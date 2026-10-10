import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, cp, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const build = (cwd, out) => execFileSync(process.execPath, ['scripts/release/host.mjs', out], { cwd, stdio: 'pipe' })
const json = async path => JSON.parse(await readFile(path, 'utf8'))

test('release is reproducible, licensed, bounded, and identifies actual source bytes', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dojo-release-test-'))
    try {
        const a = join(temp, 'a'), b = join(temp, 'b')
        build(root, a); build(root, b)
        const first = await json(join(a, 'release.json'))
        const second = await json(join(b, 'release.json'))
        assert.deepEqual(first, second)
        assert.match(first.commit, /^[a-f0-9]{40}$/)
        assert.equal(first.revision, first.sourceDirty
            ? `${first.commit}-dirty+${first.sourceDigest.slice(0, 12)}` : first.commit)
        assert.equal(first.sourceDigest, sha256(JSON.stringify(first.sources)))
        for (const [path, hash] of Object.entries(first.sources))
            assert.equal(sha256(await readFile(join(a, 'sources', path))), hash, path)
        for (const [path, hash] of Object.entries(first.artifacts))
            assert.equal(sha256(await readFile(join(a, path))), hash, path)
        const meta = await json(join(a, 'host.meta.json'))
        assert.ok(meta.outputs['host.mjs'].exports.includes('createHatch'))
        assert.deepEqual(Object.keys(meta.outputs).sort(), ['host.mjs', 'host.mjs.LEGAL.txt'])
        assert.ok(!Object.keys(meta.inputs).some(path => /recorder|mediabunny|\/editor\/|\/terminal\/|phoenix_live_view/.test(path)))
        assert.match(await readFile(join(a, 'LICENSE'), 'utf8'), /GNU AFFERO GENERAL PUBLIC LICENSE/)
        assert.match(await readFile(join(a, 'licenses/Apache-2.0.txt'), 'utf8'), /Version 2.0/)
        assert.match(await readFile(join(a, 'NOTICE.txt'), 'utf8'), /Steffen Hanikel/)
        assert.match(await readFile(join(a, 'host.mjs.LEGAL.txt'), 'utf8'), /Three.js Authors/)
        build(root, a)
        assert.deepEqual(await json(join(a, 'release.json')), first)

        const clean = join(temp, 'checkout')
        await cp(join(a, 'sources'), clean, { recursive: true })
        await symlink(join(root, 'scripts/vendor/node_modules'), join(clean, 'scripts/vendor/node_modules'))
        await writeFile(join(clean, '.gitignore'), 'scripts/vendor/node_modules/\n')
        const git = (...args) => execFileSync('git', ['-C', clean, '-c', 'user.name=Release Test',
            '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgSign=false',
            '-c', 'core.hooksPath=/dev/null', ...args], { stdio: 'pipe' })
        git('init'); git('add', '.'); git('commit', '-m', 'release inputs')
        const cleanOut = join(temp, 'clean')
        build(clean, cleanOut)
        const pristine = await json(join(cleanOut, 'release.json'))
        assert.equal(pristine.checkoutDirty, false)
        assert.equal(pristine.sourceDirty, false)
        assert.equal(pristine.revision, pristine.commit)
        assert.equal(pristine.sourceDigest, first.sourceDigest)
        assert.equal(pristine.artifacts['host.mjs'], first.artifacts['host.mjs'])
        await writeFile(join(clean, 'assets/js/host.js'), '\n// local edit\n', { flag: 'a' })
        build(clean, cleanOut)
        const edited = await json(join(cleanOut, 'release.json'))
        assert.equal(edited.commit, pristine.commit)
        assert.equal(edited.checkoutDirty, true)
        assert.equal(edited.sourceDirty, true)
        assert.notEqual(edited.sourceDigest, pristine.sourceDigest)
        assert.notEqual(edited.revision, pristine.revision)
    } finally {
        await rm(temp, { recursive: true, force: true })
    }
})
