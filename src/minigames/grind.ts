// Structural refinement — grinding the profile true. The blade is shown large
// (guard left, tip right; the left edge on top) as a schematic built with
// bladeRow(): the current outline from the hammered leftDev/rightDev and a
// dashed TARGET outline. Edge deviations are drawn exaggerated ×2 so small
// errors are visible. Grinding only REMOVES material:
//  - select a control point: click it, or Tab / Shift+Tab, Left/Right along the
//    edge, Up/Down to choose the top (left) or bottom (right) edge,
//  - grind: drag the selected point inward (further = more pressure), or hold
//    Space (pressure builds while held).
// Pressure follows input with material-dependent lag (harder = slower to bite
// and slower to let go) and a little wobble (low workability = more), so it is
// possible to overshoot — and deviations can never increase again.
// Finish whenever satisfied: Done button or Enter (no timer).
//
// params.mode:
//  'symmetric' — target 0 on both edges (default),
//  'organic'   — Mountain: seeded gently irregular target; smoothness between
//                neighbouring points matters more than exact match,
//  'delicate'  — Glassgarden: tighter tolerance, slower wheel, grinding too hard
//                chips the crystal (speed matters),
//  'free'      — Experimental: target 0, score blends symmetry and smoothness.
// Shields: planish the 8 face dents instead — hold on a sector (or select with
// arrows/Tab and hold Space); overshooting raises a small opposite dimple.
//
// data: blades → { leftDev[10], rightDev[10] }; shields → { dents[8] }
// details: accuracy, smoothness, symmetry/evenness, chips, points

import { seededRng } from '../core/rng';
import { clamp, lerp, mean, stdev } from '../core/util';
import { SEGMENTS, cloneItem } from '../item/factory';
import type { Item } from '../item/types';
import { bladeRow, shieldLayout } from '../render/itemRenderer';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

type Mode = 'symmetric' | 'organic' | 'delicate' | 'free';

const PX0 = 56, PX1 = 416, CY = 170;
const EX = 2; // deviation exaggeration in the schematic
const SAMPLES = 90;
const DONE = { x: 400, y: 236, w: 72, h: 24 };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

class Grind extends BaseMinigame {
  private rng = seededRng(this.env.item.seed, 'grind');
  private mode: Mode;
  private readonly isShield: boolean;
  private tol: number;
  // blade state
  private dev: number[][] = [[], []]; // [side 0 = left/top, side 1 = right/bottom][i]
  private tgt: number[][] = [[], []];
  private weight: number[][] = [[], []];
  private sy = 5;
  private cur: Item;
  private tgtItem: Item;
  private tgtRows: { L: number; R: number }[] = [];
  private curRows: { L: number; R: number }[] = [];
  private rowsDirty = true;
  // shield state
  private dents: number[] = [];
  // selection + grinding
  private side = 0;
  private sel = 0;
  private grabbing = false;
  private grabY = 0;
  private kbU = 0;
  private ptrU = 0;
  private pressure = 0;
  private lagK: number;
  private rate: number;
  private wob: number;
  private chipAcc = 0;
  private chips = 0;
  private sessionActive = false;
  private tapAcc = 0;
  private loopOn = false;
  // preview sprite
  private preview: Item;
  private previewCanvas: HTMLCanvasElement;
  private previewDirty = false;
  private previewCd = 0;
  private lastStatus = '';
  private keyBlocker: (e: KeyboardEvent) => void;

  constructor(env: MinigameEnv) {
    super(env);
    this.isShield = env.item.category === 'shield' || !env.item.blade;
    const m = String(env.params.mode ?? 'symmetric');
    this.mode = (['symmetric', 'organic', 'delicate', 'free'].includes(m) ? m : 'symmetric') as Mode;
    const props = env.material.props;
    const hard = clamp((props?.hardness ?? 50) / 100);
    const work = clamp((props?.workability ?? 70) / 100);
    this.lagK = lerp(9, 3.5, hard);
    this.rate = this.tune(0.12, 0.09) * lerp(1.35, 0.6, hard) * (this.mode === 'delicate' ? 0.55 : 1);
    this.wob = (1 - work) * 0.9;
    this.tol = this.isShield
      ? this.tune(0.08, 0.04)
      : this.mode === 'delicate' ? this.tune(0.05, 0.03) : this.tune(0.08, 0.045);
    if (env.quirk === 'bursts') this.tol *= 1.3;

    this.cur = cloneItem(env.item);
    this.tgtItem = cloneItem(env.item);
    this.preview = cloneItem(env.item);
    if (this.isShield) {
      this.dents = [...(env.item.shield?.dents ?? new Array(8).fill(0))].slice(0, 8).map((v) => clamp(Number(v) || 0));
      while (this.dents.length < 8) this.dents.push(0);
    } else {
      const b = env.item.blade!;
      const norm = (a: number[]) => { const o = (a ?? []).slice(0, SEGMENTS).map((v) => clamp(Number(v) || 0, -0.6, 0.6)); while (o.length < SEGMENTS) o.push(0); return o; };
      this.dev = [norm(b.leftDev), norm(b.rightDev)];
      this.buildTargets();
      this.tgtItem.blade!.leftDev = [...this.tgt[0]];
      this.tgtItem.blade!.rightDev = [...this.tgt[1]];
      // base widths (no deviation) give each control point a weight: the very tip barely shows
      const zero = cloneItem(env.item);
      zero.blade!.leftDev = new Array(SEGMENTS).fill(0);
      zero.blade!.rightDev = new Array(SEGMENTS).fill(0);
      const L0: number[] = [], R0: number[] = [];
      for (let i = 0; i < SEGMENTS; i++) { const r = bladeRow(zero, i / (SEGMENTS - 1)); L0.push(r.L); R0.push(r.R); }
      const maxL = Math.max(0.001, ...L0), maxR = Math.max(0.001, ...R0);
      this.weight = [L0.map((v) => clamp((v / maxL) * 2.5)), R0.map((v) => clamp((v / maxR) * 2.5))];
      this.sy = clamp(42 / (Math.max(maxL, maxR) * 1.2), 2.5, 8);
      for (let k = 0; k <= SAMPLES; k++) {
        const r = bladeRow(this.tgtItem, k / SAMPLES);
        this.tgtRows.push({ L: r.L, R: r.R });
      }
      this.sel = this.firstSelectable(0, 0, 1);
    }
    this.previewCanvas = this.sprite(this.preview);
    this.keyBlocker = (e: KeyboardEvent) => { if (e.code === 'Tab') e.preventDefault(); };
    window.addEventListener('keydown', this.keyBlocker);
    this.updateStatus();
  }

  private buildTargets() {
    for (let s = 0; s < 2; s++) {
      if (this.mode === 'organic') {
        const p1 = this.rng.range(0, 6.28), p2 = this.rng.range(0, 6.28);
        const out: number[] = [];
        for (let i = 0; i < SEGMENTS; i++) {
          const raw = -0.03 + 0.06 * Math.sin(i * 0.55 + p1) + 0.03 * Math.sin(i * 1.3 + p2);
          // never ask for material that isn't there
          out.push(clamp(Math.min(raw, this.dev[s][i] - 0.01), -0.6, 0.6));
        }
        this.tgt[s] = out;
      } else this.tgt[s] = new Array(SEGMENTS).fill(0);
    }
  }

  private selectable(side: number, i: number) {
    return i >= 0 && i < SEGMENTS && this.weight[side][i] > 0.2;
  }
  private firstSelectable(side: number, from: number, dir: number) {
    for (let k = 0; k < SEGMENTS; k++) {
      const i = from + k * dir;
      if (this.selectable(side, i)) return i;
    }
    return 0;
  }
  private sx(x: number) { return this.mirrored ? MW - x : x; }

  // ------------------------------------------------------------ geometry
  private pointX(i: number) { return PX0 + (i / (SEGMENTS - 1)) * (PX1 - PX0); }
  private dispHalf(cur: number, tgt: number) { return tgt * this.sy + (cur - tgt) * this.sy * EX; }
  private pointY(side: number, i: number) {
    const t = i / (SEGMENTS - 1);
    const k = Math.round(t * SAMPLES);
    this.ensureRows();
    const c = this.curRows[k], g = this.tgtRows[k];
    return side === 0 ? CY - this.dispHalf(c.L, g.L) : CY + this.dispHalf(c.R, g.R);
  }
  private targetY(side: number, i: number) {
    const k = Math.round((i / (SEGMENTS - 1)) * SAMPLES);
    const g = this.tgtRows[k];
    return side === 0 ? CY - g.L * this.sy : CY + g.R * this.sy;
  }
  private ensureRows() {
    if (!this.rowsDirty) return;
    this.cur.blade!.leftDev = [...this.dev[0]];
    this.cur.blade!.rightDev = [...this.dev[1]];
    this.curRows = [];
    for (let k = 0; k <= SAMPLES; k++) {
      const r = bladeRow(this.cur, k / SAMPLES);
      this.curRows.push({ L: r.L, R: r.R });
    }
    this.rowsDirty = false;
  }

  // shield sectors
  private shieldGeom() {
    const lay = shieldLayout(this.env.item);
    const scale = 2;
    const cx = 196, cy = 142;
    const rx = lay.rx * scale * 0.62, ry = lay.ry * scale * 0.62;
    return { cx, cy, rx, ry, scale };
  }
  private sectorPos(i: number): [number, number] {
    const g = this.shieldGeom();
    const a = (i / 8) * Math.PI * 2;
    return [g.cx + Math.cos(a) * g.rx, g.cy + Math.sin(a) * g.ry];
  }

  // ------------------------------------------------------------ input
  protected onPointerDown() {
    if (this.finished) return;
    const p = this.pointer;
    if (p.x >= DONE.x && p.x <= DONE.x + DONE.w && p.y >= DONE.y && p.y <= DONE.y + DONE.h) {
      this.done();
      return;
    }
    if (this.isShield) {
      let best = -1, bd = 1e9;
      for (let i = 0; i < 8; i++) {
        const [x, y] = this.sectorPos(i);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) { bd = d; best = i; }
      }
      if (best >= 0 && bd < 46) { this.select(0, best); this.grabbing = true; this.grabY = p.y; }
      return;
    }
    // nearest control point
    let bs = 0, bi = -1, bd = 1e9;
    for (let s = 0; s < 2; s++)
      for (let i = 0; i < SEGMENTS; i++) {
        if (!this.selectable(s, i)) continue;
        const d = Math.hypot(p.x - this.pointX(i), p.y - this.pointY(s, i));
        if (d < bd) { bd = d; bs = s; bi = i; }
      }
    if (bi < 0) return;
    if (bd > 26) {
      // near the blade: pick by column and the side of the centre line
      if (p.x < PX0 - 20 || p.x > PX1 + 20 || Math.abs(p.y - CY) > 90) return;
      bs = p.y < CY ? 0 : 1;
      const raw = Math.round(((p.x - PX0) / (PX1 - PX0)) * (SEGMENTS - 1));
      bi = this.selectable(bs, raw) ? raw : this.firstSelectable(bs, clamp(raw, 0, SEGMENTS - 1), -1);
    }
    this.select(bs, bi);
    this.grabbing = true;
    this.grabY = p.y;
  }
  protected onPointerUp() { this.grabbing = false; this.ptrU = 0; }

  private select(side: number, i: number) {
    if (side === this.side && i === this.sel) return;
    this.endSession();
    this.side = side;
    this.sel = i;
    this.pressure = 0;
    this.chipAcc = 0;
    this.env.audio.sfx('click', { volume: 0.4 });
  }

  private cycle(dir: number) {
    if (this.isShield) { this.select(0, (this.sel + dir + 8) % 8); return; }
    const list: [number, number][] = [];
    for (let s = 0; s < 2; s++) for (let i = 0; i < SEGMENTS; i++) if (this.selectable(s, i)) list.push([s, i]);
    if (!list.length) return;
    let idx = list.findIndex(([s, i]) => s === this.side && i === this.sel);
    idx = (idx + dir + list.length) % list.length;
    this.select(list[idx][0], list[idx][1]);
  }

  private step(dir: number) {
    if (this.isShield) { this.cycle(dir); return; }
    let i = this.sel + dir;
    while (i >= 0 && i < SEGMENTS && !this.selectable(this.side, i)) i += dir;
    if (i >= 0 && i < SEGMENTS) this.select(this.side, i);
  }

  private setSide(side: number) {
    if (this.isShield) { this.cycle(side === 0 ? -1 : 1); return; }
    if (side === this.side) return;
    const i = this.selectable(side, this.sel) ? this.sel : this.firstSelectable(side, this.sel, -1);
    this.select(side, i);
  }

  // ------------------------------------------------------------ update
  protected update(dt: number) {
    if (this.wasPressed('Enter')) { this.done(); return; }
    if (this.wasPressed('Tab')) this.cycle(this.isDown('ShiftLeft', 'ShiftRight') ? -1 : 1);
    let lr = (this.wasPressed('ArrowRight', 'KeyD') ? 1 : 0) - (this.wasPressed('ArrowLeft', 'KeyA') ? 1 : 0);
    if (this.mirrored) lr = -lr;
    if (lr) this.step(lr);
    if (this.wasPressed('ArrowUp', 'KeyW')) this.setSide(0);
    if (this.wasPressed('ArrowDown', 'KeyS')) this.setSide(1);

    // --- input pressure
    let u = 0;
    if (this.grabbing && this.pointer.down) {
      if (this.isShield) { this.ptrU = Math.min(1, this.ptrU + dt * 1.6); u = this.ptrU; }
      else {
        const inward = this.side === 0 ? this.pointer.y - this.grabY : this.grabY - this.pointer.y;
        u = clamp(inward / 24);
      }
    }
    if (this.isDown('Space', 'KeyG')) { this.kbU = Math.min(1, this.kbU + dt * 1.6); u = Math.max(u, this.kbU); }
    else this.kbU = 0;
    if (this.env.quirk === 'bursts') u *= 0.6 + 0.8 * (0.5 + 0.5 * Math.sin(this.t * 2.1));
    this.pressure += (u - this.pressure) * (1 - Math.exp(-dt * this.lagK));
    if (this.pressure < 0.003 && u === 0) this.pressure = 0;
    const p = this.pressure;

    if (p > 0.01) {
      this.sessionActive = true;
      const wobble = 1 + this.wob * (Math.sin(this.t * 17 + this.sel * 1.7) * 0.6 + (Math.random() - 0.5) * 0.6);
      const removal = Math.max(0, this.rate * p * wobble) * dt;
      if (this.isShield) this.planish(removal, dt);
      else this.grindPoint(removal, dt);
    } else this.endSession();

    // audio loop
    if (!this.isShield) {
      if (p > 0.03) { this.env.audio.loop('grind', true, clamp(p)); this.loopOn = true; }
      else if (this.loopOn) { this.env.audio.loop('grind', false); this.loopOn = false; }
    }

    // throttled sprite refresh
    this.previewCd = Math.max(0, this.previewCd - dt);
    if (this.previewDirty && this.previewCd <= 0) {
      if (this.isShield) this.preview.shield!.dents = this.dents.map((v) => r3(Math.abs(v)));
      else { this.preview.blade!.leftDev = this.dev[0].map(r3); this.preview.blade!.rightDev = this.dev[1].map(r3); }
      this.previewCanvas = this.sprite(this.preview);
      this.previewDirty = false;
      this.previewCd = 0.2;
    }
    this.updateStatus();
  }

  private grindPoint(removal: number, dt: number) {
    const s = this.side, i = this.sel;
    let v = this.dev[s][i] - removal;
    // delicate crystal: pressing too hard chips it
    if (this.mode === 'delicate') {
      if (this.pressure > 0.7) this.chipAcc += (this.pressure - 0.7) * dt * 6;
      else this.chipAcc = Math.max(0, this.chipAcc - dt * 0.5);
      if (this.chipAcc >= 1) {
        this.chipAcc = 0;
        this.chips++;
        v -= this.rng.range(0.025, 0.05);
        const x = this.pointX(i), y = this.pointY(s, i);
        this.spawn(x, y, { n: 8, vy: s === 0 ? -50 : 30, spread: 80, life: 0.6, color: '#e8fff4', size: 2, g: 200 });
        this.env.audio.sfx('glass', { volume: 0.6, pitch: 0.8 + Math.random() * 0.3 });
        this.floatText('Chip! Gentler…', this.sx(x), y + (s === 0 ? -16 : 16), COLORS.bad);
        this.shake(1.5);
      }
    }
    this.dev[s][i] = Math.max(-0.6, v);
    this.rowsDirty = true;
    this.previewDirty = true;
    // sparks fly off the wheel, away from the blade
    if (Math.random() < dt * (10 + this.pressure * 50)) {
      const x = this.pointX(i), y = this.pointY(s, i);
      const col = this.mode === 'delicate' ? '#d8fff0' : Math.random() < 0.5 ? COLORS.ember : COLORS.gold;
      this.spawn(x, y, { n: 2, vx: (Math.random() - 0.5) * 40, vy: s === 0 ? -70 : 50, spread: 50, life: 0.35, color: col, size: 1, g: 160 });
    }
  }

  private planish(removal: number, dt: number) {
    const i = this.sel;
    this.dents[i] = Math.max(-1, this.dents[i] - removal * 1.4);
    this.previewDirty = true;
    this.tapAcc += dt * (2 + this.pressure * 6);
    if (this.tapAcc >= 1) {
      this.tapAcc = 0;
      const [x, y] = this.sectorPos(i);
      this.env.audio.sfx('hammer', { volume: 0.35, pitch: 1.35 + Math.random() * 0.1 });
      this.spawn(x, y, { n: 3, vy: -30, spread: 50, life: 0.3, color: COLORS.gold, size: 1, g: 120 });
    }
  }

  private endSession() {
    if (!this.sessionActive) return;
    this.sessionActive = false;
    if (this.isShield) {
      const v = this.dents[this.sel];
      const [x, y] = this.sectorPos(this.sel);
      if (Math.abs(v) <= this.tol) { this.floatText('Smooth', this.sx(x), y - 20, COLORS.good); this.env.audio.sfx('chime', { volume: 0.35 }); }
      else if (v < -this.tol) { this.floatText('A little dimpled', this.sx(x), y - 20, COLORS.cool); this.env.audio.sfx('soft', { volume: 0.5 }); }
      return;
    }
    const e = this.dev[this.side][this.sel] - this.tgt[this.side][this.sel];
    const x = this.pointX(this.sel), y = this.pointY(this.side, this.sel) + (this.side === 0 ? -16 : 16);
    if (Math.abs(e) <= this.tol * 0.5) { this.floatText('True!', this.sx(x), y, COLORS.gold); this.env.audio.sfx('chime', { volume: 0.4, pitch: 1.1 }); }
    else if (Math.abs(e) <= this.tol) { this.floatText('Close', this.sx(x), y, COLORS.good); }
    else if (e < 0) { this.floatText('Past the line', this.sx(x), y, COLORS.cool); this.env.audio.sfx('soft', { volume: 0.5 }); }
  }

  private pointsTrue(): [number, number] {
    if (this.isShield) return [this.dents.filter((v) => Math.abs(v) <= this.tol).length, 8];
    let ok = 0, n = 0;
    for (let s = 0; s < 2; s++) for (let i = 0; i < SEGMENTS; i++) {
      if (!this.selectable(s, i)) continue;
      n++;
      if (Math.abs(this.dev[s][i] - this.tgt[s][i]) <= this.tol) ok++;
    }
    return [ok, n];
  }

  private updateStatus() {
    const [ok, n] = this.pointsTrue();
    const s = this.isShield ? `Smooth sectors ${ok} / ${n}` : `Points true ${ok} / ${n}`;
    if (s !== this.lastStatus) { this.lastStatus = s; this.env.onStatus?.(s); }
  }

  // ------------------------------------------------------------ scoring
  private done() {
    if (this.finished) return;
    this.endSession();
    if (this.loopOn) { this.env.audio.loop('grind', false); this.loopOn = false; }
    this.env.audio.sfx('success');
    if (this.isShield) return this.finishShield();
    const tol = this.tol;
    const W = this.weight;
    let ae = 0, aw = 0, sym = 0, rough = 0, rw = 0, roughDev = 0, roughTgt = 0;
    const meanErr = [0, 0], meanW = [0, 0];
    for (let s = 0; s < 2; s++) {
      for (let i = 0; i < SEGMENTS; i++) {
        const w = W[s][i];
        const e = this.dev[s][i] - this.tgt[s][i];
        ae += Math.abs(e) * w; aw += w;
        meanErr[s] += e * w; meanW[s] += w;
        if (i > 0 && i < SEGMENTS - 1) {
          const ww = Math.min(W[s][i - 1], w, W[s][i + 1]);
          if (ww > 0.2) {
            const ePrev = this.dev[s][i - 1] - this.tgt[s][i - 1], eNext = this.dev[s][i + 1] - this.tgt[s][i + 1];
            rough += Math.abs(ePrev - 2 * e + eNext) * ww;
            roughDev += Math.abs(this.dev[s][i - 1] - 2 * this.dev[s][i] + this.dev[s][i + 1]) * ww;
            roughTgt += Math.abs(this.tgt[s][i - 1] - 2 * this.tgt[s][i] + this.tgt[s][i + 1]) * ww;
            rw += ww;
          }
        }
      }
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const w = Math.min(W[0][i], W[1][i]);
      sym += Math.abs(this.dev[0][i] - this.dev[1][i] - (this.tgt[0][i] - this.tgt[1][i])) * w;
    }
    const symW = Math.max(0.001, W[0].reduce((a, w, i) => a + Math.min(w, W[1][i]), 0));
    const err = aw > 0 ? ae / aw : 0;
    const accuracy = clamp(1 - err / (tol * 3));
    rw = Math.max(0.001, rw);
    let smoothness = clamp(1 - rough / rw / (tol * 4));
    if (this.mode === 'organic') smoothness = clamp(1 - Math.max(0, roughDev / rw - roughTgt / rw) / (tol * 3));
    const symmetry = clamp(1 - sym / symW / (tol * 4));
    const balance = clamp(1 - Math.abs(meanErr[0] / Math.max(0.001, meanW[0]) - meanErr[1] / Math.max(0.001, meanW[1])) / (tol * 3));
    const chipPenalty = Math.min(0.12, this.chips * 0.02);
    let score: number;
    switch (this.mode) {
      case 'organic': score = accuracy * 0.35 + smoothness * 0.55 + balance * 0.1; break;
      case 'free': score = accuracy * 0.4 + symmetry * 0.3 + smoothness * 0.3; break;
      case 'delicate': score = accuracy * 0.75 + smoothness * 0.15 + symmetry * 0.1 - chipPenalty; break;
      default: score = accuracy * 0.75 + smoothness * 0.15 + symmetry * 0.1;
    }
    score = clamp(score);
    const [ok, n] = this.pointsTrue();
    const g = gradeOf(score);
    const modeWord = this.mode === 'organic' ? 'flowing, organic line' : this.mode === 'delicate' ? 'delicate crystal edge' : this.mode === 'free' ? 'free-form profile' : 'true, even profile';
    this.finish({
      score,
      details: { accuracy, smoothness, symmetry, chips: this.chips, points: n ? ok / n : 0 },
      data: { leftDev: this.dev[0].map(r3), rightDev: this.dev[1].map(r3) },
      summary: `${g} grinding — a ${modeWord} with ${ok} of ${n} points true${this.chips ? ` (and ${this.chips} small chip${this.chips > 1 ? 's' : ''})` : ''}.`,
    });
  }

  private finishShield() {
    const abs = this.dents.map((v) => Math.abs(v));
    const accuracy = clamp(1 - mean(abs) / (this.tol * 3));
    const evenness = 1 - clamp(stdev(abs) * 3);
    const score = clamp(accuracy * 0.85 + evenness * 0.15);
    const dimples = this.dents.filter((v) => v < -this.tol).length;
    const [ok] = this.pointsTrue();
    const g = gradeOf(score);
    this.finish({
      score,
      details: { accuracy, evenness, dimples, points: ok / 8 },
      data: { dents: abs.map((v) => r3(clamp(v))) },
      summary: `${g} planishing — ${ok} of 8 sectors smooth${dimples ? `, ${dimples} left slightly dimpled` : ''}.`,
    });
  }

  protected onDestroy() {
    window.removeEventListener('keydown', this.keyBlocker);
    if (this.loopOn) { this.env.audio.loop('grind', false); this.loopOn = false; }
  }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.5);
    if (this.isShield) this.drawShield(ctx);
    else this.drawBlade(ctx);
    // Done button
    const hover = this.pointer.inside && this.pointer.x >= DONE.x && this.pointer.x <= DONE.x + DONE.w && this.pointer.y >= DONE.y && this.pointer.y <= DONE.y + DONE.h;
    this.panel(DONE.x, DONE.y, DONE.w, DONE.h, hover ? 'rgba(90,60,30,0.9)' : COLORS.panel, COLORS.gold);
  }

  private drawBlade(ctx: CanvasRenderingContext2D) {
    // the real piece, small, along the top
    const spr = this.previewCanvas;
    this.drawSprite(spr, 236, 46, 1, 1);
    this.ensureRows();
    const pal = this.env.material.palette;
    // grinding wheel hint behind the selected point
    const wx = this.pointX(this.sel), wy = this.pointY(this.side, this.sel);
    // guard stub
    ctx.fillStyle = '#4a3a2a';
    ctx.fillRect(PX0 - 14, CY - 36, 8, 72);
    ctx.fillStyle = '#6a5038';
    ctx.fillRect(PX0 - 14, CY - 36, 8, 2);
    // current blade body
    ctx.fillStyle = pal[3];
    ctx.beginPath();
    for (let k = 0; k <= SAMPLES; k++) {
      const x = PX0 + (k / SAMPLES) * (PX1 - PX0);
      const y = CY - this.dispHalf(this.curRows[k].L, this.tgtRows[k].L);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let k = SAMPLES; k >= 0; k--) {
      const x = PX0 + (k / SAMPLES) * (PX1 - PX0);
      ctx.lineTo(x, CY + this.dispHalf(this.curRows[k].R, this.tgtRows[k].R));
    }
    ctx.closePath();
    ctx.fill();
    // bevel shading
    ctx.fillStyle = pal[4];
    ctx.fillRect(PX0, CY - 2, PX1 - PX0 - 20, 1);
    ctx.fillStyle = pal[2];
    ctx.fillRect(PX0, CY + 1, PX1 - PX0 - 20, 1);
    // edges
    for (let k = 0; k <= SAMPLES; k++) {
      const x = Math.round(PX0 + (k / SAMPLES) * (PX1 - PX0));
      ctx.fillStyle = pal[5];
      ctx.fillRect(x, Math.round(CY - this.dispHalf(this.curRows[k].L, this.tgtRows[k].L)), 4, 1);
      ctx.fillStyle = pal[1];
      ctx.fillRect(x, Math.round(CY + this.dispHalf(this.curRows[k].R, this.tgtRows[k].R)), 4, 1);
    }
    // dashed target outline
    const flicker = this.env.quirk === 'flicker' && Math.sin(this.t * 6.1) > 0.55;
    if (!flicker) {
      ctx.fillStyle = COLORS.gold;
      for (let k = 0; k <= SAMPLES; k += 2) {
        if (Math.floor(k / 2) % 2) continue;
        const x = Math.round(PX0 + (k / SAMPLES) * (PX1 - PX0));
        ctx.fillRect(x, Math.round(CY - this.tgtRows[k].L * this.sy), 3, 1);
        ctx.fillRect(x, Math.round(CY + this.tgtRows[k].R * this.sy), 3, 1);
      }
    }
    // control points
    for (let s = 0; s < 2; s++)
      for (let i = 0; i < SEGMENTS; i++) {
        if (!this.selectable(s, i)) continue;
        const x = Math.round(this.pointX(i));
        let y = Math.round(this.pointY(s, i));
        const selected = s === this.side && i === this.sel;
        if (selected && this.pressure > 0.02) y += Math.round(Math.sin(this.t * 40) * this.wob * this.pressure * 1.5);
        const e = this.dev[s][i] - this.tgt[s][i];
        const col = Math.abs(e) <= this.tol ? COLORS.good : e > 0 ? COLORS.ember : COLORS.cool;
        // target tick
        if (!flicker) {
          ctx.fillStyle = 'rgba(240,200,96,0.8)';
          ctx.fillRect(x - 4, Math.round(this.targetY(s, i)), 9, 1);
        }
        ctx.fillStyle = COLORS.ink;
        ctx.fillRect(x - 3, y - 3, 7, 7);
        ctx.fillStyle = col;
        ctx.fillRect(x - 2, y - 2, 5, 5);
        if (selected) {
          const pulse = 6 + Math.round(Math.sin(this.t * 5) * 1.5);
          ctx.strokeStyle = COLORS.cream;
          ctx.lineWidth = 1;
          ctx.strokeRect(x - pulse + 0.5, y - pulse + 0.5, pulse * 2, pulse * 2);
          // inward arrow
          const dir = s === 0 ? 1 : -1;
          ctx.fillStyle = 'rgba(255,244,220,0.6)';
          for (let k = 0; k < 3; k++) ctx.fillRect(x - 2 + k, y + dir * (10 + k), 5 - k * 2, 1);
        }
      }
    // the grinding wheel at the selected point
    const dir = this.side === 0 ? -1 : 1;
    const r = 16;
    const cx = Math.round(wx), cy = Math.round(wy + dir * (r + 3 - this.pressure * 3));
    ctx.fillStyle = 'rgba(60,56,60,0.85)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(130,124,130,0.9)';
    const spin = this.t * (4 + this.pressure * 30);
    for (let k = 0; k < 6; k++) {
      const a = spin + (k * Math.PI) / 3;
      ctx.fillRect(Math.round(cx + Math.cos(a) * (r - 4)), Math.round(cy + Math.sin(a) * (r - 4)), 2, 2);
    }
    ctx.fillStyle = '#2a262a';
    ctx.fillRect(cx - 2, cy - 2, 4, 4);
    // pressure meter
    this.bar(PX0, 250, 120, 4, this.pressure, this.mode === 'delicate' && this.pressure > 0.7 ? COLORS.bad : COLORS.ember);
  }

  private drawShield(ctx: CanvasRenderingContext2D) {
    const g = this.shieldGeom();
    this.drawSprite(this.previewCanvas, g.cx, g.cy, g.scale);
    for (let i = 0; i < 8; i++) {
      const [x, y] = this.sectorPos(i);
      const v = this.dents[i];
      const selected = i === this.sel;
      const col = Math.abs(v) <= this.tol ? COLORS.good : v > 0 ? COLORS.ember : COLORS.cool;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(Math.round(x) - 4, Math.round(y) - 14, 8, 28);
      // meter: dents grow up from the centre, dimples grow down
      const h = Math.round(clamp(Math.abs(v)) * 13);
      ctx.fillStyle = col;
      if (v >= 0) ctx.fillRect(Math.round(x) - 3, Math.round(y) - h, 6, Math.max(1, h));
      else ctx.fillRect(Math.round(x) - 3, Math.round(y), 6, Math.max(1, h));
      ctx.fillStyle = COLORS.gold;
      ctx.fillRect(Math.round(x) - 5, Math.round(y), 10, 1);
      if (selected) {
        const pulse = 16 + Math.round(Math.sin(this.t * 5) * 1.5);
        ctx.strokeStyle = COLORS.cream;
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x) - 7.5, Math.round(y) - pulse + 0.5, 15, pulse * 2);
      }
    }
    // planishing hammer over the selected sector
    const [hx, hy] = this.sectorPos(this.sel);
    const lift = this.pressure > 0.02 ? Math.abs(Math.sin(this.t * 14)) * 6 : 10;
    ctx.fillStyle = '#6a4a2a';
    ctx.fillRect(Math.round(hx) + 12, Math.round(hy) - 40 - lift, 3, 30);
    ctx.fillStyle = '#8a8a96';
    ctx.fillRect(Math.round(hx) + 4, Math.round(hy) - 18 - lift, 18, 8);
    this.bar(PX0, 250, 120, 4, this.pressure, COLORS.ember);
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    const [ok, n] = this.pointsTrue();
    const modeName = this.isShield ? 'Planishing' : { symmetric: 'True & symmetric', organic: 'Organic line', delicate: 'Delicate crystal', free: 'Free-form' }[this.mode];
    this.text(modeName, 12, 14, { size: 10, color: COLORS.gold });
    this.text(this.isShield ? `Smooth ${ok} / ${n}` : `True ${ok} / ${n}`, 12, 28, { size: 9, color: ok === n ? COLORS.good : COLORS.paper });
    this.text(this.env.material.name, MW - 12, 14, { size: 9, align: 'right', color: COLORS.paper });
    if (!this.isShield) this.text('edges shown ×2', MW - 12, 28, { size: 8, align: 'right', color: COLORS.dim });
    this.text('Done', this.sx(DONE.x + DONE.w / 2), DONE.y + DONE.h / 2, { size: 10, align: 'center', color: COLORS.gold });
    if (ok === n && !this.finished) this.text('All true — press Done (Enter) when satisfied', this.sx(236), 92, { size: 9, align: 'center', color: COLORS.good });
    const hint = this.isShield
      ? 'Hold a sector (or ←/→ + hold Space) to planish · Enter: done'
      : this.mode === 'delicate'
        ? 'Click a point, drag inward gently (or Tab/←→/↑↓ + short Space taps) · Enter: done'
        : 'Click a point & drag inward to grind (or Tab/←→/↑↓ + hold Space) · Enter: done';
    this.text(hint, this.sx(MW / 2 - 40), MH - 10, { size: 9, align: 'center', color: COLORS.paper });
    this.text('pressure', this.sx(PX0 + 60), 244, { size: 7, align: 'center', color: COLORS.dim });
  }
}

export const grindGame: MinigameDef = {
  id: 'grind',
  name: 'Structural Refinement',
  controls: 'Click a point and drag inward to grind (or Tab / arrows to choose, hold Space). Enter or Done when satisfied. Shields: hold on a sector.',
  instructions: (env) => {
    if (env.item.category === 'shield') return [
      'Planish the dents out of the shield face, sector by sector.',
      'Hold to tap a sector smooth — but go too far and you raise a small dimple the other way.',
      'There is no timer: press Done when you are happy.',
    ];
    const m = env.params.mode;
    const lines = [
      'Grind each edge point down to the dashed gold target. The wheel only removes metal — overshoot cannot be undone.',
      'Pressure takes a moment to bite and to let go; ease off just before the line. Press Done when satisfied.',
    ];
    if (m === 'organic') lines.unshift('Mountain style: follow the gently irregular target — a smooth, flowing line matters more than exactness.');
    if (m === 'delicate') lines.unshift('Glassgarden style: tight tolerance and a slow wheel. Press too hard and the crystal chips.');
    if (m === 'free') lines.unshift('Experimental: aim for a profile that is balanced on both edges and smooth along its length.');
    return lines;
  },
  create: (env) => new Grind(env),
};
