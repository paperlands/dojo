// whats in the BOX — dblclick (with mod) opens sensei.
// Arena owns the listener: destroyed hooks leave nothing behind.

import { createArena } from "../kernel/arena.js"

const Sensei = {
  mounted() {
    this._arena = createArena()
    this._arena.on(this.el, "dblclick", (e) => {
      if (e.ctrlKey || e.metaKey) this.pushEvent("opensenseime", {})
    })
  },

  destroyed() {
    this._arena?.destroy()
    this._arena = null
  },
}

export default Sensei
