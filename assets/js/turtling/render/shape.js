import * as THREE from '../../utils/three.core.min.js';
import earcut from '../../utils/earcut.js';

// Engine primitives - reusable computation pools
const TEMP_VEC3_A = new THREE.Vector3();
const TEMP_VEC3_B = new THREE.Vector3();
const TEMP_VEC3_C = new THREE.Vector3();
const TEMP_PLANE = new THREE.Plane();

/**
 * Core geometric utilities - zero-allocation where possible
 */

class GeometryUtils {
    static EPSILON = 1e-10;
    static MIN_AREA_THRESHOLD = 1e-10;

    /**
     * Fast planarity test using cached temporaries
     */
    static isPlanar(vertices, epsilon = 1e-6) {
        if (vertices.length < 4) return true;

        // Find first 3 non-collinear vertices to define plane
        let planeSet = false;
        let normal = new THREE.Vector3();
        let planePoint = vertices[0];

        for (let i = 2; i < vertices.length && !planeSet; i++) {
            const v1 = new THREE.Vector3().subVectors(vertices[1], vertices[0]);
            const v2 = new THREE.Vector3().subVectors(vertices[i], vertices[0]);
            normal.crossVectors(v1, v2);

            if (normal.lengthSq() > this.MIN_AREA_THRESHOLD) {
                normal.normalize();
                planeSet = true;
            }
        }

        if (!planeSet) return true; // Degenerate case

        // Test all vertices against the plane
        for (const vertex of vertices) {
            const distance = Math.abs(normal.dot(new THREE.Vector3().subVectors(vertex, planePoint)));
            if (distance > epsilon) return false;
        }

        return true;
    }

    /**
     * Ensure polygon is properly closed
     */
    static ensureClosed(vertices) {
        if (vertices.length < 3) return vertices;

        const first = vertices[0];
        const last = vertices[vertices.length - 1];
        const distance = first.distanceTo(last);

        if (distance > this.EPSILON) {
            // Not closed, add closing vertex
            return [...vertices, first.clone()];
        }

        return vertices;
    }

    /**
     * Project 3D polygon to 2D for triangulation
     */
    static projectTo2D(vertices) {
        if (vertices.length < 3) return { coords: [], indices: [] };

        // Calculate polygon normal
        const normal = new THREE.Vector3();
        for (let i = 0; i < vertices.length; i++) {
            const current = vertices[i];
            const next = vertices[(i + 1) % vertices.length];
            normal.x += (current.y - next.y) * (current.z + next.z);
            normal.y += (current.z - next.z) * (current.x + next.x);
            normal.z += (current.x - next.x) * (current.y + next.y);
        }
        normal.normalize();

        // Choose best projection plane based on largest normal component
        const absNormal = new THREE.Vector3(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z));
        let coords = [];

        if (absNormal.z >= absNormal.x && absNormal.z >= absNormal.y) {
            // Project to XY plane
            coords = vertices.flatMap(v => [v.x, v.y]);
        } else if (absNormal.x >= absNormal.y) {
            // Project to YZ plane
            coords = vertices.flatMap(v => [v.y, v.z]);
        } else {
            // Project to XZ plane
            coords = vertices.flatMap(v => [v.x, v.z]);
        }

        return { coords, normal };
    }

    /**
     *  triangulation using earcut algorithm
     */
    static triangulatePolygon(vertices) {
        if (vertices.length < 3) return [];
        if (vertices.length === 3) return [0, 1, 2];

        // Ensure polygon is closed
        const closedVertices = this.ensureClosed(vertices);

        // Remove duplicate closing vertex for triangulation
        const triangulationVertices = closedVertices.slice(0, -1);

        if (triangulationVertices.length < 3) return [];

        try {
            // Project to 2D
            const { coords } = this.projectTo2D(triangulationVertices);

            // using earcut package for robust triangulation
            return earcut(coords);

        } catch (error) {
            console.warn('Triangulation failed, using fallback:', error);
            return this.improvedFanTriangulation(triangulationVertices);
        }
    }

    /**
     * Calculate signed area of triangle (positive for counter-clockwise)
     */
    static triangleArea(a, b, c) {
        return 0.5 * ((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
    }

    /**
     * Calculate polygon normal using Newell's method
     */
    static calculatePolygonNormal(vertices) {
        const normal = new THREE.Vector3();
        const n = vertices.length;

        for (let i = 0; i < n; i++) {
            const current = vertices[i];
            const next = vertices[(i + 1) % n];

            normal.x += (current.y - next.y) * (current.z + next.z);
            normal.y += (current.z - next.z) * (current.x + next.x);
            normal.z += (current.x - next.x) * (current.y + next.y);
        }

        return normal.normalize();
    }
}


/**
 * Z-fighting solution using render order and polygon offset instead of depth displacement
 */
class RenderLayerManager {
    constructor(options = {}) {
        this.currentRenderOrder = 0;
        this.renderOrderStep = options.renderOrderStep || 1;
        this.usePolygonOffset = options.usePolygonOffset !== false;
        this.polygonOffsetFactor = options.polygonOffsetFactor || -1;
        this.polygonOffsetUnits = options.polygonOffsetUnits || -1;
    }

    getNextRenderOrder() {
        const order = this.currentRenderOrder;
        this.currentRenderOrder += this.renderOrderStep;
        return order;
    }

    // Get polygon offset values for this layer
    getPolygonOffset(layer) {
        if (!this.usePolygonOffset) return { factor: 0, units: 0 };

        return {
            factor: this.polygonOffsetFactor * layer,
            units: this.polygonOffsetUnits * layer
        };
    }

    resetLayers() {
        this.currentRenderOrder = 0;
    }
}

/**
 * Simplified geometry builder - no depth manipulation
 */
class GeometryBuilder {
    constructor() {
        this.vertexBuffer = [];
        this.indexBuffer = [];
        this.normalBuffer = [];
    }

    reset() {
        this.vertexBuffer.length = 0;
        this.indexBuffer.length = 0;
        this.normalBuffer.length = 0;
    }

    addPolygon(vertices, options = {}) {
        if (vertices.length < 3) return;

        const {
            autoClose = true,

            forceTriangulation = false
        } = options;

        const startIndex = this.vertexBuffer.length / 3;

        // Ensure proper closure if requested
        const processedVertices = autoClose ?
            GeometryUtils.ensureClosed(vertices) : vertices;

        // Choose triangulation method
        let indices;
            indices = GeometryUtils.triangulatePolygon(processedVertices);


        if (indices.length === 0) {
            console.warn('Triangulation produced no indices');
            return;
        }

        // Add vertices
        for (const vertex of processedVertices) {
            this.vertexBuffer.push(vertex.x, vertex.y, vertex.z);
        }

        // Calculate and add normals
        const normal = GeometryUtils.calculatePolygonNormal(processedVertices);
        for (let i = 0; i < processedVertices.length; i++) {
            this.normalBuffer.push(normal.x, normal.y, normal.z);
        }

        // Add indices with offset
        for (const index of indices) {
            if (startIndex + index < this.vertexBuffer.length / 3) {
                this.indexBuffer.push(startIndex + index);
            }
        }
    }

    // Create final geometry
    createGeometry() {
        const geometry = new THREE.BufferGeometry();

        geometry.setAttribute('position',
            new THREE.Float32BufferAttribute(this.vertexBuffer, 3));
        geometry.setAttribute('normal',
            new THREE.Float32BufferAttribute(this.normalBuffer, 3));
        geometry.setIndex(this.indexBuffer);

        return geometry;
    }

    buildGeometry() {
        if (this.vertexBuffer.length === 0) return null;

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.vertexBuffer, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normalBuffer, 3));
        geometry.setIndex(this.indexBuffer);
        geometry.computeBoundingSphere();

        return geometry;
    }
}

/**
 * Material system with advanced z-fighting solutions
 */
class MaterialSystem {
    static createMaterial(options = {}, layerSettings = {}) {
        const materialProps = {
            color: options.color || 0x4a90e2,
            wireframe: options.wireframe || false,
            side: true ? THREE.DoubleSide : THREE.FrontSide,
            transparent: options.transparent || false,
            opacity: options.opacity || 1.0,
            depthTest: true,
            depthWrite: !options.transparent // Don't write depth for transparent materials
        };

        // Apply polygon offset if specified
        if (layerSettings.polygonOffset) {
            materialProps.polygonOffset = true;
            materialProps.polygonOffsetFactor = layerSettings.polygonOffset.factor;
            materialProps.polygonOffsetUnits = layerSettings.polygonOffset.units;
        }

        return new THREE.MeshBasicMaterial(materialProps);
    }
}

/**
 * Main shape filler - using render order instead of Z displacement
 */
export default class Shape {
    constructor(scene, options = {}) {
        this.scene = scene;

        // Choose z-fighting solution method
        this.layerMethod = options.layerMethod || 'renderOrder'; // 'renderOrder', 'polygonOffset', 'stencil'

        // Initialize appropriate layer manager
        switch (this.layerMethod) {
            case 'polygonOffset':
                this.layerManager = new RenderLayerManager({
                    usePolygonOffset: true,
                    ...options.polygonOffset
                });
                break;

            default:
                this.layerManager = new RenderLayerManager({
                    usePolygonOffset: false,
                    ...options.renderOrder
                });
        }

        this.meshes = []; // Track all created meshes

        // Configuration
        this.autoLayering = options.autoLayering !== false;

        // Performance tracking
        this.stats = {
            totalPolygons: 0,
            totalVertices: 0,
            totalMeshes: 0
        };
    }

    /**
     * Add a polygon shape using render-based layering (no Z displacement)
     */
    addPolygon(vertices, options = {}) {
        if (!vertices || vertices.length < 3) {
            console.warn('Invalid polygon: need at least 3 vertices');
            return null;
        }

        // Convert to Vector3 if needed
        const processedVertices = vertices.map(v =>
            v instanceof THREE.Vector3 ? v : new THREE.Vector3(v.x, v.y, v.z)
        );

        // Validate polygon planarity
        if (!GeometryUtils.isPlanar(processedVertices, options.planarityTolerance || 0.01)) {
            console.warn('Non-planar polygon detected - results may vary');
        }

        // Create geometry at natural Z position
        const builder = new GeometryBuilder();
        builder.addPolygon(processedVertices);
        const geometry = builder.buildGeometry();

        if (!geometry) {
            console.warn('Failed to create geometry');
            return null;
        }

        // Get layer settings based on chosen method
        const layerSettings = this._getLayerSettings(options.layer);

        // Create material with layer-specific settings
        const material = MaterialSystem.createMaterial(options, layerSettings);
        const mesh = new THREE.Mesh(geometry, material);

        // Apply render order for sorting
        if (this.layerMethod === 'renderOrder' || this.layerMethod === 'polygonOffset') {
            mesh.renderOrder = layerSettings.renderOrder;
        }

        // Add metadata
        mesh.userData.shapeFiller = {
            layer: this._getCurrentLayer(),
            layerMethod: this.layerMethod,
            renderOrder: mesh.renderOrder
        };

        this.scene.add(mesh);
        this.meshes.push(mesh);

        // Advance layer if auto-layering is enabled
        if (this.autoLayering) {
            this._advanceLayer();
        }

        // Update stats
        this.stats.totalPolygons++;
        this.stats.totalVertices += processedVertices.length;
        this.stats.totalMeshes++;

        return mesh;
    }

    _getLayerSettings(explicitLayer) {
        const layer = explicitLayer !== undefined ? explicitLayer : this._getCurrentLayer();

        switch (this.layerMethod) {
            case 'polygonOffset':
                return {
                    renderOrder: this.layerManager.getNextRenderOrder(),
                    polygonOffset: this.layerManager.getPolygonOffset(layer)
                };


            default: // renderOrder
                return {
                    renderOrder: this.layerManager.getNextRenderOrder()
                };
        }
    }

    _getCurrentLayer() {
        switch (this.layerMethod) {
            default:
                return this.layerManager.currentRenderOrder;
        }
    }

    _advanceLayer() {
        switch (this.layerMethod) {
            default:
                this.layerManager.getNextRenderOrder();
        }
    }

    /**
     * Add multiple polygons as separate meshes
     */
    addPolygons(polygonList, options = {}) {
        const meshes = [];
        for (const vertices of polygonList) {
            const mesh = this.addPolygon(vertices, options);
            if (mesh) meshes.push(mesh);
        }
        return meshes;
    }

    /**
     * Clear all shapes and reset state
     */
    clear() {
        // Remove and dispose all meshes
        for (const mesh of this.meshes) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }

        this.meshes.length = 0;
        this.layerManager.resetLayers();

        // Reset stats
        this.stats.totalPolygons = 0;
        this.stats.totalVertices = 0;
        this.stats.totalMeshes = 0;
    }

    /**
     * Change layering method at runtime
     */
    setLayerMethod(method, options = {}) {
        this.layerMethod = method;

        switch (method) {
            case 'polygonOffset':
                this.layerManager = new RenderLayerManager({
                    usePolygonOffset: true,
                    ...options
                });
                break;
            default:
                this.layerManager = new RenderLayerManager({
                    usePolygonOffset: false,
                    ...options
                });
        }
    }

    /**
     * Get performance statistics
     */
    getStats() {
        return {
            ...this.stats,
            layerMethod: this.layerMethod,
            currentLayer: this._getCurrentLayer()
        };
    }

    /**
     * Get all created meshes
     */
    getMeshes() {
        return [...this.meshes];
    }

    /**
     * Remove a specific mesh
     */
    removeMesh(mesh) {
        const index = this.meshes.indexOf(mesh);
        if (index !== -1) {
            this.scene.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
            this.meshes.splice(index, 1);
            this.stats.totalMeshes--;
            return true;
        }
        return false;
    }

    /**
     * Dispose all resources
     */
    dispose() {
        this.clear();
    }
}
