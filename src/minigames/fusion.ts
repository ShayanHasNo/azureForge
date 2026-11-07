// Experimental alchemical fusion. Two molten pools — the primary metal and the
// metal it is fused with (item.materials.fusedWith, 'brass' if unset) — pour into
// a crucible. A seeded target mix ratio (0.3..0.7, share of the fused metal) is
// marked on the gauge; the player works a valve that splits the pour between the
// pools while the flows wobble and surge (scaled by both metals' volatility).
// The metals pour at different seeded rates, so valve position != ratio: the
// player must watch the crucible gauge, which lags behind like a real melt.
//  - valve: Left/Right (A/D, arrows) or drag the slider,
//  - stir: Space / click the crucible (or anywhere off the slider) — calms the
//    turbulence for a moment, then needs a short rest.
// Score = time-weighted closeness of the crucible ratio to the target (~15s)
// blended with stability (how little the melt ratio churned).
//
// data: { mix: average fused-metal ratio 0.15..0.85, volatility: 0..1 measured turbulence }
// details: closeness, stability, inBand, surges, stirs

import { seededRng } from '../core/rng';
import { clamp, mixHex } from '../core/util';
import { hasMat, mat, type MaterialDef } from '../data/materials';
import { cloneItem } from '../item/factory';
import type { Item } from '../item/types';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

const ACTIVE_TIME = 15;
const INTRO_TIME = 2.5;
const SX0 = 100, SX1 = 300, SY = 236; // valve slider
const GX0 = 100, GX1 = 300, GY = 204; // ratio gauge
const CX = 200, CY = 158; // crucible centre
const POOL_A = { x: 22, y: 44, w: 100, h: 34 };
const POOL_B = { x: 278, y: 44, w: 100, h: 34 };

interface Surge { side: 0 | 1; t: number; dur: number; amt: number }

class Fusion extends BaseMinigame {
  private rng = seededRng(this.env.item.seed, 'fusion');
  private matA: MaterialDef;
  private matB: MaterialDef;
  private target: number;
  private valve = 0.5;
  private rateB: number;
  private ratio = 0.5;
  private prevRatio = 0.5;
  private amp: number;
  private tau: number;
  private tol: number;
  private ph: number[] = [];
  private surges: Surge[] = [];
  private surgeTimer: number;
  private surgeCount = 0;
  private stirT = 0;
  private stirCd = 0;
  private stirs = 0;
  private stirAnim = 0;
  private dragging = false;
  private elapsed = 0;
  private active = 0;
  private closeSum = 0;
  private inBandTime = 0;
  private mixSum = 0;
  private churn = 0;
  private streak = 0;
  private flowA = 0.5;
  private flowB = 0.5;
  private preview: Item;
  private previewCanvas: HTMLCanvasElement;
  private previewKey = -1;
  private loopOn = false;
  private lastPct = -1;

  constructor(env: MinigameEnv) {
    super(env);
    const pid = env.item.materials.primary;
    this.matA = hasMat(pid) ? mat(pid) : env.material;
    const fid = env.item.materials.fusedWith && hasMat(env.item.materials.fusedWith) ? env.item.materials.fusedWith : 'brass';
    this.matB = mat(fid);
    this.target = this.rng.range(0.3, 0.7);
    this.rateB = this.rng.range(0.7, 1.35);
    const vol = ((this.matA.prep?.volatility ?? 0.08) + (this.matB.prep?.volatility ?? 0.08)) / 2;
    this.amp = clamp(this.tune(0.1, 0.25) + vol * 1.2, 0.1, 0.6);
    this.tau = this.tune(0.7, 1.05);
    this.tol = this.tune(0.06, 0.03) * (env.quirk === 'bursts' ? 1.3 : 1);
    for (let i = 0; i < 6; i++) this.ph.push(this.rng.range(0, Math.PI * 2));
    this.surgeTimer = this.nextSurge() + 1.5;
    this.preview = cloneItem(env.item);
    this.preview.materials.fusedWith = fid;
    this.previewCanvas = this.sprite(this.preview);
    this.updatePreview();
    env.onStatus?.('Watch the gold marker — that is the mix to hold.');
  }

  private nextSurge() {
    const vol = ((this.matA.prep?.volatility ?? 0.08) + (this.matB.prep?.volatility ?? 0.08)) / 2;
    return this.rng.range(2.4, 5) / (0.6 + vol * 4) / this.tune(0.85, 1.3);
  }

  private sx(x: number) { return this.mirrored ? MW - x : x; }

  private goal() {
    let g = this.target;
    if (this.env.quirk === 'drifting') g += Math.sin(this.t * 0.4) * 0.05;
    return clamp(g, 0.2, 0.8);
  }

  private closeness(d: number) {
    const w = this.tol;
    if (d <= w) return 1 - 0.25 * (d / w) * (d / w);
    return 0.75 * Math.max(0, 1 - (d - w) / (w * 3));
  }

  private updatePreview() {
    const key = Math.round(clamp(this.ratio, 0.15, 0.85) * 20);
    if (key === this.previewKey) return;
    this.previewKey = key;
    this.preview.surface.fusion = key / 20;
    this.previewCanvas = this.sprite(this.preview);
  }

  // ------------------------------------------------------------ input
  protected onPointerDown() {
    if (this.finished) return;
    const p = this.pointer;
    if (p.y >= SY - 16 && p.y <= SY + 16 && p.x >= SX0 - 14 && p.x <= SX1 + 14) {
      this.dragging = true;
      this.valve = clamp((p.x - SX0) / (SX1 - SX0));
      return;
    }
    this.stir();
  }
  protected onPointerUp() { this.dragging = false; }

  private stir() {
    if (this.stirCd > 0) {
      this.floatText('Let it settle…', this.sx(CX), CY - 40, COLORS.dim);
      return;
    }
    this.stirT = 1.6;
    this.stirCd = 3;
    this.stirs++;
    this.stirAnim = 1;
    this.env.audio.sfx('polish', { volume: 0.7, pitch: 0.8 });
    this.spawn(CX, CY - 10, { n: 8, vy: -30, spread: 70, life: 0.6, color: COLORS.gold, size: 1, g: 40 });
  }

  // ------------------------------------------------------------ update
  protected update(dt: number) {
    this.elapsed += dt;
    this.stirT = Math.max(0, this.stirT - dt);
    this.stirCd = Math.max(0, this.stirCd - dt);
    this.stirAnim = Math.max(0, this.stirAnim - dt * 0.8);

    if (this.wasPressed('Space', 'Enter')) this.stir();
    if (this.dragging && this.pointer.down) this.valve = clamp((this.pointer.x - SX0) / (SX1 - SX0));
    else this.valve = clamp(this.valve + this.axisX() * 0.45 * dt);

    // --- surges
    this.surgeTimer -= dt;
    if (this.surgeTimer <= 0) {
      this.surgeTimer = this.nextSurge();
      const side = this.rng.chance(0.5) ? 0 : 1;
      const amt = this.rng.range(0.4, 0.8) * this.amp * 2 * (this.env.quirk === 'bursts' ? 1.4 : 1) * (this.rng.chance(0.3) ? -0.6 : 1);
      this.surges.push({ side, t: 0, dur: this.rng.range(1.2, 2), amt });
      this.surgeCount++;
      const sx = side === 0 ? POOL_A.x + POOL_A.w : POOL_B.x;
      this.sparks(sx, POOL_A.y + 26, 10, side === 0 ? this.matA.palette[4] : this.matB.palette[4]);
      this.env.audio.sfx('sizzle', { volume: 0.45, pitch: 0.9 + Math.random() * 0.3 });
      this.floatText(amt > 0 ? 'Surge!' : 'Sputter…', this.sx(side === 0 ? POOL_A.x + POOL_A.w / 2 : POOL_B.x + POOL_B.w / 2), POOL_A.y - 6, COLORS.ember);
    }
    let surA = 0, surB = 0;
    for (const s of this.surges) {
      s.t += dt;
      const e = Math.sin(Math.PI * clamp(s.t / s.dur)) * s.amt;
      if (s.side === 0) surA += e; else surB += e;
    }
    this.surges = this.surges.filter((s) => s.t < s.dur);

    // --- flows
    const calm = this.stirT > 0 ? 0.35 + 0.65 * (1 - Math.sin((Math.PI / 2) * clamp(this.stirT / 1.6))) : 1;
    const t = this.t, ph = this.ph, a = this.amp * calm;
    const wobA = 0.55 * Math.sin(1.3 * t + ph[0]) + 0.3 * Math.sin(2.9 * t + ph[1]) + 0.15 * Math.sin(5.3 * t + ph[2]);
    const wobB = 0.55 * Math.sin(1.1 * t + ph[3]) + 0.3 * Math.sin(3.3 * t + ph[4]) + 0.15 * Math.sin(4.7 * t + ph[5]);
    const sA = Math.max(0.05, 1 + a * wobA + surA * calm);
    const sB = Math.max(0.05, 1 + a * wobB + surB * calm);
    const fA = (1 - this.valve) * sA;
    const fB = this.valve * this.rateB * sB;
    this.flowA = fA; this.flowB = fB;
    const sum = fA + fB;
    if (sum > 1e-4) {
      const q = fB / sum;
      this.ratio += (q - this.ratio) * (1 - Math.exp(-dt / this.tau));
    }
    this.ratio = clamp(this.ratio);
    const dr = Math.abs(this.ratio - this.prevRatio);
    this.prevRatio = this.ratio;
    this.updatePreview();

    // bubbles
    if (!this.reducedMotion && Math.random() < dt * (3 + a * 10)) {
      this.spawn(CX - 34 + Math.random() * 68, CY - 14, { n: 1, vy: -18, spread: 10, life: 0.5, color: mixHex(this.matA.palette[5], this.matB.palette[5], this.ratio), size: 1, g: -10 });
    }

    // --- scoring
    const g = this.goal();
    const d = Math.abs(this.ratio - g);
    if (this.elapsed >= INTRO_TIME) {
      this.active += dt;
      this.closeSum += this.closeness(d) * dt;
      this.mixSum += this.ratio * dt;
      this.churn += dr;
      if (d <= this.tol) {
        this.inBandTime += dt;
        this.streak += dt;
        if (this.streak >= 3) {
          this.streak = 0;
          this.env.audio.sfx('chime', { volume: 0.45, pitch: 1 + Math.random() * 0.1 });
          this.floatText('Steady', this.sx(CX), CY - 44, COLORS.good);
        }
      } else this.streak = 0;
      const pct = Math.floor((this.active / ACTIVE_TIME) * 10) * 10;
      if (pct !== this.lastPct) { this.lastPct = pct; this.env.onStatus?.(`Fusing ${Math.min(100, pct)}%`); }
      if (this.active >= ACTIVE_TIME) return this.complete();
    }

    this.env.audio.loop('heat', true, clamp(0.3 + Math.abs(surA + surB) * 0.6 + a * 0.4));
    this.loopOn = true;
  }

  private complete() {
    if (this.loopOn) { this.env.audio.loop('heat', false); this.loopOn = false; }
    const act = Math.max(0.001, this.active);
    const closeness = clamp(this.closeSum / act);
    const inBand = clamp(this.inBandTime / act);
    const volatility = clamp(this.churn / act / 0.18);
    const stability = 1 - volatility;
    const mix = clamp(this.mixSum / act, 0.15, 0.85);
    const score = clamp(closeness * 0.8 + stability * 0.2);
    this.env.audio.sfx('success');
    const g = gradeOf(score);
    this.finish({
      score,
      details: { closeness, stability, inBand, surges: this.surgeCount, stirs: this.stirs },
      data: { mix: Math.round(mix * 1000) / 1000, volatility: Math.round(volatility * 1000) / 1000 },
      summary: `${g} fusion — ${this.matA.name.toLowerCase()} and ${this.matB.name.toLowerCase()} settled ${closeness > 0.8 ? 'right at' : closeness > 0.6 ? 'close to' : 'somewhere near'} the mix you aimed for, ${stability > 0.7 ? 'with a calm melt' : stability > 0.45 ? 'with a lively melt' : 'in a wild, churning melt'}.`,
    });
  }

  protected onDestroy() {
    if (this.loopOn) { this.env.audio.loop('heat', false); this.loopOn = false; }
  }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.7, '#2a1e30');
    const A = this.matA.palette, B = this.matB.palette;
    this.drawPool(ctx, POOL_A, A);
    this.drawPool(ctx, POOL_B, B);
    // streams
    this.drawStream(ctx, POOL_A.x + POOL_A.w, POOL_A.y + 24, CX - 14, CY - 16, this.flowA, A);
    this.drawStream(ctx, POOL_B.x, POOL_B.y + 24, CX + 14, CY - 16, this.flowB, B);
    this.drawCrucible(ctx);
    this.drawGauge(ctx);
    this.drawSlider(ctx);
    // the piece-to-be, showing the fusion swirl
    this.panel(392, 18, 84, 232, 'rgba(30,20,30,0.6)', '#5a4060');
    const big = this.previewCanvas.height <= 116 && this.previewCanvas.width <= 40;
    this.drawSprite(this.previewCanvas, 434, 134, big ? 2 : 1);
  }

  private drawPool(ctx: CanvasRenderingContext2D, p: { x: number; y: number; w: number; h: number }, pal: string[]) {
    ctx.fillStyle = '#3a3036';
    ctx.fillRect(p.x - 4, p.y - 4, p.w + 8, p.h + 10);
    ctx.fillStyle = '#4c4048';
    ctx.fillRect(p.x - 4, p.y - 4, p.w + 8, 2);
    ctx.fillStyle = pal[2];
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.fillStyle = pal[3];
    ctx.fillRect(p.x, p.y, p.w, 10);
    // shimmering surface
    ctx.fillStyle = pal[5];
    for (let i = 0; i < 6; i++) {
      const x = p.x + ((i * 19 + this.t * 14) % p.w);
      ctx.fillRect(Math.round(x), p.y + 2 + (i % 3) * 2, 6, 1);
    }
    const glow = ctx.createRadialGradient(p.x + p.w / 2, p.y + p.h / 2, 4, p.x + p.w / 2, p.y + p.h / 2, p.w * 0.8);
    glow.addColorStop(0, 'rgba(255,170,90,0.18)');
    glow.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(p.x - 30, p.y - 30, p.w + 60, p.h + 60);
  }

  private drawStream(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, flow: number, pal: string[]) {
    const w = clamp(flow * 4, 0, 8);
    if (w < 0.3) return;
    const steps = 28;
    for (let i = 0; i <= steps; i++) {
      const k = i / steps;
      // a falling arc: horizontal ease-out, vertical ease-in
      const x = x0 + (x1 - x0) * (1 - (1 - k) * (1 - k));
      const y = y0 + (y1 - y0) * k * k;
      const ww = Math.max(1, Math.round(w * (0.8 + 0.2 * Math.sin(this.t * 12 + i))));
      ctx.fillStyle = i % 4 === Math.floor(this.t * 16) % 4 ? pal[5] : pal[4];
      ctx.fillRect(Math.round(x - ww / 2), Math.round(y), ww, 3);
    }
  }

  private drawCrucible(ctx: CanvasRenderingContext2D) {
    const A = this.matA.palette, B = this.matB.palette;
    // bowl
    ctx.fillStyle = '#2a2428';
    ctx.beginPath();
    ctx.moveTo(CX - 52, CY - 18);
    ctx.lineTo(CX + 52, CY - 18);
    ctx.lineTo(CX + 40, CY + 26);
    ctx.lineTo(CX - 40, CY + 26);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4a4048';
    ctx.fillRect(CX - 56, CY - 22, 112, 5);
    // melt with swirl stripes
    const mixC = mixHex(A[3], B[3], this.ratio);
    ctx.fillStyle = mixC;
    ctx.fillRect(CX - 46, CY - 16, 92, 12);
    const spin = this.t * (1.2 + this.stirAnim * 4);
    for (let i = 0; i < 9; i++) {
      const ang = spin + i * 0.7;
      const x = CX + Math.cos(ang) * (16 + (i % 3) * 10);
      const y = CY - 10 + Math.sin(ang) * 3;
      ctx.fillStyle = i % 2 ? A[4] : B[4];
      ctx.fillRect(Math.round(x) - 3, Math.round(y), 6, 1);
    }
    const glow = ctx.createRadialGradient(CX, CY - 10, 3, CX, CY - 10, 70);
    glow.addColorStop(0, 'rgba(255,200,120,0.3)');
    glow.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(CX - 70, CY - 80, 140, 120);
    // stir rod
    if (this.stirT > 0) {
      const ang = this.t * 6;
      const rx = CX + Math.cos(ang) * 22;
      ctx.fillStyle = '#7a5a3a';
      ctx.fillRect(Math.round(rx), CY - 44, 3, 36);
      ctx.fillStyle = '#9a7a4a';
      ctx.fillRect(Math.round(rx), CY - 44, 1, 36);
    }
  }

  private drawGauge(ctx: CanvasRenderingContext2D) {
    const A = this.matA.palette, B = this.matB.palette;
    const w = GX1 - GX0;
    for (let i = 0; i < w; i += 4) {
      ctx.fillStyle = mixHex(A[3], B[3], i / w);
      ctx.fillRect(GX0 + i, GY, 4, 8);
    }
    const flicker = this.env.quirk === 'flicker' && Math.sin(this.t * 6.1) > 0.55;
    if (!flicker) {
      const g = this.goal();
      ctx.fillStyle = 'rgba(143,209,106,0.55)';
      ctx.fillRect(Math.round(GX0 + (g - this.tol) * w), GY - 3, Math.max(2, Math.round(this.tol * 2 * w)), 14);
      ctx.fillStyle = COLORS.gold;
      ctx.fillRect(Math.round(GX0 + g * w) - 1, GY - 5, 3, 18);
    }
    const rx = Math.round(GX0 + this.ratio * w);
    ctx.fillStyle = COLORS.cream;
    ctx.beginPath();
    ctx.moveTo(rx - 4, GY - 8);
    ctx.lineTo(rx + 4, GY - 8);
    ctx.lineTo(rx, GY - 2);
    ctx.fill();
    ctx.fillRect(rx, GY - 2, 1, 12);
  }

  private drawSlider(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = '#1a1214';
    ctx.fillRect(SX0, SY - 2, SX1 - SX0, 5);
    ctx.fillStyle = '#4a3a30';
    ctx.fillRect(SX0, SY - 2, SX1 - SX0, 1);
    for (let i = 0; i <= 10; i++) { ctx.fillStyle = 'rgba(255,244,220,0.25)'; ctx.fillRect(SX0 + (i * (SX1 - SX0)) / 10, SY + 5, 1, 3); }
    const kx = Math.round(SX0 + this.valve * (SX1 - SX0));
    ctx.fillStyle = this.dragging ? COLORS.gold : '#c8a060';
    ctx.fillRect(kx - 5, SY - 8, 11, 16);
    ctx.fillStyle = '#6a4a2a';
    ctx.fillRect(kx - 1, SY - 6, 3, 12);
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    this.text(this.matA.name, this.sx(POOL_A.x + POOL_A.w / 2), POOL_A.y + POOL_A.h + 14, { size: 9, align: 'center', color: COLORS.paper });
    this.text(this.matB.name, this.sx(POOL_B.x + POOL_B.w / 2), POOL_B.y + POOL_B.h + 14, { size: 9, align: 'center', color: COLORS.paper });
    // slider end labels follow the (possibly mirrored) slider ends
    this.text(`more ${this.matA.name.toLowerCase()}`, this.sx(SX0 - 6), SY, { size: 8, align: this.mirrored ? 'left' : 'right', color: COLORS.dim });
    this.text(`more ${this.matB.name.toLowerCase()}`, this.sx(SX1 + 6), SY, { size: 8, align: this.mirrored ? 'right' : 'left', color: COLORS.dim });
    const prog = this.active / ACTIVE_TIME;
    const hx = this.sx(CX);
    this.panel(hx - 70, 6, 140, 22);
    this.bar(hx - 60, 19, 120, 4, prog, COLORS.ember);
    const intro = this.elapsed < INTRO_TIME;
    this.text(intro ? 'Watch the gold marker…' : 'Hold the mix on the gold mark', hx, 12, { size: 9, align: 'center', color: intro ? COLORS.gold : COLORS.paper });
    const stirLabel = this.stirCd > 0 ? `stir ready in ${Math.ceil(this.stirCd)}` : 'stir ready';
    this.text(stirLabel, this.sx(CX), CY + 34, { size: 8, align: 'center', color: this.stirCd > 0 ? COLORS.dim : COLORS.good });
    this.text('Valve: Left/Right (A/D) or drag  ·  Stir: Space or click the crucible', MW / 2, MH - 10, { size: 9, align: 'center', color: COLORS.paper });
  }
}

export const fusionGame: MinigameDef = {
  id: 'fusion',
  name: 'Alchemical Fusion',
  controls: 'Left/Right (A/D) or drag the valve slider to balance the pour. Space or click the crucible to stir and calm the melt.',
  instructions: (env) => {
    const f = env.item.materials.fusedWith && hasMat(env.item.materials.fusedWith) ? mat(env.item.materials.fusedWith).name : 'Brass';
    return [
      `Two molten metals pour into the crucible: ${env.material.name} and ${f}.`,
      'Keep the crucible\'s mix on the gold marker — the pours wobble and surge, and the melt reacts a moment late.',
      'Stir to calm the turbulence briefly; it needs a short rest between stirs.',
    ];
  },
  create: (env) => new Fusion(env),
};
