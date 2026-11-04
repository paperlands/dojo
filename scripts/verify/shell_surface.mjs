// Verify the actual shell's layout contract after host-surface changes.
import assert from 'node:assert/strict'
import { chromium } from '../vendor/node_modules/@playwright/test/index.mjs'

const base = process.argv[2] ?? 'http://localhost:4000'
const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    headless: true,
    args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
})
try {
    for (const [viewport, deviceScaleFactor] of [
        [{ width: 1200, height: 800 }, 2],
        [{ width: 390, height: 844 }, 1],
    ]) {
        const context = await browser.newContext({ viewport, deviceScaleFactor })
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.goto(new URL('/shell?perf=1', base).href)
        await page.waitForFunction(() => !!window.__probe)
        for (const size of [viewport, { width: 721, height: 503 }]) {
            await page.setViewportSize(size)
            await page.waitForFunction(() => {
                const canvas = document.getElementById('core-canvas')
                const box = canvas.getBoundingClientRect()
                const dpr = Math.min(devicePixelRatio || 1, 2)
                const center = window.__probe.project([0, 0, 0])
                return box.left === 0 && box.top === 0 && box.width === innerWidth && box.height === innerHeight
                    && canvas.width === Math.floor(innerWidth * dpr) && canvas.height === Math.floor(innerHeight * dpr)
                    && center && Math.abs(center.x - innerWidth / 2) < 0.5 && Math.abs(center.y - innerHeight / 2) < 0.5
            }, null, { timeout: 5000 })
            assert.deepEqual(errors, [], 'shell must mount without browser errors')
            console.log(`shell surface centered: ${size.width}x${size.height}, DPR ${deviceScaleFactor}`)
        }
        await context.close()
    }
} finally {
    await browser.close()
}
