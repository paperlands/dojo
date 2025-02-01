// Vector2D utils class for canvas & device window ops
class Vector2D {
    constructor(x = 0, y = 0) {
        this.x = x;
        this.y = y;
    }

    add(vector) {
        return new Vector2D(this.x + vector.x, this.y + vector.y);
    }

    subtract(vector) {
        return new Vector2D(this.x - vector.x, this.y - vector.y);
    }

    scale(factor) {
        return new Vector2D(this.x * factor, this.y * factor);
    }

    clone() {
        return new Vector2D(this.x, this.y);
    }
}

// State management for curr camera props
class CameraState {
    constructor(config = {}) {
        this.position = new Vector2D(config.x || 0, config.y || 0);
        this.targetPosition = this.position.clone();
        this.zoom = config.zoom || 500;
        this.targetZoom = this.zoom;
        this.velocity = config.velocity || 0;
    }

    clone() {
        const state = new CameraState();
        state.position = this.position.clone();
        state.targetPosition = this.targetPosition.clone();
        state.zoom = this.zoom;
        state.targetZoom = this.targetZoom;
        state.velocity = this.velocity;
        return state;
    }
}

// camera init configs
class CameraConfig {
    constructor(options = {}) {
        this.smoothingFactor = options.smoothingFactor || 0.06;
        this.zoomSpeed = options.zoomSpeed || 0.03;
        this.minZoom = options.minZoom || 1;
        this.maxZoom = options.maxZoom || 100000000;
        this.framerate = options.framerate || 60;
    }
}

class CameraInputHandler {
    constructor(camera) {
        this.camera = camera;
        this.isDragging = false;
        this.lastPosition = new Vector2D();
        this.touchIdentifier = null;

        // Mouse event bindings
        this.boundMouseDown = this.handleMouseDown.bind(this);
        this.boundMouseMove = this.handleMouseMove.bind(this);
        this.boundMouseUp = this.handleMouseUp.bind(this);

        // Touch event bindings
        this.boundTouchStart = this.handleTouchStart.bind(this);
        this.boundTouchMove = this.handleTouchMove.bind(this);
        this.boundTouchEnd = this.handleTouchEnd.bind(this);

        // Add event listeners
        this.camera.canvas.addEventListener('mousedown', this.boundMouseDown);
        this.camera.canvas.addEventListener('wheel', this.handleWheel.bind(this));

        // Touch event listeners
        this.camera.canvas.addEventListener('touchstart', this.boundTouchStart, { passive: false });
        this.camera.canvas.addEventListener('touchmove', this.boundTouchMove, { passive: false });
        this.camera.canvas.addEventListener('touchend', this.boundTouchEnd);
        this.camera.canvas.addEventListener('touchcancel', this.boundTouchEnd);
    }

    // Mouse interaction methods (existing implementation)
    handleMouseDown(event) {
        this.isDragging = true;
        this.lastPosition = new Vector2D(event.clientX, event.clientY);
        document.addEventListener('mousemove', this.boundMouseMove);
        document.addEventListener('mouseup', this.boundMouseUp);
    }

    handleMouseMove(event) {
        if (!this.isDragging) return;
        const currentPosition = new Vector2D(event.clientX, event.clientY);
        const delta = currentPosition.subtract(this.lastPosition);
        const zoomFactor = this.camera.state.zoom / 100;
        this.camera.state.targetPosition = this.camera.state.targetPosition.subtract(
            delta.scale(zoomFactor/2)
        );
        this.lastPosition = currentPosition;
    }

    handleMouseUp() {
        this.isDragging = false;
        document.removeEventListener('mousemove', this.boundMouseMove);
        document.removeEventListener('mouseup', this.boundMouseUp);
    }

    // Touch interaction methods
    handleTouchStart(event) {
        // Prevent default to stop scrolling/zooming
        event.preventDefault();

        // Single touch for panning
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            this.isDragging = true;
            this.touchIdentifier = touch.identifier;
            this.lastPosition = new Vector2D(touch.clientX, touch.clientY);
        }

        // Pinch-to-zoom for multiple touches
        if (event.touches.length === 2) {
            this.handlePinchStart(event);
        }
    }

    handleTouchMove(event) {
        event.preventDefault();

        // Single touch panning
        if (event.touches.length === 1 && this.isDragging) {
            const touch = Array.from(event.touches).find(
                t => t.identifier === this.touchIdentifier
            );

            if (touch) {
                const currentPosition = new Vector2D(touch.clientX, touch.clientY);
                const delta = currentPosition.subtract(this.lastPosition);
                const zoomFactor = this.camera.state.zoom / 100;
                this.camera.state.targetPosition = this.camera.state.targetPosition.subtract(
                    delta.scale(zoomFactor)
                );
                this.lastPosition = currentPosition;
            }
        }

        // Pinch-to-zoom
        if (event.touches.length === 2) {
            this.handlePinchMove(event);
        }
    }

    handleTouchEnd(event) {
        // Reset dragging state
        this.isDragging = false;
        this.touchIdentifier = null;

        // Reset pinch-zoom tracking
        if (event.touches.length === 0) {
            this.initialDistance = null;
            this.initialZoom = null;
        }
    }

    // Pinch-to-zoom handling
    handlePinchStart(event) {
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];

        // Calculate initial pinch distance
        this.initialDistance = Math.hypot(
            touch1.clientX - touch2.clientX,
            touch1.clientY - touch2.clientY
        );

        // Store initial zoom level
        this.initialZoom = this.camera.state.zoom;
    }

    handlePinchMove(event) {
        if (!this.initialDistance || !this.initialZoom) return;

        const touch1 = event.touches[0];
        const touch2 = event.touches[1];

        // Calculate current pinch distance
        const currentDistance = Math.hypot(
            touch1.clientX - touch2.clientX,
            touch1.clientY - touch2.clientY
        );

        // Calculate zoom factor
        const zoomFactor = currentDistance / this.initialDistance;

        // Calculate midpoint for zoom
        const midpoint = new Vector2D(
            (touch1.clientX + touch2.clientX) / 2,
            (touch1.clientY + touch2.clientY) / 2
        );

        // Get world position of midpoint
        const worldPosition = this.getWorldPosition(midpoint);

        // Apply zooming
        const newZoom = this.initialZoom * zoomFactor;
        this.camera.zoomToward(worldPosition, newZoom / this.camera.state.zoom);
    }

    handleWheel(event) {
        event.preventDefault();
        const rect = this.camera.canvas.getBoundingClientRect();
        const mousePosition = new Vector2D(
            event.clientX - rect.left,
            event.clientY - rect.top
        );
        const worldPosition = this.getWorldPosition(mousePosition);
        const zoomFactor = event.deltaY > 0 ?
            (1 + this.camera.config.zoomSpeed) :
            (1 - this.camera.config.zoomSpeed);
        this.camera.zoomToward(worldPosition, zoomFactor);
    }

    getWorldPosition(screenPosition) {
        const canvasCenter = new Vector2D(
            this.camera.canvas.width / 2,
            this.camera.canvas.height / 2
        );
        const offset = screenPosition.subtract(canvasCenter)
            .scale(this.camera.state.zoom / 100);
        return this.camera.state.position.add(offset);
    }

    // Optional: Cleanup method to remove event listeners
    dispose() {
        this.camera.canvas.removeEventListener('mousedown', this.boundMouseDown);
        this.camera.canvas.removeEventListener('wheel', this.handleWheel);
        this.camera.canvas.removeEventListener('touchstart', this.boundTouchStart);
        this.camera.canvas.removeEventListener('touchmove', this.boundTouchMove);
        this.camera.canvas.removeEventListener('touchend', this.boundTouchEnd);
        this.camera.canvas.removeEventListener('touchcancel', this.boundTouchEnd);
    }
}


// Main Camera class

export class Camera {
    constructor(canvas, camBridge, config = {}) {
        this.canvas = canvas;
        this.redraw = camBridge.pub;
        this.config = new CameraConfig(config);
        this.state = new CameraState(config);
        this.inputHandler = new CameraInputHandler(this);

        this.animationFrame = null;
        this.movieInterval = null;

        this.initEventListeners();
        this.startSmoothAnimation();
    }

    initEventListeners() {
        this.canvas.addEventListener('mousedown',
            (e) => this.inputHandler.handleMouseDown(e));
        this.canvas.addEventListener('wheel',
            (e) => this.inputHandler.handleWheel(e));
    }

    startSmoothAnimation() {
        const animate = () => {
            this.updateState();
            this.animationFrame = requestAnimationFrame(animate);
        };
        animate();
    }

    updateState() {
        const { smoothingFactor } = this.config;
        const needsUpdate = this.interpolateState(smoothingFactor);

        if (needsUpdate) {
            this.draw();
        }
    }

    interpolateState(smoothingFactor) {
        let needsUpdate = false;
        const state = this.state;

        // Position interpolation
        const deltaX = state.targetPosition.x - state.position.x;
        const deltaY = state.targetPosition.y - state.position.y;

        if (Math.abs(deltaX) > 0.01 || Math.abs(deltaY) > 0.01) {
            state.position = state.position.add(
                new Vector2D(
                    deltaX * smoothingFactor,
                    deltaY * smoothingFactor
                )
            );
            needsUpdate = true;
        }

        // Zoom interpolation
        const deltaZoom = state.targetZoom - state.zoom;
        if (Math.abs(deltaZoom) > 0.01) {
            state.zoom += deltaZoom * smoothingFactor;
            needsUpdate = true;
        }

        return needsUpdate;
    }

    zoomToward(worldPosition, factor) {
         const newZoom = this.clampZoom(this.state.targetZoom * factor);
         const zoomChange = newZoom / this.state.targetZoom;

        // Adjust position to maintain world position under mouse
        const offset = worldPosition.subtract(this.state.targetPosition);
        const newPosition = worldPosition.subtract(offset.scale(zoomChange));

        this.state.targetPosition = newPosition;
        this.state.targetZoom = newZoom;
    }

    clampZoom(zoom) {
        return Math.min(Math.max(zoom, this.config.minZoom), this.config.maxZoom);
    }

    setVelocity(velocity) {
        this.state.velocity = velocity;
        velocity ? this.startMovie() : this.stopMovie();
    }

    startMovie() {
        if (this.movieInterval) return;

        this.movieInterval = setInterval(() => {
            this.state.targetZoom -= this.state.velocity;
            this.state.targetZoom = this.clampZoom(this.state.targetZoom);
        }, 1000 / this.config.framerate);
    }

    stopMovie() {
        if (this.movieInterval) {
            clearInterval(this.movieInterval);
            this.movieInterval = null;
        }
    }

    draw() {
        this.redraw();
    }

    now() {
        return {
            x: this.state.position.x,
            y: this.state.position.y,
            z: this.state.zoom,
            v: this.state.velocity
        };
    }

    destroy() {
        this.stopMovie();
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
        }
    }
}
