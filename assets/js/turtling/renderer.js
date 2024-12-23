export class RenderLoop {
    constructor(canvas, options) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.onRender = options.onRender;
        this.stopCondition = options.stopCondition;

        this.state = {
            animationFrameId: null,
            lastTimestamp: 0,
            baseTimestamp: 0,
            currentTime: 0,
            needsClear: false,
            needsRestart: false
        };

        this.targetFPS = 60;
        this.frameInterval = 1000 / this.targetFPS;
    }

    start() {
        const loop = (timestamp) => {

            if (this.state.needsRestart) {
                this.restart(timestamp);
            }

            if (this.stopCondition()) {
                this.stop();
                return;
            }

            this.state.currentTime = timestamp - this.state.baseTimestamp;

            if (!this.state.lastTimestamp) {
                this.state.lastTimestamp = this.state.currentTime;
            }

            const deltaTime = this.state.currentTime - this.state.lastTimestamp;

            if (deltaTime >= this.frameInterval) {
                if (this.state.needsClear) {
                    this.clear();
                    this.state.needsClear = false;
                }

                this.onRender(this.state.currentTime);
                this.state.lastTimestamp = this.state.currentTime;

            }

            this.state.animationFrameId = requestAnimationFrame(loop);
        };

        if (!this.state.animationFrameId) {
            this.state.lastTimestamp = 0;
            this.state.animationFrameId = requestAnimationFrame(loop);
        }
    }

    stop() {
        if (this.state.animationFrameId) {
            cancelAnimationFrame(this.state.animationFrameId);
            this.state.animationFrameId = null;
        }
    }

    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    restart(timestamp) {
        this.state.lastTimestamp = 0;
        this.state.baseTimestamp = timestamp;
        this.clear();
        this.state.needsRestart = false;
    }

    requestClear() {
        this.state.needsClear = true;
        this.ensureRunning();
    }

    requestRestart() {
        this.state.needsRestart = true;
        this.ensureRunning();
    }

    ensureRunning() {
        if (!this.state.animationFrameId) {
            this.state.lastTimestamp = 0;
            this.start();
        }
    }
}
