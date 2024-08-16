export class Versor {
    constructor(w, x, y, z) {
        this.w = w;
        this.x = x;
        this.y = y;
        this.z = z;
    }

    static fromAxisAngle(axis, angle) {
        const halfAngle = angle * Math.PI / 360;
        const sinHalfAngle = Math.sin(halfAngle);
        return new Versor(
            Math.cos(halfAngle),
            axis.x * sinHalfAngle,
            axis.y * sinHalfAngle,
            axis.z * sinHalfAngle
        );
    }

    multiply(q) {
        return new Versor(
            this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
            this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
            this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
            this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w
        );
    }

    rotate(v) {
        const qv = new Versor(0, v.x, v.y, v.z);
        const qConjugate = new Versor(this.w, -this.x, -this.y, -this.z);
        const rotated = this.multiply(qv).multiply(qConjugate);
        return { x: rotated.x, y: rotated.y, z: rotated.z };
    }

    toRotationMatrix() {
        const { w, x, y, z } = this;
        return [
            1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y),
            2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x),
            2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)
        ];
    }

    getTransformValues() {
        const rotationMatrix = this.toRotationMatrix();
        return {
            a: rotationMatrix[0],
            b: rotationMatrix[3],
            c: rotationMatrix[1],
            d: rotationMatrix[4],
            e: 0, // Translation in x
            f: 0  // Translation in y
        };
    }

}
