export class Recorder {
    /**
     * @param {HTMLCanvasElement} canvas - WebGL canvas element
     * @param {Object} options - Configuration options
     */
    constructor(canvas, options = {}) {
        // Validate canvas
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new Error('Recorder requires a valid HTMLCanvasElement');
        }

        const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!ctx) {
            throw new Error('WebGL context not available on provided canvas');
        }

        // Core properties
        this.canvas = canvas;
        this.gl = ctx;
        this.isDestroyed = false;

        // Configuration with defaults
        this.config = {
            // Video recording options
            videoFPS: options.videoFPS || 24,
            videoBitrate: options.videoBitrate || 5000000, // 5 Mbps
            videoMimeType: options.videoMimeType || 'video/webm; codecs=vp9',
            videoTimeSlice: options.videoTimeSlice || 100, // ms

            // Snapshot options
            snapshoteFormat: options.snapshotFormat || 'png',
            snapshotQuality: options.snapshotQuality || 0.95,

            // Performance options
            useOffscreenCanvas: options.useOffscreenCanvas !== false,
            poolSize: options.poolSize || 3,

            ...options
        };

        // Recording state
        this.recording = {
            isActive: false,
            mediaRecorder: null,
            stream: null,
            chunks: [],
            startTime: 0,
            duration: 0
        };

        // Snapshot state
        this.snapshot = {
            isProcessing: false,
            buffer: null,
            lastResult: null
        };

        // Object pools for memory efficiency
        this.pools = {
            uint8Arrays: [],
            uint8ClampedArrays: [],
            canvases: [],
            contexts: []
        };

        // Performance monitoring
        this.stats = {
            snapshotCount: 0,
            recordingCount: 0,
            lastSnapshotTime: 0,
            avgSnapshotTime: 0
        };

        // Bind methods for consistent context
        this._onDataAvailable = this._onDataAvailable.bind(this);
        this._onRecordingStop = this._onRecordingStop.bind(this);
        this._onRecordingError = this._onRecordingError.bind(this);

        // Initialize object pools
        this._initializePools();
    }

    /**
     * Initialize object pools for memory efficiency
     * @private
     */
    _initializePools() {
        const { width, height } = this.canvas;
        const pixelCount = width * height * 4;

        // Pre-allocate pixel buffers
        for (let i = 0; i < this.config.poolSize; i++) {
            this.pools.uint8Arrays.push(new Uint8Array(pixelCount));
            this.pools.uint8ClampedArrays.push(new Uint8ClampedArray(pixelCount));
        }

        // Pre-allocate offscreen canvases if enabled
        if (this.config.useOffscreenCanvas) {
            for (let i = 0; i < this.config.poolSize; i++) {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                this.pools.canvases.push(canvas);
                this.pools.contexts.push(ctx);
            }
        }
    }

    /**
     * Get a buffer from the pool or create new one
     * @private
     */
    _getBuffer(type, size) {
        const pool = this.pools[type];
        if (pool.length > 0) {
            const buffer = pool.pop();
            if (buffer.length >= size) {
                return buffer.subarray ? buffer.subarray(0, size) : buffer;
            }
        }

        // Create new buffer if pool is empty or existing buffer is too small
        switch (type) {
            case 'uint8Arrays':
                return new Uint8Array(size);
            case 'uint8ClampedArrays':
                return new Uint8ClampedArray(size);
            default:
                throw new Error(`Unknown buffer type: ${type}`);
        }
    }

    /**
     * Return buffer to pool
     * @private
     */
    _returnBuffer(type, buffer) {
        const pool = this.pools[type];
        if (pool.length < this.config.poolSize) {
            pool.push(buffer);
        }
    }

    /**
     * Get canvas and context from pool
     * @private
     */
    _getCanvas() {
        if (this.pools.canvases.length > 0 && this.pools.contexts.length > 0) {
            return {
                canvas: this.pools.canvases.pop(),
                ctx: this.pools.contexts.pop()
            };
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        return { canvas, ctx };
    }

    /**
     * Return canvas and context to pool
     * @private
     */
    _returnCanvas(canvas, ctx) {
        if (this.pools.canvases.length < this.config.poolSize) {
            this.pools.canvases.push(canvas);
            this.pools.contexts.push(ctx);
        }
    }

    /**
     * Start video recording using captureStream
     * @param {Object} options - Recording options
     * @returns {Promise<boolean>} Success status
     */
    async startRecording(options = {}) {
        if (this.recording.isActive) {
            console.warn('Recording already active');
            return false;
        }

        if (this.isDestroyed) {
            throw new Error('Recorder has been destroyed');
        }

        try {
            // Merge options with defaults
            const recordingOptions = { ...this.config, ...options };

            // Capture stream from canvas
            this.recording.stream = this.canvas.captureStream(recordingOptions.videoFPS);

            // Create MediaRecorder with optimal settings
            const mediaRecorderOptions = {
                mimeType: recordingOptions.videoMimeType,
                videoBitsPerSecond: recordingOptions.videoBitrate
            };

            // Fallback mime types if primary not supported
            const mimeTypes = [
                'video/webm; codecs=vp9',
                'video/webm; codecs=vp8',
                'video/webm',
                'video/mp4'
            ];

            let selectedMimeType = mediaRecorderOptions.mimeType;
            if (!MediaRecorder.isTypeSupported(selectedMimeType)) {
                selectedMimeType = mimeTypes.find(type => MediaRecorder.isTypeSupported(type));
                if (!selectedMimeType) {
                    throw new Error('No supported video format found');
                }
                mediaRecorderOptions.mimeType = selectedMimeType;
            }

            this.recording.mediaRecorder = new MediaRecorder(this.recording.stream, mediaRecorderOptions);

            // Setup event listeners
            this.recording.mediaRecorder.ondataavailable = this._onDataAvailable;
            this.recording.mediaRecorder.onstop = this._onRecordingStop;
            this.recording.mediaRecorder.onerror = this._onRecordingError;

            // Reset chunks and start recording
            this.recording.chunks = [];
            this.recording.startTime = performance.now();
            this.recording.mediaRecorder.start(recordingOptions.videoTimeSlice);
            this.recording.isActive = true;

            this.stats.recordingCount++;
            return true;

        } catch (error) {
            console.error('Failed to start recording:', error);
            this._cleanup();
            return false;
        }
    }

    /**
     * Stop video recording
     * @returns {Promise<Blob|null>} Recorded video blob
     */
    async stopRecording() {
        if (!this.recording.isActive || !this.recording.mediaRecorder) {
            console.warn('No active recording to stop');
            return null;
        }

        return new Promise((resolve) => {
            // Set up one-time stop handler
            const originalStopHandler = this._onRecordingStop;
            this._onRecordingStop = (event) => {
                originalStopHandler(event);
                resolve(this.getLastRecording());
            };

            this.recording.mediaRecorder.stop();
        });
    }

    /**
     * Take a single frame snapshot with optimized processing
     * @param {Object} options - Snapshot options
     * @returns {Promise<string|null>} Data URL of the snapshot
     */
  takeSnapshot(pixels, width, height, options = {}) {
        if (this.snapshot.isProcessing) {
            console.warn('Snapshot already in progress');
            return null;
        }

        if (this.isDestroyed) {
            throw new Error('Recorder has been destroyed');
        }

        const startTime = performance.now();
        this.snapshot.isProcessing = true;

        try {

            // Process asynchronously to avoid blocking
            const result = this._processSnapshot(pixels, width, height, options);

            // Return buffer to pool
            this._returnBuffer('uint8Arrays', pixels);

            // Update statistics
            const processingTime = performance.now() - startTime;
            this.stats.lastSnapshotTime = processingTime;
            this.stats.avgSnapshotTime = (this.stats.avgSnapshotTime * this.stats.snapshotCount + processingTime) / (this.stats.snapshotCount + 1);
            this.stats.snapshotCount++;

            this.snapshot.lastResult = result;
            return result;

        } catch (error) {
            console.error('Failed to take snapshot:', error);
            return null;
        } finally {
            this.snapshot.isProcessing = false;
        }
    }

    /**
     * Process snapshot with optimized algorithms
     * @private
     */
    _processSnapshot(pixels, width, height, options = {}) {

        const config = { ...this.config, ...options };
        // Flip pixels vertically (WebGL has origin at bottom-left)
        this._flipPixelsVertically(pixels, width, height);
        const clampedBuffer = new Uint8ClampedArray(pixels)
        // Convert to ImageData
        const imageData = new ImageData(clampedBuffer, width, height)
        let dataurl
        dataurl = this._trimAndConvert(imageData, width, height, config);


        // Return buffer to pool
        this._returnBuffer('uint8ClampedArrays', clampedBuffer);


        return [this._convertToDataURL(imageData, width, height, config), dataurl];
    }

    /**
     * Optimized vertical pixel flipping
     * @private
     */
  _flipPixelsVertically(pixels, width, height) {
    // Ensure pixels is a Uint8Array
    if (!(pixels instanceof Uint8Array)) {
      pixels = new Uint8Array(pixels);
    }

    const bytesPerRow = width * 4;
    const halfHeight = Math.floor(height / 2);
    const temp = new Uint8Array(bytesPerRow);

    for (let y = 0; y < halfHeight; y++) {
      const topOffset = y * bytesPerRow;
      const bottomOffset = (height - y - 1) * bytesPerRow;

      // Swap rows
      temp.set(pixels.subarray(topOffset, topOffset + bytesPerRow));
      pixels.copyWithin(topOffset, bottomOffset, bottomOffset + bytesPerRow);
      pixels.set(temp, bottomOffset);
    }
  }
    /**
     * Optimized image trimming with early exit
     * @private
     */
    _trimAndConvert(imageData, width, height, config) {
        const data = imageData.data;
        let xMin = width, xMax = -1, yMin = height, yMax = -1;

        // Find bounding box with optimized scanning
        for (let y = 0; y < height; y++) {
            let hasPixelInRow = false;
            const rowStart = y * width * 4;

            for (let x = 0; x < width; x++) {
                const alphaIndex = rowStart + x * 4 + 3;
                if (data[alphaIndex] > 0) {
                    hasPixelInRow = true;
                    if (x < xMin) xMin = x;
                    if (x > xMax) xMax = x;
                }
            }

            if (hasPixelInRow) {
                if (y < yMin) yMin = y;
                yMax = y;
            }
        }

        // Return null if no opaque pixels found
        if (xMax < xMin || yMax < yMin) {
            return null;
        }

        // Create trimmed image
        const newWidth = xMax - xMin + 1;
        const newHeight = yMax - yMin + 1;

        const { canvas, ctx } = this._getCanvas();
        canvas.width = newWidth;
        canvas.height = newHeight;

        // Create trimmed ImageData
        const trimmedImageData = ctx.createImageData(newWidth, newHeight);
        const trimmedData = trimmedImageData.data;

        // Copy pixels efficiently
        for (let y = 0; y < newHeight; y++) {
            const srcRowStart = ((yMin + y) * width + xMin) * 4;
            const dstRowStart = y * newWidth * 4;
            const rowBytes = newWidth * 4;

            trimmedData.set(
                data.subarray(srcRowStart, srcRowStart + rowBytes),
                dstRowStart
            );
        }

        // Render to canvas and get data URL
        ctx.putImageData(trimmedImageData, 0, 0);
        const dataURL = canvas.toDataURL(`image/${config.snapshotFormat}`, config.snapshotQuality);

        // Return canvas to pool
        this._returnCanvas(canvas, ctx);

        return dataURL;
    }

    /**
     * Convert ImageData to DataURL without trimming
     * @private
     */
    _convertToDataURL(imageData, width, height, config) {
        const { canvas, ctx } = this._getCanvas();
        canvas.width = width;
        canvas.height = height;

        ctx.putImageData(imageData, 0, 0);
        const dataURL = canvas.toDataURL(`image/${config.snapshotFormat}`, config.snapshotQuality);

        this._returnCanvas(canvas, ctx);
        return dataURL;
    }

    /**
     * Get the last recorded video blob
     * @returns {Blob|null}
     */
    getLastRecording() {
        if (this.recording.chunks.length === 0) {
            return null;
        }

        return new Blob(this.recording.chunks, {
            type: this.recording.mediaRecorder?.mimeType || 'video/webm'
        });
    }

    /**
     * Get recording statistics
     * @returns {Object}
     */
    getStats() {
        return {
            ...this.stats,
            isRecording: this.recording.isActive,
            recordingDuration: this.recording.isActive ?
                performance.now() - this.recording.startTime : this.recording.duration,
            canvasSize: {
                width: this.canvas.width,
                height: this.canvas.height
            },
            poolStats: {
                uint8Arrays: this.pools.uint8Arrays.length,
                uint8ClampedArrays: this.pools.uint8ClampedArrays.length,
                canvases: this.pools.canvases.length
            }
        };
    }

    /**
     * Check if recording is supported
     * @returns {boolean}
     */
    static isSupported() {
        return !!(
            HTMLCanvasElement.prototype.captureStream &&
            window.MediaRecorder &&
            MediaRecorder.isTypeSupported('video/webm')
        );
    }

    /**
     * Get supported video formats
     * @returns {string[]}
     */
    static getSupportedFormats() {
        const formats = [
            'video/webm; codecs=vp9',
            'video/webm; codecs=vp8',
            'video/webm',
            'video/mp4; codecs=h264',
            'video/mp4'
        ];

        return formats.filter(format => MediaRecorder.isTypeSupported(format));
    }

    /**
     * Event handlers
     * @private
     */
    _onDataAvailable(event) {
        if (event.data && event.data.size > 0) {
            this.recording.chunks.push(event.data);
        }
    }

    _onRecordingStop(event) {
        this.recording.isActive = false;
        this.recording.duration = performance.now() - this.recording.startTime;
        this._cleanup();
    }

    _onRecordingError(event) {
        console.error('Recording error:', event.error);
        this.recording.isActive = false;
        this._cleanup();
    }

    /**
     * Cleanup recording resources
     * @private
     */
    _cleanup() {
        if (this.recording.stream) {
            this.recording.stream.getTracks().forEach(track => track.stop());
            this.recording.stream = null;
        }

        if (this.recording.mediaRecorder) {
            this.recording.mediaRecorder.ondataavailable = null;
            this.recording.mediaRecorder.onstop = null;
            this.recording.mediaRecorder.onerror = null;
            this.recording.mediaRecorder = null;
        }
    }

    /**
     * Destroy the recorder and free all resources
     */
    destroy() {
        if (this.isDestroyed) {
            return;
        }

        // Stop any active recording
        if (this.recording.isActive) {
            this.recording.mediaRecorder?.stop();
        }

        // Cleanup
        this._cleanup();

        // Clear pools
        this.pools.uint8Arrays.length = 0;
        this.pools.uint8ClampedArrays.length = 0;
        this.pools.canvases.length = 0;
        this.pools.contexts.length = 0;

        // Clear references
        this.canvas = null;
        this.gl = null;
        this.isDestroyed = true;
    }
}
