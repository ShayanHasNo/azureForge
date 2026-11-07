// Component assembly. Three modes (params.mode):
//
//  hilt  — fit the guard, then the pommel, onto the tang. Each component hovers
//          and sways gently; drag it (anywhere — drag is relative) or use the
//          arrows to bring its connection point onto the glowing socket, level
//          it with Q/E, the mouse wheel or the on-screen rotate buttons, then
//          seat it (Space / Enter / "Seat" button) with a snap. The residual
//          error at the moment you seat it — sway included — is what gets built.
//  inlay — Mountain stone setting: params.count stones (default 4) of types
//          params.stones (default ['riverstone','slate']). Sockets sit on the
//          blade at seeded positions (t 0.08..0.6, u -0.4..0.4); each stone
//          arrives turned at random. Rotate it to match, then drop it into the
//          socket with the matching shape (release the drag, or Space).
//  rim   — shields: the rim ring sways over the face; align its marker with
//          each lit pin hole in turn and seat it there. The ring flexes a little
//          after every pin, so each point needs its own alignment.
//
// Sprite pieces are extracted by difference rendering (e.g. the item with the
// guard moved off-canvas vs. the full item), so components look exactly like
// the renderer's. Errors are measured in sprite pixels.
//
// data: hilt  → { guardOffset: int -3..3, guardTilt: int -3..3, pommelOffset: int -2..2 }
//       inlay → { stones: [{ t, u, stone, rot }] } (t,u where actually placed; rot -1..1)
//       rim   → { rimGap: number -3..3 }
// details: position, rotation (+ care for inlay, seats for rim)

import { seededRng } from '../core/rng';
import { clamp, mean } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { cloneItem } from '../item/factory';
import type { Item } from '../item/types';
import { bladeLayout, bladePixel, bladeRow, shieldLayout } from '../render/itemRenderer';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

type Mode = 'hilt' | 'inlay' | 'rim';
type V = [number, number];

// ------------------------------------------------------------ sprite <-> screen
interface Xf { cx: number; cy: number; s: number; rot: boolean; W: number; H: number }
/** Cell-space sprite point (cell (x,y) spans [x,x+1)) → screen. */
function s2scr(xf: Xf, sx: number, sy: number): V {
  const lx = (sx - xf.W / 2) * xf.s, ly = (sy - xf.H / 2) * xf.s;
  return xf.rot ? [xf.cx - ly, xf.cy + lx] : [xf.cx + lx, xf.cy + ly];
}
function scr2s(xf: Xf, x: number, y: number): V {
  const dx = (x - xf.cx) / xf.s, dy = (y - xf.cy) / xf.s;
  return xf.rot ? [xf.W / 2 + dy, xf.H / 2 - dx] : [xf.W / 2 + dx, xf.H / 2 + dy];
}
/** Renderer-style coordinate (pixel = Math.round(coord)) ↔ screen. */
const spriteToScreen = (xf: Xf, x: number, y: number) => s2scr(xf, x + 0.5, y + 0.5);
const screenToSprite = (xf: Xf, X: number, Y: number): V => { const [a, b] = scr2s(xf, X, Y); return [a - 0.5, b - 0.5]; };

function drawXf(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, xf: Xf, dx = 0, dy = 0) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(xf.cx + dx), Math.round(xf.cy + dy));
  if (xf.rot) ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -(xf.W * xf.s) / 2, -(xf.H * xf.s) / 2, xf.W * xf.s, xf.H * xf.s);
  ctx.restore();
}

function pixels(c: HTMLCanvasElement): Uint8ClampedArray | null {
  try { return c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? null; } catch { return null; }
}
/** Pixels of `a` that differ from `b` (the part that `b` lacks). */
function diffCanvas(a: HTMLCanvasElement, b: HTMLCanvasElement): { canvas: HTMLCanvasElement; count: number } {
  const out = document.createElement('canvas');
  out.width = a.width; out.height = a.height;
  const pa = pixels(a), pb = pixels(b), octx = out.getContext('2d');
  if (!pa || !pb || !octx || a.width !== b.width || a.height !== b.height) return { canvas: out, count: 0 };
  const img = octx.createImageData(a.width, a.height);
  let count = 0;
  for (let i = 0; i < pa.length; i += 4) {
    if (pa[i + 3] < 10) continue;
    if (pa[i] === pb[i] && pa[i + 1] === pb[i + 1] && pa[i + 2] === pb[i + 2] && pa[i + 3] === pb[i + 3]) continue;
    img.data[i] = pa[i]; img.data[i + 1] = pa[i + 1]; img.data[i + 2] = pa[i + 2]; img.data[i + 3] = pa[i + 3];
    count++;
  }
  octx.putImageData(img, 0, 0);
  return { canvas: out, count };
}

const DEG = Math.PI / 180;
const wrapAngle = (a: number) => { a = (a + Math.PI) % (Math.PI * 2); if (a < 0) a += Math.PI * 2; return a - Math.PI; };
/** Accuracy from an error and tolerance: perfect within 15% of tol, 0 beyond 1.15 tol. */
const accOf = (err: number, tol: number) => clamp(1 - Math.max(0, err - tol * 0.15) / Math.max(1e-6, tol));

interface Comp {
  name: 'guard' | 'pommel';
  img: HTMLCanvasElement | null;
  conn: V; // cell-space connection point in the sprite
  target: V; // screen
  pos: V; // screen, player-controlled
  ang: number; // radians, player-controlled
  phase: number;
  seated: boolean;
  seatPos: V;
  seatAng: number;
  anim: number;
  res: { dx: number; dy: number; ang: number };
}

interface Socket { t: number; u: number; pos: V; shape: V[]; ang: number; filled: boolean; type: string }
interface Stone { type: string; socket: number; pos: V; ang: number; placed: boolean; res?: { t: number; u: number; rot: number; posErr: number; rotErr: number } }

interface Btn { id: 'rotL' | 'rotR' | 'seat'; x: number; y: number; w: number; h: number; label: string }

class Assembly extends BaseMinigame {
  private mode: Mode;
  private readonly isShield: boolean;
  private xf!: Xf;
  private rng = seededRng(this.env.item.seed, 'assembly');
  private baseCanvas!: HTMLCanvasElement;
  private finalCanvas: HTMLCanvasElement | null = null;
  // input
  private pressBtn: Btn['id'] | null = null;
  private dragging = false;
  private dragMoved = 0;
  private dragStart: V = [0, 0];
  private posStart: V = [0, 0];
  private kbHold = 0;
  private wheelQueue = 0;
  private wheelHandler: (e: WheelEvent) => void;
  private btnHold = 0;
  private hintCool = 0;
  private swayA: number;
  private swayR: number;
  private tolPos: number;
  private tolRot: number;
  // hilt
  private comps: Comp[] = [];
  private ci = 0;
  private gw = 4;
  // inlay
  private sockets: Socket[] = [];
  private stones: Stone[] = [];
  private si = 0;
  private stoneR = 9;
  private care = 1;
  private hintMatch: boolean;
  // rim
  private rimImg: HTMLCanvasElement | null = null;
  private rimOff: V = [0, 0];
  private rimSeats: { ang: number; done: boolean; res?: V }[] = [];
  private rimIdx = 0;
  private rimEdge: (a: number) => V = () => [0, 0];
  private rimPins = 0;

  constructor(env: MinigameEnv) {
    super(env);
    this.isShield = env.item.category === 'shield' || !env.item.blade;
    const m = env.params.mode;
    if (this.isShield) this.mode = m === 'inlay' ? 'inlay' : 'rim';
    else this.mode = m === 'inlay' ? 'inlay' : 'hilt';
    if (this.isShield && !env.item.shield) this.mode = 'inlay';
    this.swayA = this.tune(0.5, 1.5) * (env.quirk === 'drifting' ? 1.7 : 1);
    this.swayR = this.tune(1.2, 3.2) * DEG;
    this.tolPos = this.tune(3, 1.3) * (env.quirk === 'bursts' ? 1.25 : 1);
    this.tolRot = this.tune(7, 3) * DEG;
    this.hintMatch = env.difficulty < 1.5;
    this.wheelHandler = (e: WheelEvent) => { e.preventDefault(); this.wheelQueue += Math.sign(e.deltaY); };
    env.canvas.addEventListener('wheel', this.wheelHandler, { passive: false });
    if (this.mode === 'hilt') this.setupHilt();
    else if (this.mode === 'inlay') this.setupInlay();
    else this.setupRim();
    env.onStatus?.(this.statusText());
  }

  // ------------------------------------------------------------ setup
  private setupHilt() {
    const item = this.env.item;
    const lay = bladeLayout(item);
    const h = item.hilt!;
    const clean = (go: number, po: number): Item => {
      const c = cloneItem(item);
      c.hilt!.guardOffset = go; c.hilt!.pommelOffset = po; c.hilt!.guardTilt = 0;
      return c;
    };
    const AWAY = 400;
    const full = this.sprite(clean(0, 0));
    const noGuard = this.sprite(clean(AWAY, 0));
    const noPommel = this.sprite(clean(0, AWAY));
    this.baseCanvas = this.sprite(clean(AWAY, AWAY));
    const W = full.width, H = full.height;
    const s = 3;
    const gConn: V = [lay.cx + 0.5, lay.guardTop + lay.guardH / 2];
    const pConn: V = [lay.cx + 0.5, lay.pommelCy + 0.5];
    this.xf = { cx: Math.round(240 - (gConn[0] - W / 2) * s), cy: Math.round(100 - (gConn[1] - H / 2) * s), s, rot: false, W, H };
    let gw = h.guardWidth;
    if (h.guard === 'disc') gw *= 0.6;
    if (h.guard === 'knot') gw *= 0.75;
    if (h.guard === 'stub') gw = Math.max(3, gw * 0.42);
    this.gw = Math.max(2, gw);
    const g = diffCanvas(full, noGuard), p = diffCanvas(full, noPommel);
    const mk = (name: Comp['name'], img: HTMLCanvasElement | null, conn: V): Comp => {
      const target = s2scr(this.xf, conn[0], conn[1]);
      const side = this.rng.chance(0.5) ? 1 : -1;
      const pos: V = [target[0] + side * this.rng.range(50, 80), target[1] - this.rng.range(14, 30)];
      const ang = (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(7, 16) * DEG;
      return { name, img, conn, target, pos, ang, phase: this.rng.range(0, 6.28), seated: false, seatPos: target, seatAng: 0, anim: 0, res: { dx: 0, dy: 0, ang: 0 } };
    };
    this.comps = [mk('guard', g.count ? g.canvas : null, gConn), mk('pommel', p.count ? p.canvas : null, pConn)];
  }

  private setupInlay() {
    const item = this.env.item;
    const n = clamp(Math.round(Number(this.env.params.count ?? 4)) || 4, 1, 8);
    const rawTypes = Array.isArray(this.env.params.stones) ? this.env.params.stones.map(String).filter((x: string) => x) : [];
    const types: string[] = rawTypes.length ? rawTypes : ['riverstone', 'slate'];
    this.baseCanvas = this.sprite(item);
    const W = this.baseCanvas.width, H = this.baseCanvas.height;
    if (this.isShield) {
      const sl = this.shieldGeo();
      const s = 2;
      this.xf = { cx: Math.round(200 - (sl.cx + 0.5 - W / 2) * s), cy: Math.round(128 - (sl.cy + 0.5 - H / 2) * s), s, rot: false, W, H };
      this.stoneR = 8;
    } else {
      const L = Math.max(1, item.blade!.length);
      const s = clamp(Math.floor(400 / (0.62 * L)), 3, 6);
      const [mx, my] = bladePixel(item, 0.34, 0);
      this.xf = { cx: Math.round(240 + (my + 0.5 - H / 2) * s), cy: Math.round(110 - (mx + 0.5 - W / 2) * s), s, rot: true, W, H };
      this.stoneR = Math.max(8, 1.8 * s);
    }
    for (let i = 0; i < n; i++) {
      let t: number, u: number;
      if (this.isShield) { t = (i + this.rng.range(0.3, 0.7)) / n; u = 0; }
      else { t = 0.08 + ((i + this.rng.range(0.2, 0.8)) / n) * 0.52; u = (i % 2 ? 1 : -1) * this.rng.range(0.1, 0.4); }
      const verts = this.rng.int(5, 6);
      const shape: V[] = [];
      for (let k = 0; k < verts; k++) {
        const a = (k / verts) * Math.PI * 2 + this.rng.range(-0.25, 0.25);
        const r = this.rng.range(0.6, 1.0);
        shape.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      // break symmetry: one long "point"
      const kp = this.rng.int(0, verts - 1);
      const rp = Math.hypot(shape[kp][0], shape[kp][1]) || 1;
      shape[kp] = [(shape[kp][0] / rp) * 1.18, (shape[kp][1] / rp) * 1.18];
      this.sockets.push({ t, u, pos: this.tuToScreen(t, u), shape, ang: this.rng.range(0, Math.PI * 2), filled: false, type: types[i % types.length] });
    }
    const order = this.rng.shuffle(this.sockets.map((_, i) => i));
    this.stones = order.map((si) => ({ type: this.sockets[si].type, socket: si, pos: this.trayPos(), ang: this.sockets[si].ang + (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(35, 110) * DEG, placed: false }));
  }

  private setupRim() {
    const item = this.env.item;
    const sh = item.shield!;
    const full = cloneItem(item); full.shield!.rimGap = 0;
    const bare = cloneItem(item); bare.shield!.rimGap = 0; bare.shield!.rim = 0;
    const fullC = this.sprite(full);
    this.baseCanvas = this.sprite(bare);
    const d = diffCanvas(fullC, this.baseCanvas);
    this.rimImg = d.count ? d.canvas : null;
    const W = fullC.width, H = fullC.height;
    const sl = shieldLayout(item);
    const s = 2;
    this.xf = { cx: Math.round(200 - (sl.cx + 0.5 - W / 2) * s), cy: Math.round(128 - (sl.cy + 0.5 - H / 2) * s), s, rot: false, W, H };
    // boundary of the face along a ray (from the bare sprite's alpha)
    const px = pixels(this.baseCanvas);
    const opaque = (x: number, y: number) => {
      const ix = Math.round(x), iy = Math.round(y);
      if (ix < 0 || iy < 0 || ix >= W || iy >= H) return false;
      return px ? px[(iy * W + ix) * 4 + 3] > 20 : ((x - sl.cx) / sl.rx) ** 2 + ((y - sl.cy) / sl.ry) ** 2 <= 1;
    };
    const rimW = Math.max(1, sh.rim);
    this.rimEdge = (a: number): V => {
      let rr = 1;
      for (let it = 0; it < 60 && rr > 0.2; it++) { if (!opaque(sl.cx + Math.cos(a) * sl.rx * rr, sl.cy + Math.sin(a) * sl.ry * rr)) rr -= 0.015; else break; }
      const x = sl.cx + Math.cos(a) * (sl.rx * rr - rimW / 2), y = sl.cy + Math.sin(a) * (sl.ry * rr - rimW / 2);
      return spriteToScreen(this.xf, x, y);
    };
    const k = Math.round(this.tune(4, 6));
    const a0 = -Math.PI / 2 + this.rng.range(-0.2, 0.2);
    for (let i = 0; i < k; i++) this.rimSeats.push({ ang: a0 + (i / k) * Math.PI * 2 + this.rng.range(-0.12, 0.12), done: false });
    const mag = this.rng.range(5, 9) * s;
    const a = this.rng.range(0, Math.PI * 2);
    this.rimOff = [Math.cos(a) * mag, Math.sin(a) * mag];
  }

  private shieldGeo() {
    const it = this.env.item;
    if (it.shield) return shieldLayout(it);
    return { cx: 43.5, cy: 51, rx: 40, ry: 46, W: 88, H: 104 };
  }

  private tuToScreen(t: number, u: number): V {
    if (this.isShield) {
      const sl = this.shieldGeo();
      const a = t * Math.PI * 2;
      return spriteToScreen(this.xf, sl.cx + Math.cos(a) * sl.rx * 0.5, sl.cy + Math.sin(a) * sl.ry * 0.5);
    }
    const [x, y] = bladePixel(this.env.item, t, u);
    return spriteToScreen(this.xf, x, y);
  }

  /** Screen → blade-local (t,u), the inverse of bladePixel (shields: angle around the face). */
  private screenToTU(X: number, Y: number): V {
    const [sx, sy] = screenToSprite(this.xf, X, Y);
    if (this.isShield) {
      const sl = this.shieldGeo();
      const a = Math.atan2((sy - sl.cy) / sl.ry, (sx - sl.cx) / sl.rx);
      return [((a / (Math.PI * 2)) + 1) % 1, 0];
    }
    const item = this.env.item;
    const lay = bladeLayout(item);
    const t = (lay.bladeBase - sy) / Math.max(1, item.blade!.length);
    const row = bladeRow(item, clamp(t));
    const d = sx - row.center;
    const w = Math.max(0.5, d < 0 ? row.L : row.R) * 0.78;
    return [clamp(t, 0.02, 0.9), clamp(d / w, -0.8, 0.8)];
  }

  private trayPos(): V {
    return this.isShield ? [400, 120] : [240, 200];
  }

  private statusText() {
    if (this.mode === 'hilt') return this.ci < this.comps.length ? `Fit the ${this.comps[this.ci].name} (${this.ci + 1}/2)` : 'Hilt assembled';
    if (this.mode === 'inlay') return `Stone ${Math.min(this.stones.length, this.si + 1)} / ${this.stones.length}`;
    return `Seat the rim — pin ${Math.min(this.rimSeats.length, this.rimIdx + 1)} / ${this.rimSeats.length}`;
  }

  // ------------------------------------------------------------ input
  private uiPointer(): V {
    return [this.mirrored ? MW - this.pointer.x : this.pointer.x, this.pointer.y];
  }
  private buttons(): Btn[] {
    const y = MH - 46, h = 22;
    const out: Btn[] = [];
    if (this.mode !== 'rim') {
      out.push({ id: 'rotL', x: MW - 206, y, w: 40, h, label: '' });
      out.push({ id: 'rotR', x: MW - 160, y, w: 40, h, label: '' });
    }
    out.push({ id: 'seat', x: MW - 112, y, w: 100, h, label: this.mode === 'inlay' ? 'Set stone' : 'Seat it' });
    return out;
  }
  private btnAt(): Btn | null {
    const [x, y] = this.uiPointer();
    for (const b of this.buttons()) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
    return null;
  }

  /** Common movement/rotation input; returns {move, rot (radians this frame), confirm}. */
  private readInput(dt: number): { move: V; rot: number; confirm: boolean; released: boolean } {
    let move: V = [0, 0];
    let rot = 0;
    let confirm = false;
    let released = false;
    if (this.pointer.justDown) {
      const b = this.btnAt();
      this.pressBtn = b ? b.id : null;
      this.btnHold = 0;
      if (b?.id === 'seat') confirm = true;
      else if (b) rot += (b.id === 'rotL' ? -1 : 1) * 1.5 * DEG * (this.mirrored ? -1 : 1);
      else { this.dragging = true; this.dragMoved = 0; this.dragStart = [this.pointer.x, this.pointer.y]; this.posStart = this.currentPos(); }
    }
    if (this.pointer.down && (this.pressBtn === 'rotL' || this.pressBtn === 'rotR')) {
      this.btnHold += dt;
      if (this.btnHold > 0.25) rot += (this.pressBtn === 'rotL' ? -1 : 1) * 30 * DEG * dt * (this.mirrored ? -1 : 1);
    }
    if (this.dragging && this.pointer.down) {
      const np: V = [this.posStart[0] + this.pointer.x - this.dragStart[0], this.posStart[1] + this.pointer.y - this.dragStart[1]];
      const cp = this.currentPos();
      this.dragMoved += Math.hypot(np[0] - cp[0], np[1] - cp[1]);
      move = [np[0] - cp[0], np[1] - cp[1]];
    }
    if (this.pointer.justUp) {
      if (this.dragging && this.dragMoved > 3) released = true;
      this.dragging = false;
      this.pressBtn = null;
    }
    // keyboard
    const ax = this.axisX(), ay = this.axisY();
    if (ax || ay) {
      this.kbHold += dt;
      const fine = this.isDown('ShiftLeft', 'ShiftRight');
      const sp = fine ? 8 : 16 + 60 * clamp(this.kbHold / 1.2);
      move = [move[0] + ax * sp * dt, move[1] + ay * sp * dt];
    } else this.kbHold = 0;
    const rk = (this.isDown('KeyE', 'KeyX') ? 1 : 0) - (this.isDown('KeyQ', 'KeyZ') ? 1 : 0);
    if (rk) rot += rk * (this.isDown('ShiftLeft', 'ShiftRight') ? 8 : 28) * DEG * dt * (this.mirrored ? -1 : 1);
    if (this.wheelQueue) { rot += this.wheelQueue * 1.5 * DEG * (this.mirrored ? -1 : 1); this.wheelQueue = 0; }
    if (this.wasPressed('Space', 'Enter')) confirm = true;
    return { move, rot, confirm, released };
  }

  private currentPos(): V {
    if (this.mode === 'hilt') return this.comps[this.ci]?.pos ?? [0, 0];
    if (this.mode === 'inlay') return this.stones[this.si]?.pos ?? [0, 0];
    const c = this.rimCentre();
    return [c[0] + this.rimOff[0], c[1] + this.rimOff[1]];
  }
  private rimCentre(): V { return [this.xf.cx, this.xf.cy]; }

  // ------------------------------------------------------------ update
  protected update(dt: number) {
    this.hintCool = Math.max(0, this.hintCool - dt);
    for (const c of this.comps) if (c.seated) c.anim = Math.min(1, c.anim + dt * 7);
    const inp = this.readInput(dt);
    if (this.mode === 'hilt') this.updateHilt(inp);
    else if (this.mode === 'inlay') this.updateInlay(inp);
    else this.updateRim(inp);
  }

  private swayOf(phase: number, k = 1): { d: V; a: number } {
    const A = this.swayA * this.xf.s * k, t = this.t;
    return { d: [Math.sin(t * 1.3 + phase) * A + Math.sin(t * 2.9 + phase * 2) * A * 0.3, Math.sin(t * 0.9 + phase + 1) * A * 0.6], a: Math.sin(t * 1.1 + phase * 1.7) * this.swayR * k };
  }

  private updateHilt(inp: { move: V; rot: number; confirm: boolean }) {
    const c = this.comps[this.ci];
    if (!c) return;
    c.pos = [clamp(c.pos[0] + inp.move[0], 20, MW - 20), clamp(c.pos[1] + inp.move[1], 20, MH - 20)];
    c.ang = clamp(c.ang + inp.rot, -0.8, 0.8);
    if (!inp.confirm) return;
    const sw = this.swayOf(c.phase);
    const disp: V = [c.pos[0] + sw.d[0], c.pos[1] + sw.d[1]];
    const ang = c.ang + sw.a;
    const s = this.xf.s;
    const dx = (disp[0] - c.target[0]) / s, dy = (disp[1] - c.target[1]) / s;
    if (Math.abs(dx) > 7 || Math.abs(dy) > 7) {
      this.env.audio.sfx('soft');
      this.floatText('Bring it onto the glowing socket', disp[0], disp[1] - 20, COLORS.paper);
      return;
    }
    c.res = { dx, dy, ang };
    c.seated = true;
    c.anim = 0;
    const lim = c.name === 'guard' ? 3 : 2;
    const ox = Math.round(clamp(dx, -lim, lim));
    const tilt = c.name === 'guard' ? Math.round(clamp(this.gw * Math.tan(ang), -3, 3)) : 0;
    c.seatPos = [c.target[0] + ox * s, c.target[1]];
    c.seatAng = Math.atan2(tilt, this.gw);
    c.pos = disp; c.ang = ang; // animate from where it actually was
    const q = this.compQuality(c);
    this.env.audio.sfx('snap', { pitch: c.name === 'guard' ? 1 : 1.15 });
    this.sparks(c.target[0], c.target[1], q > 0.85 ? 16 : 8, q > 0.85 ? COLORS.gold : COLORS.ember);
    this.shake(2);
    this.floatText(q > 0.9 ? 'Perfect fit!' : q > 0.7 ? 'Snug' : q > 0.45 ? 'A little off' : 'Askew', c.target[0], c.target[1] - 26, q > 0.9 ? COLORS.gold : q > 0.7 ? COLORS.good : COLORS.ok);
    this.ci++;
    this.env.onStatus?.(this.statusText());
    if (this.ci >= this.comps.length) this.completeHilt();
  }

  private compQuality(c: Comp): number {
    const pos = accOf(Math.hypot(c.res.dx, c.res.dy * 0.5), this.tolPos);
    const rot = accOf(Math.abs(c.res.ang), this.tolRot);
    return c.name === 'guard' ? pos * 0.6 + rot * 0.4 : pos * 0.75 + rot * 0.25;
  }

  private updateInlay(inp: { move: V; rot: number; confirm: boolean; released: boolean }) {
    const st = this.stones[this.si];
    if (!st) return;
    st.pos = [clamp(st.pos[0] + inp.move[0], 10, MW - 10), clamp(st.pos[1] + inp.move[1], 40, MH - 52)];
    st.ang += inp.rot * 1.6;
    if (!(inp.confirm || inp.released)) return;
    const sw = this.swayOf(this.si, this.env.quirk === 'drifting' ? 0.6 : 0);
    const disp: V = [st.pos[0] + sw.d[0], st.pos[1] + sw.d[1]];
    // nearest open socket
    let best = -1, bd = Infinity;
    this.sockets.forEach((so, i) => {
      if (so.filled) return;
      const d = Math.hypot(so.pos[0] - disp[0], so.pos[1] - disp[1]);
      if (d < bd) { bd = d; best = i; }
    });
    if (best < 0 || bd > this.stoneR * 1.7) {
      if (inp.confirm && this.hintCool <= 0) { this.hintCool = 0.8; this.floatText('Drop it into a socket', disp[0], disp[1] - 16, COLORS.paper); }
      return;
    }
    if (best !== st.socket) {
      this.care = Math.max(0, this.care - 0.06);
      this.env.audio.sfx('soft');
      this.floatText('Not this shape', disp[0], disp[1] - 16, COLORS.ok);
      st.pos = this.trayPos();
      return;
    }
    const so = this.sockets[best];
    const s = this.xf.s;
    const posErr = bd / s; // sprite px
    const rotErr = wrapAngle(st.ang + sw.a - so.ang);
    const [t, u] = this.screenToTU(disp[0], disp[1]);
    st.res = { t, u, rot: clamp(rotErr / (Math.PI / 4), -1, 1), posErr, rotErr };
    st.pos = disp;
    st.placed = true;
    so.filled = true;
    const q = this.stoneQuality(st);
    this.env.audio.sfx('stone', { pitch: 0.9 + Math.random() * 0.2 });
    this.env.audio.sfx('snap', { volume: 0.5 });
    this.sparks(disp[0], disp[1], q > 0.85 ? 12 : 6, q > 0.85 ? COLORS.gold : '#c0b090');
    this.floatText(q > 0.9 ? 'Seated true' : q > 0.7 ? 'Nicely set' : q > 0.45 ? 'A touch crooked' : 'Rough fit', disp[0], disp[1] - 18, q > 0.9 ? COLORS.gold : q > 0.7 ? COLORS.good : COLORS.ok);
    this.si++;
    this.env.onStatus?.(this.statusText());
    if (this.si >= this.stones.length) this.completeInlay();
  }

  private stoneQuality(st: Stone): number {
    if (!st.res) return 0;
    const pos = accOf(st.res.posErr, this.tune(1.4, 0.6) * (this.isShield ? 1.6 : 1));
    const rot = accOf(Math.abs(st.res.rotErr), this.tune(14, 6) * DEG);
    return pos * 0.55 + rot * 0.45;
  }

  private updateRim(inp: { move: V; rot: number; confirm: boolean }) {
    const seat = this.rimSeats[this.rimIdx];
    if (!seat) return;
    this.rimOff = [clamp(this.rimOff[0] + inp.move[0], -60, 60), clamp(this.rimOff[1] + inp.move[1], -60, 60)];
    if (!inp.confirm) return;
    const sw = this.swayOf(0.7, 1 - 0.08 * this.rimPins);
    const off: V = [(this.rimOff[0] + sw.d[0]) / this.xf.s, (this.rimOff[1] + sw.d[1]) / this.xf.s];
    if (Math.hypot(off[0], off[1]) > 9) {
      this.env.audio.sfx('soft');
      const p = this.rimEdge(seat.ang);
      this.floatText('Line up the markers first', p[0], p[1] - 14, COLORS.paper);
      return;
    }
    seat.done = true;
    seat.res = off;
    this.rimPins++;
    const q = this.rimSeatQuality(seat);
    const p = this.rimEdge(seat.ang);
    this.env.audio.sfx('snap', { pitch: 0.95 + this.rimIdx * 0.04 });
    this.sparks(p[0], p[1], q > 0.85 ? 12 : 6, q > 0.85 ? COLORS.gold : COLORS.ember);
    this.shake(1.5);
    this.floatText(q > 0.9 ? 'Flush!' : q > 0.7 ? 'Tight' : q > 0.45 ? 'Small gap' : 'Gappy', p[0], p[1] - 16, q > 0.9 ? COLORS.gold : q > 0.7 ? COLORS.good : COLORS.ok);
    this.rimIdx++;
    this.env.onStatus?.(this.statusText());
    if (this.rimIdx >= this.rimSeats.length) { this.completeRim(); return; }
    // the ring flexes a little after each pin
    const a = this.rng.range(0, Math.PI * 2), m = this.tune(2.5, 5) * this.xf.s;
    this.rimOff = [this.rimOff[0] + Math.cos(a) * m, this.rimOff[1] + Math.sin(a) * m];
  }

  private rimSeatQuality(seat: { ang: number; res?: V }): number {
    if (!seat.res) return 0;
    const n: V = [Math.cos(seat.ang), Math.sin(seat.ang)];
    const radial = seat.res[0] * n[0] + seat.res[1] * n[1];
    const tang = -seat.res[0] * n[1] + seat.res[1] * n[0];
    return accOf(Math.hypot(radial, tang * 0.5), this.tune(2.5, 1.2) * (this.env.quirk === 'bursts' ? 1.25 : 1));
  }

  // ------------------------------------------------------------ completion
  private completeHilt() {
    const [g, p] = this.comps;
    const gq = this.compQuality(g), pq = this.compQuality(p);
    const score = (gq + pq) / 2;
    const guardOffset = Math.round(clamp(g.res.dx, -3, 3));
    const guardTilt = Math.round(clamp(this.gw * Math.tan(g.res.ang), -3, 3));
    const pommelOffset = Math.round(clamp(p.res.dx, -2, 2));
    const position = mean(this.comps.map((c) => accOf(Math.hypot(c.res.dx, c.res.dy * 0.5), this.tolPos)));
    const rotation = mean(this.comps.map((c) => accOf(Math.abs(c.res.ang), this.tolRot)));
    const fin = cloneItem(this.env.item);
    fin.hilt!.guardOffset = guardOffset; fin.hilt!.guardTilt = guardTilt; fin.hilt!.pommelOffset = pommelOffset;
    this.finalCanvas = this.sprite(fin);
    const grade = gradeOf(score);
    const off = Math.abs(guardOffset) + Math.abs(guardTilt) + Math.abs(pommelOffset);
    this.env.audio.sfx('success');
    this.finish({
      score,
      details: { position, rotation, guard: gq, pommel: pq },
      data: { guardOffset, guardTilt, pommelOffset },
      summary: `${grade} assembly — ${off === 0 ? 'guard and pommel sit dead true' : guardTilt ? 'the guard sits with a slight tilt' : 'fittings a hair off-centre, but solid'}.`,
    }, 1.6);
  }

  private completeInlay() {
    const qs = this.stones.map((s) => this.stoneQuality(s));
    const score = mean(qs) * 0.92 + this.care * 0.08;
    const stones = this.stones.map((s) => ({ t: round3(s.res?.t ?? this.sockets[s.socket].t), u: round3(s.res?.u ?? this.sockets[s.socket].u), stone: s.type, rot: round3(s.res?.rot ?? 0) }));
    const position = mean(this.stones.map((s) => accOf(s.res?.posErr ?? 9, this.tune(1.4, 0.6) * (this.isShield ? 1.6 : 1))));
    const rotation = mean(this.stones.map((s) => accOf(Math.abs(s.res?.rotErr ?? 1), this.tune(14, 6) * DEG)));
    const fin = cloneItem(this.env.item);
    fin.decoration.stones = stones;
    this.finalCanvas = this.sprite(fin);
    const grade = gradeOf(score);
    this.env.audio.sfx('success');
    this.finish({
      score,
      details: { position, rotation, care: this.care, stones: stones.length },
      data: { stones },
      summary: `${grade} stone setting — ${rotation > 0.8 ? 'every stone turned true in its bed' : rotation > 0.55 ? 'stones mostly well turned' : 'stones set with a rugged, crooked charm'}.`,
    }, 1.6);
  }

  private completeRim() {
    const qs = this.rimSeats.map((s) => this.rimSeatQuality(s));
    const score = mean(qs);
    const rimGap = Math.round(clamp(mean(this.rimSeats.map((s) => s.res?.[0] ?? 0)), -3, 3) * 100) / 100;
    const fin = cloneItem(this.env.item);
    fin.shield!.rimGap = Math.round(rimGap);
    this.finalCanvas = this.sprite(fin);
    const grade = gradeOf(score);
    this.env.audio.sfx('success');
    this.finish({
      score,
      details: { position: score, seats: this.rimSeats.length },
      data: { rimGap },
      summary: `${grade} rim fitting — ${Math.abs(rimGap) < 0.5 ? 'the rim hugs the face all the way round' : 'a small gap shows along one side'}.`,
    }, 1.6);
  }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.55, '#30241c');
    ctx.fillStyle = 'rgba(64,46,34,0.55)';
    ctx.fillRect(16, 40, MW - 32, 180);
    if (this.finished && this.finalCanvas) {
      drawXf(ctx, this.finalCanvas, this.xf);
      return;
    }
    if (this.mode === 'hilt') this.drawHilt(ctx);
    else if (this.mode === 'inlay') this.drawInlay(ctx);
    else this.drawRim(ctx);
  }

  private drawComp(ctx: CanvasRenderingContext2D, c: Comp, pos: V, ang: number) {
    const s = this.xf.s;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(pos[0], pos[1]);
    ctx.rotate(ang);
    if (c.img) ctx.drawImage(c.img, -c.conn[0] * s, -c.conn[1] * s, this.xf.W * s, this.xf.H * s);
    else {
      // fallback silhouette
      const col = hasMat(this.env.item.materials.secondary) ? mat(this.env.item.materials.secondary).palette[3] : '#c0a060';
      ctx.fillStyle = col;
      if (c.name === 'guard') ctx.fillRect(-this.gw * s, -2 * s, this.gw * 2 * s, 4 * s);
      else { ctx.beginPath(); ctx.arc(0, 0, 4 * s, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.restore();
  }

  private drawHilt(ctx: CanvasRenderingContext2D) {
    drawXf(ctx, this.baseCanvas, this.xf);
    const cur = this.comps[this.ci];
    // socket glow
    if (cur) {
      const [tx, ty] = cur.target;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
      const flick = this.env.quirk === 'flicker' && Math.sin(this.t * 6) > 0.5;
      if (!flick) {
        const g = ctx.createRadialGradient(tx, ty, 1, tx, ty, 16);
        g.addColorStop(0, `rgba(255,210,120,${0.45 + 0.3 * pulse})`);
        g.addColorStop(1, 'rgba(255,210,120,0)');
        ctx.fillStyle = g;
        ctx.fillRect(tx - 16, ty - 16, 32, 32);
        // level guide
        ctx.fillStyle = 'rgba(255,230,170,0.35)';
        ctx.fillRect(tx - 70, ty, 50, 1);
        ctx.fillRect(tx + 20, ty, 50, 1);
        ctx.fillRect(tx, ty - 22, 1, 10);
      }
    }
    for (const c of this.comps) {
      if (c.seated) {
        const k = c.anim;
        const p: V = [c.pos[0] + (c.seatPos[0] - c.pos[0]) * k, c.pos[1] + (c.seatPos[1] - c.pos[1]) * k];
        this.drawComp(ctx, c, p, c.ang + (c.seatAng - c.ang) * k);
      }
    }
    if (cur) {
      const sw = this.swayOf(cur.phase);
      const p: V = [cur.pos[0] + sw.d[0], cur.pos[1] + sw.d[1]];
      // shadow
      ctx.globalAlpha = 0.25;
      this.drawComp(ctx, cur, [p[0] + 3, p[1] + 5], cur.ang + sw.a);
      ctx.globalAlpha = 1;
      this.drawComp(ctx, cur, p, cur.ang + sw.a);
      // its connection point
      ctx.fillStyle = COLORS.cream;
      ctx.fillRect(Math.round(p[0]) - 1, Math.round(p[1]) - 1, 2, 2);
      // a level bubble beside it
      this.drawLevel(ctx, p[0], p[1] - 34, cur.ang + sw.a);
    }
  }

  private drawLevel(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number) {
    x = Math.round(x); y = Math.round(y);
    ctx.fillStyle = 'rgba(20,14,10,0.7)';
    ctx.fillRect(x - 20, y - 3, 40, 7);
    ctx.fillStyle = 'rgba(160,220,140,0.35)';
    ctx.fillRect(x - 18, y - 1, 36, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(x - 1, y - 2, 1, 5);
    const bx = clamp(ang / (12 * DEG), -1, 1) * 15;
    ctx.fillStyle = Math.abs(ang) < this.tolRot * 0.3 ? COLORS.good : COLORS.cream;
    ctx.fillRect(Math.round(x + bx) - 2, y - 1, 4, 3);
  }

  private stonePoly(ctx: CanvasRenderingContext2D, shape: V[], pos: V, ang: number, r: number) {
    ctx.beginPath();
    shape.forEach(([sx, sy], k) => {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const x = pos[0] + (sx * ca - sy * sa) * r, y = pos[1] + (sx * sa + sy * ca) * r;
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }

  private stonePal(type: string): string[] {
    return hasMat(type) ? mat(type).palette : mat('riverstone').palette;
  }

  private drawInlay(ctx: CanvasRenderingContext2D) {
    drawXf(ctx, this.baseCanvas, this.xf);
    const cur = this.stones[this.si];
    const r = this.stoneR;
    // sockets
    this.sockets.forEach((so, i) => {
      if (so.filled) return;
      this.stonePoly(ctx, so.shape, so.pos, so.ang, r);
      ctx.fillStyle = 'rgba(20,12,8,0.7)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,230,190,0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (cur && this.hintMatch && cur.socket === i && !(this.env.quirk === 'flicker' && Math.sin(this.t * 6) > 0.5)) {
        ctx.strokeStyle = `rgba(240,200,96,${0.3 + 0.3 * Math.sin(this.t * 4)})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
    // placed stones
    for (const st of this.stones) {
      if (!st.placed) continue;
      const so = this.sockets[st.socket];
      this.drawStone(ctx, so.shape, st.pos, st.ang, r, this.stonePal(st.type));
    }
    // tray
    const [tx, ty] = this.trayPos();
    this.panel(tx - 34, ty - 18, 68, 36, 'rgba(40,28,20,0.65)');
    const waiting = this.stones.length - this.si - 1;
    for (let k = 0; k < Math.min(waiting, 6); k++) {
      const st = this.stones[this.si + 1 + k];
      ctx.fillStyle = this.stonePal(st.type)[3];
      ctx.fillRect(tx - 28 + k * 10, ty + 10, 6, 5);
    }
    if (cur) {
      const sw = this.swayOf(this.si, this.env.quirk === 'drifting' ? 0.6 : 0);
      const p: V = [cur.pos[0] + sw.d[0], cur.pos[1] + sw.d[1] + (this.dragging ? 0 : Math.sin(this.t * 2) * 1)];
      ctx.globalAlpha = 0.3;
      this.stonePoly(ctx, this.sockets[cur.socket].shape, [p[0] + 3, p[1] + 4], cur.ang + sw.a, r);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.globalAlpha = 1;
      this.drawStone(ctx, this.sockets[cur.socket].shape, p, cur.ang + sw.a, r, this.stonePal(cur.type));
    }
  }

  private drawStone(ctx: CanvasRenderingContext2D, shape: V[], pos: V, ang: number, r: number, pal: string[]) {
    this.stonePoly(ctx, shape, pos, ang, r);
    ctx.fillStyle = pal[3];
    ctx.fill();
    ctx.strokeStyle = pal[1];
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // facet highlight shows orientation
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const [hx, hy] = shape[0];
    ctx.fillStyle = pal[5];
    ctx.fillRect(Math.round(pos[0] + (hx * ca - hy * sa) * r * 0.55) - 1, Math.round(pos[1] + (hx * sa + hy * ca) * r * 0.55) - 1, 3, 3);
    ctx.fillStyle = pal[4];
    ctx.fillRect(Math.round(pos[0]) - 2, Math.round(pos[1]) - 2, 2, 2);
  }

  private drawRim(ctx: CanvasRenderingContext2D) {
    drawXf(ctx, this.baseCanvas, this.xf);
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
    const sw = this.swayOf(0.7, 1 - 0.08 * this.rimPins);
    const ox = this.rimOff[0] + sw.d[0], oy = this.rimOff[1] + sw.d[1];
    // pin holes on the face
    this.rimSeats.forEach((seat, i) => {
      const p = this.rimEdge(seat.ang);
      if (seat.done) return;
      const cur = i === this.rimIdx;
      if (cur && this.env.quirk === 'flicker' && Math.sin(this.t * 6) > 0.5) return;
      ctx.fillStyle = cur ? `rgba(255,210,120,${0.6 + 0.4 * pulse})` : 'rgba(30,20,14,0.8)';
      ctx.fillRect(Math.round(p[0]) - 2, Math.round(p[1]) - 2, 4, 4);
      if (cur) {
        ctx.strokeStyle = `rgba(255,210,120,${0.4 * pulse})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p[0], p[1], 7 + pulse * 2, 0, Math.PI * 2); ctx.stroke();
      }
    });
    if (this.rimImg) drawXf(ctx, this.rimImg, this.xf, ox, oy);
    else {
      const sl = this.shieldGeo();
      ctx.strokeStyle = '#a08050';
      ctx.lineWidth = 2 * this.xf.s;
      ctx.beginPath();
      ctx.ellipse(this.xf.cx + ox, this.xf.cy + oy, sl.rx * this.xf.s, sl.ry * this.xf.s, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // rim markers (move with the rim) + seated rivets
    this.rimSeats.forEach((seat, i) => {
      const p = this.rimEdge(seat.ang);
      if (seat.done) {
        ctx.fillStyle = COLORS.cream;
        ctx.fillRect(Math.round(p[0] + ox) - 1, Math.round(p[1] + oy) - 1, 3, 3);
        return;
      }
      if (i !== this.rimIdx) return;
      ctx.strokeStyle = COLORS.cream;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(p[0] + ox) - 3.5, Math.round(p[1] + oy) - 3.5, 7, 7);
    });
  }

  protected drawOverlay(ctx: CanvasRenderingContext2D) {
    const title = this.mode === 'hilt' ? 'Fitting the hilt' : this.mode === 'inlay' ? 'Setting stones' : 'Fitting the rim';
    this.text(title, MW / 2, 12, { size: 10, align: 'center', color: COLORS.gold });
    const hint = this.mode === 'rim'
      ? 'Drag (or arrows) to line the square up with the glowing pin • Space / Seat to pin it'
      : this.mode === 'inlay'
        ? 'Drag a stone into its matching socket • Q/E, wheel or buttons rotate • Space sets'
        : 'Drag (or arrows) onto the socket • Q/E, wheel or buttons to level • Space / Seat';
    this.text(hint, MW / 2, 26, { size: 8, align: 'center', color: COLORS.paper });
    if (this.finished) return;
    const [ux, uy] = this.uiPointer();
    for (const b of this.buttons()) {
      const hov = ux >= b.x && ux <= b.x + b.w && uy >= b.y && uy <= b.y + b.h;
      this.panel(b.x, b.y, b.w, b.h, hov ? 'rgba(80,58,40,0.92)' : COLORS.panel);
      if (b.label) this.text(b.label, b.x + b.w / 2, b.y + b.h / 2, { size: 10, align: 'center', color: COLORS.cream });
      else {
        // rotate arrow glyph
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2, left = b.id === 'rotL';
        ctx.strokeStyle = COLORS.cream;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, left ? -0.2 : Math.PI + 0.2, left ? Math.PI * 1.3 : -Math.PI * 0.3, left);
        ctx.stroke();
        const ax = left ? cx + 6 : cx - 6;
        ctx.fillStyle = COLORS.cream;
        ctx.beginPath(); ctx.moveTo(ax - 3, cy - 1); ctx.lineTo(ax + 3, cy - 1); ctx.lineTo(ax, cy + 3); ctx.closePath(); ctx.fill();
      }
    }
    // progress
    let prog = '';
    if (this.mode === 'hilt') prog = `${this.comps[this.ci]?.name === 'pommel' ? 'Pommel' : 'Guard'} · ${Math.min(2, this.ci + 1)}/2`;
    else if (this.mode === 'inlay') prog = `Stone ${Math.min(this.stones.length, this.si + 1)}/${this.stones.length}` + (this.stones[this.si] ? ` · ${hasMat(this.stones[this.si].type) ? mat(this.stones[this.si].type).name : this.stones[this.si].type}` : '');
    else prog = `Pin ${Math.min(this.rimSeats.length, this.rimIdx + 1)}/${this.rimSeats.length}`;
    this.text(prog, 12, MH - 14, { size: 10, color: COLORS.paper });
    this.text('Shift = fine control', 12, MH - 28, { size: 8, color: COLORS.dim });
  }

  protected onDestroy() {
    this.env.canvas.removeEventListener('wheel', this.wheelHandler);
  }
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export const assemblyGame: MinigameDef = {
  id: 'assembly',
  name: 'Assembly',
  controls: 'Drag or arrows to move, Q/E / mouse wheel / buttons to rotate, Space or the button to seat. Shift for fine control.',
  instructions: (env) => {
    const m = env.params.mode;
    if (m === 'inlay') return ['Set each mountain stone into the socket that matches its shape.', 'Turn it until its outline lines up, then drop it in — where and how you set it is how it stays.'];
    if (m === 'rim' || env.item.category === 'shield') return ['Fit the rim around the face, pin by pin.', 'Line the rim\'s square marker up with each glowing pin hole, then seat it. The rim sways — choose your moment.'];
    return ['Fit the guard, then the pommel, onto the tang.', 'Bring each onto the glowing socket and level it — it sways a little, so seat it at a calm moment.'];
  },
  create: (env) => new Assembly(env),
};
