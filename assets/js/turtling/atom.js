// Atom — re-export. The primitive lives in kernel/observable.js now
// (one watch/notify for the whole client). This path stays so older
// imports do not break mid-migration.

export { createAtom } from "../kernel/observable.js"
