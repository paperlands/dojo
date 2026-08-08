// Slot — one DOM atom for every nerve element. No policy (zones, priority, seat).
// Builds from a signal bag + channel; patches msg/tally. Seat owns gesture.
// Shared by seat.js and hud.js so status, chat, and log read alike.

export function statusText(signal) {
    return signal.payload != null
        ? `${signal.msg} ${signal.payload}`
        : (signal.msg ?? '')
}

export function buildSlot(signal, ch, { showSource, fade, onSourceClick }) {
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
    msg.textContent = statusText(signal)
    el.appendChild(msg)

    // Own span/colour so remaining work never reads as an alarm count.
    if (signal.tally > 1) {
        const tally = document.createElement('span')
        tally.className = 'nerve-tally'
        tally.textContent = `○ ${signal.tally}`
        el.appendChild(tally)
    }

    if (signal.ref) el.style.cursor = 'pointer'

    return el
}

// Standing slot + patch. Seat decides SAME | UPDATE | REPLACE.
export function makeSlot(signal, ch, opts) {
    const el = buildSlot(signal, ch, opts)
    const slot = {
        signal,
        ch,
        el,
        update(next) {
            slot.signal = next
            const msg = el.querySelector('.nerve-msg')
            if (msg) msg.textContent = statusText(next)
            let tally = el.querySelector('.nerve-tally')
            if (next.tally > 1) {
                if (!tally) {
                    tally = document.createElement('span')
                    tally.className = 'nerve-tally'
                    el.appendChild(tally)
                }
                tally.textContent = `○ ${next.tally}`
            } else if (tally) {
                tally.remove()
            }
        },
    }
    return slot
}

// remove → reflow → add so CSS restarts.
export function retrigger(el, cls) {
    el.classList.remove(cls)
    void el.offsetWidth
    el.classList.add(cls)
}
