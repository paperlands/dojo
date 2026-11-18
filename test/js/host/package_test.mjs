import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const json = async path => JSON.parse(await readFile(path, 'utf8'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

test('packed runtime installs offline, preserves evidence, and resolves through its public export', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'dojo-package-test-'))
    try {
        const out = join(temp, 'runtime'), consumer = join(temp, 'consumer')
        execFileSync(process.execPath, ['scripts/release/host.mjs', out], { cwd: root, stdio: 'pipe' })
        const manifest = await json(join(out, 'package.json'))
        const sourceManifest = await json(join(root, 'scripts/release/package.json'))
        assert.deepEqual(manifest, sourceManifest)
        const appVersion = (await readFile(join(root, 'mix.exs'), 'utf8'))
            .match(/^ *version: *"([^"]+)"/m)?.[1]
        assert.equal(manifest.version, appVersion, 'npm and app release versions must match')
        assert.equal(manifest.name, '@paperland/paperlang')
        assert.match(manifest.version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/)
        assert.equal(manifest.type, 'module')
        assert.equal(manifest.exports, './host.mjs')
        assert.equal(manifest.publishConfig.access, 'public')
        assert.equal(manifest.publishConfig.registry, 'https://registry.npmjs.org')
        assert.equal(manifest.license, 'AGPL-3.0-only')
        assert.equal(manifest.private, undefined)
        assert.equal(manifest.dependencies, undefined)
        assert.equal(manifest.scripts, undefined)
        assert.ok(manifest.files.includes('sources/'))
        const readme = await readFile(join(out, 'README.md'), 'utf8')
        assert.ok(readme.includes(`npm install ${manifest.name}`))
        assert.match(readme, /WebGL/)
        assert.match(readme, /AGPL/)
        assert.match(readme, /fetch fonts/)

        await writeFile(join(out, 'UNPUBLISHED.txt'), 'must not enter the tarball')
        const npm = (cwd, ...args) => execFileSync('npm', [...args, '--offline', '--ignore-scripts',
            '--no-audit', '--no-fund', '--cache', join(temp, 'npm-cache'),
            '--userconfig', join(temp, 'npmrc')], { cwd, encoding: 'utf8', stdio: 'pipe' })
        const [packed] = Object.values(JSON.parse(npm(out, 'pack', '--json', '--pack-destination', temp)))
        assert.equal(packed.name, manifest.name)
        assert.equal(packed.version, manifest.version)
        const release = await json(join(out, 'release.json'))
        assert.equal(release.name, manifest.name)
        assert.equal(release.version, manifest.version)
        const expected = [...Object.keys(release.artifacts), 'release.json',
            ...Object.keys(release.sources).map(path => 'sources/' + path)].sort()
        assert.deepEqual(packed.files.map(file => file.path).sort(), expected)

        await mkdir(consumer)
        await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n')
        npm(consumer, 'install', join(temp, packed.filename), '--package-lock=false')
        const installed = join(consumer, 'node_modules', manifest.name)
        assert.deepEqual(await json(join(installed, 'package.json')), manifest)
        for (const [path, hash] of Object.entries(release.artifacts))
            assert.equal(sha256(await readFile(join(installed, path))), hash, path)
        for (const [path, hash] of Object.entries(release.sources))
            assert.equal(sha256(await readFile(join(installed, 'sources', path))), hash, path)

        const resolved = execFileSync(process.execPath, ['--input-type=module', '-e',
            `console.log(import.meta.resolve(${JSON.stringify(manifest.name)}));
             try { import.meta.resolve(${JSON.stringify(manifest.name + '/sources/assets/js/host.js')});
                 process.exit(1) } catch (error) {
                 if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw error
             }`], { cwd: consumer, encoding: 'utf8' }).trim()
        assert.equal(resolved, pathToFileURL(join(installed, 'host.mjs')).href)

        const { build } = await import('../../../scripts/vendor/node_modules/esbuild/lib/main.js')
        const bundled = await build({
            absWorkingDir: consumer,
            stdin: { contents: `export { createWorld } from ${JSON.stringify(manifest.name)}`,
                resolveDir: consumer, sourcefile: 'consumer.mjs' },
            bundle: true, format: 'esm', platform: 'browser', write: false,
            metafile: true, outfile: join(temp, 'consumer.mjs'),
        })
        const output = Object.values(bundled.metafile.outputs)[0]
        assert.deepEqual(output.exports, ['createWorld'])
        assert.deepEqual(output.imports, [])
        assert.ok(Object.keys(bundled.metafile.inputs).some(path => path.endsWith(manifest.name + '/host.mjs')))
    } finally {
        await rm(temp, { recursive: true, force: true })
    }
})
