// HUD — two-zone overlay + expandable log panel.
// Status zone: single slot for error/system/output.
// Chat zone: ambient slots for chat/shout/eval.
// Log: click chat → full run history; click outside → collapse.

import { CHANNELS } from './store.js'

const MAX_CHAT_SLOTS = 5
const SHOUT_THROTTLE_MS = 500

// ---------------------------------------------------------------------------
// Navigation — what happens when you click a slot. Targets resolve which
// editor/canvas a click acts on, so each nerve instance (core, outer panel)
// navigates its own surfaces. Defaults to the core shell's editor + canvas.
// ---------------------------------------------------------------------------

function resolveTargets(targets) {
    return {
        editorView: targets?.editorView || (() => document.getElementById('your-buffer')?.__cm),
        // Reveal an ambient by name: switch the editor to the tab that DEFINES it
        // (top-level tab, or the tab whose code spawned `as name do …`), then
        // focus it on the canvas. If the owning key isn't a local buffer (a remote
        // peer's addr), the tab switch is skipped and we just focus.
        revealAmbient: targets?.revealAmbient || ((name) => {
            const turtle = document.getElementById('core-canvas')?.__turtle
            if (!turtle) return
            const term = document.getElementById('your-buffer')?.__terminal
            const tabKey = turtle.tabKeyForAmbient?.(name)
            if (tabKey != null && term?.getBufferInfo?.(tabKey)) {
                term.opBufferHandler({ op: 'select', target: tabKey })
            }
            turtle.focusAmbient(name)
            turtle.requestRender?.()
        }),
    }
}

function navigate(signal, pushEvent, t) {
    const { ref, kind } = signal

    if (ref) {
        if ('key' in ref)  return pushEvent("seeTurtle", { addr: ref.key })
        if ('line' in ref) return scrollToLine(ref.line, t.editorView())
        if ('code' in ref) return pushEvent("forkBuffer", {
            source: ref.code, name: signal.source,
            addr: ref.key || null, time: Date.now()
        })
    }

    // A shout's source IS the ambient's address (display name) — reveal it:
    // jump to the tab that defines it and focus it on the canvas.
    if (kind === 'shout' && signal.source && signal.source !== 'system') {
        t.revealAmbient(signal.source)
    }
}

function scrollToLine(n, view) {
    if (!view) return
    const line = view.state.doc.line(Math.min(n, view.state.doc.lines))
    view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true })
    view.focus()
}

// ---------------------------------------------------------------------------
// Slot — the single DOM atom for all signal elements.
// ---------------------------------------------------------------------------

function buildSlot(signal, ch, { showSource, fade, onSourceClick }) {
    const el = document.createElement('div')
    el.className = `${showSource ? 'nerve-hud-msg' : 'nerve-hud-status-line'} pointer-events-auto ${ch.css}`
    if (fade) el.style.setProperty('--hud-fade', `${ch.fadeMs}ms`)
    else      el.classList.add('nerve-no-fade')

    if (showSource) {
        const src = document.createElement('span')
        src.className = 'nerve-source'
        src.textContent = signal.source
        if (onSourceClick) src.addEventListener('click', (e) => {
            e.stopPropagation()
            onSourceClick(signal)
        })
        el.appendChild(src)
    }

    const msg = document.createElement('span')
    msg.className = 'nerve-msg'
    msg.textContent = signal.payload != null
        ? `${signal.msg} ${signal.payload}`
        : signal.msg
    el.appendChild(msg)

    if (signal.ref) el.style.cursor = 'pointer'

    return el
}

// ---------------------------------------------------------------------------
// Status mutator — single slot, always replaces previous.
// ---------------------------------------------------------------------------

function statusMutator(zone) {
    let slot = null

    function set(signal, ch, nav) {
        clear()
        const el = buildSlot(signal, ch, { showSource: false, fade: true })

        if (signal.ref) {
            el.addEventListener('click', () => nav(signal))
        }

        const timer = setTimeout(() => {
            if (slot?.el === el) { el.remove(); slot = null }
        }, ch.fadeMs)

        slot = { signal, el, timer }
        zone.innerHTML = ''
        zone.appendChild(el)
    }

    function clear() {
        if (!slot) return
        clearTimeout(slot.timer)
        slot.el.remove()
        slot = null
    }

    return { set, clear }
}

// ---------------------------------------------------------------------------
// Chat mutator — multi-slot with priority eviction and per-source throttle.
// ---------------------------------------------------------------------------

function chatMutator(zone) {
    const slots = []
    const shoutTimestamps = new Map()

    function removeSlot(idx) {
        const s = slots[idx]
        if (!s) return
        clearTimeout(s.timer)
        s.el.remove()
        slots.splice(idx, 1)
    }

    function evict() {
        if (slots.length < MAX_CHAT_SLOTS) return
        let victim = 0
        for (let i = 1; i < slots.length; i++) {
            const vPri = CHANNELS[slots[victim].signal.kind]?.priority || 0
            const iPri = CHANNELS[slots[i].signal.kind]?.priority || 0
            if (iPri < vPri) victim = i
            else if (iPri === vPri && slots[i].signal.ts < slots[victim].signal.ts) victim = i
        }
        removeSlot(victim)
    }

    function add(signal, ch, nav, onExpand) {
        if (signal.kind === 'shout') {
            const now = performance.now()
            const lastTs = shoutTimestamps.get(signal.source) || 0
            if (now - lastTs < SHOUT_THROTTLE_MS) return
            shoutTimestamps.set(signal.source, now)
        }

        evict()

        const el = buildSlot(signal, ch, { showSource: true, fade: true, onSourceClick: nav })

        el.addEventListener('click', (e) => {
            if (e.target.closest('.nerve-source')) return
            onExpand()
        })

        const timer = setTimeout(() => {
            const idx = slots.findIndex(s => s.el === el)
            if (idx !== -1) removeSlot(idx)
        }, ch.fadeMs)

        el.addEventListener('animationend', (e) => {
            if (e.animationName === 'hud-fade') {
                const idx = slots.findIndex(s => s.el === el)
                if (idx !== -1) removeSlot(idx)
            }
        })

        slots.push({ signal, el, timer })
        zone.prepend(el)
    }

    function clear() {
        while (slots.length) removeSlot(0)
    }

    return { add, clear }
}

// ---------------------------------------------------------------------------
// Log mutator — scrollable run history. Toggle on click, dismiss on blur.
// ---------------------------------------------------------------------------

function logMutator(container, store, nav, select) {
    let panel = null
    let unsub = null
    let dismissHandler = null

    function logSlot(signal) {
        const ch = CHANNELS[signal.kind]
        return buildSlot(signal, ch, { showSource: true, fade: false, onSourceClick: nav })
    }

    function open() {
        if (panel) return
        panel = document.createElement('div')
        panel.className = 'nerve-log pointer-events-auto'

        const currentEpoch = store.epoch
        const chatSignals = store.signals.filter(
            s => s.epoch === currentEpoch && CHANNELS[s.kind]?.zone === 'chat' && select(s)
        )
        for (let i = chatSignals.length - 1; i >= 0; i--) {
            panel.appendChild(logSlot(chatSignals[i]))
        }

        container.appendChild(panel)
        panel.scrollTop = panel.scrollHeight

        unsub = store.subscribe((signal) => {
            if (signal.epoch !== currentEpoch) { close(); return }
            const ch = CHANNELS[signal.kind]
            if (!ch || ch.zone !== 'chat') return
            if (!select(signal)) return
            const atBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 24
            panel.appendChild(logSlot(signal))
            if (atBottom) panel.scrollTop = panel.scrollHeight
        })

        requestAnimationFrame(() => {
            dismissHandler = (e) => {
                if (!panel.contains(e.target)) close()
            }
            document.addEventListener('pointerdown', dismissHandler, true)
        })
    }

    function close() {
        if (!panel) return
        if (unsub) { unsub(); unsub = null }
        if (dismissHandler) {
            document.removeEventListener('pointerdown', dismissHandler, true)
            dismissHandler = null
        }
        panel.remove()
        panel = null
    }

    function toggle() { panel ? close() : open() }

    return { toggle, close }
}

// ---------------------------------------------------------------------------
// HUD — composes status + chat + log. Subscribes to store.
// ---------------------------------------------------------------------------

// A HUD is one read-model (projection) over the store. `opts.select(signal) →
// bool` is its routing predicate — the residual HUD takes what no panel claimed,
// a peer panel takes its claimed address. `opts.targets` scopes navigation.
export function createHUD(container, store, pushEvent, opts = {}) {
    const { targets, select = () => true } = opts

    const statusZone = document.createElement('div')
    statusZone.className = 'nerve-hud-status'
    const chatZone = document.createElement('div')
    chatZone.className = 'nerve-hud-zone nerve-hud-chat'

    container.appendChild(chatZone)
    container.appendChild(statusZone)

    const t = resolveTargets(targets)
    const nav = (signal) => navigate(signal, pushEvent, t)

    const status = statusMutator(statusZone)
    const chat = chatMutator(chatZone)
    const log = logMutator(container, store, nav, select)

    let hidden = false

    const unsub = store.subscribe((signal) => {
        if (hidden) return
        if (store.muted.has(signal.kind)) return
        if (!select(signal)) return

        const ch = CHANNELS[signal.kind]
        if (!ch || !ch.fadeMs) return

        if (ch.zone === 'status') status.set(signal, ch, nav)
        else                      chat.add(signal, ch, nav, log.toggle)
    })

    function show() { hidden = false; container.style.display = '' }
    function hide() { hidden = true; container.style.display = 'none'; status.clear(); chat.clear(); log.close() }

    function destroy() {
        unsub()
        status.clear()
        chat.clear()
        log.close()
        statusZone.remove()
        chatZone.remove()
    }

    return { show, hide, destroy }
}
