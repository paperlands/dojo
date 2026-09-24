// Drive the host door in a real browser. The source fence cannot see this.
import { connect } from "node:net"
import { randomBytes } from "node:crypto"
import { spawn } from "node:child_process"

const port = Number(process.argv[2])
const dir = process.argv[3]

function wsConnect(url) {
    return new Promise((resolve, reject) => {
        const key = randomBytes(16).toString("base64")
        const sock = connect(Number(url.port), url.hostname)
        let upgraded = false
        let buf = Buffer.alloc(0)
        let fragments = []
        const handlers = { message: () => {} }
        sock.on("connect", () => sock.write(
            `GET ${url.pathname} HTTP/1.1\r\nHost: ${url.hostname}:${url.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
        ))
        sock.on("error", reject)
        sock.on("data", (chunk) => {
            buf = Buffer.concat([buf, chunk])
            if (!upgraded) {
                const end = buf.indexOf("\r\n\r\n")
                if (end < 0) return
                if (!/ 101 /.test(buf.subarray(0, end).toString().split("\r\n")[0])) return reject(new Error("upgrade"))
                buf = buf.subarray(end + 4)
                upgraded = true
                resolve(api)
            }
            while (buf.length >= 2) {
                const fin = (buf[0] & 0x80) !== 0
                const opcode = buf[0] & 0x0f
                let len = buf[1] & 0x7f
                let off = 2
                if (len === 126) {
                    if (buf.length < 4) return
                    len = buf.readUInt16BE(2)
                    off = 4
                } else if (len === 127) {
                    if (buf.length < 10) return
                    len = Number(buf.readBigUInt64BE(2))
                    off = 10
                }
                if (buf.length < off + len) return
                const payload = buf.subarray(off, off + len)
                buf = buf.subarray(off + len)
                if (opcode === 9) { send(payload, 10); continue }
                if (opcode === 8) return
                fragments.push(payload)
                if (fin) {
                    const whole = Buffer.concat(fragments)
                    fragments = []
                    if (opcode === 1 || opcode === 0) handlers.message(whole.toString())
                }
            }
        })
        function send(data, opcode = 1) {
            const mask = randomBytes(4)
            const payload = Buffer.isBuffer(data) ? data : Buffer.from(data)
            const len = payload.length
            let header
            if (len < 126) header = Buffer.from([0x80 | opcode, 0x80 | len])
            else {
                header = Buffer.alloc(4)
                header[0] = 0x80 | opcode
                header[1] = 0x80 | 126
                header.writeUInt16BE(len, 2)
            }
            const masked = Buffer.from(payload)
            for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4]
            sock.write(Buffer.concat([header, mask, masked]))
        }
        const api = {
            send: (s) => send(s),
            onMessage: (fn) => { handlers.message = fn },
            close: () => sock.end(),
        }
    })
}

const chrome = spawn("chromium", [
    "--headless=new", "--disable-gpu",
    "--remote-debugging-port=9225",
    `--user-data-dir=${dir}/chrome`,
    `http://127.0.0.1:${port}/`,
], { stdio: "ignore" })

const deadline = Date.now() + 20000
let page
while (Date.now() < deadline) {
    try {
        const pages = await (await fetch("http://127.0.0.1:9225/json")).json()
        page = pages.find((p) => p.type === "page" && p.url.includes(String(port)))
        if (page) break
    } catch { /* chrome still booting */ }
    await new Promise((r) => setTimeout(r, 200))
}
if (!page) {
    chrome.kill()
    console.error("no host page")
    process.exit(1)
}

const ws = await wsConnect(new URL(page.webSocketDebuggerUrl))
let nextId = 0
const pending = new Map()
ws.onMessage((raw) => {
    const msg = JSON.parse(raw)
    if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
    }
})
const cdp = (method, params = {}) => new Promise((res, rej) => {
    const id = ++nextId
    const t = setTimeout(() => rej(new Error("cdp timeout " + method)), 8000)
    pending.set(id, (m) => { clearTimeout(t); res(m) })
    ws.send(JSON.stringify({ id, method, params }))
})
await cdp("Runtime.enable")

let text = ""
while (Date.now() < deadline) {
    const msg = await cdp("Runtime.evaluate", {
        expression: "document.getElementById('out')?.textContent || ''",
        returnByValue: true,
    })
    text = msg.result?.result?.value || ""
    if (text.includes("DONE") || text.includes("FAIL ")) break
    await new Promise((r) => setTimeout(r, 200))
}
ws.close()
chrome.kill()
console.log(text.trim())
const missing = ["bad:", "(line 1)", "ok:", "rej:hatch disposed", "beats:", "scored:true", "quiet:true", "morph:", "morphok:true", "nest:", "nestok:true", "laws:", "lawsok:true", "pendingdispose:true", "DONE"].filter((n) => !text.includes(n))
if (text.includes("FAIL ") || text.includes("bad:accepted") || missing.length) {
    console.error("runtime door failed", missing)
    process.exit(1)
}
console.log("runtime door ok")
