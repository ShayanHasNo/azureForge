// Engraving by tracing. The blade is shown enlarged (rotated so the guard is on
// the left) with the engraving guide from engravingPaths(pattern, seed) mapped
// through bladePixel — exactly the geometry the renderer will cut. Shields map
// the guide around the face ring as the renderer does.
//
// Pointer: press on the glowing start dot of each stroke and trace it with the
// button held. Releasing mid-stroke, or straying far off the guide, is a slip
// (recorded at that sample index); come back to the pulsing point to resume.
// Keyboard: Space starts a stroke, the graver then advances along the guide by
// itself while the grain tugs it sideways — steer with the arrows to stay on
// the line. Same measurement either way.
//
// Each sample point of the guide records the signed perpendicular deviation of
// the graver (projected on the +u side of the blade) divided by a tolerance
// from tune(). Only the first MAX_TRACED strokes are traced by hand; samples of
// any remaining strokes (and of strokes skipped via "Finish") are filled
// deterministically from the player's own performance: a seeded smooth random
// walk around the mean signed deviation with the mean absolute spread.
//
// data: { jitter: number[] (one per sample, all paths in engravingPaths order,
//          -1..1), slips: number[] (global sample indexes), crispness: 0..1 }
// details: accuracy, smoothness, completion, slips

import { seededRng } from '../core/rng';
import { clamp, mean } from '../core/util';
import { cloneItem } from '../item/factory';
import { engravingPaths, type Path } from '../item/patterns';
import type { Item } from '../item/types';
import { bladePixel, shieldLayout } from '../render/itemRenderer';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

const MAX_TRACED = 12;

// ------------------------------------------------------------ sprite <-> screen
interface Xf { cx: number; cy: number; s: number; rot: boolean; W: number; H: number }
function s2scr(xf: Xf, sx: number, sy: number): [number, number] {
  const lx = (sx - xf.W / 2) * xf.s, ly = (sy - xf.H / 2) * xf.s;
  return xf.rot ? [xf.cx - ly, xf.cy + lx] : [xf.cx + lx, xf.cy + ly];
}
/** Renderer-style sprite coordinate (pixel = Math.round(coord)) → screen. */
const spriteToScreen = (xf: Xf, x: number, y: number) => s2scr(xf, x + 0.5, y + 0.5);

type V = [number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1];
const len = (a: V) => Math.hypot(a[0], a[1]);
const norm = (a: V): V => { const l = len(a); return l > 1e-9 ? [a[0] / l, a[1] / l] : [0, 0]; };

interface Guide {
  pts: V[]; // base-space screen points
  cum: number[]; // arc length at each point
  total: number;
  normals: V[]; // per-sample unit normal oriented toward +u
  start: number; // global sample index of pts[0]
  traceable: boolean;
}

type State = 'await' | 'cutting' | 'lifted' | 'done';

class Engrave extends BaseMinigame {
  private readonly isShield: boolean;
  private pattern: string;
  private paths: Path[];
  private guides: Guide[] = [];
  private traceList: number[] = []; // indexes of guides traced by hand
  private cur = 0; // position in traceList
  private state: State = 'await';
  private s = 0;
  private next = 0; // next sample index (local) to record
  private prevQ: V = [0, 0];
  private jit: number[];
  private raw: number[]; // raw deviation / tol (unclamped) for scoring
  private slips: number[] = [];
  private cuts: V[][] = [];
  private cutting: V[] | null = null;
  private tol: number;
  private slipT: number;
  private xf: Xf;
  private off: V = [0, 0];
  private preview: Item;
  private previewCanvas: HTMLCanvasElement;
  private kb = false;
  private kbOff: V = [0, 0];
  private kbSpeed: number;
  private driftAmp: number;
  private phase: number;
  private sfxCool = 0;
  private hintCool = 0;
  private graver: V = [MW / 2, MH / 2];
  private loupe: boolean;
  private totalSamples = 0;
  private finishedPaths = 0;
  /** After a stroke ends with the button held, lift before the next stroke can start. */
  private needLift = false;

  constructor(env: MinigameEnv) {
    super(env);
    const item = env.item;
    this.isShield = item.category === 'shield' || !item.blade;
    this.pattern = String(env.params.pattern ?? item.decoration.engraving.pattern ?? 'none');
    this.paths = this.pattern === 'none' ? [] : engravingPaths(this.pattern, item.seed);
    this.totalSamples = this.paths.reduce((n, p) => n + p.length, 0);
    this.jit = new Array(this.totalSamples).fill(NaN);
    this.raw = new Array(this.totalSamples).fill(NaN);
    this.tol = this.tune(9, 4) * (env.quirk === 'bursts' ? 1.3 : 1);
    this.slipT = this.tol * this.tune(3.2, 2.5);
    this.kbSpeed = this.tune(42, 60);
    this.driftAmp = this.tune(14, 28);
    this.phase = seededRng(item.seed, 'engrave-drift').range(0, 6.28);
    this.loupe = env.upgrades.includes('loupe');
    // Preview without the engraving (and without the inscription the renderer would draw instead).
    this.preview = cloneItem(item);
    this.preview.decoration.engraving = { ...this.preview.decoration.engraving, pattern: 'none', jitter: [], slips: [] };
    this.preview.decoration.inscription = '';
    this.previewCanvas = this.sprite(this.preview);
    const W = this.previewCanvas.width, H = this.previewCanvas.height;
    if (this.isShield) {
      const s = 3;
      const sl = this.shieldGeo();
      this.xf = { cx: Math.round(240 - (sl.cx + 0.5 - W / 2) * s), cy: Math.round(140 - (sl.cy + 0.5 - H / 2) * s), s, rot: false, W, H };
    } else {
      const L = Math.max(1, item.blade!.length);
      const s = clamp(Math.floor(400 / (0.56 * L)), 3, 6);
      const [mx, my] = bladePixel(item, 0.335, 0);
      this.xf = { cx: Math.round(240 + (my + 0.5 - H / 2) * s), cy: Math.round(140 - (mx + 0.5 - W / 2) * s), s, rot: true, W, H };
    }
    this.buildGuides();
    const firstTrace = this.traceList[0];
    if (firstTrace !== undefined) this.graver = [...this.guides[firstTrace].pts[0]] as V;
    env.onStatus?.(this.statusText());
  }

  private shieldGeo() {
    const it = this.env.item;
    if (it.shield) return shieldLayout(it);
    return { cx: 43.5, cy: 51, rx: 40, ry: 46, W: 88, H: 104 };
  }

  /** Blade-local (t,u) → base-space screen point, matching the renderer exactly. */
  private map(t: number, u: number): V {
    const item = this.env.item;
    if (this.isShield) {
      const sl = this.shieldGeo();
      const a = ((t - 0.07) / 0.53) * Math.PI * 2 - Math.PI / 2;
      const rr = 0.66 + u * 0.09;
      return spriteToScreen(this.xf, sl.cx + Math.cos(a) * sl.rx * rr, sl.cy + Math.sin(a) * sl.ry * rr);
    }
    const [x, y] = bladePixel(item, t, u);
    return spriteToScreen(this.xf, x, y);
  }

  private buildGuides() {
    let g = 0;
    for (const p of this.paths) {
      const pts = p.map(([t, u]) => this.map(t, u));
      const cum = [0];
      for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + len(sub(pts[k], pts[k - 1])));
      const total = cum[cum.length - 1] ?? 0;
      const normals: V[] = [];
      for (let k = 0; k < pts.length; k++) {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)];
        let tan = norm(sub(b, a));
        if (tan[0] === 0 && tan[1] === 0) tan = [1, 0];
        let n: V = [-tan[1], tan[0]];
        const [t, u] = p[k];
        const ud = norm(sub(this.map(t, u + 0.05), this.map(t, u - 0.05)));
        if (dot(n, ud) < 0) n = [-n[0], -n[1]];
        normals.push(n);
      }
      const traceable = pts.length >= 2 && total >= 2;
      this.guides.push({ pts, cum, total, normals, start: g, traceable });
      g += pts.length;
    }
    for (let i = 0; i < this.guides.length && this.traceList.length < MAX_TRACED; i++) if (this.guides[i].traceable) this.traceList.push(i);
  }

  private get guide(): Guide | undefined {
    const gi = this.traceList[this.cur];
    return gi === undefined ? undefined : this.guides[gi];
  }

  private pointAt(g: Guide, s: number): { p: V; n: V; tan: V } {
    s = clamp(s, 0, g.total);
    let k = 0;
    while (k < g.pts.length - 2 && g.cum[k + 1] < s) k++;
    const a = g.pts[k], b = g.pts[Math.min(k + 1, g.pts.length - 1)];
    const L = g.cum[Math.min(k + 1, g.pts.length - 1)] - g.cum[k];
    const f = L > 1e-9 ? (s - g.cum[k]) / L : 0;
    const tan = norm(sub(b, a));
    let n: V = [-tan[1], tan[0]];
    if (dot(n, g.normals[k]) < 0) n = [-n[0], -n[1]];
    return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], n, tan: tan[0] === 0 && tan[1] === 0 ? [1, 0] : tan };
  }

  /** Closest point on the guide to q, restricted to arc-length window [s0, s1]. */
  private project(g: Guide, q: V, s0: number, s1: number): { s: number; dist: number } {
    let best = { s: clamp(s0, 0, g.total), dist: Infinity };
    for (let k = 0; k < g.pts.length - 1; k++) {
      const c0 = g.cum[k], c1 = g.cum[k + 1];
      if (c1 < s0 || c0 > s1) continue;
      const L = c1 - c0;
      const a = g.pts[k], b = g.pts[k + 1];
      let f = L > 1e-9 ? dot(sub(q, a), sub(b, a)) / (L * L) : 0;
      const fmin = L > 1e-9 ? (s0 - c0) / L : 0, fmax = L > 1e-9 ? (s1 - c0) / L : 1;
      f = clamp(f, Math.max(0, fmin), Math.min(1, fmax));
      const p: V = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      const d = len(sub(q, p));
      if (d < best.dist) best = { s: c0 + f * L, dist: d };
    }
    if (!Number.isFinite(best.dist)) best.dist = len(sub(q, this.pointAt(g, best.s).p));
    return best;
  }

  private statusText() {
    const n = this.traceList.length;
    return n ? `Stroke ${Math.min(n, this.cur + 1)} / ${n}` : 'Nothing to engrave';
  }

  // ------------------------------------------------------------ recording
  private record(g: Guide, k: number, dev: number) {
    const gi = g.start + k;
    if (gi < 0 || gi >= this.jit.length || !Number.isNaN(this.jit[gi])) return;
    const r = dev / this.tol;
    this.raw[gi] = r;
    this.jit[gi] = clamp(r, -1, 1);
    if (this.sfxCool <= 0) {
      this.sfxCool = 0.07;
      this.env.audio.sfx('engrave', { pitch: 0.9 + Math.random() * 0.2, volume: 0.55 });
    }
    if (Math.random() < 0.5) {
      const [x, y] = g.pts[k];
      this.spawn(x + this.off[0], y + this.off[1], { n: 1, spread: 40, vy: -20, life: 0.35, color: Math.abs(r) < 0.5 ? COLORS.gold : '#c0a080', size: 1, g: 60 });
    }
  }

  /** Record every sample crossed while progress moves s → s2, interpolating the graver from q0 → q1. */
  private crossSamples(g: Guide, s: number, s2: number, q0: V, q1: V) {
    while (this.next < g.pts.length && g.cum[this.next] <= s2 + 1e-6) {
      const k = this.next;
      const f = s2 - s > 1e-6 ? clamp((g.cum[k] - s) / (s2 - s)) : 1;
      const qi: V = [q0[0] + (q1[0] - q0[0]) * f, q0[1] + (q1[1] - q0[1]) * f];
      this.record(g, k, dot(sub(qi, g.pts[k]), g.normals[k]));
      this.next++;
    }
  }

  private slip(g: Guide) {
    const idx = g.start + Math.min(this.next, g.pts.length - 1);
    if (!this.slips.includes(idx)) this.slips.push(idx);
    this.state = 'lifted';
    this.endCut();
    this.env.audio.sfx('soft');
    this.floatText('Slip — return to the glow', this.graver[0] + this.off[0], this.graver[1] + this.off[1] - 16, COLORS.ok);
    this.shake(1);
  }

  private beginCut(q: V) {
    this.cutting = [q];
    this.cuts.push(this.cutting);
  }
  private endCut() { this.cutting = null; }

  private completePath(g: Guide, q: V) {
    // any remaining samples get the final deviation
    while (this.next < g.pts.length) {
      const k = this.next;
      this.record(g, k, dot(sub(q, g.pts[k]), g.normals[k]));
      this.next++;
    }
    this.endCut();
    this.finishedPaths++;
    const end = g.pts[g.pts.length - 1];
    this.env.audio.sfx('chime', { pitch: 0.9 + this.cur * 0.03, volume: 0.7 });
    this.sparks(end[0] + this.off[0], end[1] + this.off[1], 8, COLORS.gold);
    const accs = this.pathAccs(g);
    const a = mean(accs);
    this.floatText(a > 0.9 ? 'Crisp!' : a > 0.7 ? 'Clean' : 'Done', end[0] + this.off[0], end[1] + this.off[1] - 14, a > 0.9 ? COLORS.gold : a > 0.7 ? COLORS.good : COLORS.cream);
    this.cur++;
    this.state = 'await';
    this.needLift = this.pointer.down;
    this.kb = false;
    this.kbOff = [0, 0];
    this.env.onStatus?.(this.statusText());
    if (this.cur >= this.traceList.length) this.complete();
  }

  private pathAccs(g: Guide): number[] {
    const out: number[] = [];
    for (let k = 0; k < g.pts.length; k++) {
      const r = this.raw[g.start + k];
      if (!Number.isNaN(r)) out.push(accOf(r));
    }
    return out;
  }

  // ------------------------------------------------------------ update
  protected update(dt: number) {
    this.sfxCool -= dt;
    this.hintCool -= dt;
    if (this.state === 'done') return;
    if (!this.paths.length || !this.traceList.length) {
      if (this.t > 0.6) this.complete();
      return;
    }
    if (this.env.quirk === 'drifting' && !this.reducedMotion) this.off = [Math.sin(this.t * 0.4) * 5, Math.cos(this.t * 0.33) * 3];
    // early finish
    const [ux, uy] = this.uiPointer();
    const fr = this.finishRect();
    const onFinish = ux >= fr.x && ux <= fr.x + fr.w && uy >= fr.y && uy <= fr.y + fr.h;
    if (this.t > 2 && ((this.pointer.justDown && onFinish) || this.wasPressed('Enter'))) { this.complete(); return; }

    const g = this.guide;
    if (!g) return;
    const q: V = [this.pointer.x - this.off[0], this.pointer.y - this.off[1]];

    // ---- keyboard: auto-advance with steering
    if (this.wasPressed('Space') && (this.state === 'await' || this.state === 'lifted')) {
      this.kb = true;
      if (this.state === 'await') { this.s = 0; this.next = 0; this.kbOff = [0, 0]; this.record(g, 0, 0); this.next = 1; }
      else this.kbOff = [0, 0];
      this.state = 'cutting';
      this.beginCut(this.pointAt(g, this.s).p);
    }
    if (this.kb && this.state === 'cutting') {
      let v = this.kbSpeed;
      if (this.env.quirk === 'bursts') v *= 0.7 + 0.6 * (0.5 + 0.5 * Math.sin(this.t * 2));
      const s2 = Math.min(g.total, this.s + v * dt);
      const at = this.pointAt(g, s2);
      const pull = this.driftAmp * (Math.sin(s2 * 0.03 + this.phase) * 0.65 + Math.sin(s2 * 0.083 + this.phase * 2) * 0.35);
      const ax = this.axisX(), ay = this.axisY();
      const steer = 42;
      this.kbOff = [this.kbOff[0] + (ax * steer + at.n[0] * pull) * dt, this.kbOff[1] + (ay * steer + at.n[1] * pull) * dt];
      const tc = dot(this.kbOff, at.tan);
      this.kbOff = [this.kbOff[0] - at.tan[0] * tc, this.kbOff[1] - at.tan[1] * tc];
      const pos: V = [at.p[0] + this.kbOff[0], at.p[1] + this.kbOff[1]];
      const p0 = this.pointAt(g, this.s);
      const prev: V = [p0.p[0] + this.kbOff[0], p0.p[1] + this.kbOff[1]];
      this.crossSamples(g, this.s, s2, prev, pos);
      this.s = s2;
      this.graver = pos;
      this.cutting?.push(pos);
      if (Math.abs(dot(this.kbOff, at.n)) > this.slipT) { this.slip(g); this.kbOff = [0, 0]; return; }
      if (this.s >= g.total - 0.5) this.completePath(g, pos);
      return;
    }

    // ---- pointer
    if (this.pointer.down || this.pointer.justUp || this.pointer.justDown) this.kb = false;
    this.graver = q;
    if (!this.pointer.down) this.needLift = false;
    const startR = Math.max(this.tol * 2.2, 10);
    const resumeR = Math.max(this.tol * 1.6, 9);
    if (this.state === 'await') {
      if (this.pointer.down && !this.needLift && len(sub(q, g.pts[0])) <= startR) {
        this.state = 'cutting';
        this.s = 0;
        this.next = 0;
        this.record(g, 0, dot(sub(q, g.pts[0]), g.normals[0]));
        this.next = 1;
        this.prevQ = q;
        this.beginCut(q);
        this.env.audio.sfx('engrave', { pitch: 1.1 });
      } else if (this.pointer.justDown && !onFinish && this.hintCool <= 0 && !this.needLift) {
        this.hintCool = 1;
        this.floatText('Start on the glowing dot', this.pointer.x, this.pointer.y - 14, COLORS.paper);
      }
      return;
    }
    if (this.state === 'lifted') {
      if (this.pointer.down && len(sub(q, this.pointAt(g, this.s).p)) <= resumeR) {
        this.state = 'cutting';
        this.prevQ = q;
        this.beginCut(q);
      }
      return;
    }
    // cutting with the pointer
    if (!this.pointer.down) {
      if (this.s < g.total - 1) this.slip(g);
      else this.completePath(g, q);
      return;
    }
    const pr = this.project(g, q, Math.max(0, this.s - 4), Math.min(g.total, this.s + 30));
    const s2 = Math.max(this.s, pr.s);
    this.crossSamples(g, this.s, s2, this.prevQ, q);
    this.s = s2;
    this.prevQ = q;
    this.cutting?.push(q);
    if (pr.dist > this.slipT) { this.slip(g); return; }
    if (this.s >= g.total - 0.75) this.completePath(g, q);
  }

  private uiPointer(): [number, number] {
    return [this.mirrored ? MW - this.pointer.x : this.pointer.x, this.pointer.y];
  }
  private finishRect() { return { x: MW - 92, y: MH - 40, w: 80, h: 20 }; }

  // ------------------------------------------------------------ scoring
  private complete() {
    if (this.state === 'done') return;
    this.state = 'done';
    this.endCut();
    const recorded: number[] = [], raws: number[] = [];
    for (let i = 0; i < this.jit.length; i++) if (!Number.isNaN(this.jit[i])) { recorded.push(this.jit[i]); raws.push(this.raw[i]); }
    // per-path consecutive differences for smoothness
    const diffs: number[] = [];
    let tracedSamples = 0;
    for (const gi of this.traceList) {
      const g = this.guides[gi];
      tracedSamples += g.pts.length;
      for (let k = 1; k < g.pts.length; k++) {
        const a = this.jit[g.start + k - 1], b = this.jit[g.start + k];
        if (!Number.isNaN(a) && !Number.isNaN(b)) diffs.push(Math.abs(b - a));
      }
    }
    const accuracy = raws.length ? mean(raws.map(accOf)) : 0;
    const smoothness = diffs.length ? 1 - clamp(mean(diffs) * 1.2) : recorded.length ? 0.8 : 0;
    let tracedRecorded = 0;
    for (const gi of this.traceList) { const g = this.guides[gi]; for (let k = 0; k < g.pts.length; k++) if (!Number.isNaN(this.jit[g.start + k])) tracedRecorded++; }
    const completion = tracedSamples ? tracedRecorded / tracedSamples : 1;
    const slipScore = 1 - clamp(this.slips.length * 0.12);
    const nothing = !this.paths.length || !this.traceList.length;
    let score = nothing ? 1 : (accuracy * 0.6 + smoothness * 0.25 + slipScore * 0.15) * (0.3 + 0.7 * completion);
    score = clamp(score);
    const crispness = nothing ? 1 : clamp((0.5 * accuracy + 0.5 * smoothness - this.slips.length * 0.04) * (0.5 + 0.5 * completion));
    // deterministic fill for samples not traced by hand
    const mSigned = recorded.length ? mean(recorded) : 0;
    const spread = recorded.length ? mean(recorded.map((v) => Math.abs(v - mSigned))) : 0.5;
    const rng = seededRng(this.env.item.seed, 'engrave-fill');
    let walk = 0;
    const jitter = this.jit.map((v) => {
      walk = walk * 0.6 + rng.range(-1, 1) * 0.4;
      const out = Number.isNaN(v) ? mSigned + walk * spread * 1.6 : v;
      return Math.round(clamp(out, -1, 1) * 1000) / 1000;
    });
    const slips = [...this.slips].sort((a, b) => a - b).slice(0, 60);
    // show the real cut on the sprite
    this.preview.decoration.engraving = { ...this.env.item.decoration.engraving, pattern: this.pattern, jitter, slips, crispness };
    this.preview.decoration.inscription = this.env.item.decoration.inscription;
    this.previewCanvas = this.sprite(this.preview);
    this.cuts = [];
    const g = gradeOf(score);
    this.env.audio.sfx('success');
    const summary = nothing
      ? 'Nothing to engrave — the blade stays clean and quiet.'
      : `${g} engraving — ${accuracy > 0.85 ? 'a steady, true hand' : accuracy > 0.65 ? 'mostly on the line' : 'a lively, wandering line'}${this.slips.length ? ` with ${this.slips.length} slip${this.slips.length > 1 ? 's' : ''}` : ' without a single slip'}.`;
    this.finish({ score, details: { accuracy, smoothness, completion, slips: this.slips.length }, data: { jitter, slips, crispness }, summary }, 1.5);
  }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.4, '#2a2220');
    // leather bench pad
    ctx.fillStyle = 'rgba(70,46,32,0.65)';
    ctx.fillRect(0, 50, MW, 176);
    ctx.save();
    ctx.translate(Math.round(this.off[0]), Math.round(this.off[1]));
    const { cx, cy, s, rot, W, H } = this.xf;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(cx, cy);
    if (rot) ctx.rotate(Math.PI / 2);
    ctx.drawImage(this.previewCanvas, -(W * s) / 2, -(H * s) / 2, W * s, H * s);
    ctx.restore();
    if (this.state !== 'done') this.drawGuides(ctx);
    this.drawCuts(ctx);
    ctx.restore();
    if (this.state !== 'done') this.drawGraver(ctx);
  }

  private drawGuides(ctx: CanvasRenderingContext2D) {
    const curGi = this.traceList[this.cur];
    const traced = new Set(this.traceList.slice(0, this.cur));
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 4);
    const flicker = this.env.quirk === 'flicker' ? (Math.sin(this.t * 5.3) > 0.4 ? 0.15 : 1) : 1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.guides.forEach((g, gi) => {
      if (traced.has(gi) || g.pts.length < 1) return;
      const isCur = gi === curGi;
      ctx.strokeStyle = isCur ? `rgba(255,226,150,${(0.55 + 0.25 * pulse) * flicker})` : 'rgba(255,240,210,0.16)';
      ctx.lineWidth = isCur ? Math.max(2, Math.round(this.tol * 0.5)) : 1;
      ctx.setLineDash(isCur ? [] : [2, 3]);
      ctx.beginPath();
      ctx.moveTo(g.pts[0][0], g.pts[0][1]);
      for (let k = 1; k < g.pts.length; k++) ctx.lineTo(g.pts[k][0], g.pts[k][1]);
      ctx.stroke();
      if (isCur) {
        // tolerance band
        ctx.strokeStyle = `rgba(143,209,106,${0.12 * flicker})`;
        ctx.lineWidth = this.tol * 2;
        ctx.stroke();
      }
    });
    ctx.setLineDash([]);
    const g = this.guide;
    if (!g) return;
    // sample ticks on the current path
    ctx.fillStyle = 'rgba(255,250,230,0.7)';
    for (let k = this.next; k < g.pts.length; k++) ctx.fillRect(Math.round(g.pts[k][0]) - 1, Math.round(g.pts[k][1]) - 1, 2, 2);
    // start or resume marker
    const p = this.state === 'await' ? g.pts[0] : this.state === 'lifted' ? this.pointAt(g, this.s).p : null;
    if (p) {
      const r = 4 + pulse * 3;
      ctx.strokeStyle = COLORS.gold;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,220,140,0.85)';
      ctx.beginPath(); ctx.arc(p[0], p[1], 2.5, 0, Math.PI * 2); ctx.fill();
      // direction hint
      const at = this.pointAt(g, (this.state === 'await' ? 0 : this.s) + 8);
      ctx.fillStyle = 'rgba(255,220,140,0.6)';
      ctx.fillRect(Math.round(at.p[0]) - 1, Math.round(at.p[1]) - 1, 3, 3);
    }
  }

  private drawCuts(ctx: CanvasRenderingContext2D) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const c of this.cuts) {
      if (c.length < 2) continue;
      ctx.strokeStyle = 'rgba(30,20,16,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(c[0][0], c[0][1]);
      for (let k = 1; k < c.length; k++) ctx.lineTo(c[k][0], c[k][1]);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(240,200,96,0.9)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c[0][0] - 0.5, c[0][1] - 0.5);
      for (let k = 1; k < c.length; k++) ctx.lineTo(c[k][0] - 0.5, c[k][1] - 0.5);
      ctx.stroke();
    }
  }

  private drawGraver(ctx: CanvasRenderingContext2D) {
    const x = Math.round(this.graver[0] + this.off[0]), y = Math.round(this.graver[1] + this.off[1]);
    const active = this.state === 'cutting';
    ctx.strokeStyle = '#5a4030';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x + 14, y - 18); ctx.lineTo(x + 6, y - 7); ctx.stroke();
    ctx.strokeStyle = '#b8bcc8';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x + 6, y - 7); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = active ? '#fff4dc' : '#d0d4dc';
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  protected drawOverlay(ctx: CanvasRenderingContext2D) {
    const n = this.traceList.length;
    if (this.state !== 'done') {
      this.text(`Engraving: ${this.pattern}`, MW / 2, 12, { size: 10, align: 'center', color: COLORS.gold });
      this.text('Trace each glowing stroke with the button held • or Space, then steer with arrows', MW / 2, 26, { size: 8, align: 'center', color: COLORS.paper });
    }
    if (this.loupe && this.state !== 'done') {
      const gx = this.mirrored ? MW - (this.graver[0] + this.off[0]) : this.graver[0] + this.off[0];
      const gy = this.graver[1] + this.off[1];
      const size = 84, src = 28;
      const lx = gx > MW - 150 ? 12 : MW - size - 12, ly = 40;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#120c0a';
      ctx.fillRect(lx - 2, ly - 2, size + 4, size + 4);
      try {
        ctx.drawImage(this.env.canvas, Math.round(gx - src / 2), Math.round(gy - src / 2), src, src, lx, ly, size, size);
      } catch { /* ignore */ }
      ctx.strokeStyle = '#a07a4a';
      ctx.lineWidth = 2;
      ctx.strokeRect(lx - 1, ly - 1, size + 2, size + 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(lx, ly, size, 10);
      ctx.restore();
      this.text('Loupe', lx + size / 2, ly + size + 8, { size: 8, align: 'center', color: COLORS.dim });
    }
    const accs = this.raw.filter((v) => !Number.isNaN(v)).map(accOf);
    this.text(n ? `Stroke ${Math.min(n, this.cur + 1)}/${n}` : 'No pattern', 12, MH - 14, { size: 10, color: COLORS.paper });
    this.text(`Accuracy ${accs.length ? Math.round(mean(accs) * 100) : 0}%`, 150, MH - 14, { size: 10, color: COLORS.paper });
    this.text(`Slips ${this.slips.length}`, 270, MH - 14, { size: 10, color: this.slips.length ? COLORS.ok : COLORS.paper });
    if (this.guides.length > n && n) this.text(`(${this.guides.length - n} small marks finished for you)`, MW / 2, MH - 30, { size: 8, align: 'center', color: COLORS.dim });
    if (this.state !== 'done' && n) {
      const r = this.finishRect();
      this.panel(r.x, r.y, r.w, r.h);
      this.text('Finish', r.x + r.w / 2, r.y + r.h / 2, { size: 10, align: 'center', color: COLORS.cream });
    }
  }
}

/** Per-sample accuracy from normalised deviation (|r| ≤ 0.25 is perfect, 0 at 1.75). */
function accOf(r: number): number {
  return clamp(1 - Math.max(0, Math.abs(r) - 0.25) / 1.5);
}

export const engraveGame: MinigameDef = {
  id: 'engrave',
  name: 'Engraving',
  controls: 'Hold and trace each glowing stroke. Keyboard: Space starts a stroke, arrows steer. Enter / Finish ends early.',
  instructions: (env) => {
    const lines = [
      'Trace each glowing stroke from its starting dot, button held, staying on the line.',
      'Your hand is the cut: where you trace is exactly where the groove appears.',
      'Lift early or stray far and the graver slips — just return to the glow to carry on.',
    ];
    if (env.upgrades.includes('loupe')) lines.push('Your loupe shows a magnified view of the graver tip.');
    return lines;
  },
  create: (env) => new Engrave(env),
};
