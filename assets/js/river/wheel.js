// The meridian — the sun is pinned; the river slides beneath (id:kr-meridian).
//
// PRIMARY: drag-to-pan. Secondary: wheel step / restAt (instant detent).
// Chrome (onCenter) tracks the sun mid-motion; setValue waits for onSettle.
//
//   onCenter — nearest seat changed (caption, corners) — never setValue
//   onSettle — drum still — stand or restore once

import { nearness, shadeOf } from "./light.js"

/** Quiet after the last non-drag scroll before we trust the rest (ms). */
export const SETTLE_MS = 96

/** Pointer travel before a press counts as a pan (not a tap). */
export const DRAG_PX = 5

/**
 * @param {HTMLElement} rail
 * @param {{
 *   onCenter?: (at: {key: string, id: string|null} | null) => void,
 *   onSettle?: (at: {key: string, id: string|null} | null) => void,
 * }} [hooks]
 */
export function mountWheel(rail, { onCenter, onSettle } = {}) {
    let centered = null
    /** Last key committed to onSettle — skip re-standing the same rest. */
    let settled = undefined
    let queued = false
    let dead = false
    let owed = null
    /** @type {ReturnType<typeof setTimeout> | null} */
    let settleT = null

    let dragging = false
    let moved = false
    let suppressClick = false
    let pointerId = null
    let startX = 0
    let startScroll = 0
    let pressTarget = null

    function seats() {
        return [...rail.children].filter((c) => c.dataset?.key)
    }

    function skyIdOf(col) {
        return col?.querySelector?.('[data-place="sky"]')?.dataset.id ?? null
    }

    function whereOf(col) {
        if (!col) return null
        return { key: col.dataset.key, id: skyIdOf(col) }
    }

    function speakCenter(key, col) {
        if (key === centered) return
        centered = key
        onCenter?.(key == null ? null : whereOf(col))
    }

    function armSettle() {
        if (dead || dragging) return
        if (settleT != null) clearTimeout(settleT)
        settleT = setTimeout(flushSettle, SETTLE_MS)
    }

    function flushSettle() {
        if (settleT != null) {
            clearTimeout(settleT)
            settleT = null
        }
        if (dead || centered === settled) return
        settled = centered
        const col =
            centered == null
                ? null
                : seats().find((c) => c.dataset.key === centered) ?? null
        onSettle?.(centered == null ? null : whereOf(col))
    }

    function strideOf(cols) {
        if (cols.length > 1) return Math.abs(cols[1].offsetLeft - cols[0].offsetLeft)
        return cols[0]?.offsetWidth || 1
    }

    function leftOf(col) {
        return col.offsetLeft + col.offsetWidth / 2 - rail.clientWidth / 2
    }

    function clampScroll(left) {
        const cols = seats()
        if (!cols.length) return 0
        const a = leftOf(cols[0])
        const b = leftOf(cols[cols.length - 1])
        return Math.min(Math.max(a, b), Math.max(Math.min(a, b), left))
    }

    function update() {
        queued = false
        if (dead || !rail.isConnected) return
        const half = rail.clientWidth / 2
        if (half === 0) return
        if (owed !== null) return restAt(owed)

        const meridian = rail.scrollLeft + half
        const cols = seats()
        const dxs = cols.map((col) => col.offsetLeft + col.offsetWidth / 2 - meridian)
        const pitch = strideOf(cols)

        let nearest = null
        let nearestDx = Infinity
        for (let i = 0; i < cols.length; i++) {
            if (Math.abs(dxs[i]) < Math.abs(nearestDx)) {
                nearestDx = dxs[i]
                nearest = cols[i]
            }
        }

        for (let i = 0; i < cols.length; i++) {
            const col = cols[i]
            const { dim } = shadeOf(Math.abs(dxs[i]) / half)
            col.style.setProperty("--dim", dim.toFixed(3))
            col.style.setProperty("--near", nearness(dxs[i], pitch).toFixed(3))
            col.classList.toggle("noon", col === nearest)
        }

        speakCenter(nearest?.dataset.key ?? null, nearest)
        if (!dragging) armSettle()
    }

    function tick() {
        if (queued || dead) return
        queued = true
        requestAnimationFrame(update)
    }

    /** Seat a column under the sun (instant). Default: east-most / present. */
    function restAt(key) {
        if (dead) return
        if (rail.clientWidth === 0) {
            owed = key ?? ""
            return
        }
        owed = null
        const cols = seats()
        const want = (key && cols.find((c) => c.dataset.key === key)) || cols[cols.length - 1]
        if (!want) {
            speakCenter(null, null)
            flushSettle()
            return
        }
        rail.scrollLeft = leftOf(want)
        update()
        flushSettle()
    }

    function step(dir) {
        const cols = seats()
        const here = cols.findIndex((c) => c.dataset.key === centered)
        const want = cols[Math.min(cols.length - 1, Math.max(0, here + dir))]
        if (want && want.dataset.key !== centered) restAt(want.dataset.key)
    }

    // Capture only after DRAG_PX so a tap still produces a clean click/seat.

    function onPointerDown(e) {
        if (dead || e.button !== 0) return
        if (e.target?.closest?.("[data-message], input, textarea, button, a")) return

        dragging = true
        moved = false
        pointerId = e.pointerId
        startX = e.clientX
        startScroll = rail.scrollLeft
        pressTarget = e.target
        if (settleT != null) {
            clearTimeout(settleT)
            settleT = null
        }
    }

    function beginPan(e) {
        if (moved) return
        moved = true
        rail.classList.add("is-dragging")
        try {
            rail.setPointerCapture?.(e.pointerId)
        } catch {
            /* optional */
        }
    }

    function onPointerMove(e) {
        if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return
        const dx = e.clientX - startX
        if (!moved && Math.abs(dx) >= DRAG_PX) beginPan(e)
        if (!moved) return

        rail.scrollLeft = clampScroll(startScroll - dx)
        if (!queued) {
            queued = true
            requestAnimationFrame(() => {
                queued = false
                if (!dead && dragging) update()
            })
        }
        if (e.cancelable) e.preventDefault()
    }

    function endDrag(e) {
        if (!dragging) return
        if (pointerId != null && e?.pointerId != null && e.pointerId !== pointerId) return

        const wasMoved = moved
        const target = pressTarget
        dragging = false
        moved = false
        pointerId = null
        pressTarget = null
        rail.classList.remove("is-dragging")
        try {
            if (e?.pointerId != null) rail.releasePointerCapture?.(e.pointerId)
        } catch {
            /* already released */
        }

        if (!wasMoved) {
            // Tap → seat the pressed keep. Water is left for the river click (swap).
            const col = target?.closest?.(".river-col")
            if (col?.dataset.key && !target?.closest?.(".river-water")) restAt(col.dataset.key)
            return
        }

        suppressClick = true
        if (centered) restAt(centered)
        else {
            update()
            flushSettle()
        }
    }

    function onClickCapture(e) {
        if (!suppressClick) return
        suppressClick = false
        e.preventDefault()
        e.stopPropagation()
    }

    const onScrollEnd = () => {
        if (dead || dragging) return
        update()
        flushSettle()
    }

    let turning = 0
    const onWheel = (e) => {
        const push = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        if (!push) return
        e.preventDefault()
        const now = e.timeStamp || Date.now()
        if (now - turning < 200) return
        turning = now
        step(push > 0 ? 1 : -1)
    }

    rail.addEventListener("scroll", tick, { passive: true })
    rail.addEventListener("scrollend", onScrollEnd)
    rail.addEventListener("wheel", onWheel, { passive: false })
    rail.addEventListener("pointerdown", onPointerDown)
    rail.addEventListener("pointermove", onPointerMove)
    rail.addEventListener("pointerup", endDrag)
    rail.addEventListener("pointercancel", endDrag)
    rail.addEventListener("lostpointercapture", endDrag)
    rail.addEventListener("click", onClickCapture, true)

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(tick) : null
    ro?.observe(rail)

    return {
        update: tick,
        restAt,
        step,
        flushSettle,
        release() {
            dead = true
            if (settleT != null) clearTimeout(settleT)
            settleT = null
            rail.classList.remove("is-dragging")
            rail.removeEventListener("scroll", tick)
            rail.removeEventListener("scrollend", onScrollEnd)
            rail.removeEventListener("wheel", onWheel)
            rail.removeEventListener("pointerdown", onPointerDown)
            rail.removeEventListener("pointermove", onPointerMove)
            rail.removeEventListener("pointerup", endDrag)
            rail.removeEventListener("pointercancel", endDrag)
            rail.removeEventListener("lostpointercapture", endDrag)
            rail.removeEventListener("click", onClickCapture, true)
            ro?.disconnect()
        },
    }
}
