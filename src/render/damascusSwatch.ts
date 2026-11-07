// A large, flat sample of a Damascus pattern — easier to read than the small
// dagger sprite. t runs left → right (guard → tip), u runs top → bottom.

import { hexToRgb, mixRgb, type RGB } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { rareColor, samplePattern } from '../item/damascus';

export interface SwatchOpts {
  index: number;
  visibility: number;
  color?: string;
  primary?: string;
  secondary?: string;
  /** Logical pixel size; the canvas is drawn at w*scale × h*scale. */
  w?: number;
  h?: number;
  scale?: number;
  /** Greyed-out, for undiscovered entries in the index. */
  dim?: boolean;
}

const pal = (id: string | undefined, fb: string): RGB[] => (id && hasMat(id) ? mat(id) : mat(fb)).palette.map(hexToRgb);

export function damascusSwatch(o: SwatchOpts): HTMLCanvasElement {
  const w = o.w ?? 96, h = o.h ?? 20, scale = o.scale ?? 2;
  const P = pal(o.primary, 'iron'), S = pal(o.secondary, 'silver');
  const rc = rareColor(o.color);
  const bright = rc ? hexToRgb(rc.hex) : mixRgb(S[4], S[5], 0.35);
  const bright2 = rc?.hex2 ? hexToRgb(rc.hex2) : bright;
  const dark = mixRgb(P[0], P[1], 0.5);
  const v = Math.min(1, Math.max(0, o.visibility));
  const field = samplePattern(o.index, w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const edge = y === 0 || y === h - 1;
    for (let x = 0; x < w; x++) {
      const f = field[y * w + x];
      let base = P[edge ? 4 : 3];
      const col = rc?.hex2 ? mixRgb(bright, bright2, x / w) : bright;
      base = f > 0.5 ? mixRgb(base, col, v * (f - 0.5) * 2 * 0.9) : mixRgb(base, dark, v * (0.5 - f) * 2 * 0.65);
      if (o.dim) { const g = (base[0] + base[1] + base[2]) / 3; base = mixRgb(base, [g, g, g], 0.85); base = mixRgb(base, [60, 50, 44], 0.45); }
      const i = (y * w + x) * 4;
      img.data[i] = base[0]; img.data[i + 1] = base[1]; img.data[i + 2] = base[2]; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  if (scale === 1) return c;
  const out = document.createElement('canvas');
  out.width = w * scale; out.height = h * scale;
  const octx = out.getContext('2d')!;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(c, 0, 0, out.width, out.height);
  out.style.maxWidth = '100%';
  return out;
}
