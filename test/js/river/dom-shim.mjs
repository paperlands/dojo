// Minimal DOM for the river's paint. Enough of Element for atoms.js and
// paint.js: classes, dataset, children, compound selectors. No layout, no CSS.
//
// Why real DOM shape and not a fake mutator: the swap's whole law is that the
// trunk's ELEMENTS survive it, and only an element tree can be asked that.

class El {
    constructor(tag = "div") {
        this.tagName = tag.toUpperCase()
        this.children = []
        this.parentNode = null
        this.dataset = {}
        this.textContent = ""
        this.style = {
            _p: new Map(),
            setProperty(k, v) { this._p.set(k, v) },
            getPropertyValue(k) { return this._p.get(k) ?? "" },
            removeProperty(k) { this._p.delete(k) },
        }
        this._attrs = new Map()
        this._classes = new Set()

        const self = this
        this.classList = {
            add: (...c) => c.forEach((x) => self._classes.add(x)),
            remove: (...c) => c.forEach((x) => self._classes.delete(x)),
            contains: (c) => self._classes.has(c),
            toggle: (c, on) =>
                on === undefined
                    ? (self._classes.has(c) ? self._classes.delete(c) : self._classes.add(c))
                    : on
                      ? self._classes.add(c)
                      : self._classes.delete(c),
        }
    }

    get className() { return [...this._classes].join(" ") }
    set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)) }

    setAttribute(k, v) { this._attrs.set(k, String(v)) }
    getAttribute(k) { return this._attrs.get(k) ?? null }

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
    insertBefore(child, ref) {
        child.parentNode?.removeChild(child)
        const i = this.children.indexOf(ref)
        child.parentNode = this
        if (i === -1) this.children.push(child)
        else this.children.splice(i, 0, child)
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
    replaceWith(next) {
        const p = this.parentNode
        if (!p) return
        const i = p.children.indexOf(this)
        next.parentNode?.removeChild(next)
        next.parentNode = p
        p.children[i] = next
        this.parentNode = null
    }

    matches(sel) {
        const { classes, attrs } = compound(sel)
        return (
            classes.every((c) => this._classes.has(c)) &&
            attrs.every(([k, v]) => (v == null ? this.dataset[k] != null : this.dataset[k] === v))
        )
    }

    querySelector(sel) {
        for (const c of this.children) {
            if (c.matches(sel)) return c
            const deep = c.querySelector(sel)
            if (deep) return deep
        }
        return null
    }

    querySelectorAll(sel) {
        const out = []
        for (const c of this.children) {
            if (c.matches(sel)) out.push(c)
            out.push(...c.querySelectorAll(sel))
        }
        return out
    }
}

// One compound selector: .a.b[data-x="y"][data-z]. No combinators — the
// river's paint never reaches across a descendant boundary in one query.
function compound(sel) {
    const classes = [...sel.matchAll(/\.([\w-]+)/g)].map((m) => m[1])
    const attrs = [...sel.matchAll(/\[data-([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => [
        camel(m[1]),
        m[2],
    ])
    return { classes, attrs }
}

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

/** Install a document global; returns an uninstall thunk. */
export function installDom() {
    const prev = globalThis.document
    globalThis.document = { createElement: (tag) => new El(tag) }
    return () => { globalThis.document = prev }
}

export function makeEl(tag = "div") { return new El(tag) }
