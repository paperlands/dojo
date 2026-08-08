// Minimal DOM for HUD-shaped tests. Enough of Element for nerve/hud.js and
// nerve/seat.js: classes, text, children, listeners. No layout, no CSS.
//
// Why real DOM shape and not a fake mutator: the seat's law is *what stands in
// the slot*, and only the real element tree can be asked that.

class El {
    constructor(tag = 'div') {
        this.tagName = tag
        this.children = []
        this.parentNode = null
        this.style = { setProperty() {}, removeProperty() {} }
        this.textContent = ''
        this.offsetWidth = 0
        this._classes = new Set()
        this._listeners = new Map()

        const self = this
        this.classList = {
            add: (...c) => c.forEach((x) => self._classes.add(x)),
            remove: (...c) => c.forEach((x) => self._classes.delete(x)),
            contains: (c) => self._classes.has(c),
            toggle: (c, on) => (on ? self._classes.add(c) : self._classes.delete(c)),
        }
    }

    get className() { return [...this._classes].join(' ') }
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)) }

    get innerHTML() { return '' }
    set innerHTML(_v) { this.children.forEach((c) => { c.parentNode = null }); this.children = [] }

    appendChild(child) {
        child.parentNode?.removeChild(child)
        child.parentNode = this
        this.children.push(child)
        return child
    }
    prepend(child) {
        child.parentNode?.removeChild(child)
        child.parentNode = this
        this.children.unshift(child)
        return child
    }
    replaceChildren(...kids) {
        this.children.forEach((c) => { c.parentNode = null })
        this.children = []
        kids.forEach((k) => this.appendChild(k))
    }
    removeChild(child) {
        const i = this.children.indexOf(child)
        if (i !== -1) this.children.splice(i, 1)
        child.parentNode = null
        return child
    }
    remove() { this.parentNode?.removeChild(this) }

    contains(node) {
        if (node === this) return true
        return this.children.some((c) => c.contains(node))
    }

    querySelector(sel) {
        const want = sel.replace(/^\./, '')
        for (const c of this.children) {
            if (c._classes.has(want)) return c
            const deep = c.querySelector(sel)
            if (deep) return deep
        }
        return null
    }

    addEventListener(name, fn) {
        if (!this._listeners.has(name)) this._listeners.set(name, [])
        this._listeners.get(name).push(fn)
    }
    removeEventListener(name, fn) {
        const fns = this._listeners.get(name)
        if (fns) this._listeners.set(name, fns.filter((f) => f !== fn))
    }
    dispatch(name, ev = {}) {
        for (const fn of this._listeners.get(name) ?? []) fn({ target: this, ...ev })
    }
}

/** Install a document global; returns an uninstall thunk. */
export function installDom() {
    const prev = globalThis.document
    globalThis.document = {
        createElement: (tag) => new El(tag),
        addEventListener() {},
        removeEventListener() {},
    }
    return () => { globalThis.document = prev }
}

export function makeEl(tag = 'div') { return new El(tag) }

/** What the status slot currently SHOWS: its text, or null when empty. */
export function seatText(container) {
    const zone = container.children.find((c) => c._classes.has('nerve-hud-status'))
    const slot = zone?.children[0]
    if (!slot) return null
    const msg = slot.querySelector('.nerve-msg')
    return msg ? msg.textContent : null
}

/** The count standing beside the sentence, or null. */
export function seatTally(container) {
    const zone = container.children.find((c) => c._classes.has('nerve-hud-status'))
    const tally = zone?.children[0]?.querySelector('.nerve-tally')
    return tally ? tally.textContent : null
}

/** What is on its way out of the seat, still dissolving behind what stands. */
export function seatGhosts(container) {
    const zone = container.children.find((c) => c._classes.has('nerve-hud-status'))
    return (zone?.children ?? []).filter((c) => c._classes.has('nerve-part'))
}

/** Which channel css the slot wears — 'nerve-error' | 'nerve-helios' | … */
export function seatKind(container) {
    const zone = container.children.find((c) => c._classes.has('nerve-hud-status'))
    const slot = zone?.children[0]
    if (!slot) return null
    return [...slot._classes].find((c) => c.startsWith('nerve-') && c !== 'nerve-hud-status-line') ?? null
}
