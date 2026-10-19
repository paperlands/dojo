// Produce the consumer artifact and the evidence needed to identify it (D030).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile, mkdir, readdir, mkdtemp, rename, rm, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative, join, sep } from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 })
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const out = resolve(process.argv[2] ?? join(root, 'dist/host'))
const inside = relative(root, out)
if (!inside || (!inside.startsWith('..' + sep) && inside !== '..' && !inside.startsWith('dist' + sep)))
    throw Error('output must be under dist/ or outside the checkout')
let existing = []
try { existing = await readdir(out) } catch (error) { if (error.code !== 'ENOENT') throw error }
if (existing.length) {
    const prior = JSON.parse(await readFile(join(out, 'release.json'), 'utf8'))
    if (prior.artifact !== 'paperlang-host') throw Error('refusing to replace a non-release directory')
}
let esbuild
try { esbuild = await import('../vendor/node_modules/esbuild/lib/main.js') }
catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    execFileSync('npm', ['ci', '--prefix', join(root, 'scripts/vendor')], { stdio: 'inherit' })
    esbuild = await import('../vendor/node_modules/esbuild/lib/main.js')
}
const commit = git('rev-parse', 'HEAD').toString().trim()
const checkoutDirty = git('status', '--porcelain', '--untracked-files=all').length > 0
await mkdir(dirname(out), { recursive: true })
const temp = await mkdtemp(join(dirname(out), '.host-release-'))
try {
    const loaded = new Map()
    const result = await esbuild.build({
        absWorkingDir: root,
        entryPoints: ['assets/js/host.js'],
        bundle: true, format: 'esm', platform: 'browser', minify: true,
        metafile: true, legalComments: 'linked', outfile: join(temp, 'host.mjs'),
        plugins: [{ name: 'source-snapshot', setup(build) {
            build.onLoad({ filter: /\.(js|mjs|json)$/ }, async ({ path }) => {
                const bytes = await readFile(path)
                loaded.set(relative(root, path), bytes)
                return { contents: bytes.toString('utf8'), resolveDir: dirname(path),
                    loader: path.endsWith('.json') ? 'json' : 'js' }
            })
        } }],
    })
    const inputs = Object.keys(result.metafile.inputs).sort()
    const banned = ['turtling/export/recorder.js', 'mediabunny', '/editor/', '/terminal/', 'phoenix_live_view']
    if (inputs.some(path => banned.some(word => path.includes(word)))) throw Error('host closure includes page/export machinery')
    for (const required of ['turtling/turtle.js', 'turtling/orbit.js', 'utils/threetext.js'])
        if (!inputs.some(path => path.endsWith(required))) throw Error('host closure missing ' + required)
    const licenses = (await readdir(join(root, 'scripts/release/licenses'))).sort()
    const sourcePaths = [...new Set([...inputs, 'LICENSE', 'scripts/release/host.org', 'scripts/release/host.mjs',
        'scripts/release/NOTICE.txt', 'scripts/vendor/package.json', 'scripts/vendor/package-lock.json',
        ...licenses.map(name => 'scripts/release/licenses/' + name)])].sort()
    const sources = {}
    let sourceDirty = false
    for (const path of sourcePaths) {
        const bytes = loaded.get(path) ?? await readFile(join(root, path))
        sources[path] = sha256(bytes)
        try { if (!git('show', `${commit}:${path}`).equals(bytes)) sourceDirty = true }
        catch { sourceDirty = true }
        const dest = join(temp, 'sources', path)
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, bytes)
    }
    const sourceDigest = sha256(JSON.stringify(sources))
    await mkdir(join(temp, 'licenses'))
    await copyFile(join(root, 'LICENSE'), join(temp, 'LICENSE'))
    await copyFile(join(root, 'scripts/release/NOTICE.txt'), join(temp, 'NOTICE.txt'))
    for (const name of licenses) await copyFile(join(root, 'scripts/release/licenses', name), join(temp, 'licenses', name))
    const meta = result.metafile
    meta.outputs = Object.fromEntries(Object.entries(meta.outputs).map(([path, info]) => [
        relative(temp, resolve(root, path)), info,
    ]))
    await writeFile(join(temp, 'host.meta.json'), JSON.stringify(meta, null, 2) + '\n')
    const artifacts = {}
    for (const path of ['host.mjs', 'host.mjs.LEGAL.txt', 'host.meta.json', 'LICENSE', 'NOTICE.txt',
        ...licenses.map(name => 'licenses/' + name)]) artifacts[path] = sha256(await readFile(join(temp, path)))
    await writeFile(join(temp, 'release.json'), JSON.stringify({
        artifact: 'paperlang-host', format: 'esm', commit, checkoutDirty, sourceDirty,
        revision: sourceDirty ? `${commit}-dirty+${sourceDigest.slice(0, 12)}` : commit,
        sourceDigest, sources, artifacts, esbuild: esbuild.version,
    }, null, 2) + '\n')
    await writeFile(join(temp, 'README.txt'),
        'Import createHatch from host.mjs. See sources/scripts/release/host.org for the API.\n' +
        'Keep LICENSE, NOTICE.txt, licenses/ and host.mjs.LEGAL.txt with distributions.\n' +
        'Build-input snapshot: overlay sources/ on a checkout, then run node scripts/release/host.mjs\n' +
        'Rebuilding requires a Git checkout at release.json.commit with these inputs overlaid.\n' +
        'Source URLs and git tags identify only clean commits; dirty builds carry sourceDigest.\n')
    if (existing.length) await rm(out, { recursive: true })
    else await rm(out, { recursive: true, force: true })
    await rename(temp, out)
    console.log(`Built ${out} (${commit}${sourceDirty ? ', dirty sources' : ''})`)
} finally {
    await rm(temp, { recursive: true, force: true })
}
