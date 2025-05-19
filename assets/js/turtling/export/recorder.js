// Canvas Recorder
// Example usage:
/*
// Create recorder
const recorder = new CanvasRecorder({
  canvas: document.getElementById('myCanvas'),
  framerate: 30,
  filename: 'my-animation'
});

// To start recording programmatically:
// recorder.start();

// Or trigger via events:
// document.dispatchEvent(new CustomEvent('startRecording'));

// To stop recording:
// document.dispatchEvent(new CustomEvent('stopRecording'));

// To remove when done:
// recorder.destroy();
*/

export class CameraRecorder {
  /**
   * Create a new CanvasRecorder
   * @param {Object} options - Configuration options
   * @param {HTMLCanvasElement} options.canvas - The canvas element to record
   * @param {number} [options.framerate=24] - Frames per second to capture
   * @param {string} [options.filename='frame'] - Base filename for saved images
   */
  constructor(options) {


    // Store configuration
    this.canvas = options.canvas;
    this.framerate = options.framerate || 24;
    this.filename = options.filename || 'frame';

    // Internal state
    this.frames = [];
    this.isRecording = false;
    this.frameCount = 0;
    this.startTime = null;
    this.animationFrameId = null;

    // Bind methods to maintain correct 'this' context
    this.captureFrame = this.captureFrame.bind(this);
    this.start = this.start.bind(this);
    this.stop = this.stop.bind(this);

    console.log(`CanvasRecorder initialized with framerate: ${this.framerate}fps`);
  }

  /**
   * Start recording frames from the canvas
   * @param {Event} [event] - Optional event that triggered recording
   */
  start(event) {
    if (this.isRecording) {
      console.warn('Recording already in progress');
      return;
    }

    console.log('Starting recording...');
    this.isRecording = true;
    this.frames = [];
    this.frameCount = 0;
    this.startTime = performance.now();

    // Start capture loop
    this._scheduleNextFrame();

    // Dispatch event to notify that recording has started
    document.dispatchEvent(new CustomEvent('recordingStarted'));
  }

  /**
   * Stop recording and save frames
   * @param {Event} [event] - Optional event that triggered stop
   */
  stop(event) {
    if (!this.isRecording) {
      console.warn('No recording in progress');
      return;
    }

    console.log(`Stopping recording. Captured ${this.frames.length} frames.`);
    this.isRecording = false;

    // Cancel any pending frame capture
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Save all captured frames
    this._saveFrames();

    // Dispatch event to notify that recording has stopped
    document.dispatchEvent(new CustomEvent('recordingStopped', {
      detail: { frameCount: this.frames.length }
    }));
  }

  /**
   * Schedule the next frame capture based on framerate
   * @private
   */
  _scheduleNextFrame() {
    if (!this.isRecording) return;

    const now = performance.now();
    const elapsed = now - this.startTime;
    const targetFrameTime = (this.frameCount * (1000 / this.framerate));

    // Calculate time until next frame should be captured
    const delay = Math.max(0, targetFrameTime - elapsed);

    // Schedule next frame capture
    this.animationFrameId = setTimeout(() => {
      this.captureFrame();
      this._scheduleNextFrame();
    }, delay);
  }

  /**
   * Capture current canvas frame
   */
  captureFrame() {
    if (!this.isRecording) return;

    try {
      // Get canvas image data as PNG
      const dataUrl = this.canvas.toDataURL('image/png');

      // Store frame data
      this.frames.push({
        index: this.frameCount,
        time: performance.now() - this.startTime,
        dataUrl: dataUrl
      });

      this.frameCount++;

      // Log progress occasionally
      if (this.frameCount % 10 === 0) {
        console.log(`Captured ${this.frameCount} frames`);
      }
    } catch (err) {
      console.error('Error capturing frame:', err);
    }
  }

  /**
   * Save all captured frames as PNG files
   * @private
   */
  _saveFrames() {
    console.log(`Saving ${this.frames.length} frames...`);

    if (this.frames.length === 0) {
      console.warn('No frames to save');
      return;
    }

    // Check if browser supports downloading multiple files
    // If JSZip is available, create a zip file
    if (typeof JSZip !== 'undefined') {
      this._saveAsZip();
    } else {
      // Otherwise download individual files
      this._saveIndividual();
    }
  }

  /**
   * Save frames as a zip file
   * @private
   */
  _saveAsZip() {
    console.log('Creating zip file of frames...');
    const zip = new JSZip();
    const folder = zip.folder('frames');

    // Add each frame to the zip
    this.frames.forEach((frame) => {
      const filename = `${this.filename}-${frame.index.toString().padStart(5, '0')}.png`;
      // Extract base64 data from dataURL
      const imageData = frame.dataUrl.split(',')[1];
      folder.file(filename, imageData, { base64: true });
    });

    // Generate and download the zip file
    zip.generateAsync({ type: 'blob' }).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'canvas-frames.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log('Zip file download initiated');
    }).catch(err => {
      console.error('Error creating zip file:', err);
    });
  }

  /**
   * Save frames as individual PNG files
   * @private
   */
  _saveIndividual() {
    console.log('Saving individual frame files...');

    // Create and download each frame
    this.frames.forEach((frame) => {
      const filename = `${this.filename}-${frame.index.toString().padStart(5, '0')}.png`;
      const a = document.createElement('a');
      a.href = frame.dataUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });

    console.log('All frames have been queued for download');
  }

  /**
   * Clean up event listeners when recorder is no longer needed
   */
  destroy() {
    // Stop recording if in progress
    if (this.isRecording) {
      this.stop();
    }

    // Remove event listeners
    document.removeEventListener('startRecording', this.start);
    document.removeEventListener('stopRecording', this.stop);

    console.log('CanvasRecorder destroyed');
  }
}
