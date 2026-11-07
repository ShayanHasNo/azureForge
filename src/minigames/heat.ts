// Material preparation — heat management at the forge. The piece lies in the
// coals and slowly loses condition (rate from material.prep.cool) while the
// coals flare up now and then (scaled by prep.volatility). The player feeds air:
//  - click / tap / Space = one puff from the hand bellows (a discrete impulse
//    that flows in over a moment),
//  - with the 'bellows' upgrade: hold B or hold the on-canvas bellows for a
//    smooth steady draught that builds and fades with inertia.
// The sweet band is centred on prep.ideal (half-width prep.band, narrowed by
// difficulty). From intermediate difficulty the band moves mid-session
// ("now bring it to working heat"). Score is the time-weighted closeness to the
// band centre over ~14s of working time. Too hot / too cold only scores lower.
//
// data: {}   details: closeness, inBand, overheats, chills, flares, puffs

import { seededRng } from '../core/rng';
import { clamp, mixRgb, rgbToHex, smoothstep, type RGB } from '../core/util';
import type { PrepProfile } from '../data/materials';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

const WORK_TIME = 14;
const DEFAULT_PREP: PrepProfile = { ideal: 0.55, band: 0.15, cool: 0.11, volatility: 0.06 };

// Heat colour ramp (cool → white hot).
const HEAT_STOPS: [number, RGB][] = [
  [0.0, [60, 30, 24]],
  [0.25, [140, 30, 18]],
  [0.45, [214, 70, 26]],
  [0.62, [255, 138, 42]],
  [0.8, [255, 210, 96]],
  [1.0, [255, 248, 228]],
];

function heatRgb(h: number): RGB {
  h = clamp(h);
  for (let i = 1; i < HEAT_STOPS.length; i++) {
    const [b, cb] = HEAT_STOPS[i];
    const [a, ca] = HEAT_STOPS[i - 1];
    if (h <= b) return mixRgb(ca, cb, (h - a) / (b - a));
  }
  return HEAT_STOPS[HEAT_STOPS.length - 1][1];
}

interface Coal { x: number; y: number; w: number; ph: number }

class Heat extends BaseMinigame {
  private rng = seededRng(this.env.item.seed, 'heat');
  private prep: PrepProfile;
  private heat = 0.12;
  private pendingHeat = 0;
  private hasBellows: boolean;
  private bellowsPower = 0;
  private pointerBellows = false;
  private puffAnim = 0;
  private puffs = 0;
  private puffSize: number;
  private bellowsRate = 0.34;
  // band
  private centre: number;
  private centreGoal: number;
  private halfW: number;
  private secondCentre: number | null = null;
  private secondStarted = false;
  // phases: 0 warm-up, 1 working, 2 repositioning (paused), 3 working (second heat)
  private phase = 0;
  private phaseTimer = 0;
  private work = 0;
  private closenessSum = 0;
  private inBandTime = 0;
  private overheats = 0;
  private chills = 0;
  private hotState = 0; // -1 cold, 0 ok, 1 hot
  private wasInBand = false;
  private feedbackCd = 0;
  // flares
  private flareTimer: number;
  private flareWarn = 0;
  private flareAmt = 0;
  private flares = 0;
  private flareGlow = 0;
  // visuals
  private spr: HTMLCanvasElement;
  private tintCanvas: HTMLCanvasElement;
  private tintCtx: CanvasRenderingContext2D;
  private coals: Coal[] = [];
  private loopHeatOn = false;
  private loopBellowsOn = false;
  private readonly isShield: boolean;
  private readonly bellowsBtn = { x: 14, y: 176, w: 96, h: 62 };
  private lastStatus = '';

  constructor(env: MinigameEnv) {
    super(env);
    this.prep = env.material.prep ?? DEFAULT_PREP;
    this.isShield = env.item.category === 'shield';
    this.hasBellows = env.upgrades.includes('bellows');
    this.halfW = clamp(this.prep.band * this.tune(1.15, 0.6) * (env.quirk === 'bursts' ? 1.3 : 1), 0.035, 0.25);
    this.centre = clamp(this.prep.ideal, this.halfW + 0.05, 0.95 - this.halfW);
    this.centreGoal = this.centre;
    if (env.difficulty >= 1.5) {
      const sign = this.centre >= 0.55 ? -1 : 1;
      this.secondCentre = clamp(this.centre + sign * this.tune(0.1, 0.18), this.halfW + 0.05, 0.95 - this.halfW);
    }
    this.puffSize = 0.085;
    this.flareTimer = this.nextFlareInterval() + 2;
    this.spr = this.sprite();
    this.tintCanvas = document.createElement('canvas');
    this.tintCanvas.width = this.spr.width;
    this.tintCanvas.height = this.spr.height;
    this.tintCtx = this.tintCanvas.getContext('2d')!;
    for (let i = 0; i < 46; i++) {
      this.coals.push({ x: 150 + this.rng.range(0, 180), y: 178 + this.rng.range(0, 14), w: this.rng.int(4, 9), ph: this.rng.range(0, Math.PI * 2) });
    }
    this.status('Warming the metal…');
  }

  private nextFlareInterval() {
    const vol = Math.max(0.02, this.prep.volatility);
    return Math.max(2, this.rng.range(0.6, 1.4) * (0.7 / (vol * this.tune(1, 1.6))));
  }

  private status(s: string) {
    if (s !== this.lastStatus) { this.lastStatus = s; this.env.onStatus?.(s); }
  }

  private sx(x: number) { return this.mirrored ? MW - x : x; }

  private inBellowsBtn() {
    const b = this.bellowsBtn, p = this.pointer;
    return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
  }

  private bandCentre() {
    let c = this.centre;
    if (this.env.quirk === 'drifting') c += Math.sin(this.t * 0.45) * 0.05;
    return clamp(c, 0.05, 0.95);
  }

  // ------------------------------------------------------------ input
  protected onPointerDown() {
    if (this.finished) return;
    if (this.hasBellows && this.inBellowsBtn()) { this.pointerBellows = true; return; }
    this.puff();
  }
  protected onPointerUp() { this.pointerBellows = false; }

  private puff() {
    this.pendingHeat += this.puffSize;
    this.puffs++;
    this.puffAnim = 1;
    this.env.audio.sfx('bellows', { pitch: 0.92 + Math.random() * 0.16, volume: 0.8 });
    // a breath of air from the nozzle into the coals
    this.spawn(132, 207, { n: 6, vx: 90, vy: -4, spread: 30, life: 0.45, color: 'rgba(255,240,220,0.8)', size: 2, g: -10 });
    this.spawn(230, 184, { n: 5, vy: -50, spread: 70, life: 0.6, color: COLORS.gold, size: 1, g: -20 });
  }

  // ------------------------------------------------------------ update
  protected update(dt: number) {
    this.puffAnim = Math.max(0, this.puffAnim - dt * 3);
    this.feedbackCd = Math.max(0, this.feedbackCd - dt);
    this.flareGlow = Math.max(0, this.flareGlow - dt * 1.5);

    if (this.wasPressed('Space')) this.puff();

    // --- heat dynamics
    let coolMul = 1;
    if (this.env.quirk === 'bursts') coolMul = 0.6 + 0.9 * (0.5 + 0.5 * Math.sin(this.t * 1.7));
    this.heat -= this.prep.cool * coolMul * (0.35 + this.heat) * dt;
    const flow = this.pendingHeat * Math.min(1, dt * 5);
    this.pendingHeat -= flow;
    this.heat += flow;
    const held = this.hasBellows && (this.isDown('KeyB') || this.pointerBellows);
    const goal = held ? 1 : 0;
    this.bellowsPower += (goal - this.bellowsPower) * Math.min(1, dt * (held ? 1.6 : 3));
    if (this.bellowsPower < 0.002) this.bellowsPower = 0;
    this.heat += this.bellowsPower * this.bellowsRate * dt;
    // the coals never sit perfectly still
    const vol = this.prep.volatility;
    this.heat += (Math.sin(this.t * 1.7 + 0.4) * 0.5 + Math.sin(this.t * 3.3) * 0.3) * vol * 0.3 * dt;

    // --- flare-ups: a short warning, then a surge
    if (this.flareWarn > 0) {
      this.flareWarn -= dt;
      if (Math.random() < dt * 30) this.spawn(160 + Math.random() * 160, 180, { n: 1, vy: -40, spread: 40, life: 0.4, color: COLORS.gold, size: 1, g: -10 });
      if (this.flareWarn <= 0) {
        this.pendingHeat += this.flareAmt;
        this.flares++;
        this.flareGlow = 1;
        this.sparks(240, 176, 16, COLORS.gold);
        this.env.audio.sfx('sizzle', { volume: 0.5, pitch: 1.2 });
        this.shake(1.5);
      }
    } else {
      this.flareTimer -= dt;
      if (this.flareTimer <= 0) {
        this.flareWarn = 0.75;
        this.flareAmt = this.rng.range(0.06, 0.12) * this.tune(1, 1.4) * (this.env.quirk === 'bursts' ? 1.2 : 1);
        this.flareTimer = this.nextFlareInterval();
        this.env.audio.sfx('pop', { volume: 0.4, pitch: 0.7 });
        if (this.flares === 0) this.floatText('The coals crackle…', this.sx(240), 150, COLORS.gold);
      }
    }
    this.heat = clamp(this.heat);

    // --- band and phases
    if (this.centre !== this.centreGoal) {
      const d = this.centreGoal - this.centre;
      const step = 0.15 * dt;
      this.centre = Math.abs(d) <= step ? this.centreGoal : this.centre + Math.sign(d) * step;
    }
    const c = this.bandCentre();
    const dist = Math.abs(this.heat - c);
    const inBand = dist <= this.halfW;
    this.phaseTimer += dt;

    if (this.phase === 0 || this.phase === 2) {
      // warm-up / repositioning: no scoring until the player reaches the band (or a few seconds pass)
      const limit = this.phase === 0 ? 7 : 4;
      if ((inBand && this.centre === this.centreGoal) || this.phaseTimer > limit) {
        this.phase = this.phase === 0 ? 1 : 3;
        this.phaseTimer = 0;
        if (inBand) { this.floatText('Just right', this.sx(240), 140, COLORS.good); this.env.audio.sfx('chime', { volume: 0.5 }); this.feedbackCd = 3; }
      }
      this.status(this.phase === 0 ? 'Warming the metal…' : 'Bring it to working heat…');
    } else {
      this.work += dt;
      this.closenessSum += this.closeness(dist) * dt;
      if (inBand) this.inBandTime += dt;
      // gentle feedback on band transitions
      if (inBand && !this.wasInBand && this.feedbackCd <= 0) {
        this.floatText('Just right', this.sx(240), 140, COLORS.good);
        this.env.audio.sfx('chime', { volume: 0.35, pitch: 1.1 });
        this.feedbackCd = 3;
      }
      const hot = this.heat > c + this.halfW * 2.2 ? 1 : this.heat < c - this.halfW * 2.2 ? -1 : 0;
      const backInside = dist < this.halfW;
      if (hot !== 0 && hot !== this.hotState) {
        if (hot > 0) { this.overheats++; this.floatText('Too hot — let it breathe', this.sx(240), 140, COLORS.bad); }
        else { this.chills++; this.floatText('Cooling — give it air', this.sx(240), 140, COLORS.cool); }
        this.env.audio.sfx('soft', { volume: 0.5 });
        this.hotState = hot;
      } else if (backInside) this.hotState = 0;
      this.status(`Working heat ${Math.round((this.work / WORK_TIME) * 100)}%`);

      if (this.phase === 1 && this.secondCentre !== null && !this.secondStarted && this.work >= WORK_TIME * 0.5) {
        this.secondStarted = true;
        this.centreGoal = this.secondCentre;
        this.phase = 2;
        this.phaseTimer = 0;
        this.floatText(this.secondCentre > this.centre ? 'Now bring it hotter — working heat' : 'Now ease it down — working heat', this.sx(240), 120, COLORS.gold);
        this.env.audio.sfx('page', { volume: 0.5 });
      }
      if (this.work >= WORK_TIME) this.complete();
    }
    this.wasInBand = inBand;

    // embers rise with the heat
    if (!this.reducedMotion && Math.random() < dt * (4 + this.heat * 26)) {
      this.spawn(160 + Math.random() * 160, 180, { n: 1, vy: -30 - this.heat * 40, spread: 20, life: 0.8 + this.heat, color: rgbToHex(heatRgb(0.5 + this.heat * 0.5)), size: 1, g: -8 });
    }

    // audio
    if (!this.finished) {
      this.env.audio.loop('heat', true, 0.2 + this.heat * 0.8);
      this.loopHeatOn = true;
      if (this.bellowsPower > 0.05) { this.env.audio.loop('bellows', true, this.bellowsPower); this.loopBellowsOn = true; }
      else if (this.loopBellowsOn) { this.env.audio.loop('bellows', false); this.loopBellowsOn = false; }
    }
  }

  private closeness(d: number) {
    const w = this.halfW;
    if (d <= w) return 1 - 0.25 * (d / w) * (d / w);
    return 0.75 * Math.max(0, 1 - (d - w) / (w * 2.5));
  }

  private stopLoops() {
    if (this.loopHeatOn) { this.env.audio.loop('heat', false); this.loopHeatOn = false; }
    if (this.loopBellowsOn) { this.env.audio.loop('bellows', false); this.loopBellowsOn = false; }
  }

  private complete() {
    const work = Math.max(0.001, this.work);
    const closeness = clamp(this.closenessSum / work);
    const inBand = clamp(this.inBandTime / work);
    const score = clamp(closeness * 0.85 + inBand * 0.15);
    this.stopLoops();
    this.env.audio.sfx('success');
    const g = gradeOf(score);
    const how = inBand > 0.75 ? 'held its heat beautifully' : inBand > 0.5 ? 'stayed mostly in the sweet band' : 'wandered in and out of the sweet band';
    this.finish({
      score,
      details: { closeness, inBand, overheats: this.overheats, chills: this.chills, flares: this.flares, puffs: this.puffs },
      data: {},
      summary: `${g} preparation — the ${this.env.material.name.toLowerCase()} ${how} (${Math.round(inBand * 100)}% of the time).`,
    });
  }

  protected onDestroy() { this.stopLoops(); }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    const h = this.heat;
    this.backdrop(0.45 + h * 0.6 + this.flareGlow * 0.3);
    // chimney hood
    ctx.fillStyle = '#2a201c';
    ctx.fillRect(170, 0, 140, 60);
    ctx.fillStyle = '#3a2c24';
    ctx.fillRect(150, 60, 180, 14);
    ctx.fillStyle = '#4a382c';
    ctx.fillRect(150, 60, 180, 2);
    // brick hearth
    ctx.fillStyle = '#5a2e22';
    ctx.fillRect(130, 160, 220, 80);
    for (let r = 0; r < 5; r++) {
      for (let k = 0; k < 11; k++) {
        const bx = 130 + k * 20 + (r % 2 ? 10 : 0), by = 160 + r * 16;
        ctx.fillStyle = (k + r) % 3 === 0 ? '#6a3828' : '#62341f';
        ctx.fillRect(Math.min(bx, 340), by + 1, Math.min(18, 350 - bx), 14);
      }
    }
    // fire pit
    ctx.fillStyle = '#1a0e0a';
    ctx.fillRect(146, 172, 188, 26);
    const pit = ctx.createRadialGradient(240, 186, 4, 240, 186, 110);
    const glowRgb = heatRgb(0.3 + h * 0.7);
    pit.addColorStop(0, `rgba(${glowRgb[0] | 0},${glowRgb[1] | 0},${glowRgb[2] | 0},${0.35 + h * 0.5 + this.flareGlow * 0.3})`);
    pit.addColorStop(1, 'rgba(255,100,40,0)');
    ctx.fillStyle = pit;
    ctx.fillRect(130, 90, 220, 110);
    // coals
    const warnBoost = this.flareWarn > 0 ? 0.25 : 0;
    for (const c of this.coals) {
      const flick = 0.5 + 0.5 * Math.sin(this.t * 3 + c.ph);
      const cc = heatRgb(clamp(0.2 + h * 0.55 + flick * 0.15 + warnBoost + this.flareGlow * 0.3));
      ctx.fillStyle = `rgb(${cc[0] | 0},${cc[1] | 0},${cc[2] | 0})`;
      ctx.fillRect(Math.round(c.x), Math.round(c.y), c.w, 3);
      ctx.fillStyle = '#2a1410';
      ctx.fillRect(Math.round(c.x), Math.round(c.y) + 3, c.w, 1);
    }

    // the piece, glowing with its heat
    const spr = this.spr;
    const tctx = this.tintCtx;
    tctx.globalCompositeOperation = 'source-over';
    tctx.clearRect(0, 0, spr.width, spr.height);
    tctx.drawImage(spr, 0, 0);
    tctx.globalCompositeOperation = 'source-atop';
    const hc = heatRgb(h);
    tctx.globalAlpha = 0.12 + smoothstep(0.08, 0.55, h) * 0.78;
    tctx.fillStyle = `rgb(${hc[0] | 0},${hc[1] | 0},${hc[2] | 0})`;
    tctx.fillRect(0, 0, spr.width, spr.height);
    tctx.globalAlpha = 1;
    tctx.globalCompositeOperation = 'source-over';
    if (this.isShield) {
      this.drawSprite(this.tintCanvas, 240, 150, 1);
    } else {
      const scale = this.env.item.category === 'dagger' ? 2 : 1;
      this.drawSprite(this.tintCanvas, 240, 176, scale, 1);
    }
    // heat halo over the piece
    const halo = ctx.createRadialGradient(240, 176, 2, 240, 176, 90);
    halo.addColorStop(0, `rgba(${hc[0] | 0},${hc[1] | 0},${hc[2] | 0},${smoothstep(0.3, 1, h) * 0.35})`);
    halo.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(140, 100, 200, 120);

    this.drawBellows(ctx);
    this.drawGauge(ctx);
  }

  private drawBellows(ctx: CanvasRenderingContext2D) {
    const b = this.bellowsBtn;
    const squeeze = Math.max(this.puffAnim, this.bellowsPower * (0.6 + 0.4 * Math.sin(this.t * 9)));
    const cy = b.y + b.h / 2;
    const half = 22 - squeeze * 10;
    // nozzle
    ctx.fillStyle = '#5a5a66';
    ctx.fillRect(b.x + b.w - 6, cy - 3, 140 - (b.x + b.w - 6), 6);
    ctx.fillStyle = '#8a8a96';
    ctx.fillRect(b.x + b.w - 6, cy - 3, 140 - (b.x + b.w - 6), 1);
    // leather body
    ctx.fillStyle = '#7a4a2a';
    ctx.beginPath();
    ctx.moveTo(b.x + 8, cy - half);
    ctx.lineTo(b.x + b.w - 6, cy - 5);
    ctx.lineTo(b.x + b.w - 6, cy + 5);
    ctx.lineTo(b.x + 8, cy + half);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5a3420';
    for (let i = 1; i < 4; i++) ctx.fillRect(b.x + 8 + i * 18, cy - half + i * 4, 2, (half - i * 4) * 2);
    // boards
    ctx.fillStyle = '#9a6a3a';
    ctx.fillRect(b.x + 4, cy - half - 3, 52, 4);
    ctx.fillRect(b.x + 4, cy + half - 1, 52, 4);
    ctx.fillStyle = '#6a4a2a';
    ctx.fillRect(b.x, cy - half - 2, 6, 2);
    ctx.fillRect(b.x, cy + half, 6, 2);
    if (this.hasBellows) {
      ctx.strokeStyle = this.pointerBellows || this.isDown('KeyB') ? COLORS.gold : 'rgba(240,200,96,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    }
  }

  private gaugeY(v: number) { return 220 - clamp(v) * 180; }

  private drawGauge(ctx: CanvasRenderingContext2D) {
    const x = 404, w = 18;
    this.panel(x - 8, 28, w + 16, 204);
    for (let i = 0; i < 90; i++) {
      const v = i / 89;
      const c = heatRgb(v);
      ctx.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
      ctx.fillRect(x, Math.round(this.gaugeY(v)) - 2, w, 2);
    }
    const flicker = this.env.quirk === 'flicker' && Math.sin(this.t * 6.3) > 0.55;
    if (!flicker) {
      const c = this.bandCentre();
      const y0 = this.gaugeY(c + this.halfW), y1 = this.gaugeY(c - this.halfW);
      ctx.fillStyle = 'rgba(143,209,106,0.45)';
      ctx.fillRect(x - 4, y0, w + 8, y1 - y0);
      ctx.fillStyle = COLORS.good;
      ctx.fillRect(x - 4, y0, w + 8, 1);
      ctx.fillRect(x - 4, y1, w + 8, 1);
      ctx.fillStyle = COLORS.gold;
      ctx.fillRect(x - 4, Math.round(this.gaugeY(c)), w + 8, 1);
      if (this.centre !== this.centreGoal) {
        ctx.fillStyle = 'rgba(240,200,96,0.5)';
        ctx.fillRect(x - 4, Math.round(this.gaugeY(this.centreGoal)), w + 8, 1);
      }
    }
    // heat marker
    const my = Math.round(this.gaugeY(this.heat));
    ctx.fillStyle = COLORS.cream;
    ctx.beginPath();
    ctx.moveTo(x - 8, my - 4);
    ctx.lineTo(x - 2, my);
    ctx.lineTo(x - 8, my + 4);
    ctx.fill();
    ctx.fillRect(x - 2, my, w + 4, 1);
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    // progress
    const prog = this.work / WORK_TIME;
    this.panel(140, 8, 200, 28);
    this.bar(150, 24, 180, 6, prog, this.phase === 0 || this.phase === 2 ? COLORS.dim : COLORS.ember);
    const label = this.phase === 0 ? 'Bring the metal up to heat' : this.phase === 2 ? 'Now bring it to working heat' : 'Hold it in the sweet band';
    this.text(label, 240, 16, { size: 9, align: 'center', color: COLORS.paper });
    // gauge labels
    this.text('hot', this.sx(413), 22, { size: 8, align: 'center', color: COLORS.dim });
    this.text('cold', this.sx(413), 238, { size: 8, align: 'center', color: COLORS.dim });
    if (this.hasBellows) this.text('hold: bellows', this.sx(62), this.bellowsBtn.y - 6, { size: 8, align: 'center', color: COLORS.gold });
    const inBand = Math.abs(this.heat - this.bandCentre()) <= this.halfW;
    this.text(`Condition ${Math.round(this.heat * 100)}`, 12, 14, { size: 9, color: inBand ? COLORS.good : COLORS.paper });
    this.text(this.env.material.name, MW - 12, 14, { size: 9, align: 'right', color: COLORS.gold });
    const hint = this.hasBellows
      ? 'Click / Space: puff of air  ·  Hold B or the bellows: steady draught'
      : 'Click / tap / Space: a puff of air — keep the glow in the green band';
    this.text(hint, MW / 2, MH - 12, { size: 9, align: 'center', color: COLORS.paper });
  }
}

export const heatGame: MinigameDef = {
  id: 'heat',
  name: 'Material Preparation',
  controls: 'Click / tap / Space for a puff of air. With the bellows upgrade: hold B (or hold the bellows) for a steady draught.',
  instructions: (env) => {
    const lines = [
      'Keep the metal in the green band on the gauge — it slowly cools on its own.',
      'Each puff of air raises the heat; watch for the coals crackling before a flare-up.',
    ];
    if (env.upgrades.includes('bellows')) lines.push('Your big bellows: hold B or hold them on screen for a smooth, steady draught.');
    if (env.difficulty >= 1.5) lines.push('Halfway through, the band moves — bring the piece to its working heat.');
    return lines;
  },
  create: (env) => new Heat(env),
};
