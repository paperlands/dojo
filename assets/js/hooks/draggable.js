Draggables = {
  mounted() {
    this.el.addEventListener('mousedown', this.startDrag.bind(this));
    document.addEventListener('mousemove', this.drag.bind(this));
    document.addEventListener('mouseup', this.stopDrag.bind(this));
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
