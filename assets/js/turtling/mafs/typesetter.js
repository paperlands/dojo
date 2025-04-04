/**
 * Mafs.Typesetter: A self-contained math expression renderer for HTML5 Canvas
 * Inspired by TeX/LaTeX by Donald Knuth
 */
export class Typesetter {
  constructor(ctx, options = {}) {
    this.ctx = ctx;
    this.options = {
      fontSize: options.textSize || 80,
      baseColor: options.baseColor || 'white',
      fontFamily: options.fontFamily || 'paperlang',
      padding: options.padding || 5,
      lineWidth: options.lineWidth || 1,
      ...options
    };

    // Cache for metrics calculations
    this.metricsCache = new Map();
  }

  /**
   * Renders a math expression at the specified position.
   * Currently supports simple fractions like "1/x".
   *
   * @param {string} expr - The math expression to render.
   * @param {number} x - The x coordinate.
   * @param {number} y - The y coordinate (baseline for fraction bar).
   */
  render(expr, x, y) {
    //Check if expression is a simple fraction (contains one "/")
    // if (typeof(expr)=="string") {
    //   const [numerator, denominator] = expr.split('/').map(s => s.trim());
    //   this.renderFraction(numerator, denominator, x, y);
    // } else {
      // Fallback to simple text rendering
      this.ctx.font = `${this.options.fontSize}px ${this.options.fontFamily}`;
      this.ctx.fillStyle = this.options.baseColor;
      this.ctx.fillText(expr, x, y);
    // }
  }

  /**
   * Renders a fraction with a numerator and denominator.
   *
   * @param {string} numerator - The numerator text.
   * @param {string} denominator - The denominator text.
   * @param {number} x - The starting x coordinate.
   * @param {number} y - The y coordinate for the fraction bar.
   */
  renderFraction(numerator, denominator, x, y) {
    // Set the font for accurate measurements
      this.ctx.font = `${this.options.fontSize}px ${this.options.fontFamily}`;
    this.ctx.fillStyle = this.options.baseColor;

    // Measure text widths
    const numMetrics = this.ctx.measureText(numerator);
    const denMetrics = this.ctx.measureText(denominator);
    const fractionWidth = Math.max(numMetrics.width, denMetrics.width) + 2 * this.options.padding;

    // Vertical spacing factors
    const vSpacing = this.options.fontSize * 0.55; // extra space above and below the fraction line
    const numY = y - vSpacing; // baseline for numerator
    const denY = y + this.options.fontSize * 0.55;

    // Center the texts horizontally relative to the fraction block
    const numX = x + (fractionWidth ) / 2;
    const denX = x + (fractionWidth ) / 2;

    // Draw the numerator
    this.ctx.fillText(numerator, numX, numY);
    // Draw the denominator
    this.ctx.fillText(denominator, denX, denY);

    // Draw the fraction line
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    this.ctx.lineTo(x + fractionWidth, y);
    this.ctx.lineWidth = this.options.lineWidth;
    this.ctx.strokeStyle = this.options.baseColor;
    this.ctx.stroke();
  }
}
