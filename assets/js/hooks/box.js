// whats in the BOX
Box = {
  mounted() {
    this.handleEvent("initSession", (sess) => this.initSession(sess));
    this.el.addEventListener("dblclick", (target) => {
      if (target.ctrlKey) {
        this.pushEvent("opensenseime", {});
      }
      if (target.metaKey) {
        this.pushEvent("opensenseime", {});
      }
    });
  },

  initSession(sess) {
    localStorage.setItem("session", JSON.stringify(sess));
  },
};

export default Box;
