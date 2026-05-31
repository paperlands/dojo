import * as THREE from '../../utils/three.core.min.js';
import {ColorConverter} from '../../utils/color.js'

// Scratch for world-velocity orientation of frame-targeted heads (reused per frame).
const _hdDir = new THREE.Vector3();
const _hdWorld = new THREE.Quaternion();
const _hdFwd = new THREE.Vector3(1, 0, 0);   // head's nose points +x


export default class Head {
    constructor(scene) {
        const defaultColors = {
            head: "#e77808",
            wireframe: "black"
        };
        
        this.defaultPosition = [0, 0, 0];
        this.defaultRotation = {w:1, x:0, y:0, z:0};

        this.colors = {
            head: ColorConverter.toRGBArray(defaultColors.head),
            headkey: defaultColors.head,
            wireframe: ColorConverter.toHex(defaultColors.wireframe)
        };

        this.current = {scale: 1, size: 10};
        this.scene = scene;
        this.turtleGroup = new THREE.Group();

        this.createTurtleMesh();
        
        // Render AFTER scene geometry, but still use depth test
        this.turtleGroup.renderOrder = 10000;
        
        this.reset();
        scene.add(this.turtleGroup);
    }

    createTurtleMesh() {
        // Single unified geometry - no overlapping meshes
        const headGeometry = new HeadGeometry(this.colors);
        
        const headMaterial = new THREE.MeshBasicMaterial({
            vertexColors: true,
            wireframe: false,
            side: THREE.DoubleSide,
            depthTest: true,
            depthWrite: true
        });
        
        this.turtleMesh = new THREE.Mesh(headGeometry, headMaterial);
        this.turtleMesh.renderOrder = 10001;
        this.turtleGroup.add(this.turtleMesh);

        // Wireframe as separate layer - renders AFTER solid
        const edgeGeometry = new EdgeGeometry(this.colors);
        const edgeMaterial = new THREE.LineBasicMaterial({
            color: this.colors.wireframe,
            linewidth: 1,
            depthTest: true,
            depthWrite: false // Don't write depth for lines
        });

        this.wireframeMesh = new THREE.LineSegments(edgeGeometry, edgeMaterial);
        this.wireframeMesh.renderOrder = 10002;
        this.turtleGroup.add(this.wireframeMesh);
    }

    hide() {
        this.turtleGroup.visible = false;
    }

    show() {
        this.turtleGroup.visible = true;
    }

    position() {
        return this.turtleGroup.position;
    }

    setHeadColor(color) {
        this.colors.head = ColorConverter.toRGBArray(color);
        this.colors.headkey = color;
        
        this.turtleGroup.remove(this.turtleMesh);
        this.turtleGroup.remove(this.wireframeMesh);

        this.turtleMesh.geometry.dispose();
        this.turtleMesh.material.dispose();
        this.wireframeMesh.geometry.dispose();
        this.wireframeMesh.material.dispose();

        this.createTurtleMesh();
    }

    update(position, rotation, color, size=10) {
        this.turtleGroup.position.set(...position);
        // A normal head shows its heading directly. A frame-targeted head passes
        // rotation=null and is oriented by orientToWorld() instead — its local
        // heading cancels the layer group's rotation and would otherwise freeze.
        if (rotation) this.turtleGroup.quaternion.copy(rotation);

        if(this.colors.headkey !== color) {
            this.setHeadColor(color);
        }

        if(this.current.size != size) {
            this.turtleGroup.scale.setScalar(this.current.scale * size / this.current.size);
            this.current.size = size;
        }
    }

    // Orient a frame-targeted head along its WORLD-space velocity — the direction
    // its rendered position actually moves (the tangent of the projected ink). For
    // such a head the layer group itself rotates (its origin tracks the target), so
    // the local heading and group rotation can cancel and freeze the marker; only
    // world velocity tracks the visible curve. `worldPos` is the head's world
    // position, `groupQuat` its layer's world rotation; the head lives in the layer
    // frame, so the world look quaternion maps back via groupQuat⁻¹. Eased per-RAF.
    // (spec id:ft-d5-head)
    orientToWorld(worldPos, groupQuat, alpha = 0.35) {
        if (!this._prevWP) { this._prevWP = new THREE.Vector3().copy(worldPos); return; }
        const dx = worldPos.x - this._prevWP.x, dy = worldPos.y - this._prevWP.y, dz = worldPos.z - this._prevWP.z;
        this._prevWP.set(worldPos.x, worldPos.y, worldPos.z);
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (len < 1e-4) return;
        _hdDir.set(dx/len, dy/len, dz/len);
        _hdWorld.setFromUnitVectors(_hdFwd, _hdDir);   // +x → world velocity
        if (!this._targetQuat) this._targetQuat = new THREE.Quaternion();
        this._targetQuat.copy(groupQuat).invert().multiply(_hdWorld);   // → layer-local
        this.turtleGroup.quaternion.slerp(this._targetQuat, alpha);
    }

    scale(scaleFactor=2) {
        this.current.scaleFactor = scaleFactor;
        const value = scaleFactor * this.current.size/10;

        // Determine the magnitude (order of 10)
        const magnitude = Math.floor(Math.log10(Math.abs(value)));

        // Round to 1 significant figure
        const scale = Math.pow(10, magnitude);
        const roundedScaleFactor = Math.round(value / scale) * scale;

        if(this.current.scale != roundedScaleFactor) {
            this.current.scale = roundedScaleFactor;
            this.turtleGroup.scale.setScalar(this.current.scale);
        }
        
    }

    reset() {
        this.turtleGroup.position.set(...this.defaultPosition);
        this.turtleGroup.quaternion.copy(this.defaultRotation);
        this._prevWP = null;   // restart world-velocity tracking (frame-targeted heads)
    }
}

class HeadGeometry extends THREE.BufferGeometry {
    constructor(colors = {}) {
        super();

        const baseColor = colors.head || [1.0, 0.5, 0.1];
        
        // Create color variations for visual hierarchy
        const darkColor = ColorConverter.adjust(baseColor, 0.5)
        const brightColor = ColorConverter.adjust(baseColor, 1.5)        
        const vertices = [];
        const vertexColors = [];

         this.addTriangle(vertices, vertexColors,
            [6, 0, 0.5],     // Nose tip
            [2, -2, -0.2],   // Left nose wing
            [-1, -4, -0.1],  // Left wing tip (flattened)
            baseColor
        );

        // TOP surface for depth - right side (flattened)
        this.addTriangle(vertices, vertexColors,
            [6, 0, 0.5],     // Nose tip
            [-1, 4, -0.1],   // Right wing tip (flattened)
            [2, 2, -0.2],    // Right nose wing
            baseColor
        );

        // TAIL - Left fold pointing toward center (flattened)
        this.addTriangle(vertices, vertexColors,
            [-1, -4, -0.1],  // Left wing tip
            [-2, -2, 0],     // Left tail fold point
            [0, 0, 0],       // Center focus point
            baseColor
        );

        // TAIL - Right fold pointing toward center (flattened)
        this.addTriangle(vertices, vertexColors,
            [-1, 4, -0.1],   // Right wing tip
            [0, 0, 0],       // Center focus point
            [-2, 2, 0],      // Right tail fold point
            baseColor
        );

        // Additional face triangles to fill out the flattened shape
        // Central face triangle
        this.addTriangle(vertices, vertexColors,
            [2, -2, -0.2],   // Left nose wing
            [2, 2, -0.2],    // Right nose wing
            [0, 0, -0.3],    // Center bottom
            baseColor
        );

        // Back connection triangles (flattened)
        this.addTriangle(vertices, vertexColors,
            [-1, -4, -0.1],  // Left wing tip
            [-1, 4, -0.1],   // Right wing tip
            [0, 0, -0.3],    // Center bottom
            baseColor
        );

        // NOSE - Sharp nose pointing right (positive X direction)
        this.addTriangle(vertices, vertexColors,
            [6, 0, 0.5],     // Sharp nose tip (pointing right, slightly raised)
            [2, -2, -0.2],   // Left nose wing (flattened)
            [2, 2, -0.2],    // Right nose wing (flattened)
            brightColor
        );


        // BOTTOM surface for depth - creates minimal thickness (flattened)
        this.addTriangle(vertices, vertexColors,
            [2, -2, -0.2],   // Left nose wing
            [0, 0, -0.3],    // Bottom center (slightly lower for minimal thickness)
            [-1, -4, -0.1],  // Left wing tip
            darkColor
        );

        // BOTTOM right side (flattened)
        this.addTriangle(vertices, vertexColors,
            [2, 2, -0.2],    // Right nose wing
            [-1, 4, -0.1],   // Right wing tip
            [0, 0, -0.3],    // Bottom center
            darkColor
        );


        // BOTTOM KEEL/CHIN - for PITCH distinction (shows which way is down)
        this.addTriangle(vertices, vertexColors,
            [2, 0, -0.8],    // Bottom keel point (hangs down)
            [1, -1, -0.3],   // Left keel base
            [1, 1, -0.3],    // Right keel base
            darkColor  // Medium dark for bottom feature
        );

        // DIRECTIONAL ARROW ON TOP - clear forward indicator
        this.addTriangle(vertices, vertexColors,
            [4, 0, 0.6],     // Arrow tip (pointing forward/right)
            [3, -0.3, 0.4],  // Arrow left wing
            [3, 0.3, 0.4],   // Arrow right wing
            darkColor    // Dark shade for directional arrow
        );


        this.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        this.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertexColors), 3));
        this.computeVertexNormals();
    }

    addTriangle(vertices, colors, v1, v2, v3, color) {
        vertices.push(...v1, ...v2, ...v3);
        for (let i = 0; i < 3; i++) colors.push(...color);
    }

    addQuad(vertices, colors, v1, v2, v3, v4, color) {
        this.addTriangle(vertices, colors, v1, v2, v3, color);
        this.addTriangle(vertices, colors, v1, v3, v4, color);
    }
}

// Edge geometry for crisp outlines without z-fighting
class EdgeGeometry extends THREE.BufferGeometry {
    constructor(colors = {}) {
        super();

        const vertices = [];

        // Define outline edges only - no internal lines
         const outline = [
    
    [5, 0, 0.2], [0, -2.5, 0.2],
    [0, -2.5, 0.2], [0, 2.5, 0.2],
    [0, 2.5, 0.2], [5, 0, 0.2],
];
        vertices.push(...outline.flat());

        this.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    }
}
