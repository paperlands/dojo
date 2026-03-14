import {
    Output,
    Mp4OutputFormat,
    WebMOutputFormat,
    BufferTarget,
    StreamTarget,
    CanvasSource,
    QUALITY_HIGH,
    QUALITY_MEDIUM,
    QUALITY_LOW,
} from '../../utils/mediabunny.min.mjs';


export const RecorderQuality = {
    LOW: QUALITY_LOW,
    MEDIUM: QUALITY_MEDIUM,
    HIGH: QUALITY_HIGH,
};

const RecorderState = {
    IDLE: 'idle',
    RECORDING: 'recording',
    PAUSED: 'paused',
    FINALIZING: 'finalizing',
    ERROR: 'error',
};

/**
 * Codec negotiation utilities
 */
class CodecNegotiator {
    /**
     * Get codec variations to try in order of preference
     */
    static getCodecFallbacks(preferredCodec) {
        const fallbackChains = {
            'avc': [
                // H.264 profiles in order of compatibility
                { codec: 'avc', profile: 'baseline', string: 'avc1.42001E' },
                { codec: 'avc', profile: 'main', string: 'avc1.4D001E' },
                { codec: 'avc', profile: 'high', string: 'avc1.64001E' },
                { codec: 'avc', profile: 'constrained-baseline', string: 'avc1.42E01E' },
            ],
            'vp9': [
                { codec: 'vp9', profile: 'profile-0', string: 'vp09.00.10.08' },
                { codec: 'vp9', profile: 'profile-0-8bit', string: 'vp09.00.10.08.01.01.01.01.00' },
            ],
            'vp8': [
                { codec: 'vp8', string: 'vp8' },
            ],
            'av1': [
                { codec: 'av1', profile: 'main', string: 'av01.0.04M.08' },
                { codec: 'av1', profile: 'high', string: 'av01.0.05M.08' },
            ],
        };

        // Fallback order across codecs
        const codecOrder = ['avc', 'vp9', 'vp8', 'av1'];
        
        // Start with preferred codec variations
        let variations = [...(fallbackChains[preferredCodec] || [])];
        
        // Add other codecs as fallbacks
        for (const codec of codecOrder) {
            if (codec !== preferredCodec) {
                variations.push(...(fallbackChains[codec] || []));
            }
        }

        return variations;
    }

    /**
     * Get resolution variations to try
     */
    static getResolutionFallbacks(width, height) {
        const aspectRatio = width / height;
        
        // Common resolutions to try
        const commonResolutions = [
            { width: 3840, height: 2160, name: '4K' },
            { width: 2560, height: 1440, name: '1440p' },
            { width: 1920, height: 1080, name: '1080p' },
            { width: 1280, height: 720, name: '720p' },
            { width: 854, height: 480, name: '480p' },
            { width: 640, height: 360, name: '360p' },
        ];

        // Start with original dimensions
        const variations = [{ width, height, name: 'original' }];

        // Try dimensions that are multiples of 2 (required by many encoders)
        const alignedWidth = Math.floor(width / 2) * 2;
        const alignedHeight = Math.floor(height / 2) * 2;
        if (alignedWidth !== width || alignedHeight !== height) {
            variations.push({ width: alignedWidth, height: alignedHeight, name: 'aligned' });
        }

        // Try standard resolutions with similar aspect ratio
        for (const res of commonResolutions) {
            const resAspect = res.width / res.height;
            if (Math.abs(resAspect - aspectRatio) < 0.1 && 
                (res.width !== width || res.height !== height)) {
                variations.push(res);
            }
        }

        // Try scaling down proportionally
        if (width > 1920 || height > 1080) {
            const scale = Math.min(1920 / width, 1080 / height);
            const scaledWidth = Math.floor(width * scale / 2) * 2;
            const scaledHeight = Math.floor(height * scale / 2) * 2;
            variations.push({ width: scaledWidth, height: scaledHeight, name: 'scaled' });
        }

        return variations;
    }

    /**
     * Get bitrate variations to try
     */
    static getBitrateFallbacks(baseBitrate, width, height) {
        const pixelCount = width * height;
        const base = typeof baseBitrate === 'number' ? baseBitrate : 5_000_000;
        
        // Scale bitrate based on resolution
        const scaleFactor = pixelCount / (1920 * 1080);
        const scaledBase = Math.floor(base * scaleFactor);

        return [
            scaledBase,
            Math.floor(scaledBase * 0.8),
            Math.floor(scaledBase * 0.6),
            Math.floor(scaledBase * 0.4),
            Math.floor(scaledBase * 0.2),
            1_000_000, // Minimum viable bitrate
        ].filter(b => b > 0);
    }

    /**
     * Find a supported encoder configuration
     */
    static async findSupportedConfig(canvas, options) {
        const { codec: preferredCodec, frameRate, bitrate } = options;
        const { width, height } = canvas;

        console.log(`[CodecNegotiator] Finding supported config for ${width}x${height}, codec: ${preferredCodec}`);

        // Get variations to try
        const codecVariations = this.getCodecFallbacks(preferredCodec);
        const resolutionVariations = this.getResolutionFallbacks(width, height);
        const hardwarePreferences = ['prefer-hardware', 'no-preference', 'prefer-software'];

        // Try combinations
        for (const codecInfo of codecVariations) {
            for (const resolution of resolutionVariations) {
                const bitrateVariations = this.getBitrateFallbacks(bitrate, resolution.width, resolution.height);
                
                for (const testBitrate of bitrateVariations) {
                    for (const hwAccel of hardwarePreferences) {
                        const config = {
                            codec: codecInfo.string,
                            width: resolution.width,
                            height: resolution.height,
                            framerate: frameRate,
                            bitrate: testBitrate,
                            hardwareAcceleration: hwAccel,
                        };

                        try {
                            const support = await VideoEncoder.isConfigSupported(config);
                            
                            if (support.supported) {
                                console.log(`[CodecNegotiator] ✅ Found supported config:`, {
                                    codec: codecInfo.codec,
                                    profile: codecInfo.profile,
                                    codecString: codecInfo.string,
                                    resolution: `${resolution.width}x${resolution.height} (${resolution.name})`,
                                    bitrate: `${(testBitrate / 1_000_000).toFixed(1)} Mbps`,
                                    hardwareAcceleration: hwAccel,
                                    changed: {
                                        codec: codecInfo.codec !== preferredCodec,
                                        resolution: resolution.width !== width || resolution.height !== height,
                                        bitrate: testBitrate !== (typeof bitrate === 'number' ? bitrate : 5_000_000),
                                        hardwareAcceleration: hwAccel !== 'prefer-hardware',
                                    }
                                });

                                return {
                                    supported: true,
                                    config,
                                    codecInfo,
                                    resolution,
                                    bitrate: testBitrate,
                                    hardwareAcceleration: hwAccel,
                                    negotiated: {
                                        codec: codecInfo.codec,
                                        codecString: codecInfo.string,
                                        width: resolution.width,
                                        height: resolution.height,
                                        bitrate: testBitrate,
                                        frameRate,
                                        hardwareAcceleration: hwAccel,
                                    }
                                };
                            }
                        } catch (error) {
                            // This config not supported, continue
                        }
                    }
                }
            }
        }

        console.error(`[CodecNegotiator] ❌ No supported configuration found`);
        return { supported: false };
    }

    /**
     * Get detailed codec capabilities
     */
    static async getCodecCapabilities() {
        const codecs = {
            'avc': ['avc1.42001E', 'avc1.4D001E', 'avc1.64001E', 'avc1.42E01E'],
            'vp9': ['vp09.00.10.08', 'vp09.00.10.08.01.01.01.01.00'],
            'vp8': ['vp8'],
            'av1': ['av01.0.04M.08', 'av01.0.05M.08'],
        };

        const resolutions = [
            { width: 3840, height: 2160, name: '4K' },
            { width: 2560, height: 1440, name: '1440p' },
            { width: 1920, height: 1080, name: '1080p' },
            { width: 1280, height: 720, name: '720p' },
            { width: 640, height: 360, name: '360p' },
        ];

        const capabilities = {};

        for (const [codecName, variations] of Object.entries(codecs)) {
            capabilities[codecName] = {
                supported: false,
                variations: {},
                maxResolution: null,
            };

            for (const codecString of variations) {
                const variationResults = [];

                for (const res of resolutions) {
                    const config = {
                        codec: codecString,
                        width: res.width,
                        height: res.height,
                        framerate: 30,
                        bitrate: 5_000_000,
                    };

                    try {
                        const support = await VideoEncoder.isConfigSupported(config);
                        if (support.supported) {
                            variationResults.push(res);
                            capabilities[codecName].supported = true;
                            
                            if (!capabilities[codecName].maxResolution ||
                                res.width > capabilities[codecName].maxResolution.width) {
                                capabilities[codecName].maxResolution = res;
                            }
                        }
                    } catch (error) {
                        // Not supported
                    }
                }

                if (variationResults.length > 0) {
                    capabilities[codecName].variations[codecString] = variationResults;
                }
            }
        }

        return capabilities;
    }
}

/**
 * Enhanced WebGL Recorder with automatic codec negotiation
 */
export class Recorder {
    constructor(canvas, options = {}) {
        // Validation
        if (!(canvas instanceof HTMLCanvasElement)) {
            throw new TypeError('WebGLRecorder requires a valid HTMLCanvasElement');
        }

        const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!ctx) {
            throw new Error('Canvas does not have a WebGL context');
        }

        this._canvas = canvas;
        this._gl = ctx;
        this._state = RecorderState.IDLE;
        this._error = null;

        // Configuration
        this._config = this._normalizeConfig(options);
        
        // Negotiated configuration (filled during startRecording)
        this._negotiatedConfig = null;

        // Recording state
        this._output = null;
        this._canvasSource = null;
        this._frameCount = 0;
        this._startTime = 0;
        this._pausedTime = 0;
        this._lastFrameTime = 0;

        // Snapshot state
        this._snapshotCanvas = null;
        this._snapshotContext = null;

        // Statistics
        this._stats = {
            framesRecorded: 0,
            framesCaptured: 0,
            framesDropped: 0,
            recordingDuration: 0,
            fileSize: 0,
            startTimestamp: 0,
            endTimestamp: 0,
        };

        this._destroyed = false;
    }

    _normalizeConfig(options) {
        const defaults = {
            codec: 'avc',
            frameRate: 30,
            bitrate: QUALITY_HIGH,
            fastStart: 'in-memory',
            keyFrameInterval: 2,
            hardwareAcceleration: 'prefer-hardware',
            latencyMode: 'quality',
            bitrateMode: 'variable',
            snapshotFormat: 'png',
            snapshotQuality: 0.95,
            targetFrameTime: null,
            dropFramesWhenBehind: true,
            
            // NEW: Auto-negotiation options
            autoNegotiate: true,          // Automatically find supported config
            allowCodecFallback: true,      // Allow falling back to different codec
            allowResolutionScaling: true,  // Allow scaling resolution
            allowBitrateAdjustment: true,  // Allow adjusting bitrate
            preferredFormat: 'mp4',        // 'mp4' or 'webm'
            
            // Callbacks
            onFrameEncoded: null,
            onProgress: null,
            onStateChange: null,
            onError: null,
            onConfigNegotiated: null,      // NEW: Called when config is negotiated
        };

        const config = { ...defaults, ...options };

        if (config.targetFrameTime === null) {
            config.targetFrameTime = 1000 / config.frameRate;
        }

        return config;
    }

    // Public API - same as before
    get state() { return this._state; }
    get isRecording() { return this._state === RecorderState.RECORDING; }
    get isPaused() { return this._state === RecorderState.PAUSED; }
    get isDestroyed() { return this._destroyed; }
    get error() { return this._error; }

    /**
     * Get the negotiated configuration (available after startRecording)
     */
    get negotiatedConfig() {
        return this._negotiatedConfig;
    }

    getStats() {
        return {
            ...this._stats,
            state: this._state,
            frameRate: this._config.frameRate,
            resolution: {
                width: this._canvas.width,
                height: this._canvas.height,
            },
            negotiated: this._negotiatedConfig,
        };
    }

    async startRecording() {
        this._assertNotDestroyed();
        
        if (this._state === RecorderState.RECORDING) {
            console.warn('Already recording');
            return;
        }

        if (this._state === RecorderState.PAUSED) {
            this.resume();
            return;
        }

        try {
            this._setState(RecorderState.RECORDING);
            
            // NEW: Negotiate codec configuration
            if (this._config.autoNegotiate) {
                const negotiation = await CodecNegotiator.findSupportedConfig(
                    this._canvas,
                    this._config
                );

                if (!negotiation.supported) {
                    throw new Error(
                        'No supported encoder configuration found. ' +
                        'Your browser may not support video encoding, or the resolution may be too large.'
                    );
                }

                this._negotiatedConfig = negotiation.negotiated;
                
                // Notify about negotiation
                if (this._config.onConfigNegotiated) {
                    this._config.onConfigNegotiated(this._negotiatedConfig);
                }

                console.log('[Recorder] Using negotiated config:', this._negotiatedConfig);
            } else {
                // Use original config without negotiation
                this._negotiatedConfig = {
                    codec: this._config.codec,
                    codecString: this._getCodecString(this._config.codec),
                    width: this._canvas.width,
                    height: this._canvas.height,
                    bitrate: typeof this._config.bitrate === 'number' 
                        ? this._config.bitrate 
                        : 5_000_000,
                    frameRate: this._config.frameRate,
                    hardwareAcceleration: this._config.hardwareAcceleration,
                };
            }

            // Initialize output with negotiated config
            await this._initializeOutput();
            
            // Reset timing
            this._startTime = performance.now();
            this._pausedTime = 0;
            this._lastFrameTime = this._startTime;
            this._frameCount = 0;
            
            // Reset stats
            this._stats = {
                framesRecorded: 0,
                framesCaptured: 0,
                framesDropped: 0,
                recordingDuration: 0,
                fileSize: 0,
                startTimestamp: performance.now(),
                endTimestamp: 0,
            };

        } catch (error) {
            this._handleError(error);
            throw error;
        }
    }

    pause() {
        this._assertNotDestroyed();
        
        if (this._state !== RecorderState.RECORDING) {
            console.warn('Cannot pause: not recording');
            return;
        }

        this._setState(RecorderState.PAUSED);
        this._pausedTime = performance.now();
    }

    resume() {
        this._assertNotDestroyed();
        
        if (this._state !== RecorderState.PAUSED) {
            console.warn('Cannot resume: not paused');
            return;
        }

        this._setState(RecorderState.RECORDING);
        
        const pauseDuration = performance.now() - this._pausedTime;
        this._startTime += pauseDuration;
        this._lastFrameTime += pauseDuration;
    }

    async stopRecording() {
        this._assertNotDestroyed();
        
        if (this._state !== RecorderState.RECORDING && this._state !== RecorderState.PAUSED) {
            console.warn('Cannot stop: not recording');
            return null;
        }

        try {
            this._setState(RecorderState.FINALIZING);
            
            if (this._canvasSource) {
                this._canvasSource.close();
            }

            await this._output.finalize();
            
            const result = await this._getRecordingResult();
            
            this._stats.endTimestamp = performance.now();
            this._stats.recordingDuration = (this._stats.endTimestamp - this._stats.startTimestamp) / 1000;
            this._stats.fileSize = result.blob.size;
            
            this._cleanup();
            this._setState(RecorderState.IDLE);
            
            return result;

        } catch (error) {
            this._handleError(error);
            throw error;
        }
    }

    captureFrame() {
        this._assertNotDestroyed();
        
        if (this._state !== RecorderState.RECORDING) {
            return false;
        }

        try {
            const now = performance.now();
            const elapsed = now - this._lastFrameTime;
            
            const shouldCapture = elapsed >= this._config.targetFrameTime;
            
            if (!shouldCapture && this._config.dropFramesWhenBehind) {
                return false;
            }

            const timestamp = (now - this._startTime) / 1000;
            const duration = 1 / this._config.frameRate;

            this._canvasSource.add(timestamp, duration);
            
            this._lastFrameTime = now;
            this._frameCount++;
            this._stats.framesRecorded++;
            this._stats.framesCaptured++;
            
            if (this._config.onFrameEncoded) {
                this._config.onFrameEncoded({
                    frameNumber: this._frameCount,
                    timestamp,
                    duration,
                });
            }

            if (this._config.onProgress) {
                this._config.onProgress({
                    framesRecorded: this._stats.framesRecorded,
                    duration: timestamp,
                });
            }

            return true;

        } catch (error) {
            console.error('Frame capture failed:', error);
            this._stats.framesDropped++;
            return false;
        }
    }

    async takeSnapshot(options = {}) {
        this._assertNotDestroyed();
        
        const config = {
            format: options.format || this._config.snapshotFormat,
            quality: options.quality || this._config.snapshotQuality,
            trim: options.trim !== false,
        };

        try {
            if (!this._snapshotCanvas) {
                this._snapshotCanvas = document.createElement('canvas');
                this._snapshotContext = this._snapshotCanvas.getContext('2d', {
                    willReadFrequently: false,
                });
            }

            const { width, height } = this._canvas;
            
            const pixels = new Uint8Array(width * height * 4);
            this._gl.readPixels(0, 0, width, height, this._gl.RGBA, this._gl.UNSIGNED_BYTE, pixels);
            
            this._flipPixelsVertically(pixels, width, height);
            
            const imageData = new ImageData(new Uint8ClampedArray(pixels), width, height);
            
            this._snapshotCanvas.width = width;
            this._snapshotCanvas.height = height;
            this._snapshotContext.putImageData(imageData, 0, 0);
            const fullDataURL = this._snapshotCanvas.toDataURL(`image/${config.format}`, config.quality);
            
            let trimmedDataURL = null;
            if (config.trim) {
                trimmedDataURL = this._createTrimmedSnapshot(imageData, config);
            }
            
            return {
                full: fullDataURL,
                trimmed: trimmedDataURL,
                width,
                height,
            };

        } catch (error) {
            console.error('Snapshot failed:', error);
            throw error;
        }
    }

    destroy() {
        if (this._destroyed) {
            return;
        }

        if (this._state === RecorderState.RECORDING || this._state === RecorderState.PAUSED) {
            this._canvasSource?.close();
            this._output?.finalize().catch(() => {});
        }

        this._cleanup();
        this._destroyed = true;
        this._setState(RecorderState.IDLE);
    }

    // Private methods
    _getCodecString(codec) {
        const codecStrings = {
            'avc': 'avc1.42001E',  // Baseline
            'vp9': 'vp09.00.10.08',
            'vp8': 'vp8',
            'av1': 'av01.0.04M.08',
        };
        return codecStrings[codec] || 'avc1.42001E';
    }

    async _initializeOutput() {
        // Choose format based on codec
        const useWebM = ['vp8', 'vp9', 'av1'].includes(this._negotiatedConfig.codec) &&
                        this._config.preferredFormat === 'webm';

        const format = useWebM
            ? new WebMOutputFormat()
            : new Mp4OutputFormat({ fastStart: this._config.fastStart });

        this._output = new Output({
            format,
            target: new BufferTarget(),
        });

        
        this._canvasSource = new CanvasSource(this._canvas, {
            codec: this._negotiatedConfig.codec,
            bitrate: this._negotiatedConfig.bitrate,
            keyFrameInterval: this._config.keyFrameInterval,
            hardwareAcceleration: this._negotiatedConfig.hardwareAcceleration,
            latencyMode: this._config.latencyMode,
            bitrateMode: this._config.bitrateMode,
            
            // Handle resolution scaling if needed
            ...(this._negotiatedConfig.width !== this._canvas.width || 
                this._negotiatedConfig.height !== this._canvas.height ? {
                width: this._negotiatedConfig.width,
                height: this._negotiatedConfig.height,
                fit: 'contain',
            } : {}),
        });

        // Use negotiated dimensions (may be different from canvas size)
        const videoTrack = this._output.addVideoTrack(this._canvasSource,{
            width: this._negotiatedConfig.width,
            height: this._negotiatedConfig.height,
            frameRate: this._negotiatedConfig.frameRate,
        });



        await this._output.start();
    }

    async _getRecordingResult() {
        const buffer = this._output.target.buffer;
        const mimeType = this._output.format instanceof WebMOutputFormat 
            ? 'video/webm' 
            : 'video/mp4';
        const blob = new Blob([buffer], { type: mimeType });
        
        return {
            blob,
            url: URL.createObjectURL(blob),
            duration: this._stats.recordingDuration,
            frameCount: this._stats.framesRecorded,
            size: blob.size,
            width: this._negotiatedConfig.width,
            height: this._negotiatedConfig.height,
            codec: this._negotiatedConfig.codec,
            codecString: this._negotiatedConfig.codecString,
            negotiated: this._negotiatedConfig,
        };
    }

    _flipPixelsVertically(pixels, width, height) {
        const bytesPerRow = width * 4;
        const halfHeight = Math.floor(height / 2);
        const temp = new Uint8Array(bytesPerRow);

        for (let y = 0; y < halfHeight; y++) {
            const topOffset = y * bytesPerRow;
            const bottomOffset = (height - y - 1) * bytesPerRow;

            temp.set(pixels.subarray(topOffset, topOffset + bytesPerRow));
            pixels.copyWithin(topOffset, bottomOffset, bottomOffset + bytesPerRow);
            pixels.set(temp, bottomOffset);
        }
    }

    _createTrimmedSnapshot(imageData, config) {
        const { width, height } = imageData;
        const data = imageData.data;
        
        let xMin = width, xMax = -1, yMin = height, yMax = -1;

        for (let y = 0; y < height; y++) {
            let hasPixelInRow = false;
            const rowStart = y * width * 4;

            for (let x = 0; x < width; x++) {
                const alpha = data[rowStart + x * 4 + 3];
                if (alpha > 0) {
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

        if (xMax < xMin || yMax < yMin) {
            return null;
        }

        const trimWidth = xMax - xMin + 1;
        const trimHeight = yMax - yMin + 1;
        
        this._snapshotCanvas.width = trimWidth;
        this._snapshotCanvas.height = trimHeight;
        
        const trimmedImageData = this._snapshotContext.createImageData(trimWidth, trimHeight);
        const trimmedData = trimmedImageData.data;

        for (let y = 0; y < trimHeight; y++) {
            const srcRowStart = ((yMin + y) * width + xMin) * 4;
            const dstRowStart = y * trimWidth * 4;
            const rowBytes = trimWidth * 4;
            
            trimmedData.set(
                data.subarray(srcRowStart, srcRowStart + rowBytes),
                dstRowStart
            );
        }

        this._snapshotContext.putImageData(trimmedImageData, 0, 0);
        return this._snapshotCanvas.toDataURL(`image/${config.format}`, config.quality);
    }

    _cleanup() {
        this._canvasSource = null;
        this._output = null;
        this._frameCount = 0;
        this._startTime = 0;
        this._pausedTime = 0;
        this._lastFrameTime = 0;
        this._negotiatedConfig = null;
    }

    _setState(newState) {
        const oldState = this._state;
        this._state = newState;
        
        if (this._config.onStateChange) {
            this._config.onStateChange({ oldState, newState });
        }
    }

    _handleError(error) {
        this._error = error;
        this._setState(RecorderState.ERROR);
        
        if (this._config.onError) {
            this._config.onError(error);
        }
        
        this._cleanup();
    }

    _assertNotDestroyed() {
        if (this._destroyed) {
            throw new Error('Recorder has been destroyed');
        }
    }

    // Static methods
    static async isSupported() {
        try {
            if (!window.VideoEncoder || !window.VideoFrame) {
                return false;
            }

            const config = {
                codec: 'avc1.42001E',
                width: 1280,
                height: 720,
                framerate: 30,
                bitrate: 1000000,
            };

            const support = await VideoEncoder.isConfigSupported(config);
            return support.supported;

        } catch (error) {
            return false;
        }
    }

    static async getSupportedCodecs() {
        const codecs = ['avc', 'vp9', 'vp8', 'av1'];
        const codecStrings = {
            'avc': 'avc1.42001E',
            'vp9': 'vp09.00.10.08',
            'vp8': 'vp8',
            'av1': 'av01.0.04M.08',
        };
        
        const supported = [];
        
        for (const codec of codecs) {
            try {
                const config = {
                    codec: codecStrings[codec],
                    width: 1280,
                    height: 720,
                    framerate: 30,
                    bitrate: 1000000,
                };
                
                const result = await VideoEncoder.isConfigSupported(config);
                if (result.supported) {
                    supported.push(codec);
                }
            } catch (error) {
                // Not supported
            }
        }
        
        return supported;
    }

    /**
     * NEW: Get detailed codec capabilities for this browser
     */
    static async getCodecCapabilities() {
        return await CodecNegotiator.getCodecCapabilities();
    }

    /**
     * NEW: Test if a specific configuration is supported
     */
    static async isConfigSupported(canvas, options) {
        const result = await CodecNegotiator.findSupportedConfig(canvas, {
            codec: options.codec || 'avc',
            frameRate: options.frameRate || 30,
            bitrate: options.bitrate || 5_000_000,
        });

        return result.supported;
    }
}
