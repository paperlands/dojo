export class ASTNode {
    constructor(type, value, children = [], meta = {}) {
        this.type = type;
        this.value = value;
        this.meta = meta;
        this.children = children;
        // The alphabet's fifth field — { line, endLine } in true buffer
        // lines, stamped as the tokenizer walks (parse.js stamp).
        this.span = null;
    }
    assign_meta(key, attr) {
        this.meta[key] = attr
        return this
    }
}
