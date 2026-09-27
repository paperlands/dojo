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
    (t) => t.type === "page" && t.url.includes("localhost:4000/shell"),
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
    (await cdp("Runtime.evaluate", { expression, returnByValue: true })).result
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
      const content = document.querySelector('.cm-content');
      if (!content) return 'NO EDITOR';
      content.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, ${JSON.stringify(program)});
      return content.innerText.slice(0, 200);
    })()`);
      if (held === "NO EDITOR") await new Promise((r) => setTimeout(r, 250));
    }
    if (held === "NO EDITOR") {
      console.error("play_cdp: editor never mounted (.cm-content absent); injection did NOT occur");
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
  } else {
    console.error("usage: play_cdp.mjs run <prog> [waitMs] [out.png] [--bare] | shot <out.png> [--bare] | eval <js> | probe");
    process.exit(1);
  }
} finally {
  s.close();
}
process.exit(0);
