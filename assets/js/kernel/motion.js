// Motion idioms (browser is not obliged to animate):
//   pulse  — reflow-read restart
//   whenDone — animationend or ms fallback (never stuck forever)

/**
 * Restart a one-shot animation. Reflow read is the function.
 * @param {HTMLElement} el
 * @param {string} cls
 */
export function pulse(el, cls) {
    el.classList.remove(cls)
    void el.offsetWidth
    el.classList.add(cls)
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
