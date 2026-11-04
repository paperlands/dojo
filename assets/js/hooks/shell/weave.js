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
import { link } from "../../link.js"
import { stamp } from "../../utils/stamp.js"
import { outerShellPayload, dispatchPhx } from "./outer-shell-payload.js"
import { selection, requestSelection } from "./selection-intent.js"

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
    const arena = hook.arena.child()   // ownership begins at acquisition, not return
    const trailEl = hook.el
    const stage = () => boot.turtle ?? getStage()
    const nerve = () => boot.nerve ?? seatedNerve()
    // Who walks — source of every walk signal (kind carries 'walk'; source
    // is the walker: keep's prefix law, per-source FIFO).
    const walker = () => boot.walker ?? "?"

    // The address the child stands at — the newest fragment step's target.
    let hereAddr = null
    // Route epoch orders unresolved lookups only; a resolved fragment departs
    // through the owner, so ambient reveals never cancel a live fetch.
    let routeEpoch = 0
    const beginRoute = () => {
        routeEpoch++
        const controller = selection()
        return { epoch: routeEpoch, controller, owner: controller?.current?.() ?? null }
    }
    const routeAlive = (route) => {
        if (route.epoch !== routeEpoch) return false
        if (route.controller == null) return selection() == null
        if (selection() !== route.controller) return false
        return route.owner == null
            ? route.controller.current() == null
            : route.controller.owns(route.owner)
    }
    const stillOwns = (route, controller, owner) => {
        if (!arena.alive) return false
        if (controller == null) return selection() == null && route.epoch === routeEpoch
        return selection() === controller && controller.owns(owner)
    }

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
                    const route = beginRoute()
                    fragmentIndex().then((idx) => {
                        if (!arena.alive || !routeAlive(route)) return
                        const hit = idx?.[step.ref.id]
                        if (hit) openPage(hit.name, { id: step.ref.id, title: hit.title }, route)
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
        const route = beginRoute()
        const index = await fragmentIndex()
        if (!arena.alive || !routeAlive(route)) return

        const r = resolve(word, { ambients: ambientNames(), index })
        const to = r.kind === "fragment" ? `~/${r.name}`
            : r.kind === "ambient" ? r.name
            : word
        const ref = r.kind === "fragment" ? { id: r.id } : null

        // Emit BEFORE the move — the trail is the residue of intention.
        // An unborn word leaves a gold step: the invitation, kept mortal.
        emitWalk(hereAddr, to, ref, r.kind)

        if (r.kind === "ambient") revealAmbient(r.name)
        else if (r.kind === "fragment") await openPage(r.name, { id: r.id, title: r.title }, route)
    }

    // Express the subject first; press the document after its fetch.
    async function openPage(name, meta = {}, route = null) {
        if (!name) return
        const myRoute = route ?? beginRoute()
        if (!arena.alive || !routeAlive(myRoute)) return

        const addr = `~/${name}`
        const intentCell = selection()
        const selector = { addr, view: "watch", draft_live: true, follow_peer: false }
        const owner = intentCell?.open(selector) ?? null
        if (intentCell && !owner) return
        if (intentCell) dispatchPhx("outerIntent", selector)

        const text = await fetchFragment(name)
        if (!stillOwns(myRoute, intentCell, owner)) return

        if (text == null) {
            // Not (yet) born — the gold step is the whole answer.
            if (trail[0]?.target !== name) emitWalk(hereAddr, name, null, "unborn")
            return
        }

        const { id, title, source } = transpile(text)
        const ast = parseProgram(source)
        const prev = hereAddr
        hereAddr = addr

        // Every arrival leaves a step — deep-links and the doorway included;
        // a portal-borne arrival already walked (followPortal emits first).
        if (trail[0]?.target !== addr) {
            emitWalk(prev, addr, id ? { id } : null, "fragment")
        }

        // Local open (lvdx-5): outer handlers already have the pressed buffer.
        // onSeeOuterShell owns the open flag. Server is informed only — no ferry.
        // Full envelope via outerShellPayload — same keys as OuterShell.payload/2.
        const pageName = meta.title ?? title ?? name
        const diags = diagnostics(ast, [], addr)
        // `t` alone — %Turtle{time:} is an LWW key compared across hands (D008).
        const ts = stamp().t
        const payload = outerShellPayload({
            addr,
            origin_name: pageName,
            source,
            commands: ast,
            diagnostics: diags,
            state: "success",
            view: "watch",
            draft_live: true,
            time: ts,
            // path / attend / buffer_id — library has none; builder keeps keys as null
        })

        if (intentCell && !intentCell.install(owner, payload)) return
        const token = intentCell ? intentCell.supersede(addr) : null
        dispatchPhx("seeOuterShell", payload)
        if (!stillOwns(myRoute, intentCell, owner)) return

        requestSelection(
            intentCell,
            token,
            () => hook.pushEvent("seeWeave", { addr, name: pageName, source, ts }),
            (descriptor) => dispatchPhx("outerIntent", descriptor),
        )
    }

    // Portals anywhere (editor ink, outer viewer) fall through to the scope
    // law when no ambient answers.
    arena.add(registerNavigator((word) => followPortal(word)))

    // The path shows from the first breath — seeded with the doorway.
    renderTrail()
    arena.add(() => trailEl.replaceChildren())

    // Deep-link: ?weave=spirals opens the page (id:la-vocabulary).
    const seed = link.read("weave")
    if (seed) openPage(seed)

    return { events: {}, arena, openPage }
}
