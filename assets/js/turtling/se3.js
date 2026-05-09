// SE(3) rigid body transform — Versor + Vec3 tuple pair.
// Thin pairing over existing Versor. Position as [x,y,z] tuples (A1).
// Versor.raw() fast constructor (A4). Zero allocation in compose/translate.

import { Versor } from "./mafs/versors.js"

// Transform = { rotation: Versor, position: [x, y, z] }

export const SE3 = {
    identity() {
        return { rotation: Versor.raw(1, 0, 0, 0), position: [0, 0, 0] }
    },

    // Compose two transforms: a then b in local frame.
    // a.rotation * b.rotation, a.position + a.rotation.rotate(b.position)
    compose(a, b) {
        const [bx, by, bz] = a.rotation.rotateVec(b.position[0], b.position[1], b.position[2])
        return {
            rotation: a.rotation.multiply(b.rotation),
            position: [
                a.position[0] + bx,
                a.position[1] + by,
                a.position[2] + bz
            ]
        }
    },

    // Translate along local axes (heading = +x, up = +z, lateral = +y).
    translateLocal(t, dx, dy, dz) {
        const [wx, wy, wz] = t.rotation.rotateVec(dx, dy, dz)
        return {
            rotation: t.rotation,
            position: [
                t.position[0] + wx,
                t.position[1] + wy,
                t.position[2] + wz
            ]
        }
    },

    // Rotate around a local axis by angle (degrees).
    rotateLocal(t, axis, angle) {
        return {
            rotation: t.rotation.multiply(Versor.fromAxisAngle(axis, angle)),
            position: t.position
        }
    },

    clone(t) {
        return {
            rotation: Versor.raw(t.rotation.w, t.rotation.x, t.rotation.y, t.rotation.z),
            position: [t.position[0], t.position[1], t.position[2]]
        }
    },

    isValid(t) {
        const r = t.rotation
        const lenSq = r.w * r.w + r.x * r.x + r.y * r.y + r.z * r.z
        if (Math.abs(lenSq - 1) > 1e-6) return false
        const p = t.position
        if (isNaN(p[0]) || isNaN(p[1]) || isNaN(p[2])) return false
        return true
    }
}
