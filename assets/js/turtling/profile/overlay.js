// In-browser profiler overlay — DOM panel, never touches WebGL.
//
// Quantifies the two render-layer costs the headless harness cannot see:
//   • RAF idle-spin (root cause #1): frames that do a full renderer.render()
//     while nothing is animating (scheduler.done / no ambients, not recording).
//     A high "idle fps" is the persistent-CPU smoking gun.
//   • GPU object growth (root cause #3): renderer.info geometries/textures and
//     the material cache size climbing across redraws = leak.
//
// Attach by loading /shell?perf=1, or from devtools:
//   import("/assets/js/turtling/profile/overlay.js").then(m => m.attachProfilerOverlay(document.getElementById('core-canvas').__turtle))
//
// Passive: it wraps turtle.onFrame to count frames and samples state on its own
// setInterval, so it keeps reporting even while the render loop is idle. It does
// not call requestRender(), so observing the system does not perturb it.

import { materialCacheSize } from "../materializer.js"

const FMT = (n, d = 0) => Number(n).toFixed(d)
const MB = (bytes) => FMT(bytes / 1048576, 1)

export function attachProfilerOverlay(turtle, opts = {}) {
    if (!turtle) { console.warn("[profiler] no turtle instance"); return () => {} }
    if (turtle.__profilerDetach) return turtle.__profilerDetach  // idempotent

    const sampleMs = opts.sampleMs ?? 500

    // --- Frame accounting (updated inside the wrapped onFrame) ---
    let frames = 0
    let idleFrames = 0          // full renders with nothing animating
    let lastFrameTs = 0
    let frameDtSum = 0          // ms, since last sample
    let frameDtMax = 0
    let framesSinceSample = 0
    let idleSinceSample = 0

    // A frame is "idle/wasted" if it rendered while there is nothing to animate:
    // no compositor (no ambients) or the scheduler is done, and not recording.
    const isIdleFrame = () => {
        const rec = turtle.stage?.recorder?.isRecording
        if (rec) return false
        if (!turtle.compositor) return true
        return !!turtle.scheduler?.done
    }

    // --- Wrap onFrame (instance method) to count without changing behavior ---
    const originalOnFrame = turtle.onFrame.bind(turtle)
    turtle.onFrame = (t) => {
        const dt = lastFrameTs ? (t - lastFrameTs) : 0
        lastFrameTs = t
        frames++
        framesSinceSample++
        if (dt > 0) { frameDtSum += dt; if (dt > frameDtMax) frameDtMax = dt }
        if (isIdleFrame()) { idleFrames++; idleSinceSample++ }
        return originalOnFrame(t)
    }

    // --- DOM panel ---
    const el = document.createElement("div")
el.style.cssText = [
    "position:fixed", "top:8px", "left:8px", "z-index:2147483647",
    "font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
    "color:#cde", "background:rgba(12,16,22,0.86)", "border:1px solid #2a3340",
    "border-radius:6px", "padding:8px 10px", "white-space:pre", "pointer-events:auto",
    "min-width:230px", "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
    "cursor:pointer", "user-select:none",
].join(";")
document.body.appendChild(el)

let _copyFlashTimer = null
el.addEventListener("click", () => {
    navigator.clipboard.writeText(el.dataset.raw ?? el.textContent).then(() => {
        const prev = el.style.borderColor
        el.style.borderColor = "#4caf50"
        el.style.color = "#9ef9a0"
        clearTimeout(_copyFlashTimer)
        _copyFlashTimer = setTimeout(() => {
            el.style.borderColor = prev
            el.style.color = "#cde"
        }, 600)
    })
})

const peakHeap = { v: 0 }
const sample = () => {
    const elapsed = sampleMs / 1000
    const fps = framesSinceSample / elapsed
    const idleFps = idleSinceSample / elapsed
    const avgDt = framesSinceSample ? frameDtSum / framesSinceSample : 0
    const maxDt = frameDtMax
    const loopRunning = turtle.renderLoop?.state?.animationFrameId != null
    const schedDone = turtle.scheduler ? turtle.scheduler.done : "—"
    const ambients = turtle.scheduler ? (turtle.scheduler.registry.size - 1) : 0
    const recording = !!turtle.stage?.recorder?.isRecording
    const info = turtle.stage?.renderer?.info
    const geometries = info?.memory?.geometries ?? "—"
    const textures = info?.memory?.textures ?? "—"
    const drawCalls = info?.render?.calls ?? "—"
    const programs = info?.programs?.length ?? "—"
    const matCache = (() => { try { return materialCacheSize() } catch { return "—" } })()
    const mem = performance.memory
    let heapLine = "heap:        n/a (Chrome only)"
    if (mem) {
        const used = mem.usedJSHeapSize
        if (used > peakHeap.v) peakHeap.v = used
        heapLine = `heap:        ${MB(used)} / peak ${MB(peakHeap.v)} MB`
    }
    const verdict = idleFps > 1
        ? `⚠ IDLE-SPIN ${FMT(idleFps)}/s`
        : (loopRunning ? "active" : "stopped")
    const lines = [
        `── turtle profiler ──   ${verdict}`,
        `fps:         ${FMT(fps)}  (idle ${FMT(idleFps)})`,
        `frame dt:    avg ${FMT(avgDt, 1)}  max ${FMT(maxDt, 1)} ms`,
        `RAF loop:    ${loopRunning ? "running" : "stopped"}`,
        `scheduler:   done=${schedDone}  ambients=${ambients}  rec=${recording}`,
        heapLine,
        `geometries:  ${geometries}    textures: ${textures}`,
        `draw calls:  ${drawCalls}    programs: ${programs}`,
        `mat cache:   ${matCache}`,
        `frames total:${frames}  idle:${idleFrames}`,
    ]
    el.dataset.raw = lines.join("\n")   // clipboard gets clean text
    el.textContent = lines.join("\n") + "\n  ── click to copy ──"

        framesSinceSample = 0
        idleSinceSample = 0
        frameDtSum = 0
        frameDtMax = 0
    }

    const timer = setInterval(sample, sampleMs)
    sample()

    const detach = () => {
        clearInterval(timer)
        turtle.onFrame = originalOnFrame
        el.remove()
        delete turtle.__profilerDetach
    }
    turtle.__profilerDetach = detach
    console.info("[profiler] overlay attached — call turtle.__profilerDetach() to remove")
    return detach
}
