// whats in the BOX
Box = {
  mounted() {
    this.handleEvent("initSession", (sess) => this.initSession(sess));
    this.handleEvent("mutateSession", (patch) => this.mutateSession(patch));
  },

  initSession(sess) {
    localStorage.setItem("session", JSON.stringify(sess));
  },

  mutateSession(patch) {
    let session = JSON.parse(localStorage.getItem("session") || "{}");
    for (const [key, val] of Object.entries(patch)) {
      if (val && typeof val === "object" && !Array.isArray(val) &&
          session[key] && typeof session[key] === "object") {
        session[key] = { ...session[key], ...val };
      } else {
        session[key] = val;
      }
    }
    localStorage.setItem("session", JSON.stringify(session));
  },

  updated() { // gets called when the elem changes

  },
};

export default Box;
