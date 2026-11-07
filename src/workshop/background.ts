// Builds the cached static layer of the workshop: walls, floor, ceiling,
// furniture, stations, extras and the display rack. Everything that animates
// is drawn per-frame by scene.ts on top of this.

import { hashString, noise2, valueNoise } from '../core/rng';
import { clamp, hexToRgb, mixHex, RGB, shadeHex } from '../core/util';
import type { Item } from '../item/types';
import { renderItem, visualKey } from '../render/itemRenderer';
import type { PixelImage } from '../render/pixel';
import {
  ANVIL_BASE_Y, BASE, CEIL, DRAGON_FANGS, FLOOR_Y, forgeMouth, H, Mouth, Rect, StationDef, stationDefs, StationId, W, windowGeo, WinGeo,
} from './layout';
import { bevel, BRASS, C2D, COPPER, disc, ellipse, H as HL, IRON, L, makeCanvas, P, R, rgba, V, WOOD } from './px';

export interface BgInput {
  decor: { wall: string; floor: string; lighting: string; window: string; forge: string; shelves: string };
  extras: Set<string>;
  upgrades: Set<string>;
  displayItems: Item[];
  season: string;
  materialCount: number;
  bannerColor: string;
}

export type LampKind = 'candle' | 'lantern' | 'chandelier' | 'jar' | 'crystal';
export interface Lamp { kind: LampKind; x: number; y: number }

export interface Outline { c: HTMLCanvasElement; x: number; y: number }

export interface BgResult {
  bg: HTMLCanvasElement;
  /** Anvil + stump + quench tub; depth-sorted against the player. */
  front: HTMLCanvasElement;
  outlines: Map<StationId, Outline>;
  stations: StationDef[];
  win: WinGeo;
  mouth: Mouth;
  lamps: Lamp[];
  journalCandle: { x: number; y: number };
  wheel?: { x: number; y: number; r: number };
  clock?: { x: number; y: number };
  chimes?: { x: number; y: number };
  glassbloom?: { x: number; y: number }[];
  cat?: { x: number; y: number };
  doorPane: Rect;
  dragonEyes?: { x: number; y: number }[];
}

const SEED = 4242;

// ============================================================ pixel-buffer textures
function putRGB(d: Uint8ClampedArray, x: number, y: number, c: RGB, f = 1) {
  const i = (y * W + x) * 4;
  d[i] = c[0] * f; d[i + 1] = c[1] * f; d[i + 2] = c[2] * f; d[i + 3] = 255;
}
const rgbs = (a: string[]) => a.map(hexToRgb);

function wallFn(style: string): (x: number, y: number) => [RGB, number] {
  const s = SEED + hashString(style);
  if (style === 'stone') {
    const pal = rgbs(['#8a8270', '#9a8e72', '#7a7466', '#a39674', '#8c8062', '#968a6e', '#7e7862']);
    const mortar = hexToRgb('#4c443a');
    type Row = { y0: number; h: number; xs: number[]; ws: number[]; ci: number[] };
    const rows: Row[] = [];
    let y = CEIL, ri = 0;
    while (y < FLOOR_Y) {
      const h = 7 + Math.floor(noise2(s, ri, 1) * 5);
      const row: Row = { y0: y, h, xs: [], ws: [], ci: [] };
      let x = -Math.floor(noise2(s, ri, 2) * 10);
      let k = 0;
      while (x < W) {
        const w = 9 + Math.floor(noise2(s, ri * 50 + k, 3) * 10);
        row.xs.push(x); row.ws.push(w); row.ci.push(Math.floor(noise2(s, ri * 50 + k, 4) * pal.length));
        x += w; k++;
      }
      rows.push(row); y += h; ri++;
    }
    const rowOf = new Int16Array(H);
    rows.forEach((r, i) => { for (let yy = r.y0; yy < r.y0 + r.h && yy < H; yy++) rowOf[yy] = i; });
    return (x, y) => {
      const r = rows[rowOf[y]];
      let k = 0;
      while (k < r.xs.length - 1 && x >= r.xs[k + 1]) k++;
      const lx = x - r.xs[k], ly = y - r.y0, w = r.ws[k], h = r.h;
      const corner = (lx <= 1 || lx >= w - 1) && (ly <= 1 || ly >= h - 1);
      if (lx === 0 || ly === 0 || corner) return [mortar, 0.85 + noise2(s, x, y) * 0.25];
      let f = 0.88 + valueNoise(s + k, x * 0.4, y * 0.4) * 0.18 + noise2(s, x, y) * 0.08;
      if (ly === 1 || lx === 1) f *= 1.12;
      if (ly === h - 1 || lx === w - 1) f *= 0.78;
      return [pal[r.ci[k]], f];
    };
  }
  if (style === 'brick') {
    const pal = rgbs(['#8e3b2c', '#9c4632', '#a8523a', '#7e3428', '#b05e42', '#94402e']);
    const mortar = hexToRgb('#7a6a5a');
    return (x, y) => {
      const ry = y - CEIL, r = Math.floor(ry / 5), off = r % 2 ? 5 : 0;
      const bx = Math.floor((x + off) / 10), lx = (x + off) % 10, ly = ry % 5;
      if (lx === 0 || ly === 0) return [mortar, 0.85 + noise2(s, x, y) * 0.2];
      const n = noise2(s, bx, r);
      let f = 0.9 + noise2(s, x, y) * 0.14 + valueNoise(s, x * 0.2, y * 0.2) * 0.08;
      if (n > 0.93) f *= 0.7;
      if (ly === 1) f *= 1.1;
      if (ly === 4 || lx === 9) f *= 0.82;
      return [pal[Math.floor(n * pal.length)], f];
    };
  }
  if (style === 'plaster') {
    const base = hexToRgb('#e2d2b2');
    const timber = hexToRgb('#4e3220');
    const posts = [[0, 5], [116, 121], [206, 211], [314, 320]];
    const beamY0 = CEIL + 38, beamY1 = CEIL + 43;
    const braces: [number, number, number, number][] = [[6, beamY0, 40, CEIL], [115, beamY0, 82, CEIL], [212, beamY0, 248, CEIL], [313, beamY0, 280, CEIL]];
    return (x, y) => {
      for (const [a, b] of posts) if (x >= a && x < b) return [timber, (x === a || x === b - 1 ? 0.7 : 0.95) + valueNoise(s, x * 0.6, y * 0.06) * 0.15];
      if (y >= beamY0 && y <= beamY1) return [timber, (y === beamY0 ? 1.15 : y === beamY1 ? 0.7 : 0.95) + valueNoise(s, x * 0.05, y * 0.6) * 0.15];
      if (y < beamY0)
        for (const [x0, y0, x1, y1] of braces) {
          const dx = x1 - x0, dy = y1 - y0;
          const t = ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy);
          if (t < 0 || t > 1) continue;
          const px = x0 + dx * t, py = y0 + dy * t;
          const d = Math.hypot(x - px, y - py);
          if (d < 2.6) return [timber, (d > 1.8 ? 0.72 : 0.95) + valueNoise(s, t * 30, d) * 0.12];
        }
      let f = 0.93 + valueNoise(s, x * 0.12, y * 0.12) * 0.07 + noise2(s, x, y) * 0.04;
      f *= 1 - 0.08 * clamp((y - (FLOOR_Y - 30)) / 30);
      if (y === beamY1 + 1 || y === beamY1 + 2) f *= 0.86;
      return [base, f];
    };
  }
  if (style === 'panelled') {
    const frame = hexToRgb('#4a2c1a'), field = hexToRgb('#3a2214'), rail = hexToRgb('#6a4428');
    const pw = 26;
    const up0 = CEIL + 5, up1 = CEIL + 52, rl0 = CEIL + 55, rl1 = CEIL + 60, lo0 = CEIL + 64, lo1 = FLOOR_Y - 8;
    return (x, y) => {
      const g = 0.92 + valueNoise(s, x * 0.5, y * 0.05) * 0.14;
      if (y >= rl0 && y <= rl1) return [rail, (y === rl0 ? 1.25 : y === rl1 ? 0.65 : 1) * g];
      const lx = (x - 3 + pw * 20) % pw;
      const inUp = y >= up0 && y <= up1, inLo = y >= lo0 && y <= lo1;
      if ((inUp || inLo) && lx >= 3 && lx <= pw - 2) {
        const y0 = inUp ? up0 : lo0, y1 = inUp ? up1 : lo1;
        if (lx === 3 || y === y0) return [frame, 0.55];
        if (lx === pw - 2 || y === y1) return [frame, 1.3];
        if (lx === 4 || y === y0 + 1) return [field, 0.8 * g];
        return [field, g * (1 + 0.06 * Math.sin(lx * 0.4))];
      }
      return [frame, g];
    };
  }
  if (style === 'tiles') {
    const pal = rgbs(['#3a8478', '#448e82', '#4e9a8c', '#327a6e', '#58a496']);
    const grout = hexToRgb('#cfc6ae');
    const deco = hexToRgb('#cfc29a'), decoInk = hexToRgb('#3a7a6e');
    const wood = hexToRgb('#5a3a24');
    const dado = CEIL + 62;
    return (x, y) => {
      if (y >= dado && y <= dado + 3) return [wood, y === dado ? 1.3 : y === dado + 3 ? 0.7 : 1];
      const ty = y < dado ? y - CEIL : y - dado - 4;
      const tx = Math.floor(x / 8), tyi = Math.floor(ty / 8) + (y < dado ? 0 : 50);
      const lx = x % 8, ly = ty % 8;
      if (lx === 0 || ly === 0) return [grout, 0.9 + noise2(s, x, y) * 0.1];
      const n = noise2(s, tx, tyi);
      if (n > 0.95 && y < dado) {
        const dx = lx - 4, dy = ly - 4;
        if ((Math.abs(dx) + Math.abs(dy) === 2 && (dx === 0 || dy === 0)) || (dx === 0 && dy === 0)) return [decoInk, 1];
        return [deco, 1 - (ly === 7 ? 0.12 : 0)];
      }
      let f = 0.95 + noise2(s, x, y) * 0.06;
      if (lx === 1 && ly <= 2) f = 1.45;
      if (ly === 7 || lx === 7) f *= 0.84;
      if (y > dado) f *= 0.82;
      return [pal[Math.floor(n * pal.length)], f];
    };
  }
  // planks (default)
  const pal = rgbs(['#5e3a22', '#6a4228', '#74492c', '#663f26', '#70452a']);
  const planks: { x0: number; w: number; i: number; seam: number; c: number; kx: number; ky: number }[] = [];
  let px = 0, i = 0;
  while (px < W) {
    const w = 8 + Math.floor(noise2(s, i, 1) * 4);
    planks.push({ x0: px, w, i, seam: CEIL + 8 + Math.floor(noise2(s, i, 2) * 90), c: Math.floor(noise2(s, i, 3) * pal.length), kx: px + 2 + noise2(s, i, 4) * (w - 4), ky: CEIL + 10 + noise2(s, i, 5) * 85 });
    px += w; i++;
  }
  const lookup = new Int16Array(W);
  planks.forEach((p, k) => { for (let x = p.x0; x < p.x0 + p.w && x < W; x++) lookup[x] = k; });
  const batten = hexToRgb('#7a5034');
  const bY0 = CEIL + 44, bY1 = CEIL + 49;
  const nail = hexToRgb('#2a2420');
  return (x, y) => {
    if (y >= bY0 && y <= bY1) {
      if ((x % 23 === 5) && (y === bY0 + 2)) return [nail, 1];
      return [batten, (y === bY0 ? 1.25 : y === bY1 ? 0.7 : 0.95) + valueNoise(s, x * 0.06, y * 0.8) * 0.12];
    }
    const p = planks[lookup[x]], lx = x - p.x0;
    if (lx === 0) return [pal[p.c], 0.42];
    let f = 0.9 + valueNoise(s + p.i, lx * 0.8, y * 0.05) * 0.2;
    if (valueNoise(s + p.i * 7, lx * 1.7, y * 0.025) > 0.72) f *= 0.86;
    if (lx === 1) f *= 1.12;
    if (lx === p.w - 1) f *= 0.86;
    if (y === p.seam) return [pal[p.c], 0.5];
    if (y === p.seam + 1) f *= 1.1;
    if (y === bY1 + 1) f *= 0.65;
    const d = ((x - p.kx) / 1.5) ** 2 + ((y - p.ky) / 2.4) ** 2;
    if (d < 1) f *= d < 0.3 ? 0.55 : 0.75;
    else if (d < 1.8) f *= 0.92;
    if ((y === CEIL + 3 || y === FLOOR_Y - 9) && (lx === 2 || lx === p.w - 3)) return [nail, 1];
    return [pal[p.c], f];
  };
}

// Floor perspective mapping
const yHor = FLOOR_Y - 150;
const K = 80 / (1 / 150 - 1 / (H - yHor));
function floorUV(x: number, y: number): [number, number, number] {
  const t = y - yHor;
  const s = t / (FLOOR_Y - yHor);
  return [(x - 160) / s + 1000, K * (1 / (FLOOR_Y - yHor) - 1 / t), 1 / s];
}

function floorFn(style: string): (x: number, y: number) => [RGB, number] {
  const s = SEED + hashString('floor' + style);
  if (style === 'flagstone') {
    const pal = rgbs(['#6e6a62', '#7a746a', '#66625c', '#827a6c', '#5e5a54', '#746c60']);
    const mortar = hexToRgb('#3a332c');
    const cell = 15;
    return (x, y) => {
      const [u, v, ppu] = floorUV(x, y);
      const cu = Math.floor(u / cell), cv = Math.floor(v / cell * 1.2);
      let d1 = 1e9, d2 = 1e9, id = 0;
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const gu = cu + i, gv = cv + j;
          const pu = (gu + 0.15 + noise2(s, gu, gv) * 0.7) * cell, pv = (gv + 0.15 + noise2(s + 1, gu, gv) * 0.7) * cell / 1.2;
          const d = Math.hypot(u - pu, (v - pv) * 1.2);
          if (d < d1) { d2 = d1; d1 = d; id = gu * 131 + gv; } else if (d < d2) d2 = d;
        }
      const e = d2 - d1;
      if (e < 1.3 * ppu + 0.4) return [mortar, 0.9 + noise2(s, x, y) * 0.2];
      let f = 0.9 + valueNoise(s, u * 0.3, v * 0.3) * 0.16 + noise2(s, x, y) * 0.06;
      if (e < 3) f *= 0.9;
      return [pal[Math.floor(noise2(s, id, 7) * pal.length)], f];
    };
  }
  if (style === 'herringbone') {
    const pal = rgbs(['#8a5a34', '#7a4e2c', '#9a6a3e', '#6e4628', '#86563a']);
    const seam = hexToRgb('#3a2414');
    return (x, y) => {
      const [u, v, ppu] = floorUV(x, y);
      const cw = 16;
      const col = Math.floor(u / cw), lu = u - col * cw;
      const dir = col % 2 === 0;
      const k = (v * 1.3 + (dir ? lu : cw - lu)) / 5.5;
      const idx = Math.floor(k), fr = k - idx;
      if (lu < ppu * 0.9 || fr < 0.16 * ppu) return [seam, 1];
      const n = noise2(s, col, idx);
      const f = 0.9 + valueNoise(s, u * (dir ? 0.6 : 0.6), v * 1.2 + idx) * 0.18;
      return [pal[Math.floor(n * pal.length)], f];
    };
  }
  if (style === 'terracotta') {
    const pal = rgbs(['#b85a36', '#c4683e', '#a85030', '#cc7446', '#b4603a']);
    const grout = hexToRgb('#a89276');
    const ts = 13;
    return (x, y) => {
      const [u, v, ppu] = floorUV(x, y);
      const vv = v * 1.15;
      const tu = Math.floor(u / ts), tv = Math.floor(vv / ts);
      const lu = u - tu * ts, lv = vv - tv * ts;
      if (lu < 1.1 * ppu || lv < 1.1 * ppu) return [grout, 0.9 + noise2(s, x, y) * 0.15];
      const n = noise2(s, tu, tv);
      let f = 0.9 + valueNoise(s + tu * 3, u * 0.25, vv * 0.25) * 0.18 + noise2(s, x, y) * 0.05;
      if (lv < 2.2 * ppu) f *= 1.1;
      if (lu > ts - 1.4 * ppu) f *= 0.88;
      if (valueNoise(s + 9, u * 0.12, vv * 0.12) > 0.78) f *= 0.88;
      return [pal[Math.floor(n * pal.length)], f];
    };
  }
  if (style === 'rushmat') {
    const pal = rgbs(['#b89a5a', '#a8884a', '#c4a666', '#ae9050']);
    const dark = hexToRgb('#6e5428');
    return (x, y) => {
      const [u, v, ppu] = floorUV(x, y);
      const bs = 8;
      const bu = Math.floor(u / bs), bv = Math.floor(v / bs);
      const lu = u - bu * bs, lv = v - bv * bs;
      const along = (bu + bv) % 2 === 0;
      const strand = along ? lv : lu;
      const sIdx = Math.floor(strand / 2), sf = strand / 2 - sIdx;
      if ((along ? lu : lv) < ppu * 0.8) return [dark, 1.1];
      let f = 0.88 + Math.sin(sf * Math.PI) * 0.18 + noise2(s, x, y) * 0.06;
      if (sf < 0.2) f *= 0.8;
      return [pal[(sIdx + bu + bv) & 3], f];
    };
  }
  // boards, running toward the viewer
  const pal = rgbs(['#7a4e30', '#86573a', '#6e4429', '#8e5e3c', '#7e5234']);
  const seam = hexToRgb('#2e1c10');
  return (x, y) => {
    const [u, v, ppu] = floorUV(x, y);
    const bw = 12;
    const bi = Math.floor(u / bw), lu = u - bi * bw;
    if (lu < ppu * 1.0) return [seam, 1];
    const len = 34;
    const jo = noise2(s, bi, 1) * len;
    const jv = (v + jo) % len;
    if (jv < 0.9 * ppu * 1.6) return [seam, 1.2];
    const seg = Math.floor((v + jo) / len);
    const n = noise2(s, bi, seg + 3);
    let f = 0.88 + valueNoise(s + bi, lu * 0.7, v * 0.12) * 0.2;
    if (valueNoise(s + bi * 5, lu * 1.5, v * 0.05) > 0.74) f *= 0.88;
    if (lu < ppu * 2) f *= 1.1;
    if (jv > 1.5 && jv < 3.2 && (Math.abs(lu - 3) < 0.6 || Math.abs(lu - 9) < 0.6)) return [hexToRgb('#3a2a20'), 1];
    return [pal[Math.floor(n * pal.length)], f];
  };
}

function paintWallFloor(c: C2D, wall: string, floor: string) {
  const img = c.createImageData(W, H);
  const d = img.data;
  const wf = wallFn(wall);
  for (let y = CEIL; y < FLOOR_Y - 5; y++)
    for (let x = 0; x < W; x++) {
      const [col, f] = wf(x, y);
      // gentle darkening near the ceiling and floor
      const g = 1 - 0.1 * clamp((CEIL + 10 - y) / 10) - 0.06 * clamp((y - (FLOOR_Y - 20)) / 15);
      putRGB(d, x, y, col, f * g);
    }
  // skirting board
  const sk = hexToRgb('#3e2616');
  for (let y = FLOOR_Y - 5; y < FLOOR_Y; y++)
    for (let x = 0; x < W; x++) putRGB(d, x, y, sk, (y === FLOOR_Y - 5 ? 1.5 : y === FLOOR_Y - 4 ? 1.15 : 1) * (0.92 + valueNoise(7, x * 0.1, y) * 0.12));
  const ff = floorFn(floor);
  for (let y = FLOOR_Y; y < H; y++)
    for (let x = 0; x < W; x++) {
      const [col, f] = ff(x, y);
      const depth = (y - FLOOR_Y) / (H - FLOOR_Y);
      let g = 0.78 + 0.22 * Math.sqrt(depth);
      if (y < FLOOR_Y + 4) g *= 0.62 + (y - FLOOR_Y) * 0.09;
      const side = Math.abs(x - 160) / 160;
      g *= 1 - side * side * 0.18;
      putRGB(d, x, y, col, f * g);
    }
  c.putImageData(img, 0, 0);
}

// ============================================================ ceiling & frame
function drawCeiling(c: C2D) {
  for (let x = 0; x < W; x += 7) {
    R(c, x, 0, 7, CEIL, x % 14 ? '#2a1a12' : '#2e1d14');
    V(c, x, 0, CEIL, '#1a0f0a');
  }
  // rafters (joist ends)
  for (let x = 12; x < W; x += 52) { R(c, x, 0, 6, CEIL - 6, '#3a2416'); V(c, x, 0, CEIL - 7, '#4e3020'); }
  // upper beam
  R(c, 0, 5, W, 4, '#3a2416'); HL(c, 0, W - 1, 5, '#4e3020'); HL(c, 0, W - 1, 8, '#24150d');
  // main purlin
  R(c, 0, CEIL - 6, W, 6, '#4e3020');
  HL(c, 0, W - 1, CEIL - 6, '#6e4a2c');
  HL(c, 0, W - 1, CEIL - 5, '#5e3c24');
  HL(c, 0, W - 1, CEIL - 1, '#2a180e');
  for (let x = 0; x < W; x++) if (noise2(11, x, 0) > 0.8) P(c, x, CEIL - 3 - (x % 2), '#3e2616');
  // soft shadow under the beam
  R(c, 0, CEIL, W, 1, 'rgba(10,5,2,0.35)');
  R(c, 0, CEIL + 1, W, 2, 'rgba(10,5,2,0.15)');
  // drying herbs hanging from the purlin
  const herbs: [number, string[]][] = [[150, ['#4e6a34', '#6a8a44', '#8aa858']], [258, ['#6a5a2a', '#8a7a3a', '#b0a050']], [296, ['#4a6a3a', '#6a8a50', '#8ab070']], [12, ['#5a4a6a', '#7a6a9a', '#a890c0']]];
  for (const [hx, col] of herbs) {
    V(c, hx, CEIL, CEIL + 2, '#a8946a');
    P(c, hx - 1, CEIL + 3, '#c8a050'); P(c, hx, CEIL + 3, '#e0b860'); P(c, hx + 1, CEIL + 3, '#c8a050');
    for (let i = 0; i < 10; i++) {
      const yy = CEIL + 4 + i;
      const wv = Math.min(3, Math.floor(i / 2) + 1);
      for (let x = hx - wv; x <= hx + wv; x++) {
        const n = noise2(hx, x, yy);
        if (Math.abs(x - hx) === wv && n < 0.45) continue;
        if (i > 7 && n < 0.5) continue;
        P(c, x, yy, col[n < 0.35 ? 0 : n < 0.75 ? 1 : 2]);
      }
      if (i < 4) P(c, hx, yy, '#6a5a30');
    }
  }
}

function drawPosts(c: C2D, gallery: boolean) {
  bevel(c, 0, CEIL - 6, 4, FLOOR_Y - CEIL + 8, '#4a2e1c', 0.15, 0.3);
  if (!gallery) bevel(c, W - 4, CEIL - 6, 4, FLOOR_Y - CEIL + 8, '#4a2e1c', 0.15, 0.3);
  else bevel(c, W - 2, CEIL - 6, 2, FLOOR_Y - CEIL + 8, '#4a2e1c', 0.15, 0.3);
}

// ============================================================ window
function drawWindow(c: C2D, g: WinGeo, season: string, plants: boolean) {
  const frame = '#5a3a24', frameHi = '#7a5034', frameLo = '#3a2416';
  // clear the opening so the sky (drawn underneath) shows through
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      const inG = g.glass(x, y);
      const nearG = !inG && (g.glass(x - 1, y) || g.glass(x + 1, y) || g.glass(x, y - 1) || g.glass(x, y + 1) || g.glass(x - 2, y) || g.glass(x + 2, y) || g.glass(x, y - 2) || g.glass(x, y + 2));
      const outer = g.kind === 'round' ? (x - 16.5) ** 2 + (y - 16.5) ** 2 <= 17 * 17 : g.kind === 'stained' ? (y >= 15 || (x - 14.5) ** 2 + (y - 15) ** 2 <= 15 * 15) : true;
      if (inG) c.clearRect(g.x + x, g.y + y, 1, 1);
      else if (nearG || outer) {
        const edgeTop = g.glass(x, y + 1) || g.glass(x + 1, y + 1);
        P(c, g.x + x, g.y + y, nearG ? (edgeTop ? frameLo : frame) : (y < 2 || x < 1 ? frameHi : frame));
      }
    }
  const gx = g.x, gy = g.y;
  // mullions
  const mul = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (g.glass(x - gx, y - gy)) P(c, x, y, frame);
  };
  if (g.kind === 'small') { mul(gx + 14, gy, gx + 15, gy + g.h); mul(gx, gy + 15, gx + g.w, gy + 15); }
  else if (g.kind === 'large') { mul(gx + 18, gy, gx + 18, gy + g.h); mul(gx + 35, gy, gx + 35, gy + g.h); mul(gx, gy + 17, gx + g.w, gy + 17); }
  else if (g.kind === 'round') { mul(gx + 16, gy, gx + 17, gy + g.h); mul(gx, gy + 16, gx + g.w, gy + 17); }
  else if (g.kind === 'stained') {
    // leaded panes with coloured glass
    const cols = ['#c83a3a', '#e0a83a', '#3a7ac8', '#4aa86a', '#9a4ac8', '#e0c86a'];
    for (let y = 0; y < g.h; y++)
      for (let x = 0; x < g.w; x++) {
        if (!g.glass(x, y)) continue;
        const lead = x === 14 || x === 15 || (y > 15 && (y - 15) % 9 === 0) || (y <= 15 && Math.abs((x - 14.5) ** 2 + (y - 15) ** 2 - 49) < 7) || (y > 15 && (x === 8 || x === 21));
        if (lead) { P(c, gx + x, gy + y, '#2a2420'); continue; }
        const pane = y <= 15 ? ((x - 14.5) ** 2 + (y - 15) ** 2 < 49 ? 5 : x < 15 ? 0 : 2) : (Math.floor((y - 15) / 9) * 3 + (x < 8 ? 0 : x < 15 ? 1 : x < 21 ? 2 : 3)) % 5;
        P(c, gx + x, gy + y, rgba(cols[pane], 0.42));
      }
  }
  // glass glint
  for (let k = 0; k < g.w + g.h; k++) {
    const x = k, y = g.h - 1 - k + 6;
    for (const o of [0, 1, 5]) if (g.glass(x + o, y) && g.kind !== 'stained') P(c, gx + x + o, gy + y, 'rgba(255,255,255,0.10)');
  }
  // sill
  const sy = gy + g.h;
  R(c, gx - 4, sy, g.w + 8, 3, '#7a5034');
  HL(c, gx - 4, gx + g.w + 3, sy, '#a07040');
  HL(c, gx - 4, gx + g.w + 3, sy + 3, 'rgba(10,5,2,0.35)');
  if (season === 'Winter') {
    // snow drifted onto the outer sill, visible at the bottom of the glass
    for (let x = 0; x < g.w; x++) {
      const hh = 1 + Math.round(valueNoise(3, x * 0.3, 1) * 2);
      for (let y = 0; y < hh; y++) {
        const yy = g.h - 4 - y;
        if (g.glass(x, yy)) P(c, gx + x, gy + yy, y === hh - 1 ? '#dfe8f4' : '#f4f8ff');
      }
    }
    for (let x = -3; x < g.w + 3; x += 1) if (noise2(5, x, 2) > 0.55) P(c, gx + x, sy - 1, '#eef4fc');
  }
  if (plants) {
    // fern pot (left)
    const px = gx - 3, py = sy;
    R(c, px, py - 6, 7, 6, '#b05e36'); HL(c, px, px + 6, py - 6, '#d07a48'); R(c, px + 1, py - 1, 5, 1, '#8a4426');
    R(c, px - 1, py - 7, 9, 1, '#c86c3e');
    const fronds = [[-1, -10, -5], [1, -13, -1], [3, -12, 3], [5, -10, 7], [2, -9, 1]];
    for (const [ox, oy, ex] of fronds) {
      L(c, px + 3, py - 7, px + 3 + ex, py + oy, '#3e7a34');
      for (let k = 1; k < 4; k++) P(c, px + 3 + Math.round(ex * k / 4) + (k % 2 ? 1 : -1), py - 7 + Math.round(oy + 7) * k / 4, '#5aa048');
      P(c, px + 3 + ex, py + oy, '#7abc5a');
    }
    // herb pot (right)
    const hx = gx + g.w - 3, hy = sy;
    R(c, hx, hy - 5, 6, 5, '#9a6a4a'); HL(c, hx, hx + 5, hy - 5, '#b88a62');
    for (let k = 0; k < 9; k++) {
      const lx = hx + (k % 5) + 0.5, ly = hy - 6 - Math.floor(noise2(9, k, 1) * 5);
      V(c, lx, ly, hy - 6, '#4a7a34');
      P(c, lx, ly, k % 3 ? '#6ab04a' : '#8ac860');
      if (k % 4 === 0) P(c, lx + 1, ly - 1, '#f4f0ff');
    }
  }
}

// ============================================================ helpers for patterned masonry
function maskedBricks(c: C2D, x0: number, y0: number, x1: number, y1: number, inside: (x: number, y: number) => boolean, pal: string[], mortar: string, bw = 6, bh = 3, seed = 1) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      const r = Math.floor((y - y0) / bh), off = r % 2 ? Math.floor(bw / 2) : 0;
      const lx = (x - x0 + off) % bw, ly = (y - y0) % bh, bx = Math.floor((x - x0 + off) / bw);
      if (lx === 0 || ly === 0) { P(c, x, y, mortar); continue; }
      const n = noise2(seed, bx, r);
      let col = pal[Math.floor(n * pal.length)];
      if (ly === 1 && noise2(seed, x, y) > 0.4) col = shadeHex(col, 0.1);
      else if (ly === bh - 1) col = shadeHex(col, -0.12);
      if (noise2(seed + 1, x, y) > 0.92) col = shadeHex(col, -0.15);
      P(c, x, y, col);
    }
}

function maskedStones(c: C2D, x0: number, y0: number, x1: number, y1: number, inside: (x: number, y: number) => boolean, pal: string[], mortar: string, seed = 3) {
  const cell = 7;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      const cu = Math.floor(x / cell), cv = Math.floor(y / (cell - 1));
      let d1 = 1e9, d2 = 1e9, id = 0, best: [number, number] = [0, 0];
      for (let j = -1; j <= 1; j++)
        for (let i = -1; i <= 1; i++) {
          const gu = cu + i, gv = cv + j;
          const px = (gu + 0.2 + noise2(seed, gu, gv) * 0.6) * cell, py = (gv + 0.2 + noise2(seed + 1, gu, gv) * 0.6) * (cell - 1);
          const d = Math.hypot(x - px, (y - py) * 1.25);
          if (d < d1) { d2 = d1; d1 = d; id = gu * 97 + gv; best = [px, py]; } else if (d < d2) d2 = d;
        }
      if (d2 - d1 < 1.1) { P(c, x, y, mortar); continue; }
      let col = pal[Math.floor(noise2(seed, id, 5) * pal.length)];
      if (y < best[1] - 1 && d2 - d1 < 2.6) col = shadeHex(col, 0.14);
      else if (y > best[1] + 1 && d2 - d1 < 2.6) col = shadeHex(col, -0.18);
      if (noise2(seed + 2, x, y) > 0.85) col = shadeHex(col, -0.08);
      P(c, x, y, col);
    }
}

// ============================================================ forge
const BRICK_PAL = ['#8e3b2c', '#9c4632', '#a8523a', '#7e3428', '#b05e42'];
const STONE_PAL = ['#8a8270', '#9a8e72', '#7a7466', '#a39674', '#8c8062'];
const BASALT_PAL = ['#3e383c', '#46404a', '#36303a', '#4a4248', '#3a3640'];

function drawForge(c: C2D, style: string, up: Set<string>, mouth: Mouth) {
  const cx = 91;
  const hoodTop = style === 'copperhood' ? 50 : 58;
  const hoodIn = (x: number, y: number) => {
    if (y < hoodTop || y > 92) return false;
    const t = (y - hoodTop) / (92 - hoodTop);
    const hw = (style === 'copperhood' ? 8 : 11) + t * (style === 'copperhood' ? 18 : 12);
    return Math.abs(x + 0.5 - cx) <= hw;
  };
  const chimIn = (x: number, y: number) => y >= 0 && y < hoodTop && x >= (style === 'copperhood' ? 85 : 80) && x <= (style === 'copperhood' ? 97 : 102);
  const hearthIn = (x: number, y: number) => x >= 68 && x <= 114 && y >= 96 && y <= BASE;

  // chimney + hood
  if (style === 'stone') {
    maskedStones(c, 60, 0, 122, 92, (x, y) => chimIn(x, y) || hoodIn(x, y), STONE_PAL, '#4c443a', 21);
  } else if (style === 'dragonmaw') {
    maskedStones(c, 78, 0, 104, hoodTop - 1, chimIn, BASALT_PAL, '#24202a', 22);
    // scaled hood
    for (let y = hoodTop; y <= 92; y++)
      for (let x = 60; x <= 122; x++) {
        if (!hoodIn(x, y)) continue;
        const row = Math.floor((y - hoodTop) / 4), lx = (x + (row % 2) * 3) % 6, ly = (y - hoodTop) % 4;
        const arc = ly === 3 - Math.round(Math.abs(lx - 2.5) * 0.6);
        let col = row % 2 ? '#3a4a40' : '#34443a';
        if (arc) col = '#1e2622';
        else if (ly === 0) col = '#4e6254';
        P(c, x, y, col);
      }
  } else if (style === 'copperhood') {
    // copper chimney pipe
    for (let y = 0; y < hoodTop; y++)
      for (let x = 85; x <= 97; x++) {
        const t = (x - 85) / 12;
        let k = t < 0.15 ? 1 : t < 0.3 ? 3 : t < 0.4 ? 5 : t < 0.7 ? 3 : t < 0.88 ? 2 : 1;
        if (y % 14 === 0) k = Math.max(0, k - 1);
        P(c, x, y, COPPER[k]);
      }
    for (let y = 6; y < hoodTop; y += 14) for (let x = 86; x <= 96; x += 3) P(c, x, y + 1, COPPER[6]);
    // copper hood
    for (let y = hoodTop; y <= 92; y++)
      for (let x = 60; x <= 122; x++) {
        if (!hoodIn(x, y)) continue;
        const t = (y - hoodTop) / (92 - hoodTop);
        const hw = 8 + t * 18;
        const u = (x + 0.5 - cx) / hw; // -1..1
        let k = u < -0.85 ? 1 : u < -0.55 ? 2 : u < -0.35 ? 4 : u < -0.22 ? 6 : u < 0.2 ? 3 : u < 0.6 ? 2 : 1;
        if ((y - hoodTop) % 10 === 0) k = Math.max(0, k - 1);
        let col = COPPER[k];
        if (noise2(31, x >> 1, y >> 1) > 0.97 && (y > 84 || (y - hoodTop) % 10 < 2)) col = noise2(32, x, y) > 0.5 ? '#5aa08a' : '#4a8a78';
        P(c, x, y, col);
      }
    for (let y = hoodTop + 10; y < 92; y += 10) {
      const t = (y - hoodTop) / 42, hw = 8 + t * 18;
      for (let x = Math.ceil(cx - hw) + 2; x < cx + hw - 1; x += 4) P(c, x, y + 1, COPPER[6]);
    }
    R(c, 63, 89, 57, 3, COPPER[2]); HL(c, 63, 119, 89, COPPER[5]); HL(c, 63, 119, 91, COPPER[0]);
  } else {
    maskedBricks(c, 60, 0, 122, 92, (x, y) => chimIn(x, y) || hoodIn(x, y), BRICK_PAL, '#5a4a3e', 6, 3, 17);
  }
  // shade the chimney edges
  if (style !== 'copperhood')
    for (let y = 0; y < hoodTop; y++) { P(c, 80, y, 'rgba(0,0,0,0.25)'); P(c, 102, y, 'rgba(0,0,0,0.35)'); P(c, 101, y, 'rgba(0,0,0,0.15)'); }
  if (style === 'brick' || style === 'stone') {
    // define the hood: shaded slanted edges, a cornice where it meets the flue and a lintel band
    for (let y = hoodTop; y <= 92; y++) {
      const t = (y - hoodTop) / (92 - hoodTop);
      const hw = 11 + t * 12;
      const xl = Math.ceil(cx - 0.5 - hw), xr = Math.floor(cx - 0.5 + hw);
      P(c, xl, y, 'rgba(10,5,2,0.45)'); P(c, xl + 1, y, 'rgba(255,220,180,0.12)');
      P(c, xr, y, 'rgba(10,5,2,0.55)'); P(c, xr - 1, y, 'rgba(10,5,2,0.2)');
    }
    const band = style === 'stone' ? '#9a8e74' : '#8a7e6e';
    bevel(c, 78, hoodTop - 2, 27, 3, band, 0.2, 0.3);
    bevel(c, 68, 88, 47, 4, band, 0.2, 0.3);
    for (let x = 70; x < 113; x += 7) P(c, x, 90, shadeHex(band, -0.2));
  }
  // soot above the hood mouth
  for (let y = 80; y <= 92; y++) for (let x = 76; x <= 106; x++) if (hoodIn(x, y) && noise2(8, x, y) < (y - 80) / 16) P(c, x, y, 'rgba(20,10,6,0.25)');

  // mantle shelf
  if (style === 'stone') { bevel(c, 63, 92, 57, 5, '#5a3a22'); }
  else if (style === 'dragonmaw') { bevel(c, 64, 92, 55, 4, '#4a4248'); }
  else { bevel(c, 63, 92, 57, 4, '#8a7e6e'); HL(c, 64, 118, 96, 'rgba(0,0,0,0.3)'); }
  // mantle odds and ends
  // horseshoe
  const hsx = 76;
  R(c, hsx, 86, 1, 5, IRON[4]); R(c, hsx + 4, 86, 1, 5, IRON[3]); R(c, hsx + 1, 85, 3, 1, IRON[5]); P(c, hsx, 85, IRON[4]); P(c, hsx + 4, 85, IRON[3]);
  // little crock
  R(c, 101, 87, 5, 5, '#8a7a5a'); HL(c, 101, 105, 87, '#a8966e'); R(c, 102, 86, 3, 1, '#6a5a40');

  // hearth body
  if (style === 'stone') maskedStones(c, 68, 96, 114, BASE, hearthIn, STONE_PAL, '#4c443a', 23);
  else if (style === 'dragonmaw') {
    // the head is scaled like the hood, darker
    for (let y = 96; y <= BASE; y++)
      for (let x = 68; x <= 114; x++) {
        const row = Math.floor((y - 96) / 3), lx = (x + (row % 2) * 2) % 4, ly = (y - 96) % 3;
        let col = row % 2 ? '#2a3a32' : '#26342c';
        if (ly === 2 && lx !== 0) col = '#18201c';
        else if (ly === 0 && lx === 2) col = '#3e5446';
        if (x === 68 || x === 114) col = '#141a16';
        P(c, x, y, col);
      }
  }
  else maskedBricks(c, 68, 96, 114, BASE, hearthIn, BRICK_PAL, '#5a4a3e', 6, 3, 19);

  // mouth surround
  if (style === 'stone') {
    // lintel
    bevel(c, 76, 99, 31, 5, '#9a8e74', 0.2, 0.3);
    for (let x = 77; x < 106; x++) if (noise2(4, x, 1) > 0.7) P(c, x, 101, '#847a64');
    for (let y = 104; y <= 120; y++) { P(c, 79, y, '#5e5648'); P(c, 103, y, '#5e5648'); }
  } else if (style === 'dragonmaw') {
    // lips of the maw
    for (let y = 100; y <= 122; y++)
      for (let x = 76; x <= 106; x++) {
        const e = (x - cx) ** 2 / (13.5 * 13.5) + (y - 112) ** 2 / (11.6 * 11.6);
        if (e <= 1 && (x - cx) ** 2 / (11.5 * 11.5) + (y - 112) ** 2 / (9.5 * 9.5) > 1) P(c, x, y, y < 106 ? '#6a2a24' : '#4a1e1a');
      }
    // fangs
    for (let y = 100; y <= 121; y++)
      for (let x = 80; x <= 102; x++) {
        if (!DRAGON_FANGS.has(x * 1000 + y)) continue;
        const left = !DRAGON_FANGS.has((x - 1) * 1000 + y);
        P(c, x, y, left ? '#fff4dc' : '#d8c8a4');
      }
    // snout ridge + nostrils
    for (let y = 95; y <= 101; y++) HL(c, 89, 93, y, y === 95 ? '#5a7a64' : '#34483c');
    HL(c, 90, 92, 96, '#4a6656');
    R(c, 87, 100, 2, 1, '#0c0a0a'); R(c, 94, 100, 2, 1, '#0c0a0a');
    P(c, 87, 99, '#4a6656'); P(c, 95, 99, '#4a6656');
    // heavy brows and sleepy, half-closed eyes
    for (const ex of [81, 101]) {
      const dir = ex < cx ? -1 : 1;
      HL(c, ex - 4, ex + 4, 95, '#6a8a72');
      HL(c, ex - 4, ex + 4, 96, '#1a2420');
      P(c, ex + 5 * dir, 94, '#6a8a72'); P(c, ex + 6 * dir, 93, '#8aa890');
      // lid
      HL(c, ex - 3, ex + 3, 97, '#3e5446');
      HL(c, ex - 2, ex + 2, 98, '#0c0a0a');
      HL(c, ex - 3, ex + 3, 99, '#18201c');
    }
    // cheek frills
    for (const side of [-1, 1]) {
      const bx = cx + side * 23;
      for (let k = 0; k < 4; k++) { P(c, bx + side * (k % 2), 104 + k * 4, '#5a7a64'); P(c, bx + side * (1 + (k % 2)), 105 + k * 4, '#3e5446'); }
    }
    // horns sweeping up past the hood
    for (const side of [-1, 1]) {
      for (let i = 0; i < 20; i++) {
        const a = i / 19;
        const hx = cx + side * (19 + Math.sin(a * 2.4) * 8), hy = 95 - a * 22;
        const wv = Math.max(1, Math.round(3.4 - a * 2.6));
        for (let k = 0; k < wv; k++) P(c, Math.round(hx + side * k), Math.round(hy), i < 2 ? '#8a7a64' : k === 0 ? '#f0e4c4' : k === wv - 1 ? '#a8987a' : '#d4c6a4');
      }
    }
  } else {
    // arch of header bricks + soot
    for (let y = 96; y <= 121; y++)
      for (let x = 74; x <= 108; x++) {
        if (mouth.inside(x, y)) continue;
        const d = Math.hypot(x - cx, y - 112);
        if (y <= 112 && d >= 11.4 && d <= 14.8) {
          const a = Math.atan2(y - 112, x - cx);
          const seg = Math.floor((a + Math.PI) / (Math.PI / 8));
          const edge = Math.abs(((a + Math.PI) / (Math.PI / 8)) - Math.round((a + Math.PI) / (Math.PI / 8))) < 0.12;
          P(c, x, y, edge ? '#4a3a30' : seg % 2 ? '#7a3228' : '#6a2c24');
        } else if (y > 112 && (x === 78 || x === 79 || x === 103 || x === 104)) {
          P(c, x, y, (y % 3 === 0) ? '#4a3a30' : '#6a2c24');
        }
      }
  }
  // firebox interior (fire drawn over it per frame)
  for (let y = mouth.y; y < mouth.y + mouth.h; y++) for (let x = mouth.x; x < mouth.x + mouth.w; x++) if (mouth.inside(x, y)) P(c, x, y, '#140806');
  // ash door + plinth
  R(c, 84, 121, 15, 5, IRON[1]); HL(c, 84, 98, 121, IRON[3]); P(c, 91, 123, BRASS[3]); P(c, 86, 123, IRON[4]); P(c, 96, 123, IRON[4]);
  R(c, 66, BASE - 1, 51, 2, style === 'dragonmaw' ? '#2a262c' : '#6e665a');
  HL(c, 66, 116, BASE - 1, style === 'dragonmaw' ? '#4a4248' : '#8e8676');
  // poker & tongs on a hook at the left side of the hearth
  V(c, 70, 99, 120, IRON[3]); P(c, 69, 99, IRON[4]); P(c, 70, 98, IRON[5]);
  V(c, 72, 100, 119, IRON[2]); V(c, 73, 101, 119, IRON[3]); P(c, 72, 99, IRON[4]);

  if (up.has('bellows')) {
    // leather bellows standing by the hearth, nozzle into the side tuyère
    const bx = 116, by = 104;
    for (let y = 0; y < 20; y++) {
      const wv = Math.round(2 + Math.sin((y / 19) * Math.PI) * 4.5);
      R(c, bx + 4 - Math.floor(wv / 2), by + y, wv, 1, y % 3 === 0 ? '#6a3e22' : '#8a5634');
      P(c, bx + 4 - Math.floor(wv / 2), by + y, WOOD[3]);
      P(c, bx + 4 - Math.floor(wv / 2) + wv - 1, by + y, WOOD[2]);
    }
    V(c, bx + 4, by - 4, by, WOOD[4]); R(c, bx + 3, by - 5, 3, 1, WOOD[5]);
    for (let y = by + 4; y < by + 17; y += 3) HL(c, bx + 2, bx + 6, y, '#5a3420');
    R(c, bx + 3, by + 20, 3, 2, BRASS[3]);
    P(c, bx + 4, by + 22, BRASS[2]);
    R(c, 114, 116, 3, 1, BRASS[3]);
  } else {
    // a coal scuttle
    R(c, 116, 118, 7, 8, IRON[2]); HL(c, 116, 122, 118, IRON[4]); R(c, 117, 116, 5, 2, '#1a1414');
    P(c, 118, 116, '#3a3434'); P(c, 120, 115, '#2a2424');
    L(c, 116, 117, 119, 113, IRON[4]); L(c, 119, 113, 122, 117, IRON[4]);
  }
}

// ============================================================ anvil (front layer)
function drawAnvilLayer(c: C2D) {
  // quench tub
  const qx = 146, qb = 142;
  ellipse(c, qx + 4, qb, 6, 1.5, 'rgba(10,5,2,0.4)');
  R(c, qx, qb - 10, 9, 10, WOOD[3]);
  for (let x = qx; x < qx + 9; x += 3) V(c, x, qb - 10, qb - 1, WOOD[2]);
  V(c, qx + 1, qb - 10, qb - 1, WOOD[4]);
  HL(c, qx, qx + 8, qb - 8, IRON[2]); HL(c, qx, qx + 8, qb - 3, IRON[2]);
  R(c, qx, qb - 11, 9, 1, WOOD[5]);
  R(c, qx + 1, qb - 11, 7, 1, '#2a3a44');
  // stump shadow
  ellipse(c, 133, ANVIL_BASE_Y - 1, 12, 2, 'rgba(10,5,2,0.45)');
  // stump
  const sx0 = 125, sx1 = 141, sy0 = 131, sy1 = ANVIL_BASE_Y - 1;
  for (let x = sx0 - 1; x <= sx1 + 1; x++) {
    const t = (x - sx0) / (sx1 - sx0);
    const base = t < 0.12 ? WOOD[1] : t < 0.3 ? WOOD[3] : t < 0.55 ? WOOD[4] : t < 0.8 ? WOOD[3] : WOOD[2];
    const top = x < sx0 || x > sx1 ? sy1 - 2 : sy0;
    for (let y = top; y <= sy1; y++) {
      let col = base;
      if (noise2(51, x, Math.floor(y / 3)) > 0.78) col = shadeHex(col, -0.25);
      P(c, x, y, col);
    }
  }
  // stump top (rings)
  ellipse(c, 133, sy0, 8, 1.6, '#b08a5a');
  ellipse(c, 133, sy0, 5, 1, '#9a7448');
  ellipse(c, 133, sy0, 2, 0.4, '#b89464');
  HL(c, sx0, sx1, sy0 + 2, WOOD[2]);
  // anvil feet + waist
  R(c, 127, 127, 13, 3, IRON[2]); HL(c, 127, 139, 127, IRON[3]); P(c, 127, 129, IRON[1]); P(c, 139, 129, IRON[1]);
  R(c, 130, 124, 7, 3, IRON[2]); V(c, 130, 124, 126, IRON[3]);
  // face + horn + heel
  R(c, 125, 120, 18, 4, IRON[3]);
  HL(c, 125, 142, 120, IRON[6]); HL(c, 125, 142, 121, IRON[4]); HL(c, 125, 142, 123, IRON[2]);
  for (let i = 0; i < 7; i++) { const x = 124 - i; const th = i < 2 ? 3 : i < 5 ? 2 : 1; R(c, x, 120, 1, th, IRON[3]); P(c, x, 120, IRON[5]); }
  R(c, 143, 120, 2, 2, IRON[3]); P(c, 143, 120, IRON[5]); P(c, 141, 120, IRON[1]);
  // hammer resting on the face
  R(c, 131, 117, 4, 3, IRON[3]); HL(c, 131, 134, 117, IRON[5]);
  L(c, 135, 118, 142, 115, WOOD[5]); L(c, 135, 119, 142, 116, WOOD[3]);
  // tongs leaning on the stump
  L(c, 142, ANVIL_BASE_Y - 2, 146, 129, IRON[3]); L(c, 143, ANVIL_BASE_Y - 2, 145, 129, IRON[2]);
}

// ============================================================ storage
const METALS: Record<string, string[]> = {
  iron: ['#3a3a44', '#5e5e6a', '#8a8a96', '#c0c0cc'],
  copper: ['#6e3420', '#a8582e', '#d8864e', '#f4b880'],
  brass: ['#7a5a1c', '#b08a2e', '#dcb44a', '#fff0a0'],
  silver: ['#6a6e78', '#9aa0aa', '#c8ccd4', '#ffffff'],
  bronze: ['#5a3a1a', '#8a5a2a', '#b47e3c', '#e0b070'],
  azure: ['#1e3a6a', '#2e5a9a', '#4a86c8', '#a8d0f4'],
  gold: ['#8a5a10', '#c08a20', '#ecc040', '#fff4b0'],
  moon: ['#6a6a8a', '#9a9ac0', '#c8c8ec', '#ffffff'],
};

function ingots(c: C2D, x: number, by: number, metal: string, n: number) {
  const m = METALS[metal] || METALS.iron;
  for (let i = 0; i < n; i++) {
    const y = by - 2 * (i + 1), ox = i % 2 ? 1 : 0;
    R(c, x + ox, y, 7, 2, m[1]);
    HL(c, x + ox + 1, x + ox + 5, y, m[2]);
    P(c, x + ox + 2, y, m[3]);
    P(c, x + ox, y + 1, m[0]); P(c, x + ox + 6, y + 1, m[0]);
  }
}
function crate(c: C2D, x: number, by: number, w = 9, h = 8) {
  R(c, x, by - h, w, h, WOOD[4]);
  R(c, x, by - h, w, 1, WOOD[5]);
  V(c, x, by - h, by - 1, WOOD[2]); V(c, x + w - 1, by - h, by - 1, WOOD[2]);
  HL(c, x, x + w - 1, by - 1, WOOD[2]);
  HL(c, x + 1, x + w - 2, by - Math.ceil(h / 2), WOOD[3]);
  L(c, x + 1, by - 2, x + w - 2, by - h + 1, WOOD[3]);
  P(c, x + 2, by - h - 1, '#d8c070'); P(c, x + 5, by - h - 1, '#c8b060');
}
function sack(c: C2D, x: number, by: number) {
  ellipse(c, x + 4, by - 4, 4, 4, '#8a7450');
  R(c, x, by - 2, 9, 2, '#7a6444');
  P(c, x + 2, by - 6, '#a08a62'); P(c, x + 3, by - 7, '#a08a62');
  R(c, x + 3, by - 9, 3, 1, '#5a4a30');
  P(c, x + 3, by - 10, '#1a1414'); P(c, x + 4, by - 10, '#2e2828'); P(c, x + 5, by - 10, '#1a1414');
}
function jar(c: C2D, x: number, by: number, col: string) {
  R(c, x + 1, by - 7, 5, 7, col);
  R(c, x, by - 5, 7, 4, col);
  R(c, x + 2, by - 8, 3, 1, shadeHex(col, -0.3));
  P(c, x + 1, by - 5, shadeHex(col, 0.3)); P(c, x + 1, by - 4, shadeHex(col, 0.2));
  HL(c, x + 1, x + 5, by - 1, shadeHex(col, -0.25));
}
function logs(c: C2D, x: number, by: number) {
  for (const [ox, oy] of [[0, 0], [5, 0], [2.5, -4]]) {
    disc(c, x + 2 + ox, by - 2 + oy, 2, WOOD[3]);
    P(c, x + 2 + ox, by - 2 + oy, '#b08a5a');
    P(c, x + 1 + ox, by - 3 + oy, '#c09a68');
  }
}

function drawStorage(c: C2D, count: number, topFree: boolean) {
  const x0 = 34, x1 = 64, top = 64;
  R(c, x0 + 1, top, x1 - x0 - 2, BASE - top, '#2a1a10');
  for (let x = x0 + 4; x < x1 - 2; x += 5) V(c, x, top, BASE, '#22140c');
  bevel(c, x0, top - 1, 3, BASE - top + 1, WOOD[4]);
  bevel(c, x1 - 3, top - 1, 3, BASE - top + 1, WOOD[3]);
  const shelves = [top, 82, 100, 118];
  for (const y of shelves) {
    R(c, x0, y, x1 - x0, 2, WOOD[4]);
    HL(c, x0, x1 - 1, y, WOOD[5]);
    HL(c, x0 + 3, x1 - 4, y + 2, 'rgba(0,0,0,0.35)');
  }
  R(c, x0 - 1, top - 2, x1 - x0 + 2, 2, WOOD[5]); HL(c, x0 - 1, x1, top - 2, WOOD[6]);
  type Slot = [number, number, (x: number, by: number) => void];
  const ing = (m: string, n: number) => (x: number, by: number) => ingots(c, x, by, m, n);
  const slots: Slot[] = [
    [37, 82, ing('iron', 3)], [46, 100, (x, b) => crate(c, x, b)], [54, 82, ing('copper', 2)],
    [37, 118, (x, b) => sack(c, x, b)], [46, 82, ing('brass', 2)], [56, 100, (x, b) => jar(c, x, b, '#8a5a3a')],
    [48, 118, (x, b) => logs(c, x, b)], [37, 100, ing('silver', 2)], [54, 118, (x, b) => crate(c, x, b, 8, 9)],
    [37, 82, ing('iron', 4)], [46, 100, (x, b) => crate(c, x + 1, b - 8, 7, 6)], [54, 82, ing('copper', 4)],
    [37, 100, ing('bronze', 4)], [46, 82, ing('gold', 3)], [56, 100, (x, b) => jar(c, x, b - 8, '#5a7a6a')],
    [37, 126, (x, b) => ingots(c, x, b, 'azure', 1)], [46, 126, (x, b) => ingots(c, x, b, 'moon', 1)], [54, 126, (x, b) => ingots(c, x, b, 'iron', 1)],
  ];
  if (topFree) slots.push([37, top - 2, (x, b) => crate(c, x, b, 9, 7)], [47, top - 2, ing('iron', 2)]);
  const n = Math.round(slots.length * (1 - Math.exp(-Math.max(0, count) / 18)));
  for (let i = 0; i < n; i++) slots[i][2](slots[i][0], slots[i][1]);
  if (n < 4) {
    // a cobweb in the empty corner
    for (let k = 0; k < 5; k++) { P(c, x0 + 3 + k, top + 2, 'rgba(220,220,220,0.35)'); P(c, x0 + 3, top + 2 + k, 'rgba(220,220,220,0.35)'); }
    L(c, x0 + 3, top + 2, x0 + 7, top + 6, 'rgba(220,220,220,0.3)');
  }
}

// ============================================================ finishing bench
function drawFinishing(c: C2D, up: Set<string>): { x: number; y: number; r: number } | undefined {
  const x0 = 148, x1 = 190, top = 110;
  // legs + stretcher
  R(c, x0 + 2, top + 3, 3, BASE - top - 3, WOOD[2]); R(c, x1 - 5, top + 3, 3, BASE - top - 3, WOOD[2]);
  R(c, x0 + 2, 120, x1 - x0 - 4, 2, WOOD[2]);
  // rags + bottles on the low shelf
  R(c, x0 + 7, 116, 6, 4, '#c8b896'); HL(c, x0 + 7, x0 + 12, 116, '#e0d4b8'); P(c, x0 + 9, 118, '#a89878');
  R(c, x0 + 16, 114, 3, 6, '#4a6a3a'); P(c, x0 + 17, 113, '#2a2a2a'); P(c, x0 + 16, 115, '#7a9a5a');
  R(c, x0 + 21, 115, 3, 5, '#7a4a7a'); P(c, x0 + 22, 114, '#c8a050');
  // top
  R(c, x0, top, x1 - x0, 4, WOOD[4]); HL(c, x0, x1 - 1, top, WOOD[6]); HL(c, x0, x1 - 1, top + 3, WOOD[2]);
  // whetstone on its stand
  R(c, x0 + 3, top - 3, 8, 3, '#6a6a6a'); HL(c, x0 + 3, x0 + 10, top - 3, '#9a9a9a'); R(c, x0 + 2, top - 1, 10, 1, WOOD[2]);
  // a blade being finished
  HL(c, x0 + 13, x0 + 26, top - 1, IRON[5]); HL(c, x0 + 14, x0 + 25, top - 2, IRON[6]);
  R(c, x0 + 27, top - 3, 1, 4, BRASS[3]); R(c, x0 + 28, top - 2, 4, 2, WOOD[3]);
  if (up.has('wheel')) {
    const wx = 180, wy = 101, r = 6;
    // stand
    R(c, wx - 1, wy, 3, top - wy, WOOD[3]); V(c, wx - 1, wy, top - 1, WOOD[4]);
    R(c, wx - 5, top - 2, 11, 2, WOOD[2]);
    // treadle belt down to the floor
    V(c, wx + r - 1, wy + 2, BASE - 1, '#3a2418');
    R(c, wx + 2, BASE - 2, 9, 2, WOOD[3]);
    disc(c, wx, wy, r, '#7a6a4a');
    disc(c, wx, wy, r - 1, '#d4c6a4');
    disc(c, wx, wy, r - 2, '#c0b090');
    P(c, wx - 3, wy - 4, '#f0e6cc'); P(c, wx - 4, wy - 3, '#f0e6cc');
    return { x: wx, y: wy, r };
  }
  // buffing rouge + oil flask instead
  R(c, x1 - 12, top - 5, 4, 5, '#8a6a3a'); P(c, x1 - 11, top - 6, '#5a4a2a'); P(c, x1 - 12, top - 4, '#b08a5a');
  R(c, x1 - 7, top - 2, 4, 2, '#a83a2a'); HL(c, x1 - 7, x1 - 4, top - 2, '#d05a3a');
  return undefined;
}

// ============================================================ workbench
function drawWorkbench(c: C2D, up: Set<string>) {
  // pegboard
  const px0 = 194, px1 = 230, py0 = 66, py1 = 98;
  R(c, px0, py0, px1 - px0, py1 - py0, '#9a7a4a');
  R(c, px0, py0, px1 - px0, 1, '#b8945a'); R(c, px0, py1 - 1, px1 - px0, 1, '#6a5030');
  V(c, px0, py0, py1 - 1, '#6a5030'); V(c, px1 - 1, py0, py1 - 1, '#6a5030');
  for (let y = py0 + 3; y < py1 - 1; y += 4) for (let x = px0 + 3; x < px1 - 1; x += 4) P(c, x, y, '#5a4428');
  // tools
  // hammer
  V(c, 199, 72, 88, WOOD[5]); V(c, 200, 72, 88, WOOD[3]); R(c, 196, 69, 8, 3, IRON[3]); HL(c, 196, 203, 69, IRON[5]);
  // tongs
  L(c, 205, 69, 209, 92, IRON[3]); L(c, 209, 69, 205, 92, IRON[4]); P(c, 207, 80, IRON[5]);
  // files
  V(c, 213, 70, 86, IRON[4]); V(c, 213, 87, 92, WOOD[4]); V(c, 216, 72, 85, IRON[3]); V(c, 216, 86, 90, WOOD[3]);
  // saw
  for (let y = 70; y < 88; y++) { const wv = Math.round((y - 70) / 4) + 1; R(c, 220, y, wv, 1, IRON[4]); if (y % 2) P(c, 220 + wv, y, IRON[2]); }
  R(c, 219, 67, 4, 4, WOOD[4]); P(c, 220, 68, WOOD[1]);
  // calipers
  L(c, 226, 70, 224, 82, BRASS[4]); L(c, 226, 70, 228, 82, BRASS[3]); P(c, 226, 70, BRASS[6]);
  // pegs
  for (const x of [199, 207, 213, 216, 226]) P(c, x, 68, '#3a2a18');

  // bench
  const x0 = 190, x1 = 233, top = 106;
  const fine = up.has('finebench');
  const wood = fine ? ['#3a2210', '#5a3418', '#7a4a26', '#9a6236'] : [WOOD[2], WOOD[3], WOOD[4], WOOD[5]];
  R(c, x0 + 2, top + 4, 3, BASE - top - 4, wood[1]); R(c, x1 - 5, top + 4, 3, BASE - top - 4, wood[1]);
  R(c, x0 + 2, 118, x1 - x0 - 4, 2, wood[0]);
  // shelf: offcuts + toolbox
  R(c, x0 + 6, 113, 10, 5, '#6a2e22'); HL(c, x0 + 6, x0 + 15, 113, '#8a4a32'); R(c, x0 + 10, 112, 2, 1, IRON[4]);
  R(c, x0 + 20, 115, 12, 3, WOOD[5]); R(c, x0 + 24, 113, 8, 2, WOOD[4]);
  R(c, x0, top, x1 - x0, 4, wood[2]); HL(c, x0, x1 - 1, top, wood[3]); HL(c, x0, x1 - 1, top + 3, wood[0]);
  for (let x = x0 + 3; x < x1 - 2; x += 9) P(c, x, top + 2, wood[1]);
  // things on top
  // a mallet
  R(c, x0 + 15, top - 3, 5, 3, WOOD[5]); HL(c, x0 + 15, x0 + 19, top - 3, WOOD[6]); HL(c, x0 + 20, x0 + 26, top - 1, WOOD[3]);
  if (up.has('smallanvil')) {
    const ax = x0 + 2;
    R(c, ax + 1, top - 2, 5, 2, IRON[2]); R(c, ax + 2, top - 3, 3, 1, IRON[2]);
    R(c, ax, top - 5, 8, 2, IRON[3]); HL(c, ax, ax + 7, top - 5, IRON[5]);
    P(c, ax - 1, top - 5, IRON[4]); P(c, ax - 2, top - 5, IRON[3]);
  } else {
    // leather pouch
    R(c, x0 + 3, top - 4, 6, 4, '#7a4a2a'); HL(c, x0 + 3, x0 + 8, top - 4, '#9a6238'); P(c, x0 + 6, top - 2, BRASS[4]);
  }
  if (up.has('gemsetter')) {
    const gx = x0 + 27;
    R(c, gx, top - 3, 8, 3, '#5a2a3a'); HL(c, gx, gx + 7, top - 3, '#7a3a4a');
    R(c, gx, top - 7, 8, 1, '#5a2a3a'); L(c, gx, top - 6, gx, top - 4, '#4a2030'); L(c, gx + 7, top - 6, gx + 7, top - 4, '#4a2030');
    const gems = ['#e8304a', '#3a7ae8', '#3ac87a', '#f0d040', '#b05ae8'];
    gems.forEach((g, i) => P(c, gx + 1 + i + (i > 2 ? 1 : 0), top - 3 - (i % 2), g));
  }
  if (up.has('loupe')) {
    const lx = x0 + 23;
    R(c, lx - 2, top - 1, 5, 1, BRASS[2]); V(c, lx, top - 9, top - 1, BRASS[3]); L(c, lx, top - 9, lx - 3, top - 11, BRASS[4]);
    disc(c, lx - 4, top - 12, 2, BRASS[4]); P(c, lx - 4, top - 12, '#d8f0ff'); P(c, lx - 5, top - 13, '#ffffff');
  }
  if (fine) {
    // bench vice on the end
    const vx = x1 - 6;
    R(c, vx, top - 6, 6, 6, IRON[3]); HL(c, vx, vx + 5, top - 6, IRON[5]); R(c, vx + 1, top - 4, 4, 1, IRON[1]);
    HL(c, vx - 3, vx + 8, top - 2, IRON[4]); P(c, vx - 3, top - 3, IRON[5]); P(c, vx + 8, top - 1, IRON[5]);
  }
}

// ============================================================ journal desk
function drawJournal(c: C2D): { x: number; y: number } {
  const x0 = 234, x1 = 259, top = 106;
  R(c, x0 + 1, top + 3, 2, BASE - top - 3, WOOD[3]); R(c, x1 - 3, top + 3, 2, BASE - top - 3, WOOD[3]);
  R(c, x0 + 1, top + 3, x1 - x0 - 2, 6, WOOD[3]); bevel(c, x0 + 4, top + 4, x1 - x0 - 8, 4, WOOD[4]);
  P(c, (x0 + x1) >> 1, top + 6, BRASS[4]);
  R(c, x0, top, x1 - x0, 3, WOOD[4]); HL(c, x0, x1 - 1, top, WOOD[6]); HL(c, x0, x1 - 1, top + 2, WOOD[2]);
  // open book
  const bx = 240, by = top - 1;
  R(c, bx, by - 4, 14, 4, '#e8dab8');
  HL(c, bx, bx + 6, by - 5, '#f6ecd4'); HL(c, bx + 7, bx + 13, by - 5, '#f6ecd4');
  V(c, bx + 6, by - 5, by - 1, '#b8a888'); V(c, bx + 7, by - 5, by - 1, '#cfc0a0');
  HL(c, bx - 1, bx + 14, by, '#6a2a1e');
  for (let k = 0; k < 3; k++) { HL(c, bx + 1, bx + 4 - (k === 2 ? 1 : 0), by - 4 + k, '#8a7a64'); HL(c, bx + 8, bx + 12 - (k % 2), by - 4 + k, '#8a7a64'); }
  P(c, bx + 10, by - 2, '#a83a2a');
  V(c, bx + 7, by + 1, by + 3, '#b8302a');
  // inkpot + quill
  R(c, x1 - 5, top - 3, 4, 3, '#1e2030'); P(c, x1 - 4, top - 3, '#4a5070'); R(c, x1 - 4, top - 4, 2, 1, '#2a2c3a');
  L(c, x1 - 3, top - 4, x1 + 1, top - 14, '#e8e4dc');
  for (let k = 0; k < 7; k++) { const yy = top - 6 - k; const xx = x1 - 3 + Math.round((k + 2) * 0.4); P(c, xx + 1, yy, '#d0ccc4'); if (k > 1) P(c, xx - 1, yy, '#f4f0e8'); }
  // candle holder + candle
  const cx = 236;
  R(c, cx - 2, top - 1, 5, 1, BRASS[3]); P(c, cx + 3, top - 2, BRASS[4]);
  R(c, cx, top - 6, 2, 5, '#efe4c8'); P(c, cx, top - 6, '#fff8e8'); P(c, cx + 1, top - 3, '#d8caa8');
  P(c, cx, top - 7, '#2a1a10');
  return { x: cx + 0.5, y: top - 8 };
}

// ============================================================ display rack
const spriteCache = new Map<string, HTMLCanvasElement>();
const vkCache = new WeakMap<Item, string>();

function itemKey(it: Item): string {
  let k = vkCache.get(it);
  if (!k) { k = it.id + ':' + hashString(visualKey(it, 'front')).toString(36); vkCache.set(it, k); }
  return k;
}

/** Area-average downscale of a sprite to fit a slot (crisp alpha). */
function fitSprite(img: PixelImage, maxW: number, maxH: number): HTMLCanvasElement {
  const b = img.bounds();
  const s = Math.min(maxW / b.w, maxH / b.h, 0.5);
  const dw = Math.max(1, Math.floor(b.w * s)), dh = Math.max(1, Math.floor(b.h * s));
  const [cv, cx] = makeCanvas(dw, dh);
  const out = cx.createImageData(dw, dh);
  const d = img.data;
  for (let dy = 0; dy < dh; dy++) {
    const sy0 = b.y + Math.floor(dy / s), sy1 = Math.max(sy0 + 1, b.y + Math.floor((dy + 1) / s));
    for (let dx = 0; dx < dw; dx++) {
      const sx0 = b.x + Math.floor(dx / s), sx1 = Math.max(sx0 + 1, b.x + Math.floor((dx + 1) / s));
      let r = 0, g = 0, bl = 0, a = 0, n = 0, amax = 0;
      for (let y = sy0; y < sy1 && y < img.h; y++)
        for (let x = sx0; x < sx1 && x < img.w; x++) {
          const i = (y * img.w + x) * 4, al = d[i + 3];
          r += d[i] * al; g += d[i + 1] * al; bl += d[i + 2] * al; a += al; n++;
          if (al > amax) amax = al;
        }
      if (!n || a / n < 255 * 0.28) continue;
      const o = (dy * dw + dx) * 4;
      out.data[o] = r / a; out.data[o + 1] = g / a; out.data[o + 2] = bl / a; out.data[o + 3] = 255;
    }
  }
  cx.putImageData(out, 0, 0);
  return cv;
}

function itemSprite(it: Item, maxW: number, maxH: number): HTMLCanvasElement | null {
  try {
    const key = itemKey(it) + `@${maxW}x${maxH}`;
    let cv = spriteCache.get(key);
    if (!cv) {
      cv = fitSprite(renderItem(it, 'front'), maxW, maxH);
      if (spriteCache.size > 200) spriteCache.clear();
      spriteCache.set(key, cv);
    }
    return cv;
  } catch {
    return null;
  }
}

function drawDisplay(c: C2D, shelves: string, items: Item[]) {
  const slots: Rect[] = [];
  if (shelves === 'cabinet') {
    const x0 = 259, x1 = 305, y0 = 22, y1 = BASE;
    R(c, x0, y0 + 3, x1 - x0, y1 - y0 - 3, '#3a2214');
    R(c, x0 - 1, y0, x1 - x0 + 2, 4, '#5a3620'); HL(c, x0 - 1, x1, y0, '#7a4e2e'); HL(c, x0 + 1, x1 - 2, y0 + 3, '#2a180c');
    R(c, x0 + 2, y0 + 5, x1 - x0 - 4, 87, '#2a1218');
    for (let y = y0 + 5; y < y0 + 92; y++) for (let x = x0 + 2; x < x1 - 2; x++) if (noise2(77, x, y) > 0.9) P(c, x, y, '#341a20');
    for (let r = 0; r < 3; r++) {
      const sy = y0 + 5 + r * 29;
      for (let i = 0; i < 3; i++) slots.push({ x: x0 + 3 + i * 14, y: sy + 1, w: 12, h: 26 });
      R(c, x0 + 2, sy + 27, x1 - x0 - 4, 2, '#5a3620'); HL(c, x0 + 2, x1 - 3, sy + 27, '#8a5a34');
    }
    V(c, (x0 + x1) >> 1, y0 + 4, y0 + 92, '#5a3620');
    V(c, x0 + 1, y0 + 4, y1, '#5a3620'); V(c, x1 - 2, y0 + 4, y1, '#4a2c18');
    // drawers
    for (let k = 0; k < 2; k++) { const dy = y0 + 93 + k * 6; bevel(c, x0 + 2, dy, x1 - x0 - 4, 5, '#5a3620'); P(c, (x0 + x1) >> 1, dy + 2, BRASS[4]); }
  } else {
    const two = shelves === 'rack2';
    const x0 = 261, x1 = 303, y0 = two ? 30 : 46, y1 = two ? 112 : 106;
    bevel(c, x0, y0, x1 - x0, y1 - y0, '#5a3a24');
    R(c, x0 + 2, y0 + 2, x1 - x0 - 4, y1 - y0 - 4, '#4a2e1c');
    const rows = two ? 2 : 1;
    const rh = (y1 - y0 - 4) / rows;
    for (let r = 0; r < rows; r++) {
      const sy = Math.round(y0 + 2 + r * rh);
      for (let i = 0; i < 3; i++) {
        const sx = x0 + 3 + i * 13;
        R(c, sx, sy + 1, 11, Math.floor(rh) - 4, '#2e3a2a');
        R(c, sx, sy + 1, 11, 1, '#1e2a1c');
        slots.push({ x: sx, y: sy + 2, w: 11, h: Math.floor(rh) - 6 });
        P(c, sx + 2, sy + 3, BRASS[4]); P(c, sx + 8, sy + 3, BRASS[4]);
      }
      R(c, x0 + 1, Math.round(sy + rh) - 3, x1 - x0 - 2, 2, WOOD[5]);
      HL(c, x0 + 1, x1 - 2, Math.round(sy + rh) - 3, WOOD[6]);
    }
  }
  slots.forEach((s, i) => {
    const it = items[i];
    if (!it) return;
    const sp = itemSprite(it, s.w, s.h);
    if (!sp) return;
    const dx = s.x + Math.floor((s.w - sp.width) / 2), dy = s.y + s.h - sp.height;
    c.globalAlpha = 0.35;
    c.drawImage(sp, dx + 1, dy + 1);
    c.globalAlpha = 1;
    c.drawImage(sp, dx, dy);
  });
  if (shelves === 'cabinet') {
    // glass reflections
    for (let k = 0; k < 3; k++)
      for (let y = 27; y < 114; y++) {
        const x = 262 + k * 14 + Math.floor((114 - y) * 0.25);
        if (x < 303) { P(c, x, y, 'rgba(255,255,255,0.10)'); if (k === 1) P(c, x + 1, y, 'rgba(255,255,255,0.06)'); }
      }
  }
}

// ============================================================ gallery doorway
function drawGallery(c: C2D) {
  const x0 = 304, x1 = 317, top = 72;
  const cxm = (x0 + x1) / 2;
  const open = (x: number, y: number) => x >= x0 && x <= x1 && y <= BASE && (y >= top + 6 || (x - cxm) ** 2 + ((y - (top + 6)) * 1.1) ** 2 <= 6.9 * 6.9);
  // casing
  for (let y = top - 3; y <= BASE; y++)
    for (let x = x0 - 3; x <= x1 + 3; x++) {
      if (open(x, y)) continue;
      const near = open(x - 1, y) || open(x + 1, y) || open(x, y + 1) || open(x - 2, y) || open(x + 2, y) || open(x, y + 2) || open(x - 3, y) || open(x + 3, y) || open(x, y + 3);
      if (near) P(c, x, y, open(x + 1, y) || open(x, y + 1) ? '#3a2416' : x < x0 ? '#6e4a2c' : '#4e3020');
    }
  // the room beyond: far wall, framed piece, floor, plinth with a shield
  for (let y = top; y <= BASE; y++)
    for (let x = x0; x <= x1; x++) {
      if (!open(x, y)) continue;
      let col: string;
      if (y < 110) col = mixHex('#3e2a1e', '#7a5a3c', clamp((y - top) / 40) * 0.6 + clamp((x1 - x) / 14) * 0.25);
      else col = (x + y) % 5 === 0 ? '#5a3e28' : mixHex('#6a4a30', '#8a6440', (y - 110) / 16);
      if (x === x0) col = shadeHex(col, -0.4);
      P(c, x, y, col);
    }
  // framed sword on the far wall
  R(c, x0 + 4, top + 12, 7, 17, BRASS[2]); R(c, x0 + 5, top + 13, 5, 15, '#2a1a22');
  V(c, x0 + 7, top + 14, top + 23, IRON[5]); P(c, x0 + 7, top + 14, IRON[6]); HL(c, x0 + 6, x0 + 8, top + 24, BRASS[4]); V(c, x0 + 7, top + 25, top + 26, WOOD[4]);
  // plinth
  R(c, x0 + 6, 112, 7, 11, '#d8ccb0'); HL(c, x0 + 6, x0 + 12, 112, '#f0e6cc'); V(c, x0 + 12, 112, 122, '#a89a7e'); R(c, x0 + 5, 111, 9, 1, '#c8bca0');
  disc(c, x0 + 9, 107, 3, '#8a5a34'); P(c, x0 + 9, 107, BRASS[5]); P(c, x0 + 8, 105, '#b07a48');
  // shadow side of the opening
  for (let y = top; y <= BASE; y++) if (open(x0 + 1, y)) P(c, x0 + 1, y, 'rgba(0,0,0,0.25)');
  // sign above
  R(c, x0 + 1, top - 10, 12, 5, WOOD[4]); HL(c, x0 + 1, x0 + 12, top - 10, WOOD[6]);
  P(c, x0 + 7, top - 8, BRASS[5]); P(c, x0 + 6, top - 8, BRASS[3]); P(c, x0 + 8, top - 8, BRASS[3]); P(c, x0 + 7, top - 9, BRASS[4]); P(c, x0 + 7, top - 7, BRASS[4]);
}

// ============================================================ door
function drawDoor(c: C2D): Rect {
  const fx0 = 4, fx1 = 32, fy0 = 82;
  bevel(c, fx0, fy0, fx1 - fx0, BASE - fy0, '#4a2e1c', 0.2, 0.3);
  R(c, fx0 + 3, fy0 + 3, fx1 - fx0 - 6, BASE - fy0 - 3, '#1a0f08');
  const dx0 = 8, dx1 = 28, dy0 = 86;
  const pal = ['#6a4228', '#74492c', '#64402a', '#6e4529'];
  for (let i = 0; i < 4; i++) {
    const x = dx0 + i * 5;
    R(c, x, dy0, 5, BASE - dy0, pal[i]);
    V(c, x, dy0, BASE - 1, '#2e1c10');
    for (let y = dy0; y < BASE; y++) if (noise2(61, x + 2, y >> 2) > 0.8) P(c, x + 2, y, shadeHex(pal[i], -0.15));
  }
  // ledges and brace
  for (const y of [dy0 + 3, BASE - 8]) { R(c, dx0, y, dx1 - dx0, 3, '#7a5034'); HL(c, dx0, dx1 - 1, y, '#946240'); }
  L(c, dx0 + 1, BASE - 9, dx1 - 2, dy0 + 6, '#7a5034'); L(c, dx0 + 2, BASE - 9, dx1 - 1, dy0 + 6, '#5a3a24');
  // strap hinges
  for (const y of [dy0 + 4, BASE - 7]) { HL(c, dx0 - 1, dx0 + 9, y, IRON[2]); P(c, dx0 + 3, y, IRON[4]); P(c, dx0 + 7, y, IRON[4]); }
  // little window
  const pane: Rect = { x: 13, y: 92, w: 10, h: 8 };
  R(c, pane.x - 1, pane.y - 1, pane.w + 2, pane.h + 2, '#3a2416');
  R(c, pane.x, pane.y, pane.w, pane.h, '#8aa0b0');
  // ring handle
  disc(c, 25, 108, 1.5, IRON[3]); P(c, 25, 108, '#1a0f08'); P(c, 24, 107, IRON[5]);
  // threshold stone
  R(c, fx0 + 1, BASE - 1, fx1 - fx0 - 2, 2, '#8e8676'); HL(c, fx0 + 1, fx1 - 2, BASE - 1, '#aaa292');
  // bell on a scrolled bracket
  HL(c, 31, 35, 80, IRON[3]); P(c, 35, 79, IRON[3]); P(c, 34, 78, IRON[3]); P(c, 31, 81, IRON[2]);
  V(c, 33, 81, 82, IRON[2]);
  R(c, 32, 83, 3, 2, BRASS[4]); HL(c, 31, 35, 85, BRASS[3]); P(c, 32, 83, BRASS[6]); P(c, 33, 86, BRASS[2]);
  return pane;
}

// ============================================================ extras
function drawMat(c: C2D) {
  // welcome mat on the floor
  for (let y = 128; y < 134; y++) {
    const t = (y - 128) / 6;
    const xl = Math.round(7 - t * 2), xr = Math.round(29 + t * 2);
    for (let x = xl; x <= xr; x++) {
      const edge = y === 128 || y === 133 || x === xl || x === xr;
      P(c, x, y, edge ? '#5a4024' : (x + y) % 3 ? '#9a7a46' : '#8a6a3a');
    }
  }
}

function drawRug(c: C2D) {
  const y0 = 131, y1 = 152;
  for (let y = y0; y <= y1; y++) {
    const t = (y - y0) / (y1 - y0);
    const xl = Math.round(72 - t * 7), xr = Math.round(150 + t * 7);
    for (let x = xl; x <= xr; x++) {
      const u = (x - xl) / (xr - xl), v = t;
      const eu = Math.min(u, 1 - u) * 22, ev = Math.min(v, 1 - v) * 6;
      const e = Math.min(eu, ev * 3.6);
      let col: string;
      if (e < 0.9) col = '#5a1e18';
      else if (e < 2.2) col = '#a8342a';
      else if (e < 3.2) col = '#e0a040';
      else if (e < 4.6) col = '#8a2a22';
      else {
        const dx = Math.abs(u - 0.5) * 10, dy = Math.abs(v - 0.5) * 4;
        const dd = (dx + dy) % 2.2;
        col = dd < 0.6 ? '#e8b048' : dd < 1.2 ? '#b8402e' : '#c86a30';
        if (Math.abs(u - 0.5) * 10 + Math.abs(v - 0.5) * 4 < 1.1) col = '#f4d070';
      }
      if (noise2(91, x, y) > 0.9) col = shadeHex(col, -0.12);
      P(c, x, y, col);
    }
    // fringe
    if (y % 2 === 0) { P(c, xl - 1, y, '#e0c890'); P(c, xr + 1, y, '#e0c890'); }
  }
}

function drawBanner(c: C2D, color: string) {
  const x0 = 39, x1 = 58, y0 = CEIL + 3, y1 = 54;
  // cords + rod
  L(c, x0, CEIL, x0 + 2, y0, '#a8946a'); L(c, x1, CEIL, x1 - 2, y0, '#a8946a');
  HL(c, x0 - 2, x1 + 2, y0, BRASS[3]); P(c, x0 - 3, y0, BRASS[5]); P(c, x1 + 3, y0, BRASS[5]);
  const base = color;
  for (let y = y0 + 1; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const v = y - y0;
      const cxm = (x0 + x1) / 2;
      // swallowtail cut
      if (y > y1 - 6 && Math.abs(x - cxm) < (y - (y1 - 6)) * 1.3) continue;
      const fold = Math.sin((x - x0) * 0.75) * 0.12;
      let col = shadeHex(base, fold - v * 0.004);
      if (x === x0 || x === x1 || y === y0 + 1) col = BRASS[4];
      else if (x === x0 + 1 || x === x1 - 1) col = shadeHex(base, -0.25);
      P(c, x, y, col);
    }
  // emblem: an anvil under a star
  const ex = Math.round((x0 + x1) / 2), ey = y0 + 15;
  const g = BRASS[5];
  HL(c, ex - 5, ex + 4, ey, g); HL(c, ex - 3, ex + 4, ey + 1, g); HL(c, ex - 1, ex + 1, ey + 2, g); HL(c, ex - 3, ex + 3, ey + 3, g);
  P(c, ex - 6, ey, g); P(c, ex, ey - 6, g); HL(c, ex - 1, ex + 1, ey - 5, g); P(c, ex, ey - 4, g); P(c, ex - 2, ey - 5, shadeHex(g, -0.2)); P(c, ex + 2, ey - 5, shadeHex(g, -0.2));
  // tassels
  for (const tx of [x0 - 2, x1 + 2]) { V(c, tx, y0 + 1, y0 + 5, BRASS[3]); P(c, tx, y0 + 6, BRASS[5]); }
}

function drawBookshelf(c: C2D) {
  const x0 = 232, x1 = 260;
  for (const y of [80, 94]) {
    R(c, x0, y, x1 - x0, 2, WOOD[4]); HL(c, x0, x1 - 1, y, WOOD[6]); HL(c, x0 + 1, x1 - 2, y + 2, 'rgba(0,0,0,0.3)');
    P(c, x0 + 2, y + 2, IRON[3]); P(c, x0 + 2, y + 3, IRON[3]); P(c, x1 - 3, y + 2, IRON[3]); P(c, x1 - 3, y + 3, IRON[3]);
    let x = x0 + 1, k = 0;
    const cols = ['#7a2a24', '#2a4a6a', '#4a6a2a', '#8a6a2a', '#5a2a5a', '#2a5a5a', '#9a4a2a'];
    while (x < x1 - 2) {
      const n = noise2(33, k, y);
      if (n > 0.86 && k > 0) { x += 2; k++; continue; }
      const bw = 2 + (n > 0.5 ? 1 : 0), bh = 7 + Math.floor(noise2(34, k, y) * 5);
      const col = cols[Math.floor(noise2(35, k, y) * cols.length)];
      if (n > 0.8 && x < x1 - 7) {
        // a leaning book
        L(c, x, y - 1, x + 4, y - bh + 1, col); L(c, x + 1, y - 1, x + 5, y - bh + 1, shadeHex(col, -0.2));
        x += 6;
      } else {
        R(c, x, y - bh, bw, bh, col);
        P(c, x, y - bh + 2, BRASS[4]);
        V(c, x + bw - 1, y - bh, y - 1, shadeHex(col, -0.25));
        x += bw;
      }
      k++;
    }
  }
  // a tiny globe on the top shelf corner
  disc(c, x1 - 4, 75, 2, '#3a7aa0'); P(c, x1 - 5, 74, '#6ab06a'); P(c, x1 - 3, 76, '#6ab06a'); R(c, x1 - 5, 78, 3, 2, BRASS[3]);
}

function drawClockCase(c: C2D): { x: number; y: number } {
  const cx = 244, top = 28;
  // hood
  R(c, cx - 7, top, 15, 13, WOOD[3]); HL(c, cx - 7, cx + 7, top, WOOD[5]);
  R(c, cx - 8, top + 12, 17, 2, WOOD[4]);
  P(c, cx, top - 1, BRASS[4]); P(c, cx - 1, top - 1, BRASS[3]); P(c, cx + 1, top - 1, BRASS[3]); P(c, cx, top - 2, BRASS[5]);
  disc(c, cx, top + 6, 5, BRASS[3]);
  disc(c, cx, top + 6, 4, '#f2e8d0');
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; P(c, cx + Math.round(Math.sin(a) * 3.6), top + 6 - Math.round(Math.cos(a) * 3.6), i % 3 ? '#b8a888' : '#4a3a2a'); }
  // trunk with a glass window for the pendulum
  R(c, cx - 5, top + 14, 11, 21, WOOD[3]); V(c, cx - 5, top + 14, top + 34, WOOD[4]); V(c, cx + 5, top + 14, top + 34, WOOD[2]);
  R(c, cx - 3, top + 15, 7, 17, '#1e1410');
  R(c, cx - 6, top + 35, 13, 2, WOOD[4]); HL(c, cx - 6, cx + 6, top + 35, WOOD[5]);
  return { x: cx, y: top + 6 };
}

function drawGlassbloomPlanter(c: C2D): { x: number; y: number }[] {
  const x0 = 36, by = 62;
  R(c, x0, by - 4, 20, 4, '#6a6a7a'); HL(c, x0, x0 + 19, by - 4, '#9a9aaa'); HL(c, x0, x0 + 19, by - 1, '#4a4a58');
  const blooms: { x: number; y: number }[] = [];
  const cols = ['#8af0e0', '#f0a0e0', '#b0a0ff', '#a0e0ff', '#f8d0f0'];
  for (let i = 0; i < 6; i++) {
    const bx = x0 + 2 + i * 3 + (i % 2), hgt = 5 + Math.floor(noise2(41, i, 1) * 6);
    V(c, bx, by - 4 - hgt, by - 5, '#5aa890');
    if (i % 2) P(c, bx + 1, by - 6 - (hgt >> 1), '#7ac8a8');
    const col = cols[i % cols.length];
    const fy = by - 5 - hgt;
    P(c, bx, fy, '#ffffff'); P(c, bx - 1, fy + 1, col); P(c, bx + 1, fy + 1, col); P(c, bx, fy - 1, col); P(c, bx, fy + 1, shadeHex(col, -0.2));
    blooms.push({ x: bx, y: fy });
  }
  return blooms;
}

function drawShieldFrame(c: C2D) {
  const x0 = 116, x1 = 141;
  V(c, x0, 40, 86, WOOD[4]); V(c, x0 + 1, 40, 86, WOOD[3]); V(c, x1 - 1, 40, 86, WOOD[4]); V(c, x1, 40, 86, WOOD[3]);
  R(c, x0, 43, x1 - x0 + 1, 2, WOOD[5]); R(c, x0, 82, x1 - x0 + 1, 2, WOOD[5]);
  const cx = 128.5, cy = 63, r = 11;
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y);
      if (d > r + 0.3) continue;
      const px = Math.floor(cx + x), py = cy + y;
      const a = Math.atan2(y, x);
      if (d > r - 1.6) { if (a > -2.2) P(c, px, py, d > r - 0.6 ? IRON[2] : IRON[4]); else P(c, px, py, WOOD[2]); continue; }
      const plank = Math.floor((x + r) / 4);
      let col = [WOOD[4], WOOD[5], WOOD[3], WOOD[4], WOOD[5], WOOD[4]][plank % 6];
      if ((x + r) % 4 === 0) col = WOOD[2];
      P(c, px, py, col);
    }
  // clamps
  for (const [x, y] of [[x0 + 2, 52], [x1 - 3, 72]]) { R(c, x, y, 2, 4, IRON[3]); P(c, x, y, IRON[5]); }
}

// ============================================================ lighting fixtures
function drawLighting(c: C2D, kind: string, glassbloom: boolean, up: Set<string>): Lamp[] {
  const lamps: Lamp[] = [];
  const candle = (x: number, by: number, h = 5) => {
    R(c, x - 2, by - 1, 5, 1, BRASS[3]);
    R(c, x, by - 1 - h, 2, h, '#efe4c8'); P(c, x, by - 1 - h, '#fff8e8'); P(c, x + 1, by - 2, '#d8caa8');
    P(c, x, by - 2 - h, '#2a1a10');
    lamps.push({ kind: 'candle', x: x + 0.5, y: by - 3 - h });
  };
  const hang = (x: number, y0: number, y1: number) => { for (let y = y0; y <= y1; y++) P(c, x, y, y % 2 ? IRON[3] : IRON[4]); };
  if (kind === 'lanterns') {
    for (const [x, len] of [[up.has('shieldframe') ? 108 : 128, 10], [228, 14]] as [number, number][]) {
      hang(x, CEIL, CEIL + len);
      const y = CEIL + len + 1;
      R(c, x - 3, y, 7, 1, BRASS[3]); R(c, x - 2, y - 1, 5, 1, BRASS[4]);
      R(c, x - 3, y + 1, 7, 7, BRASS[2]);
      R(c, x - 2, y + 1, 5, 6, '#ffd890');
      V(c, x, y + 1, y + 6, BRASS[2]);
      R(c, x - 3, y + 8, 7, 1, BRASS[3]); P(c, x, y + 9, BRASS[4]);
      lamps.push({ kind: 'lantern', x: x + 0.5, y: y + 4 });
    }
  } else if (kind === 'chandelier') {
    const x = 190, y = 26;
    for (const dx of [-11, 0, 11]) L(c, x, 9, x + dx, y, IRON[3]);
    HL(c, x - 12, x + 12, y, IRON[3]); HL(c, x - 11, x + 11, y + 1, IRON[2]);
    P(c, x, y + 2, IRON[3]); P(c, x, y + 3, IRON[4]);
    for (const dx of [-12, -6, 0, 6, 12]) {
      R(c, x + dx - 1, y - 1, 3, 1, IRON[4]);
      R(c, x + dx, y - 4, 1, 3, '#efe4c8');
      lamps.push({ kind: 'chandelier', x: x + dx + 0.5, y: y - 6 });
    }
  } else if (kind === 'fireflyjars') {
    const jarAt = (x: number, by: number, hangLen = 0) => {
      if (hangLen) hang(x + 3, CEIL, CEIL + hangLen);
      R(c, x, by - 9, 7, 9, 'rgba(180,220,200,0.35)');
      V(c, x, by - 9, by - 1, 'rgba(220,255,240,0.5)'); V(c, x + 6, by - 9, by - 1, 'rgba(120,160,150,0.5)');
      HL(c, x, x + 6, by - 1, 'rgba(120,160,150,0.6)');
      R(c, x + 1, by - 11, 5, 2, '#a88a5a'); HL(c, x + 1, x + 5, by - 11, '#c8a870');
      P(c, x + 1, by - 8, 'rgba(255,255,255,0.6)');
      lamps.push({ kind: 'jar', x: x + 3.5, y: by - 5 });
    };
    if (!glassbloom) jarAt(52, 62); else jarAt(57, 62);
    jarAt(up.has('shieldframe') ? 105 : 125, CEIL + 22, 10);
    jarAt(110, 92);
  } else if (kind === 'crystallamps') {
    const crystal = (x: number, by: number) => {
      R(c, x - 2, by - 2, 5, 2, BRASS[2]); HL(c, x - 2, x + 2, by - 2, BRASS[4]);
      const pts: [number, number, string][] = [[0, -3, '#9af0b0'], [0, -4, '#c8ffd4'], [-1, -4, '#6ad890'], [1, -4, '#7ae0a0'], [0, -5, '#e8ffe8'], [-1, -5, '#5ac880'], [1, -6, '#8ae8a8'], [0, -6, '#b8ffcc'], [0, -7, '#e8ffee'], [-1, -3, '#4ab070'], [1, -3, '#5ac080']];
      for (const [dx, dy, col] of pts) P(c, x + dx, by + dy, col);
      lamps.push({ kind: 'crystal', x: x + 0.5, y: by - 5 });
    };
    crystal(68, 92); crystal(114, 92);
    if (!glassbloom) crystal(59, 62);
    // a wall sconce by the journal
    R(c, 229, 58, 2, 6, BRASS[2]); P(c, 230, 57, BRASS[4]);
    crystal(230, 58);
  } else {
    // candles
    candle(67, 92, 4); candle(115, 92, 6);
    if (!glassbloom) candle(60, 62, 5);
    candle(151, 110, 3);
  }
  return lamps;
}

// ============================================================ assembly
function layer(id: StationId, art: Rect, bg: C2D, outlines: Map<StationId, Outline>, draw: (c: C2D) => void, target: C2D = bg) {
  const pad = 3;
  const [cv, cx] = makeCanvas(art.w + pad * 2, art.h + pad * 2);
  cx.translate(-art.x + pad, -art.y + pad);
  draw(cx);
  cx.setTransform(1, 0, 0, 1, 0, 0);
  target.drawImage(cv, art.x - pad, art.y - pad);
  // outline ring (1px) for highlighting
  const [oc, ox] = makeCanvas(cv.width, cv.height);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ox.drawImage(cv, dx, dy);
  ox.globalCompositeOperation = 'source-in';
  ox.fillStyle = '#ffe2a0';
  ox.fillRect(0, 0, oc.width, oc.height);
  ox.globalCompositeOperation = 'destination-out';
  ox.drawImage(cv, 0, 0);
  outlines.set(id, { c: oc, x: art.x - pad, y: art.y - pad });
}

export function bgKey(i: BgInput): string {
  const d = i.decor;
  const items = i.displayItems.map((it) => it.id + '.' + it.finish?.finish + '.' + it.materials?.primary).join(',');
  const mat = Math.round(18 * (1 - Math.exp(-Math.max(0, i.materialCount) / 18)));
  return [d.wall, d.floor, d.lighting, d.window, d.forge, d.shelves, [...i.extras].sort().join('+'), [...i.upgrades].sort().join('+'), items, i.season, mat, i.bannerColor].join('|');
}

export function buildBackground(i: BgInput): BgResult {
  const [bg, c] = makeCanvas(W, H);
  const d = i.decor;
  const ex = i.extras, up = i.upgrades;
  const gallery = up.has('collectionroom');
  const stations = stationDefs(gallery, d.shelves);
  const win = windowGeo(d.window);
  const mouth = forgeMouth(d.forge);
  const outlines = new Map<StationId, Outline>();

  paintWallFloor(c, d.wall, d.floor);
  drawCeiling(c);
  drawPosts(c, gallery);
  // contact shadows along the wall base
  for (const [x0, x1] of [[34, 64], [66, 117], [148, 190], [190, 233], [234, 259], [259, 305]]) {
    R(c, x0, BASE, x1 - x0, 1, 'rgba(10,5,2,0.4)');
    R(c, x0 + 1, BASE + 1, x1 - x0 - 2, 1, 'rgba(10,5,2,0.2)');
  }
  if (ex.has('rug')) drawRug(c);
  drawWindow(c, win, i.season, ex.has('plants'));
  if (up.has('shieldframe')) drawShieldFrame(c);
  if (ex.has('banner')) drawBanner(c, i.bannerColor);
  if (ex.has('bookshelf')) drawBookshelf(c);
  const clock = ex.has('clock') ? drawClockCase(c) : undefined;

  const doorPane = { x: 13, y: 92, w: 10, h: 8 };
  drawMat(c);
  layer('door', { x: 3, y: 76, w: 34, h: 52 }, c, outlines, (cx) => { drawDoor(cx); });
  layer('storage', { x: 33, y: 60, w: 33, h: 68 }, c, outlines, (cx) => drawStorage(cx, i.materialCount, !ex.has('glassbloom')));
  layer('forge', { x: 60, y: 0, w: 66, h: 128 }, c, outlines, (cx) => drawForge(cx, d.forge, up, mouth));
  let wheel: BgResult['wheel'];
  layer('finishing', { x: 146, y: 88, w: 46, h: 40 }, c, outlines, (cx) => { wheel = drawFinishing(cx, up); });
  layer('workbench', { x: 186, y: 64, w: 48, h: 64 }, c, outlines, (cx) => drawWorkbench(cx, up));
  let journalCandle = { x: 236.5, y: 98 };
  layer('journal', { x: 233, y: 90, w: 30, h: 38 }, c, outlines, (cx) => { journalCandle = drawJournal(cx); });
  const dispArt = d.shelves === 'cabinet' ? { x: 258, y: 21, w: 49, h: 107 } : { x: 260, y: d.shelves === 'rack2' ? 29 : 45, w: 45, h: d.shelves === 'rack2' ? 85 : 63 };
  layer('display', dispArt, c, outlines, (cx) => drawDisplay(cx, d.shelves, i.displayItems));
  if (gallery) layer('gallery', { x: 302, y: 64, w: 18, h: 64 }, c, outlines, (cx) => drawGallery(cx));

  const glassbloom = ex.has('glassbloom') ? drawGlassbloomPlanter(c) : undefined;
  const lamps = drawLighting(c, d.lighting, ex.has('glassbloom'), up);

  // front layer: anvil
  const [front, fc] = makeCanvas(W, H);
  layer('anvil', { x: 116, y: 112, w: 40, h: 37 }, c, outlines, (cx) => drawAnvilLayer(cx), fc);

  const res: BgResult = {
    bg, front, outlines, stations, win, mouth, lamps, journalCandle, wheel, clock, doorPane,
    chimes: ex.has('chimes') ? { x: 26, y: CEIL } : undefined,
    glassbloom,
    cat: ex.has('cat') ? { x: 103, y: 136 } : undefined,
    dragonEyes: d.forge === 'dragonmaw' ? [{ x: 81, y: 98 }, { x: 101, y: 98 }] : undefined,
  };
  return res;
}

