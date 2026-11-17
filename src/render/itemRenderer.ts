// Layered procedural item renderer. Every pixel derives from the item's stored
// parameters + seed; nothing is picked from a predefined sprite list.
//
// Sprites are drawn at RENDER_SCALE device pixels per logical pixel. Item
// geometry stays in logical units; shapes are evaluated per device pixel, so
// hi-res adds finer edges and detail (1-px bevels, carved engraving, faceted
// gems) while keeping the pixel-art look. Pieces made before this renderer
// (item.version 1) are drawn by the frozen renderer in ./legacy instead.
//
// Layers: 1 silhouette → 2 primary material → 3 secondary details → 4 surface
// pattern → 5 handle/support components → 6 decoration → 7 highlights/shadows
// (finish) → 8 special effects (glow halo, mutations).

import { hash32, hashString, noise2, valueNoise, seededRng } from '../core/rng';
import { clamp, hexToRgb, hslToRgb, mixRgb, rampFrom, RGB, rgbToHsl, sampleCurve } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { palette as designPalette } from '../data/options';
import { CATEGORY_INFO } from '../item/factory';
import { EMBLEM_BITMAPS, engravingPaths, glyphFor } from '../item/patterns';
import { damascusField, patternSpec, rareColor } from '../item/damascus';
import type { Item } from '../item/types';
import { PixelImage } from './pixel';
import { isLegacy } from '../item/types';
import { renderLegacy } from './legacy/rendererV1';
import { craftBlemishPoint, renderCraft } from './crafts';

export type View = 'front' | 'back' | 'profile';

export const L_EMPTY = 0, L_BLADE = 1, L_GUARD = 2, L_GRIP = 3, L_WRAP = 4, L_POMMEL = 5, L_GEM = 6, L_ENGRAVE = 7, L_STONE = 8, L_FACE = 9, L_RIM = 10, L_BOSS = 11, L_EMBLEM = 12;
const METAL_LAYERS = new Set([L_BLADE, L_GUARD, L_POMMEL, L_RIM, L_BOSS]);

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export class Canvas {
  layer: Uint8Array;
  pal: Uint8Array;
  shade: Float32Array;
  alpha: Float32Array;
  tint: Float32Array; // r,g,b,a
  /** blade-local coordinates for blade pixels (t,u) */
  bt: Float32Array;
  bu: Float32Array;
  palettes: RGB[][] = [];
  palIndex = new Map<string, number>();
  constructor(public w: number, public h: number) {
    const n = w * h;
    this.layer = new Uint8Array(n);
    this.pal = new Uint8Array(n);
    this.shade = new Float32Array(n);
    this.alpha = new Float32Array(n);
    this.tint = new Float32Array(n * 4);
    this.bt = new Float32Array(n).fill(-1);
    this.bu = new Float32Array(n);
  }
  addPalette(key: string, hexes: string[]): number {
    if (this.palIndex.has(key)) return this.palIndex.get(key)!;
    const i = this.palettes.length;
    this.palettes.push(hexes.map(hexToRgb));
    this.palIndex.set(key, i);
    return i;
  }
  idx(x: number, y: number) {
    return y * this.w + x;
  }
  in(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  put(x: number, y: number, layer: number, pal: number, shade: number, alpha = 1) {
    x = Math.round(x); y = Math.round(y);
    if (!this.in(x, y)) return;
    const i = this.idx(x, y);
    this.layer[i] = layer; this.pal[i] = pal; this.shade[i] = shade; this.alpha[i] = alpha;
    this.tint[i * 4 + 3] = 0;
  }
  is(x: number, y: number, ...layers: number[]) {
    if (!this.in(x, y)) return false;
    const l = this.layer[this.idx(x, y)];
    return layers.length ? layers.includes(l) : l !== L_EMPTY;
  }
  addTint(i: number, c: RGB, a: number) {
    const k = i * 4;
    const cur = this.tint[k + 3];
    const na = clamp(cur + a * (1 - cur), 0, 1);
    const w = na > 0 ? (a * (1 - cur)) / na : 0;
    this.tint[k] = this.tint[k] * (1 - w) + c[0] * w;
    this.tint[k + 1] = this.tint[k + 1] * (1 - w) + c[1] * w;
    this.tint[k + 2] = this.tint[k + 2] * (1 - w) + c[2] * w;
    this.tint[k + 3] = na;
  }
}

export function matPalette(id: string | undefined, fallback = 'iron'): string[] {
  if (id && hasMat(id)) return mat(id).palette;
  return mat(fallback).palette;
}

export interface Ctx {
  item: Item;
  c: Canvas;
  seed: number;
  view: View;
  /** Device pixels per logical pixel. Item geometry is stored in logical units. */
  k: number;
  P: number; // primary palette
  S: number; // secondary palette
  G: number; // grip palette
  W: number; // wrap palette
  inlayRgb: RGB;
  accentRgb: RGB;
  glowRgb: RGB;
}

// ============================================================ public API
/**
 * Current pieces are drawn at this many device pixels per logical pixel: the
 * same proportions as before, with finer pixels and more detail. Item data
 * (lengths, widths, offsets) stays in logical units.
 */
export const RENDER_SCALE = 2;

/** Device pixels per logical pixel in the sprite renderItem() returns for this item. */
export function spriteScale(item: Item): number {
  return isLegacy(item) ? 1 : RENDER_SCALE;
}

const cache = new Map<string, PixelImage>();
const CACHE_MAX = 220;

export function visualKey(item: Item, view: View): string {
  const v = {
    v: item.version ?? 1, c: item.category, s: item.seed, d: item.design, m: item.materials, st: item.structure, b: item.blade, sh: item.shield,
    h: item.hilt, bw: item.bow, ar: item.arrows, am: item.armor, su: item.surface, de: item.decoration, f: item.finish, bl: item.blemishes, mu: item.mutations, view,
  };
  return JSON.stringify(v);
}

/** The item's sprite at its full resolution (legacy pieces: their original 1x sprite). */
export function renderItem(item: Item, view: View = 'front'): PixelImage {
  return renderItemAt(item, view, spriteScale(item));
}

/**
 * Render at a chosen scale. Scale 1 gives the "working" sprite, whose pixels
 * are the logical units used by bladeLayout / bladeRow / bladePixel — handy
 * for the hands-on minigames. Legacy pieces only exist at 1x.
 */
export function renderItemAt(item: Item, view: View, k: number): PixelImage {
  if (isLegacy(item)) k = 1;
  const key = visualKey(item, view) + '|' + k;
  const hit = cache.get(key);
  if (hit) return hit;
  // Pieces made before the hi-res renderer keep their original pixels forever.
  const img = isLegacy(item) ? renderLegacy(item, view)
    : item.category === 'bow' || item.category === 'arrows' || item.category === 'armor' ? renderCraft(item, view, k)
    : view === 'profile' ? renderProfile(item, k) : item.category === 'shield' ? renderShield(item, view, k) : renderBladed(item, view, k);
  if (cache.size >= CACHE_MAX) {
    let n = 0;
    for (const key0 of cache.keys()) { cache.delete(key0); if (++n >= CACHE_MAX / 4) break; }
  }
  cache.set(key, img);
  return img;
}

export function clearRenderCache() {
  cache.clear();
}

// ============================================================ blade geometry
export interface BladeLayout {
  W: number; H: number; cx: number;
  bladeBase: number; bladeTip: number; guardTop: number; guardH: number; gripTop: number; gripBottom: number; pommelCy: number; pommelH: number;
}

function pommelHeight(p: string, dagger: boolean) {
  const base = { round: 7, disc: 5, faceted: 8, crescent: 6, wheel: 9, ring: 8, teardrop: 9, crown: 7, fishtail: 6, gearwheel: 9, scentstopper: 9 }[p] ?? 7;
  return dagger ? base - 1 : base;
}

/** Layout in logical pixels (the units item geometry is stored in). */
export function bladeLayout(item: Item): BladeLayout {
  const [W, H] = CATEGORY_INFO[item.category].size;
  const b = item.blade!, h = item.hilt!;
  const dagger = item.category === 'dagger';
  const pommelH = pommelHeight(h.pommel, dagger);
  const guardH = dagger ? 3 : 4;
  const bottom = H - 4;
  const pommelCy = bottom - pommelH / 2;
  const gripBottom = bottom - pommelH + 1;
  const gripTop = gripBottom - h.gripLength;
  const guardTop = gripTop - guardH;
  const bladeBase = guardTop;
  const bladeTip = bladeBase - b.length;
  return { W, H, cx: Math.floor(W / 2), bladeBase, bladeTip, guardTop, guardH, gripTop, gripBottom, pommelCy, pommelH };
}

/** The same layout in device pixels at scale k. */
function layoutK(item: Item, k: number): BladeLayout {
  const l = bladeLayout(item);
  if (k === 1) return l;
  const o = (k - 1) / 2;
  return {
    W: l.W * k, H: l.H * k, cx: l.cx * k + o,
    bladeBase: l.bladeBase * k + (k - 1), bladeTip: l.bladeTip * k + (k - 1),
    guardTop: l.guardTop * k, guardH: l.guardH * k, gripTop: l.gripTop * k, gripBottom: l.gripBottom * k,
    pommelCy: l.pommelCy * k + o, pommelH: l.pommelH * k,
  };
}

function profileFactor(profile: string, t: number, seed: number): number {
  switch (profile) {
    case 'tapered': return 1 - 0.5 * t;
    case 'leaf': return 0.74 + 0.44 * Math.sin(Math.PI * Math.min(1, t * 1.05));
    case 'broad': return 1.18 - 0.1 * t;
    case 'curved': return 1 - 0.14 * t;
    case 'falchion': return 0.84 + 0.42 * t;
    case 'needle': return 0.62 - 0.3 * t;
    case 'wavy': return (1 - 0.25 * t) * (1 + 0.17 * Math.sin(t * Math.PI * 9));
    case 'kopis': return 0.78 + 0.5 * Math.sin(Math.PI * t * 0.85);
    case 'thorn': {
      const k = (t * 12) % 1;
      return 0.66 - 0.26 * t + (k < 0.12 ? 0.35 : 0);
    }
    case 'crag': {
      const step = Math.floor(t * 14);
      return 1 - 0.22 * t + (noise2(seed, step, 7) - 0.5) * 0.3;
    }
    case 'crystal': return (1 - 0.32 * t) * (0.85 + 0.25 * ((t * 7) % 1));
    default: return 1 - 0.12 * t;
  }
}

interface TipShape { left: number; right: number; shift: number; notch: number }
function tipShape(tip: string, profile: string, t: number): TipShape {
  const s = (len: number) => clamp((1 - t) / len);
  switch (tip) {
    case 'spear': { const k = Math.pow(s(0.24), 1.35); return { left: k, right: k, shift: 0, notch: 0 }; }
    case 'rounded': { const k = s(0.07); const v = Math.sqrt(1 - (1 - k) * (1 - k)); return { left: v, right: v, shift: 0, notch: 0 }; }
    case 'clipped': return { left: s(0.26), right: Math.sqrt(s(0.08)), shift: 0, notch: 0 };
    case 'chisel': return { left: Math.min(1, s(0.03)), right: s(0.13), shift: 0, notch: 0 };
    case 'hooked': { const k = s(0.18); return { left: k, right: Math.sqrt(k), shift: (1 - k) * (1 - k) * 1.4, notch: 0 }; }
    case 'swallowtail': { const k = s(0.16); return { left: Math.sqrt(k), right: Math.sqrt(k), shift: 0, notch: k < 1 ? (1 - k) * 0.9 : 0 }; }
    default: {
      const len = profile === 'falchion' ? 0.2 : profile === 'needle' ? 0.2 : 0.13;
      const k = s(len);
      return { left: k, right: k, shift: 0, notch: 0 };
    }
  }
}

export interface BladeRow { center: number; L: number; R: number; notch: number }
/** Blade cross-section at t (0 guard → 1 tip), in logical pixels. */
export function bladeRow(item: Item, t: number): BladeRow {
  const b = item.blade!;
  const lay = bladeLayout(item);
  const pf = profileFactor(b.profile, t, item.seed);
  const tip = tipShape(b.tip, b.profile, t);
  const hw = b.width * pf;
  let curve = b.curve;
  if (b.profile === 'curved') curve += 0.55;
  if (b.profile === 'kopis') curve -= 0.45;
  const center = lay.cx + curve * b.length * 0.11 * t * t + sampleCurve(b.wobble, t) + tip.shift * b.width;
  const asym = b.asymmetry;
  let L = hw * (1 + sampleCurve(b.leftDev, t)) * tip.left * (1 - asym * 0.38 * Math.sin(Math.PI * t));
  let R = hw * (1 + sampleCurve(b.rightDev, t)) * tip.right * (1 + asym * 0.22 * Math.sin(Math.PI * t * 1.3));
  L = Math.max(0, L); R = Math.max(0, R);
  return { center, L, R, notch: tip.notch * hw };
}

function rowK(item: Item, t: number, k: number): BladeRow {
  const r = bladeRow(item, t);
  if (k === 1) return r;
  return { center: r.center * k + (k - 1) / 2, L: r.L * k, R: r.R * k, notch: r.notch * k };
}

// ------------------------------------------------------------ bitmap upscaling
/** Scale2x / EPX: doubles a 1-bit bitmap, rounding diagonals without blur so it stays crisp pixel art. */
function epx(bm: string[]): string[] {
  const h = bm.length, w = bm[0].length;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? '.' : bm[y][x] === '#' ? '#' : '.');
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let r0 = '', r1 = '';
    for (let x = 0; x < w; x++) {
      const P = at(x, y), A = at(x, y - 1), B = at(x + 1, y), C = at(x - 1, y), D = at(x, y + 1);
      r0 += (C === A && C !== D && A !== B ? A : P) + (A === B && A !== C && B !== D ? B : P);
      r1 += (D === C && D !== B && C !== A ? C : P) + (B === D && B !== A && D !== C ? D : P);
    }
    out.push(r0, r1);
  }
  return out;
}

const upCache = new Map<string, string[]>();
/** Upscale a bitmap by an integer factor (EPX for each doubling, nearest for the rest). */
export function upscaleBitmap(bm: string[], f: number): string[] {
  if (f <= 1) return bm;
  const key = f + ':' + bm.join('/');
  const hit = upCache.get(key);
  if (hit) return hit;
  let cur = bm, s = 1;
  while (s * 2 <= f) { cur = epx(cur); s *= 2; }
  let out = cur;
  if (s !== f) {
    const H = bm.length * f, Wd = bm[0].length * f;
    out = [];
    for (let y = 0; y < H; y++) {
      let row = '';
      const sy = Math.floor((y * cur.length) / H);
      for (let x = 0; x < Wd; x++) row += cur[sy][Math.floor((x * cur[0].length) / Wd)];
      out.push(row);
    }
  }
  upCache.set(key, out);
  return out;
}

// ============================================================ bladed weapons
function renderBladed(item: Item, view: View, k: number): PixelImage {
  const lay = layoutK(item, k);
  const c = new Canvas(lay.W, lay.H);
  const ctx = makeCtx(item, c, view, k);
  drawBlade(ctx, lay);
  drawSurfaceTexture(ctx);
  drawFusion(ctx);
  drawDamascus(ctx);
  drawGuard(ctx, lay);
  drawGrip(ctx, lay);
  drawPommel(ctx, lay);
  if (view === 'front') {
    drawEngraving(ctx, lay);
    if (item.decoration.engraving.pattern === 'none') drawInscription(ctx, lay, 0.12);
  } else {
    drawInscription(ctx, lay, 0.12);
  }
  carveHighlights(ctx);
  drawEmblem(ctx, lay);
  drawStones(ctx, lay);
  drawConstellation(ctx, lay);
  drawGems(ctx, lay);
  drawMutationsShade(ctx);
  drawFinishShade(ctx);
  drawBlemishes(ctx, lay);
  const img = compose(ctx);
  return view === 'back' ? img.mirrored() : img;
}

export function makeCtx(item: Item, c: Canvas, view: View, k: number): Ctx {
  const dp = designPalette(item.design.palette);
  const P = c.addPalette('P', matPalette(item.materials.primary));
  const S = c.addPalette('S', matPalette(item.materials.secondary, 'brass'));
  const G = c.addPalette('G', matPalette(item.hilt?.gripMaterial ?? item.shield?.faceMaterial ?? 'oak', 'oak'));
  const wrapHex = item.hilt?.wrap === 'wire' ? undefined : item.hilt?.wrapColor || dp.wrap;
  const W = wrapHex ? c.addPalette('W', rampFrom(wrapHex, 6, 0.7)) : S;
  const glowHex = item.finish.glowColor || (hasMat(item.materials.primary) ? mat(item.materials.primary).accent : undefined) || dp.glow;
  return {
    item, c, seed: item.seed, view, k, P, S, G, W,
    inlayRgb: hexToRgb(dp.inlay), accentRgb: hexToRgb(dp.accent), glowRgb: hexToRgb(glowHex),
  };
}

function drawBlade(ctx: Ctx, lay: BladeLayout) {
  const { item, c, P, k } = ctx;
  const b = item.blade!;
  const len = b.length * k;
  const translucent = hasMat(item.materials.primary) && !!mat(item.materials.primary).translucent;
  const bevel = 0.3 + 0.22 * b.thickness;
  const hi = k > 1;
  const gw = 0.5 * k; // half-width of a fuller groove
  for (let y = lay.bladeTip - 2 * k; y <= lay.bladeBase; y++) {
    const t = clamp((lay.bladeBase - y) / len, 0, 1);
    const row = rowK(item, t, k);
    if (row.L + row.R < 0.4 * k) continue;
    const xl = Math.round(row.center - row.L), xr = Math.round(row.center + row.R);
    const span = xr - xl;
    const hw = (row.L + row.R) / 2;
    const hwL = hw / k; // logical half-width, for the same thresholds at any scale
    for (let x = xl; x <= xr; x++) {
      const d = x - row.center;
      if (row.notch > 0 && Math.abs(d) < row.notch) continue;
      const u = d < 0 ? (row.L > 0 ? d / Math.max(row.L, 0.5 * k) : -1) : d / Math.max(row.R, 0.5 * k);
      const au = Math.abs(u);
      const inBevel = au > 1 - bevel;
      let shade = 3.0 + 0.35 * (t - 0.5) - (hi ? u * 0.22 : 0);
      if (x === xl) shade = 4.9;
      else if (x === xr) shade = 1.5;
      else if (hi && span > 5 && x === xl + 1) shade = 4.5;
      else if (hi && span > 5 && x === xr - 1) shade = 1.9;
      else if (inBevel) shade = u < 0 ? 4.1 : 2.1;
      else if (hi && au + 1 / Math.max(hw, 1) > 1 - bevel) shade = u < 0 ? 3.6 : 2.7; // crisp line where the bevel meets the flat
      // fullers & ridges
      const fullerOn = t > 0.03 && t < 0.64;
      const edge = x === xl || x === xr || (hi && span > 5 && (x === xl + 1 || x === xr - 1));
      if (fullerOn && !edge) {
        if (b.fuller === 'single' && hwL >= 2.5) {
          if (Math.abs(d) < gw) shade = hi ? (d < 0 ? 1.5 : 2.0) : 1.7;
          else if (d >= gw && d < gw + 1 && hwL >= 3.5) shade = 3.9;
          else if (hi && d <= -gw && d > -gw - 1) shade = 2.6;
        } else if (b.fuller === 'double' && hwL >= 3.5) {
          const off = Math.round(hwL * 0.38) * k;
          const local = Math.abs(d) - off; // position across the groove
          const side = d < 0 ? -local : local; // screen-space direction (left → right)
          if (Math.abs(local) < gw) shade = hi ? (side < 0 ? 1.6 : 2.3) : 1.8;
          else if (hi && side >= gw && side < gw + 1) shade = 3.8;
        } else if (b.fuller === 'ridge') {
          if (Math.abs(d) < gw) shade = hi ? (d < 0 ? 4.8 : 4.2) : 4.6;
          else if (!inBevel) shade = u < 0 ? 3.5 : 2.5;
        }
      }
      let alpha = 1;
      if (translucent && !inBevel && !edge) alpha = 0.8;
      c.put(x, y, L_BLADE, P, shade, alpha);
      const i = c.idx(x, y);
      if (c.in(x, y)) { c.bt[i] = t; c.bu[i] = clamp(u, -1, 1); }
    }
  }
}

function zoneQuality(item: Item, t: number): number {
  const z = item.surface.zones;
  if (!z || !z.length) return 0.7;
  return clamp(sampleCurve(z, t), 0, 1);
}

export function drawSurfaceTexture(ctx: Ctx) {
  const { item, c, seed, k } = ctx;
  const tex = item.surface.texture;
  const clarity = item.surface.patternClarity;
  const layers = Math.max(4, item.surface.layers);
  const hi = k > 1;
  const lw = c.w / k, lh = c.h / k;
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const i = c.idx(x, y);
      const L = c.layer[i];
      if (!METAL_LAYERS.has(L) && !(L === L_FACE && !isWood(item.shield?.faceMaterial))) continue;
      const strength = L === L_BLADE || L === L_FACE ? 1 : 0.45;
      const t = c.bt[i] >= 0 ? c.bt[i] : y / c.h;
      const q = zoneQuality(item, t);
      // Features are sized in logical pixels (lx, ly); grain uses device pixels, so hi-res adds fineness, not bulk.
      const lx = x / k, ly = y / k;
      let s = c.shade[i];
      // Uneven polishing shows as mottling in poorly finished zones.
      s += (valueNoise(seed + 11, lx / 2.5, ly / 2.5) - 0.5) * (1 - q) * 1.4 * strength;
      switch (tex) {
        case 'smooth':
          break;
        case 'brushed':
          s += (noise2(seed, x, Math.floor(ly / (4 + q * 6) + noise2(seed + 1, x, 0) * (hi ? 1 : 0))) - 0.5) * (hi ? 0.8 : 0.9) * strength;
          break;
        case 'hammered': {
          const cell = 3 * k;
          const cy0 = Math.floor(y / cell);
          const xo = hi ? x + (cy0 % 2) * (cell / 2) : x;
          const cx0 = Math.floor(xo / cell);
          const h = noise2(seed + 3, cx0, cy0);
          if (h > 0.45) {
            if (!hi) {
              const px = x - cx0 * cell, py = y - cy0 * cell;
              if (px === 0 && py === 0) s += 0.9 * strength;
              if (px === 2 && py === 2) s -= 0.9 * strength;
            } else {
              // a shallow peen mark: shadowed upper-left wall, lit lower-right wall
              const fx = (xo - cx0 * cell + 0.5) / cell - 0.5, fy = (y - cy0 * cell + 0.5) / cell - 0.5;
              const dd = Math.hypot(fx, fy);
              if (dd < 0.46 && dd > 0.2) s += (fx + fy) * 2.6 * strength;
              else if (dd <= 0.2) s -= 0.25 * strength;
            }
          }
          break;
        }
        case 'weathered': {
          const n = valueNoise(seed + 5, lx / 4, ly / 4);
          if (n > 0.55) {
            s -= (n - 0.55) * 3.2 * strength;
            c.addTint(i, [70, 96, 80], (n - 0.55) * 0.9 * strength);
          }
          if (noise2(seed + 6, x, y) > 0.93) s -= 1;
          break;
        }
        case 'reflective': {
          s = 3 + (s - 3) * 1.5;
          const band = ((ly + lx * 1.6) % 38 + 38) % 38;
          if (band < 3) s = 5;
          else if (hi && band < 3.5) s = Math.max(s, 4.2);
          break;
        }
        case 'layered': {
          const noise = (valueNoise(seed + 9, lx / 3, ly / 3) - 0.5) * (1 - clarity) * 4;
          const f = Math.sin(ly * (0.2 + layers * 0.012) + 2.2 * Math.sin(lx * 0.7 + ly * 0.05) + noise);
          if (f > 0.25 && L === L_BLADE) c.pal[i] = ctx.S;
          if (f > 0.25 && f < 0.45) s -= 0.6;
          break;
        }
        case 'iridescent': {
          const hue = (lx * 0.045 + ly * 0.018 + valueNoise(seed, lx / 6, ly / 6) * 0.3) % 1;
          c.addTint(i, hslToRgb(hue, 0.7, 0.62), 0.32 * strength);
          break;
        }
        case 'rippled':
          s += 0.7 * Math.sin(ly * 0.8 + Math.sin(lx * 0.5) * 2) * strength;
          break;
        case 'stonefleck': {
          const n = noise2(seed + 2, x, y);
          if (n > 0.84) s -= 1.3 * strength; else if (n < 0.05) s += 1.2 * strength;
          break;
        }
        case 'forgescale': {
          const n = valueNoise(seed + 21, lx / 3, ly / 5);
          if (n > 0.6) { s -= (n - 0.5) * 3 * strength; c.addTint(i, [30, 26, 24], 0.4 * strength); }
          break;
        }
        case 'flamebloom': {
          const n = valueNoise(seed + 31, lx / 5, ly / 7);
          const col: RGB = n < 0.4 ? [224, 112, 144] : n < 0.65 ? [128, 96, 192] : [230, 180, 90];
          c.addTint(i, col, 0.36 * strength);
          break;
        }
        case 'riverwave':
          s += Math.sin(ly * 0.35 + lx * 0.5 + valueNoise(seed, lx / 5, ly / 5) * 4) * 0.7 * strength;
          c.addTint(i, [90, 130, 200], 0.12 * strength);
          break;
        case 'tidal': {
          const d = Math.hypot(lx - lw / 2, (ly - lh) * 0.6);
          s += Math.sin(d * 0.9) * 0.6 * strength;
          break;
        }
        case 'emberscale': {
          const ry = Math.floor(ly / 3);
          const sx = lx + (ry % 2) * 1.5;
          const rx = Math.floor(sx / 3);
          const px = sx - rx * 3, py = ly - ry * 3;
          const line = 1 / k; // scale outlines stay one device pixel wide
          if (py >= 3 - line || px < line) s -= 0.9 * strength;
          else if (hi && (py < line || px >= 3 - line)) s += 0.5 * strength;
          else if (noise2(seed, rx, ry) > 0.7) c.addTint(i, [255, 120, 50], 0.35 * strength);
          break;
        }
        case 'watered': {
          // crucible ("wootz") steel: fine contour lines that wander like water marks
          const n = valueNoise(seed + 81, lx / 2.4, ly / 7) + 0.5 * valueNoise(seed + 82, lx / 1.1, ly / 3);
          const f = Math.sin(n * 11 + ly * 0.22);
          if (f > 0.5) s += 0.7 * strength; else if (f < -0.62) s -= 0.55 * strength;
          break;
        }
        case 'widmanstatten': {
          // meteoric iron: three families of crystal bands crossing at 60°
          const fam = [ly, lx * 0.866 + ly * 0.5, -lx * 0.866 + ly * 0.5];
          for (let n = 0; n < 3; n++) {
            const a = fam[n] / 4.5, cell = Math.floor(a);
            const along = n === 0 ? lx : n === 1 ? lx * 0.5 - ly * 0.866 : lx * 0.5 + ly * 0.866;
            if (a - cell < 0.24 && valueNoise(seed + 90 + n, cell * 3.1, along / 7) > 0.42) { s += (0.75 - n * 0.2) * strength; break; }
            if (a - cell > 0.86 && valueNoise(seed + 90 + n, cell * 3.1, along / 7) > 0.5) { s -= 0.5 * strength; break; }
          }
          break;
        }
        case 'rayed': {
          // fine rays spreading from the guard (or the centre of a shield)
          const oy = item.shield ? lh / 2 : lh * 0.76;
          const ang = Math.atan2(lx - lw / 2, oy - ly);
          const f = Math.sin(ang * 46);
          if (f > 0.62) s += 0.75 * strength; else if (f < -0.8) s -= 0.4 * strength;
          break;
        }
        case 'nebula': {
          const n = valueNoise(seed + 41, lx / 6, ly / 8);
          c.addTint(i, n > 0.5 ? [180, 100, 220] : [80, 90, 220], Math.abs(n - 0.5) * 0.9 * strength);
          if (noise2(seed + 42, x, y) > 1 - 0.03 / k) s = 5;
          break;
        }
      }
      c.shade[i] = s;
    }
}

function isWood(id?: string) {
  return !!id && hasMat(id) && ['wood', 'leather', 'bone'].includes(mat(id).kind);
}

/**
 * Damascus pattern (daggers). The pattern comes only from the pattern index;
 * visibility scales how strongly the bright and dark layers show, and a rare
 * colour replaces the bright layers' tone.
 */
function drawDamascus(ctx: Ctx) {
  const { item, c } = ctx;
  const d = item.surface.damascus;
  if (!d || item.category === 'shield') return;
  const spec = patternSpec(d.index);
  const v = clamp(d.visibility, 0, 1);
  const pP = c.palettes[ctx.P], pS = c.palettes[ctx.S];
  const rc = rareColor(d.color);
  const bright = rc ? hexToRgb(rc.hex) : mixRgb(pS[4], pS[5], 0.35);
  const bright2 = rc?.hex2 ? hexToRgb(rc.hex2) : bright;
  const dark = mixRgb(pP[0], pP[1], 0.5);
  for (let i = 0; i < c.layer.length; i++) {
    if (c.layer[i] !== L_BLADE || c.bt[i] < 0) continue;
    const t = c.bt[i], u = c.bu[i];
    const f = damascusField(spec, t, u);
    const edge = Math.abs(u) > 0.92 ? 0.55 : 1;
    const col = rc?.hex2 ? mixRgb(bright, bright2, clamp(t * 1.2 - 0.1)) : bright;
    if (f > 0.5) c.addTint(i, col, v * (f - 0.5) * 2 * (rc ? 0.95 : 0.8) * edge);
    else c.addTint(i, dark, v * (0.5 - f) * 2 * 0.5 * edge);
    c.shade[i] = clamp(c.shade[i] + v * (f - 0.5) * 1.1 * edge, 0, 5);
  }
}

function drawFusion(ctx: Ctx) {
  const { item, c, seed, k } = ctx;
  const f = item.materials.fusedWith;
  if (!f || !hasMat(f)) return;
  const F = c.addPalette('F', mat(f).palette);
  const amount = item.surface.fusion || 0.5;
  for (let i = 0; i < c.layer.length; i++) {
    if (c.layer[i] !== L_BLADE && c.layer[i] !== L_FACE && c.layer[i] !== L_BOSS) continue;
    const x = (i % c.w) / k, y = Math.floor(i / c.w) / k;
    const n = valueNoise(seed + 77, x / 5 + Math.sin(y / 9) * 2, y / 7);
    if (n < amount * 0.75) c.pal[i] = F;
  }
}

// ------------------------------------------------------------ guard
/** Guard cross-section at xn (-1..1). `off` and `th` are in logical pixels. */
function guardShape(g: string, xn: number, gh: number): { off: number; th: number } {
  const a = Math.abs(xn);
  switch (g) {
    case 'downswept': return { off: 3.5 * xn * xn, th: gh * 0.85 };
    case 'upswept': return { off: -3.5 * xn * xn, th: gh * 0.85 };
    case 'disc': return { off: 0, th: gh * 1.7 * Math.sqrt(Math.max(0, 1 - xn * xn)) };
    case 'winged': return { off: -1.8 * a, th: gh * (0.7 + 0.9 * a) };
    case 'crescent': return { off: -6 * xn * xn, th: gh * (1 - 0.45 * a) };
    case 'knot': return { off: 0, th: gh * (0.8 + 1.3 * Math.exp(-(xn * 3) * (xn * 3))) };
    case 'stub': return { off: 0, th: gh };
    case 'talon': return { off: -2.2 * a + (a > 0.82 ? -(a - 0.82) * 14 : 0), th: gh * (1 - 0.3 * a) };
    case 'basket': return { off: 0, th: gh * 1.1 };
    case 'ring': return { off: 0, th: gh };
    default: return { off: 0, th: a > 0.84 ? gh * 1.35 : gh };
  }
}

function drawGuard(ctx: Ctx, lay: BladeLayout) {
  const { item, c, S, k } = ctx;
  const h = item.hilt!;
  const hi = k > 1;
  let gwL = h.guardWidth;
  if (h.guard === 'disc') gwL *= 0.6; if (h.guard === 'knot') gwL *= 0.75; if (h.guard === 'stub') gwL = Math.max(3, gwL * 0.42);
  const gw = gwL * k;
  const ghL = lay.guardH / k;
  const cx = lay.cx + h.guardOffset * k;
  const cy = lay.guardTop + lay.guardH / 2;
  const x0 = Math.floor(cx - gw), x1 = Math.ceil(cx + gw);
  let first = Infinity, last = -Infinity;
  for (let x = x0; x <= x1; x++) if (Math.abs((x - cx) / gw) <= 1) { first = Math.min(first, x); last = Math.max(last, x); }
  for (let x = x0; x <= x1; x++) {
    const xn = (x - cx) / gw;
    if (Math.abs(xn) > 1) continue;
    const g = guardShape(h.guard, xn, ghL);
    const off = g.off * k, th = g.th * k;
    const yc = cy + off + h.guardTilt * k * xn;
    const y0 = Math.round(yc - th / 2), y1 = Math.max(y0, Math.round(yc + th / 2) - 1);
    for (let y = y0; y <= y1; y++) {
      let s = 3;
      if (y === y0) s = 4.7; else if (y === y1) s = 1.6;
      else if (hi && y1 - y0 >= 4 && y === y0 + 1) s = 4.0;
      else if (hi && y1 - y0 >= 4 && y === y1 - 1) s = 2.2;
      s += -xn * 0.5;
      if (hi && y !== y0 && y !== y1) { if (x === first) s = Math.max(s, 4.2); else if (x === last) s = Math.min(s, 1.7); }
      c.put(x, y, L_GUARD, S, s);
    }
  }
  if (h.guard === 'ring') {
    const rx = cx + gw * 0.45, ry = cy + 4 * k, r = 3.6 * k, th = hi ? 1.1 * k : 1.3;
    for (let y = Math.floor(ry - r); y <= ry + r; y++)
      for (let x = Math.floor(rx - r); x <= rx + r; x++) {
        const d = Math.hypot(x - rx, y - ry);
        if (d <= r && d >= r - th) c.put(x, y, L_GUARD, S, 3 - ((y - ry) / k) * 0.4 - (hi && d > r - 1 ? 0.6 : 0) + (hi && d < r - th + 1 ? 0.5 : 0));
      }
  }
  if (h.guard === 'basket') {
    const steps = 14 * k;
    for (let n = 0; n < 3; n++) {
      const xs = cx - gw * (0.9 - n * 0.25);
      for (let i = 0; i <= steps; i++) {
        const tt = i / steps;
        const x = xs + Math.sin(tt * Math.PI) * -2 * k + tt * (gw * (0.9 - n * 0.25) - 3 * k);
        const y = cy + tt * (h.gripLength + 1) * k;
        c.put(x, y, L_GUARD, S, 3.4 - n * 0.5);
        if (hi) c.put(x + 1, y, L_GUARD, S, 2.4 - n * 0.4);
      }
    }
  }
}

// ------------------------------------------------------------ grip & wrap
function drawGrip(ctx: Ctx, lay: BladeLayout) {
  const { item, c, G, W, seed, k } = ctx;
  const h = item.hilt!;
  const hi = k > 1;
  const half = 2 * k;
  const gm = h.gripMaterial;
  const kind = hasMat(gm) ? mat(gm).kind : 'wood';
  const mod = (a: number, n: number) => ((a % n) + n) % n;
  for (let y = lay.gripTop; y < lay.gripBottom; y++) {
    const kk = (y - lay.gripTop) / Math.max(1, lay.gripBottom - lay.gripTop);
    const bulge = Math.sin(kk * Math.PI) * 0.6 * k;
    const cx = lay.cx + (h.guardOffset * (1 - kk) + h.pommelOffset * kk) * k;
    const xa = Math.round(cx - half - bulge), xb = Math.round(cx + half + bulge);
    for (let x = xa; x <= xb; x++) {
      const dx = x - cx;
      const across = dx / (half + bulge + 0.01);
      let s = 3 - across * 1.1;
      const yy = y - lay.gripTop, xx = x - Math.round(lay.cx) + 8 * k;
      // grip material texture
      if (kind === 'wood') s += (valueNoise(seed + 50, (x / k) * 1.7, y / k / 4) - 0.5) * 1.1 + (hi ? (noise2(seed + 53, x, Math.floor(y / (5 * k))) - 0.5) * 0.5 : 0);
      if (kind === 'bone') { if (yy % (5 * k) === 0) s -= 1.1; else if (hi && yy % (5 * k) === 1) s += 0.5; }
      if (gm === 'antler') s += (noise2(seed + 51, x, y) > 0.8 ? 0.9 : 0) - (noise2(seed + 52, x, y) > 0.9 ? 1 : 0);
      if (kind === 'leather') {
        if (Math.floor(yy / k) % 6 === 3 && Math.abs(dx) < 0.5 * k) s -= 0.8;
        if (hi) s += (noise2(seed + 54, x, y) - 0.5) * 0.35; // fine grain
      }
      let layer = L_GRIP, pal = G;
      let wrapped = false;
      let band = 0; // position within a wrap band: -1 leading edge, 1 trailing edge
      switch (h.wrap) {
        case 'spiral': { const p = mod(yy + xx, 4 * k); wrapped = p < 2 * k; band = p === 0 ? -1 : p === 2 * k - 1 ? 1 : 0; break; }
        case 'crosshatch': {
          const per = hi ? 3 * k : 4;
          wrapped = mod(yy + xx, per) === 0 || mod(yy - xx, per) === 0;
          break;
        }
        case 'bands': { const p = yy % (5 * k); wrapped = p < 2 * k; band = p === 0 ? -1 : p === 2 * k - 1 ? 1 : 0; break; }
        case 'braided': { const p = mod(yy + Math.abs(Math.round(dx)), 4 * k); wrapped = p < 2 * k; band = p === 0 ? -1 : p === 2 * k - 1 ? 1 : 0; break; }
        case 'wire': wrapped = hi ? mod(yy + Math.floor(xx / k), 2) === 0 : mod(yy + xx, 2) === 0; break;
      }
      if (wrapped) {
        layer = L_WRAP;
        pal = h.wrap === 'wire' ? ctx.S : W;
        s = 3.3 - across * 1.2;
        if (hi) s += band < 0 ? 0.8 : band > 0 ? -0.9 : 0;
        else s += mod(yy + xx, 4) === 0 ? 0.6 : 0;
      }
      if (hi && (x === xa || x === xb)) s += x === xa ? 0.5 : -0.6;
      c.put(x, y, layer, pal, s);
    }
  }
}

// ------------------------------------------------------------ pommel
/** Pommel silhouette in logical pixels relative to its centre. */
function pommelInside(p: string, dx: number, dy: number, r: number): boolean {
  const d = Math.hypot(dx, dy);
  switch (p) {
    case 'disc': return (dx * dx) / ((r + 1.2) * (r + 1.2)) + (dy * dy) / ((r * 0.6) * (r * 0.6)) <= 1;
    case 'faceted': return Math.abs(dx) + Math.abs(dy) * 0.9 <= r + 0.6;
    case 'crescent': return d <= r && Math.hypot(dx, dy + r * 0.9) > r * 0.75;
    case 'wheel': return d <= r + 0.6;
    case 'ring': return d <= r + 0.4 && d >= r - 1.6;
    case 'teardrop': return dy >= 0 ? d <= r : Math.abs(dx) <= (r) * (1 + dy / (r * 1.8));
    case 'crown': return Math.abs(dx) <= r && dy >= -r * 0.5 && (dy <= r * 0.4 || (Math.abs(Math.round(dx)) % 3 === 0 && dy <= r + 0.5));
    case 'fishtail': return dy >= -r * 0.6 && Math.abs(dx) <= 1.5 + Math.max(0, dy) * 0.9 && !(dy > r * 0.2 && Math.abs(dx) < (dy - r * 0.2) * 0.8);
    case 'scentstopper': return Math.abs(dy) <= r && Math.abs(dx) <= r * (0.42 + 0.5 * ((dy + r) / (2 * r))) + (dy > r * 0.72 ? -(dy - r * 0.72) * 0.9 : 0);
    case 'gearwheel': {
      const a = Math.atan2(dy, dx);
      const rr = r + (Math.cos(a * 8) > 0.3 ? 1.1 : 0);
      return d <= rr && d >= 1.1;
    }
    default: return d <= r;
  }
}

function drawPommel(ctx: Ctx, lay: BladeLayout) {
  const { item, c, S, k } = ctx;
  const h = item.hilt!;
  const hi = k > 1;
  const r = lay.pommelH / k / 2; // logical radius
  const cx = lay.cx + h.pommelOffset * k, cy = lay.pommelCy;
  const e = 1 / k;
  for (let y = Math.floor(cy - (r + 2) * k); y <= cy + (r + 2) * k; y++)
    for (let x = Math.floor(cx - (r + 3) * k); x <= cx + (r + 3) * k; x++) {
      const dx = (x - cx) / k, dy = (y - cy) / k; // logical offsets
      if (!pommelInside(h.pommel, dx, dy, r)) continue;
      const d = Math.hypot(dx, dy) / Math.max(1, r);
      let s = 3 + (-dx * 0.55 - dy * 0.8) / Math.max(1, r) * 1.6 - d * 0.3;
      if (!hi) { if (Math.round(dx) === -1 && Math.round(dy) === -1) s = 5; }
      else {
        // rim light on the upper-left edge, rim shadow on the lower-right, and a small glint
        if (!pommelInside(h.pommel, dx - e, dy, r) || !pommelInside(h.pommel, dx, dy - e, r)) s = Math.max(s, 4.5);
        else if (!pommelInside(h.pommel, dx + e, dy, r) || !pommelInside(h.pommel, dx, dy + e, r)) s = Math.min(s, 1.5);
        if (Math.hypot(dx + r * 0.38, dy + r * 0.38) < 0.55) s = 5;
      }
      if (h.pommel === 'wheel' && Math.hypot(dx, dy) < 1.4) s = hi && Math.hypot(dx, dy) > 0.9 ? 2.0 : 1.2;
      if (h.pommel === 'faceted') s += ((dx > 0 ? 1 : 0) + (dy > 0 ? 1 : 0)) * -0.6;
      c.put(x, y, L_POMMEL, S, s);
    }
}

// ------------------------------------------------------------ decoration
/** Device-pixel position of a blade-local (t,u) coordinate. */
function bladePoint(item: Item, lay: BladeLayout, t: number, u: number, k: number): [number, number] {
  const row = rowK(item, t, k);
  const w = u < 0 ? row.L : row.R;
  return [row.center + u * w * 0.78, lay.bladeBase - t * item.blade!.length * k];
}

export function line(x0: number, y0: number, x1: number, y1: number, f: (x: number, y: number) => void) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 1600; n++) {
    f(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function engravePixel(ctx: Ctx, x: number, y: number, inlay: boolean, strength: number) {
  const { c } = ctx;
  x = Math.round(x); y = Math.round(y);
  if (!c.is(x, y, L_BLADE)) return;
  const i = c.idx(x, y);
  if (Math.abs(c.bu[i]) > 0.94) return; // never cut the edge itself
  c.layer[i] = L_ENGRAVE;
  c.shade[i] = 1.25 + (1 - strength) * 1.2;
  if (inlay) c.addTint(i, ctx.inlayRgb, 0.6 * strength);
}

/** Hi-res only: the far wall of every cut catches the light, so engraving reads as carved. */
function carveHighlights(ctx: Ctx) {
  const { c, k } = ctx;
  if (k <= 1) return;
  for (let y = 1; y < c.h; y++)
    for (let x = 1; x < c.w; x++) {
      const i = c.idx(x, y);
      if (c.layer[i] !== L_BLADE) continue;
      if (c.layer[c.idx(x - 1, y - 1)] === L_ENGRAVE || c.layer[c.idx(x, y - 1)] === L_ENGRAVE) c.shade[i] = Math.min(5, c.shade[i] + 0.75);
    }
}

function drawEngraving(ctx: Ctx, lay: BladeLayout) {
  const { item, k } = ctx;
  const e = item.decoration.engraving;
  if (!e || e.pattern === 'none') return;
  const paths = engravingPaths(e.pattern, item.seed);
  const strength = 0.45 + 0.55 * e.crispness;
  const slips = new Set(e.slips);
  let s = 0;
  const r = seededRng(item.seed, 'engrave-stray');
  for (const p of paths) {
    for (let n = 0; n < p.length; n++, s++) {
      const j = e.jitter.length ? e.jitter[s % e.jitter.length] : 0;
      const [t, u] = p[n];
      const [x, y] = bladePoint(item, lay, t, clamp(u + j * 0.28, -1, 1), k);
      if (n > 0 && !slips.has(s)) {
        const jp = e.jitter.length ? e.jitter[(s - 1) % e.jitter.length] : 0;
        const [tp, up] = p[n - 1];
        const [xp, yp] = bladePoint(item, lay, tp, clamp(up + jp * 0.28, -1, 1), k);
        line(xp, yp, x, y, (px, py) => engravePixel(ctx, px, py, e.inlay, strength));
      } else engravePixel(ctx, x, y, e.inlay, strength);
    }
  }
  // Handmade imperfection: stray graver marks.
  const strays = Math.round((1 - e.crispness) * 9);
  for (let i = 0; i < strays; i++) {
    const [x, y] = bladePoint(item, lay, r.range(0.08, 0.6), r.range(-0.7, 0.7), k);
    engravePixel(ctx, x, y, false, 0.4);
    if (r.chance(0.5)) engravePixel(ctx, x + 1, y + 1, false, 0.3);
  }
}

function drawInscription(ctx: Ctx, lay: BladeLayout, startT: number) {
  const { item, k } = ctx;
  const text = (item.decoration.inscription || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  const b = item.blade!;
  const len = b.length * k;
  let y = Math.round(lay.bladeBase - startT * len);
  for (const ch of text) {
    if (y < lay.bladeTip + len * 0.18) break;
    if (ch === ' ') { y -= 3 * k; continue; }
    const g = upscaleBitmap(glyphFor(ch), k);
    const t = (lay.bladeBase - y) / len;
    const row = rowK(item, clamp(t), k);
    const left = Math.round(row.center - (3 * k) / 2 + 0.5), top = y - 5 * k + 1;
    for (let gy = 0; gy < 5 * k; gy++)
      for (let gx = 0; gx < 3 * k; gx++)
        if (g[gy][gx] === '#') engravePixel(ctx, left + gx, top + gy, true, 0.8);
    y -= 6 * k;
  }
}

function drawEmblem(ctx: Ctx, lay: BladeLayout) {
  const { item, c, k } = ctx;
  const e = item.decoration.emblem;
  const bm0 = EMBLEM_BITMAPS[e];
  if (!bm0) return;
  const bm = upscaleBitmap(bm0, k);
  const n = 7 * k;
  const row = rowK(item, 0.04, k);
  const wide = row.L + row.R >= 8 * k;
  // Wide blades carry it on the ricasso; narrow blades carry it on the pommel side of the guard.
  const left = Math.round(row.center - n / 2 + 0.5);
  const top = wide ? Math.round(lay.bladeBase - (k - 1) - 10 * k) : Math.round(lay.guardTop - k);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      if (bm[y][x] !== '#') continue;
      const px = left + x, py = top + y;
      if (wide) {
        if (!c.is(px, py, L_BLADE, L_ENGRAVE)) continue;
        const i = c.idx(px, py);
        c.layer[i] = L_EMBLEM; c.shade[i] = 1.6; c.addTint(i, ctx.inlayRgb, 0.75);
      } else if (c.is(px, py, L_GUARD) && (x + y) % 2 === 0) {
        const i = c.idx(px, py);
        c.addTint(i, ctx.inlayRgb, 0.6);
      }
    }
}

/** A small set stone centred on device (x, y). */
function drawStone(ctx: Ctx, x: number, y: number, pal: number, rot: number, onlyOver: boolean) {
  const { c, k } = ctx;
  if (k === 1) {
    const skew = Math.round(rot * 2);
    for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1], [skew, -1], [-skew, 1]]) {
      const px = Math.round(x + dx), py = Math.round(y + dy);
      if (onlyOver && !c.is(px, py)) continue;
      c.put(px, py, L_STONE, pal, 3 - dy * 0.9 - dx * 0.4);
    }
    return;
  }
  const R = 1.55 * k, a = rot * 0.7, ca = Math.cos(a), sa = Math.sin(a);
  for (let py = Math.floor(y - R - 1); py <= y + R + 1; py++)
    for (let px = Math.floor(x - R - 1); px <= x + R + 1; px++) {
      const dx = px - x, dy = py - y;
      const ex = (dx * ca + dy * sa) / R, ey = (-dx * sa + dy * ca) / (R * 0.8);
      const n = ex * ex + ey * ey;
      if (n > 1) continue;
      if (onlyOver && !c.is(px, py)) continue;
      let s = 3 - (dy / R) * 1.2 - (dx / R) * 0.6;
      if (n > 0.62) s -= 0.9; // dark seat around the stone
      if (Math.hypot(dx + R * 0.35, dy + R * 0.35) < 0.8) s = 4.8;
      c.put(px, py, L_STONE, pal, s);
    }
}

function drawStones(ctx: Ctx, lay: BladeLayout) {
  const { item, c, k } = ctx;
  for (const st of item.decoration.stones) {
    const sp = c.addPalette('stone:' + st.stone, matPalette(st.stone, 'riverstone'));
    const [x, y] = bladePoint(item, lay, st.t, st.u, k);
    drawStone(ctx, x, y, sp, st.rot, true);
  }
}

function drawStar(ctx: Ctx, x: number, y: number, brightness: number) {
  const { c, k } = ctx;
  x = Math.round(x); y = Math.round(y);
  if (!c.is(x, y)) return;
  const i = c.idx(x, y);
  c.shade[i] = 5; c.addTint(i, [255, 255, 255], brightness);
  if (k > 1) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (!c.is(x + dx, y + dy)) continue;
    const j = c.idx(x + dx, y + dy);
    c.shade[j] = Math.max(c.shade[j], 4.2); c.addTint(j, ctx.glowRgb, 0.55 * brightness);
  }
}

function drawConstellation(ctx: Ctx, lay: BladeLayout) {
  const { item, c, k } = ctx;
  const con = item.decoration.constellation;
  if (!con) return;
  const pts = con.points.map(([t, u]) => bladePoint(item, lay, t, u, k));
  for (let i = 1; i < pts.length; i++) {
    line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], (x, y) => {
      if (!c.is(x, y, L_BLADE, L_ENGRAVE)) return;
      c.addTint(c.idx(x, y), ctx.glowRgb, 0.35 * con.brightness);
    });
  }
  for (const [x, y] of pts) drawStar(ctx, x, y, 0.5 + 0.5 * con.brightness);
}

function gemPalette(c: Canvas, gem: string) {
  return c.addPalette('gem:' + gem, matPalette(gem, 'quartz'));
}

export function drawGem(ctx: Ctx, gx: number, gy: number, gem: string, big = false) {
  const { c, S, k } = ctx;
  const gp = gemPalette(c, gem);
  if (k === 1) {
    gx = Math.round(gx); gy = Math.round(gy);
    const pattern = big
      ? [[-1, -2, 4], [0, -2, 4], [-2, -1, 4], [-1, -1, 5], [0, -1, 3], [1, -1, 3], [-2, 0, 3], [-1, 0, 3], [0, 0, 2], [1, 0, 2], [-1, 1, 2], [0, 1, 1]]
      : [[0, -1, 4], [-1, 0, 4], [0, 0, 3], [1, 0, 2], [0, 1, 1]];
    // setting ring
    for (const [dx, dy] of big ? [[-2, -2], [1, -2], [-3, 0], [2, 0], [-2, 2], [1, 2]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      c.put(gx + dx, gy + dy, L_GUARD, S, 3.6);
    for (const [dx, dy, s] of pattern) c.put(gx + dx, gy + dy, L_GEM, gp, s);
    c.put(gx + (big ? -1 : 0), gy - (big ? 1 : 1), L_GEM, gp, 5);
    return;
  }
  // Hi-res: a faceted cabochon in a metal setting — a bright table, eight facets lit from the upper left.
  const R = (big ? 2.5 : 1.5) * k;
  for (let py = Math.floor(gy - R - 2); py <= gy + R + 2; py++)
    for (let px = Math.floor(gx - R - 2); px <= gx + R + 2; px++) {
      const dx = px - gx, dy = py - gy;
      const d = Math.hypot(dx, dy);
      if (d > R + 1.15) continue;
      const lit = d > 0 ? -(dx + dy) / (d * 1.4142) : 0;
      if (d > R) { c.put(px, py, L_GUARD, S, 3.3 + lit * 1.3); continue; }
      let s: number;
      if (d < R * 0.45) s = 3.4 + lit * 0.4;
      else {
        const sa = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        s = 2.9 - ((Math.cos(sa) + Math.sin(sa)) / 1.4142) * 1.9;
      }
      c.put(px, py, L_GEM, gp, s);
    }
  c.put(gx - R * 0.3, gy - R * 0.35, L_GEM, gp, 5);
  if (big) c.put(gx - R * 0.3 + 1, gy - R * 0.35, L_GEM, gp, 5);
}

function drawGems(ctx: Ctx, lay: BladeLayout) {
  const { item, k } = ctx;
  const h = item.hilt!;
  for (const g of item.decoration.gems) {
    if (g.slot === 'guard') drawGem(ctx, lay.cx + h.guardOffset * k, lay.guardTop + lay.guardH / 2 - (k > 1 ? 0.5 : 0), g.gem);
    else if (g.slot === 'pommel') drawGem(ctx, lay.cx + h.pommelOffset * k, lay.pommelCy, g.gem);
    else if (g.slot === 'blade') {
      const row = rowK(item, 0.13, k);
      drawGem(ctx, row.center, lay.bladeBase - 0.13 * item.blade!.length * k, g.gem);
    }
  }
}

function drawMutationsShade(ctx: Ctx) {
  const { item, c, seed, k } = ctx;
  for (const m of item.mutations) {
    for (let i = 0; i < c.layer.length; i++) {
      const L = c.layer[i];
      if (L !== L_BLADE && L !== L_FACE && L !== L_ENGRAVE) continue;
      const x = i % c.w, y = Math.floor(i / c.w);
      const lx = x / k, ly = y / k;
      if (m === 'colorband' && Math.floor(ly / 7 + noise2(seed, 0, Math.floor(ly / 7)) * 2) % 5 === 0) c.addTint(i, hslToRgb(noise2(seed, 1, Math.floor(ly / 35)), 0.6, 0.55), 0.45);
      if (m === 'speckle' && noise2(seed + 99, x, y) > 0.9) c.shade[i] = noise2(seed, x, y) > 0.95 ? 5 : 0.8;
      if (m === 'ghostedge' && Math.abs(c.bu[i]) > 0.7) c.alpha[i] = 0.55;
      if (m === 'veins' && Math.abs(Math.sin(lx * 0.9 + valueNoise(seed + 5, lx / 4, ly / 4) * 6)) < 0.12) c.addTint(i, ctx.accentRgb, 0.6);
      if (m === 'inverted' && L === L_BLADE) c.shade[i] = 5 - c.shade[i];
    }
  }
}

export function drawFinishShade(ctx: Ctx) {
  const { item, c, seed, k } = ctx;
  const f = item.finish.finish;
  const per = 4 * k;
  const mod = (a: number, n: number) => ((a % n) + n) % n;
  for (let i = 0; i < c.layer.length; i++) {
    const L = c.layer[i];
    if (!METAL_LAYERS.has(L) && L !== L_ENGRAVE && L !== L_FACE) continue;
    const x = i % c.w, y = Math.floor(i / c.w);
    if (f === 'etched' && L === L_BLADE && Math.abs(c.bu[i]) < 0.7 && (mod(x + y, per) === 0 || mod(x - y, per) === 0)) c.shade[i] -= 0.7;
    if (f === 'contrast' && L === L_BLADE && Math.abs(c.bu[i]) > 0.62) c.pal[i] = ctx.S;
    if (f === 'heirloom' && L === L_BLADE && Math.abs(c.bu[i]) > 0.8) c.shade[i] += 0.6;
    if (f === 'mirror' && (L === L_BLADE || L === L_FACE)) { c.shade[i] = 3 + (c.shade[i] - 3) * 1.6; if (mod((y / k) * 0.6 + x / k, 22) < 3) c.shade[i] = 5; }
    if (f === 'satin') { c.shade[i] = 3 + (c.shade[i] - 3) * 0.72; if (noise2(seed + 63, Math.floor(x / (3 * k)), y) > 0.62) c.shade[i] += 0.22; }
    if (f === 'sunlit' && c.shade[i] > 3.5) c.shade[i] += 0.45;
    if (f === 'peacock' && L === L_BLADE) {
      // temper colours run from straw at the spine to purple and blue at the edges
      const e = Math.abs(c.bu[i]);
      if (e > 0.74) c.addTint(i, [64, 70, 190], 0.5); else if (e > 0.5) c.addTint(i, [150, 70, 176], 0.4); else if (e > 0.28) c.addTint(i, [214, 150, 60], 0.3);
    }
    if (f === 'skyiron' && noise2(seed + 64, x, y) > 1 - 0.02 / k) { c.shade[i] = 5.4; c.addTint(i, [235, 240, 255], 0.8); }
    if (f === 'polished' && noise2(seed + 61, x, y) > 1 - 0.035 / k) c.shade[i] = 5.2;
    if (f === 'glossy' && noise2(seed + 62, x, y) > 1 - 0.015 / k) c.shade[i] = 5.3;
  }
}

/** Where a blemish sits on the sprite (device pixels). */
function blemishPoint(item: Item, w: number, h: number, lay: BladeLayout | null, t: number, u: number, k: number): [number, number] {
  if (lay && item.blade) return bladePoint(item, lay, t, u, k);
  const craft = craftBlemishPoint(item, t, u, k);
  if (craft) return craft;
  return [w / 2 + u * w * 0.32, h * (0.15 + t * 0.7)];
}

export function drawBlemishes(ctx: Ctx, lay: BladeLayout | null) {
  const { item, c, k } = ctx;
  for (const bl of item.blemishes) {
    let [x, y] = blemishPoint(item, c.w, c.h, lay, bl.t, bl.u, k);
    x = Math.round(x); y = Math.round(y);
    // Faint blemishes (low depth) barely disturb the surface; the inspection lamp is the way to find them.
    const depth = clamp(bl.depth ?? 1, 0, 1);
    const w = 0.22 + 0.78 * depth;
    const mark = (px: number, py: number, s: number) => {
      if (!c.is(px, py, L_BLADE, L_FACE, L_RIM, L_BOSS, L_ENGRAVE)) return;
      const i = c.idx(px, py);
      c.shade[i] = c.shade[i] + (s - c.shade[i]) * w;
    };
    if (k === 1) {
      if (bl.kind === 'pit') { mark(x, y, 0.4); mark(x, y + 1, 4.4); }
      else if (bl.kind === 'scratch') { mark(x, y, 4.8); mark(x + 1, y - 1, 4.6); mark(x + 2, y - 2, 4.2); }
      else { mark(x, y, 0.8); mark(x + 1, y, 1.2); if (c.in(x, y)) c.addTint(c.idx(x, y), [60, 40, 30], 0.5 * w); }
    } else if (bl.kind === 'pit') {
      // a small crater: dark hollow, lit lower lip
      mark(x, y, 0.4); mark(x + 1, y, 0.7); mark(x, y + 1, 0.9); mark(x + 1, y + 1, 1.3);
      mark(x, y + 2, 4.5); mark(x + 1, y + 2, 4.5); mark(x + 2, y + 1, 4.2); mark(x + 2, y, 3.9);
    } else if (bl.kind === 'scratch') {
      // a fine diagonal scratch with a shadow line under it
      for (let n = 0; n < 3 * k; n++) { mark(x + n, y - n, 4.8 - n * 0.08); mark(x + n, y - n + 1, 2.0); }
    } else {
      // a patch of forge scale
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < 2 * k; dx++) {
        if (noise2(ctx.seed + 7, x + dx, y + dy) > 0.82) continue;
        mark(x + dx, y + dy, dx === 0 || dy === 0 ? 1.4 : 0.8);
        if (c.in(x + dx, y + dy)) c.addTint(c.idx(x + dx, y + dy), [60, 40, 30], 0.5 * w);
      }
    }
  }
}

// ============================================================ shields
function shieldInside(shape: string, nx: number, ny: number): boolean {
  // nx -1..1, ny -1..1
  switch (shape) {
    case 'heater': {
      if (ny < -0.92) return false;
      const k = (ny + 0.92) / 1.92;
      const hw = k < 0.42 ? 1 : Math.pow(Math.cos(((k - 0.42) / 0.58) * Math.PI / 2), 0.75);
      return Math.abs(nx) <= hw;
    }
    case 'kite': {
      const k = (ny + 1) / 2;
      if (k < 0.3) return nx * nx + Math.pow((k - 0.3) / 0.3, 2) <= 1;
      return Math.abs(nx) <= Math.pow(1 - (k - 0.3) / 0.7, 0.9);
    }
    case 'tower': {
      const ax = Math.abs(nx), ay = Math.abs(ny);
      if (ax <= 0.82 || ay <= 0.88) return ax <= 1 && ay <= 1;
      return Math.hypot((ax - 0.82) / 0.18, (ay - 0.88) / 0.12) <= 1;
    }
    case 'buckler':
    default:
      return nx * nx + ny * ny <= 1;
  }
}

/** Shield layout in logical pixels. */
export function shieldLayout(item: Item) {
  const [W, H] = CATEGORY_INFO.shield.size;
  const s = item.shield!;
  let w = s.width, h = s.height;
  if (s.shape === 'buckler') { w *= 0.62; h = w; }
  if (s.shape === 'round') h = w;
  return { W, H, cx: W / 2 - 0.5, cy: H / 2 - 1, rx: w / 2, ry: h / 2 };
}

function shieldLayoutK(item: Item, k: number) {
  const l = shieldLayout(item);
  if (k === 1) return l;
  const o = (k - 1) / 2;
  return { W: l.W * k, H: l.H * k, cx: l.cx * k + o, cy: l.cy * k + o, rx: l.rx * k, ry: l.ry * k };
}

function renderShield(item: Item, view: View, k: number): PixelImage {
  const sh = item.shield!;
  const hi = k > 1;
  const { W, H, cx, cy, rx, ry } = shieldLayoutK(item, k);
  const c = new Canvas(W, H);
  const ctx = makeCtx(item, c, view, k);
  const faceIsWood = isWood(sh.faceMaterial);
  const FP = faceIsWood ? c.addPalette('face', matPalette(sh.faceMaterial, 'oak')) : ctx.P;
  const inside = (x: number, y: number) => shieldInside(sh.shape, (x - cx) / rx, (y - cy) / ry);
  // face
  const plankW = (rx * 2) / Math.max(3, sh.planks);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!inside(x, y)) continue;
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      let s = 3 - nx * 0.7 - ny * 0.5;
      if (faceIsWood) {
        const p = Math.floor((x - (cx - rx)) / plankW);
        const px = x - (cx - rx) - p * plankW;
        s += (valueNoise(ctx.seed + p * 13, (x / k) * 1.4, y / k / 5) - 0.5) * 1.2;
        if (hi) s += (noise2(ctx.seed + p * 7, x, Math.floor(y / (7 * k))) - 0.5) * 0.45; // fine grain lines
        if (px < 1) s = 1.3; // plank seam
        else if (hi && px < 2) s += 0.6; // lit edge of the next plank
      }
      // dents from hammering
      const ang = (Math.atan2(ny, nx) / (Math.PI * 2) + 1) % 1;
      const dent = sampleCurve(sh.dents, ang);
      const rad = Math.hypot(nx, ny);
      if (dent > 0.05 && rad > 0.35 && rad < 0.8) s += Math.sin(rad * 18) * dent * 1.4;
      c.put(x, y, L_FACE, FP, s);
      c.bt[c.idx(x, y)] = clamp((y - (cy - ry)) / (ry * 2));
      c.bu[c.idx(x, y)] = nx;
    }
  // rim: pixels near the boundary
  const rimDx = Math.round(sh.rimGap * k);
  const rimW = sh.rim * k;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = x - rimDx;
      if (!inside(sx, y)) continue;
      let edge = 0;
      for (let n = 1; n <= rimW && !edge; n++)
        if (!inside(sx + n, y) || !inside(sx - n, y) || !inside(sx, y + n) || !inside(sx, y - n)) edge = n;
      if (!edge) continue;
      const nx = (sx - cx) / rx, ny = (y - cy) / ry;
      let s = 3.2 - nx * 1.1 - ny * 0.9;
      if (hi) { if (edge === 1) s += 0.7; else if (edge === rimW) s -= 1.0; }
      c.put(x, y, L_RIM, ctx.S, s);
    }
  // rivets
  const rivets = 12;
  for (let n = 0; n < rivets; n++) {
    const a = (n / rivets) * Math.PI * 2;
    let rr = 1;
    for (let it = 0; it < 30; it++) { if (!inside(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr)) rr -= 0.02; else break; }
    const px = Math.round(cx + Math.cos(a) * (rx * rr - rimW / 2) + rimDx), py = Math.round(cy + Math.sin(a) * (ry * rr - rimW / 2));
    if (!hi) { if (c.is(px, py, L_RIM)) c.shade[c.idx(px, py)] = 5; continue; }
    // a small domed rivet head
    for (const [dx, dy, s] of [[0, 0, 5], [1, 0, 3.6], [0, 1, 3.4], [1, 1, 1.4]] as const)
      if (c.is(px + dx, py + dy, L_RIM)) c.shade[c.idx(px + dx, py + dy)] = s;
  }
  drawSurfaceTexture(ctx);
  drawFusion(ctx);
  // emblem
  const bm0 = EMBLEM_BITMAPS[item.decoration.emblem];
  if (bm0) {
    const scale = (sh.boss === 'none' ? 4 : 2) * k;
    const bm = upscaleBitmap(bm0, scale);
    const n = 7 * scale;
    const ex = Math.round(cx - n / 2 + 0.5), ey = Math.round((sh.boss === 'none' ? cy : cy - ry * 0.52) - n / 2 + 0.5);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (bm[y][x] !== '#') continue;
        const px = ex + x, py = ey + y;
        if (!c.is(px, py, L_FACE)) continue;
        const i = c.idx(px, py);
        c.layer[i] = L_EMBLEM;
        c.addTint(i, ctx.accentRgb, 0.85);
        // painted emblems get a darker lower-right edge so they sit on the face
        if (hi && (y + 1 >= n || x + 1 >= n || bm[y + 1][x] !== '#' || bm[y][x + 1] !== '#')) c.shade[i] -= 0.9;
      }
  }
  // engraving ring
  const e = item.decoration.engraving;
  if (e.pattern !== 'none') {
    const paths = engravingPaths(e.pattern, item.seed);
    let s = 0;
    const slips = new Set(e.slips);
    const toXY = (t: number, u: number, j: number): [number, number] => {
      const a = ((t - 0.07) / 0.53) * Math.PI * 2 - Math.PI / 2;
      const rr = 0.66 + (u + j * 0.28) * 0.09;
      return [cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr];
    };
    const cut: number[] = [];
    const mark = (px: number, py: number) => {
      if (!c.is(px, py, L_FACE, L_EMBLEM)) return;
      const i = c.idx(px, py);
      c.shade[i] = 1.2 + (1 - e.crispness);
      if (e.inlay) c.addTint(i, ctx.inlayRgb, 0.8);
      cut.push(i);
    };
    for (const p of paths)
      for (let n = 0; n < p.length; n++, s++) {
        const j = e.jitter.length ? e.jitter[s % e.jitter.length] : 0;
        const [x, y] = toXY(p[n][0], p[n][1], j);
        if (n > 0 && !slips.has(s)) {
          const jp = e.jitter.length ? e.jitter[(s - 1) % e.jitter.length] : 0;
          const [xp, yp] = toXY(p[n - 1][0], p[n - 1][1], jp);
          line(xp, yp, x, y, mark);
        } else mark(Math.round(x), Math.round(y));
      }
    if (hi) {
      // the far wall of each cut catches the light
      const isCut = new Set(cut);
      for (const i of cut) {
        const j = i + c.w + 1;
        if (j < c.layer.length && !isCut.has(j) && (c.layer[j] === L_FACE || c.layer[j] === L_EMBLEM)) c.shade[j] = Math.min(5, c.shade[j] + 0.7);
      }
    }
  }
  // boss
  if (sh.boss !== 'none') {
    const br = (sh.boss === 'flat' ? 6 : 7.5) * k;
    const BP = ctx.S;
    for (let y = Math.floor(cy - br); y <= cy + br; y++)
      for (let x = Math.floor(cx - br); x <= cx + br; x++) {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        if (d > br) continue;
        let s = sh.boss === 'flat' ? 3 - (dx / k) * 0.08 - (dy / k) * 0.1 : 3 + (-dx * 0.6 - dy * 0.8) / br * 2;
        if (d > br - 1) s = 1.6;
        else if (hi && d > br - 2) s = Math.min(s, 2.3);
        if (hi && sh.boss !== 'flat' && Math.hypot(dx + br * 0.34, dy + br * 0.4) < br * 0.13) s = 5;
        if (hi && sh.boss === 'flat' && d > br * 0.55 && d < br * 0.55 + 1) s -= 0.8;
        if (sh.boss === 'spike' && d < 2.2 * k) s = d < 1 * k ? 5 : 4;
        c.put(x, y, L_BOSS, BP, s);
      }
  }
  for (const g of item.decoration.gems) {
    if (g.slot === 'boss' || g.slot === 'guard') drawGem(ctx, cx, cy, g.gem, true);
    if (g.slot === 'pommel' || g.slot === 'blade') drawGem(ctx, cx, cy + ry * 0.62, g.gem);
  }
  for (const st of item.decoration.stones) {
    const sp = c.addPalette('stone:' + st.stone, matPalette(st.stone, 'riverstone'));
    const a = st.t * Math.PI * 2;
    drawStone(ctx, Math.round(cx + Math.cos(a) * rx * 0.5), Math.round(cy + Math.sin(a) * ry * 0.5), sp, st.rot, false);
  }
  if (item.decoration.constellation) {
    const con = item.decoration.constellation;
    const pts = con.points.map(([t, u]) => [cx + u * rx * 0.7, cy - ry * 0.7 + t * ry * 1.4] as [number, number]);
    for (let i = 1; i < pts.length; i++) line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], (x, y) => { if (c.is(x, y)) c.addTint(c.idx(x, y), ctx.glowRgb, 0.35 * con.brightness); });
    for (const [x, y] of pts) drawStar(ctx, x, y, 0.6);
  }
  drawMutationsShade(ctx);
  drawFinishShade(ctx);
  drawBlemishes(ctx, null);
  const img = compose(ctx);
  return view === 'back' ? renderShieldBack(item, img, k) : img;
}

function renderShieldBack(item: Item, front: PixelImage, k: number): PixelImage {
  // The back shows the wooden backing, the grip strap and the rim — plus any inscription.
  const out = front.mirrored();
  const { cx, cy, rx } = shieldLayoutK(item, k);
  const grip = hexToRgb(item.hilt?.wrapColor || designPalette(item.design.palette).wrap);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const i = (y * out.w + x) * 4;
      if (out.data[i + 3] === 0) continue;
      const r = out.data[i], g = out.data[i + 1], b = out.data[i + 2];
      const dark = 0.55;
      out.data[i] = r * dark; out.data[i + 1] = g * dark; out.data[i + 2] = b * dark;
      const dy = Math.abs(y - cy);
      if (dy <= 2 * k + (k - 1) / 2 && Math.abs(x - cx) < rx * 0.55) {
        const s = dy > 2 * k - 1 ? 0.6 : k > 1 && dy < 0.6 ? 1.15 : 1;
        out.data[i] = grip[0] * s; out.data[i + 1] = grip[1] * s; out.data[i + 2] = grip[2] * s;
      }
    }
  return out;
}

// ============================================================ profile (edge-on)
function renderProfile(item: Item, k: number): PixelImage {
  const [W, H] = CATEGORY_INFO[item.category].size;
  const c = new Canvas(W * k, H * k);
  const ctx = makeCtx(item, c, 'profile', k);
  const hi = k > 1;
  if (item.category === 'shield') {
    const { cx, cy, ry } = shieldLayoutK(item, k);
    const sh = item.shield!;
    const depth = (sh.boss === 'none' ? 0 : sh.boss === 'spike' ? 10 : 6) * k;
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      const ny = (y - cy) / ry;
      const bow = (1 - ny * ny) * 4 * k;
      for (let n = 0; n < 3 * k; n++) c.put(cx - 2 * k + bow + n, y, n < k ? L_RIM : L_FACE, n < k ? ctx.S : ctx.P, 3.4 - n / k - (hi && n === 3 * k - 1 ? 0.6 : 0));
      if (Math.abs(ny) < 0.16 && depth) for (let d = 0; d < depth * (1 - Math.abs(ny) / 0.16); d++) c.put(cx - 3 * k + bow - d, y, L_BOSS, ctx.S, 3.5 - (d / k) * 0.2);
    }
    for (let y = Math.floor(cy - 3 * k); y <= cy + 3 * k; y++) for (let n = 0; n < k; n++) c.put(cx + 7 * k + n, y, L_WRAP, ctx.W, 3 - n * 0.6);
  } else {
    const lay = layoutK(item, k);
    const b = item.blade!, h = item.hilt!;
    const len = b.length * k;
    const thick = (1 + Math.round(b.thickness * 2 + (item.structure.approach === 'reinforced' ? 1 : 0))) * k;
    for (let y = lay.bladeTip; y <= lay.bladeBase; y++) {
      const t = (lay.bladeBase - y) / len;
      const row = rowK(item, t, k);
      if (row.L + row.R < 0.4 * k) continue;
      const tw = Math.max(1, Math.round(thick * (1 - t * 0.6)));
      const x0 = Math.round(lay.cx - tw / 2 + 0.5);
      for (let n = 0; n < tw; n++) c.put(x0 + n, y, L_BLADE, ctx.P, n === 0 ? 4.6 : hi && tw > 2 && n === tw - 1 ? 1.7 : 2.4);
    }
    const half = 2 * k + (k - 1) / 2;
    for (let y = lay.guardTop; y < lay.guardTop + lay.guardH; y++) for (let x = Math.ceil(lay.cx - half); x <= lay.cx + half; x++) c.put(x, y, L_GUARD, ctx.S, 3 - ((x - lay.cx) / k) * 0.5 + (hi && y === lay.guardTop ? 1 : 0));
    for (let y = lay.gripTop; y < lay.gripBottom; y++) for (let x = Math.ceil(lay.cx - half); x <= lay.cx + half; x++) c.put(x, y, L_GRIP, ctx.G, 3 - ((x - lay.cx) / k) * 0.6);
    const pw = (h.pommel === 'disc' || h.pommel === 'wheel' ? 1.5 : 3) * k + (k - 1) / 2;
    for (let y = Math.floor(lay.pommelCy - lay.pommelH / 2); y <= lay.pommelCy + lay.pommelH / 2; y++)
      for (let x = Math.ceil(lay.cx - pw); x <= lay.cx + pw; x++) c.put(x, y, L_POMMEL, ctx.S, 3 - ((x - lay.cx) / k) * 0.5);
  }
  drawSurfaceTexture(ctx);
  drawFinishShade(ctx);
  return compose(ctx);
}

// ============================================================ compose
export function compose(ctx: Ctx): PixelImage {
  const { c, item, seed, k } = ctx;
  const img = new PixelImage(c.w, c.h);
  const f = item.finish.finish;
  const glow = f === 'glow' || f === 'moonlit' || f === 'smoulder' || item.mutations.includes('halo');
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const i = c.idx(x, y);
      const L = c.layer[i];
      if (L === L_EMPTY) continue;
      const pal = c.palettes[c.pal[i]];
      const s = clamp(c.shade[i], 0, pal.length - 1);
      const base = Math.floor(s);
      const frac = s - base;
      const idx = Math.min(pal.length - 1, frac > BAYER4[(y % 4) * 4 + (x % 4)] ? base + 1 : base);
      let rgb: RGB = [...pal[idx]] as RGB;
      const ta = c.tint[i * 4 + 3];
      if (ta > 0) rgb = mixRgb(rgb, [c.tint[i * 4], c.tint[i * 4 + 1], c.tint[i * 4 + 2]], ta);
      rgb = applyFinishColor(f, rgb, x, y, seed, L, ctx);
      img.set(x, y, rgb[0], rgb[1], rgb[2], Math.round(255 * c.alpha[i]));
    }
  // outline (coloured "selout"), always one device pixel
  const outline = new PixelImage(c.w, c.h);
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      if (img.alpha(x, y) > 0) continue;
      let src = -1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (img.alpha(x + dx, y + dy) > 0) { src = c.idx(x + dx, y + dy); break; }
      }
      if (src < 0) continue;
      const pal = c.palettes[c.pal[src]];
      const d = mixRgb(pal[0], [8, 6, 10], 0.55);
      outline.set(x, y, d[0], d[1], d[2], 255);
    }
  for (let n = 0; n < img.data.length; n += 4) if (outline.data[n + 3] > 0 && img.data[n + 3] === 0) { img.data[n] = outline.data[n]; img.data[n + 1] = outline.data[n + 1]; img.data[n + 2] = outline.data[n + 2]; img.data[n + 3] = 255; }
  if (glow) {
    const gc = f === 'smoulder' ? ([255, 110, 40] as RGB) : f === 'moonlit' ? ([200, 216, 255] as RGB) : ctx.glowRgb;
    const strength = f === 'moonlit' ? 0.5 : 0.85;
    const R = 3 * k;
    const copy = new Uint8ClampedArray(img.data);
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) {
        const n = (y * c.w + x) * 4;
        if (copy[n + 3] > 0) continue;
        let best = R * 3;
        for (let dy = -R; dy <= R; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= c.h) continue;
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= c.w) continue;
            if (copy[(yy * c.w + xx) * 4 + 3] > 0) { const d = Math.hypot(dx, dy); if (d < best) best = d; }
          }
        }
        if (best <= R) {
          const a = (1 - best / (R * 1.2)) * strength * (0.75 + 0.25 * noise2(seed, x, y));
          img.set(x, y, gc[0], gc[1], gc[2], Math.round(a * 150));
        }
      }
  }
  return img;
}

function applyFinishColor(f: string, rgb: RGB, x: number, y: number, seed: number, L: number, ctx: Ctx): RGB {
  const metal = METAL_LAYERS.has(L) || L === L_ENGRAVE || L === L_FACE || L === L_EMBLEM;
  if (!metal) return rgb;
  const k = ctx.k;
  const lx = x / k, ly = y / k;
  let [h, s, l] = rgbToHsl(rgb);
  switch (f) {
    case 'matte': s *= 0.82; l = 0.5 + (l - 0.5) * 0.78; break;
    case 'glossy': l = clamp(0.5 + (l - 0.5) * 1.18); s = clamp(s * 1.08); break;
    case 'aged': {
      const out = mixRgb(rgb, [106, 80, 48], 0.2);
      [h, s, l] = rgbToHsl(out); l *= 0.88;
      if (valueNoise(seed + 71, lx / 3, ly / 3) > 0.7) l *= 0.82;
      break;
    }
    case 'polished': l = clamp(l * 1.05); break;
    case 'satin': s *= 0.9; l = 0.52 + (l - 0.52) * 0.86; break;
    case 'sunlit': { const m = mixRgb(rgb, [255, 214, 120], 0.2); [h, s, l] = rgbToHsl(m); l = clamp(l * 1.05); break; }
    case 'peacock': s = clamp(s * 1.15); break;
    case 'skyiron': { const m = mixRgb(rgb, [58, 70, 112], 0.24); [h, s, l] = rgbToHsl(m); l *= 0.8; break; }
    case 'glow': { const m = mixRgb(rgb, ctx.glowRgb, 0.14); [h, s, l] = rgbToHsl(m); l = clamp(l * 1.06); break; }
    case 'frosted': { const m = mixRgb(rgb, [240, 248, 255], 0.2); [h, s, l] = rgbToHsl(m); l = 0.55 + (l - 0.55) * 0.7; if (noise2(seed + 3, x, y) > 1 - 0.07 / k) l = 0.92; break; }
    case 'rosegold': { const m = mixRgb(rgb, [232, 150, 140], 0.26); [h, s, l] = rgbToHsl(m); break; }
    case 'verdigris': if (l < 0.42 || valueNoise(seed + 8, lx / 3, ly / 3) > 0.68) { const m = mixRgb(rgb, [74, 168, 136], 0.5); [h, s, l] = rgbToHsl(m); } break;
    case 'heirloom': { const m = mixRgb(rgb, [200, 160, 100], 0.12); [h, s, l] = rgbToHsl(m); l = 0.5 + (l - 0.5) * 0.85; break; }
    case 'mirror': { if (l > 0.6) { const m = mixRgb(rgb, [190, 220, 255], 0.25); [h, s, l] = rgbToHsl(m); } break; }
    case 'deepblue': { const m = mixRgb(rgb, [40, 60, 150], 0.32); [h, s, l] = rgbToHsl(m); break; }
    case 'moonlit': { const m = mixRgb(rgb, [200, 216, 255], 0.16); [h, s, l] = rgbToHsl(m); break; }
    case 'smoulder': { l *= 0.82; if (valueNoise(seed + 13, lx / 2, ly / 2) > 0.74) { const m = mixRgb(hslToRgb(h, s, l), [255, 110, 40], 0.6); return m; } break; }
    case 'prism': { const m = mixRgb(rgb, hslToRgb((lx * 0.07 + ly * 0.01) % 1, 0.8, 0.6), 0.3); return m; }
    default: break;
  }
  return hslToRgb(h, s, l);
}

/** A stable visual signature of an item (hash of its rendered front view). */
export function visualSignature(item: Item): string {
  return renderItem(item, 'front').hash();
}

export function signatureNumber(item: Item): number {
  return hash32(hashString(visualSignature(item)), item.seed);
}

/**
 * Sprite-pixel position of a blemish (front view) in a sprite rendered at scale k
 * (default: logical pixels). Shared with the inspection minigame.
 */
export function blemishPixel(item: Item, t: number, u: number, k = 1): [number, number] {
  const [W, H] = CATEGORY_INFO[item.category].size;
  const lay = item.blade ? layoutK(item, k) : null;
  const [x, y] = blemishPoint(item, W * k, H * k, lay, t, u, k);
  return [Math.round(x), Math.round(y)];
}

/** Logical-pixel position of a blade-local (t,u) coordinate. */
export function bladePixel(item: Item, t: number, u: number): [number, number] {
  return bladePoint(item, bladeLayout(item), t, u, 1);
}
