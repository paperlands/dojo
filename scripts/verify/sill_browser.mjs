// Exercise the live editor, compositor, and actual Helios together.
// Run against a dev server: node scripts/verify/sill_browser.mjs [base URL]
import assert from 'node:assert/strict'
import { chromium } from '../vendor/node_modules/@playwright/test/index.mjs'

const base = process.argv[2] ?? 'http://localhost:4000'
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
})

async function open(options, probe = true) {
    const page = await browser.newPage(options)
    page.setDefaultTimeout(7000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(new URL(probe ? '/shell?perf=1' : '/shell', base).href, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForFunction(probe => (!probe || window.__probe) && document.querySelector('#core-sill .sill-dial'), probe)
    return { page, errors }
}

async function edit(page, source) {
    await page.locator('.cm-content:visible').evaluate((editor, text) => {
        editor.focus()
        document.execCommand('selectAll')
        if (!document.execCommand('insertText', false, text)) throw Error('editor did not take the source')
    }, source)
}

async function verifyFinishLight(page, { reduced = false } = {}) {
    await page.waitForFunction(() => {
        const sill = document.querySelector('#core-sill[data-playback="finished"]')
        const tip = sill?.querySelector('.sill-cut')
        const winder = sill?.querySelector('.sill-winder:enabled')
        return tip && winder && getComputedStyle(tip).stroke === 'rgb(253, 230, 138)' &&
            getComputedStyle(winder).color === 'rgb(253, 230, 138)'
    })
    const tip = page.locator('#core-sill .sill-cut')
    assert.equal(await tip.evaluate(el => getComputedStyle(el).animationName),
        reduced ? 'none' : 'sill-settle', 'the finish cue only blooms when motion is allowed')
}

async function verifyBottomLayout(page, { stacked }) {
    const { empty, open, tall, closed, viewportBottom } = await page.locator('#disciple_panels').evaluate(strip => {
        const stack = document.querySelector('.core-instruments')
        const flag = document.querySelector('#pane-state')
        const read = () => ({ stack: stack.getBoundingClientRect().toJSON(), strip: strip.getBoundingClientRect().toJSON() })
        // Isolate layout from room presence; restore the live nodes and flag before yielding.
        const original = [...strip.childNodes]
        const wasOpen = flag.classList.contains('pane-open')
        const seat = document.createElement('button')
        seat.className = 'win'
        seat.dataset.disciple = ''
        try {
            flag.classList.add('pane-open')
            strip.replaceChildren()
            const empty = read()
            strip.append(seat)
            const open = read()
            seat.style.height = '150px'
            const tall = read()
            flag.classList.remove('pane-open')
            return { empty, open, tall, closed: read(), viewportBottom: innerHeight }
        } finally {
            strip.replaceChildren(...original)
            flag.classList.toggle('pane-open', wasOpen)
        }
    })
    assert.equal(empty.strip.height, 0, 'an empty strip does not occupy a row')
    assert.equal(closed.strip.height, 0, 'a closed strip does not occupy a row')
    assert.equal(empty.stack.bottom, closed.stack.bottom)
    assert.ok(viewportBottom - empty.stack.bottom <= 24, 'the stack rests near the bottom without a strip')
    assert.ok(open.stack.left > 0 && open.stack.left < open.strip.left, 'the stack stays on the left')
    assert.ok(tall.strip.height > open.strip.height)
    if (stacked) {
        assert.ok(open.stack.bottom <= open.strip.top, 'the stack clears the open strip')
        assert.equal(open.strip.top - open.stack.bottom, tall.strip.top - tall.stack.bottom,
            'the stack tracks the strip’s actual height')
    } else {
        assert.ok(open.stack.right <= open.strip.left, 'the stack fits beside the strip')
        assert.equal(open.stack.bottom, open.strip.bottom, 'wide screens share the bottom edge')
        assert.equal(open.stack.bottom, tall.stack.bottom)
    }
}

const timed = 'fw 55\nwait 3\nrt 90\nfw 70'
try {
    const { page, errors } = await open({ viewport: { width: 1440, height: 900 } })
    const sill = page.locator('#core-sill')
    const pause = sill.getByRole('button', { name: 'Pause', exact: true })
    const play = sill.getByRole('button', { name: 'Play', exact: true })
    const restart = sill.getByRole('button', { name: 'Restart from beginning' })
    // The elapsed NUMBER, not the whole cluster: the unit and the action mark
    // are siblings inside .sill-time (their SVG whitespace is not a readout).
    const clock = sill.locator('.sill-time span')
    const sun = page.locator('#nerve-hud .nerve-helios .nerve-msg')
    const count = page.locator('#nerve-hud .nerve-helios-count')
    const cut = () => page.evaluate(() => {
        const { simMs, layers } = window.__probe.read()
        return { simMs, layers }
    })
    await page.waitForFunction(() => window.__probe.read().done)
    assert.equal(await sill.isVisible(), false, 'static work does not acquire a clock')
    await edit(page, timed)
    await pause.waitFor()
    await page.locator('#core-sill .sill-dial').focus()
    await page.keyboard.press('Space')
    await play.waitFor()
    const held = await cut()
    const glyph = await sun.textContent()
    await page.waitForTimeout(950)
    assert.equal(await sun.textContent(), glyph, 'Helios holds its rung while execution is paused')
    assert.equal(await sun.evaluate(el => el.closest('.nerve-helios').classList.contains('helios-held')), true)
    assert.deepEqual(await cut(), held, 'the paused scene does not advance')
    assert.equal(await sill.locator('.sill-play').isVisible(), true, 'keyboard focus reveals the action')
    assert.match(await count.textContent(), /^\d+$/, 'the command count is a separate caption')
    assert.equal(await count.evaluate(el => getComputedStyle(el).textShadow), 'none', 'only the glyph radiates')
    assert.ok(await sill.locator('.sill-action').evaluate(el =>
        el.getBoundingClientRect().left > el.closest('.sill-time').getBoundingClientRect().right
    ), 'the action hint sits beside the elapsed number')
    const dialLayout = await sill.evaluate(el => {
        const box = selector => el.querySelector(selector).getBoundingClientRect()
        const arc = box('.sill-arc'), time = box('.sill-time')
        return {
            drift: Math.abs((arc.left + arc.right - time.left - time.right) / 2),
            gap: time.top - arc.bottom,
            hitHeight: Math.min(...[...el.querySelectorAll('button')].map(button => parseFloat(getComputedStyle(button).height))),
        }
    })
    assert.ok(dialLayout.drift < 1, 'the arc and elapsed time share a meridian')
    assert.ok(dialLayout.gap >= 0 && dialLayout.gap <= 6, 'the elapsed time sits close to the arc')
    assert.ok(dialLayout.hitHeight >= 44, 'the visual spacing does not shrink the hit targets')
    await verifyBottomLayout(page, { stacked: false })
    await restart.click()
    await play.waitFor()
    assert.equal(await restart.evaluate(el => getComputedStyle(el).animationName), 'sill-rewind',
        'accepted Restart has its own faster acknowledgement')
    assert.equal(await clock.textContent(), '0.0', 'restart from hold resets time and remains held')
    await play.click()
    await page.waitForFunction(() => window.__probe.read().done)
    const replay = sill.getByRole('button', { name: 'Replay from beginning', exact: true })
    await replay.waitFor()
    assert.equal(await sill.getAttribute('data-playback'), 'finished')
    const finalTime = await clock.textContent()
    assert.ok(parseFloat(finalTime) >= 3)
    await page.mouse.move(600, 400)
    await page.mouse.wheel(0, -110)
    await page.waitForTimeout(300)
    assert.equal(await clock.textContent(), finalTime, 'camera frames do not advance the settled clock')
    await verifyFinishLight(page)
    await page.evaluate(() => window.__probe.paint({
        runs: [{ slot: 'sill-browser-neighbour', name: 'neighbour', code: 'wait 1' }],
    }))
    await page.waitForFunction(() => {
        const sill = document.querySelector('#core-sill[data-playback="finished"]')
        const tip = sill?.querySelector('.sill-cut')
        const winder = sill?.querySelector('.sill-winder:disabled')
        return tip && winder && getComputedStyle(tip).stroke === 'rgb(253, 230, 138)' &&
            getComputedStyle(winder).filter === 'none' && getComputedStyle(winder).color !== 'rgb(253, 230, 138)'
    })
    await page.evaluate(() => window.__probe.paint({ gone: ['sill-browser-neighbour'] }))
    await replay.click()
    await pause.waitFor()
    assert.ok(parseFloat(await clock.textContent()) < 1, 'Play after settlement starts a new run')
    await pause.click()
    await edit(page, 'fw 23\nrt 45\nfw 21')
    await sill.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => window.__probe.read().done)
    // A faulted seat replays ITS source, not the healthy predecessor in the slot.
    await edit(page, 'fw 55\nwait 0.4\nfw 70')
    await replay.waitFor()
    await edit(page, 'as Kid do\n wait 0.4\n fw 1\nend\nnope')
    const stopped = sill.getByRole('button', { name: 'Execution stopped. Replay from beginning', exact: true })
    await stopped.waitFor()
    await stopped.click()
    await page.waitForFunction(() => {
        const e = document.querySelector('#core-sill')
        return !e.hidden && ['fault', 'finished'].includes(e.dataset.playback) ? e.dataset.playback : null
    })
    assert.equal(await sill.getAttribute('data-playback'), 'fault', 'replay runs the faulted source')
    await edit(page, timed)
    await pause.click()
    const single = await cut()
    // A SHARED STAGE REFUSES THE HAND; IT DOES NOT ERASE THE PLAY. Adding a second
    // seat used to hide the dial (visibility was derived from `alone`). Now the seat's
    // play is still depicted and every control that cannot act says so, and a painted
    // Replay still owns no right to the shared clock. (id:nav-core-sill)
    const shared = await page.evaluate(() => {
        const sill = document.querySelector('#core-sill')
        const winder = sill.querySelector('.sill-winder')
        const dial = sill.querySelector('.sill-dial')
        window.__probe.paint({
            runs: [{ slot: 'sill-browser-neighbour', name: 'neighbour', code: 'fw 17' }],
        })
        const before = window.__probe.read().simMs
        winder.click()
        dial.click()
        return {
            showed: !sill.hidden,
            leaving: sill.classList.contains('is-leaving'),
            playback: sill.dataset.playback ?? null,
            winderDisabled: winder.disabled,
            dialDisabled: dial.disabled,
            before,
            after: window.__probe.read().simMs,
        }
    })
    await sill.waitFor({ state: 'visible' })
    assert.equal(shared.showed, true, 'a shared stage still depicts this seat\'s play')
    assert.equal(shared.leaving, false, 'a shared stage is not an absent play')
    assert.equal(shared.playback, 'running')
    assert.equal(shared.winderDisabled, true, 'the winder cannot act when the stage is shared')
    assert.equal(shared.dialDisabled, true, 'the dial cannot hold when the stage is shared')
    assert.ok(shared.after >= shared.before, 'a refused Replay does not reset the shared clock')
    // A FINISHED SEAT BESIDE A LONGER SIBLING: completion is the play's, elapsed is the
    // stage's. The clock keeps running; the word does not. (id:outer-sill)
    const concise = await page.evaluate(async () => {
        const wait = ms => new Promise(r => setTimeout(r, ms))
        window.__probe.paint({ gone: ['sill-browser-neighbour'] })
        await wait(150)
        // A short play of our own, beside a long neighbour that keeps the stage awake.
        window.__probe.paint({ runs: [{ slot: 'sill-browser-long', name: 'long', code: 'wait 30\nfw 1' }] })
        await wait(150)
        const sill = document.querySelector('#core-sill')
        const start = window.__probe.read().simMs
        await wait(400)
        return {
            word: sill.dataset.playback ?? null,
            advanced: window.__probe.read().simMs > start,
            stageDone: !!window.__probe.read().done,
        }
    })
    assert.equal(concise.stageDone, false, 'the stage is still awake (a sibling is waiting)')
    assert.equal(concise.advanced, true, 'the stage clock keeps running')
    await page.evaluate(() => window.__probe.paint({ gone: ['sill-browser-long'] }))

    // The neighbour goes; the same node comes back to life without a sunset first.
    const alone = await page.evaluate(() => {
        const sill = document.querySelector('#core-sill')
        window.__probe.paint({ gone: ['sill-browser-neighbour'] })
        return new Promise(done => setTimeout(() => done({
            showed: !sill.hidden,
            leaving: sill.classList.contains('is-leaving'),
            winderDisabled: sill.querySelector('.sill-winder').disabled,
            dialDisabled: sill.querySelector('.sill-dial').disabled,
        }), 250))
    })
    assert.equal(alone.showed, true)
    assert.equal(alone.leaving, false, 'the play never left, so nothing sunset')
    assert.equal(alone.dialDisabled, false, 'the hand is offered the hold again')
    assert.equal(alone.winderDisabled, false)

    // PROJECTION OUTRUNS SCHEDULING. A -> B inside the quiet window publishes new
    // sources at once and re-seats through a COALESCED render. The dial must follow
    // the play that exists: never absent while one stands, never blind once the next
    // is seated. A test of the read path, not of keystroke timing. (id:nav-core-sill)
    await page.evaluate(() => {
        window.__dialSamples = []
        const sill = document.querySelector('#core-sill')
        window.__dialTimer = setInterval(() => window.__dialSamples.push({
            phase: sill.dataset.playback ?? null,
            hidden: sill.hidden,
            leaving: sill.classList.contains('is-leaving'),
        }), 20)
    })
    await edit(page, 'fw 1\nwait 0.2\nnope')   // B runs a beat, then faults: the dial must say so
    await page.waitForTimeout(600)
    const dialAcross = await page.evaluate(() => {
        clearInterval(window.__dialTimer)
        return window.__dialSamples
    })
    assert.ok(dialAcross.length > 5, 'the sampler observed the coalesced window')
    assert.equal(dialAcross.some(s => s.hidden), false, 'the projection never went absent across the reseat')
    assert.equal(dialAcross.some(s => s.leaving), false, 'and nothing sunset while a play was only replaced')
    assert.equal(dialAcross.at(-1).phase, 'fault', 'the dial sensed the new play as soon as it was seated')
    await page.waitForFunction(ms => window.__probe.read().simMs > ms, single.simMs)
    assert.deepEqual(errors, [])

    const phone = await open({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }, false)
    await phone.page.evaluate(() => { document.documentElement.dataset.theme = 'light' })
    await edit(phone.page, timed)
    const mobileSill = phone.page.locator('#core-sill')
    await mobileSill.waitFor()
    const phoneNeedle = mobileSill.locator('.sill-cut')
    const lit = await phoneNeedle.evaluate(el => ({
        stroke: getComputedStyle(el).stroke, filter: getComputedStyle(el).filter,
    }))
    const phoneSun = phone.page.locator('#nerve-hud .nerve-helios .nerve-msg')
    assert.equal(lit.stroke, await phoneSun.evaluate(el => getComputedStyle(el).color), 'one sun hue in the light theme')
    assert.notEqual(lit.filter, 'none', 'the running needle carries a tight halo')
    await verifyBottomLayout(phone.page, { stacked: true })
    await mobileSill.getByRole('button', { name: 'Pause', exact: true }).tap()
    assert.equal(await mobileSill.locator('.sill-action').isVisible(), false)
    assert.ok(await mobileSill.locator('.sill-time').isVisible())
    assert.equal(await mobileSill.evaluate(e => getComputedStyle(e).animationName), 'none')
    assert.equal(await phoneSun.evaluate(el => getComputedStyle(el).animationName), 'none')
    assert.equal(await phoneNeedle.evaluate(el => getComputedStyle(el).filter), 'none', 'the cold needle casts no halo')
    assert.notEqual(await phoneNeedle.evaluate(el => getComputedStyle(el).stroke), lit.stroke)
    await mobileSill.getByRole('button', { name: 'Play', exact: true }).tap()
    await verifyFinishLight(phone.page, { reduced: true })
    assert.deepEqual(phone.errors, [])
    console.log('Live sill: static, real Helios, hold, restart, settlement, edit and touch passed.')
} finally {
    await browser.close()
}
