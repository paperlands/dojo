export class Camera {
    constructor(canvas, camBridge) {
        this.canvas = canvas;
        this.redraw = camBridge.pub
        this.camera = {
            x: 0,
            y: 0,
            z: 100
        };
        this.isDragging = false;
        this.lastMousePosition = { x: 0, y: 0 };

        this.scrollSpeed = 10;


        // Initialize event listeners
        this.initEventListeners();
    }

    now() {
        return this.camera
    }

    initEventListeners() {
        this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
        this.canvas.addEventListener('mouseleave', this.onMouseLeave.bind(this));
        this.canvas.addEventListener('wheel', this.onWheel.bind(this));
    }

    onMouseDown(event) {
        this.isDragging = true;
        this.lastMousePosition.x = event.clientX;
        this.lastMousePosition.y = event.clientY;
    }

    onMouseMove(event) {
        if (this.isDragging) {
            const deltaX = event.clientX - this.lastMousePosition.x;
            const deltaY = event.clientY - this.lastMousePosition.y;

            // Update camera position based on drag
            this.camera.x += deltaX;
            this.camera.y += deltaY;

            this.lastMousePosition.x = event.clientX;
            this.lastMousePosition.y = event.clientY;

            
            this.draw();
        }
    }

    onMouseUp() {
        this.isDragging = false;
    }

    onMouseLeave() {
        this.isDragging = false;
    }

    onWheel(event) {
        event.preventDefault(); // Prevent default scrolling behavior

        const zoomAmount = event.deltaY > 0 ? this.scrollSpeed : -this.scrollSpeed;
        this.camera.z += zoomAmount;

        this.draw();
    }

    draw() {
        // call cambridge
        this.redraw()
    }
}
