// Matching and straightening arrow shafts.
//
// Part 1 — spine matching. Nine raw shafts lie on the spine tester; each bends
// a different amount under the same weight (the bar under it shows how much —
// at higher difficulty with a little wobble in the reading). Tap shafts to
// choose the ARROW_COUNT that bend most alike, then "Keep these". Arrows of
// matched spine fly alike.
//
// Part 2 — straightening. Each chosen shaft is shown in turn, its bends drawn
// greatly exaggerated, as when you sight down it. Press on the shaft where it
// bows and drag up or down to ease it straight, then let go; the shaft keeps
// what you gave it. Each shaft takes only a few bends over the heat before it
// must be left alone. Keyboard: ← / → move along the shaft, ↑ / ↓ bend,
// Space sets the bend, Enter moves to the next shaft.
//
// score = 0.35 · spine match + 0.65 · mean straightness
// data: { straight[ARROW_COUNT] 0..1, spine[ARROW_COUNT] −1..1 }
// details: spineMatch, straightness

import { seededRng } from '../core/rng';
import { clamp, mean } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { ARROW_COUNT } from '../item/factory';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

const RAW = 9;
const X0 = 60, X1 = 420, CY = 138;
const SAMPLES = 60;
const BTN = { x: MW - 124, y: MH - 40, w: 112, h: 22 };

interface Bend { at: number; amt: number; w: number }

class Straighten extends BaseMinigame {
  private rng = seededRng(this.env.item.seed, 'straighten');
  private phase: 'match' | 'bend' | 'done' = 'match';
  // matching
  private spines: number[] = [];
  private reading: number[] = [];
  private chosen = new Set<number>();
  // straightening
  private order: number[] = [];
  private cur = 0;
  private kinks: Bend[][] = [];
  private fixes: Bend[][] = [];
  private bendsLeft = 0;
  private maxBends: number;
  private grab: { at: number; y0: number; amt: number } | null = null;
  private kbAt = 0.5;
  private kbAmt = 0;
  private result: number[] = [];
  private wood: string[];

  constructor(env: MinigameEnv) {
    super(env);
    const noise = this.tune(0, 0.1);
    for (let i = 0; i < RAW; i++) {
      // most shafts cluster; a few are clearly stiff or whippy
      const s = this.rng.chance(0.33) ? this.rng.range(-1, 1) : this.rng.range(-0.3, 0.3);
      this.spines.push(s);
      this.reading.push(clamp(s + this.rng.range(-noise, noise), -1, 1));
    }
    this.maxBends = Math.round(this.tune(5, 3));
    const kinkCount = env.difficulty >= 2 ? 2 : 1;
    for (let i = 0; i < RAW; i++) {
      const ks: Bend[] = [];
      for (let k = 0; k < kinkCount; k++) ks.push({ at: this.rng.range(0.18, 0.82), amt: (this.rng.chance(0.5) ? 1 : -1) * this.rng.range(0.45, 1), w: this.rng.range(0.2, 0.34) });
      this.kinks.push(ks);
      this.fixes.push([]);
    }
    const id = env.item.materials.primary;
    this.wood = hasMat(id) ? mat(id).palette : mat('cedar').palette;
    env.onStatus?.('Choose a matched set');
  }

  // ------------------------------------------------------------ shaft shape
  private bump(b: Bend, x: number): number {
    const d = (x - b.at) / b.w;
    return Math.abs(d) >= 1 ? 0 : b.amt * 0.5 * (1 + Math.cos(Math.PI * d));
  }
  /** Deflection of shaft i at x (0..1), −1..1-ish. */
  private shape(i: number, x: number, extra?: Bend): number {
    let y = 0;
    for (const b of this.kinks[i]) y += this.bump(b, x);
    for (const b of this.fixes[i]) y += this.bump(b, x);
    if (extra) y += this.bump(extra, x);
    return y;
  }
  private straightness(i: number, extra?: Bend): number {
    let s = 0;
    for (let k = 0; k <= SAMPLES; k++) { const y = this.shape(i, k / SAMPLES, extra); s += y * y; }
    return clamp(1 - Math.sqrt(s / (SAMPLES + 1)) / 0.42);
  }

  // ------------------------------------------------------------ input
  private uiPointer(): [number, number] { return [this.mirrored ? MW - this.pointer.x : this.pointer.x, this.pointer.y]; }
  private overBtn() { const [x, y] = this.uiPointer(); return this.hits(BTN, x, y); }
  private rawRect(i: number) { return { x: 40 + i * 45, y: 60, w: 38, h: 150 }; }

  private keep() {
    if (this.chosen.size !== ARROW_COUNT) { this.floatText(`Choose ${ARROW_COUNT} shafts`, MW / 2, 44, COLORS.ok); return; }
    this.order = [...this.chosen].sort((a, b) => a - b);
    this.phase = 'bend';
    this.cur = 0;
    this.bendsLeft = this.maxBends;
    this.env.audio.sfx('place');
    this.env.onStatus?.(`Shaft 1 / ${ARROW_COUNT}`);
  }

  private nextShaft() {
    this.result.push(this.straightness(this.order[this.cur]));
    this.grab = null;
    this.kbAmt = 0;
    this.cur++;
    if (this.cur >= this.order.length) return this.complete();
    this.bendsLeft = this.maxBends;
    this.env.audio.sfx('place', { volume: 0.6 });
    this.env.onStatus?.(`Shaft ${this.cur + 1} / ${ARROW_COUNT}`);
  }

  private setBend(at: number, amt: number) {
    if (Math.abs(amt) < 0.02) return;
    const i = this.order[this.cur];
    this.fixes[i].push({ at, amt, w: 0.3 });
    this.bendsLeft--;
    const s = this.straightness(i);
    this.env.audio.sfx(s > 0.9 ? 'snap' : 'soft', { volume: 0.6 });
    const x = X0 + at * (X1 - X0);
    this.floatText(s > 0.92 ? 'True' : s > 0.75 ? 'Nearly' : 'Still bowed', this.mirrored ? MW - x : x, CY - 46, s > 0.92 ? COLORS.gold : s > 0.75 ? COLORS.good : COLORS.ok);
    this.spawn(x, CY + 20, { n: 4, vy: -30, spread: 30, life: 0.5, color: COLORS.ember, size: 1 });
    if (this.bendsLeft <= 0) this.floatText('That is all it will take', MW / 2, 60, COLORS.dim);
  }

  protected update(dt: number) {
    if (this.phase === 'match') {
      if ((this.pointer.justDown && this.overBtn()) || this.wasPressed('Enter')) { this.keep(); return; }
      if (this.pointer.justDown) {
        const [x, y] = this.uiPointer();
        for (let i = 0; i < RAW; i++) {
          if (!this.hits(this.rawRect(i), x, y)) continue;
          if (this.chosen.has(i)) this.chosen.delete(i);
          else if (this.chosen.size < ARROW_COUNT) this.chosen.add(i);
          else { this.floatText(`Only ${ARROW_COUNT}`, x, y - 10, COLORS.dim); break; }
          this.env.audio.sfx('click');
          break;
        }
      }
      // keyboard: digits 1–9 toggle
      for (let i = 0; i < RAW; i++) if (this.wasPressed(`Digit${i + 1}`)) { if (this.chosen.has(i)) this.chosen.delete(i); else if (this.chosen.size < ARROW_COUNT) this.chosen.add(i); this.env.audio.sfx('click'); }
      return;
    }
    if (this.phase !== 'bend') return;
    if ((this.pointer.justDown && this.overBtn()) || this.wasPressed('Enter')) { this.nextShaft(); return; }
    const can = this.bendsLeft > 0;
    // pointer: press on the shaft and drag up / down
    if (this.pointer.justDown && can && !this.overBtn()) {
      const at = clamp((this.pointer.x - X0) / (X1 - X0), 0.05, 0.95);
      if (Math.abs(this.pointer.y - CY) < 70) this.grab = { at, y0: this.pointer.y, amt: 0 };
    }
    if (this.grab && this.pointer.down) this.grab.amt = clamp((this.pointer.y - this.grab.y0) / 60, -1.3, 1.3);
    if (this.grab && this.pointer.justUp) { this.setBend(this.grab.at, this.grab.amt); this.grab = null; }
    // keyboard
    const ax = this.axisX(), ay = this.axisY();
    if (ax) this.kbAt = clamp(this.kbAt + ax * 0.5 * dt, 0.05, 0.95);
    if (ay && can) this.kbAmt = clamp(this.kbAmt + ay * 0.9 * dt, -1.3, 1.3);
    if (this.wasPressed('Space') && can) { this.setBend(this.kbAt, this.kbAmt); this.kbAmt = 0; }
  }

  private spineMatch(): number {
    const s = this.order.map((i) => this.spines[i]);
    const m = mean(s);
    const spread = Math.max(...s.map((v) => Math.abs(v - m)));
    // the best possible set from these nine shafts sets the scale
    const sorted = [...this.spines].sort((a, b) => a - b);
    let best = Infinity;
    for (let k = 0; k + ARROW_COUNT <= RAW; k++) best = Math.min(best, (sorted[k + ARROW_COUNT - 1] - sorted[k]) / 2);
    return clamp(1 - (spread - best) / 0.6);
  }

  private complete() {
    this.phase = 'done';
    const match = this.spineMatch();
    const straight = mean(this.result);
    const score = clamp(0.35 * match + 0.65 * straight);
    const s = this.order.map((i) => this.spines[i]);
    const m = mean(s);
    const g = gradeOf(score);
    this.env.audio.sfx('success');
    this.finish({
      score,
      details: { spineMatch: match, straightness: straight },
      data: { straight: this.result.map((v) => Math.round(v * 1000) / 1000), spine: s.map((v) => Math.round(clamp(v - m, -1, 1) * 1000) / 1000) },
      summary: `${g} shafts — ${match > 0.85 ? 'a closely matched set' : match > 0.6 ? 'a fair match' : 'a mixed lot'}, ${straight > 0.88 ? 'every one straight as a ray' : straight > 0.7 ? 'most of them true' : 'several still bowed'}.`,
    });
  }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.3, '#2a2018');
    if (this.phase === 'match') return this.drawMatch(ctx);
    // the heat: a low bed of coals under the shaft
    const glow = ctx.createRadialGradient(MW / 2, CY + 60, 4, MW / 2, CY + 60, 200);
    glow.addColorStop(0, 'rgba(255,140,60,0.25)');
    glow.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, CY - 40, MW, 140);
    // sighting line
    ctx.strokeStyle = 'rgba(240,200,96,0.35)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(X0 - 10, CY); ctx.lineTo(X1 + 10, CY); ctx.stroke();
    ctx.setLineDash([]);
    if (this.phase === 'done' || this.cur >= this.order.length) return;
    const i = this.order[this.cur];
    const live: Bend | undefined = this.grab ? { at: this.grab.at, amt: this.grab.amt, w: 0.3 } : Math.abs(this.kbAmt) > 0.01 ? { at: this.kbAt, amt: this.kbAmt, w: 0.3 } : undefined;
    // the shaft, bends exaggerated
    for (const [col, off] of [[this.wood[1], 2], [this.wood[3], 0], [this.wood[5], -1]] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = off === 0 ? 4 : 1;
      ctx.beginPath();
      for (let k = 0; k <= SAMPLES; k++) {
        const x = X0 + (k / SAMPLES) * (X1 - X0), y = CY + this.shape(i, k / SAMPLES, live) * 46 + off;
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // where the hands are
    const at = this.grab ? this.grab.at : this.kbAt;
    if (this.grab || this.kbAmt !== 0 || !this.touchInput) {
      const x = X0 + at * (X1 - X0), y = CY + this.shape(i, at, live) * 46;
      ctx.strokeStyle = this.bendsLeft > 0 ? COLORS.cream : COLORS.dim;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.stroke();
    }
  }

  private drawMatch(ctx: CanvasRenderingContext2D) {
    for (let i = 0; i < RAW; i++) {
      const r = this.rawRect(i);
      const on = this.chosen.has(i);
      this.panel(r.x, r.y, r.w, r.h, on ? 'rgba(90,70,30,0.85)' : 'rgba(30,20,16,0.6)', on ? COLORS.gold : COLORS.panelEdge);
      // the shaft on its two supports, sagging under the weight
      const sag = 6 + (this.reading[i] + 1) * 9;
      ctx.strokeStyle = this.wood[3];
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(r.x + 6, r.y + 24); ctx.quadraticCurveTo(r.x + r.w / 2, r.y + 24 + sag * 2, r.x + r.w - 6, r.y + 24); ctx.stroke();
      ctx.fillStyle = '#5a5a66';
      ctx.fillRect(r.x + r.w / 2 - 3, r.y + 24 + sag, 6, 6);
      // the reading: a bar showing how far it bends
      const bh = 70, by = r.y + 62;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(r.x + r.w / 2 - 4, by, 8, bh);
      const v = (this.reading[i] + 1) / 2;
      ctx.fillStyle = on ? COLORS.gold : COLORS.cool;
      ctx.fillRect(r.x + r.w / 2 - 4, by + bh * (1 - v) - 1, 8, 3);
    }
    // band covered by the chosen shafts
    if (this.chosen.size > 1) {
      const vs = [...this.chosen].map((i) => (this.reading[i] + 1) / 2);
      const lo = Math.min(...vs), hi = Math.max(...vs);
      ctx.fillStyle = 'rgba(240,200,96,0.14)';
      ctx.fillRect(34, 60 + 62 + 70 * (1 - hi) - 2, 412, 70 * (hi - lo) + 4);
    }
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    if (this.phase === 'match') {
      this.text('Spine matching', MW / 2, 12, { size: 10, align: 'center', color: COLORS.gold });
      this.text(`Each mark shows how far a shaft bends. Choose the ${ARROW_COUNT} that bend most alike.`, MW / 2, 28, { size: 8, align: 'center', color: COLORS.paper });
      for (let i = 0; i < RAW; i++) { const r = this.rawRect(i); this.text(String(i + 1), r.x + r.w / 2, r.y + r.h - 8, { size: 8, align: 'center', color: COLORS.dim, shadow: false }); }
      this.text(`${this.chosen.size} / ${ARROW_COUNT} chosen`, 12, MH - 14, { size: 10, color: COLORS.paper });
      const ready = this.chosen.size === ARROW_COUNT;
      this.panel(BTN.x, BTN.y, BTN.w, BTN.h, ready ? 'rgba(90,120,60,0.9)' : COLORS.panel, ready ? COLORS.good : COLORS.panelEdge);
      this.text('Keep these', BTN.x + BTN.w / 2, BTN.y + BTN.h / 2, { size: 10, align: 'center', color: COLORS.cream });
      return;
    }
    this.text(`Straightening — shaft ${Math.min(this.cur + 1, ARROW_COUNT)} of ${ARROW_COUNT}`, MW / 2, 12, { size: 10, align: 'center', color: COLORS.gold });
    this.text(this.touchInput ? 'Press where the shaft bows and drag it back to the line, then let go' : 'Press where the shaft bows, drag it to the line and let go • ←/→ ↑/↓ then Space', MW / 2, 28, { size: 8, align: 'center', color: COLORS.paper });
    if (this.phase !== 'bend' || this.cur >= this.order.length) return;
    const s = this.straightness(this.order[this.cur]);
    this.text(`Straightness ${Math.round(s * 100)}%`, 12, MH - 14, { size: 10, color: s > 0.9 ? COLORS.good : COLORS.paper });
    this.text(`Bends left ${this.bendsLeft}`, 150, MH - 14, { size: 10, color: this.bendsLeft ? COLORS.paper : COLORS.ok });
    this.panel(BTN.x, BTN.y, BTN.w, BTN.h, this.overBtn() ? 'rgba(90,60,30,0.9)' : COLORS.panel, s > 0.9 || !this.bendsLeft ? COLORS.good : COLORS.gold);
    this.text(this.cur === ARROW_COUNT - 1 ? 'Finish' : 'Next shaft', BTN.x + BTN.w / 2, BTN.y + BTN.h / 2, { size: 10, align: 'center', color: COLORS.cream });
  }
}

export const straightenGame: MinigameDef = {
  id: 'straighten',
  name: 'Matching & Straightening',
  controls: 'Matching: click / tap shafts (or 1–9), then "Keep these" or Enter. Straightening: press on the shaft and drag up or down, then let go — or ←/→ and ↑/↓ then Space. "Next shaft" or Enter moves on.',
  instructions: (env) => [
    `First the spine tester: each of nine shafts bends a different amount under the same weight. Choose the ${ARROW_COUNT} that bend most alike.`,
    'Then sight down each one. Press where it bows, ease it back to the line and let go — it keeps the bend you give it.',
    `Each shaft will only take ${Math.round(4.5 - Math.min(4, env.difficulty) * 0.5)} or so bends over the heat, so make them count.`,
  ],
  create: (env) => new Straighten(env),
};
