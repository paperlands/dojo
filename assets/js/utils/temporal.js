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

// TWO SHAPES for streams where the newest args matter. Both keep the last
// call and carry .cancel() (teardown must not fire into a dead surface).
//
//   pace  — at most once per `ms` under load
//   quiet — only after `ms` of silence
//
// A hot path picks one. Hand-rolled timers are the failure mode.

const pace = (ms) => (fn) => {
  let timer = null
  let pending = null
  let last = -Infinity

  const fire = () => {
    timer = null
    last = Date.now()
    const args = pending
    pending = null
    fn(...args)
  }

  const paced = (...args) => {
    pending = args
    if (timer) return
    timer = setTimeout(fire, Math.max(0, ms - (Date.now() - last)))
  }

  paced.cancel = () => {
    clearTimeout(timer)
    timer = null
    pending = null
  }

  return paced
}

// Quiet — keys postpone; a break of `ms` lands once with the newest args.
// .flush() lands pending now; .cancel() drops it.
const quiet = (ms) => (fn) => {
  let timer = null
  let pending = null

  const fire = () => {
    timer = null
    const args = pending
    pending = null
    if (args) fn(...args)
  }

  const rested = (...args) => {
    pending = args
    clearTimeout(timer)
    timer = setTimeout(fire, ms)
  }

  rested.flush = () => {
    if (!pending) return
    clearTimeout(timer)
    timer = null
    fire()
  }

  rested.cancel = () => {
    clearTimeout(timer)
    timer = null
    pending = null
  }

  return rested
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

  // Rate under load — fire at most once per `ms`; trailing edge keeps newest.
  pace: (fn, ms) => pace(ms)(fn),

  // Silence under load — fire only after `ms` quiet; newest args always win.
  quiet: (fn, ms) => quiet(ms)(fn),

  // `memo` for side effects: DO IT ONLY WHEN IT WOULD READ DIFFERENTLY.
  // Keyed on the FIRST argument (digest keys, body draws) — never JSON.stringify.
  // Suppresses by SAMENESS; pace/quiet suppress by TIME. They compose.
  gate: (fn, keyOf = (args) => args[0]) => memo(keyOf)(fn),

  // NOTE: these still compose through `exec`, which returns a stale cached
  // result and drops the call when one is in flight. Fine for one-shot shapes;
  // streams where the newest value matters use `pace` or `quiet`.
  throttle: (fn, ms) => pipe(exec, interval(ms))(fn),
  debounceOnce: (fn, ms) => pipe(exec, once, delay(ms))(fn),
  throttleOnce: (fn, ms) => pipe(exec, once, interval(ms))(fn)
};
