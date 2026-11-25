// probe-status: active
// See FRESH-REENTRY.org.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from '../../scripts/vendor/node_modules/esbuild/lib/main.js'
import { openBrowser } from '../expressive-workflow/cdp.mjs'
const root = fileURLToPath(new URL('../..', import.meta.url))
const unfenced = process.argv.includes('--unfenced')
const plugins = unfenced ? [{name: 'probe-unfenced-play', setup(b) {
  b.onLoad({filter: /\/assets\/js\/host\.js$/}, async ({path}) => {
    const src = await readFile(path, 'utf8')
    const fence = /^            if \(delivering\) \{\n                await undefined\n                if \(disposed\) throw halt\("disposed"\)\n                if \(generation !== gen\) throw halt\("superseded"\)\n            \}\n/m
    assert.match(src, fence, 'the negative control removes the production fence')
    return {loader: 'js', contents: src.replace(fence, '')}
  })
}}] : []
const motor = (await build({ absWorkingDir: root, entryPoints: ['assets/js/host.js'], bundle: true, plugins, write: false, platform: 'browser', format: 'esm' })).outputFiles[0].contents
const font = await readFile(root + '/priv/static/fonts/paperLang.ttf')
const server = createServer((req, res) => {
  if (req.url === '/host.mjs') { res.setHeader('Content-Type', 'text/javascript'); return res.end(motor) }
  if (req.url === '/fonts/paperLang.ttf') { res.setHeader('Content-Type', 'font/ttf'); return res.end(font) }
  if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><style>canvas {display:block;width:640px;height:480px}</style>') }
  res.writeHead(404); res.end()
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
let browser
try {
  browser = await openBrowser({ url: `http://127.0.0.1:${server.address().port}/` })
  const result = await browser.evaluate(`(async () => {
    const { createWorld } = await import('/host.mjs');
    const inspect = async (reenter) => {
      const canvas = document.createElement('canvas'); document.body.append(canvas);
      const world = createWorld(canvas);
      try {
        const run = await world.play('wait 1\\nlet mark = 1\\nwait 10');
        const oldOutcome = run.finished.then(() => 'complete', e => e.reason);
        let replacement, duringReplacement;
        const replace = () => {
          replacement = world.play('wait 0.05\\nlet arrived = 1\\nwait 10');
          duringReplacement = world.interaction.read('arrived');
        };
        world.interaction.subscribe('mark', a => { if (reenter && a.value === 1 && !replacement) replace(); });
        const scrub = run.scrub(1000);
        if (!reenter) replace();
        const afterOldCall = world.interaction.read('arrived');
        const fresh = await replacement;
        fresh.finished.catch(() => {});
        return {scrub, duringReplacement, afterOldCall, oldOutcome: await oldOutcome};
      } finally { world.dispose(); canvas.remove(); }
    };
    return { control: await inspect(false), reentrant: await inspect(true) };
  })()`)
  console.log(JSON.stringify(result, null, 2))
  assert.equal(result.control.afterOldCall.kind, 'missing')
  assert.equal(result.reentrant.duringReplacement.kind, 'missing')
  assert.equal(result.reentrant.afterOldCall.kind, unfenced ? 'value' : 'missing')
  assert.equal(result.reentrant.oldOutcome, 'superseded')
} finally {
  await browser?.dispose()
  server.closeAllConnections()
  await new Promise(ok => server.close(ok))
}