// Hot-path timers: pace / quiet / gate drop; once waits (or null).
// Hand-rolled stream timers are the failure mode.

const hold = (ms, paced) => (fn) => {
  let timer = null
  let pending = null
  let last = -Infinity

  const fire = () => {
    timer = null
    last = Date.now()
    const args = pending
    pending = null
    if (args) fn(...args)
  }

  const held = (...args) => {
    pending = args
    if (paced) {
      if (timer) return
      timer = setTimeout(fire, Math.max(0, ms - (Date.now() - last)))
    } else {
      clearTimeout(timer)
      timer = setTimeout(fire, ms)
    }
  }

  held.flush = () => {
    if (!pending) return
    clearTimeout(timer)
    timer = null
    fire()
  }

  held.cancel = () => {
    clearTimeout(timer)
    timer = null
    pending = null
  }

  return held
}

const pace = (ms) => hold(ms, true)
const quiet = (ms) => hold(ms, false)

// Side-effect memo. Key = first arg by default — never walk the payload.
const gate = (fn, keyOf = (args) => args[0]) => {
  let key
  let seen = false
  return (...args) => {
    const k = keyOf(args)
    if (seen && k === key) return
    seen = true
    key = k
    return fn(...args)
  }
}

// Next value or null. Producer is never obliged to produce (never hangs).
const once = (subscribe, ms) =>
  new Promise((resolve) => {
    let done = false
    let unsub = null
    const settle = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      unsub?.()
      resolve(value ?? null)
    }
    const timer = setTimeout(() => settle(null), ms)
    // Sync notify inside subscribe: unsub still null; release below runs.
    unsub = subscribe(settle)
    if (done) unsub?.()
  })

export const temporal = {
  pace: (fn, ms) => pace(ms)(fn),
  quiet: (fn, ms) => quiet(ms)(fn),
  gate,
  once,
}
