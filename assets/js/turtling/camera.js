export class Camera {
    constructor(canvas, camBridge) {
        this.canvas = canvas;
        this.redraw = camBridge.pub
        this.camera = {
            x: 0,
            y: 0,
            z: 100,
            v: 0
        };
        this.isDragging = false;
        this.lastMousePosition = { x: 0, y: 0 };

        this.scrollSpeed = 10;

        this.movie = null ;


        // Initialize event listeners
        this.initEventListeners();
    }

    now() {
        return this.camera
    }

    speed(v) {
        this.camera.v = v
        !v ? (this.endMovie()) : (this.beginMovie())
    }

    beginMovie() {
        if (!this.movie) {
            // Trigger draw event every 1000ms / 24 = ~41.67ms
            this.movie = setInterval(() => {
                this.updateCameraPosition();
                this.draw();
            }, 1000 / 24);
        }
    }

    updateCameraPosition() {
        // Update the camera position based on its velocity and direction
        // Assuming facing direction is along the x-axis for simplicity
        this.camera.z -= this.camera.v; // Adjust this based on actual direction
    }

    endMovie() {
        if (this.movie) {
            clearInterval(this.movie);
            this.movie = null;
        }
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
