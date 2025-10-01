export class ASTNode {
    constructor(type, value, children = [], meta = {}) {
        this.type = type;
        this.value = value;
        this.meta = meta;
        this.children = children;
        this.left = children[0]
        this.right = children[1]
    }

    assign_meta(key, attr) {
        this.meta[key] = attr
        return this
    }
}
