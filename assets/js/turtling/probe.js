// A READ port and a POKE — never a resolution path.
//
// The problem: gw-t-dom-registry forbids dunders as a way to FIND the turtle;
// play needs a way to ASK it (id:codex-play-eyes). Nothing in assets/ may
// import this file. Opt-in only (`?perf=1` in the shell).

export function attachProbe(turtle, law, { authoredOf } = {}) {
    window.__probe = {
        read: () => {
            const sch = turtle.scheduler
            const focus = turtle.focus
            const compositor = turtle.compositor
            const ambients = []
            if (sch?.registry) {
                for (const [id, ambient] of sch.registry) {
                    if (ambient === sch.root) continue
                    ambients.push({
                        id,
                        address: ambient.address ?? null,
                        name: ambient.name ?? null,
                        isLens: !!ambient.isLens,
                        done: !!ambient.done,
                        transform: snapSE3(ambient.transform?.deref?.() ?? ambient.transform),
                        origin: snapSE3(ambient.origin),
                    })
                }
            }
            return {
                children:   [...(sch?.root.children.keys() ?? [])],
                kindled:    focus?.kindled ?? null,
                warm:       focus?.warm ?? [],
                authored:   authoredOf?.() ?? null,
                mine:       turtle._hatchMine,
                lastHatchAt:      turtle._lastHatchAt,
                lastReflectChange: turtle._lastReflectChange,
                ambients,
                layers: compositor?.probeLayers?.() ?? [],
                order: {
                    coreshell: law?.orderOf?.("coreshell") ?? null,
                    outershell: law?.orderOf?.("outershell") ?? null,
                },
            }
        },
        law,
        // Pure-shape seating poke for live-shell tests.
        seat: (addr, { name, doc, own = false, place, attention = null } = {}) => {
            const ans = law.observe(addr, { name, doc, own, place, attention })
            return {
                light: ans.light,
                gone: ans.gone,
                runs: (ans.runs ?? []).map((r) => ({ slot: r.slot, name: r.name, code: (r.code ?? "").slice(0, 40) })),
                hatch: ans.hatch,
                main: ans.main,
            }
        },
        // Apply a law answer to the canvas (gone → runs → light) — seat a known
        // peer figure without a server hatch. Same order as inner's perform,
        // through the same one light writer.
        paint: (ans, { witness = "self" } = {}) => {
            for (const key of ans.gone ?? []) turtle.removeAmbient(key)
            for (const r of ans.runs ?? []) {
                turtle.upsertAmbient(r.slot, r.name, r.code, {
                    hatch: false,
                    vocab: r.vocab ?? null,
                    nodes: r.nodes ?? null,
                    vocabNodes: r.vocabNodes ?? null,
                })
            }
            turtle.light(ans.light)
            if (ans.hatch != null) turtle.reflectGate?.(ans.hatch, { witness })
            return window.__probe.read()
        },
    }
    return () => { delete window.__probe }
}

function snapSE3(t) {
    if (!t) return null
    const p = t.position
    const r = t.rotation
    if (!p) return null
    return {
        pos: Array.isArray(p) ? [...p] : [p.x ?? p[0], p.y ?? p[1], p.z ?? p[2]],
        rot: r ? { w: r.w, x: r.x, y: r.y, z: r.z } : null,
    }
}
