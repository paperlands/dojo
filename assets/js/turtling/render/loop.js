// handles rendertimeloop
export default class Loop {
    constructor(canvas, options) {
        // this.canvas = canvas;
        //this.ctx = canvas.getContext('2d');
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
            this.state.lastTimestamp = this.state.currentTime;

            // Render every RAF callback. RAF is already vsync-locked to the
            // display's refresh rate, so no manual frame-interval gate is needed
            // — and gating on `deltaTime >= 1000/60` actually drops to ~40fps on a
            // 60Hz display because RAF timestamps jitter just under the interval.
            // The render-on-demand stopCondition is what idles the loop out.
            if (this.state.needsClear) {
                this.clear();
                this.state.needsClear = false;
            }

            try {
                this.onRender(this.state.currentTime);
            } catch (e) {
                console.error('Render loop error:', e);
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
        //this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
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
