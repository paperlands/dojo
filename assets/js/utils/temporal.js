// Core primitive: execution with state
const exec = (fn) => {
  let running = false, result;
  return async (...args) => {
    if (running) return result;
    running = true;
    try { return result = await fn(...args); }
    finally { running = false; }
  };
};

// coordinators
const delay = (ms) => (fn) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};

const interval = (ms) => (fn) => {
  let last = 0;
  return (...args) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      return fn(...args);
    }
  };
};

// A paced timer — the rate limiter the hot paths actually want. Calls fire at
// most once per `ms`, and the LAST call ALWAYS lands once the stream goes
// quiet. Neither textbook shape does both: a debounce starves under sustained
// input (a fast typist never reaches rest, so nothing draws), and a throttle
// drops the trailing call — which holds the newest state and is precisely the
// one that matters.
//
// On a per-keystroke spine, dropping the newest edit is the one failure that
// must not be possible. `pipe(exec, delay(ms))` cannot promise that: its `exec`
// guard drops the call and returns a stale cached result whenever one is in
// flight.
//
// The returned function carries .cancel() so a teardown can drop a pending
// trailing call rather than let it fire into a dead surface.
const pace = (ms) => (fn) => {
  let timer = null       // scheduled trailing call, or null when at rest
  let pending = null     // newest args seen since the last fire
  let last = -Infinity   // when we last fired

  const fire = () => {
    timer = null
    last = Date.now()
    const args = pending
    pending = null
    fn(...args)
  }

  const paced = (...args) => {
    pending = args        // the newest args always win
    if (timer) return     // a trailing call is already scheduled
    // Quiet stream → fires on the next macrotask; busy stream → at the
    // next `ms` boundary. Either way the pending args are the latest.
    timer = setTimeout(fire, Math.max(0, ms - (Date.now() - last)))
  }

  paced.cancel = () => {
    clearTimeout(timer)
    timer = null
    pending = null
  }

  return paced
}

const memo = (keyFn = JSON.stringify) => (fn) => {
  let key, result;
  return (...args) => {
    const k = keyFn(args);
    if (k !== key) {
      key = k;
      result = fn(...args);
    }
    return result;
  };
};

const once = (fn) => {
  let called = false, result;
  return (...args) => {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
};

// Composition
const pipe = (...fns) => (x) => fns.reduce((acc, fn) => fn(acc), x);

// Export
export const temporal = {
  exec,
  delay,
  interval,
  memo,
  once,
  pipe,

  // The one rate limiter for event streams: paced, with a guaranteed trailing
  // edge. Returns a function carrying .cancel().
  pace: (fn, ms) => pace(ms)(fn),

  // `memo` for side effects, where the return is discarded: DO IT ONLY WHEN IT
  // WOULD READ DIFFERENTLY. Every reader of a standing answer needs this —
  // re-drawing what is already drawn is the default failure. Keyed on the FIRST
  // argument so the rest can carry what to draw (a digest keys, diagnostics
  // draw); never on JSON.stringify, which would walk the payload on a hot path.
  //
  // Suppresses by SAMENESS, where pace suppresses by RATE. They compose and
  // neither implies the other.
  gate: (fn, keyOf = (args) => args[0]) => memo(keyOf)(fn),

  // NOTE: these still compose through `exec`, which returns a stale cached
  // result and drops the call when one is in flight. Fine for the one-shot
  // shapes; do not reach for `throttle` on a stream where the newest value
  // matters — that is what `pace` is for.
  throttle: (fn, ms) => pipe(exec, interval(ms))(fn),
  debounceOnce: (fn, ms) => pipe(exec, once, delay(ms))(fn),
  throttleOnce: (fn, ms) => pipe(exec, once, interval(ms))(fn)
};
