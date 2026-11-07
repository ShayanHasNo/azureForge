// Surface treatment / polishing. The piece is shown large and divided into 8
// zones along its length (blades: t from guard 0 → tip 1; shields: 8 horizontal
// bands top → bottom). The player works a polishing tool over the surface —
// pointer drag while held, or arrows to move + Space held to polish — and every
// sprite pixel accumulates real coverage, drawn as a shine overlay.
//
// What "good" means depends on the texture being made (params.texture):
//  smooth      — even, complete coverage; over-polishing one zone is penalised.
//  brushed     — long, straight strokes along the grain, all in one direction.
//  hammered    — discrete dabs (click / Space press), evenly spaced.
//  weathered   — loose, varied coverage: untouched AND uniform both score low.
//                (also params.mode === 'weather')
//  reflective  — slow, steady, complete passes; fast jerky motion is penalised.
//  clarity     — params.mode === 'clarity' (Glassgarden): clear cloudiness zone
//                by zone in order with gentle pressure (a speed limit).
// Any other texture falls back to 'smooth'. params.wheel (polishing wheel
// upgrade) swaps the cloth for a spinning wheel with steadier, flatter contact.
//
// The player decides when to stop (Enter / "Done" button); a suggestion appears
// once the coverage targets are met.
//
// data: { zones: number[8] } — per-zone quality 0..1 (guard→tip / top→bottom)
// details: coverage, evenness + mode-specific measures (straightness, spacing,
//          variation, steadiness, order)

import { clamp, mean, smoothstep, stdev } from '../core/util';
import { bladeLayout, bladeRow, shieldLayout } from '../render/itemRenderer';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

type Mode = 'smooth' | 'brushed' | 'hammered' | 'weathered' | 'reflective' | 'clarity';
const ZONES = 8;

// ------------------------------------------------------------ sprite <-> screen
interface Xf { cx: number; cy: number; s: number; rot: boolean; W: number; H: number }
/** Sprite-space point (cell (x,y) spans [x,x+1)) → screen. */
function s2scr(xf: Xf, sx: number, sy: number): [number, number] {
  const lx = (sx - xf.W / 2) * xf.s, ly = (sy - xf.H / 2) * xf.s;
  return xf.rot ? [xf.cx - ly, xf.cy + lx] : [xf.cx + lx, xf.cy + ly];
}
function scr2s(xf: Xf, x: number, y: number): [number, number] {
  const dx = (x - xf.cx) / xf.s, dy = (y - xf.cy) / xf.s;
  return xf.rot ? [xf.W / 2 + dy, xf.H / 2 - dx] : [xf.W / 2 + dx, xf.H / 2 + dy];
}
/** Renderer-style coordinate (pixel = Math.round(coord)) → screen centre of that pixel. */
const spriteToScreen = (xf: Xf, x: number, y: number) => s2scr(xf, x + 0.5, y + 0.5);
const screenToSprite = (xf: Xf, X: number, Y: number): [number, number] => {
  const [a, b] = scr2s(xf, X, Y);
  return [a - 0.5, b - 0.5];
};

interface Stroke { along: number; path: number; zl: number[] }
interface Dab { x: number; y: number; z: number }

class Polish extends BaseMinigame {
  private mode: Mode;
  private readonly isShield: boolean;
  private spr: HTMLCanvasElement;
  private W: number;
  private H: number;
  private xf: Xf;
  private baseCy: number;
  private zoneOf: Int8Array;
  private cov: Float32Array;
  private zoneN = new Array(ZONES).fill(0);
  private overlay: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D | null;
  private odata: ImageData | null = null;
  private grain: Float32Array;
  private pieceLen: number;
  private radius: number;
  private rate = 4.2;
  private jitterAmp: number;
  private wheel: boolean;
  // cursor & motion
  private cx = MW / 2;
  private cy = MH / 2;
  private lastPx = 0;
  private lastPy = 0;
  private kbHold = 0;
  private vx = 0;
  private vy = 0;
  private speed = 0;
  private slowSpeed = 0;
  private prevCx = MW / 2;
  private prevCy = MH / 2;
  private polishing = false;
  private wasPolishing = false;
  private toolSpin = 0;
  private polishTime = 0;
  // mode state
  private strokes: Stroke[] = [];
  private stroke: Stroke | null = null;
  private strokeBack = 0;
  private dabs: Dab[] = [];
  private d0 = 5;
  private targetDabs = 40;
  private zoneSteady = new Array(ZONES).fill(0);
  private zoneTime = new Array(ZONES).fill(0);
  private zoneScuff = new Array(ZONES).fill(0);
  private outOfOrder = 0;
  private curZone = 0;
  private overT: number;
  private vmax: number;
  // live stats
  private stats = this.emptyStats();
  private statT = 0;
  private suggested = false;
  private hintCool = 0;
  private statusT = 0;
  private sl: { cx: number; cy: number; rx: number; ry: number };

  constructor(env: MinigameEnv) {
    super(env);
    this.isShield = env.item.category === 'shield' || !env.item.blade;
    const tex = String(env.params.texture ?? env.item.surface.texture ?? 'smooth');
    const pm = env.params.mode;
    this.mode = pm === 'clarity' ? 'clarity' : pm === 'weather' ? 'weathered'
      : (['smooth', 'brushed', 'hammered', 'weathered', 'reflective'] as string[]).includes(tex) ? (tex as Mode) : 'smooth';
    this.wheel = !!env.params.wheel;
    this.spr = this.sprite();
    this.W = this.spr.width;
    this.H = this.spr.height;
    this.sl = env.item.shield ? shieldLayout(env.item) : { cx: this.W / 2, cy: this.H / 2, rx: this.W * 0.4, ry: this.H * 0.4 };
    // ---- view
    if (this.isShield) {
      this.xf = { cx: 240, cy: 140, s: 2, rot: false, W: this.W, H: this.H };
      this.pieceLen = this.sl.ry * 2;
    } else {
      const lay = bladeLayout(env.item);
      const len = env.item.blade!.length;
      const s = clamp(Math.floor(360 / Math.max(1, len)), 2, 4);
      const midY = lay.bladeBase - len / 2 + 0.5;
      const midX = lay.cx + 0.5;
      this.xf = { cx: Math.round(240 + (midY - this.H / 2) * s), cy: Math.round(140 - (midX - this.W / 2) * s), s, rot: true, W: this.W, H: this.H };
      this.pieceLen = len;
    }
    this.baseCy = this.xf.cy;
    // ---- work mask
    const n = this.W * this.H;
    this.zoneOf = new Int8Array(n).fill(-1);
    this.cov = new Float32Array(n);
    this.grain = new Float32Array(this.W);
    for (let x = 0; x < this.W; x++) this.grain[x] = 0.55 + 0.45 * Math.abs(Math.sin(x * 2.17 + env.item.seed * 0.001) * Math.cos(x * 0.73));
    this.buildMask();
    // ---- tool
    if (this.isShield) this.radius = 8;
    else {
      let maxHw = 2;
      for (let k = 0; k <= 10; k++) { const r = bladeRow(env.item, k / 10); maxHw = Math.max(maxHw, r.L, r.R); }
      this.radius = clamp(maxHw * 0.8, 3, 5.5);
    }
    this.jitterAmp = this.tune(0.6, 1.4) * (this.wheel ? 0.5 : 1);
    this.overT = this.tune(2.1, 1.5);
    this.vmax = this.tune(230, 140) * (env.quirk === 'bursts' ? 1.15 : 1);
    if (this.mode === 'reflective') this.overT = this.tune(2.7, 2.1);
    if (env.quirk === 'bursts') this.radius *= 1.15;
    // hammered: spacing from area so a full piece takes ~tune(30,50) dabs
    const area = this.zoneN.reduce((a, b) => a + b, 0);
    this.targetDabs = Math.round(this.tune(30, 50));
    this.d0 = clamp(Math.sqrt(area / (0.87 * this.targetDabs)), 2.5, 14);
    // overlay
    this.overlay = document.createElement('canvas');
    this.overlay.width = this.W;
    this.overlay.height = this.H;
    this.octx = this.overlay.getContext('2d');
    try { this.odata = this.octx ? this.octx.createImageData(this.W, this.H) : null; } catch { this.odata = null; }
    // start the cursor on the piece
    const [sx, sy] = spriteToScreen(this.xf, this.W / 2, this.H / 2);
    this.cx = this.prevCx = sx; this.cy = this.prevCy = sy;
    if (!this.isShield) {
      const lay = bladeLayout(env.item);
      const p = spriteToScreen(this.xf, lay.cx, lay.bladeBase - 4);
      this.cx = this.prevCx = p[0]; this.cy = this.prevCy = p[1];
    }
    env.onStatus?.(this.modeLabel());
  }

  private buildMask() {
    const { W, H } = this;
    const item = this.env.item;
    let data: Uint8ClampedArray | null = null;
    try { data = this.spr.getContext('2d')?.getImageData(0, 0, W, H).data ?? null; } catch { data = null; }
    const opaque = (x: number, y: number) => (data ? data[(y * W + x) * 4 + 3] > 20 : true);
    if (this.isShield) {
      const sl = this.sl;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const nx = (x - sl.cx) / sl.rx, ny = (y - sl.cy) / sl.ry;
          if (data ? !opaque(x, y) : nx * nx + ny * ny > 1) continue;
          const z = clamp(Math.floor(((y - (sl.cy - sl.ry)) / (sl.ry * 2)) * ZONES), 0, ZONES - 1);
          this.zoneOf[y * W + x] = z; this.zoneN[z]++;
        }
    } else {
      const lay = bladeLayout(item);
      const len = Math.max(1, item.blade!.length);
      for (let y = 0; y < Math.min(H, lay.bladeBase); y++) {
        const t = (lay.bladeBase - y) / len;
        if (t > 1.03) continue;
        const row = bladeRow(item, clamp(t));
        const hw = Math.max(row.L, row.R) + 0.6;
        for (let x = 0; x < W; x++) {
          if (Math.abs(x - row.center) > hw || !opaque(x, y)) continue;
          const z = clamp(Math.floor(t * ZONES), 0, ZONES - 1);
          this.zoneOf[y * W + x] = z; this.zoneN[z]++;
        }
      }
    }
  }

  private modeLabel(): string {
    return {
      smooth: 'Smooth finish — even, complete coverage',
      brushed: 'Brushed finish — long straight strokes along the grain',
      hammered: 'Hammered finish — evenly spaced dabs',
      weathered: 'Weathered finish — loose, varied coverage',
      reflective: 'Reflective finish — slow, steady, complete passes',
      clarity: 'Clarity — clear the cloudiness, zone by zone, gently',
    }[this.mode];
  }

  // ------------------------------------------------------------ geometry helpers
  private uiPointer(): [number, number] {
    return [this.mirrored ? MW - this.pointer.x : this.pointer.x, this.pointer.y];
  }
  private doneRect() { return { x: MW - 96, y: MH - 40, w: 84, h: 20 }; }
  private overDone(): boolean {
    const [x, y] = this.uiPointer();
    const r = this.doneRect();
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }
  private zoneAtSprite(x: number, y: number): number {
    const ix = Math.round(x), iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.W || iy >= this.H) return -1;
    return this.zoneOf[iy * this.W + ix];
  }
  /** Nearest zone to a sprite point even slightly off the piece (for keyboard hints). */
  private zoneCoverage(z: number): number {
    return this.stats.c[z];
  }

  private deposit(px: number, py: number, r: number, amount: number, onlyZone = -1, zoneScale?: (z: number) => number) {
    const { W, H } = this;
    const x0 = Math.max(0, Math.floor(px - r)), x1 = Math.min(W - 1, Math.ceil(px + r));
    const y0 = Math.max(0, Math.floor(py - r)), y1 = Math.min(H - 1, Math.ceil(py + r));
    const flat = this.wheel || this.mode === 'hammered';
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * W + x;
        const z = this.zoneOf[i];
        if (z < 0 || (onlyZone >= 0 && z !== onlyZone)) continue;
        const d = Math.hypot(x - px, y - py) / r;
        if (d > 1) continue;
        const f = flat ? 1 - d * d * d * d : 1 - d;
        const k = zoneScale ? zoneScale(z) : 1;
        this.cov[i] = Math.min(3, this.cov[i] + amount * f * k);
      }
  }

  // ------------------------------------------------------------ stats
  private emptyStats() {
    const z = () => new Array(ZONES).fill(0);
    return { c: z(), m: z(), o: z(), sd: z(), half: z() };
  }
  private computeStats() {
    const s = this.emptyStats();
    const sum1 = new Array(ZONES).fill(0), sumSq = new Array(ZONES).fill(0);
    for (let i = 0; i < this.cov.length; i++) {
      const z = this.zoneOf[i];
      if (z < 0) continue;
      const c = this.cov[i];
      const c1 = Math.min(1, c);
      s.c[z] += c1;
      s.m[z] += c;
      sum1[z] += c1; sumSq[z] += c1 * c1;
      if (c > this.overT) s.o[z] += Math.min(1, c - this.overT);
      if (c >= 0.5) s.half[z]++;
    }
    for (let z = 0; z < ZONES; z++) {
      const n = this.zoneN[z];
      if (n <= 0) { s.c[z] = 1; s.m[z] = 1; s.o[z] = 0; s.sd[z] = 0.3; s.half[z] = 1; continue; }
      s.c[z] /= n; s.m[z] /= n; s.o[z] /= n; s.half[z] /= n;
      const mu = sum1[z] / n;
      s.sd[z] = Math.sqrt(Math.max(0, sumSq[z] / n - mu * mu));
    }
    this.stats = s;
  }

  private targetsMet(): boolean {
    const s = this.stats;
    switch (this.mode) {
      case 'smooth': case 'reflective': return s.c.every((c) => c >= 0.9);
      case 'brushed': return s.c.every((c) => c >= 0.8);
      case 'hammered': return this.dabs.length >= this.targetDabs * 0.9 && s.half.every((c) => c >= 0.55);
      case 'weathered': return s.c.every((c) => c >= 0.28);
      case 'clarity': return this.curZone >= ZONES;
    }
  }

  /** Zones that still need attention, used for highlighting. */
  private needsWork(z: number): boolean {
    const s = this.stats;
    switch (this.mode) {
      case 'clarity': return z === this.curZone;
      case 'weathered': return s.c[z] < 0.28;
      case 'hammered': return s.half[z] < 0.55;
      case 'brushed': return s.c[z] < 0.8;
      default: return s.c[z] < 0.9;
    }
  }

  // ------------------------------------------------------------ update
  protected update(dt: number) {
    this.hintCool = Math.max(0, this.hintCool - dt);
    if (this.env.quirk === 'drifting' && !this.reducedMotion) this.xf.cy = Math.round(this.baseCy + Math.sin(this.t * 0.5) * 6);
    // --- cursor from pointer or keyboard
    const pMoved = this.pointer.x !== this.lastPx || this.pointer.y !== this.lastPy;
    this.lastPx = this.pointer.x; this.lastPy = this.pointer.y;
    const ax = this.axisX(), ay = this.axisY();
    if (this.pointer.justDown) { this.prevCx = this.pointer.x; this.prevCy = this.pointer.y; this.vx = this.vy = 0; this.slowSpeed = this.speed = 0; }
    if (pMoved || this.pointer.down) { this.cx = this.pointer.x; this.cy = this.pointer.y; }
    if (ax || ay) {
      this.kbHold += dt;
      const sp = (70 + 150 * clamp(this.kbHold / 1.2)) * (this.isDown('ShiftLeft', 'ShiftRight') ? 0.5 : 1);
      const n = Math.hypot(ax, ay) || 1;
      this.cx = clamp(this.cx + (ax / n) * sp * dt, 0, MW);
      this.cy = clamp(this.cy + (ay / n) * sp * dt, 0, MH);
    } else this.kbHold = 0;
    // velocity (screen px/s), smoothed
    const ivx = (this.cx - this.prevCx) / Math.max(dt, 1e-3), ivy = (this.cy - this.prevCy) / Math.max(dt, 1e-3);
    const k = clamp(dt / 0.07);
    this.vx += (ivx - this.vx) * k; this.vy += (ivy - this.vy) * k;
    this.speed = Math.hypot(this.vx, this.vy);
    this.slowSpeed += (this.speed - this.slowSpeed) * clamp(dt / 0.5);

    // --- finishing
    const doneClick = this.pointer.justDown && this.overDone();
    if ((doneClick || this.wasPressed('Enter')) && this.t > 1.2) { this.complete(); return; }

    // --- polishing
    const [spx, spy] = screenToSprite(this.xf, this.cx, this.cy);
    const pointerPolish = this.pointer.down && !this.overDone();
    const active = pointerPolish || this.isDown('Space');
    if (this.mode === 'hammered') {
      this.polishing = false;
      if ((this.pointer.justDown && !this.overDone()) || this.wasPressed('Space')) this.dab(spx, spy);
    } else {
      this.polishing = active;
      if (active) this.polishStep(dt, spx, spy, this.prevCx, this.prevCy);
      else this.endStroke();
    }
    if (this.polishing) {
      this.env.audio.loop('polish', true, clamp(0.25 + this.speed / 400));
    } else if (this.wasPolishing) this.env.audio.loop('polish', false);
    this.wasPolishing = this.polishing;
    this.toolSpin += dt * (this.polishing ? 18 : 3);
    this.prevCx = this.cx; this.prevCy = this.cy;

    // --- stats & feedback
    this.statT -= dt;
    if (this.statT <= 0) {
      this.statT = 0.2;
      this.computeStats();
      if (this.mode === 'clarity') this.advanceClarity();
      const met = this.targetsMet();
      if (met && !this.suggested) {
        this.suggested = true;
        this.env.audio.sfx('chime');
        this.floatText('Looks ready — press Done when happy', MW / 2, 60, COLORS.gold);
      }
    }
    this.statusT -= dt;
    if (this.statusT <= 0) {
      this.statusT = 0.6;
      const cov = Math.round(mean(this.stats.c) * 100);
      this.env.onStatus?.(this.mode === 'clarity' ? `Clearing zone ${Math.min(ZONES, this.curZone + 1)} / ${ZONES}` : this.mode === 'hammered' ? `Dabs ${this.dabs.length} / ~${this.targetDabs}` : `Coverage ${cov}%`);
    }
  }

  private polishStep(dt: number, spx: number, spy: number, pcx: number, pcy: number) {
    this.polishTime += dt;
    let amount = this.rate * dt;
    if (this.env.quirk === 'bursts') amount *= 0.7 + 0.6 * (0.5 + 0.5 * Math.sin(this.t * 2.1));
    // contact jitter (the wheel holds steadier)
    const ja = this.jitterAmp;
    const jx = (Math.sin(this.t * 13.1) * 0.6 + Math.sin(this.t * 7.3 + 1) * 0.4) * ja;
    const jy = (Math.cos(this.t * 11.7) * 0.6 + Math.sin(this.t * 5.9 + 2) * 0.4) * ja;
    const px = spx + jx, py = spy + jy;
    const z = this.zoneAtSprite(spx, spy);
    const r = this.radius;
    switch (this.mode) {
      case 'clarity': {
        const gentle = this.speed <= this.vmax;
        const cur = this.curZone;
        if (z >= 0 && this.zoneN[z] > 0) {
          if (z === cur) {
            this.zoneTime[z] += dt;
            if (!gentle) this.zoneScuff[z] += dt;
          } else if (z > cur) this.outOfOrder += dt;
        }
        this.deposit(px, py, r, amount * (gentle ? 1 : 0.25), -1, (zz) => (zz === cur ? 1 : zz > cur ? 0.08 : 0.5));
        if (!gentle && this.hintCool <= 0) { this.hintCool = 1.2; this.floatText('Gently…', this.cx, this.cy - 18, COLORS.cool); this.env.audio.sfx('soft'); }
        else if (z > cur && this.hintCool <= 0) { this.hintCool = 1.6; this.floatText('In order — guard first', this.cx, this.cy - 18, COLORS.paper); }
        break;
      }
      case 'reflective': {
        if (z >= 0) {
          const over = clamp(Math.max(0, this.speed - this.vmax) / this.vmax);
          const jerk = clamp(Math.abs(this.speed - this.slowSpeed) / (this.vmax * 0.9));
          const steady = (1 - over) * (1 - jerk);
          this.zoneSteady[z] += steady * dt; this.zoneTime[z] += dt;
          if (steady < 0.45 && this.hintCool <= 0) { this.hintCool = 1.3; this.floatText(over > 0 ? 'Slower…' : 'Steady…', this.cx, this.cy - 18, COLORS.cool); }
        }
        this.deposit(px, py, r, amount);
        break;
      }
      case 'brushed': {
        this.trackStroke(spx, spy, pcx, pcy, z);
        this.deposit(px, py, r * 0.85, amount);
        break;
      }
      default:
        this.deposit(px, py, r, amount);
    }
    if (z >= 0 && Math.random() < dt * 14) {
      const col = this.mode === 'weathered' ? '#b8a070' : this.mode === 'clarity' ? '#d8f0ff' : COLORS.cream;
      this.spawn(this.cx + (Math.random() - 0.5) * r * this.xf.s, this.cy + (Math.random() - 0.5) * r * this.xf.s, { n: 1, spread: 30, vy: -14, life: 0.45, color: col, size: 1, g: 0 });
    }
  }

  // --- brushed strokes (measured from the player's own input, not the jittered contact)
  private trackStroke(spx: number, spy: number, pcx: number, pcy: number, z: number) {
    const [ppx, ppy] = screenToSprite(this.xf, pcx, pcy);
    const dx = spx - ppx, dy = spy - ppy;
    const d = Math.hypot(dx, dy);
    const along = -dy; // sprite-vertical = along the blade (towards the tip is +)
    if (!this.stroke) { this.stroke = { along: 0, path: 0, zl: new Array(ZONES).fill(0) }; this.strokeBack = 0; }
    const st = this.stroke;
    if (d < 1e-4) return;
    // A reversal starts a new stroke (lift and return for a clean grain).
    if (Math.abs(st.along) > 2 && Math.sign(along) !== Math.sign(st.along) && Math.abs(along) > 0) {
      this.strokeBack += Math.abs(along);
      if (this.strokeBack > 3) { this.endStroke(); this.stroke = { along: 0, path: 0, zl: new Array(ZONES).fill(0) }; }
    } else this.strokeBack = 0;
    const s2 = this.stroke!;
    s2.along += along; s2.path += d;
    if (z >= 0) s2.zl[z] += d;
  }
  private endStroke() {
    const st = this.stroke;
    this.stroke = null;
    if (!st || st.path < 2) return;
    this.strokes.push(st);
    const straight = Math.abs(st.along) / Math.max(1e-6, st.path);
    const lenQ = clamp(Math.abs(st.along) / this.strokeTarget());
    const label = straight > 0.92 && lenQ > 0.8 ? ['Long & true', COLORS.good] : straight < 0.75 ? ['A little wavy', COLORS.ok] : lenQ < 0.45 ? ['Short stroke', COLORS.ok] : ['Good stroke', COLORS.cream];
    this.floatText(label[0], this.cx, this.cy - 16, label[1]);
  }
  private strokeTarget() { return this.tune(0.3, 0.55) * this.pieceLen; }

  // --- hammered dabs
  private dab(spx: number, spy: number) {
    const z = this.zoneAtSprite(spx, spy);
    if (z < 0) { this.env.audio.sfx('soft', { volume: 0.5 }); return; }
    let nn = Infinity;
    for (const d of this.dabs) nn = Math.min(nn, Math.hypot(d.x - spx, d.y - spy));
    this.dabs.push({ x: spx, y: spy, z });
    this.deposit(spx, spy, this.d0 * 0.62, 1);
    this.env.audio.sfx('pop', { pitch: 0.8 + Math.random() * 0.3 });
    this.sparks(this.cx, this.cy, 4, COLORS.cream);
    if (Number.isFinite(nn)) {
      const e = (nn - this.d0) / this.d0;
      const tol = this.tune(0.55, 0.3);
      if (Math.abs(e) < tol * 0.5) this.floatText('Even', this.cx, this.cy - 14, COLORS.good);
      else if (e < 0) this.floatText('Close', this.cx, this.cy - 14, COLORS.ok);
      else if (e > tol * 1.5) this.floatText('Wide', this.cx, this.cy - 14, COLORS.ok);
    }
  }

  private advanceClarity() {
    if (this.curZone >= ZONES) return;
    const target = this.tune(0.85, 0.92);
    if (this.stats.c[this.curZone] >= target) {
      const [x, y] = this.zoneScreenCentre(this.curZone);
      this.env.audio.sfx('glass', { pitch: 0.9 + this.curZone * 0.05 });
      this.sparks(x, y, 10, '#d8f0ff');
      this.floatText('Clear', x, y - 20, '#d8f0ff');
      this.curZone++;
    }
  }

  private zoneScreenCentre(z: number): [number, number] {
    const zc = (z + 0.5) / ZONES;
    if (this.isShield) {
      const sl = this.sl;
      return spriteToScreen(this.xf, sl.cx, sl.cy - sl.ry + zc * sl.ry * 2);
    }
    const lay = bladeLayout(this.env.item);
    const row = bladeRow(this.env.item, zc);
    return spriteToScreen(this.xf, row.center, lay.bladeBase - zc * this.env.item.blade!.length);
  }

  // ------------------------------------------------------------ scoring
  private evaluate() {
    this.endStroke();
    this.computeStats();
    const s = this.stats;
    const q = new Array(ZONES).fill(0);
    const details: Record<string, number> = {};
    const meanC = mean(s.c);
    details.coverage = meanC;
    let score = 0;
    switch (this.mode) {
      case 'smooth': {
        const mm = mean(s.m);
        for (let z = 0; z < ZONES; z++) {
          const dev = Math.abs(s.m[z] - mm) / Math.max(0.6, mm);
          q[z] = Math.pow(s.c[z], 1.3) * (1 - clamp(s.o[z] * 1.2)) * (1 - clamp(dev * 0.6));
        }
        const evenness = 1 - clamp((stdev(s.m) / Math.max(0.5, mm)) * 1.5);
        details.evenness = evenness;
        details.overPolish = clamp(mean(s.o) * 3);
        score = mean(q) * 0.8 + evenness * 0.2 * meanC;
        break;
      }
      case 'reflective': {
        const mm = mean(s.m);
        const st: number[] = [];
        for (let z = 0; z < ZONES; z++) {
          const sz = this.zoneTime[z] > 0 ? this.zoneSteady[z] / this.zoneTime[z] : this.zoneN[z] > 0 ? 0 : 1;
          st.push(sz);
          q[z] = Math.pow(s.c[z], 1.3) * (0.35 + 0.65 * sz) * (1 - clamp(s.o[z]));
        }
        const evenness = 1 - clamp((stdev(s.m) / Math.max(0.5, mm)) * 1.5);
        details.evenness = evenness;
        details.steadiness = mean(st);
        score = mean(q) * 0.85 + evenness * 0.15 * meanC;
        break;
      }
      case 'brushed': {
        const dom = Math.sign(this.strokes.reduce((a, st) => a + st.along, 0)) || 1;
        const zq = new Array(ZONES).fill(0), zl = new Array(ZONES).fill(0);
        let sw = 0, sStraight = 0, sDir = 0, sLen = 0;
        const sharp = this.tune(1.5, 3);
        for (const st of this.strokes) {
          const straight = Math.abs(st.along) / Math.max(1e-6, st.path);
          const lenQ = clamp(Math.abs(st.along) / this.strokeTarget());
          const dirOk = Math.sign(st.along) === dom;
          const sq = Math.pow(straight, sharp) * (0.3 + 0.7 * lenQ) * (dirOk ? 1 : 0.35);
          for (let z = 0; z < ZONES; z++) { zq[z] += st.zl[z] * sq; zl[z] += st.zl[z]; }
          sw += st.path; sStraight += straight * st.path; sDir += (dirOk ? 1 : 0) * st.path; sLen += lenQ * st.path;
        }
        for (let z = 0; z < ZONES; z++) {
          const sqz = zl[z] > 0 ? zq[z] / zl[z] : 0;
          q[z] = s.c[z] * (0.35 + 0.65 * sqz);
        }
        details.straightness = sw > 0 ? sStraight / sw : 0;
        details.direction = sw > 0 ? sDir / sw : 0;
        details.strokeLength = sw > 0 ? sLen / sw : 0;
        details.strokes = this.strokes.length;
        score = mean(q);
        break;
      }
      case 'hammered': {
        const tol = this.tune(0.55, 0.3);
        const nns: number[] = [];
        const zs = new Array(ZONES).fill(0), zc = new Array(ZONES).fill(0);
        for (let i = 0; i < this.dabs.length; i++) {
          let nn = Infinity;
          for (let j = 0; j < this.dabs.length; j++) if (j !== i) nn = Math.min(nn, Math.hypot(this.dabs[i].x - this.dabs[j].x, this.dabs[i].y - this.dabs[j].y));
          if (!Number.isFinite(nn)) nn = this.d0 * 3;
          nns.push(nn);
          const sd = nn < this.d0 * 0.35 ? 0 : 1 - clamp(Math.abs(nn - this.d0) / (this.d0 * tol));
          zs[this.dabs[i].z] += sd; zc[this.dabs[i].z]++;
        }
        const spacing: number[] = [];
        for (let z = 0; z < ZONES; z++) {
          const sz = zc[z] > 0 ? zs[z] / zc[z] : this.zoneN[z] > 0 ? 0 : 1;
          spacing.push(sz);
          q[z] = (0.45 * clamp(s.half[z] / 0.8) + 0.55 * sz) * (zc[z] > 0 || this.zoneN[z] === 0 ? 1 : 0);
        }
        const mu = mean(nns);
        const regularity = nns.length > 1 ? 1 - clamp((stdev(nns) / Math.max(1e-6, mu)) * 2) : 0;
        details.spacing = mean(spacing);
        details.regularity = regularity;
        details.dabs = this.dabs.length;
        details.coverage = mean(s.half);
        score = mean(q) * 0.85 + regularity * 0.15 * clamp(mean(s.half) / 0.8);
        break;
      }
      case 'weathered': {
        const varTarget = this.tune(0.22, 0.32);
        const pres: number[] = [], vars: number[] = [];
        for (let z = 0; z < ZONES; z++) {
          const p = smoothstep(0.08, 0.3, s.c[z]) * (1 - 0.7 * smoothstep(0.82, 0.98, s.c[z]));
          const v = clamp(s.sd[z] / varTarget);
          pres.push(p); vars.push(v);
          q[z] = p * (0.5 + 0.5 * v);
        }
        const variety = clamp(stdev(s.c) / this.tune(0.06, 0.12));
        details.variation = mean(vars);
        details.zoneVariety = variety;
        score = mean(q) * 0.8 + variety * 0.2 * mean(pres);
        break;
      }
      case 'clarity': {
        const gentle: number[] = [];
        for (let z = 0; z < ZONES; z++) {
          const g = 1 - clamp((this.zoneScuff[z] / Math.max(0.5, this.zoneTime[z])) * 1.2);
          gentle.push(g);
          q[z] = clamp(s.c[z] / 0.95) * g;
        }
        const order = 1 - clamp(this.outOfOrder / 6);
        details.gentleness = mean(gentle);
        details.order = order;
        details.cleared = Math.min(ZONES, this.curZone) / ZONES;
        score = mean(q) * 0.9 + order * 0.1 * meanC;
        break;
      }
    }
    return { q: q.map((v) => Math.round(clamp(v) * 1000) / 1000), score: clamp(score), details };
  }

  private complete() {
    if (this.finished) return;
    this.env.audio.loop('polish', false);
    const { q, score, details } = this.evaluate();
    const g = gradeOf(score);
    const worst = q.indexOf(Math.min(...q));
    const where = this.isShield ? ['top', 'upper', 'upper', 'middle', 'middle', 'lower', 'lower', 'bottom'][worst] : worst < 3 ? 'near the guard' : worst > 5 ? 'near the tip' : 'mid-blade';
    const msg: Record<Mode, string> = {
      smooth: details.evenness > 0.8 ? 'an even, quiet surface' : `a surface a touch uneven ${where}`,
      reflective: (details.steadiness ?? 0) > 0.75 ? 'patient, mirror-bright passes' : `bright, if a little hurried ${where}`,
      brushed: (details.straightness ?? 0) > 0.9 ? 'a clean, straight grain' : 'a grain with a few wandering strokes',
      hammered: (details.regularity ?? 0) > 0.7 ? 'neatly spaced peen marks' : 'lively, irregular peen marks',
      weathered: (details.variation ?? 0) > 0.7 ? 'a naturally worn, varied patina' : `a patina that could be looser ${where}`,
      clarity: (details.cleared ?? 0) >= 1 ? 'the cloudiness lifted clean away' : `some cloudiness left ${where}`,
    };
    this.env.audio.sfx('success');
    this.sparks(MW / 2, MH / 2, 16, COLORS.gold);
    this.finish({ score, details, data: { zones: q }, summary: `${g} surface work — ${msg[this.mode]}.` }, 1.0);
  }

  // ------------------------------------------------------------ draw
  private buildOverlay() {
    if (!this.odata || !this.octx) return;
    const d = this.odata.data;
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 3);
    const flickOff = this.env.quirk === 'flicker' && Math.sin(this.t * 6.3) > 0.55;
    const hl: boolean[] = [];
    for (let z = 0; z < ZONES; z++) hl.push(!flickOff && !this.finished && this.needsWork(z));
    const W = this.W;
    for (let i = 0; i < this.cov.length; i++) {
      const z = this.zoneOf[i];
      const k = i * 4;
      if (z < 0) { d[k + 3] = 0; continue; }
      const c = this.cov[i];
      const c1 = Math.min(1, c);
      let r = 255, g = 255, b = 255, a = 0;
      switch (this.mode) {
        case 'weathered': {
          const x = i % W, y = (i / W) | 0;
          const n = 0.6 + 0.4 * Math.sin(x * 1.7 + y * 0.9) * Math.cos(y * 0.6 - x * 0.4);
          r = 122; g = 128; b = 92; a = c1 * 0.55 * n;
          break;
        }
        case 'clarity': {
          // fog that lifts as it is cleared, plus a cool shine on cleared glass
          const fog = (1 - c1) * 0.62;
          const shine = c1 * 0.22;
          a = fog + shine * (1 - fog);
          const mix = fog / Math.max(1e-6, a);
          r = Math.round(230 * mix + 220 * (1 - mix)); g = Math.round(236 * mix + 245 * (1 - mix)); b = 245;
          break;
        }
        case 'brushed': {
          const x = i % W;
          a = c1 * 0.42 * this.grain[x];
          break;
        }
        case 'hammered':
          a = c1 * 0.22;
          break;
        default: {
          a = c1 * (this.mode === 'reflective' ? 0.5 : 0.38);
          if (c > this.overT) { r = 255; g = 214; b = 170; a = Math.min(0.75, a + (c - this.overT) * 0.3); }
        }
      }
      if (hl[z]) {
        const ha = 0.1 + 0.1 * pulse;
        // blend a warm highlight beneath the shine
        const na = a + ha * (1 - a);
        const w = na > 0 ? a / na : 0;
        r = Math.round(r * w + 255 * (1 - w)); g = Math.round(g * w + 180 * (1 - w)); b = Math.round(b * w + 90 * (1 - w));
        a = na;
      }
      d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = Math.round(clamp(a) * 255);
    }
    this.octx.putImageData(this.odata, 0, 0);
  }

  private drawImg(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement) {
    const { cx, cy, s, rot, W, H } = this.xf;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(Math.PI / 2);
    ctx.drawImage(img, -(W * s) / 2, -(H * s) / 2, W * s, H * s);
    ctx.restore();
  }

  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.5, '#2c2420');
    // work cloth
    ctx.fillStyle = 'rgba(60,44,34,0.6)';
    ctx.fillRect(20, 72, MW - 40, 140);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(20, 210, MW - 40, 2);
    this.drawImg(ctx, this.spr);
    this.buildOverlay();
    this.drawImg(ctx, this.overlay);
    // zone ticks
    for (let z = 1; z < ZONES; z++) {
      const zc = z / ZONES;
      let p: [number, number], q: [number, number];
      if (this.isShield) {
        const sl = this.sl;
        const y = sl.cy - sl.ry + zc * sl.ry * 2;
        p = spriteToScreen(this.xf, sl.cx - sl.rx - 3, y); q = spriteToScreen(this.xf, sl.cx - sl.rx - 1, y);
      } else {
        const lay = bladeLayout(this.env.item);
        const row = bladeRow(this.env.item, zc);
        const y = lay.bladeBase - zc * this.env.item.blade!.length;
        p = spriteToScreen(this.xf, row.center + Math.max(row.L, row.R) + 2, y); q = spriteToScreen(this.xf, row.center + Math.max(row.L, row.R) + 4, y);
      }
      ctx.fillStyle = 'rgba(255,230,180,0.35)';
      ctx.fillRect(Math.round(Math.min(p[0], q[0])), Math.round(Math.min(p[1], q[1])), Math.max(1, Math.abs(q[0] - p[0])), Math.max(1, Math.abs(q[1] - p[1])));
    }
    // hammered dab marks
    if (this.mode === 'hammered') {
      const rr = Math.max(2, this.d0 * 0.42 * this.xf.s);
      for (const d of this.dabs) {
        const [x, y] = spriteToScreen(this.xf, d.x, d.y);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.beginPath(); ctx.arc(x + 1, y + 1, rr, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,245,220,0.28)';
        ctx.beginPath(); ctx.arc(x - 0.5, y - 0.5, rr * 0.75, 0, Math.PI * 2); ctx.fill();
      }
      // spacing guide ring
      if (!this.finished) {
        ctx.strokeStyle = 'rgba(240,200,96,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(this.cx, this.cy, this.d0 * this.xf.s, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // brushed: grain direction arrows
    if (this.mode === 'brushed') {
      ctx.fillStyle = 'rgba(255,240,210,0.35)';
      if (this.isShield) {
        for (let k = 0; k < 3; k++) { const x = 120 + k * 4; const yy = 120 + ((this.t * 30 + k * 20) % 60); ctx.fillRect(x, yy, 1, 6); }
      } else {
        for (let k = 0; k < 3; k++) { const yy = 222 + k * 2; const xx = 120 + ((this.t * 40 + k * 30) % 240); ctx.fillRect(xx, yy, 8, 1); }
      }
    }
    this.drawTool(ctx);
  }

  private drawTool(ctx: CanvasRenderingContext2D) {
    if (this.finished) return;
    const x = Math.round(this.cx), y = Math.round(this.cy);
    const r = Math.max(4, Math.round(this.radius * this.xf.s * (this.mode === 'hammered' ? 0.6 : 1)));
    if (this.mode === 'hammered') {
      // small peen punch
      ctx.fillStyle = '#5a5a66';
      ctx.fillRect(x - 3, y - 18, 6, 14);
      ctx.fillStyle = '#8a8a96';
      ctx.fillRect(x - 3, y - 18, 2, 14);
      ctx.fillStyle = 'rgba(255,240,200,0.6)';
      ctx.fillRect(x - 1, y - 1, 2, 2);
      return;
    }
    if (this.wheel) {
      ctx.strokeStyle = 'rgba(40,30,24,0.8)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = this.polishing ? 'rgba(240,230,210,0.35)' : 'rgba(220,210,190,0.22)';
      ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,250,235,0.7)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 4; k++) {
        const a = this.toolSpin + (k * Math.PI) / 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * (r - 1), y + Math.sin(a) * (r - 1)); ctx.stroke();
      }
      ctx.fillStyle = '#6a4a2a';
      ctx.fillRect(x - 1, y - r - 10, 3, 10);
    } else {
      ctx.fillStyle = this.polishing ? 'rgba(250,240,220,0.5)' : 'rgba(240,228,205,0.3)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(120,90,60,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      // cloth folds
      ctx.fillStyle = 'rgba(160,130,100,0.6)';
      ctx.fillRect(x - Math.round(r * 0.5), y - 1, Math.round(r), 1);
    }
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    const ctx = this.ctx;
    // header: mode + hint
    this.text(this.modeLabel(), MW / 2, 10, { size: 10, align: 'center', color: COLORS.gold });
    const hint = this.mode === 'hammered'
      ? 'Click / tap or Space to dab • arrows move • Enter / Done to finish'
      : this.mode === 'brushed'
        ? (this.isShield ? 'Drag long strokes top↔bottom, one way only • Space+arrows' : 'Drag long strokes along the blade, one way only • Space+arrows')
        : 'Hold and drag to polish • arrows move, hold Space to polish • Enter / Done to finish';
    this.text(hint, MW / 2, 24, { size: 8, align: 'center', color: COLORS.paper });
    // zone bars
    const x0 = MW / 2 - 100, y0 = 34;
    for (let z = 0; z < ZONES; z++) {
      const v = this.mode === 'hammered' ? this.stats.half[z] : this.stats.c[z];
      const col = this.mode === 'clarity' ? (z < this.curZone ? '#bfe6ff' : z === this.curZone ? COLORS.gold : COLORS.dim)
        : this.mode === 'weathered' ? (v > 0.85 ? COLORS.ok : '#9aa86a') : this.stats.o[z] > 0.05 ? COLORS.bad : v >= 0.9 ? COLORS.good : COLORS.ok;
      this.bar(x0 + z * 25, y0, 22, 4, v, col);
    }
    this.text(this.isShield ? 'top' : 'guard', x0 - 4, y0 + 2, { size: 7, align: 'right', color: COLORS.dim, shadow: false });
    this.text(this.isShield ? 'bottom' : 'tip', x0 + ZONES * 25 + 2, y0 + 2, { size: 7, color: COLORS.dim, shadow: false });
    // bottom HUD
    const cov = Math.round(mean(this.mode === 'hammered' ? this.stats.half : this.stats.c) * 100);
    this.text(this.mode === 'hammered' ? `Dabs ${this.dabs.length} / ~${this.targetDabs}` : `Coverage ${cov}%`, 12, MH - 14, { size: 10, color: COLORS.paper });
    if (this.mode === 'reflective' || this.mode === 'clarity') {
      const fast = this.polishing && this.speed > this.vmax;
      this.text(fast ? 'Too quick' : 'Pace', 130, MH - 14, { size: 9, color: fast ? COLORS.bad : COLORS.paper });
      this.bar(162, MH - 17, 60, 5, this.speed / (this.vmax * 1.6), fast ? COLORS.bad : COLORS.good);
      ctx.fillStyle = COLORS.cream;
      ctx.fillRect(162 + Math.round(60 / 1.6), MH - 19, 1, 9);
    }
    if (this.wheel) this.text('Polishing wheel', 250, MH - 14, { size: 9, color: COLORS.cool });
    // done button
    const r = this.doneRect();
    const glow = this.suggested ? 0.5 + 0.5 * Math.sin(this.t * 4) : 0;
    const hov = this.overDone();
    this.panel(r.x, r.y, r.w, r.h, this.suggested ? `rgba(90,120,60,${0.75 + glow * 0.2})` : hov ? 'rgba(70,50,36,0.9)' : COLORS.panel, this.suggested ? COLORS.good : COLORS.panelEdge);
    this.text(this.suggested ? 'Done ✓' : 'Done', r.x + r.w / 2, r.y + r.h / 2, { size: 10, align: 'center', color: COLORS.cream });
  }

  protected onDestroy() {
    this.env.audio.loop('polish', false);
  }
}

export const polishGame: MinigameDef = {
  id: 'polish',
  name: 'Surface Treatment',
  controls: 'Hold and drag to polish (or arrows + hold Space). Hammered: click / Space to dab. Enter or Done to finish.',
  instructions: (env) => {
    const tex = env.params.texture ?? env.item.surface.texture;
    const m = env.params.mode;
    const tail = ['Work the glowing zones — the shine shows your real coverage.', 'Stop whenever you are happy; Done lights up when the targets are met.'];
    if (m === 'clarity') return ['Glassgarden clarity: clear the cloudiness zone by zone, guard to tip.', 'Gentle pressure — moving too fast scuffs instead of clearing.', ...tail.slice(1)];
    if (m === 'weather' || tex === 'weathered') return ['Weathered: work loosely. Leave natural variation — not bare, not uniform.', ...tail.slice(1)];
    if (tex === 'brushed') return ['Brushed: long, straight strokes along the grain, always the same direction.', 'Lift and return between strokes.', ...tail.slice(1)];
    if (tex === 'hammered') return ['Hammered: dab peen marks evenly across the surface.', 'The faint ring around the punch shows ideal spacing.', ...tail.slice(1)];
    if (tex === 'reflective') return ['Reflective: slow, steady, complete passes. Hurried motion dulls the mirror.', ...tail];
    return ['Smooth: cover every zone evenly — don\'t over-polish one spot.', ...tail];
  },
  create: (env) => new Polish(env),
};
