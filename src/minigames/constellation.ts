// Celestial starlight infusion. A night sky opens over the blade with a seeded
// star field (env.item.seed). A constellation of N = round(tune(5, 8)) stars is
// revealed one at a time as faint glows, and every star drifts gently. Draw a
// line of light from the lit star to the next: press on the lit star, drag,
// and release on the next one (keyboard: arrows move a cursor, Space links).
//
// Each link is measured: precision = how close the release lands to the star's
// centre (against a tolerance from tune()), smoothness = how straight and calm
// the dragged path was, order = linking the right star (a fainter, later star
// is also visible — reaching for it early is an order slip). Misses fade away
// gently and the catch radius widens a little each time, so it always finishes.
//
// data: { points: [t,u][] (the stars where they were when linked, mapped from
//          the sky field to blade-local t 0.05..0.65, u -0.6..0.6 — shields get
//          the same normalised coords), brightness: 0..1 }
// details: precision, smoothness, order, misses

import { seededRng } from '../core/rng';
import { clamp, mean } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { cloneItem } from '../item/factory';
import { bladeLayout } from '../render/itemRenderer';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

type V = [number, number];

// sky field ↔ blade-local mapping
const SX0 = 60, SX1 = 420, SY0 = 52, SY1 = 214;
const T0 = 0.05, T1 = 0.65, U0 = -0.6, U1 = 0.6;
const skyToTU = (x: number, y: number): V => [
  clamp(T0 + ((x - SX0) / (SX1 - SX0)) * (T1 - T0), T0, T1),
  clamp(U0 + ((y - SY0) / (SY1 - SY0)) * (U1 - U0), U0, U1),
];

interface Star { base: V; ph: number; ph2: number }
interface Link { from: V; to: V; precision: number; smooth: number }

class Constellation extends BaseMinigame {
  private stars: Star[] = [];
  private field: { x: number; y: number; b: number; ph: number }[] = [];
  private n: number;
  private cur = 0; // the lit star the next line starts from
  private links: Link[] = [];
  private points: V[] = [];
  private dragging = false;
  private path: V[] = [];
  private kb = false;
  private cursor: V = [MW / 2, MH / 2];
  private kbHold = 0;
  private lastP: V = [0, 0];
  private misses = 0;
  private missesHere = 0;
  private orderSlips = 0;
  private tol: number;
  private grabR: number;
  private driftA: number;
  private glow: string;
  private fade: { a: V; b: V; life: number }[] = [];
  private finalCanvas: HTMLCanvasElement | null = null;
  private hintCool = 0;
  /** Stars stop drifting once joined, so the light lines stay attached. */
  private frozen: (V | null)[] = [];

  constructor(env: MinigameEnv) {
    super(env);
    const rng = seededRng(env.item.seed, 'constellation');
    this.n = Math.round(this.tune(5, 8));
    this.tol = this.tune(14, 6) * (env.quirk === 'bursts' ? 1.3 : 1);
    this.grabR = this.tune(24, 15);
    this.driftA = this.tune(3, 9) * (env.quirk === 'drifting' ? 2 : 1) * (this.reducedMotion ? 0.5 : 1);
    const acc = hasMat(env.item.materials.primary) ? mat(env.item.materials.primary).accent : undefined;
    this.glow = env.item.finish.glowColor || acc || '#bcd8ff';
    // place stars with a comfortable minimum spacing, then order them as a gentle path
    let minD = 62;
    const pts: V[] = [];
    for (let tries = 0; pts.length < this.n && tries < 2000; tries++) {
      if (tries > 0 && tries % 300 === 0) minD *= 0.85;
      const p: V = [rng.range(SX0 + 16, SX1 - 16), rng.range(SY0 + 14, SY1 - 14)];
      if (pts.every((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) >= minD)) pts.push(p);
    }
    while (pts.length < this.n) pts.push([SX0 + ((pts.length + 0.5) / this.n) * (SX1 - SX0), (SY0 + SY1) / 2]);
    // nearest-neighbour ordering from the leftmost star
    const left = pts.reduce((bi, p, i) => (p[0] < pts[bi][0] ? i : bi), 0);
    const order: V[] = [pts[left]];
    const rest = pts.filter((_, i) => i !== left);
    while (rest.length) {
      const last = order[order.length - 1];
      let bi = 0, bd = Infinity;
      rest.forEach((p, i) => { const d = Math.hypot(p[0] - last[0], p[1] - last[1]); if (d < bd) { bd = d; bi = i; } });
      order.push(rest.splice(bi, 1)[0]);
    }
    this.stars = order.map((p) => ({ base: p, ph: rng.range(0, 6.28), ph2: rng.range(0, 6.28) }));
    for (let i = 0; i < 90; i++) this.field.push({ x: rng.range(0, MW), y: rng.range(0, MH), b: rng.range(0.15, 0.7), ph: rng.range(0, 6.28) });
    this.cursor = [...this.starPos(0)] as V;
    env.onStatus?.(`Star 1 / ${this.n}`);
  }

  private starPos(i: number): V {
    const s = this.stars[i];
    if (!s) return [MW / 2, MH / 2];
    const fz = this.frozen[i];
    if (fz) return fz;
    let A = this.driftA;
    if (this.env.quirk === 'bursts') A *= 0.6 + 0.8 * (0.5 + 0.5 * Math.sin(this.t * 1.7));
    return [s.base[0] + Math.sin(this.t * 0.35 + s.ph) * A, s.base[1] + Math.cos(this.t * 0.28 + s.ph2) * A * 0.8];
  }

  // ------------------------------------------------------------ update
  protected update(dt: number) {
    this.hintCool = Math.max(0, this.hintCool - dt);
    for (const f of this.fade) f.life -= dt * 1.5;
    this.fade = this.fade.filter((f) => f.life > 0);
    if (this.cur >= this.n - 1) return;
    const p: V = [this.pointer.x, this.pointer.y];
    const moved = p[0] !== this.lastP[0] || p[1] !== this.lastP[1];
    this.lastP = p;
    // keyboard cursor
    const ax = this.axisX(), ay = this.axisY();
    if (ax || ay) {
      if (!this.kb) { this.kb = true; this.path = [[...this.cursor] as V]; }
      this.kbHold += dt;
      const sp = (60 + 110 * clamp(this.kbHold / 1)) * (this.isDown('ShiftLeft', 'ShiftRight') ? 0.4 : 1);
      const n = Math.hypot(ax, ay) || 1;
      this.cursor = [clamp(this.cursor[0] + (ax / n) * sp * dt, 4, MW - 4), clamp(this.cursor[1] + (ay / n) * sp * dt, 4, MH - 4)];
      this.path.push([...this.cursor] as V);
    } else this.kbHold = 0;
    if (moved && this.kb && !(ax || ay)) this.kb = false;
    if (moved && !this.kb) this.cursor = p;
    if (this.pointer.justDown) { this.kb = false; this.cursor = p; }

    if (this.kb) {
      if (this.wasPressed('Space', 'Enter')) {
        this.tryLink(this.cursor, this.path.length > 1 ? this.path : [this.starPos(this.cur), this.cursor]);
        this.path = [[...this.cursor] as V];
      }
      return;
    }
    // pointer
    const from = this.starPos(this.cur);
    if (this.pointer.justDown) {
      if (Math.hypot(p[0] - from[0], p[1] - from[1]) <= this.grabR) {
        this.dragging = true;
        this.path = [from, p];
        this.env.audio.sfx('sparkle', { volume: 0.35, pitch: 1.2 });
      } else if (this.hintCool <= 0) {
        this.hintCool = 1;
        this.floatText('Begin at the bright star', p[0], p[1] - 14, COLORS.cool);
      }
    }
    if (this.dragging && this.pointer.down && moved) {
      this.path.push(p);
      if (Math.random() < 0.4) this.spawn(p[0], p[1], { n: 1, spread: 16, vy: -6, life: 0.5, color: this.glow, size: 1, g: 0 });
    }
    if (this.dragging && this.pointer.justUp) {
      this.dragging = false;
      this.tryLink(p, this.path);
      this.path = [];
    }
  }

  private tryLink(at: V, path: V[]) {
    const from = this.starPos(this.cur);
    const target = this.starPos(this.cur + 1);
    const d = Math.hypot(at[0] - target[0], at[1] - target[1]);
    const capture = this.tol * 2.6 + this.missesHere * 6;
    const later = this.cur + 2 < this.n ? this.starPos(this.cur + 2) : null;
    if (d <= capture || this.missesHere >= 6) {
      const precision = d <= capture ? clamp(1 - Math.max(0, d / this.tol - 0.2) / 1.8) : 0.2;
      const smooth = this.smoothness(from, at, path);
      if (!this.points.length) this.points.push(skyToTU(from[0], from[1]));
      this.points.push(skyToTU(target[0], target[1]));
      this.links.push({ from, to: target, precision, smooth });
      this.frozen[this.cur] = [...from] as V;
      this.frozen[this.cur + 1] = [...target] as V;
      this.cur++;
      this.missesHere = 0;
      this.env.audio.sfx('star', { pitch: 0.8 + this.cur * 0.08 });
      this.spawn(target[0], target[1], { n: 14, spread: 70, vy: 0, life: 0.8, color: this.glow, size: 2, g: 0 });
      this.spawn(target[0], target[1], { n: 6, spread: 40, vy: 0, life: 0.6, color: '#ffffff', size: 1, g: 0 });
      const q = precision * 0.7 + smooth * 0.3;
      this.floatText(q > 0.9 ? 'Radiant!' : q > 0.7 ? 'Bright' : q > 0.45 ? 'Glimmer' : 'Faint', target[0], target[1] - 16, q > 0.9 ? COLORS.gold : q > 0.7 ? '#cfe4ff' : COLORS.paper);
      this.cursor = [...target] as V;
      this.env.onStatus?.(`Star ${Math.min(this.n, this.cur + 1)} / ${this.n}`);
      if (this.cur >= this.n - 1) this.complete();
      return;
    }
    if (later && Math.hypot(at[0] - later[0], at[1] - later[1]) <= capture) {
      this.orderSlips++;
      this.env.audio.sfx('soft');
      this.floatText('Not yet — that one comes later', at[0], at[1] - 14, COLORS.cool);
    } else {
      this.misses++;
      this.missesHere++;
      this.env.audio.sfx('soft', { volume: 0.6 });
      this.floatText('The light fades…', at[0], at[1] - 14, COLORS.dim);
    }
    this.fade.push({ a: from, b: at, life: 1 });
  }

  /** 1 = a calm straight stroke; falls with mean perpendicular wander and wobble. */
  private smoothness(a: V, b: V, path: V[]): number {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (path.length < 3 || L < 4) return 0.85;
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    const devs = path.map((p) => Math.abs((p[0] - a[0]) * nx + (p[1] - a[1]) * ny));
    const wander = mean(devs) / Math.max(8, L * 0.1);
    let wob = 0;
    for (let i = 2; i < path.length; i++) wob += Math.hypot(path[i][0] - 2 * path[i - 1][0] + path[i - 2][0], path[i][1] - 2 * path[i - 1][1] + path[i - 2][1]);
    const wobble = wob / Math.max(1, path.length - 2) / 6;
    return clamp(1 - wander * 0.7 - wobble * 0.3 * this.tune(0.7, 1.2));
  }

  private complete() {
    const precision = mean(this.links.map((l) => l.precision));
    const smoothness = mean(this.links.map((l) => l.smooth));
    const order = 1 - clamp(this.orderSlips * 0.15 + this.misses * 0.05);
    const score = clamp(precision * 0.6 + smoothness * 0.25 + order * 0.15);
    const brightness = Math.round(clamp(0.35 + 0.65 * score) * 1000) / 1000;
    const points = this.points.map(([t, u]) => [Math.round(t * 1000) / 1000, Math.round(u * 1000) / 1000] as V);
    const fin = cloneItem(this.env.item);
    fin.decoration.constellation = { points, brightness };
    this.finalCanvas = this.sprite(fin);
    this.env.audio.sfx('sparkle');
    this.env.audio.sfx('success');
    for (const l of this.links) this.spawn(l.to[0], l.to[1], { n: 8, spread: 50, vy: -10, life: 1, color: this.glow, size: 1, g: 0 });
    const g = gradeOf(score);
    this.finish({
      score,
      details: { precision, smoothness, order, misses: this.misses },
      data: { points, brightness },
      summary: `${g} infusion — ${precision > 0.85 ? 'every star caught at its heart' : precision > 0.6 ? 'a clear, steady constellation' : 'a soft, hazy constellation'}${this.orderSlips ? ', after a little wandering' : ''}.`,
    }, 1.6);
  }

  // ------------------------------------------------------------ draw
  private drawPiece(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, alpha: number) {
    const item = this.env.item;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.imageSmoothingEnabled = false;
    if (item.blade) {
      const lay = bladeLayout(item);
      const len = Math.max(1, item.blade.length);
      const s = clamp(Math.floor((SX1 - SX0) / ((T1 - T0) * len)), 2, 6);
      // place t = 0.35 at the sky centre (rotated: guard left, tip right)
      const midY = lay.bladeBase - 0.35 * len + 0.5, midX = lay.cx + 0.5;
      const cx = Math.round((SX0 + SX1) / 2 + (midY - img.height / 2) * s), cy = Math.round((SY0 + SY1) / 2 - (midX - img.width / 2) * s);
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -(img.width * s) / 2, -(img.height * s) / 2, img.width * s, img.height * s);
    } else {
      ctx.translate(MW / 2, Math.round((SY0 + SY1) / 2));
      ctx.drawImage(img, -img.width, -img.height, img.width * 2, img.height * 2);
    }
    ctx.restore();
  }

  protected draw(ctx: CanvasRenderingContext2D) {
    const g = ctx.createLinearGradient(0, 0, 0, MH);
    g.addColorStop(0, '#07081a');
    g.addColorStop(1, '#1c1430');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, MW, MH);
    // the piece beneath the sky
    this.drawPiece(ctx, this.finalCanvas ?? this.sprite(), this.finalCanvas ? 0.85 : 0.32);
    // star field
    for (const f of this.field) {
      const tw = this.reducedMotion ? 0.8 : 0.6 + 0.4 * Math.sin(this.t * 1.6 + f.ph);
      ctx.fillStyle = `rgba(220,230,255,${f.b * tw})`;
      ctx.fillRect(Math.round(f.x), Math.round(f.y), 1, 1);
    }
    // faded misses
    for (const f of this.fade) this.lightLine(ctx, f.a, f.b, f.life * 0.5, false);
    // links
    for (const l of this.links) this.lightLine(ctx, l.from, l.to, 0.5 + 0.5 * l.precision, true);
    // current drag / keyboard aim
    if (!this.finished && this.cur < this.n - 1) {
      const from = this.starPos(this.cur);
      if (this.dragging && this.path.length > 1) {
        ctx.strokeStyle = 'rgba(200,220,255,0.18)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.path[0][0], this.path[0][1]);
        for (const q of this.path) ctx.lineTo(q[0], q[1]);
        ctx.stroke();
        this.lightLine(ctx, from, [this.pointer.x, this.pointer.y], 0.7, false);
      } else if (this.kb) this.lightLine(ctx, from, this.cursor, 0.5, false);
    }
    // stars
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 3);
    for (let i = 0; i < this.n; i++) {
      const p = this.starPos(i);
      if (i <= this.cur) this.drawStar(ctx, p, i === this.cur && !this.finished ? 1 : 0.85, i === this.cur && !this.finished ? COLORS.gold : '#ffffff', 4 + (i === this.cur ? pulse * 2 : 0));
      else if (i === this.cur + 1) {
        const fl = this.env.quirk === 'flicker' ? (Math.sin(this.t * 5.1) > 0.3 ? 0.25 : 1) : 1;
        this.softGlow(ctx, p, 14, (0.25 + 0.2 * pulse) * fl);
        ctx.fillStyle = `rgba(230,240,255,${0.55 * fl})`;
        ctx.fillRect(Math.round(p[0]) - 1, Math.round(p[1]) - 1, 2, 2);
        // tolerance hint ring at easier levels
        if (this.env.difficulty < 2) {
          ctx.strokeStyle = `rgba(200,220,255,${0.12 * fl})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p[0], p[1], this.tol, 0, Math.PI * 2); ctx.stroke();
        }
      } else if (i === this.cur + 2) this.softGlow(ctx, p, 7, 0.08 + 0.05 * Math.sin(this.t * 2.2 + i));
    }
    // keyboard cursor
    if (this.kb && !this.finished) {
      const [x, y] = this.cursor.map(Math.round);
      ctx.fillStyle = 'rgba(255,240,200,0.9)';
      ctx.fillRect(x - 4, y, 3, 1); ctx.fillRect(x + 2, y, 3, 1); ctx.fillRect(x, y - 4, 1, 3); ctx.fillRect(x, y + 2, 1, 3);
    }
  }

  private lightLine(ctx: CanvasRenderingContext2D, a: V, b: V, alpha: number, solid: boolean) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.glow;
    ctx.globalAlpha = 0.12 * alpha;
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    ctx.globalAlpha = 0.45 * alpha;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (solid) {
      ctx.globalAlpha = 0.8 * alpha;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  private softGlow(ctx: CanvasRenderingContext2D, p: V, r: number, a: number) {
    const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], r);
    g.addColorStop(0, `rgba(210,225,255,${clamp(a)})`);
    g.addColorStop(1, 'rgba(210,225,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(p[0] - r, p[1] - r, r * 2, r * 2);
  }

  private drawStar(ctx: CanvasRenderingContext2D, p: V, a: number, col: string, glint: number) {
    this.softGlow(ctx, p, 12, 0.35 * a);
    const x = Math.round(p[0]), y = Math.round(p[1]);
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    ctx.fillRect(x - 1, y - 1, 3, 3);
    ctx.globalAlpha = a * 0.6;
    const gl = Math.round(glint);
    ctx.fillRect(x - gl, y, gl * 2 + 1, 1);
    ctx.fillRect(x, y - gl, 1, gl * 2 + 1);
    ctx.globalAlpha = 1;
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    this.text('Starlight infusion', MW / 2, 12, { size: 10, align: 'center', color: '#cfe4ff' });
    this.text('Drag a line of light from the bright star to the next glow • arrows + Space', MW / 2, 26, { size: 8, align: 'center', color: COLORS.paper });
    this.text(`Star ${Math.min(this.n, this.cur + 1)} / ${this.n}`, 12, MH - 14, { size: 10, color: COLORS.paper });
    const pr = this.links.length ? mean(this.links.map((l) => l.precision)) : 0;
    this.text(`Brilliance ${Math.round(pr * 100)}%`, MW - 12, MH - 14, { size: 10, align: 'right', color: COLORS.paper });
  }
}

export const constellationGame: MinigameDef = {
  id: 'constellation',
  name: 'Starlight Infusion',
  controls: 'Press on the bright star, drag, release on the next. Keyboard: arrows move, Space links.',
  instructions: () => [
    'A constellation wakes above the metal, one star at a time.',
    'Draw a line of light from the bright star to the next glow — release right on its heart.',
    'Calm, straight strokes shine brightest. The stars drift; there is no hurry.',
  ],
  create: (env) => new Constellation(env),
};
