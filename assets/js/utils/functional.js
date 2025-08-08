
export const pipe = (...fns) => (value) => fns.reduce((acc, fn) => fn(acc), value);
export const tap = (fn) => (value) => { fn(value); return value; };
export const when = (predicate, fn) => (value) => predicate(value) ? fn(value) : value;
