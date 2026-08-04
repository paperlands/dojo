// The exact three.js surface dojo depends on — 23 symbols, named once.
//
// This is a CONTRACT, not a convenience. Every dojo-authored module imports
// three from here, so the whole dependency is legible in one file. Two
// enforcers: the bundler fails the build and names a vanished symbol; and
// test/js/three_entry_test.mjs asserts the same surface on the path CI already
// runs (CI never bundles). Without that, a vanished export is silently
// `undefined` at the call site — which is exactly how `THREE.sRGBEncoding` sat
// dead in stage.js for two years (removed upstream in r152), assigning nothing
// to nothing.
//
// It also settles, in one place, a split that eight files were each guessing at:
// three.core.min.js holds everything except the renderer; three.module.min.js
// holds WebGLRenderer (and imports core itself, so both files are one graph).
//
// NOT here on purpose:
//   - `Text` is troika (utils/threetext.js), a different dependency
//   - the fat-line addons under utils/three-addons/lines/ are pristine upstream
//     (same REVISION as core); they import three.module.min.js themselves (one
//     mechanical rewrite). GrowLine (turtling/render/line/) is dojo-owned.
//
// Provenance and hashes: assets/js/utils/VENDOR.org

export {
    BufferAttribute,
    BufferGeometry,
    Color,
    DoubleSide,
    DynamicDrawUsage,
    Float32BufferAttribute,
    FrontSide,
    GridHelper,
    Group,
    InstancedInterleavedBuffer,
    InterleavedBufferAttribute,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshBasicMaterial,
    MOUSE,
    PerspectiveCamera,
    Plane,
    Quaternion,
    Scene,
    TOUCH,
    Vector3,
} from './three.core.min.js'

export { WebGLRenderer } from './three.module.min.js'
