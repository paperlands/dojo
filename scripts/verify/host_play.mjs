// Drive the host door in a real browser. The source fence cannot see this.
import { connect } from "node:net"
import { randomBytes } from "node:crypto"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"

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
    "--force-device-scale-factor=2",
    "--remote-debugging-port=0",
    `--user-data-dir=${dir}/chrome`,
    `http://127.0.0.1:${port}/`,
], { stdio: "ignore" })

let ws
try {
    const deadline = Date.now() + 20000
    let page
    while (Date.now() < deadline) {
        try {
            const debugPort = readFileSync(`${dir}/chrome/DevToolsActivePort`, "utf8").split("\n")[0]
            const pages = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json()
            page = pages.find((p) => p.type === "page" && p.url === `http://127.0.0.1:${port}/`)
            if (page) break
        } catch { /* chrome still booting */ }
        await new Promise((r) => setTimeout(r, 200))
    }
    if (!page) throw new Error("no host page")

    ws = await wsConnect(new URL(page.webSocketDebuggerUrl))
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
        const t = setTimeout(() => { pending.delete(id); rej(new Error("cdp timeout " + method)) }, 8000)
        pending.set(id, (m) => { clearTimeout(t); res(m) })
        ws.send(JSON.stringify({ id, method, params }))
    })
    await cdp("Runtime.enable")

    let text = ""
    let paintAttempted = false
    while (Date.now() < deadline) {
        const msg = await cdp("Runtime.evaluate", {
            expression: "document.getElementById('out')?.textContent || ''",
            returnByValue: true,
        })
        text = msg.result?.result?.value || ""
        if (text.includes("PAINT_READY") && !paintAttempted) {
            paintAttempted = true
            const box = await cdp("Runtime.evaluate", {
                expression: "(() => { const r = document.getElementById('c').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 } })()",
                returnByValue: true,
            })
            const clip = box.result?.result?.value
            const before = await cdp("Page.captureScreenshot", { format: "png", clip })
            const action = await cdp("Runtime.evaluate", {
                expression: "window.runProposalWitness()",
                awaitPromise: true,
                returnByValue: true,
            })
            if (action.result?.exceptionDetails || action.result?.result?.value !== true)
                throw new Error("proposal witness failed")
            const after = await cdp("Page.captureScreenshot", { format: "png", clip })
            const painted = typeof before.result?.data === "string" && typeof after.result?.data === "string"
                && before.result.data !== after.result.data
            await cdp("Runtime.evaluate", {
                expression: `window.finishProposalWitness(${painted})`,
                returnByValue: true,
            })
        }
        if (text.includes("DONE") || text.includes("FAIL ")) break
        await new Promise((r) => setTimeout(r, 200))
    }
    console.log(text.trim())
    const missing = ["bad:", "badline:1", "ok:", "rej:world disposed", "beats:", "scored:true", "quiet:true", "morph:", "morphok:true", "nest:", "nestok:true", "laws:", "lawsok:true", "pendingdispose:true", "interactionok:true:lifecycle:true:position:true:watchers:true:dispose-delivery:true:finite-refusal:true:headed:true:rotator:true:observer:true:scalar:true:pointer:true", "proposalRendered:true", "sourceValues:true:vectors:true", "surfaceok:true", "walkingReads:true", "hostTruth:true", "viewok:true", "framePathsok:true", "DONE"].filter((n) => !text.includes(n))
    if (text.includes("FAIL ") || text.includes("bad:accepted") || missing.length)
        throw new Error("runtime door failed: " + missing.join(", "))
    // A non-prevented synthetic event cannot prove scrolling. Drive the packed
    // runtime with trusted wheels, checking camera and page independently.
    // (id:host-input-wheel)
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
    const inspect = async expression => {
        const reply = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
        if (reply.error || reply.result?.exceptionDetails)
            throw new Error('wheel fixture: ' + JSON.stringify(reply.error ?? reply.result.exceptionDetails))
        return reply.result?.result?.value
    }
    const demand = (condition, message) => { if (!condition) throw new Error('wheel policy: ' + message) }
    await cdp('Page.enable')
    await cdp('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 2, mobile: false })
    await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/wheel.html` })
    await pause(150)
    const wheelDeadline = Date.now() + 10000
    while (!(await inspect('window.wheelReady === true'))) {
        const error = await inspect('window.wheelError')
        if (error) throw new Error(error)
        demand(Date.now() < wheelDeadline, 'fixture did not become ready')
        await pause(50)
    }
    const wheelRead = () => inspect('window.wheelState()')
    const records = []
    for (const [name, modifiers, scrolls, moves, heldControl = false] of [
        ['modifier', 0, true, false], ['modifier', 2, false, true],
        ['modifier', 2, false, true, true],
        ['modifier', 4, false, true], ['none', 0, true, false],
        ['default', 0, false, true],
    ]) {
        await inspect('scrollTo(0, 100)')
        await pause(150)
        const before = await wheelRead()
        demand(before.y === 100, 'scroll control must start away from either page edge')
        const point = await inspect(`(() => { const r = document.getElementById('${name}').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2} })()`)
        demand(await inspect(`document.elementFromPoint(${point.x}, ${point.y})?.id === '${name}'`),
            `${name}/${modifiers}: wheel target must be the intended canvas`)
        await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
        await pause(50)
        // ctrlKey alone takes the native pinch branch; a held key has its own
        // document-level lifecycle. Exercise both, releasing even on failure.
        let dispatchFailed = false
        try {
            if (heldControl) await cdp('Input.dispatchKeyEvent', {
                type: 'keyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2,
            })
            await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: 120, modifiers })
        } catch (error) {
            dispatchFailed = true
            throw error
        } finally {
            if (heldControl) await cdp('Input.dispatchKeyEvent', {
                type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 0,
            }).catch(error => { if (!dispatchFailed) throw error })
        }
        await pause(450)
        const after = await wheelRead()
        demand(scrolls ? after.y > before.y : after.y === before.y,
            `${name}/${modifiers}: page scrolling ${before.y}→${after.y}, expected=${scrolls}`)
        demand((after.views[name] !== before.views[name]) === moves,
            `${name}/${modifiers}: camera mapping moved=${after.views[name] !== before.views[name]}, expected=${moves}`)
        for (const sibling of Object.keys(before.views).filter(key => key !== name))
            demand(after.views[sibling] === before.views[sibling], `${name}/${modifiers}: sibling ${sibling} moved`)
        demand(after.dpr === before.dpr && after.scale === before.scale, `${name}/${modifiers}: unexpected browser zoom`)
        const delivered = after.events.slice(before.events.length)
        demand(delivered.length === 1 && delivered[0].trusted && delivered[0].target === name,
            `${name}/${modifiers}: page delivery ${JSON.stringify({ before: before.events, after: after.events })}`)
        records.push({ name, modifiers, heldControl, fromY: before.y, toY: after.y, cameraMoved: moves })
    }
    await inspect("window.wheelWorlds.modifier.dispose()")
    await inspect('scrollTo(0, 100)')
    await pause(150)
    const retired = await wheelRead()
    demand(await inspect("document.elementFromPoint(320, 100)?.id === 'modifier'"), 'disposal wheel target')
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 320, y: 100 })
    await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 320, y: 100, deltaX: 0, deltaY: 120 })
    await pause(450)
    const afterRetire = await wheelRead()
    demand(afterRetire.y > retired.y && afterRetire.views.modifier === null, 'disposed controls must release the wheel')
    demand(afterRetire.views.default === retired.views.default && afterRetire.views.none === retired.views.none,
        'disposal and later wheel must not affect siblings')
    // Wheel policy must not disable other camera gestures.
    const beforePan = await wheelRead()
    demand(await inspect("document.elementFromPoint(520, 100)?.id === 'none'"), 'pan target')
    for (const [type, x, y, buttons] of [
        ['mousePressed', 520, 100, 1], ['mouseMoved', 550, 120, 1], ['mouseReleased', 550, 120, 0],
    ]) await cdp('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 })
    await pause(1000)
    const afterPan = await wheelRead()
    demand(afterPan.views.none !== beforePan.views.none, 'none must retain native pan')
    demand(afterPan.y === beforePan.y, 'native pan must not scroll the page')
    await inspect('Object.values(window.wheelWorlds).forEach(world => world.dispose())')
    console.log('wheelPolicy:' + JSON.stringify(records))
    console.log('wheelPolicyok:true:pan:true:dispose:true')
    console.log("runtime door ok")
} finally {
    ws?.close()
    chrome.kill()
}
