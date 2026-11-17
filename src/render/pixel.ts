// A tiny RGBA pixel buffer independent of the DOM so that rendering is
// deterministic and testable in Node.

export class PixelImage {
  readonly data: Uint8ClampedArray;
  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8ClampedArray(w * h * 4);
  }
  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  set(x: number, y: number, r: number, g: number, b: number, a = 255) {
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
  }
  alpha(x: number, y: number) {
    if (!this.inside(x, y)) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }
  /** Simple FNV hash of the pixel data, used to verify exact reproduction. */
  hash(): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < this.data.length; i++) {
      h ^= this.data[i];
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16);
  }
  mirrored(): PixelImage {
    const out = new PixelImage(this.w, this.h);
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4, j = (y * this.w + (this.w - 1 - x)) * 4;
        out.data[j] = this.data[i]; out.data[j + 1] = this.data[i + 1]; out.data[j + 2] = this.data[i + 2]; out.data[j + 3] = this.data[i + 3];
      }
    return out;
  }
  /** Tight bounding box of non-transparent pixels. */
  bounds(): { x: number; y: number; w: number; h: number } {
    let x0 = this.w, y0 = this.h, x1 = -1, y1 = -1;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++)
        if (this.data[(y * this.w + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
        }
    if (x1 < 0) return { x: 0, y: 0, w: this.w, h: this.h };
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
}

/**
 * Area-average downscale by factor s (0..1), keeping a crisp alpha edge. Used
 * when a sprite has to be shown smaller than its native size, where
 * nearest-neighbour would drop pixels unevenly.
 */
export function downscaled(img: PixelImage, s: number): PixelImage {
  const dw = Math.max(1, Math.floor(img.w * s)), dh = Math.max(1, Math.floor(img.h * s));
  const out = new PixelImage(dw, dh);
  const d = img.data;
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = Math.floor(dy / s), sy1 = Math.max(sy0 + 1, Math.floor((dy + 1) / s));
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = Math.floor(dx / s), sx1 = Math.max(sx0 + 1, Math.floor((dx + 1) / s));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = sy0; y < sy1 && y < img.h; y++)
        for (let x = sx0; x < sx1 && x < img.w; x++) {
          const i = (y * img.w + x) * 4, al = d[i + 3];
          r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; n++;
        }
      if (!n || a / n < 255 * 0.3) continue;
      const o = (dy * dw + dx) * 4;
      out.data[o] = r / a; out.data[o + 1] = g / a; out.data[o + 2] = b / a; out.data[o + 3] = a / n > 200 ? 255 : Math.round(a / n);
    }
  }
  return out;
}

/** Convert to an HTMLCanvasElement (browser only). */
export function toCanvas(img: PixelImage, scale = 1): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.w; c.height = img.h;
  const ctx = c.getContext('2d')!;
  const id = ctx.createImageData(img.w, img.h);
  id.data.set(img.data);
  ctx.putImageData(id, 0, 0);
  if (scale === 1) return c;
  const s = document.createElement('canvas');
  s.width = img.w * scale; s.height = img.h * scale;
  const sctx = s.getContext('2d')!;
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(c, 0, 0, s.width, s.height);
  return s;
}
