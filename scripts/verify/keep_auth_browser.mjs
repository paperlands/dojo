// Disposable Chromium worker/IDB witness; no server credentials or live profile.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { spawn, spawnSync } from "node:child_process"
import { readFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../", import.meta.url))
const profile = await mkdtemp(join(tmpdir(), "dojo-signing-"))
const m3Profile = await mkdtemp(join(tmpdir(), "dojo-m3-"))
const bundled = process.argv.includes("--bundled")
let pending
const page = `<!doctype html><script type="module">
import {createJournal} from '/assets/js/keep/journal.js';
import {createWire} from '/assets/js/keep/wire.js';
import {write, name} from '/assets/js/keep/entry.js';
const phase = new URL(location.href).searchParams.get('phase');
const m3 = phase.startsWith('m3-');
const retainedRoot = new URL(location.href).searchParams.get('prior');
const open = () => createJournal({worker: new Worker(${JSON.stringify(bundled ? '/built-worker.js' : '/assets/js/keep/journal.worker.js')}, ${bundled ? '{}' : "{type: 'module'}"})});
const check = (value, message) => {if (!value) throw Error(message)};
const lineage = async (door) => {
  const line = await door.roots();
  check(line && (line.active === null || typeof line.active === 'string') && Array.isArray(line.prior), 'roots shape');
  return line;
};
const editStore = async (store, action) => {
  const db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('dojo-keep');
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      action(tx.objectStore(store));
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
  } finally {db.close()}
};
try {
  check(isSecureContext, 'secure context required');
  const a = open(), b = open();
  const [ra, rb] = await Promise.all([a.root(), b.root()]);
  check(ra === rb, 'two workers minted different roots');
  const initial = await lineage(a);
  if (phase !== 'lineage' && phase !== 'm3-ship') {
    check(initial.active === ra && initial.prior.length === 0, 'initial lineage is active-only');
  }
  check((await lineage(b)).active === ra, 'second worker disagrees on active lineage');
  const message = m3 ? null : write('snap', {title: '你好 🌱'}, {root: phase === 'lineage' && retainedRoot ? retainedRoot : ra, ts: {t: 1, n: 0}});
  let payload;
  let before = null;
  if (!m3) {
    if (phase === 'mint') await a.put(message, {authored: true});
    else check(await a.get(name(message)) === message, 'retained message lost across restart');
    before = await a.proof(message);
  }
  if (phase === 'lost') {
    await editStore('self', store => store.delete('signing-key'));
    check(JSON.stringify(await a.proof(message)) === JSON.stringify(before), 'key loss erased retained evidence');
    const fresh = write('snap', {title: 'after key loss'}, {root: ra, ts: {t: 2, n: 0}});
    let refused = false;
    try {await a.put(fresh, {authored: true})} catch {refused = true}
    check(refused, 'lost key acquired replacement authority');
    check(await a.get(name(fresh)) == null, 'failed authoring left unsigned bytes');
    check(await a.root() === ra, 'key loss silently reminted root');
    const afterLoss = await lineage(a);
    check(afterLoss.active === ra && afterLoss.prior.length === 0, 'key loss changed public lineage');
  }
  if (phase === 'refill') {
    await editStore('log', store => store.delete(name(message)));
    await a.put(message, {proof: before});
    check(JSON.stringify(await a.proof(message)) === JSON.stringify(before), 'refill changed the original proof');
  }
  if (phase === 'identity') {
    const oldGenesis = await a.get(ra);
    const reading = await a.hand();
    check(reading.signing === 'keyless' && reading.root === ra, 'expected a keyless hand');
    const attempts = await Promise.allSettled([
      a.newHand({expectedRoot: ra}), b.newHand({expectedRoot: ra}),
    ]);
    const won = attempts.filter(x => x.status === 'fulfilled');
    const lost = attempts.filter(x => x.status === 'rejected');
    check(won.length === 1, 'two workers both replaced the hand');
    check(lost.length === 1 && lost[0].reason.code === 'stale-hand', 'loser has no stale-hand code');
    const next = await a.hand();
    check(next.signing === 'ready' && next.root !== ra, 'replacement did not seat a new root');
    check(await a.get(ra) === oldGenesis, 'archived public genesis is not readable');
    check(JSON.stringify(await b.proof(message)) === JSON.stringify(before), 'old proof no longer replays');
    check(await b.root() === next.root, 'stale worker kept an old cached root');
    const replaced = await lineage(a);
    check(replaced.active === next.root && replaced.prior.includes(ra), 'replacement lineage lost prior hand');
    check((await lineage(b)).active === next.root, 'second worker disagrees on replacement lineage');
    const origin = write('snap', {title: 'new origin'}, {root: next.root, ts: {t: 3, n: 0}});
    await a.put(origin, {authored: true});
    const child = write('snap', {prev: name(message)}, {root: next.root, target: name(origin), ts: {t: 4, n: 0}});
    await a.put(child, {authored: true});
    check(JSON.stringify(await a.proof(child)) === JSON.stringify(await b.proof(child)), 'fresh-root proof disagrees');
  }
  let m3Pending = null;
  if (phase === 'm3-pending') {
    const p = write('snap', {title: 'M3 pending'}, {root: ra, ts: {t: 7, n: 0}});
    await a.put(p, {authored: true});
    const proof = await a.proof(p);
    check(proof, 'authored pending has no proof');
    m3Pending = {id: name(p), message: p, proof};
    check((await lineage(a)).active === ra && (await a.local(ra, 10, {proved: true})).length === 1,
      'pending row is not active-local');
  }
  if (phase === 'm3-recover') {
    await editStore('self', store => store.delete('signing-key'));
    const next = await a.newHand({expectedRoot: ra});
    check(next.changed === true && next.root !== ra, 'recovery did not replace the hand');
    const line = await lineage(a);
    check(line.active === next.root && line.prior.includes(ra), 'recovery lineage lost old hand');
  }
  if (phase === 'm3-ship') {
    check(retainedRoot, 'm3-ship requires prior root');
    const p = write('snap', {title: 'M3 pending'}, {root: retainedRoot, ts: {t: 7, n: 0}});
    const id = name(p);
    check(await a.get(id) === p, 'old pending row did not survive restart');
    const proof = await a.proof(p);
    const seen = [];
    const hook = {pushEvent: async (_event, sent) => {
      seen.push(sent);
      return {id: sent.id, at: 9, node: 'm3'};
    }};
    await createWire({door: a, hook}).announce();
    check(seen.length === 1, 'expected exactly one old pending ship');
    payload = seen[0];
    check(payload.id === id && payload.message === p, 'old pending bytes changed');
    check(payload.current === false, 'old pending did not carry current:false');
    check(JSON.stringify(await a.proof(p)) === JSON.stringify(proof), 'replay re-signed old proof');
    check((await a.local(retainedRoot, 10, {proved: true})).length === 0,
      'matching receipt did not settle old pending');
  }
  if (!m3) {
    const alternate = await b.proof(message);
    check(JSON.stringify(alternate) === JSON.stringify(before), 'workers disagree on retained proof');
    if (phase !== 'lineage') {
      await createWire({door: a, hook: {pushEvent: async (_event, sent) => {payload = sent}}}).announce();
      check(payload && payload.proof, 'wire sent no evidenced payload');
    }
  }
  const currentLineage = await lineage(a);
  await a.close(); await b.close();
  await fetch('/report', {method: 'POST', body: JSON.stringify({root: ra, payload, phase, lineage: currentLineage, pending: m3Pending})});
} catch (error) {
  await fetch('/report', {method: 'POST', body: JSON.stringify({error: error.stack || String(error)})});
}
</script>`

const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1")
    if (req.method === "POST" && url.pathname === "/report") {
        let body = ""
        for await (const chunk of req) {
            body += chunk
            if (body.length > 1024 * 1024) { req.destroy(); return }
        }
        res.end("ok")
        try { pending?.resolve(JSON.parse(body)) } catch (error) { pending?.reject(error) }
        return
    }
    if (url.pathname === "/") return res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page)
    if (url.pathname === "/built-worker.js" && bundled) {
        try { return res.writeHead(200, { "content-type": "text/javascript" }).end(
            await readFile(join(root, "priv/static/assets/js/keep/journal.worker.js"))) }
        catch { return res.writeHead(404).end() }
    }
    const path = resolve(root, "." + url.pathname)
    const skeleton = url.pathname === "/priv/keep/skeleton.json"
    if (!skeleton && (!path.startsWith(resolve(root, "assets/js") + "/") || !path.endsWith(".js"))) return res.writeHead(404).end()
    try { res.writeHead(200, { "content-type": skeleton ? "application/json" : "text/javascript" }).end(await readFile(path)) }
    catch { res.writeHead(404).end() }
})

async function phase(name, prior = null, profileDir = profile) {
    let timer
    const reported = new Promise((resolve, reject) => {
        pending = { resolve, reject }
        timer = setTimeout(() => reject(Error(name + ": report timed out")), 30000)
    })
    const browser = spawn("chromium", ["--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", "--no-first-run", "--disable-background-networking",
        "--disable-component-update", "--disable-sync", "--user-data-dir=" + profileDir,
        "http://127.0.0.1:" + server.address().port + "/?phase=" + name + (prior ? "&prior=" + prior : "")],
        { detached: true, stdio: "ignore" })
    const closed = new Promise((resolve, reject) => {
        browser.once("close", resolve); browser.once("error", reject)
    })
    try {
        const report = await Promise.race([reported, closed.then(() => { throw Error("Chromium exited early") })])
        assert.equal(report.error, undefined, report.error)
        return report
    } finally {
        clearTimeout(timer); pending = null
        if (browser.pid) {
            try { process.kill(-browser.pid, "SIGKILL") }
            catch (error) { if (error.code !== "ESRCH") throw error }
        }
        await closed.catch(() => {})
    }
}

try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    let activeRoot
    let priorRoot
    let retainedProof
    for (const name of ["mint", "reopen", "lost", "refill", "identity", "lineage"]) {
        const report = await phase(name, name === "lineage" ? priorRoot : null)
        assert.ok(report.lineage && (report.lineage.active === null ||
            typeof report.lineage.active === "string") && Array.isArray(report.lineage.prior),
            "roots() must return {active, prior} through the worker")
        if (name !== "identity" && name !== "lineage" && activeRoot) {
            assert.equal(report.root, activeRoot, "process restart changed the root")
        }
        if (name === "mint") activeRoot = report.root
        if (name === "identity") {
            priorRoot = report.root
            assert.notEqual(report.lineage.active, priorRoot, "identity did not replace the active root")
            assert.equal(report.lineage.prior.includes(priorRoot), true, "identity lineage lost prior root")
        }
        if (name === "lineage") {
            assert.equal(report.lineage.active, report.root, "restart active lineage disagrees")
            assert.equal(report.lineage.prior.includes(priorRoot), true, "restart lineage lost prior root")
            activeRoot = report.root
        }
        if (report.payload) {
            if (retainedProof && name !== "identity") {
                assert.deepEqual(report.payload.proof, retainedProof, "proof was re-signed or lost")
            }
            if (name !== "identity") retainedProof = report.payload.proof
            const verdict = spawnSync("mix", ["run", "--no-start", "-e", `
              :io.setopts(:standard_io, encoding: :latin1)
              p = Jason.decode!(IO.binread(:stdio, :eof))
              {:ok, cols} = Dojo.Keep.project(p["message"], p["id"])
              {:ok, _} = Dojo.Keep.Auth.verify(p["message"], cols.root, p["proof"])
              IO.puts("verified")
            `], { cwd: root, env: { ...process.env, MIX_ENV: "test" }, input: JSON.stringify(report.payload), encoding: "utf8" })
            assert.equal(verdict.status, 0, verdict.stderr + verdict.stdout)
            assert.match(verdict.stdout, /verified/)
        }
        console.log(name + ": passed (Chromium worker + durable IDB" + (report.payload ? " + OTP proof)" : "; no unsigned ship)"))
    }

    let oldRoot
    let oldProof
    let pendingSettled = false
    for (const name of ["m3-pending", "m3-recover", "m3-ship"]) {
        const report = await phase(name, name === "m3-ship" ? oldRoot : null, m3Profile)
        assert.ok(report.lineage && (report.lineage.active === null ||
            typeof report.lineage.active === "string") && Array.isArray(report.lineage.prior),
            "M3 roots() must return {active, prior} through the worker")
        if (name === "m3-pending") {
            oldRoot = report.root
            oldProof = report.pending?.proof
            assert.equal(report.lineage.active, oldRoot)
            assert.equal(report.lineage.prior.length, 0)
            assert.ok(report.pending?.message && oldProof, "authored pending row missing")
        }
        if (name === "m3-recover") {
            assert.notEqual(report.lineage.active, oldRoot, "recovery did not replace root")
            assert.equal(report.lineage.prior.includes(oldRoot), true, "recovery lost prior root")
        }
        if (name === "m3-ship") {
            assert.equal(report.lineage.active, report.root, "restart active lineage disagrees")
            assert.equal(report.lineage.prior.includes(oldRoot), true, "restart lost pending root")
            assert.ok(report.payload, "old pending did not ship")
            assert.equal(report.payload.current, false, "old pending lacked current:false")
            assert.deepEqual(report.payload.proof, oldProof, "old pending proof was re-signed")
            const verdict = spawnSync("mix", ["run", "--no-start", "-e", `
              :io.setopts(:standard_io, encoding: :latin1)
              p = Jason.decode!(IO.binread(:stdio, :eof))
              {:ok, cols} = Dojo.Keep.project(p["message"], p["id"])
              {:ok, _} = Dojo.Keep.Auth.verify(p["message"], cols.root, p["proof"])
              IO.puts("verified")
            `], { cwd: root, env: { ...process.env, MIX_ENV: "test" }, input: JSON.stringify(report.payload), encoding: "utf8" })
            assert.equal(verdict.status, 0, verdict.stderr + verdict.stdout)
            assert.match(verdict.stdout, /verified/)
            pendingSettled = true
        }
        console.log(name + ": passed (M3 source worker + durable IDB" +
            (name === "m3-ship" ? " + old pending current:false + OTP proof" : "") + ")")
    }
    assert.equal(pendingSettled, true, "M3 pending ship cohort did not complete")
} finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(profile, { recursive: true, force: true })
    await rm(m3Profile, { recursive: true, force: true })
}
