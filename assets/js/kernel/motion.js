// Motion idioms (browser is not obliged to animate):
//   pulse  — one-shot restart, no reflow read
//   whenDone — animationend or ms fallback (never stuck forever)

/**
 * Restart NAMED one-shot animations, and nothing else.
 *
 * The old idiom (`remove`, `void el.offsetWidth`, `add`) forced a synchronous reflow per
 * call — measured as the hottest application frame while the sun walked. Web Animations
 * can restart the beat WITHOUT AN EXPLICIT LAYOUT READ (it still flushes style: the
 * measurement showed the flush is the cost, not the walk), but only if it restarts the
 * RIGHT animations: an unfiltered subtree restart clobbers unrelated finite animations
 * and CSS transitions, and even the arrival of the instrument it is meant to pulse.
 *
 * So a caller NAMES its beat: the keyframes it intends, and where they live. Everything
 * not named is left alone — including a living hold's infinite breath.
 *
 * @param {HTMLElement} el                 the element the class rides
 * @param {string} cls                     the class whose arrival is the beat
 * @param {{names: string[], within?: string|string[]|'*'}} [beat]
 *        `names` are the keyframes to restart; `within` narrows the search (a selector,
 *        a list of selectors, or '*' for the whole subtree). Omitted `beat` uses the
 *        documented reflow-read fallback: it restarts THIS CLASS's own animations,
 *        precisely, because the class scopes them — never "everything".
 */
export function pulse(el, cls, beat) {
    el.classList.add(cls)
    const names = beat?.names
    const canWAAPI = typeof el.getAnimations === "function"
    if (!names?.length || !canWAAPI) {
        el.classList.remove(cls)
        void el.offsetWidth
        el.classList.add(cls)
        return
    }
    const scopes = beat.within === "*"
        ? [el]
        : [beat.within].flat().filter(Boolean).map(sel => el.querySelector(sel)).filter(Boolean)
    const pools = scopes.length ? scopes : [el]
    for (const scope of pools) {
        const anims = beat.within === "*"
            ? scope.getAnimations({ subtree: true })
            : scope.getAnimations()
        for (const a of anims) {
            // A CSS transition has no animationName; a name we did not ask for may belong
            // to someone else's beat. Only the named keyframes restart.
            if (!a.animationName || !names.includes(a.animationName)) continue
            a.cancel()
            a.play()
        }
    }
}

/**
 * Run `done` once — animationend or after `ms`. Idempotent finish.
 * Named filter must not use `{once:true}`: another animation would spend it.
 * @param {HTMLElement} el
 * @param {{animation?: string|null, ms: number}} beat
 * @param {() => void} done
 * @returns {() => void}
 */
export function whenDone(el, { animation = null, ms }, done) {
    let over = false

    const finish = () => {
        if (over) return
        over = true
        clearTimeout(timer)
        el.removeEventListener("animationend", onEnd)
        done()
    }

    const onEnd = (e) => {
        if (animation == null || e.animationName === animation) finish()
    }

    const timer = setTimeout(finish, ms)
    el.addEventListener("animationend", onEnd)
    return finish
}

/**
 * ONE EFFECT LIFETIME for every transient that writes later. `start` supersedes
 * whatever came before and hands the newcomer a fence that answers only for its
 * own generation; `end` retires it and cancels the pending write. A completion
 * that fires after either edge writes nothing.
 *
 * This is the convention the sill reuses for its beat and its sunset, so no
 * transient owns a private generation counter. (id:outer-sill-lifetime)
 *
 * @param {(fenced: () => boolean) => (() => void) | void} begin
 *        schedule the effect; return how to cancel it
 */
export function createEffect() {
    let gen = 0
    let stop = null
    const retire = () => {
        const prior = stop
        stop = null
        prior?.()
    }
    return {
        start(begin) {
            gen += 1
            const mine = gen
            retire()
            stop = begin(() => gen === mine) ?? null
        },
        end() {
            gen += 1
            retire()
        },
    }
}
