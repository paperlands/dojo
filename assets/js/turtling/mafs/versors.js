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
                x: Number(v.x),
                y: Number(v.y),
                z: Number(v.z)
            };
        }

        // Efficient quaternion rotation: v' = q * v * q*
        // Using optimized formula: v' = v + 2 * qv × (qv × v + qw * v)
        // where qv = (qx, qy, qz) and qw = this.w

        const qx = this.x, qy = this.y, qz = this.z, qw = this.w;
        const vx = v.x, vy = v.y, vz = v.z;

        // First cross product: qv × v
        const cx1 = qy * vz - qz * vy;
        const cy1 = qz * vx - qx * vz;
        const cz1 = qx * vy - qy * vx;

        // qv × v + qw * v
        const tx = cx1 + qw * vx;
        const ty = cy1 + qw * vy;
        const tz = cz1 + qw * vz;

        // Second cross product: qv × (qv × v + qw * v)
        const cx2 = qy * tz - qz * ty;
        const cy2 = qz * tx - qx * tz;
        const cz2 = qx * ty - qy * tx;

        // Final result: v + 2 * (qv × (qv × v + qw * v))
        return {
            x: Number(vx + 2 * cx2),
            y: Number(vy + 2 * cy2),
            z: Number(vz + 2 * cz2)
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
