// The slider thumb. Dragging is tracked on the DOCUMENT, not the thumb — the
// pointer routinely leaves the 24px handle mid-drag — which makes teardown the
// whole story. LiveView remounts this hook, so each mount that leaves a
// document-level mousemove/mouseup behind stacks another one forever. Hence
// handlers held on `this`, taken back by destroyed(): an inline `.bind(this)`
// would be unremovable even in principle, the bound wrapper discarded at the
// call site with no handle left to pass removeEventListener.
const Draggables = {
  mounted() {
    this.onDown = this.startDrag.bind(this);
    this.onMove = this.drag.bind(this);
    this.onUp = this.stopDrag.bind(this);

    this.el.addEventListener('mousedown', this.onDown);
    document.addEventListener('mousemove', this.onMove);
    document.addEventListener('mouseup', this.onUp);
  },

  destroyed() {
    this.el.removeEventListener('mousedown', this.onDown);
    document.removeEventListener('mousemove', this.onMove);
    document.removeEventListener('mouseup', this.onUp);
    this.isDragging = false;
  },

  startDrag(e) {
    this.isDragging = true;
    //this.updateValue(e);
  },

  drag(e) {
    if (!this.isDragging) return;
    this.updateValue(e);
  },

  stopDrag() {
    this.isDragging = false;
  },

  updateValue(e) {
    const track = this.el.parentElement;
    const trackWidth = track.offsetWidth;
    const trackLeft = track.getBoundingClientRect().left;
    const mouseX = e.clientX - trackLeft;

    let percentage = Math.max(0, Math.min(100, (mouseX / trackWidth) * 100));
    percentage = Math.round(percentage);

    this.el.style.left = `${percentage}%`;
    this.el.previousElementSibling.style.width = `${percentage}%`;

    this.el.setAttribute("slideval", percentage);
  }
};

export default Draggables;
