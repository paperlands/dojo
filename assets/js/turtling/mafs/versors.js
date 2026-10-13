import { angular, coefficient, sum3 } from "../rigid_precision.js";

export class Versor {
    static EPSILON = Number.EPSILON;

    constructor(w, x, y, z) {
        this.w = w;
        this.x = x;
        this.y = y;
        this.z = z;
        // Immediate normalization of components
        this.normalize();
    }

    add(other) {
        return new Versor(
            this.w + other.w,
            this.x + other.x,
            this.y + other.y,
            this.z + other.z
        );
    }

    scale(s) {
        return {x: this.x * s, y: this.y * s, z: this.z * s};
    }

    normalize() {
        const lengthSq = this.w * this.w + this.x * this.x + this.y * this.y + this.z * this.z;
        if (Math.abs(lengthSq) > Versor.EPSILON) {
            const scale = 1 / Math.sqrt(lengthSq);
            this.w *= scale;
            this.x *= scale;
            this.y *= scale;
            this.z *= scale;
        }
        // Clean up near-zero components
        if (Math.abs(this.w) < Versor.EPSILON) this.w = 0;
        if (Math.abs(this.x) < Versor.EPSILON) this.x = 0;
        if (Math.abs(this.y) < Versor.EPSILON) this.y = 0;
        if (Math.abs(this.z) < Versor.EPSILON) this.z = 0;
        return this;
    }

    // Fast constructor — skips normalization for known-unit inputs.
    // Used by fromAxisAngle and products still inside the unit-norm error budget.
    static raw(w, x, y, z) {
        const v = Object.create(Versor.prototype);
        v.w = w; v.x = x; v.y = y; v.z = z;
        return v;
    }

    static fromAxisAngle(axis, angle) {
        // Normalize angle to prevent overflow
        angle = angle % 360;
        const halfAngle = (angle * Math.PI) / 360;

        // Handle identity rotation precisely
        if (angle === 0) {
            return Versor.raw(1, 0, 0, 0);
        }

        const sinHalfAngle = Math.sin(halfAngle);
        const cosHalfAngle = Math.cos(halfAngle);

        // Normalize axis. A shared unit axis is every ordinary turtle turn: its raw
        // squared length is exactly 1 — the correctly-rounded norm is 1 — so the
        // common case pays neither scaling nor hypot.
        const lengthSq = axis.x * axis.x + axis.y * axis.y + axis.z * axis.z;
        if (lengthSq === 1) {
            return Versor.raw(
                cosHalfAngle,
                axis.x * sinHalfAngle,
                axis.y * sinHalfAngle,
                axis.z * sinHalfAngle
            );
        }
        // At the edges of the number line the raw norm cannot be taken: scale the
        // largest component out first — a finite axis has a direction at any
        // magnitude. A zero axis has no turn. (P2: scale before norm)
        const m = Math.max(Math.abs(axis.x), Math.abs(axis.y), Math.abs(axis.z));
        if (m === 0) {
            return Versor.raw(1, 0, 0, 0);
        }
        const ux = axis.x / m, uy = axis.y / m, uz = axis.z / m;
        const length = Math.hypot(ux, uy, uz);

        // sin²(θ/2) + cos²(θ/2) = 1 by construction — skip normalize
        return Versor.raw(
            cosHalfAngle,
            (ux / length) * sinHalfAngle,
            (uy / length) * sinHalfAngle,
            (uz / length) * sinHalfAngle
        );
    }

    multiply(q) {
        // Clean angular state before it can accumulate into a direction.
        // This is the geometry's declared precision, not scalar rounding. (id:rotation-precision-boundary)
        const w = angular(this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z);
        const x = angular(this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y);
        const y = angular(this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x);
        const z = angular(this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w);
        // Unit × unit is unit algebraically; retain the existing norm repair budget.
        const normSq = w * w + x * x + y * y + z * z;
        if (Math.abs(normSq - 1) > 8 * Number.EPSILON) {
            const norm = Math.sqrt(normSq);
            return Versor.raw(w / norm, x / norm, y / norm, z / norm);
        }
        return Versor.raw(w, x, y, z);
    }

    rotate(v) {
        const [x, y, z] = this.rotateVec(Number(v.x), Number(v.y), Number(v.z));
        return { x, y, z };
    }

    // Rotate returning [x,y,z] tuple — zero object allocation.
    // For hot paths (commands, executor). See allocation discipline A1.
    rotateVec(vx, vy, vz) {
        if (this.w === 1 && this.x === 0 && this.y === 0 && this.z === 0) {
            return [vx, vy, vz];
        }
        // One bounded-precision action for movement, frames and readings.
        // Normalize coefficients before scaling distances; no coordinate floor.
        // Sparse heading action avoids unused columns. (id:rotation-precision-boundary)
        const w = this.w, x = this.x, y = this.y, z = this.z;
        const xx = x * x, yy = y * y, zz = z * z;
        const s = 2 / (w * w + xx + yy + zz);
        const a = coefficient(1 - s * (yy + zz));
        const b = coefficient(s * (x * y + w * z));
        const c = coefficient(s * (x * z - w * y));
        if (vy === 0 && vz === 0) return [a * vx, b * vx, c * vx];
        return [
            sum3(a * vx, coefficient(s * (x * y - w * z)) * vy, coefficient(s * (x * z + w * y)) * vz),
            sum3(b * vx, coefficient(1 - s * (xx + zz)) * vy, coefficient(s * (y * z - w * x)) * vz),
            sum3(c * vx, coefficient(s * (y * z + w * x)) * vy, coefficient(1 - s * (xx + yy)) * vz)
        ];
    }

    getTransformValues() {
        const w2 = this.w * this.w, x2 = this.x * this.x;
        const y2 = this.y * this.y, z2 = this.z * this.z;
        const s = 2 / (w2 + x2 + y2 + z2);
        const xy = this.x * this.y, wz = this.w * this.z;
        return {
            a: coefficient(1 - s * (y2 + z2)),
            b: coefficient(s * (xy + wz)),
            c: coefficient(s * (xy - wz)),
            d: coefficient(1 - s * (x2 + z2)),
            e: 0,
            f: 0
        };
    }
}
