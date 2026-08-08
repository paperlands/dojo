// =============================================================================
// WEAVE — the walk surface (shell/weave, id:weave-tending).
//
// COLLAPSED: the weave owns no panel, no page renderer, no posture. A
// fragment page is a DOCUMENT — fetched as static text (weave/fragments.js),
// pressed to a literate buffer (weave/parse.js), parsed by the one parser —
// then the OUTERSHELL is invoked (seeWeave → seeOuterShell), the one review
// surface for another's source. The library is a non-live friend: page in
// the outer viewer, figure through inner's seeOuterShell, fork and close
// inherited. Appearance-in-PLACE has one center.
//
// What remains HERE is only what did not exist: the resolver's scope law
// (weave/resolve.js) wired to portals, and the HEARTH — the walk trail,
// amber shanshui. The hook root IS the path.
// =============================================================================

import { fetchFragment, fragmentIndex } from "../../weave/fragments.js"
import { transpile } from "../../weave/parse.js"
import { resolve, parseAddress } from "../../weave/resolve.js"
import { parseProgram } from "../../turtling/parse.js"
import { diagnostics } from "../../weave/queries.js"
import { signals as S } from "../../nerve/store.js"
import { revealAmbient, registerNavigator } from "../../nerve/reveal.js"
import { getStage } from "../../turtling/stage-cell.js"
import { nerve as seatedNerve } from "../nerve.js"
import { createArena } from "../../kernel/arena.js"

export const weave = {
    events: [],
    mount: mountWeave,
}

const TRAIL_MAX = 12
// The corpus doorway (codex/child.org) — the seed step on an empty path.
const DOORWAY = "the-chase"

function mountWeave(hook, boot = {}) {
    // One lifetime — every organ registers its release here; async
    // continuations ask the same liveness (kernel/arena.js; hook adopts it).
    const arena = createArena()
    const trailEl = hook.el
    const stage = () => boot.turtle ?? getStage()
    const nerve = () => boot.nerve ?? seatedNerve()
    // Who walks — source of every walk signal (kind carries 'walk'; source
    // is the walker: keep's prefix law, per-source FIFO).
    const walker = () => boot.walker ?? "?"

    // The address the child stands at — the newest fragment step's target.
    let hereAddr = null
    // Only a NEWER open cancels an older one; a dead surface is answered by the
    // arena, so the epoch does not have to say death too.
    let openEpoch = 0

    // Hearth projection of walk signals — derived at emit time, capped.
    const trail = []

    // The child's own making only — library figures mount under ~/ and are not
    // in the ambient shadow tier (one ambient address, D006: key is identity).
    function ambientNames() {
        const children = stage()?.scheduler?.root?.children
        if (!children) return []
        const names = []
        for (const [key, child] of children) {
            if (typeof key === "string" && parseAddress(key).owner === "~") continue
            if (child.name) names.push(child.name)
        }
        return names
    }

    function emitWalk(from, to, ref = null, walkKind = null) {
        // Local store only — no adapter carries walk to the socket.
        const sig = S.walk(walker(), from, to, ref)
        nerve()?.push(sig)
        trail.unshift({ ...sig, walkKind })
        if (trail.length > TRAIL_MAX) trail.length = TRAIL_MAX
        renderTrail()
    }

    function renderTrail() {
        trailEl.replaceChildren()

        // An empty path seeds one step naming the doorway — an empty screen
        // is an invitation to act.
        if (trail.length === 0) {
            const li = document.createElement("span")
            li.className = "weave-trail-step"
            li.style.setProperty("--trail-heat", "0.5")
            li.textContent = "getting started"
            li.title = "the first walk"
            li.addEventListener("click", () => openPage(DOORWAY))
            trailEl.appendChild(li)
            return
        }

        for (let i = 0; i < trail.length; i++) {
            const step = trail[i]
            const li = document.createElement("span")
            li.className = "weave-trail-step"
            if (step.walkKind === "unborn") li.classList.add("weave-unborn")
            const heat = Math.max(0.25, 1 - i / TRAIL_MAX)
            li.style.setProperty("--trail-heat", String(heat))
            if (i === 0) li.classList.add("weave-trail-kindled")
            const label = step.target ?? step.msg ?? "?"
            li.textContent = typeof label === "string"
                ? label.replace(/^~\//, "")
                : String(label)
            li.title = step.target ?? ""
            li.addEventListener("click", () => {
                const dest = step.target
                if (typeof dest !== "string" || !dest) return
                if (step.walkKind === "ambient") {
                    revealAmbient(dest)
                    return
                }
                if (step.walkKind === "unborn") return
                const { owner, name } = parseAddress(dest)
                if (owner === "~") {
                    openPage(name)
                    return
                }
                if (step.ref?.id) {
                    fragmentIndex().then((idx) => {
                        if (!arena.alive) return
                        const hit = idx?.[step.ref.id]
                        if (hit) openPage(hit.name, { id: step.ref.id, title: hit.title })
                    })
                }
            })
            trailEl.appendChild(li)
        }
    }

    // The scope law, wired to every portal — including the editor's and the
    // outer viewer's lit links, which land here through the navigator cell
    // when no ambient answers (nerve/reveal.js).
    async function followPortal(word) {
        if (!arena.alive) return
        const index = await fragmentIndex()
        if (!arena.alive) return

        const r = resolve(word, { ambients: ambientNames(), index })
        const to = r.kind === "fragment" ? `~/${r.name}`
            : r.kind === "ambient" ? r.name
            : word
        const ref = r.kind === "fragment" ? { id: r.id } : null

        // Emit BEFORE the move — the trail is the residue of intention.
        // An unborn word leaves a gold step: the invitation, kept mortal.
        emitWalk(hereAddr, to, ref, r.kind)

        if (r.kind === "ambient") revealAmbient(r.name)
        else if (r.kind === "fragment") await openPage(r.name, { id: r.id, title: r.title })
    }

    // Open a page = press the document, invoke the outershell.
    async function openPage(name, meta = {}) {
        if (!name) return
        const my = ++openEpoch
        const alive = () => my === openEpoch && arena.alive

        const text = await fetchFragment(name)
        if (!alive()) return

        if (text == null) {
            // Not (yet) born — the gold step is the whole answer.
            if (trail[0]?.target !== name) emitWalk(hereAddr, name, null, "unborn")
            return
        }

        const { id, title, source } = transpile(text)
        const ast = parseProgram(source)
        const addr = `~/${name}`
        const prev = hereAddr
        hereAddr = addr

        // Every arrival leaves a step — deep-links and the doorway included;
        // a portal-borne arrival already walked (followPortal emits first).
        if (trail[0]?.target !== addr) {
            emitWalk(prev, addr, id ? { id } : null, "fragment")
        }

        // Invoke the outershell — the one review surface: page, figure, fork,
        // close, all inherited. AST is the one representation crossing the
        // seam (inner derives cell split via phaseCells); ~/ addr is page-ness
        // — nothing rides beside the source.
        hook.pushEvent("seeWeave", {
            addr,
            name: (meta.title ?? title ?? name),
            source,
            commands: ast,
            // A shelved page can be wounded too — mis-pressed cell inks its
            // line in the viewer, addressed like any diagnostic (D022). The
            // library is a non-live friend speaking the same fields through
            // the one diagnostics query, not a raw collectErrors bag.
            diagnostics: diagnostics(ast, [], addr),
            ts: performance.now(),
        })
    }

    // Portals anywhere (editor ink, outer viewer) fall through to the scope
    // law when no ambient answers.
    arena.add(registerNavigator((word) => followPortal(word)))

    // The path shows from the first breath — seeded with the doorway.
    renderTrail()
    arena.add(() => trailEl.replaceChildren())

    // Deep-link: ?weave=spirals opens the page.
    const seed = new URLSearchParams(location.search).get("weave")
    if (seed) openPage(seed)

    return { events: {}, arena, openPage }
}
