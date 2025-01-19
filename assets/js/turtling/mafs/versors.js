export class Versor {
    // Pre-calculated constants
    static EPSILON = 1e-6;
    static CLEAN_THRESHOLD = 1e-10;
    static TWO_PI = 2 * Math.PI;

    constructor(w, x, y, z) {
        this.w = w;
        this.x = x;
        this.y = y;
        this.z = z;
    }

    static fromAxisAngle(axis, angle) {
        // Normalize angle more efficiently using modulo
        angle = angle % 720;
        angle = angle > 360 ? angle - 720 : angle < -360 ? angle + 720 : angle;
        const halfAngle = angle * (Math.PI / 360);

        // Fast path for zero rotation
        if (Math.abs(angle) < Versor.EPSILON) {
            return new Versor(1, 0, 0, 0);
        }

        // Compute length once
        const { x, y, z } = axis;
        const lengthSq = x * x + y * y + z * z;

        if (Math.abs(lengthSq - 1) > Versor.EPSILON) {
            const scale = 1 / Math.sqrt(lengthSq);
            const sinHalfAngle = Math.sin(halfAngle);
            return new Versor(
                Math.cos(halfAngle),
                x * scale * sinHalfAngle,
                y * scale * sinHalfAngle,
                z * scale * sinHalfAngle
            );
        }

        const sinHalfAngle = Math.sin(halfAngle);
        return new Versor(
            Math.cos(halfAngle),
            x * sinHalfAngle,
            y * sinHalfAngle,
            z * sinHalfAngle
        );
    }

    normalize() {
        const lengthSq = this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z;

        if (Math.abs(lengthSq - 1) > Versor.EPSILON) {
            const scale = 1 / Math.sqrt(lengthSq);
            this.w *= scale;
            this.x *= scale;
            this.y *= scale;
            this.z *= scale;
        }
        return this;
    }

    multiply(q) {
        // Avoid object creation for temporary results
        const w = this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z;
        const x = this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y;
        const y = this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x;
        const z = this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w;

        // Inline normalization for better perf
        const lengthSq = w * w + x * x + y * y + z * z;
        if (Math.abs(lengthSq - 1) > Versor.EPSILON) {
            const scale = 1 / Math.sqrt(lengthSq);
            return new Versor(w * scale, x * scale, y * scale, z * scale);
        }
        return new Versor(w, x, y, z);
    }

    rotate(v) {
        // Optimized identity quaternion check
        if (Math.abs(this.w - 1) < Versor.EPSILON &&
            Math.abs(this.x) < Versor.EPSILON &&
            Math.abs(this.y) < Versor.EPSILON &&
            Math.abs(this.z) < Versor.EPSILON) {
            return { x: v.x, y: v.y, z: v.z };
        }

        // Direct calculation without creating intermediate Versor objects
        const w2 = this.w * this.w;
        const x2 = this.x * this.x;
        const y2 = this.y * this.y;
        const z2 = this.z * this.z;

        const wx = this.w * this.x;
        const wy = this.w * this.y;
        const wz = this.w * this.z;
        const xy = this.x * this.y;
        const xz = this.x * this.z;
        const yz = this.y * this.z;

        return {
            x: (w2 + x2 - y2 - z2) * v.x + 2 * (xy - wz) * v.y + 2 * (xz + wy) * v.z,
            y: 2 * (xy + wz) * v.x + (w2 - x2 + y2 - z2) * v.y + 2 * (yz - wx) * v.z,
            z: 2 * (xz - wy) * v.x + 2 * (yz + wx) * v.y + (w2 - x2 - y2 + z2) * v.z
        };
    }

    getTransformValues() {
        // Compute squared terms once
        const x2 = this.x * this.x;
        const y2 = this.y * this.y;
        const z2 = this.z * this.z;
        const xy = this.x * this.y;
        const xz = this.x * this.z;
        const yz = this.y * this.z;
        const wx = this.w * this.x;
        const wy = this.w * this.y;
        const wz = this.w * this.z;

        // cleanup transforms against threshold
        const clean = v => Math.abs(v) < Versor.CLEAN_THRESHOLD ? 0 : v;

        return {
            a: clean(1 - 2 * (y2 + z2)),
            b: clean(2 * (xy + wz)),
            c: clean(2 * (xy - wz)),
            d: clean(1 - 2 * (x2 + z2)),
            e: 0,
            f: 0
        };
    }
}
