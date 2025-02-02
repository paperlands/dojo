// whats in the BOX
Sensei = {
  mounted() {
    this.el.addEventListener("dblclick", (target) => {
      if (target.ctrlKey) {
        this.pushEvent("opensenseime", {});
      }
      if (target.metaKey) {
        this.pushEvent("opensenseime", {});
      }
    });
  },

};

export default Sensei;
