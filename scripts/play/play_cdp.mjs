// The play rig's hands and eyes over raw CDP — zero dependencies, node 18+.
// Drives the live shell (codex/play.org) when the chrome-devtools MCP is absent,
// and more cheaply than the MCP when it isn't: one invocation per played night.
//
//   node scripts/play/play_cdp.mjs run <prog-file> [waitMs] [out.png] [--bare]
//   node scripts/play/play_cdp.mjs shot <out.png> [--bare]
//   node scripts/play/play_cdp.mjs eval '<js expression>'
//   node scripts/play/play_cdp.mjs probe        # the instrumented world read
//
// run:  inject the program into the editor (execCommand hot-swap), let the night
//       run, then print the profiler line + console tail and screenshot.
// shot: screenshot only. --bare hides every element that does not contain the
//       main canvas first (the editor pane overlays the figure), restores after.
// eval: evaluate an expression on the page, print the value.
//
// Rig assumptions: chromium --remote-debugging-port=9222 pointed at
// http://localhost:4000/shell?perf=1 with the dev server up.

import { readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { randomBytes } from "node:crypto";

const DEBUG_HTTP = "http://localhost:9222";
// The shell page to drive. Override when the dev server is not on 4000 (the
// rig's assumption, not a contract): DOJO_SHELL=localhost:4001/shell
const SHELL_MATCH = process.env.DOJO_SHELL || "localhost:4000/shell";

// --- minimal WebSocket client (client frames masked, fragments reassembled) ---
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64");
    const sock = connect(Number(url.port), url.hostname);
    let upgraded = false;
    let buf = Buffer.alloc(0);
    let fragments = [];
    const handlers = { message: () => {} };

    sock.on("connect", () => {
      sock.write(
        `GET ${url.pathname} HTTP/1.1\r\n` +
          `Host: ${url.hostname}:${url.port}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    sock.on("error", reject);
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const end = buf.indexOf("\r\n\r\n");
        if (end === -1) return;
        const head = buf.subarray(0, end).toString();
        if (!/ 101 /.test(head.split("\r\n")[0]))
          return reject(new Error(head.split("\r\n")[0]));
        buf = buf.subarray(end + 4);
        upgraded = true;
        resolve(api);
      }
      while (true) {
        if (buf.length < 2) return;
        const fin = (buf[0] & 0x80) !== 0;
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf.length < off + len) return;
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (opcode === 9) { send(payload, 10); continue; } // ping -> pong
        if (opcode === 8) { sock.end(); return; }
        fragments.push(payload);
        if (fin) {
          const whole = Buffer.concat(fragments);
          fragments = [];
          if (opcode === 1 || opcode === 0) handlers.message(whole.toString());
        }
      }
    });

    function send(payload, opcode = 1) {
      const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
      const mask = randomBytes(4);
      let header;
      if (data.length < 126) {
        header = Buffer.from([0x80 | opcode, 0x80 | data.length]);
      } else if (data.length < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(data.length, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(data.length), 2);
      }
      const masked = Buffer.from(data);
      for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
      sock.write(Buffer.concat([header, mask, masked]));
    }

    const api = {
      send: (s) => send(s),
      onMessage: (fn) => (handlers.message = fn),
      close: () => sock.end(),
    };
  });
}

// --- CDP session against the shell page ---
async function shellSession() {
  const targets = await (await fetch(`${DEBUG_HTTP}/json`)).json();
  const page = targets.find(
    (t) => t.type === "page" && t.url.includes(SHELL_MATCH),
  );
  if (!page)
    throw new Error(
      "no shell page; open targets: " + targets.map((t) => t.url).join(", "),
    );
  const ws = await wsConnect(new URL(page.webSocketDebuggerUrl));
  let nextId = 0;
  const pending = new Map();
  const consoleTail = [];
  ws.onMessage((raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params.args || [])
        .map((a) => a.value ?? a.description ?? "")
        .join(" ");
      consoleTail.push(`[${msg.params.type}] ${text}`.slice(0, 200));
      if (consoleTail.length > 40) consoleTail.shift();
    }
  });
  const cdp = (method, params = {}) =>
    new Promise((res) => {
      const id = ++nextId;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evalJs = async (expression) =>
    (await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result
      ?.result?.value;
  return { cdp, evalJs, consoleTail, close: () => ws.close() };
}

// --- the eyes ---
const HIDE = `(() => {
  const cvs = [...document.querySelectorAll('canvas')];
  let n = 0;
  document.querySelectorAll('body *').forEach(el => {
    if (el.tagName === 'CANVAS') return;                        // every canvas is the stage
    if (cvs.some(c => el.contains(c) || c.contains(el))) return; // a canvas wrapper stays
    if (el.offsetParent !== null) {
      el.dataset._hid = el.style.visibility || '_';
      el.style.visibility = 'hidden';
      n++;
    }
  });
  return 'hid ' + n;
})()`;
const RESTORE = `(() => {
  let n = 0;
  document.querySelectorAll('[data-_hid]').forEach(el => {
    el.style.visibility = el.dataset._hid === '_' ? '' : el.dataset._hid;
    delete el.dataset._hid;
    n++;
  });
  return 'restored ' + n;
})()`;
const PERF = `document.body.innerText.split('\\n')
  .filter(l => /ambient|texture|geometr|draw|frames|scheduler/i.test(l)).join(' | ')`;

async function screenshot(s, outPng, bare) {
  if (bare) await s.evalJs(HIDE);
  await new Promise((r) => setTimeout(r, 300));
  await s.cdp("Page.enable");
  const shot = await s.cdp("Page.captureScreenshot", { format: "png" });
  if (bare) await s.evalJs(RESTORE);
  if (!shot.result?.data)
    throw new Error("screenshot failed: " + JSON.stringify(shot).slice(0, 200));
  writeFileSync(outPng, Buffer.from(shot.result.data, "base64"));
  console.log("screenshot ->", outPng);
}

// --- the hands, for the journey -----------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Inject a program through the editor, exactly as `run` does. A hot-swap that
// never happens is a rig failure, not a pass.
async function typeInto(s, program) {
  let held = "NO EDITOR";
  for (let i = 0; i < 80 && held === "NO EDITOR"; i++) {
    held = await s.evalJs(`(() => {
      const box = document.querySelector('.cm-content') || document.querySelector('textarea');
      if (!box) return 'NO EDITOR';
      box.focus();
      if (box.tagName === 'TEXTAREA') {
        box.value = ${JSON.stringify(program)};
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new Event('change', { bubbles: true }));
        return box.value.slice(0, 80);
      }
      document.execCommand('selectAll');
      document.execCommand('insertText', false, ${JSON.stringify(program)});
      return box.innerText.slice(0, 80);
    })()`);
    if (held === "NO EDITOR") await sleep(250);
  }
  if (held === "NO EDITOR") throw new Error("play_cdp: the editor never mounted; injection did NOT occur");
  return held;
}

// REAL pointer events through CDP — not synthetic DOM events.
const pointer = (s, type, x, y) =>
  s.cdp("Input.dispatchMouseEvent", {
    type, x: Math.round(x), y: Math.round(y), button: "left",
    buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, pointerType: "mouse",
  });

const readWorld = (s) => s.evalJs("window.__probe ? window.__probe.read() : null");
const positionOf = (read, name) => {
  const a = (read?.ambients ?? []).find((x) => x.name === name);
  // The PRODUCTION projection's own reading, not the local transform. (D058)
  const p = a?.state?.at ?? a?.transform?.pos ?? a?.transform?.position ?? null;
  return p ? p.map((n) => +n.toFixed(6)) : null;
};
const lawOf = (read, feature) => (read?.laws ?? []).find((l) => l.feature === feature) ?? null;

// Wait until the world satisfies `test(read)`, or give up loudly.
async function settleUntil(s, test, tries = 120, ms = 250) {
  for (let i = 0; i < tries; i++) {
    const read = await readWorld(s);
    if (read && test(read)) return read;
    await sleep(ms);
  }
  return null;
}

// A cheap signature of the world a stage reads: revision, every law, and every ambient's
// position, offered state and locus. Two identical signatures mean nothing moved.
const signatureOf = (read) => JSON.stringify([
  read?.revision,
  (read?.laws ?? []).map((l) => [l.feature, l.address, l.predicate ?? l.radius ?? null]),
  (read?.ambients ?? []).map((a) => [a.name, a.transform?.pos, a.state?.at, a.state?.interaction?.offered, a.state?.locus?.kind]),
]);

// READY means all three, and nothing weaker:
//   1. the world reflects a HATCH THAT HAPPENED AFTER we submitted — yesterday's world has
//      an older `lastHatchAt`, so it cannot be mistaken for the one we asked for;
//   2. it satisfies the stage's own post-condition;
//   3. it is STABLE across n consecutive polls.
async function readyAfter(s, genBefore, test, n = 3, tries = 160) {
  let same = 0, last = null;
  for (let i = 0; i < tries; i++) {
    const read = await readWorld(s);
    if (read && Number(read.lastHatchAt) > genBefore && test(read)) {
      const sig = signatureOf(read);
      same = sig === last ? same + 1 : 1;
      last = sig;
      if (same >= n) return read;
    } else { same = 0; last = null; }
    await sleep(250);
  }
  return null;
}

// The PAINTED ink near a CSS pixel. The drawing buffer is not preserved, so `readPixels`
// never sees it; instead the REAL composited screenshot — what the eye gets — is clipped
// around the pixel and decoded in the page itself. No fake surface, no proxy. (D058)
const inkNear = async (s, x, y, r = 14) => {
  const clip = { x: Math.max(0, Math.round(x - r)), y: Math.max(0, Math.round(y - r)), width: r * 2, height: r * 2, scale: 1 };
  const shot = await s.cdp("Page.captureScreenshot", { format: "png", clip });
  const b64 = shot.result?.data;
  if (!b64) return null;
  return s.evalJs(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${b64}';
    await img.decode();
    const c2 = document.createElement('canvas');
    c2.width = img.width; c2.height = img.height;
    const ctx = c2.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, img.width, img.height).data;
    const bg = [d[0], d[1], d[2]];
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 40) lit++;
    }
    return { lit, samples: img.width * img.height, background: bg };
  })()`);
};
// --- modes ---
const [, , mode, ...rest] = process.argv;
const bare = rest.includes("--bare");
const args = rest.filter((a) => a !== "--bare");

const s = await shellSession();
try {
  if (mode === "run") {
    const [progFile, waitMs = "15000", outPng] = args;
    const program = readFileSync(progFile, "utf8");
    await s.cdp("Runtime.enable");
    // Wait for the editor to mount; a hot-swap that never happens is a rig
    // failure, not a pass. Fail loudly rather than finishing with NO EDITOR.
    let held = "NO EDITOR";
    for (let i = 0; i < 80 && held === "NO EDITOR"; i++) {
      held = await s.evalJs(`(() => {
      const box = document.querySelector('.cm-content') || document.querySelector('textarea');
      if (!box) return 'NO EDITOR';
      box.focus();
      if (box.tagName === 'TEXTAREA') {
        box.value = ${JSON.stringify(program)};
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new Event('change', { bubbles: true }));
        return box.value.slice(0, 200);
      }
      document.execCommand('selectAll');
      document.execCommand('insertText', false, ${JSON.stringify(program)});
      return box.innerText.slice(0, 200);
    })()`);
      if (held === "NO EDITOR") await new Promise((r) => setTimeout(r, 250));
    }
    if (held === "NO EDITOR") {
      console.error("play_cdp: editor never mounted (.cm-content / textarea absent); injection did NOT occur");
      process.exit(2);
    }
    console.log("editor holds:", JSON.stringify(held));
    await new Promise((r) => setTimeout(r, Number(waitMs)));
    console.log("perf:", await s.evalJs(PERF));
    if (s.consoleTail.length)
      console.log("console tail:\n" + s.consoleTail.slice(-15).join("\n"));
    if (outPng) await screenshot(s, outPng, bare);
  } else if (mode === "shot") {
    await screenshot(s, args[0], bare);
  } else if (mode === "eval") {
    console.log(JSON.stringify(await s.evalJs(args[0]), null, 1));
  } else if (mode === "probe") {
    await s.cdp("Runtime.enable");
    console.log(JSON.stringify(await s.evalJs("window.__probe ? window.__probe.read() : null"), null, 2));
  } else if (mode === "journey") {
    // ONE real-browser visit: construction, truth, touch, revision and refusal, through
    // the REAL shell's own projection, its own capture and its OWN painted pixels.
    await s.cdp("Runtime.enable");
    const [progFile, reviseRadius = 3, outDir = "/tmp"] = args;
    const program = readFileSync(progFile, "utf8");
    const out = (n, d) => console.log("·", n, JSON.stringify(d));
    const at = (r, n) => positionOf(r, n);
    const project = (world) => s.evalJs(`window.__probe.project(${JSON.stringify(world)})`);
    const failures = [];
    const must = (ok, why) => { if (!ok) failures.push(why); return ok; };

    // --- 1. RENDER a sphere/plane circle in a nontrivial frame.
    const feats = (r) => (r?.laws ?? []).map((l) => l.feature);
    const hasCircle = (r) => r?.done && feats(r).length === 2 && feats(r).includes("distance") && feats(r).includes("coordinate");
    await sleep(1500);   // the editor's own hot-swap is not instantaneous
    const gen1 = Number((await readWorld(s))?.lastHatchAt ?? 0);
    await typeInto(s, program);
    const base = await readyAfter(s, gen1, hasCircle);
    if (!base) throw new Error("journey: the figure never settled; the canvas is not ready");
    const A0 = at(base, "A");
    const laws0 = base.laws.map((l) => l.feature).sort();
    out("1 rendered", { A: A0, deg: +(Math.atan2(A0[1], A0[0])*180/Math.PI).toFixed(1), id: base.ambients?.find((x) => x.name === "A")?.id, laws: laws0, revision: base.revision });
    must(!!A0, "no A is rendered");
    must(laws0.includes("distance") && laws0.includes("coordinate"), "the circle's two obligations are not both live");

    // --- 1b. THE VIEW WHERE FIDELITY IS AT RISK. A face-on camera is well conditioned and
    //         follows easily; the defect shows OBLIQUELY. Pin the view so the fence measures
    //         the hard case, and report the camera with every gap. (id:laws-decl-anchor)
    await s.evalJs(`window.__probe.look({ position: [220, 300, 260], target: [0, 0, 0] })`);
    await sleep(500);
    const oblique = (await readWorld(s))?.camera ?? null;
    out("1b oblique view", { camera: oblique });

    // --- 2. THE PAINTED LOCUS, sampled AWAY from the marker: a point, a stroke or a UI
    //        element can satisfy `lit > 0`, so the CONTOUR itself must carry the ink.
    const p0 = await project(A0);
    const r0 = Math.hypot(A0[0], A0[1]);
    const onContour = (deg) => [r0 * Math.cos(deg * Math.PI / 180), r0 * Math.sin(deg * Math.PI / 180), A0[2]];
    const contour = [];
    for (const deg of [60, 150, 240, 330]) {
      const px = await project(onContour(deg));
      contour.push({ deg, ink: await inkNear(s, px.x, px.y, 10) });
    }
    // The NEGATIVE control is a CONTRAST at the locus, not "no ink anywhere": the plane's
    // own patch is painted, so a flat fill is lit everywhere. The stroke must stand out
    // from the radii just inside and just outside it, at the same angle.
    const offContour = [];
    for (const scale of [0.7, 1.3]) {
      const px = await project([scale * r0 * 1, 0, A0[2]]);
      offContour.push(await inkNear(s, px.x, px.y, 10));
    }
    const onRadial = await project([r0, 0, A0[2]]);
    const onInk = await inkNear(s, onRadial.x, onRadial.y, 10);
    out("2 contour", { r: +r0.toFixed(3), contour: contour.map((c) => c.ink?.lit ?? null), atLocus: onInk?.lit ?? null, offLocus: offContour.map((o) => o?.lit ?? null) });
    must(!!p0 && Number.isFinite(p0.x) && Number.isFinite(p0.y), "the point does not project to a screen pixel");
    const painted = contour.filter((c) => (c.ink?.lit ?? 0) > 0).length;
    must(painted >= 3, `the CONTOUR is not painted (${painted}/4 samples carry ink)`);
    const flat = offContour.every((o) => (o?.lit ?? 0) >= (onInk?.lit ?? 0));
    must(!flat, "the ink is a flat fill: the stroke does not stand out at the locus");

    // --- 3. GRAB with a REAL pointer, and read the shell's own capture.
    // REAL input through the browser's own pipeline: the same path a person's finger takes.
    // ONE press — a second would be a different gesture, not a re-test.
    await pointer(s, "mousePressed", p0.x, p0.y);
    await sleep(300);
    const grabbed = await readWorld(s);
    out("3 grabbed", { held: grabbed.held, handMoves: grabbed.handMoves, offered: grabbed.ambients?.find((x) => x.name === "A")?.state?.interaction?.offered ?? null });
    must(grabbed.held === "A", `the pointer did not capture A (held=${grabbed.held})`);

    // Three DIFFERENT promises, tested separately. They are not one number:
    //   a. ON-CURVE traversal — the finger follows the projected curve, holding its grip:
    //      the point must stay under it within a small, documented pixel tolerance.
    //   b. OFF-CURVE motion — the finger leaves the curve: proximity is NOT promised (a
    //      lawful hand cannot track an unreachable finger); lawfulness and BRANCH CONTINUITY
    //      are, with the gap recorded as information, not as a failure.
    //   c. lawful throughout — the point stays on the circle and in the plane.
    const before = { at: at(grabbed, "A"), revision: grabbed.revision, camera: grabbed.camera };
    const r = Math.hypot(A0[0], A0[1]);
    const degOf = (w) => Math.atan2(w[1], w[0]) * 180 / Math.PI;
    const worldAt = (deg) => [r * Math.cos(deg * Math.PI / 180), r * Math.sin(deg * Math.PI / 180), A0[2]];
    const a0deg = degOf(A0);
    const p0again = await project(A0);
    const grip = { x: p0.x - p0again.x, y: p0.y - p0again.y };   // the grip the grab took

    // (a) ON-CURVE TRAVERSAL
    const FOLLOW_TOL = 3;   // CSS px: a documented tolerance, not an aspiration
    const followGaps = [];
    let cur = { x: p0.x, y: p0.y };
    for (const step of [8, 16, 24, 32, 40]) {
      const target = await project(worldAt(a0deg + step));
      cur = { x: target.x + grip.x, y: target.y + grip.y };
      await pointer(s, "mouseMoved", cur.x, cur.y);
      await sleep(220);
      const a = at(await readWorld(s), "A");
      const p = a ? await project(a) : null;
      followGaps.push(p ? +Math.hypot(p.x - cur.x, p.y - cur.y).toFixed(2) : null);
    }
    out("4a on-curve follow", { toleranceCssPx: FOLLOW_TOL, gapsCssPx: followGaps, camera: before.camera });
    const worst = Math.max(...followGaps.map((g) => (g === null ? Infinity : g)));
    must(worst <= FOLLOW_TOL,
      `the point does not follow the finger along the curve: worst gap ${worst} CSS px (${JSON.stringify(followGaps)})`);

    // (b) OFF-CURVE MOTION — the finger walks away from the curve in a straight screen line.
    const offGaps = [];
    const phases = [];
    for (let i = 0; i < 5; i++) {
      cur = { x: cur.x + 14, y: cur.y + 7 };
      await pointer(s, "mouseMoved", cur.x, cur.y);
      await sleep(220);
      const a = at(await readWorld(s), "A");
      const p = a ? await project(a) : null;
      offGaps.push(p ? +Math.hypot(p.x - cur.x, p.y - cur.y).toFixed(2) : null);
      phases.push(a ? +degOf(a).toFixed(2) : null);
    }
    out("4b off-curve", { gapsCssPx: offGaps, phaseDeg: phases, note: "proximity is not promised here" });
    const steps = phases.slice(1).map((p, i) => (p === null || phases[i] === null ? Infinity : Math.abs(p - phases[i])));
    const jump = Math.max(...steps);
    must(jump <= 60, `the phase JUMPED between branches (largest step ${jump}°; ${JSON.stringify(phases)})`);
    await pointer(s, "mouseReleased", cur.x, cur.y);
    const dragged = await settleUntil(s, (x) => x.handMoves && x.handMoves.accepted > 0, 40, 150);
    const A1 = dragged ? at(dragged, "A") : null;
    out("4c lawful throughout", { from: before.at, to: A1, deg: A1 ? +(Math.atan2(A1[1], A1[0])*180/Math.PI).toFixed(1) : null, id: dragged?.ambients?.find((x) => x.name === "A")?.id, accepted: dragged?.handMoves?.accepted, revision: dragged?.revision });
    must(A1 && Math.hypot(A1[0] - before.at[0], A1[1] - before.at[1]) > 1e-3, "the drag did not move the point at all");
    must(dragged && dragged.revision >= before.revision, "the revision went backwards");
    must(A1 && Math.abs(Math.hypot(A1[0], A1[1]) - r) < 1e-2, "the dragged point left the circle");
    must(A1 && Math.abs(A1[2]) < 1e-3, "the dragged point left the plane");

    // --- 5. CAMERA CONTROLS RESTORED after release, and the ink follows the point.
    const rested = await readWorld(s);
    // Sample the ink where the POINT is, not where the finger is: the whole finding is that
    // they differ. (id:laws-decl-anchor)
    const pEnd = A1 ? await project(A1) : null;   // the POINT's pose, not the boolean
    const ink1 = pEnd ? await inkNear(s, pEnd.x, pEnd.y, 10) : null;
    out("5 released", { held: rested.held, controlsEnabled: rested.controlsEnabled, inkAtEnd: ink1 });
    must(rested.held === null, "the pointer still holds after release");
    // The hand TAKES the camera while it holds, and GIVES IT BACK when it lets go.
    // (id:codex-play-eyes)
    must(grabbed.controlsEnabled === false, `the hand did not take the camera (controlsEnabled=${grabbed.controlsEnabled})`);
    must(rested.controlsEnabled === true, `the camera was not restored (controlsEnabled=${rested.controlsEnabled})`);
    // The camera STAYED STILL across the drag, so the gap is a hand/geometry matter, not a
    // view artefact. (id:codex-play-eyes)
    const camBefore = JSON.stringify(before.camera);
    const camAfter = JSON.stringify(rested.camera);
    out("5 camera", { still: camBefore === camAfter });
    must(camBefore === camAfter, "the camera moved during the drag, so the gap is confounded");
    must(ink1 && ink1.lit > 0, "nothing is painted at the end of the drag");

    // --- 6. REVISE the source; the painted locus follows.
    await typeInto(s, program.replace(/= 5\b/, `= ${reviseRadius}`));
    const gen6 = Number((await readWorld(s))?.lastHatchAt ?? 0);
    const revised = await readyAfter(s, gen6, (x) => {
      const d = (x.laws ?? []).find((l) => l.feature === "distance");
      return !!d && Math.abs((d.predicate ?? d.radius ?? 0) - Number(reviseRadius)) < 1e-6;
    });
    const A2 = revised ? at(revised, "A") : null;
    const p2 = A2 ? await project(A2) : null;
    const ink2 = p2 ? await inkNear(s, p2.x, p2.y, 6) : null;
    out("6 revised", { A: A2, deg: A2 ? +(Math.atan2(A2[1], A2[0])*180/Math.PI).toFixed(1) : null, id: revised?.ambients?.find((x) => x.name === "A")?.id, radius: Math.hypot(A2?.[0] ?? 0, A2?.[1] ?? 0), ink: ink2 });
    must(!!revised, "the revision never landed");
    must(A2 && Math.abs(Math.hypot(A2[0], A2[1]) - Number(reviseRadius)) < 1e-2, "the geometry did not follow the revision");
    must(ink2 && ink2.lit > 0, "the revised locus is not painted");

    // --- 7. OBSTRUCT a revision; accepted geometry stays visible and the refusal is legible.
    const prefix = revised ? { at: A2, revision: revised.revision } : null;
    // The pin is declared INSIDE the scope that owns A (a pin outside it is a different
    // failure: an unknown target). It conflicts with the retained distance, so it is refused.
    const obstructed = program
      .replace(/= 5\b/, `= ${reviseRadius}`)
      .replace(/^end$/m, `  let A = (${Number(reviseRadius) + 40},0,0)\nend`);
    const gen7 = Number((await readWorld(s))?.lastHatchAt ?? 0);
    await typeInto(s, obstructed);
    // READINESS, not a sleep: the refusal must be a hatch that happened AFTER we submitted,
    // READINESS, not a sleep. The observable post-condition of a REFUSED pin is: the hatch
    // happened after we submitted, the accepted distance STANDS at the revised radius, and
    // NO position law was installed. An unknown ambient state is not a refusal yet.
    const refused = await readyAfter(s, gen7, (r) => {
      const d = (r.laws ?? []).find((l) => l.feature === "distance");
      const pinLanded = feats(r).includes("position");
      return !!d && Math.abs((d.predicate ?? d.radius ?? 0) - Number(reviseRadius)) < 1e-6 && !pinLanded;
    });
    if (!refused) must(false, "the obstructed revision was never observed as a refusal");
    const A3 = at(refused, "A");
    const p3 = A3 ? await project(A3) : null;
    const ink3 = p3 ? await inkNear(s, p3.x, p3.y, 6) : null;
    // LEGIBLE ON SCREEN: the model's own refusal record, wherever it landed.
    const refusedState = (refused?.ambients ?? []).find((x) => !!x.error)?.error ?? null;
    // LEGIBLE ON SCREEN: the page's own TEXT must carry the refusal the model recorded. A
    // specific element can hold an ornament (`ˏˋ☀︎ˎˊ`), so the assertion is on what the eye
    // can read, matched against the model's own message. (id:codex-play-eyes)
    const pageText = await s.evalJs("document.body ? document.body.innerText : ''");
    const phrase = (refusedState?.message ?? "").split(/—|--/)[0].trim().slice(0, 24);
    const legible = phrase && (pageText || "").includes(phrase) ? refusedState.message : null;
    out("7 obstructed", { A: A3, ink: ink3, error: legible });
    must(A3 && prefix && Math.hypot(A3[0] - prefix.at[0], A3[1] - prefix.at[1]) < 1e-2, "the accepted geometry did not survive the refusal");
    must(ink3 && ink3.lit > 0, "the accepted geometry is no longer painted");
    must(!!legible && legible.length > 0, "the refusal is not legible on screen");

    await screenshot(s, `${outDir}/journey-final.png`, true);
    if (failures.length) {
      console.error("\njourney FAILED:");
      for (const f of failures) console.error("  - " + f);
      process.exitCode = 3;
    } else {
      console.log("\njourney: 7/7 stages hold");
    }
  } else {
    console.error("usage: play_cdp.mjs run <prog> [waitMs] [out.png] [--bare] | shot <out.png> [--bare] | eval <js> | probe");
    process.exit(1);
  }
} finally {
  s.close();
}
// A collected failure must be the PROCESS's outcome: `process.exit(0)` here would
// override `process.exitCode` and report success on a failed journey.
process.exit(process.exitCode ?? 0);
