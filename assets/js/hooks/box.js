// whats in the BOX
Box = {
  mounted() {
    this.handleEvent("initSession", (sess) => this.initSession(sess));
  },

  initSession(sess) {
    localStorage.setItem("session", JSON.stringify(sess));
  },

  updated() { // gets called when the elem changes

  },
};

export default Box;
