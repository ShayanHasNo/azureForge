// Glassgarden crystal annealing. A target cooling curve (gentle descents,
// plateaus and soft steps — more segments and steps at higher difficulty)
// scrolls right-to-left across a graph. The player steers the kiln temperature
// line, which has thermal inertia:
//  - pointer: hold anywhere and move vertically; the temperature follows like a
//    damped spring,
//  - keyboard: Up/Down or W/S push the temperature (with momentum).
// The crystal (the item sprite) visibly clears and sparkles while on the curve,
// and clouds over with crackle particles when far off it.
// Score = mean closeness to the curve (10 Hz samples) + smoothness (penalises
// jitter: the second difference of the tracking error).
//
// data: {}   details: closeness, smoothness, onCurve, clarity

import { seededRng } from '../core/rng';
import { clamp, mean, smoothstep } from '../core/util';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

type SegKind = 'lead' | 'descend' | 'plateau' | 'step' | 'rewarm';
interface Seg { kind: SegKind; t0: number; dur: number; from: number; to: number }
interface Twinkle { x: number; y: number; life: number; max: number }

const GX0 = 152, GX1 = 466, GY0 = 36, GY1 = 214;
const SAMPLE_DT = 0.1;

class Anneal extends BaseMinigame {
  private rng = seededRng(this.env.item.seed, 'anneal');
  private segs: Seg[] = [];
  private duration: number;
  private time = 0;
  private p: number;
  private v = 0;
  private tol: number;
  private pastWin = 3.5;
  private futWin: number;
  // scoring
  private sampleAcc = 0;
  private errs: number[] = [];
  private closes: number[] = [];
  private onCount = 0;
  private trail: { time: number; p: number }[] = [];
  private streak = 0;
  // crystal feedback
  private cloud = 0.35;
  private claritySum = 0;
  private clarityN = 0;
  private spr: HTMLCanvasElement;
  private sprScale: number;
  private sprX = 72;
  private sprY = 132;
  private tint: HTMLCanvasElement;
  private tintCtx: CanvasRenderingContext2D;
  private opaque: [number, number][] = [];
  private twinkles: Twinkle[] = [];
  private crackleCd = 0;
  private loopOn = false;
  private lastPct = -1;

  constructor(env: MinigameEnv) {
    super(env);
    this.duration = this.tune(28, 34);
    this.tol = this.tune(0.075, 0.036) * (env.quirk === 'bursts' ? 1.3 : 1);
    this.futWin = this.tune(9, 5.5);
    this.buildCurve();
    this.p = this.segs[0].from;
    this.spr = this.sprite();
    this.sprScale = this.spr.height * 2 <= 240 && this.spr.width * 2 <= 124 ? 2 : 1;
    this.tint = document.createElement('canvas');
    this.tint.width = this.spr.width;
    this.tint.height = this.spr.height;
    this.tintCtx = this.tint.getContext('2d')!;
    try {
      const ictx = this.tint.getContext('2d')!;
      ictx.drawImage(this.spr, 0, 0);
      const d = ictx.getImageData(0, 0, this.spr.width, this.spr.height).data;
      for (let y = 0; y < this.spr.height; y += 2)
        for (let x = 0; x < this.spr.width; x += 1)
          if (d[(y * this.spr.width + x) * 4 + 3] > 128) this.opaque.push([x, y]);
    } catch { /* ignore: sparkles fall back to the sprite box */ }
    env.onStatus?.('Annealing 0%');
  }

  // ------------------------------------------------------------ curve
  private buildCurve() {
    const D = this.duration;
    const lead = 2.5;
    const start = this.rng.range(0.8, 0.88), end = this.rng.range(0.1, 0.18);
    const n = Math.round(this.tune(4, 8));
    const kinds: SegKind[] = [];
    const stepChance = this.tune(0.15, 0.45);
    for (let i = 0; i < n; i++) {
      const prev = kinds[i - 1];
      let k: SegKind;
      if (prev === 'plateau' || prev === 'step' || prev === 'rewarm') k = 'descend';
      else if (this.rng.chance(stepChance)) k = 'step';
      else if (this.rng.chance(0.45)) k = 'plateau';
      else k = 'descend';
      if (this.env.difficulty >= 3.2 && prev === 'descend' && this.rng.chance(0.25)) k = 'rewarm';
      kinds.push(k);
    }
    if (!kinds.some((k) => k === 'descend' || k === 'step')) kinds[0] = 'descend';
    // durations
    const w = kinds.map((k) => (k === 'step' ? this.rng.range(0.4, 0.6) : k === 'plateau' ? this.rng.range(0.7, 1.1) : k === 'rewarm' ? 0.6 : this.rng.range(0.9, 1.5)));
    const wsum = w.reduce((a, b) => a + b, 0) || 1;
    // drops
    const dw = kinds.map((k) => (k === 'step' ? this.rng.range(0.9, 1.3) : k === 'descend' ? this.rng.range(0.8, 1.2) : 0));
    const dsum = dw.reduce((a, b) => a + b, 0) || 1;
    const rewarmCount = kinds.filter((k) => k === 'rewarm').length;
    const rewarm = 0.05;
    const totalDrop = start - end + rewarmCount * rewarm;
    this.segs.push({ kind: 'lead', t0: 0, dur: lead, from: start, to: start });
    let t = lead, temp = start;
    kinds.forEach((k, i) => {
      const dur = ((D - lead) * w[i]) / wsum;
      let to = temp;
      if (k === 'descend' || k === 'step') to = temp - (totalDrop * dw[i]) / dsum;
      if (k === 'rewarm') to = temp + rewarm;
      to = clamp(to, 0.05, 0.95);
      this.segs.push({ kind: k, t0: t, dur, from: temp, to });
      t += dur; temp = to;
    });
  }

  private target(time: number): number {
    const tt = clamp(time, 0, this.duration);
    let seg = this.segs[this.segs.length - 1];
    for (const s of this.segs) if (tt < s.t0 + s.dur) { seg = s; break; }
    const k = seg.dur > 0 ? clamp((tt - seg.t0) / seg.dur) : 1;
    let e: number;
    if (seg.kind === 'step') {
      // a soft step: hold, a quick smooth drop in the middle third, hold
      e = smoothstep(0.3, 0.7, k);
    } else if (seg.kind === 'descend') e = 0.5 * k + 0.5 * smoothstep(0, 1, k);
    else e = smoothstep(0, 1, k);
    let v = seg.from + (seg.to - seg.from) * e;
    if (this.env.quirk === 'drifting') v += Math.sin(time * 0.35) * 0.03;
    return clamp(v, 0.02, 0.98);
  }

  // ------------------------------------------------------------ helpers
  private ty(v: number) { return GY1 - clamp(v) * (GY1 - GY0); }
  private tFromY(y: number) { return clamp((GY1 - y) / (GY1 - GY0)); }
  private pps() { return (GX1 - GX0) / (this.pastWin + this.futWin); }
  private nowX() { return GX0 + this.pastWin * this.pps(); }
  private sx(x: number) { return this.mirrored ? MW - x : x; }

  private closeness(d: number) {
    const w = this.tol;
    if (d <= w) return 1 - 0.25 * (d / w) * (d / w);
    return 0.75 * Math.max(0, 1 - (d - w) / (w * 2.5));
  }

  // ------------------------------------------------------------ update
  protected update(dt: number) {
    const rate = this.env.quirk === 'bursts' ? 0.7 + 0.6 * (0.5 + 0.5 * Math.sin(this.t * 1.3)) : 1;
    this.time += dt * rate;
    this.crackleCd = Math.max(0, this.crackleCd - dt);

    // --- kiln temperature with inertia
    const axis = (this.isDown('ArrowUp', 'KeyW') ? 1 : 0) - (this.isDown('ArrowDown', 'KeyS') ? 1 : 0);
    if (this.pointer.down) {
      const desired = this.tFromY(this.pointer.y);
      this.v += ((desired - this.p) * 38 - this.v * 11.5) * dt;
    } else if (axis !== 0) {
      this.v += axis * 1.4 * dt;
      this.v -= this.v * 3 * dt;
    } else {
      this.v -= this.v * 3 * dt;
      this.v -= 0.012 * dt; // the kiln drifts gently cooler on its own
    }
    this.v = clamp(this.v, -0.8, 0.8);
    this.p += this.v * dt;
    if (this.p < 0) { this.p = 0; this.v = 0; }
    if (this.p > 1) { this.p = 1; this.v = 0; }

    const T = this.target(this.time);
    const d = Math.abs(this.p - T);

    // --- sampling for score
    this.sampleAcc += dt * rate;
    while (this.sampleAcc >= SAMPLE_DT) {
      this.sampleAcc -= SAMPLE_DT;
      this.errs.push(this.p - T);
      const c = this.closeness(d);
      this.closes.push(c);
      if (d <= this.tol) this.onCount++;
      this.trail.push({ time: this.time, p: this.p });
      if (this.trail.length > 80) this.trail.shift();
      this.claritySum += 1 - this.cloud;
      this.clarityN++;
    }

    // --- crystal response
    const goalCloud = clamp((d - this.tol * 0.5) / (this.tol * 3));
    this.cloud += (goalCloud - this.cloud) * Math.min(1, dt * 1.4);
    if (d <= this.tol) {
      this.streak += dt;
      if (!this.reducedMotion && Math.random() < dt * 6 * (1 - this.cloud)) this.addTwinkle();
      if (this.streak >= 3) {
        this.streak = 0;
        this.env.audio.sfx('sparkle', { volume: 0.5, pitch: 0.9 + Math.random() * 0.3 });
        this.floatText('Clear', this.sx(this.sprX), 30, COLORS.cool);
      }
    } else {
      this.streak = 0;
      if (d > this.tol * 2.4 && this.crackleCd <= 0) {
        this.crackleCd = 0.7;
        const [x, y] = this.randomSpritePoint();
        this.spawn(x, y, { n: 4, vy: -10, spread: 50, life: 0.5, color: '#e8f4f0', size: 1, g: 120 });
        this.env.audio.sfx('glass', { volume: 0.25, pitch: 0.7 + Math.random() * 0.4 });
        if (Math.random() < 0.35) this.floatText(this.p > T ? 'Too warm…' : 'Too cool…', this.sx(this.sprX), 30, COLORS.dim);
      }
    }
    for (const tw of this.twinkles) tw.life -= dt;
    this.twinkles = this.twinkles.filter((tw) => tw.life > 0);

    // audio + status
    this.env.audio.loop('heat', true, 0.1 + this.p * 0.5);
    this.loopOn = true;
    const pct = Math.floor((this.time / this.duration) * 10) * 10;
    if (pct !== this.lastPct) { this.lastPct = pct; this.env.onStatus?.(`Annealing ${Math.min(100, pct)}%`); }

    if (this.time >= this.duration) this.complete();
  }

  private randomSpritePoint(): [number, number] {
    const s = this.sprScale;
    const ox = this.sprX - (this.spr.width * s) / 2, oy = this.sprY - (this.spr.height * s) / 2;
    if (this.opaque.length) {
      const [px, py] = this.opaque[Math.floor(Math.random() * this.opaque.length)];
      return [ox + px * s, oy + py * s];
    }
    return [ox + Math.random() * this.spr.width * s, oy + Math.random() * this.spr.height * s];
  }

  private addTwinkle() {
    const [x, y] = this.randomSpritePoint();
    this.twinkles.push({ x, y, life: 0.6, max: 0.6 });
  }

  private complete() {
    if (this.loopOn) { this.env.audio.loop('heat', false); this.loopOn = false; }
    const closeness = mean(this.closes);
    // jitter: second difference of the tracking error, per sample
    let j = 0, jn = 0;
    for (let i = 2; i < this.errs.length; i++) { j += Math.abs(this.errs[i] - 2 * this.errs[i - 1] + this.errs[i - 2]); jn++; }
    const jitter = jn ? j / jn : 0;
    const smoothness = clamp(1 - jitter / 0.02);
    const onCurve = this.closes.length ? this.onCount / this.closes.length : 0;
    const clarity = this.clarityN ? this.claritySum / this.clarityN : 0;
    const score = clamp(closeness * 0.75 + smoothness * 0.25);
    this.env.audio.sfx('success');
    const g = gradeOf(score);
    this.finish({
      score,
      details: { closeness, smoothness, onCurve, clarity },
      data: {},
      summary: `${g} annealing — the crystal cooled ${onCurve > 0.75 ? 'right along its curve' : onCurve > 0.5 ? 'mostly on its curve' : 'a little unevenly'} and came out ${clarity > 0.75 ? 'beautifully clear' : clarity > 0.5 ? 'fairly clear' : 'slightly cloudy'}.`,
    });
  }

  protected onDestroy() {
    if (this.loopOn) { this.env.audio.loop('heat', false); this.loopOn = false; }
  }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.25 + this.p * 0.4, '#1c2a28');
    this.drawCrystal(ctx);
    this.drawGraph(ctx);
  }

  private drawCrystal(ctx: CanvasRenderingContext2D) {
    // a cool glass-house pedestal
    this.panel(8, 22, 128, 226, 'rgba(14,30,28,0.7)', '#2e5a4e');
    ctx.fillStyle = '#20403a';
    ctx.fillRect(28, 226, 88, 8);
    const spr = this.spr;
    const t = this.tintCtx;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, spr.width, spr.height);
    t.drawImage(spr, 0, 0);
    t.globalCompositeOperation = 'source-atop';
    // milky cloudiness when off-curve, a cool clear sheen when on it
    t.globalAlpha = this.cloud * 0.62;
    t.fillStyle = '#dfe8e4';
    t.fillRect(0, 0, spr.width, spr.height);
    const heatA = smoothstep(0.5, 1, this.p) * 0.35;
    if (heatA > 0) { t.globalAlpha = heatA; t.fillStyle = '#ff9a50'; t.fillRect(0, 0, spr.width, spr.height); }
    t.globalAlpha = 1;
    t.globalCompositeOperation = 'source-over';
    // soft halo when clear
    const clear = 1 - this.cloud;
    const halo = ctx.createRadialGradient(this.sprX, this.sprY, 4, this.sprX, this.sprY, 90);
    halo.addColorStop(0, `rgba(160,236,200,${0.25 * clear})`);
    halo.addColorStop(1, 'rgba(160,236,200,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(8, 22, 128, 226);
    this.drawSprite(this.tint, this.sprX, this.sprY, this.sprScale);
    // twinkles (4-point stars)
    for (const tw of this.twinkles) {
      const a = clamp(tw.life / tw.max);
      const r = a > 0.5 ? 2 : 1;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(Math.round(tw.x) - r, Math.round(tw.y), r * 2 + 1, 1);
      ctx.fillRect(Math.round(tw.x), Math.round(tw.y) - r, 1, r * 2 + 1);
    }
    // clarity meter
    this.bar(24, 240, 96, 4, clear, clear > 0.7 ? COLORS.cool : clear > 0.4 ? COLORS.ok : COLORS.dim);
  }

  private drawGraph(ctx: CanvasRenderingContext2D) {
    this.panel(GX0 - 6, GY0 - 8, GX1 - GX0 + 12, GY1 - GY0 + 16, 'rgba(14,24,26,0.78)', '#3a5a5a');
    // grid
    ctx.fillStyle = 'rgba(160,200,200,0.08)';
    for (let i = 1; i < 5; i++) ctx.fillRect(GX0, Math.round(GY0 + ((GY1 - GY0) * i) / 5), GX1 - GX0, 1);
    const pps = this.pps();
    const nowX = this.nowX();
    const gridOff = (this.time * pps) % 40;
    for (let x = GX0 + 40 - gridOff; x < GX1; x += 40) ctx.fillRect(Math.round(x), GY0, 1, GY1 - GY0);
    // past shading
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(GX0, GY0, nowX - GX0, GY1 - GY0);

    const flicker = this.env.quirk === 'flicker' && Math.sin(this.t * 5.7) > 0.5;
    // tolerance ribbon + curve
    const tolPx = this.tol * (GY1 - GY0);
    for (let x = GX0; x <= GX1; x += 2) {
      const time = this.time + (x - nowX) / pps;
      if (time < 0 || time > this.duration) continue;
      if (flicker && x > nowX + 8) continue;
      const y = this.ty(this.target(time));
      ctx.fillStyle = x >= nowX ? 'rgba(143,209,106,0.16)' : 'rgba(143,209,106,0.07)';
      ctx.fillRect(x, Math.round(y - tolPx), 2, Math.round(tolPx * 2));
      ctx.fillStyle = x >= nowX ? COLORS.gold : 'rgba(240,200,96,0.45)';
      ctx.fillRect(x, Math.round(y), 2, 2);
    }
    // finish line
    const endX = nowX + (this.duration - this.time) * pps;
    if (endX < GX1) {
      ctx.fillStyle = 'rgba(160,236,200,0.5)';
      for (let y = GY0; y < GY1; y += 6) ctx.fillRect(Math.round(endX), y, 1, 3);
    }
    // player trail
    ctx.fillStyle = COLORS.cool;
    let prev: { x: number; y: number } | null = null;
    for (const s of this.trail) {
      const x = nowX + (s.time - this.time) * pps;
      if (x < GX0) { prev = null; continue; }
      const y = this.ty(s.p);
      if (prev) {
        // draw a short pixel line between samples
        const steps = Math.max(1, Math.ceil(Math.abs(x - prev.x)));
        for (let k = 0; k <= steps; k++) {
          const xx = prev.x + ((x - prev.x) * k) / steps, yy = prev.y + ((y - prev.y) * k) / steps;
          ctx.fillRect(Math.round(xx), Math.round(yy), 1, 2);
        }
      }
      prev = { x, y };
    }
    // now line + player handle
    ctx.fillStyle = 'rgba(255,244,220,0.25)';
    ctx.fillRect(Math.round(nowX), GY0, 1, GY1 - GY0);
    const py = Math.round(this.ty(this.p));
    if (prev) {
      const steps = Math.max(1, Math.ceil(Math.abs(nowX - prev.x)));
      ctx.fillStyle = COLORS.cool;
      for (let k = 0; k <= steps; k++) ctx.fillRect(Math.round(prev.x + ((nowX - prev.x) * k) / steps), Math.round(prev.y + ((py - prev.y) * k) / steps), 1, 2);
    }
    const on = Math.abs(this.p - this.target(this.time)) <= this.tol;
    ctx.fillStyle = on ? COLORS.good : COLORS.cream;
    ctx.fillRect(Math.round(nowX) - 3, py - 3, 7, 7);
    ctx.fillStyle = COLORS.ink;
    ctx.fillRect(Math.round(nowX) - 1, py - 1, 3, 3);
    // kiln dial on the left edge of the graph
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(GX0 - 4, GY0, 3, GY1 - GY0);
    ctx.fillStyle = COLORS.ember;
    ctx.fillRect(GX0 - 4, py, 3, GY1 - py);
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    const prog = this.time / this.duration;
    this.panel(196, 4, 228, 22);
    this.bar(206, 17, 208, 4, prog, COLORS.cool);
    this.text('Follow the cooling curve', 310, 10, { size: 9, align: 'center', color: COLORS.paper });
    this.text('warm', this.sx(GX0 + 16), GY0 + 6, { size: 8, align: 'center', color: COLORS.dim });
    this.text('cool', this.sx(GX0 + 16), GY1 - 6, { size: 8, align: 'center', color: COLORS.dim });
    const clear = 1 - this.cloud;
    this.text(`Clarity ${Math.round(clear * 100)}%`, this.sx(72), 14, { size: 9, align: 'center', color: clear > 0.7 ? COLORS.cool : COLORS.paper });
    this.text('Hold & move up/down, or Up/Down (W/S) — glide smoothly along the gold line', MW / 2, MH - 10, { size: 9, align: 'center', color: COLORS.paper });
  }
}

export const annealGame: MinigameDef = {
  id: 'anneal',
  name: 'Annealing',
  controls: 'Hold the mouse / finger and move up and down, or use Up/Down (W/S). The kiln has inertia — glide, don\'t jerk.',
  instructions: () => [
    'Crystal must cool slowly along its curve. Keep your temperature line on the gold curve as it scrolls by.',
    'Smooth, steady movements matter as much as accuracy — the crystal clears and sparkles when you are on the curve.',
  ],
  create: (env) => new Anneal(env),
};
