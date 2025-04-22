/**
 * Mafs.Typesetter: A self-contained math expression renderer for HTML5 Canvas
 * Inspired by TeX/LaTeX by Donald Knuth
 */
import { Parser } from "./parse.js";

export class Typesetter {
    constructor(ctx) {
        this.ctx = ctx;
        this.tokens = [];
        this.tokenTypes = [];
        this.tokenWidths = [];
        this.totalWidth = 0;
        this.opts = {
            fontSize: 80,
            baseColor: 'white',
            fontFamily: 'paperlang',
            lineWidth: 2,
            superscriptScale: 0.5,
            superscriptRise: 0.3,
        };

        this.parser = new Parser();

        this.operatorRegex = /[\/\*\^]/;

        // this.metricsCache = {}
    }

    write(text, opts) {
        this.tokens = []
        this.tokenTypes = [];
        this.tokenWidths = [];
        this.totalWidth = 0;

        this.setconfig(opts);
        this.lexer(text);
        this.draw(opts.x, opts.y, opts.align);
    }

    setconfig(options) {
        if (!options) return;

        // Only update font-related settings if they've changed
        const fontChanged =
            options.fontSize !== this.opts.fontSize ||
            options.fontFamily !== this.opts.fontFamily;

        Object.assign(this.opts, {
            fontSize: options.fontSize || this.opts.fontSize,
            baseColor: options.baseColor || this.opts.baseColor,
            fontFamily: options.fontFamily || this.opts.fontFamily,
            lineWidth: options.lineWidth || this.opts.fontSize/30,
            superscriptScale: options.superscriptScale || this.opts.superscriptScale,
            superscriptRise: options.superscriptRise || this.opts.superscriptRise,
        });

        // Update the font in the context only if needed
        if (fontChanged) {
            this.ctx.font = `${this.opts.fontSize}px ${this.opts.fontFamily}`;
        }
    }

    addToken(token, type) {
        if (type =="math") {
            console.log(token)
            this.tokens.push(token);
            this.tokenTypes.push(type);
            const measure = this.measureNode(token)
            const width =  measure && measure.width || 0
            this.tokenWidths.push(width);
            this.totalWidth += width;
        }
        else{
            this.tokens.push(token);
            this.tokenTypes.push(type);
            const width = this.ctx.measureText(token).width;
            this.tokenWidths.push(width);
            this.totalWidth += width;
        }

    }

    lexer(text) {
        if (!text) return [];

        //shortcircuit if no mafs
        if (!this.operatorRegex.test(text)) {
            this.addToken(text, "text")
            return this.tokens;
        }


        // Reset calculations
        const pretokens = text.split(/\s+/)

        const tokenlen = pretokens.length
        var tokeNode = ""
        for (let index = 0 ; index < tokenlen; index ++) {
            const currToken = pretokens[index]
            if(this.operatorRegex.test(currToken)){
                this.addToken(tokeNode, "text")
                tokeNode = ""

                this.addToken(this.parser.run(currToken), "math")

            } else {

                tokeNode += currToken + " "
            }
        }

        if (tokeNode.length>0) this.addToken(tokeNode, "text")

        return this.tokens;
    }

    /**
     * Get the total width of all tokens (pre-calculated)
     * @returns {number} - Total width in pixels
     */
    calculateWidth() {
        return this.totalWidth;
    }

    /**
     * Gets text metrics with caching.
     */
    getTextMetrics(text) {
        const metrics = this.ctx.measureText(text);
        return {
            width: metrics.width,
            height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
        };
    }

    /**
     Measure Mathematical Nodes
    */
    measureNode(node) {
        if (!node) return { width: 0, height: 0 };
        try {
            switch (node.type) {
            case 'operand':
                return this.getTextMetrics(node.value || "");
            case 'operator':
                return this.measureOperator(node);
            default:
                console.warn(`Unknown node type: ${node.type}`);
                return { width: 0, height: 0 };
            }
        } catch (error) {
            console.error("Error in renderNode:", error);
            return { width: 0, height: 0 };
        }
    }

    measureOperator(node) {
        const operator = node.value;

        // Special case for fractions
        if (operator === '/') {
            return this.measureFraction(node.children[0], node.children[1]);
        }

        // Special case for exponents (superscripts)
        if (operator === '^' || operator === '^-') {
            return this.measureSuperscript(node.children[0], node.children[1]);
        }

        // Handle unary operators
        if (node.children.length === 1) {
            const opMetrics = this.getTextMetrics(operator);
            const childDims = this.measureNode(node.children[0]);

            return {
                width: opMetrics.width + childDims.width,
                height: Math.max(opMetrics.height, childDims.height),
            };
        }

        // Handle binary operators
        const leftDims = this.measureNode(node.children[0]);
        const opMetrics = this.getTextMetrics(operator);
        const rightDims = this.measureNode(node.children[1]);

        return {
            width: leftDims.width + opMetrics.width + rightDims.width + this.opts.fontSize * 0.5,
            height: Math.max(leftDims.height, opMetrics.height, rightDims.height),
        };
    }

    /**
     * Measures a superscript expression without rendering it.
     */
    measureSuperscript(base, exponent) {
        const originalFontSize = this.opts.fontSize;

        const baseDims = this.measureNode(base);

        // Scale down for measuring the exponent
        this.opts.fontSize *= this.opts.superscriptScale;
        const expDims = this.measureNode(exponent);
        this.opts.fontSize = originalFontSize;

        return {
            width: baseDims.width + expDims.width,
            height: Math.max(baseDims.height, expDims.height + (this.opts.fontSize * this.opts.superscriptRise)),
        };
    }

    measureFraction(numerator, denominator) {
        if (numerator) {
            const numMetrics = numerator.value ? this.getTextMetrics(numerator.value) : this.measureNode(numerator);
            const denMetrics = denominator.value ? this.getTextMetrics(denominator.value) : this.measureNode(denominator);
            const fractionWidth = Math.max(numMetrics.width, denMetrics.width) + this.opts.fontSize * 0.5
            const vSpacing = this.opts.fontSize * 0.55;

            return {
                width: fractionWidth,
                height: 2 * vSpacing + this.opts.lineWidth,
                ascent: vSpacing,
                descent: vSpacing + this.opts.lineWidth
            };
        }
    }
    /**
     * Renders an AST node at the specified position.
     * This is a wrapper for the original renderNode with additional error handling.
     */
    renderNode(node, x, y) {
        if (!node) return { width: 0, height: 0 };

        try {
            switch (node.type) {
            case 'operand':
                return this.renderOperand(node, x, y);
            case 'operator':
                // Special handling for negative numbers
                if (node.value === '-' && node.children[0] &&
                    node.children[0].type === 'operand' &&
                    node.children[0].value === '0') {
                    return this.renderNegativeNumber(node.children[1], x, y);
                } else if (node.value === '/') {
                    return this.renderFraction(node.children[0], node.children[1], x, y);
                } else if (node.value === '^') {
                    return this.renderSuperscript(node.children[0], node.children[1], x, y);
                } else if (node.value === '^-') {
                    const negExponent = new ASTNode('operator', '-', [node.children[1]]);
                    return this.renderSuperscript(node.children[0], negExponent, x, y);
                } else {
                    return this.renderOperator(node, x, y);
                }
                // case 'function':
                //   return this.renderFunction(node, x, y);
            default:
                console.warn(`Unknown node type: ${node.type}`);
                this.ctx.fillText(node.value, x, y);
                return { width: 0, height: 0 };
            }
        } catch (error) {
            console.error("Error in renderNode:", error);
            return { width: 0, height: 0 };
        }
    }

    /**
     * Renders an operand (number or variable).
     */
    renderOperand(node, x, y) {
        this.ctx.fillStyle = this.opts.baseColor;

        const text = node.value || "";
        const metrics = this.getTextMetrics(text);

        this.ctx.fillText(text, x, y);

        return {
            width: metrics.width,
            height: this.opts.fontSize,
            ascent: metrics.ascent,
            descent: metrics.descent
        };
    }


    /**
     * Renders an operand (number or variable).
     */
    renderOperator(node, x, y) {
        this.ctx.fillStyle = this.opts.baseColor;

        const text = node.value || "";
        const metrics = this.getTextMetrics(text);

        this.renderNode(node.children[0], x, y)
        this.ctx.fillText(text, x, y);
        this.renderNode(node.children[1], x, y)

        return {
            width: metrics.width,
            height: this.opts.fontSize,
        };
    }

    /**
   * Renders a fraction with a numerator and denominator.
   */
    renderFraction(numerator, denominator, x, y) {
        // Measure text widths based on node type
        let numMetrics, denMetrics;

        if (numerator.type === 'operand') {
            numMetrics = this.getTextMetrics(numerator.value);
        } else {
            numMetrics = this.measureNode(numerator);
        }

        if (denominator.type === 'operand') {
            denMetrics = this.getTextMetrics(denominator.value);
        } else {
            denMetrics = this.measureNode(denominator);
        }

        const fractionWidth = Math.max(numMetrics.width, denMetrics.width);

        // Vertical spacing factors
        const vSpacing = this.opts.fontSize * 0.55; // extra space above and below the fraction line
        const numY = y - vSpacing; // baseline for numerator
        const denY = y + this.opts.fontSize * 0.6;

        // Render numerator and denominator with proper alignment
        const numX = x
        const denX = x

        if (numerator.type === 'operand') {
            this.renderOperand(numerator, numX, numY);
        } else {
            this.renderNode(numerator, numX, numY);
        }

        if (denominator.type === 'operand') {
            this.renderOperand(denominator, denX, denY);
        } else {
            this.renderNode(denominator, denX, denY);
        }

        // Draw the fraction line
        this.ctx.beginPath();
        this.ctx.moveTo(x, y);
        this.ctx.lineTo(x + fractionWidth, y);
        this.ctx.lineWidth = this.opts.lineWidth;
        this.ctx.strokeStyle = this.opts.baseColor;
        this.ctx.stroke();

        return {
            width: fractionWidth,
            height: 2 * vSpacing + this.opts.lineWidth,
            ascent: vSpacing,
            descent: vSpacing + this.opts.lineWidth
        };
    }

    /**
     * Renders a superscript expression.
     */
    renderSuperscript(base, exponent, x, y) {

        // Render the base expression
        const baseDims = this.renderNode(base, x, y);

        // Calculate position for the exponent
        const expX = x + baseDims.width
        const expY = y - (this.opts.fontSize * this.opts.superscriptRise);

        // Scale down the font size for the exponent
        this.ctx.font = `${this.opts.fontSize*this.opts.superscriptScale}px ${this.opts.fontFamily}`;
        // Render the exponent
        const expDims = this.renderNode(exponent, expX, expY);

        // Restore original font size
        this.ctx.font = `${this.opts.fontSize}px ${this.opts.fontFamily}`;


        return {
            width: baseDims.width + expDims.width,
            height: Math.max(baseDims.height, expDims.height + (y - expY))
        };
    }

    /**
     * Draw the text aligned at the specified coordinates
     * @param {number} x - X coordinate (left, center, or right depending on align)
     * @param {number} y - Y coordinate
     * @param {string} align - Text alignment: 'left', 'center', or 'right'
     */
    draw(x = 0, y = 0, align = 'center') {
        if (!this.tokens.length) return;

        // Set the font and color once, not per token
        this.ctx.textAlign = "left";
        this.ctx.font = `${this.opts.fontSize}px ${this.opts.fontFamily}`;
        this.ctx.fillStyle = this.opts.baseColor;

        // Calculate starting position based on alignment
        let currentX = x;
        if (align === 'center') {
            currentX = x - this.totalWidth / 2;
        } else if (align === 'right') {
            currentX = x - this.totalWidth;
        }

        // Draw all tokens at once if possible, otherwise draw them individually
        if (this.ctx.fillTextBatch) {
            // Some canvas implementations support batch text rendering
            this.ctx.fillTextBatch(this.tokens, this.tokenWidths, currentX, y);
        } else {
            // Draw each token
            for (let i = 0; i < this.tokens.length; i++) {
                if (this.tokenTypes[i] == "math") {
                    this.renderNode(this.tokens[i], currentX, y)
                    currentX += this.tokenWidths[i];
                }
                else
                {
                    this.ctx.fillText(this.tokens[i], currentX, y);
                    currentX += this.tokenWidths[i];
                }
            }
        }
    }
}
