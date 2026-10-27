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
        assert.deepEqual(meta.outputs['host.mjs'].exports, ['createWorld'])
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

        const verify = (version = pristine.version, commit = pristine.commit) =>
            execFileSync(process.execPath, [join(root, 'scripts/release/verify-host.mjs'),
                cleanOut, version, commit], { stdio: 'pipe', encoding: 'utf8' })
        assert.match(verify(), /Verified @paperland\/paperlang@/)
        assert.throws(() => verify('999.0.0'), /release version mismatch/)
        assert.throws(() => verify(pristine.version, '0'.repeat(40)), /release commit mismatch/)
        for (const [path, message] of [
            ['host.mjs', /artifact hash mismatch: host.mjs/],
            ['sources/assets/js/host.js', /source hash mismatch: assets\/js\/host.js/],
        ]) {
            const original = await readFile(join(cleanOut, path))
            await writeFile(join(cleanOut, path), Buffer.concat([original, Buffer.from('\n// tampered\n')]))
            assert.throws(() => verify(), message)
            await writeFile(join(cleanOut, path), original)
        }
        for (const [field, value, message] of [
            ['checkoutDirty', true, /release checkout is dirty/],
            ['sourceDirty', true, /release source inputs are dirty/],
            ['sourceDigest', 'tampered', /source digest mismatch/],
        ]) {
            await writeFile(join(cleanOut, 'release.json'), JSON.stringify({ ...pristine, [field]: value }))
            assert.throws(() => verify(), message)
        }
        await writeFile(join(cleanOut, 'release.json'), JSON.stringify(pristine, null, 2) + '\n')
        assert.match(verify(), /Verified @paperland\/paperlang@/)
        await writeFile(join(clean, 'assets/js/host.js'), '\n// local edit\n', { flag: 'a' })
        build(clean, cleanOut)
        const edited = await json(join(cleanOut, 'release.json'))
        assert.equal(edited.commit, pristine.commit)
        assert.equal(edited.checkoutDirty, true)
        assert.equal(edited.sourceDirty, true)
        assert.throws(() => verify(), /release source inputs are dirty/)
        assert.notEqual(edited.sourceDigest, pristine.sourceDigest)
        assert.notEqual(edited.revision, pristine.revision)

        const manifestPath = join(clean, 'scripts/release/package.json')
        const manifest = await json(manifestPath)
        const [major, minor, patch] = manifest.version.split('.').map(Number)
        const nextVersion = `${major}.${minor}.${patch + 1}`
        manifest.version = nextVersion
        await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
        build(clean, cleanOut)
        const bumped = await json(join(cleanOut, 'release.json'))
        assert.equal(bumped.version, nextVersion)
        assert.equal((await json(join(cleanOut, 'package.json'))).version, nextVersion)
        assert.equal(bumped.sourceDirty, true)
        assert.equal(bumped.commit, pristine.commit)
        assert.notEqual(bumped.sourceDigest, edited.sourceDigest)
        assert.notEqual(bumped.artifacts['package.json'], edited.artifacts['package.json'])
        assert.equal(bumped.artifacts['host.mjs'], edited.artifacts['host.mjs'])
    } finally {
        await rm(temp, { recursive: true, force: true })
    }
})
