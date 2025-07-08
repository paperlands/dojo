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

  debounce: (fn, ms) => pipe(exec, delay(ms))(fn),
  throttle: (fn, ms) => pipe(exec, interval(ms))(fn),
  debounceOnce: (fn, ms) => pipe(exec, once, delay(ms))(fn),
  throttleOnce: (fn, ms) => pipe(exec, once, interval(ms))(fn)
};
