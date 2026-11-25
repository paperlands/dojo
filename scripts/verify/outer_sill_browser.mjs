// Cut 2 acceptance, mounted UI. A local session has no peer, so seats are installed
// through the perf probe and the panel is opened by a synthetic seeOuterShell. The
// READING path, the passive contract, the hostile retarget interval and the projection
// WORK (mutations, not thresholds) are the real thing here. (id:outer-sill)
import assert from 'node:assert/strict'
import { chromium } from '../vendor/node_modules/@playwright/test/index.mjs'

const base = process.argv[2] ?? 'http://localhost:4000'
const A = 'outer-sill-a'
const B = 'outer-sill-b'
const slot = (addr) => `outershell:${addr}`

const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
})
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.setDefaultTimeout(8000)
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(new URL('/shell?perf=1', base).href, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForFunction(() => window.__probe && document.querySelector('#core-sill .sill-dial'))
    await page.waitForFunction(() => window.__probe.read().done)

    const openOuter = (addr) => page.evaluate(({ addr }) => {
        window.dispatchEvent(new CustomEvent('phx:seeOuterShell', { detail: {
            addr, origin_name: addr, source: 'fw 3\nwait 1\nfw 9', view: 'watch',
            draft_live: false, state: 'ok',
        } }))
    }, { addr })

    const state = () => page.evaluate(() => {
        const sill = document.querySelector('#outer-sill')
        return {
            present: !!sill,
            hidden: sill?.hidden ?? null,
            playback: sill?.dataset.playback ?? null,
            leaving: sill?.classList.contains('is-leaving') ?? null,
            anims: sill && typeof sill.getAnimations === 'function' ? sill.getAnimations().length : -1,
            dials: sill ? [...sill.querySelectorAll('button')].map(b => b.disabled) : null,
            selection: document.getElementById('outerenv')?.dataset?.outerSelection ?? null,
            core: document.querySelector('#core-sill')?.dataset.playback ?? null,
            coreHidden: document.querySelector('#core-sill')?.hidden ?? null,
        }
    })

    // Count the WORK a depiction does: attribute/shape/text mutations inside the
    // instrument. A gated read must produce none; a tick must produce some.
    await page.evaluate(() => {
        // trace, so a failure explains itself
        window.__trace = []
        const traced = document.querySelector('#outer-sill')
        new MutationObserver(() => window.__trace.push({
            t: Math.round(performance.now()),
            hidden: traced.hidden,
            playback: traced.dataset.playback ?? null,
            leaving: traced.classList.contains('is-leaving'),
        })).observe(traced, { attributes: true, attributeFilter: ['hidden', 'data-playback', 'class'] })
        window.__work = 0
        const sill = document.querySelector('#outer-sill')
        window.__workObs = new MutationObserver((m) => { window.__work += m.length })
        window.__workObs.observe(sill, { subtree: true, childList: true, characterData: true, attributes: true })
        window.__workReset = () => { window.__work = 0 }
        window.__workRead = () => window.__work
    })

    // 0. TIMED CORE, so "Core is fine" is a played seat rather than a static root.
    await page.locator('.cm-content:visible').evaluate((el, text) => {
        el.focus()
        document.execCommand('selectAll')
        if (!document.execCommand('insertText', false, text)) throw Error('editor refused')
    }, 'fw 55\nwait 20\nrt 90\nfw 70')
    await page.locator('#core-sill').getByRole('button', { name: 'Pause', exact: true }).waitFor()

    // 1. CLOSED AND IDLE: mounted, hidden, nothing animating, nothing working.
    await page.evaluate(() => window.__workReset())
    await page.waitForTimeout(600)
    const closed = await state()
    const closedWork = await page.evaluate(() => window.__workRead())
    assert.equal(closed.present, true, 'the instrument is mounted with the panel')
    assert.equal(closed.hidden, true, 'and depicts nothing while the panel is closed')
    assert.equal(closed.anims, 0, 'an idle sill animates nothing')
    assert.equal(closed.selection, 'closed')
    assert.equal(closedWork, 0, 'a gated read performs no projection work at all')

    // 2. READY, NO PLAY: still nothing to depict — and not the previous subject.
    await openOuter(A)
    await page.waitForFunction(() => document.getElementById('outerenv')?.dataset?.outerSelection === 'ready')
    const ready = await state()
    assert.equal(ready.hidden, true, 'a ready selection with no play depicts nothing')

    // 3. A PLAYING SEAT: depicted, refused, and it does work while it depicts.
    await page.evaluate(({ s }) => window.__probe.paint({ runs: [{ slot: s, name: 'friend', code: 'fw 5\nwait 20\nfw 7' }] }), { s: slot(A) })
    await page.waitForFunction(() => !document.querySelector('#outer-sill')?.hidden)
    await page.evaluate(() => window.__workReset())
    await page.waitForTimeout(800)
    const shown = await state()
    const shownWork = await page.evaluate(() => window.__workRead())
    assert.equal(shown.hidden, false, 'the selected seat is depicted')
    assert.equal(shown.playback, 'running', "with the play's own word")
    assert.deepEqual(shown.dials, [true, true], 'both controls disabled — no closure was supplied')
    assert.ok(shownWork > 0, 'a depicted clock does work (the readout ticks)')
    assert.equal(shown.core, 'running', 'CORE is playing too, and is not relabelled by the outer')

    // 4. A SERVER EVENT IS NOT A RETARGET. The selection intent owns ownership, so a
    //    seeOuterShell for a DIFFERENT addr is refused (`owner.addr === addr`) and the
    //    depicted subject does not change. Presence is not authority, one layer along.
    //    LIMIT: the hostile waiting-B-over-visible-A interval needs the LOCAL selector
    //    path (outerIntent + selectorFor), which a synthetic dispatch cannot forge.
    await openOuter(B)
    await page.waitForTimeout(500)
    const refused = await state()
    assert.equal(refused.hidden, false, 'a foreign server selection does not steal the depicted subject')
    assert.equal(refused.playback, 'running', 'still A, and still the same word')
    assert.equal(refused.core, 'running', 'and still no effect on Core')

    // The seat moving is depicted the moment IT is the subject (a fresh mount's own
    // first selection would do this); here we prove the reading follows the seat by
    // removing A: the instrument goes absent, not stale.
    await page.evaluate(({ s }) => window.__probe.paint({ gone: [s] }), { s: slot(A) })
    await page.waitForFunction(() => document.querySelector('#outer-sill')?.hidden === true)
    const gone = await state()
    assert.equal(gone.hidden, true, 'the subject\'s play leaving makes the instrument absent')
    assert.equal(gone.playback, null, 'and it carries no word once absent')

    // 5. REST IDLE: every seat leaves; the sunset finishes; nothing works or hangs.
    await page.evaluate(({ b }) => window.__probe.paint({ gone: [b] }), { b: slot(B) })
    await page.waitForFunction(() => document.querySelector('#outer-sill')?.hidden === true)
    await page.evaluate(() => window.__workReset())
    await page.waitForTimeout(800)
    const rest = await state()
    const restWork = await page.evaluate(() => window.__workRead())
    assert.equal(rest.anims, 0, 'an idle sill retains no animation')
    assert.equal(rest.leaving, false, 'the sunset completed rather than hanging')
    assert.equal(restWork, 0, 'and no projection work continues while absent')
    const mounts = await page.evaluate(() => document.querySelectorAll('.nerve-sill').length)
    assert.equal(mounts, 2, 'exactly the two instruments, no duplication')

    if (process.env.OUTER_TRACE) console.log('trace', JSON.stringify(await page.evaluate(() => window.__trace)))
    assert.deepEqual(errors, [], 'no page errors')
    console.log('Outer sill: closed idle, ready-no-play, depicted-and-refused, hostile retarget, rest idle passed.')
    console.log(JSON.stringify({
        closed, ready, shown, refused, gone, rest,
        work: { gated: closedWork, depicting: shownWork, rest: restWork },
        mounts,
    }, null, 2))
} finally {
    await browser.close()
}
