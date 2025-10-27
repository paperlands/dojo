import * as THREE from './three.core.min.js';
// Utility class to convert various color formats to RGB arrays
export class ColorConverter {
    static toRGBArray(color) {
        if (Array.isArray(color)) {
            return color;
        }
        if (typeof color === 'string') {
            const threeColor = new THREE.Color(color);
            return [threeColor.r, threeColor.g, threeColor.b];
        }
        if (typeof color === 'number') {
            const threeColor = new THREE.Color(color);
            return [threeColor.r, threeColor.g, threeColor.b];
        }
        return [1.0, 1.0, 1.0];
    }

    static toHex(color) {
        if (typeof color === 'number') return color;
        if (typeof color === 'string') return new THREE.Color(color).getHex();
        if (Array.isArray(color)) return new THREE.Color(color[0], color[1], color[2]).getHex();
        return 0xffffff;
    }

    static adjust(color, mag=0.5) {
        if (!Array.isArray(color)) {
            color = this.toRGBArray(color)
        }

        if(mag<=1){
            return [color[0]*mag, color[1]*mag, color[2]*mag]
        } else {
           return  [
                Math.min(color[0] * 1.5, 1.0),
                Math.min(color[1] * 1.5, 1.0),
                Math.min(color[2] * 1.5, 1.0)
            ];
            
        }

    }
}

