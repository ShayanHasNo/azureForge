// Layered procedural item renderer. Every pixel derives from the item's stored
// parameters + seed; nothing is picked from a predefined sprite list.
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

export type View = 'front' | 'back' | 'profile';

const L_EMPTY = 0, L_BLADE = 1, L_GUARD = 2, L_GRIP = 3, L_WRAP = 4, L_POMMEL = 5, L_GEM = 6, L_ENGRAVE = 7, L_STONE = 8, L_FACE = 9, L_RIM = 10, L_BOSS = 11, L_EMBLEM = 12;
const METAL_LAYERS = new Set([L_BLADE, L_GUARD, L_POMMEL, L_RIM, L_BOSS]);

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

class Canvas {
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

function matPalette(id: string | undefined, fallback = 'iron'): string[] {
  if (id && hasMat(id)) return mat(id).palette;
  return mat(fallback).palette;
}

interface Ctx {
  item: Item;
  c: Canvas;
  seed: number;
  view: View;
  P: number; // primary palette
  S: number; // secondary palette
  G: number; // grip palette
  W: number; // wrap palette
  inlayRgb: RGB;
  accentRgb: RGB;
  glowRgb: RGB;
}

// ============================================================ public API
const cache = new Map<string, PixelImage>();

export function visualKey(item: Item, view: View): string {
  const v = {
    c: item.category, s: item.seed, d: item.design, m: item.materials, st: item.structure, b: item.blade, sh: item.shield,
    h: item.hilt, su: item.surface, de: item.decoration, f: item.finish, bl: item.blemishes, mu: item.mutations, view,
  };
  return JSON.stringify(v);
}

export function renderItem(item: Item, view: View = 'front'): PixelImage {
  const key = visualKey(item, view);
  const hit = cache.get(key);
  if (hit) return hit;
  const img = view === 'profile' ? renderProfile(item) : item.category === 'shield' ? renderShield(item, view) : renderBladed(item, view);
  if (cache.size > 300) cache.clear();
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
  const base = { round: 7, disc: 5, faceted: 8, crescent: 6, wheel: 9, ring: 8, teardrop: 9, crown: 7, fishtail: 6, gearwheel: 9 }[p] ?? 7;
  return dagger ? base - 1 : base;
}

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

// ============================================================ bladed weapons
function renderBladed(item: Item, view: View): PixelImage {
  const lay = bladeLayout(item);
  const c = new Canvas(lay.W, lay.H);
  const ctx = makeCtx(item, c, view);
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

function makeCtx(item: Item, c: Canvas, view: View): Ctx {
  const dp = designPalette(item.design.palette);
  const P = c.addPalette('P', matPalette(item.materials.primary));
  const S = c.addPalette('S', matPalette(item.materials.secondary, 'brass'));
  const G = c.addPalette('G', matPalette(item.hilt?.gripMaterial ?? item.shield?.faceMaterial ?? 'oak', 'oak'));
  const wrapHex = item.hilt?.wrap === 'wire' ? undefined : item.hilt?.wrapColor || dp.wrap;
  const W = wrapHex ? c.addPalette('W', rampFrom(wrapHex, 6, 0.7)) : S;
  const glowHex = item.finish.glowColor || (hasMat(item.materials.primary) ? mat(item.materials.primary).accent : undefined) || dp.glow;
  return {
    item, c, seed: item.seed, view, P, S, G, W,
    inlayRgb: hexToRgb(dp.inlay), accentRgb: hexToRgb(dp.accent), glowRgb: hexToRgb(glowHex),
  };
}

function drawBlade(ctx: Ctx, lay: BladeLayout) {
  const { item, c, P } = ctx;
  const b = item.blade!;
  const translucent = hasMat(item.materials.primary) && !!mat(item.materials.primary).translucent;
  const bevel = 0.3 + 0.22 * b.thickness;
  for (let y = lay.bladeTip - 2; y <= lay.bladeBase; y++) {
    const t = clamp((lay.bladeBase - y) / b.length, 0, 1);
    const row = bladeRow(item, t);
    if (row.L + row.R < 0.4) continue;
    const xl = Math.round(row.center - row.L), xr = Math.round(row.center + row.R);
    for (let x = xl; x <= xr; x++) {
      const d = x - row.center;
      if (row.notch > 0 && Math.abs(d) < row.notch) continue;
      const u = d < 0 ? (row.L > 0 ? d / Math.max(row.L, 0.5) : -1) : d / Math.max(row.R, 0.5);
      const au = Math.abs(u);
      let shade = 3.0 + 0.35 * (t - 0.5);
      if (x === xl) shade = 4.9;
      else if (x === xr) shade = 1.5;
      else if (au > 1 - bevel) shade = u < 0 ? 4.1 : 2.1;
      // fullers & ridges
      const fullerOn = t > 0.03 && t < 0.64;
      if (fullerOn && x !== xl && x !== xr) {
        const hw = (row.L + row.R) / 2;
        if (b.fuller === 'single' && hw >= 2.5) {
          if (Math.round(d) === 0) shade = 1.7;
          else if (Math.round(d) === 1 && hw >= 3.5) shade = 3.9;
        } else if (b.fuller === 'double' && hw >= 3.5) {
          const off = Math.round(hw * 0.38);
          if (Math.round(Math.abs(d)) === off) shade = 1.8;
        } else if (b.fuller === 'ridge') {
          if (Math.round(d) === 0) shade = 4.6;
          else if (au < 1 - bevel) shade = u < 0 ? 3.5 : 2.5;
        }
      }
      let alpha = 1;
      if (translucent && au < 1 - bevel && x !== xl && x !== xr) alpha = 0.8;
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

function drawSurfaceTexture(ctx: Ctx) {
  const { item, c, seed } = ctx;
  const tex = item.surface.texture;
  const clarity = item.surface.patternClarity;
  const layers = Math.max(4, item.surface.layers);
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const i = c.idx(x, y);
      const L = c.layer[i];
      if (!METAL_LAYERS.has(L) && !(L === L_FACE && !isWood(item.shield?.faceMaterial))) continue;
      const strength = L === L_BLADE || L === L_FACE ? 1 : 0.45;
      const t = c.bt[i] >= 0 ? c.bt[i] : y / c.h;
      const q = zoneQuality(item, t);
      let s = c.shade[i];
      // Uneven polishing shows as mottling in poorly finished zones.
      s += (valueNoise(seed + 11, x / 2.5, y / 2.5) - 0.5) * (1 - q) * 1.4 * strength;
      switch (tex) {
        case 'smooth':
          break;
        case 'brushed':
          s += (noise2(seed, x, Math.floor(y / (4 + q * 6))) - 0.5) * 0.9 * strength;
          break;
        case 'hammered': {
          const cell = 3;
          const cx0 = Math.floor(x / cell), cy0 = Math.floor(y / cell);
          const h = noise2(seed + 3, cx0, cy0);
          if (h > 0.45) {
            const lx = x - cx0 * cell, ly = y - cy0 * cell;
            if (lx === 0 && ly === 0) s += 0.9 * strength;
            if (lx === 2 && ly === 2) s -= 0.9 * strength;
          }
          break;
        }
        case 'weathered': {
          const n = valueNoise(seed + 5, x / 4, y / 4);
          if (n > 0.55) {
            s -= (n - 0.55) * 3.2 * strength;
            c.addTint(i, [70, 96, 80], (n - 0.55) * 0.9 * strength);
          }
          if (noise2(seed + 6, x, y) > 0.93) s -= 1;
          break;
        }
        case 'reflective':
          s = 3 + (s - 3) * 1.5;
          if (((y + x * 1.6) % 38 + 38) % 38 < 3) s = 5;
          break;
        case 'layered': {
          const noise = (valueNoise(seed + 9, x / 3, y / 3) - 0.5) * (1 - clarity) * 4;
          const f = Math.sin(y * (0.2 + layers * 0.012) + 2.2 * Math.sin(x * 0.7 + y * 0.05) + noise);
          if (f > 0.25 && L === L_BLADE) c.pal[i] = ctx.S;
          if (f > 0.25 && f < 0.45) s -= 0.6;
          break;
        }
        case 'iridescent': {
          const hue = (x * 0.045 + y * 0.018 + valueNoise(seed, x / 6, y / 6) * 0.3) % 1;
          c.addTint(i, hslToRgb(hue, 0.7, 0.62), 0.32 * strength);
          break;
        }
        case 'rippled':
          s += 0.7 * Math.sin(y * 0.8 + Math.sin(x * 0.5) * 2) * strength;
          break;
        case 'stonefleck': {
          const n = noise2(seed + 2, x, y);
          if (n > 0.84) s -= 1.3 * strength; else if (n > 0.95) s += 1.2;
          break;
        }
        case 'forgescale': {
          const n = valueNoise(seed + 21, x / 3, y / 5);
          if (n > 0.6) { s -= (n - 0.5) * 3 * strength; c.addTint(i, [30, 26, 24], 0.4 * strength); }
          break;
        }
        case 'flamebloom': {
          const n = valueNoise(seed + 31, x / 5, y / 7);
          const col: RGB = n < 0.4 ? [224, 112, 144] : n < 0.65 ? [128, 96, 192] : [230, 180, 90];
          c.addTint(i, col, 0.36 * strength);
          break;
        }
        case 'riverwave':
          s += Math.sin(y * 0.35 + x * 0.5 + valueNoise(seed, x / 5, y / 5) * 4) * 0.7 * strength;
          c.addTint(i, [90, 130, 200], 0.12 * strength);
          break;
        case 'tidal': {
          const d = Math.hypot(x - c.w / 2, (y - c.h) * 0.6);
          s += Math.sin(d * 0.9) * 0.6 * strength;
          break;
        }
        case 'emberscale': {
          const ry = Math.floor(y / 3);
          const rx = Math.floor((x + (ry % 2) * 1.5) / 3);
          const lx = (x + (ry % 2) * 1.5) - rx * 3, ly = y - ry * 3;
          if (ly === 2 || lx < 0.5) s -= 0.9 * strength;
          else if (noise2(seed, rx, ry) > 0.7) c.addTint(i, [255, 120, 50], 0.35 * strength);
          break;
        }
        case 'nebula': {
          const n = valueNoise(seed + 41, x / 6, y / 8);
          c.addTint(i, n > 0.5 ? [180, 100, 220] : [80, 90, 220], Math.abs(n - 0.5) * 0.9 * strength);
          if (noise2(seed + 42, x, y) > 0.97) s = 5;
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
  const { item, c, seed } = ctx;
  const f = item.materials.fusedWith;
  if (!f || !hasMat(f)) return;
  const F = c.addPalette('F', mat(f).palette);
  const amount = item.surface.fusion || 0.5;
  for (let i = 0; i < c.layer.length; i++) {
    if (c.layer[i] !== L_BLADE && c.layer[i] !== L_FACE && c.layer[i] !== L_BOSS) continue;
    const x = i % c.w, y = Math.floor(i / c.w);
    const n = valueNoise(seed + 77, x / 5 + Math.sin(y / 9) * 2, y / 7);
    if (n < amount * 0.75) c.pal[i] = F;
  }
}

// ------------------------------------------------------------ guard
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
  const { item, c, S } = ctx;
  const h = item.hilt!;
  let gw = h.guardWidth;
  if (h.guard === 'disc') gw *= 0.6; if (h.guard === 'knot') gw *= 0.75; if (h.guard === 'stub') gw = Math.max(3, gw * 0.42);
  const cx = lay.cx + h.guardOffset;
  const cy = lay.guardTop + lay.guardH / 2;
  for (let x = Math.floor(cx - gw); x <= Math.ceil(cx + gw); x++) {
    const xn = (x - cx) / gw;
    if (Math.abs(xn) > 1) continue;
    const { off, th } = guardShape(h.guard, xn, lay.guardH);
    const yc = cy + off + h.guardTilt * xn;
    const y0 = Math.round(yc - th / 2), y1 = Math.round(yc + th / 2) - 1;
    for (let y = y0; y <= Math.max(y0, y1); y++) {
      let s = 3;
      if (y === y0) s = 4.7; else if (y === y1) s = 1.6;
      s += -xn * 0.5;
      c.put(x, y, L_GUARD, S, s);
    }
  }
  if (h.guard === 'ring') {
    const rx = cx + gw * 0.45, ry = cy + 4, r = 3.6;
    for (let y = Math.floor(ry - r); y <= ry + r; y++)
      for (let x = Math.floor(rx - r); x <= rx + r; x++) {
        const d = Math.hypot(x - rx, y - ry);
        if (d <= r && d >= r - 1.3) c.put(x, y, L_GUARD, S, 3 - (y - ry) * 0.4);
      }
  }
  if (h.guard === 'basket') {
    for (let k = 0; k < 3; k++) {
      const x0 = cx - gw * (0.9 - k * 0.25);
      for (let i = 0; i <= 14; i++) {
        const tt = i / 14;
        const x = x0 + Math.sin(tt * Math.PI) * -2 + tt * (gw * (0.9 - k * 0.25) - 3);
        const y = cy + tt * (h.gripLength + 1);
        c.put(x, y, L_GUARD, S, 3.4 - k * 0.5);
      }
    }
  }
}

// ------------------------------------------------------------ grip & wrap
function drawGrip(ctx: Ctx, lay: BladeLayout) {
  const { item, c, G, W, seed } = ctx;
  const h = item.hilt!;
  const half = item.category === 'dagger' ? 2 : 2;
  const gm = h.gripMaterial;
  const kind = hasMat(gm) ? mat(gm).kind : 'wood';
  for (let y = lay.gripTop; y < lay.gripBottom; y++) {
    const k = (y - lay.gripTop) / Math.max(1, lay.gripBottom - lay.gripTop);
    const bulge = Math.sin(k * Math.PI) * 0.6;
    const cx = lay.cx + h.guardOffset * (1 - k) + h.pommelOffset * k;
    for (let x = Math.round(cx - half - bulge); x <= Math.round(cx + half + bulge); x++) {
      const dx = x - cx;
      const across = dx / (half + bulge + 0.01);
      let s = 3 - across * 1.1;
      // grip material texture
      if (kind === 'wood') s += (valueNoise(seed + 50, x * 1.7, y / 4) - 0.5) * 1.1;
      if (kind === 'bone' && (y - lay.gripTop) % 5 === 0) s -= 1.1;
      if (gm === 'antler') s += (noise2(seed + 51, x, y) > 0.8 ? 0.9 : 0) - (noise2(seed + 52, x, y) > 0.9 ? 1 : 0);
      if (kind === 'leather' && (y - lay.gripTop) % 6 === 3 && Math.round(dx) === 0) s -= 0.8;
      let layer = L_GRIP, pal = G;
      const yy = y - lay.gripTop, xx = x - Math.round(cx) + 8;
      let wrapped = false;
      switch (h.wrap) {
        case 'spiral': wrapped = ((yy + xx) % 4 + 4) % 4 < 2; break;
        case 'crosshatch': wrapped = ((yy + xx) % 4 === 0) || (((yy - xx) % 4 + 4) % 4 === 0); break;
        case 'bands': wrapped = yy % 5 < 2; break;
        case 'braided': wrapped = ((yy + Math.abs(Math.round(dx))) % 4) < 2; break;
        case 'wire': wrapped = ((yy + xx) % 2) === 0; break;
      }
      if (wrapped) {
        layer = L_WRAP;
        pal = h.wrap === 'wire' ? ctx.S : W;
        s = 3.3 - across * 1.2 + (((yy + xx) % 4) === 0 ? 0.6 : 0);
      }
      c.put(x, y, layer, pal, s);
    }
  }
}

// ------------------------------------------------------------ pommel
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
    case 'gearwheel': {
      const a = Math.atan2(dy, dx);
      const rr = r + (Math.cos(a * 8) > 0.3 ? 1.1 : 0);
      return d <= rr && d >= 1.1;
    }
    default: return d <= r;
  }
}

function drawPommel(ctx: Ctx, lay: BladeLayout) {
  const { item, c, S } = ctx;
  const h = item.hilt!;
  const r = lay.pommelH / 2;
  const cx = lay.cx + h.pommelOffset, cy = lay.pommelCy;
  for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++)
    for (let x = Math.floor(cx - r - 3); x <= cx + r + 3; x++) {
      const dx = x - cx, dy = y - cy;
      if (!pommelInside(h.pommel, dx, dy, r)) continue;
      const d = Math.hypot(dx, dy) / Math.max(1, r);
      let s = 3 + (-dx * 0.55 - dy * 0.8) / Math.max(1, r) * 1.6 - d * 0.3;
      if (Math.round(dx) === -1 && Math.round(dy) === -1) s = 5;
      if (h.pommel === 'wheel' && Math.hypot(dx, dy) < 1.4) s = 1.2;
      if (h.pommel === 'faceted') s += ((dx > 0 ? 1 : 0) + (dy > 0 ? 1 : 0)) * -0.6;
      c.put(x, y, L_POMMEL, S, s);
    }
}

// ------------------------------------------------------------ decoration
function bladePoint(item: Item, lay: BladeLayout, t: number, u: number): [number, number] {
  const row = bladeRow(item, t);
  const w = u < 0 ? row.L : row.R;
  return [row.center + u * w * 0.78, lay.bladeBase - t * item.blade!.length];
}

function line(x0: number, y0: number, x1: number, y1: number, f: (x: number, y: number) => void) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let n = 0; n < 400; n++) {
    f(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function engravePixel(ctx: Ctx, x: number, y: number, inlay: boolean, strength: number) {
  const { c } = ctx;
  if (!c.is(x, y, L_BLADE)) return;
  const i = c.idx(x, y);
  if (Math.abs(c.bu[i]) > 0.94) return; // never cut the edge itself
  c.layer[i] = L_ENGRAVE;
  c.shade[i] = 1.25 + (1 - strength) * 1.2;
  if (inlay) c.addTint(i, ctx.inlayRgb, 0.6 * strength);
}

function drawEngraving(ctx: Ctx, lay: BladeLayout) {
  const { item } = ctx;
  const e = item.decoration.engraving;
  if (!e || e.pattern === 'none') return;
  const paths = engravingPaths(e.pattern, item.seed);
  const strength = 0.45 + 0.55 * e.crispness;
  const slips = new Set(e.slips);
  let s = 0;
  const r = seededRng(item.seed, 'engrave-stray');
  for (const p of paths) {
    for (let k = 0; k < p.length; k++, s++) {
      const j = e.jitter.length ? e.jitter[s % e.jitter.length] : 0;
      const [t, u] = p[k];
      const [x, y] = bladePoint(item, lay, t, clamp(u + j * 0.28, -1, 1));
      if (k > 0 && !slips.has(s)) {
        const jp = e.jitter.length ? e.jitter[(s - 1) % e.jitter.length] : 0;
        const [tp, up] = p[k - 1];
        const [xp, yp] = bladePoint(item, lay, tp, clamp(up + jp * 0.28, -1, 1));
        line(xp, yp, x, y, (px, py) => engravePixel(ctx, px, py, e.inlay, strength));
      } else engravePixel(ctx, x, y, e.inlay, strength);
    }
  }
  // Handmade imperfection: stray graver marks.
  const strays = Math.round((1 - e.crispness) * 9);
  for (let i = 0; i < strays; i++) {
    const [x, y] = bladePoint(item, lay, r.range(0.08, 0.6), r.range(-0.7, 0.7));
    engravePixel(ctx, x, y, false, 0.4);
    if (r.chance(0.5)) engravePixel(ctx, x + 1, y + 1, false, 0.3);
  }
}

function drawInscription(ctx: Ctx, lay: BladeLayout, startT: number) {
  const { item, c } = ctx;
  const text = (item.decoration.inscription || '').replace(/\s+/g, ' ').trim();
  if (!text) return;
  const b = item.blade!;
  let y = Math.round(lay.bladeBase - startT * b.length);
  for (const ch of text) {
    if (y < lay.bladeTip + b.length * 0.18) break;
    if (ch === ' ') { y -= 3; continue; }
    const g = glyphFor(ch);
    const t = (lay.bladeBase - y) / b.length;
    const row = bladeRow(item, clamp(t));
    const cx = Math.round(row.center);
    for (let gy = 0; gy < 5; gy++)
      for (let gx = 0; gx < 3; gx++)
        if (g[gy][gx] === '#') engravePixel(ctx, cx - 1 + gx, y - 4 + gy, true, 0.8);
    y -= 6;
  }
  void c;
}

function drawEmblem(ctx: Ctx, lay: BladeLayout) {
  const { item, c } = ctx;
  const e = item.decoration.emblem;
  const bm = EMBLEM_BITMAPS[e];
  if (!bm) return;
  const b = item.blade!;
  const t = 0.04;
  const row = bladeRow(item, t);
  const wide = row.L + row.R >= 8;
  // Wide blades carry it on the ricasso; narrow blades carry it on the pommel side of the guard.
  const cx = Math.round(row.center);
  const top = wide ? Math.round(lay.bladeBase - 10) : Math.round(lay.guardTop - 1);
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      if (bm[y][x] !== '#') continue;
      const px = cx - 3 + x, py = top + y - (wide ? 0 : 0);
      if (wide) {
        if (!c.is(px, py, L_BLADE, L_ENGRAVE)) continue;
        const i = c.idx(px, py);
        c.layer[i] = L_EMBLEM; c.shade[i] = 1.6; c.addTint(i, ctx.inlayRgb, 0.75);
      } else if (c.is(px, py, L_GUARD) && (x + y) % 2 === 0) {
        const i = c.idx(px, py);
        c.addTint(i, ctx.inlayRgb, 0.6);
      }
    }
  void b;
}

function drawStones(ctx: Ctx, lay: BladeLayout) {
  const { item, c } = ctx;
  for (const st of item.decoration.stones) {
    const sp = c.addPalette('stone:' + st.stone, matPalette(st.stone, 'riverstone'));
    const [x, y] = bladePoint(item, lay, st.t, st.u);
    const skew = Math.round(st.rot * 2);
    const shape = [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1], [skew, -1], [-skew, 1]];
    for (const [dx, dy] of shape) {
      const px = Math.round(x + dx), py = Math.round(y + dy);
      if (!c.is(px, py)) continue;
      c.put(px, py, L_STONE, sp, 3 - dy * 0.9 - dx * 0.4);
    }
  }
}

function drawConstellation(ctx: Ctx, lay: BladeLayout) {
  const { item, c } = ctx;
  const con = item.decoration.constellation;
  if (!con) return;
  const pts = con.points.map(([t, u]) => bladePoint(item, lay, t, u));
  for (let i = 1; i < pts.length; i++) {
    line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], (x, y) => {
      if (!c.is(x, y, L_BLADE, L_ENGRAVE)) return;
      c.addTint(c.idx(x, y), ctx.glowRgb, 0.35 * con.brightness);
    });
  }
  for (const [x, y] of pts) {
    if (!c.is(Math.round(x), Math.round(y))) continue;
    const i = c.idx(Math.round(x), Math.round(y));
    c.shade[i] = 5; c.addTint(i, [255, 255, 255], 0.5 + 0.5 * con.brightness);
  }
}

function gemPalette(c: Canvas, gem: string) {
  return c.addPalette('gem:' + gem, matPalette(gem, 'quartz'));
}

function drawGem(ctx: Ctx, gx: number, gy: number, gem: string, big = false) {
  const { c, S } = ctx;
  const gp = gemPalette(c, gem);
  gx = Math.round(gx); gy = Math.round(gy);
  const pattern = big
    ? [[-1, -2, 4], [0, -2, 4], [-2, -1, 4], [-1, -1, 5], [0, -1, 3], [1, -1, 3], [-2, 0, 3], [-1, 0, 3], [0, 0, 2], [1, 0, 2], [-1, 1, 2], [0, 1, 1]]
    : [[0, -1, 4], [-1, 0, 4], [0, 0, 3], [1, 0, 2], [0, 1, 1]];
  // setting ring
  for (const [dx, dy] of big ? [[-2, -2], [1, -2], [-3, 0], [2, 0], [-2, 2], [1, 2]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    c.put(gx + dx, gy + dy, L_GUARD, S, 3.6);
  for (const [dx, dy, s] of pattern) c.put(gx + dx, gy + dy, L_GEM, gp, s);
  c.put(gx + (big ? -1 : 0), gy - (big ? 1 : 1), L_GEM, gp, 5);
}

function drawGems(ctx: Ctx, lay: BladeLayout) {
  const { item } = ctx;
  const h = item.hilt!;
  for (const g of item.decoration.gems) {
    if (g.slot === 'guard') drawGem(ctx, lay.cx + h.guardOffset, lay.guardTop + lay.guardH / 2, g.gem);
    else if (g.slot === 'pommel') drawGem(ctx, lay.cx + h.pommelOffset, lay.pommelCy, g.gem);
    else if (g.slot === 'blade') {
      const row = bladeRow(item, 0.13);
      drawGem(ctx, row.center, lay.bladeBase - 0.13 * item.blade!.length, g.gem);
    }
  }
}

function drawMutationsShade(ctx: Ctx) {
  const { item, c, seed } = ctx;
  for (const m of item.mutations) {
    for (let i = 0; i < c.layer.length; i++) {
      const L = c.layer[i];
      if (L !== L_BLADE && L !== L_FACE && L !== L_ENGRAVE) continue;
      const x = i % c.w, y = Math.floor(i / c.w);
      if (m === 'colorband' && Math.floor(y / 7 + noise2(seed, 0, Math.floor(y / 7)) * 2) % 5 === 0) c.addTint(i, hslToRgb(noise2(seed, 1, Math.floor(y / 35)), 0.6, 0.55), 0.45);
      if (m === 'speckle' && noise2(seed + 99, x, y) > 0.9) c.shade[i] = noise2(seed, x, y) > 0.95 ? 5 : 0.8;
      if (m === 'ghostedge' && Math.abs(c.bu[i]) > 0.7) c.alpha[i] = 0.55;
      if (m === 'veins' && Math.abs(Math.sin(x * 0.9 + valueNoise(seed + 5, x / 4, y / 4) * 6)) < 0.12) c.addTint(i, ctx.accentRgb, 0.6);
      if (m === 'inverted' && L === L_BLADE) c.shade[i] = 5 - c.shade[i];
    }
  }
}

function drawFinishShade(ctx: Ctx) {
  const { item, c, seed } = ctx;
  const f = item.finish.finish;
  for (let i = 0; i < c.layer.length; i++) {
    const L = c.layer[i];
    if (!METAL_LAYERS.has(L) && L !== L_ENGRAVE && L !== L_FACE) continue;
    const x = i % c.w, y = Math.floor(i / c.w);
    if (f === 'etched' && L === L_BLADE && Math.abs(c.bu[i]) < 0.7 && ((x + y) % 4 === 0 || ((x - y) % 4 + 4) % 4 === 0)) c.shade[i] -= 0.7;
    if (f === 'contrast' && L === L_BLADE && Math.abs(c.bu[i]) > 0.62) c.pal[i] = ctx.S;
    if (f === 'heirloom' && L === L_BLADE && Math.abs(c.bu[i]) > 0.8) c.shade[i] += 0.6;
    if (f === 'mirror' && (L === L_BLADE || L === L_FACE)) { c.shade[i] = 3 + (c.shade[i] - 3) * 1.6; if (((y * 0.6 + x) % 22) < 3) c.shade[i] = 5; }
    if (f === 'polished' && noise2(seed + 61, x, y) > 0.965) c.shade[i] = 5.2;
    if (f === 'glossy' && noise2(seed + 62, x, y) > 0.985) c.shade[i] = 5.3;
  }
}

function drawBlemishes(ctx: Ctx, lay: BladeLayout | null) {
  const { item, c } = ctx;
  for (const bl of item.blemishes) {
    let x: number, y: number;
    if (lay && item.blade) [x, y] = bladePoint(item, lay, bl.t, bl.u);
    else { x = c.w / 2 + bl.u * c.w * 0.32; y = c.h * (0.15 + bl.t * 0.7); }
    x = Math.round(x); y = Math.round(y);
    const mark = (px: number, py: number, s: number) => {
      if (!c.is(px, py, L_BLADE, L_FACE, L_RIM, L_BOSS, L_ENGRAVE)) return;
      c.shade[c.idx(px, py)] = s;
    };
    if (bl.kind === 'pit') { mark(x, y, 0.4); mark(x, y + 1, 4.4); }
    else if (bl.kind === 'scratch') { mark(x, y, 4.8); mark(x + 1, y - 1, 4.6); mark(x + 2, y - 2, 4.2); }
    else { mark(x, y, 0.8); mark(x + 1, y, 1.2); const i = c.idx(x, y); if (c.in(x, y)) c.addTint(i, [60, 40, 30], 0.5); }
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

export function shieldLayout(item: Item) {
  const [W, H] = CATEGORY_INFO.shield.size;
  const s = item.shield!;
  let w = s.width, h = s.height;
  if (s.shape === 'buckler') { w *= 0.62; h = w; }
  if (s.shape === 'round') h = w;
  return { W, H, cx: W / 2 - 0.5, cy: H / 2 - 1, rx: w / 2, ry: h / 2 };
}

function renderShield(item: Item, view: View): PixelImage {
  const sh = item.shield!;
  const { W, H, cx, cy, rx, ry } = shieldLayout(item);
  const c = new Canvas(W, H);
  const ctx = makeCtx(item, c, view);
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
        const lx = x - (cx - rx) - p * plankW;
        if (lx < 1) s = 1.3;
        s += (valueNoise(ctx.seed + p * 13, x * 1.4, y / 5) - 0.5) * 1.2;
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
  const rimDx = Math.round(sh.rimGap);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const sx = x - rimDx;
      if (!inside(sx, y)) continue;
      let edge = false;
      for (let k = 1; k <= sh.rim && !edge; k++)
        if (!inside(sx + k, y) || !inside(sx - k, y) || !inside(sx, y + k) || !inside(sx, y - k)) edge = true;
      if (!edge) continue;
      const nx = (sx - cx) / rx, ny = (y - cy) / ry;
      c.put(x, y, L_RIM, ctx.S, 3.2 - nx * 1.1 - ny * 0.9);
    }
  // rivets
  const rivets = 12;
  for (let k = 0; k < rivets; k++) {
    const a = (k / rivets) * Math.PI * 2;
    let rr = 1;
    for (let it = 0; it < 30; it++) { if (!inside(cx + Math.cos(a) * rx * rr, cy + Math.sin(a) * ry * rr)) rr -= 0.02; else break; }
    const px = Math.round(cx + Math.cos(a) * (rx * rr - sh.rim / 2) + rimDx), py = Math.round(cy + Math.sin(a) * (ry * rr - sh.rim / 2));
    if (c.is(px, py, L_RIM)) { c.shade[c.idx(px, py)] = 5; }
  }
  drawSurfaceTexture(ctx);
  drawFusion(ctx);
  // emblem
  const bm = EMBLEM_BITMAPS[item.decoration.emblem];
  if (bm) {
    const scale = sh.boss === 'none' ? 4 : 2;
    const ex = Math.round(cx - 3.5 * scale), ey = Math.round((sh.boss === 'none' ? cy : cy - ry * 0.52) - 3.5 * scale);
    for (let y = 0; y < 7 * scale; y++)
      for (let x = 0; x < 7 * scale; x++) {
        if (bm[Math.floor(y / scale)][Math.floor(x / scale)] !== '#') continue;
        const px = ex + x, py = ey + y;
        if (!c.is(px, py, L_FACE)) continue;
        const i = c.idx(px, py);
        c.layer[i] = L_EMBLEM;
        c.addTint(i, ctx.accentRgb, 0.85);
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
    for (const p of paths)
      for (let k = 0; k < p.length; k++, s++) {
        const j = e.jitter.length ? e.jitter[s % e.jitter.length] : 0;
        const [x, y] = toXY(p[k][0], p[k][1], j);
        const mark = (px: number, py: number) => {
          if (!c.is(px, py, L_FACE, L_EMBLEM)) return;
          const i = c.idx(px, py);
          c.shade[i] = 1.2 + (1 - e.crispness);
          if (e.inlay) c.addTint(i, ctx.inlayRgb, 0.8);
        };
        if (k > 0 && !slips.has(s)) {
          const jp = e.jitter.length ? e.jitter[(s - 1) % e.jitter.length] : 0;
          const [xp, yp] = toXY(p[k - 1][0], p[k - 1][1], jp);
          line(xp, yp, x, y, mark);
        } else mark(Math.round(x), Math.round(y));
      }
  }
  // boss
  if (sh.boss !== 'none') {
    const br = sh.boss === 'flat' ? 6 : 7.5;
    const BP = ctx.S;
    for (let y = Math.floor(cy - br); y <= cy + br; y++)
      for (let x = Math.floor(cx - br); x <= cx + br; x++) {
        const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
        if (d > br) continue;
        let s = sh.boss === 'flat' ? 3 - dx * 0.08 - dy * 0.1 : 3 + (-dx * 0.6 - dy * 0.8) / br * 2;
        if (d > br - 1) s = 1.6;
        if (sh.boss === 'spike' && d < 2.2) s = d < 1 ? 5 : 4;
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
    const x = Math.round(cx + Math.cos(a) * rx * 0.5), y = Math.round(cy + Math.sin(a) * ry * 0.5);
    for (const [dx, dy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1], [Math.round(st.rot * 2), -1]]) c.put(x + dx, y + dy, L_STONE, sp, 3 - dy);
  }
  if (item.decoration.constellation) {
    const con = item.decoration.constellation;
    const pts = con.points.map(([t, u]) => [cx + u * rx * 0.7, cy - ry * 0.7 + t * ry * 1.4] as [number, number]);
    for (let i = 1; i < pts.length; i++) line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], (x, y) => { if (c.is(x, y)) c.addTint(c.idx(x, y), ctx.glowRgb, 0.35 * con.brightness); });
    for (const [x, y] of pts) if (c.is(Math.round(x), Math.round(y))) { const i = c.idx(Math.round(x), Math.round(y)); c.shade[i] = 5; c.addTint(i, [255, 255, 255], 0.6); }
  }
  drawMutationsShade(ctx);
  drawFinishShade(ctx);
  drawBlemishes(ctx, null);
  const img = compose(ctx);
  return view === 'back' ? renderShieldBack(item, img) : img;
}

function renderShieldBack(item: Item, front: PixelImage): PixelImage {
  // The back shows the wooden backing, the grip strap and the rim — plus any inscription.
  const out = front.mirrored();
  const { cx, cy, rx } = shieldLayout(item);
  const grip = hexToRgb(item.hilt?.wrapColor || designPalette(item.design.palette).wrap);
  for (let y = 0; y < out.h; y++)
    for (let x = 0; x < out.w; x++) {
      const i = (y * out.w + x) * 4;
      if (out.data[i + 3] === 0) continue;
      const r = out.data[i], g = out.data[i + 1], b = out.data[i + 2];
      const dark = 0.55;
      out.data[i] = r * dark; out.data[i + 1] = g * dark; out.data[i + 2] = b * dark;
      if (Math.abs(y - cy) <= 2 && Math.abs(x - cx) < rx * 0.55) {
        const s = Math.abs(y - cy) === 2 ? 0.6 : 1;
        out.data[i] = grip[0] * s; out.data[i + 1] = grip[1] * s; out.data[i + 2] = grip[2] * s;
      }
    }
  return out;
}

// ============================================================ profile (edge-on)
function renderProfile(item: Item): PixelImage {
  const [W, H] = CATEGORY_INFO[item.category].size;
  const c = new Canvas(W, H);
  const ctx = makeCtx(item, c, 'profile');
  if (item.category === 'shield') {
    const { cx, cy, ry } = shieldLayout(item);
    const sh = item.shield!;
    const depth = sh.boss === 'none' ? 0 : sh.boss === 'spike' ? 10 : 6;
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      const ny = (y - cy) / ry;
      const bow = (1 - ny * ny) * 4;
      for (let k = 0; k < 3; k++) c.put(cx - 2 + bow + k, y, k === 0 ? L_RIM : L_FACE, k === 0 ? ctx.S : ctx.P, 3.4 - k);
      if (Math.abs(ny) < 0.16 && depth) for (let d = 0; d < depth * (1 - Math.abs(ny) / 0.16); d++) c.put(cx - 3 + bow - d, y, L_BOSS, ctx.S, 3.5 - d * 0.2);
    }
    for (let y = Math.floor(cy - 3); y <= cy + 3; y++) c.put(cx + 3 + 4, y, L_WRAP, ctx.W, 3);
  } else {
    const lay = bladeLayout(item);
    const b = item.blade!, h = item.hilt!;
    const thick = 1 + Math.round(b.thickness * 2 + (item.structure.approach === 'reinforced' ? 1 : 0));
    for (let y = lay.bladeTip; y <= lay.bladeBase; y++) {
      const t = (lay.bladeBase - y) / b.length;
      const row = bladeRow(item, t);
      if (row.L + row.R < 0.4) continue;
      const tw = Math.max(1, Math.round(thick * (1 - t * 0.6)));
      for (let k = 0; k < tw; k++) c.put(lay.cx - Math.floor(tw / 2) + k, y, L_BLADE, ctx.P, k === 0 ? 4.6 : 2.4);
    }
    for (let y = lay.guardTop; y < lay.guardTop + lay.guardH; y++) for (let x = -2; x <= 2; x++) c.put(lay.cx + x, y, L_GUARD, ctx.S, 3 - x * 0.5);
    for (let y = lay.gripTop; y < lay.gripBottom; y++) for (let x = -2; x <= 2; x++) c.put(lay.cx + x, y, L_GRIP, ctx.G, 3 - x * 0.6);
    const pw = h.pommel === 'disc' || h.pommel === 'wheel' ? 1.5 : 3;
    for (let y = Math.floor(lay.pommelCy - lay.pommelH / 2); y <= lay.pommelCy + lay.pommelH / 2; y++)
      for (let x = -pw; x <= pw; x++) c.put(lay.cx + x, y, L_POMMEL, ctx.S, 3 - x * 0.5);
  }
  drawSurfaceTexture(ctx);
  drawFinishShade(ctx);
  return compose(ctx);
}

// ============================================================ compose
function compose(ctx: Ctx): PixelImage {
  const { c, item, seed } = ctx;
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
  // outline (coloured "selout")
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
  for (let k = 0; k < img.data.length; k += 4) if (outline.data[k + 3] > 0 && img.data[k + 3] === 0) { img.data[k] = outline.data[k]; img.data[k + 1] = outline.data[k + 1]; img.data[k + 2] = outline.data[k + 2]; img.data[k + 3] = 255; }
  if (glow) {
    const gc = f === 'smoulder' ? ([255, 110, 40] as RGB) : f === 'moonlit' ? ([200, 216, 255] as RGB) : ctx.glowRgb;
    const strength = f === 'moonlit' ? 0.5 : 0.85;
    const copy = new Uint8ClampedArray(img.data);
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) {
        const k = (y * c.w + x) * 4;
        if (copy[k + 3] > 0) continue;
        let best = 9;
        for (let dy = -3; dy <= 3; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= c.w || yy >= c.h) continue;
            if (copy[(yy * c.w + xx) * 4 + 3] > 0) best = Math.min(best, Math.hypot(dx, dy));
          }
        if (best <= 3) {
          const a = (1 - best / 3.6) * strength * (0.75 + 0.25 * noise2(seed, x, y));
          img.set(x, y, gc[0], gc[1], gc[2], Math.round(a * 150));
        }
      }
  }
  return img;
}

function applyFinishColor(f: string, rgb: RGB, x: number, y: number, seed: number, L: number, ctx: Ctx): RGB {
  const metal = METAL_LAYERS.has(L) || L === L_ENGRAVE || L === L_FACE || L === L_EMBLEM;
  if (!metal) return rgb;
  let [h, s, l] = rgbToHsl(rgb);
  switch (f) {
    case 'matte': s *= 0.82; l = 0.5 + (l - 0.5) * 0.78; break;
    case 'glossy': l = clamp(0.5 + (l - 0.5) * 1.18); s = clamp(s * 1.08); break;
    case 'aged': {
      const out = mixRgb(rgb, [106, 80, 48], 0.2);
      [h, s, l] = rgbToHsl(out); l *= 0.88;
      if (valueNoise(seed + 71, x / 3, y / 3) > 0.7) l *= 0.82;
      break;
    }
    case 'polished': l = clamp(l * 1.05); break;
    case 'glow': { const m = mixRgb(rgb, ctx.glowRgb, 0.14); [h, s, l] = rgbToHsl(m); l = clamp(l * 1.06); break; }
    case 'frosted': { const m = mixRgb(rgb, [240, 248, 255], 0.2); [h, s, l] = rgbToHsl(m); l = 0.55 + (l - 0.55) * 0.7; if (noise2(seed + 3, x, y) > 0.93) l = 0.92; break; }
    case 'rosegold': { const m = mixRgb(rgb, [232, 150, 140], 0.26); [h, s, l] = rgbToHsl(m); break; }
    case 'verdigris': if (l < 0.42 || valueNoise(seed + 8, x / 3, y / 3) > 0.68) { const m = mixRgb(rgb, [74, 168, 136], 0.5); [h, s, l] = rgbToHsl(m); } break;
    case 'heirloom': { const m = mixRgb(rgb, [200, 160, 100], 0.12); [h, s, l] = rgbToHsl(m); l = 0.5 + (l - 0.5) * 0.85; break; }
    case 'mirror': { if (l > 0.6) { const m = mixRgb(rgb, [190, 220, 255], 0.25); [h, s, l] = rgbToHsl(m); } break; }
    case 'deepblue': { const m = mixRgb(rgb, [40, 60, 150], 0.32); [h, s, l] = rgbToHsl(m); break; }
    case 'moonlit': { const m = mixRgb(rgb, [200, 216, 255], 0.16); [h, s, l] = rgbToHsl(m); break; }
    case 'smoulder': { l *= 0.82; if (valueNoise(seed + 13, x / 2, y / 2) > 0.74) { const m = mixRgb(hslToRgb(h, s, l), [255, 110, 40], 0.6); return m; } break; }
    case 'prism': { const m = mixRgb(rgb, hslToRgb((x * 0.07 + y * 0.01) % 1, 0.8, 0.6), 0.3); return m; }
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

/** Sprite-pixel position of a blemish (front view), shared with the inspection minigame. */
export function blemishPixel(item: Item, t: number, u: number): [number, number] {
  if (item.blade) {
    const lay = bladeLayout(item);
    return bladePoint(item, lay, t, u).map(Math.round) as [number, number];
  }
  const [W, H] = CATEGORY_INFO[item.category].size;
  return [Math.round(W / 2 + u * W * 0.32), Math.round(H * (0.15 + t * 0.7))];
}

/** Sprite-pixel position of a blade-local (t,u) coordinate. */
export function bladePixel(item: Item, t: number, u: number): [number, number] {
  return bladePoint(item, bladeLayout(item), t, u);
}
