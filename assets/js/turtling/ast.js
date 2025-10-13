export class ASTNode {
    constructor(type, value, children = [], meta = {}) {
        this.type = type;
        this.value = value;
        this.meta = meta;
        this.children = children;
    }
    assign_meta(key, attr) {
        this.meta[key] = attr
        return this
    }
}
