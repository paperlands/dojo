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

    static fromAxisAngle(axis, angle) {
        // Normalize angle to prevent overflow
        angle = angle % 360;
        const halfAngle = (angle * Math.PI) / 360;

        // Handle identity rotation precisely
        if (Math.abs(angle) < Versor.EPSILON) {
            return new Versor(1, 0, 0, 0);
        }

        const sinHalfAngle = Math.sin(halfAngle);
        const cosHalfAngle = Math.cos(halfAngle);

        // Normalize axis
        const length = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
        if (length < Versor.EPSILON) {
            return new Versor(1, 0, 0, 0);
        }

        const scale = sinHalfAngle / length;
        return new Versor(
            cosHalfAngle,
            axis.x * scale,
            axis.y * scale,
            axis.z * scale
        );
    }

    multiply(q) {
        const w = this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z;
        const x = this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y;
        const y = this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x;
        const z = this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w;

        return new Versor(w, x, y, z);
    }

    rotate(v) {
        // Optimize identity quaternion case
        if (Math.abs(this.w - 1) < Versor.EPSILON &&
            Math.abs(this.x) < Versor.EPSILON &&
            Math.abs(this.y) < Versor.EPSILON &&
            Math.abs(this.z) < Versor.EPSILON) {
            return {
                x: Number(v.x), // Ensure numeric type
                y: Number(v.y),
                z: Number(v.z)
            };
        }

        // For non-identity quaternions, use precise rotation
        const ix = this.w * v.x + this.y * v.z - this.z * v.y;
        const iy = this.w * v.y + this.z * v.x - this.x * v.z;
        const iz = this.w * v.z + this.x * v.y - this.y * v.x;
        const iw = -this.x * v.x - this.y * v.y - this.z * v.z;

        return {
            x: Number(ix * this.w + iw * -this.x + iy * -this.z - iz * -this.y),
            y: Number(iy * this.w + iw * -this.y + iz * -this.x - ix * -this.z),
            z: Number(iz * this.w + iw * -this.z + ix * -this.y - iy * -this.x)
        };
    }

    getTransformValues() {
        const x2 = this.x * this.x;
        const y2 = this.y * this.y;
        const z2 = this.z * this.z;
        const xy = this.x * this.y;
        const xz = this.x * this.z;
        const yz = this.y * this.z;
        const wx = this.w * this.x;
        const wy = this.w * this.y;
        const wz = this.w * this.z;

        return {
            a: Number(1 - 2 * (y2 + z2)),
            b: Number(2 * (xy + wz)),
            c: Number(2 * (xy - wz)),
            d: Number(1 - 2 * (x2 + z2)),
            e: 0,
            f: 0
        };
    }
}
