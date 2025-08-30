import * as THREE from '../../utils/three.core.min.js';

// Utility class to convert various color formats to RGB arrays
class ColorConverter {
    static toRGBArray(color) {
        if (Array.isArray(color)) {
            // Already an RGB array
            return color;
        }

        if (typeof color === 'string') {
            // Use THREE.js Color to parse CSS color names, hex, etc.
            const threeColor = new THREE.Color(color);
            return [threeColor.r, threeColor.g, threeColor.b];
        }

        if (typeof color === 'number') {
            // Hex number
            const threeColor = new THREE.Color(color);
            return [threeColor.r, threeColor.g, threeColor.b];
        }

        // Default fallback
        return [1.0, 1.0, 1.0]; // White
    }

    static toHex(color) {
        if (typeof color === 'number') {
            return color;
        }

        if (typeof color === 'string') {
            return new THREE.Color(color).getHex();
        }

        if (Array.isArray(color)) {
            return new THREE.Color(color[0], color[1], color[2]).getHex();
        }

        return 0xffffff; // White fallback
    }
}




export default class Head {
    constructor(scene) {
        // Default color palette with CSS color name support
        const defaultColors = {
            head: "DarkOrange",
            wireframe: "black"
        };
        this.defaultPosition= [0, 0, 0]
        this.defaultRotation = {w:1, x:0, y:0, z:0}

        this.colors = {
            head: ColorConverter.toRGBArray(defaultColors.head),
            headkey: defaultColors.head,
            wireframe: ColorConverter.toHex(defaultColors.wireframe)
        };

        this.scene = scene;
        this.turtleGroup = new THREE.Group();

        // Create the geometry and mesh
        this.createTurtleMesh();

        this.turtleGroup.renderOrder = 999;


        this.reset()
        scene.add(this.turtleGroup);
    }

    createTurtleMesh() {
        // Create the main turtle geometry with current colors
        const turtleGeometry = new HeadGeometry(this.colors);
        const turtleMaterial = new THREE.MeshBasicMaterial({
            vertexColors: true,
            wireframe: false,
            side: THREE.DoubleSide
        });
        // Main mesh - render first (deepest)
        // turtleMaterial.polygonOffset = true;
        // turtleMaterial.polygonOffsetFactor = -999;
        // turtleMaterial.polygonOffsetUnits = -999;
        this.turtleMesh = new THREE.Mesh(turtleGeometry, turtleMaterial);
        this.turtleGroup.add(this.turtleMesh);

        // Add wireframe overlay for better visibility
        const wireframeMaterial = new THREE.MeshBasicMaterial({
            wireframe: true,
            color: this.colors.wireframe,
            transparent: true,
            opacity: 0.5
        });

        this.wireframeMesh = new THREE.Mesh(turtleGeometry, wireframeMaterial);
        this.turtleGroup.add(this.wireframeMesh);
    }

    hide(){
        this.turtleGroup.visible = false;
    }

    show(){
        this.turtleGroup.visible = true;
    }

    position(){
        return this.turtleGroup.position
    }

    // Method to update colors and recreate the mesh
    setHeadColor(color) {
        this.colors.head = ColorConverter.toRGBArray(color)
        this.colors.headkey = color
        // Remove old meshes
        this.turtleGroup.remove(this.turtleMesh);
        this.turtleGroup.remove(this.wireframeMesh);

        // Dispose of old geometry and materials
        this.turtleMesh.geometry.dispose();
        this.turtleMesh.material.dispose();
        this.wireframeMesh.material.dispose();

        // Create new mesh with updated colors
        this.createTurtleMesh();
    }

    update(position, rotation, color, scaleFactor=1) {
        // Update position
        this.turtleGroup.position.set(...position);
        this.turtleGroup.quaternion.copy(rotation)

        if(this.colors.headkey !== color) {
            this.setHeadColor(color)
        }
        // Apply scale for scale invariance
        this.turtleGroup.scale.setScalar(scaleFactor);
    }

    reset(){
        this.turtleGroup.position.set(...this.defaultPosition);
        this.turtleGroup.quaternion.copy(this.defaultRotation)
    }
}

class HeadGeometry extends THREE.BufferGeometry {
    constructor(colors = {}) {
        super();

        const headColor = colors.head || [1.0, 0.5, 0.1];

        // Define vertices for turtle parts - now facing right (positive X) and flattened
        const vertices = [];
        const vertexColors = [];



        // TOP surface for depth - left side (flattened)
        this.addTriangle(vertices, vertexColors,
            [6, 0, 0.5],     // Nose tip
            [2, -2, -0.2],   // Left nose wing
            [-1, -4, -0.1],  // Left wing tip (flattened)
            headColor
        );

        // TOP surface for depth - right side (flattened)
        this.addTriangle(vertices, vertexColors,
            [6, 0, 0.5],     // Nose tip
            [-1, 4, -0.1],   // Right wing tip (flattened)
            [2, 2, -0.2],    // Right nose wing
            headColor
        );

        // TAIL - Left fold pointing toward center (flattened)
        this.addTriangle(vertices, vertexColors,
            [-1, -4, -0.1],  // Left wing tip
            [-2, -2, 0],     // Left tail fold point
            [0, 0, 0],       // Center focus point
            headColor
        );

        // TAIL - Right fold pointing toward center (flattened)
        this.addTriangle(vertices, vertexColors,
            [-1, 4, -0.1],   // Right wing tip
            [0, 0, 0],       // Center focus point
            [-2, 2, 0],      // Right tail fold point
            headColor
        );

        // Additional face triangles to fill out the flattened shape
        // Central face triangle
        this.addTriangle(vertices, vertexColors,
            [2, -2, -0.2],   // Left nose wing
            [2, 2, -0.2],    // Right nose wing
            [0, 0, -0.3],    // Center bottom
            headColor
        );

        // Back connection triangles (flattened)
        this.addTriangle(vertices, vertexColors,
            [-1, -4, -0.1],  // Left wing tip
            [-1, 4, -0.1],   // Right wing tip
            [0, 0, -0.3],    // Center bottom
            headColor
        );

        // DISTINCTIVE FEATURES FOR ROTATION CLARITY

        // Create color variations based on headColor
        const darkHeadColor = [headColor[0] * 0.3, headColor[1] * 0.3, headColor[2] * 0.3]; // Very dark
        const mediumDarkColor = [headColor[0] * 0.6, headColor[1] * 0.6, headColor[2] * 0.6]; // Medium dark
        const brightHeadColor = [Math.min(headColor[0] * 1.5, 1.0), Math.min(headColor[1] * 1.5, 1.0), Math.min(headColor[2] * 1.5, 1.0)]; // Bright
        const veryBrightColor = [Math.min(headColor[0] * 2.0, 1.0), Math.min(headColor[1] * 2.0, 1.0), Math.min(headColor[2] * 2.0, 1.0)]; // Very bright
                                                                                                                                           //
        // NOSE - Sharp nose pointing right (positive X direction)
        this.addTriangle(vertices, vertexColors,
            [6, 0, 0.5],     // Sharp nose tip (pointing right, slightly raised)
            [2, -2, -0.2],   // Left nose wing (flattened)
            [2, 2, -0.2],    // Right nose wing (flattened)
            headColor
        );


        // BOTTOM surface for depth - creates minimal thickness (flattened)
        this.addTriangle(vertices, vertexColors,
            [2, -2, -0.2],   // Left nose wing
            [0, 0, -0.3],    // Bottom center (slightly lower for minimal thickness)
            [-1, -4, -0.1],  // Left wing tip
            brightHeadColor
        );

        // BOTTOM right side (flattened)
        this.addTriangle(vertices, vertexColors,
            [2, 2, -0.2],    // Right nose wing
            [-1, 4, -0.1],   // Right wing tip
            [0, 0, -0.3],    // Bottom center
            brightHeadColor
        );


        // TOP DORSAL FIN - for ROLL distinction (shows which way is up)
        this.addTriangle(vertices, vertexColors,
            [1, 0, 1.5],     // Top fin peak (high up)
            [0, -1, 0.2],    // Left fin base
            [0, 1, 0.2],     // Right fin base
            veryBrightColor  // Brightest shade for top feature
        );

        // BOTTOM KEEL/CHIN - for PITCH distinction (shows which way is down)
        this.addTriangle(vertices, vertexColors,
            [2, 0, -0.8],    // Bottom keel point (hangs down)
            [1, -1, -0.3],   // Left keel base
            [1, 1, -0.3],    // Right keel base
            mediumDarkColor  // Medium dark for bottom feature
        );

        // DIRECTIONAL ARROW ON TOP - clear forward indicator
        this.addTriangle(vertices, vertexColors,
            [4, 0, 0.6],     // Arrow tip (pointing forward/right)
            [3, -0.3, 0.4],  // Arrow left wing
            [3, 0.3, 0.4],   // Arrow right wing
            darkHeadColor    // Dark shade for directional arrow
        );

        // Set attributes
        this.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
        this.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertexColors), 3));
        this.computeVertexNormals();
    }

    addTriangle(vertices, colors, v1, v2, v3, color) {
        // Add vertices
        vertices.push(...v1, ...v2, ...v3);
        // Add colors (RGB for each vertex)
        for (let i = 0; i < 3; i++) {
            colors.push(...color);
        }
    }
}
