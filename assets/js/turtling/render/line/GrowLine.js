import {
	InstancedInterleavedBuffer,
	InterleavedBufferAttribute,
	DynamicDrawUsage
} from '../../../utils/three.core.min.js';
import { LineSegmentsGeometry } from './LineSegmentsGeometry.js';
import { Line2 } from './Line2.js';

// GrowLine — a fat-line polyline that GROWS by appending segments to a
// pre-allocated dynamic instanced buffer, instead of rebuilding the whole geometry
// each frame.
//
// A trail of N points = N-1 fat-line segments, each an instance of 6 floats
// (start.xyz, end.xyz) in an InstancedInterleavedBuffer. The old trail rebuilt that
// buffer + a fresh LineGeometry + a bounding sphere on every dirty frame — O(N) per
// frame, O(N²) over a long animation, plus GC churn. GrowLine writes only the new
// segments into a persistent buffer and uploads only that range to the GPU:
// O(Δ) per frame, amortized O(1) per appended point (the buffer doubles on overflow,
// disposing the old geometry's GPU buffers as it goes). (spec id:ft-d8-append-geometry)

const INITIAL_SEGMENTS = 512;

export class GrowLine {
	constructor(material) {
		this._cap = INITIAL_SEGMENTS;   // capacity in segments
		this._segs = 0;                 // segments written
		this._synced = 0;               // segments uploaded to the GPU
		this._from = null;              // previous polyline endpoint [x,y,z]

		this._array = new Float32Array(this._cap * 6);
		this.geometry = new LineSegmentsGeometry();
		this._bind();
		this.geometry.instanceCount = 0;

		this.mesh = new Line2(this.geometry, material);
		// The trail spans the canvas and is solid (no dashes): no per-frame frustum
		// bbox, no line-distance recompute. Both were O(N)/frame on the old path.
		this.mesh.frustumCulled = false;
	}

	_bind() {
		this._ibuf = new InstancedInterleavedBuffer(this._array, 6, 1);
		this._ibuf.setUsage(DynamicDrawUsage);
		this.geometry.setAttribute('instanceStart', new InterleavedBufferAttribute(this._ibuf, 3, 0));
		this.geometry.setAttribute('instanceEnd', new InterleavedBufferAttribute(this._ibuf, 3, 3));
	}

	// Grow to fit `segs` segments: double capacity, copy, rebind onto a FRESH
	// geometry, and dispose the old one so its GPU buffers are freed (not leaked).
	_grow(segs) {
		while (this._cap < segs) this._cap *= 2;
		const grown = new Float32Array(this._cap * 6);
		grown.set(this._array.subarray(0, this._segs * 6));
		this._array = grown;

		const old = this.geometry;
		this.geometry = new LineSegmentsGeometry();
		this._bind();
		this.geometry.instanceCount = this._segs;
		this.mesh.geometry = this.geometry;
		old.dispose();
		this._synced = 0;   // re-upload everything into the fresh buffer
	}

	// Append polyline points, continuing from the previous endpoint (or starting a
	// fresh polyline). Each point past the join adds one segment.
	append(points) {
		if (!points || points.length === 0) return;
		const need = this._segs + (points.length - 1);
		if (need > this._cap) this._grow(need);

		const a = this._array;
		let from = this._from || points[0];
		for (let i = 1; i < points.length; i++) {
			const p = points[i];
			const o = this._segs * 6;
			a[o] = from[0]; a[o + 1] = from[1]; a[o + 2] = from[2];
			a[o + 3] = p[0]; a[o + 4] = p[1]; a[o + 5] = p[2];
			this._segs++;
			from = p;
		}
		this._from = from;
	}

	// Push the newly-appended segments to the GPU. Called once per frame; a no-op
	// when nothing was appended.
	sync() {
		if (this._segs === this._synced) return;
		this.geometry.instanceCount = this._segs;
		this._ibuf.clearUpdateRanges();
		if (this._synced > 0) {
			// Partial upload — only the appended range. (A fresh buffer after _grow
			// has _synced=0 and uploads in full.)
			this._ibuf.addUpdateRange(this._synced * 6, (this._segs - this._synced) * 6);
		}
		this._ibuf.needsUpdate = true;
		this._synced = this._segs;
	}

	get segmentCount() { return this._segs; }

	dispose() {
		this.geometry.dispose();
	}
}
