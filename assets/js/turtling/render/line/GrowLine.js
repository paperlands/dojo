import {
	InstancedInterleavedBuffer,
	InterleavedBufferAttribute,
	DynamicDrawUsage
} from '../../../utils/three-entry.js';
import { LineSegmentsGeometry } from '../../../utils/three-addons/lines/LineSegmentsGeometry.js';
import { Line2 } from '../../../utils/three-addons/lines/Line2.js';

// GrowLine — a fat-line polyline that GROWS by appending segments to a
// pre-allocated dynamic instanced buffer, instead of rebuilding the whole geometry
// each frame.
//
// A trail of N points = N-1 fat-line segments, each an instance of 6 floats
// (start.xyz, end.xyz) in an InstancedInterleavedBuffer, plus 6 floats of
// instance colour (rgb rgb) so one mesh can carry many hues — child ink:
// colour lives in the ink, not in stroke identity (spec id:child-ink,
// id:ft-d8-append-geometry).
//
// O(Δ) per frame. On capacity exhaust the Float32Arrays double; a *new*
// LineSegmentsGeometry is bound and the old one disposed. Rebinding instance
// buffers onto the same geometry leaves the WebGL VAO pointing at the old
// 512-slot buffer — live trails then stop drawing past the first double
// (~count 512). Three.js also refuses in-place array growth on an uploaded
// InterleavedBuffer (size mismatch throws). (id:ft-d8-append-geometry)

const INITIAL_SEGMENTS = 512;
const DEFAULT_RGB = [1, 1, 1];

export class GrowLine {
	constructor(material) {
		this._cap = INITIAL_SEGMENTS;   // capacity in segments
		this._segs = 0;                 // segments written
		this._synced = 0;               // segments uploaded to the GPU
		this._from = null;              // previous polyline endpoint [x,y,z]
		this._rgb = DEFAULT_RGB;        // last ink colour [r,g,b] in 0..1

		this._array = new Float32Array(this._cap * 6);
		this._colors = new Float32Array(this._cap * 6);
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

		this._cbuf = new InstancedInterleavedBuffer(this._colors, 6, 1);
		this._cbuf.setUsage(DynamicDrawUsage);
		this.geometry.setAttribute('instanceColorStart', new InterleavedBufferAttribute(this._cbuf, 3, 0));
		this.geometry.setAttribute('instanceColorEnd', new InterleavedBufferAttribute(this._cbuf, 3, 3));
	}

	// Grow to fit `segs` segments: double capacity, copy positions + colours,
	// fresh geometry + mesh rebind so the VAO tracks the new instance buffers.
	// (Same-geometry setAttribute left the GPU drawing the old buffer — trails
	// went dark after the first double. Live: slinky ~count 550.)
	_grow(segs) {
		while (this._cap < segs) this._cap *= 2;
		const grown = new Float32Array(this._cap * 6);
		grown.set(this._array.subarray(0, this._segs * 6));
		this._array = grown;
		const grownC = new Float32Array(this._cap * 6);
		grownC.set(this._colors.subarray(0, this._segs * 6));
		this._colors = grownC;

		const old = this.geometry;
		this.geometry = new LineSegmentsGeometry();
		this._bind();
		this.geometry.instanceCount = this._segs;
		this.mesh.geometry = this.geometry;
		old.dispose();
		this._synced = 0;   // re-upload everything into the fresh buffers
	}

	// Append polyline points, continuing from the previous endpoint (or starting a
	// fresh polyline). Each point past the join adds one segment. `rgb` is the ink
	// for new segments ([r,g,b] 0..1); hard edge — both ends of a segment share it.
	append(points, rgb) {
		if (!points || points.length === 0) return;
		if (rgb) this._rgb = rgb;
		const need = this._segs + (points.length - 1);
		if (need > this._cap) this._grow(need);

		const a = this._array;
		const c = this._colors;
		const [r, g, b] = this._rgb;
		let from = this._from || points[0];
		for (let i = 1; i < points.length; i++) {
			const p = points[i];
			const o = this._segs * 6;
			a[o] = from[0]; a[o + 1] = from[1]; a[o + 2] = from[2];
			a[o + 3] = p[0]; a[o + 4] = p[1]; a[o + 5] = p[2];
			c[o] = r; c[o + 1] = g; c[o + 2] = b;
			c[o + 3] = r; c[o + 4] = g; c[o + 5] = b;
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
		const rangeStart = this._synced * 6;
		const rangeCount = (this._segs - this._synced) * 6;
		this._ibuf.clearUpdateRanges();
		this._cbuf.clearUpdateRanges();
		if (this._synced > 0) {
			this._ibuf.addUpdateRange(rangeStart, rangeCount);
			this._cbuf.addUpdateRange(rangeStart, rangeCount);
		}
		this._ibuf.needsUpdate = true;
		this._cbuf.needsUpdate = true;
		this._synced = this._segs;
	}

	get segmentCount() { return this._segs; }

	dispose() {
		this.geometry.dispose();
	}
}
