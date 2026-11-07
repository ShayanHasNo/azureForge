// Tiny pixel-drawing helpers for the workshop scene. Everything is drawn with
// integer-aligned rects so the 320x180 internal canvas stays crisp.

import { hexToRgb, mixHex, shadeHex } from '../core/util';

export type C2D = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): [HTMLCanvasElement, C2D] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  return [c, x];
}

export function R(c: C2D, x: number, y: number, w: number, h: number, col: string) {
  if (w <= 0 || h <= 0) return;
  c.fillStyle = col;
  c.fillRect(Math.floor(x), Math.floor(y), Math.round(w), Math.round(h));
}

export function P(c: C2D, x: number, y: number, col: string) {
  c.fillStyle = col;
  c.fillRect(Math.floor(x), Math.floor(y), 1, 1);
}

/** Horizontal run from x0..x1 inclusive. */
export function H(c: C2D, x0: number, x1: number, y: number, col: string) {
  if (x1 < x0) [x0, x1] = [x1, x0];
  R(c, x0, y, x1 - x0 + 1, 1, col);
}

/** Vertical run from y0..y1 inclusive. */
export function V(c: C2D, x: number, y0: number, y1: number, col: string) {
  if (y1 < y0) [y0, y1] = [y1, y0];
  R(c, x, y0, 1, y1 - y0 + 1, col);
}

/** Bresenham line. */
export function L(c: C2D, x0: number, y0: number, x1: number, y1: number, col: string) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  c.fillStyle = col;
  for (let i = 0; i < 512; i++) {
    c.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

/** Filled pixel disc. */
export function disc(c: C2D, cx: number, cy: number, r: number, col: string) {
  c.fillStyle = col;
  const r2 = r * r + r * 0.8;
  for (let y = -Math.ceil(r); y <= Math.ceil(r); y++) {
    let w = 0;
    for (let x = 0; x <= Math.ceil(r); x++) if (x * x + y * y <= r2) w = x;
    c.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}

/** Filled pixel ellipse. */
export function ellipse(c: C2D, cx: number, cy: number, rx: number, ry: number, col: string) {
  c.fillStyle = col;
  for (let y = -Math.ceil(ry); y <= Math.ceil(ry); y++) {
    const k = 1 - (y * y) / ((ry + 0.4) * (ry + 0.4));
    if (k < 0) continue;
    const w = Math.round(rx * Math.sqrt(k));
    c.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
  }
}

/** Outlined rect (1px border). */
export function box(c: C2D, x: number, y: number, w: number, h: number, fill: string, edge: string) {
  R(c, x, y, w, h, edge);
  R(c, x + 1, y + 1, w - 2, h - 2, fill);
}

/** Rect with a 1px highlight on top/left and shadow on bottom/right. */
export function bevel(c: C2D, x: number, y: number, w: number, h: number, base: string, hi = 0.18, lo = 0.25) {
  R(c, x, y, w, h, base);
  R(c, x, y, w, 1, shadeHex(base, hi));
  R(c, x, y, 1, h, shadeHex(base, hi * 0.6));
  R(c, x, y + h - 1, w, 1, shadeHex(base, -lo));
  R(c, x + w - 1, y, 1, h, shadeHex(base, -lo * 0.7));
}

export const sh = shadeHex;
export const mix = mixHex;

const rgbaCache = new Map<string, string>();
export function rgba(hex: string, a: number): string {
  const k = hex + a.toFixed(3);
  let v = rgbaCache.get(k);
  if (!v) {
    const [r, g, b] = hexToRgb(hex);
    v = `rgba(${r | 0},${g | 0},${b | 0},${a.toFixed(3)})`;
    if (rgbaCache.size > 4000) rgbaCache.clear();
    rgbaCache.set(k, v);
  }
  return v;
}

/** Ramp lookup: t in 0..1 → palette entry. */
export function ramp(pal: string[], t: number): string {
  const i = Math.max(0, Math.min(pal.length - 1, Math.floor(t * pal.length)));
  return pal[i];
}

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export function bayer(x: number, y: number): number {
  return BAYER4[(y & 3) * 4 + (x & 3)];
}

// Shared palettes ----------------------------------------------------------
export const WOOD = ['#22140c', '#3a2416', '#4e3020', '#64402a', '#7a5034', '#946240', '#ad7a4e'];
export const IRON = ['#1e1e24', '#2e2e38', '#44444f', '#5e5e6a', '#7e7e8c', '#a4a4b2', '#d0d0dc'];
export const BRASS = ['#4a3010', '#6e4c1a', '#977026', '#c09038', '#e0b650', '#f6dc88', '#fff4c8'];
export const COPPER = ['#4a2014', '#6e3420', '#97502e', '#bd6c3e', '#d98c54', '#eeb07c', '#ffd8b0'];
export const OUTLINE = '#1c110b';
