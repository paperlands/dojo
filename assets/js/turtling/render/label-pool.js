// A layer's labels, pooled. (id:label-reuse)
//
// troika builds a Text's glyph geometry asynchronously: a freshly constructed
// Text draws nothing until its first sync resolves. A `label … erase` loop that
// built a new Text per label therefore destroyed built geometry on every erase
// and rebuilt it a frame or more later — a blank frame at each transition, the
// blink, and a typeset+SDF bill every cycle.
//
// So a layer keeps its Texts. Erase hides them; a later write takes the same
// one back, and its already-built geometry draws in the same frame. An
// unchanged rewrite dirties nothing, so troika's sync is a no-op and no async
// round trip stands between the old frame and the new one.
//
// The pool is bounded: an erase keeps a working set of free Texts (freeCap) and
// frees the rest, so a one-off burst of labels cannot pin its peak glyph
// geometry for the layer's life. A late sync wakes the loop only while its
// label is still visible.
//
// The Text constructor is injected so this module stays importable without the
// vendored troika bundle (which node cannot resolve: extensionless imports).

export function createLabelPool(group, opts = {}) {
    const make = opts.createText
    const font = opts.font || null
    // Free Texts kept after an erase. Bounds what reuse can pin: the blink loop
    // needs one; a one-off burst of N labels must not hold N forever.
    const freeCap = opts.freeCap ?? 64
    const pool = []      // every Text this layer has built
    let live = 0         // pool[0..live) are the labels written since the last hide
    let disposed = false

    const labels = {
        get size() { return pool.length },
        get live() { return live },

        // Write one label. A free pooled Text is reused before any is built, so
        // an identical rewrite keeps its glyph geometry instead of racing a
        // rebuild against the frame that erases it.
        write(event, requestRender) {
            if (disposed) return
            const text = pool[live] ?? grow()
            live++
            text.visible = true
            text.text = event.text
            text.fontSize = event.textSize
            text.textAlign = 'center'
            text.anchorX = 'center'
            text.anchorY = '45%'
            if (font) text.font = font
            text.position.set(event.position[0], event.position[1], event.position[2])
            text.quaternion.copy(event.rotation)
            text.color = event.color
            // troika only marks a Text dirty when a tracked value actually
            // changed; an identical rewrite never reaches its callback, so no
            // render is requested and none is needed — this frame is already it.
            text.sync(() => { if (!disposed && text.visible) requestRender?.() })
        },

        // Erase: hide, never dispose. The built geometry is what the next write
        // reuses. (id:label-reuse)
        hide() {
            for (let i = 0; i < live; i++) pool[i].visible = false
            live = 0
            // Bound what an erase leaves behind: keep a working set of free
            // Texts, free the rest, so a burst of labels cannot pin its peak
            // glyph geometry for the layer's life.
            if (pool.length > freeCap) {
                for (const text of pool.splice(freeCap)) {
                    text.removeFromParent?.()
                    disposeText(text)
                }
            }
        },

        // End of the layer's life (layer teardown / empty canvas).
        dispose() {
            if (disposed) return
            disposed = true
            for (const text of pool) {
                text.removeFromParent?.()
                disposeText(text)
            }
            pool.length = 0
            live = 0
        },
    }

    return labels

    function grow() {
        const text = make()
        text._label = true        // clear sweeps skip pooled labels and hide them
        group.add(text)
        pool.push(text)
        return text
    }

    function disposeText(text) {
        const material = text.material
        if (Array.isArray(material)) {
            for (const m of material) m.dispose?.()
        } else {
            material?.dispose?.()
        }
        text.dispose?.()          // troika: glyph geometry
    }
}
