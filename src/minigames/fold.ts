// Patternwright pattern folding. A two-tone billet (primary + secondary metal
// stripes) is folded N = round(tune(3, 6)) times. Each fold:
//  (a) the right half flips up and over onto the left; the player slides the
//      folded half (drag, or Left/Right / A/D) until its free edge meets the gold
//      target line, then sets it (tap, Space or Enter). Precision = alignment.
//  (b) a syncopated two-beat cue plays (beats 1 and 2 tick); the player strikes
//      on the off-beat marker (click / tap / Space) to forge-weld the stack.
// The billet's stripe pattern visibly doubles with each fold; misalignment
// makes the layers wavy and poorly timed strikes smear the new seams (mud).
// Score = mean per-fold accuracy (0.6 alignment + 0.4 timing) + consistency.
//
// data: { layers: 2^(folds+1) capped at 64, clarity: 0..1 }
// details: alignment, timing, consistency, folds

import { noise2, seededRng } from '../core/rng';
import { clamp, hexToRgb, mean, stdev, type RGB } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { cloneItem } from '../item/factory';
import type { Item } from '../item/types';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

type Phase = 'intro' | 'flip' | 'align' | 'beat' | 'merge' | 'done';

const BX0 = 132, BW = 200, BH = 64, HALF = BW / 2;
const BASE_Y = 136; // top of the flat billet
const HINGE_X = BX0 + HALF;
const ANVIL_Y = BASE_Y + BH;
const TRACK_X0 = 152, TRACK_X1 = 312, TRACK_Y = 26;

function trailingZeros(j: number) {
  let n = 0;
  while (j > 0 && (j & 1) === 0) { j >>= 1; n++; }
  return n;
}

class Fold extends BaseMinigame {
  private rng = seededRng(this.env.item.seed, 'fold');
  private totalFolds: number;
  private folds = 0;
  private phase: Phase = 'intro';
  private phaseT = 0;
  // pattern
  private palA: RGB[];
  private palB: RGB[];
  private foldMud: number[] = [0]; // index f = seam created in fold f (1-based)
  private baseMud = 0.04;
  private waveAmp = 0.4;
  private wavePh: number[] = [];
  private pattern: HTMLCanvasElement;
  private nextPattern: HTMLCanvasElement | null = null;
  // align
  private e = 0;
  private alignTol: number;
  private drift: number;
  private driftPh = 0;
  private drag = { active: false, x0: 0, e0: 0, t0: 0, moved: 0 };
  // beat
  private bpm: number;
  private measure: number;
  private beatT0 = 0;
  private marker = 0.75;
  private beatHalfW: number;
  private cueAlways: boolean;
  private lastBeatPos = 0;
  private hammerAnim = 0;
  // results
  private aligns: number[] = [];
  private timings: number[] = [];
  private accs: number[] = [];
  private curAlign = 0;
  // preview
  private preview: Item;
  private previewCanvas: HTMLCanvasElement;

  constructor(env: MinigameEnv) {
    super(env);
    this.totalFolds = Math.round(this.tune(3, 6));
    const pid = env.item.materials.primary, sid = env.item.materials.secondary;
    const pa = hasMat(pid) ? mat(pid).palette : env.material.palette;
    const pb = hasMat(sid) ? mat(sid).palette : mat('brass').palette;
    this.palA = pa.map(hexToRgb);
    this.palB = (sid === pid ? pb.map((_, i) => pb[Math.max(0, i - 2)]) : pb).map(hexToRgb);
    this.alignTol = this.tune(3, 1.2) * (env.quirk === 'bursts' ? 1.35 : 1);
    this.drift = this.tune(0, 5) + (env.quirk === 'drifting' ? 4 : 0);
    this.bpm = this.tune(76, 100) * (env.quirk === 'bursts' ? 0.95 : 1);
    this.measure = (2 * 60) / this.bpm;
    this.beatHalfW = this.tune(0.075, 0.035) * (env.quirk === 'bursts' ? 1.3 : 1);
    this.cueAlways = env.difficulty < 2.5;
    this.wavePh = [this.rng.range(0, 6.28), this.rng.range(0, 6.28)];
    this.pattern = this.renderPattern(0);
    this.preview = cloneItem(env.item);
    this.preview.surface.layers = 2;
    this.preview.surface.patternClarity = 0.9;
    this.previewCanvas = this.sprite(this.preview);
    this.status();
  }

  private status() {
    this.env.onStatus?.(`Fold ${Math.min(this.folds + 1, this.totalFolds)} / ${this.totalFolds}`);
  }

  // ------------------------------------------------------------ pattern
  private renderPattern(F: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = BW; c.height = BH;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(BW, BH);
    const n = Math.min(64, Math.pow(2, F + 1));
    const Fv = Math.round(Math.log2(n)) - 1;
    // folds beyond what the eye can resolve blur into the fine base layers
    const extra = this.foldMud.slice(Fv + 1, F + 1);
    const baseMud = extra.length ? Math.max(this.baseMud, mean(extra)) : this.baseMud;
    const seed = this.env.item.seed;
    const amp = this.waveAmp;
    for (let x = 0; x < BW; x++) {
      const wave = Math.sin(x * 0.045 + this.wavePh[0]) * amp + Math.sin(x * 0.13 + this.wavePh[1]) * amp * 0.4;
      for (let y = 0; y < BH; y++) {
        let s = ((y + wave) / BH) * n;
        s = clamp(s, 0, n - 1e-6);
        const li = Math.floor(s);
        const f = s - li;
        let col = li % 2;
        const j = f < 0.5 ? li : li + 1;
        const d = Math.min(f, 1 - f);
        if (j >= 1 && j <= n - 1) {
          const tz = trailingZeros(j);
          const fi = Fv + 1 - tz;
          const mud = tz === 0 ? baseMud : (this.foldMud[fi] ?? baseMud);
          const band = Math.min(0.5, mud * 0.55);
          if (band > 0 && d < band) {
            const prob = (1 - d / band) * 0.5;
            if (noise2(seed, x, y + F * 97) < prob) col = 1 - col;
          }
        }
        const pal = col === 0 ? this.palA : this.palB;
        let shade = 3;
        if (y < 3) shade = 4;
        else if (y > BH - 4) shade = 2;
        if (noise2(seed + 5, x >> 1, y) > 0.9) shade = Math.min(5, shade + 1);
        const rgb = pal[shade];
        const i = (y * BW + x) * 4;
        img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  // ------------------------------------------------------------ flow
  private enter(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
    if (p === 'align') {
      const side = this.rng.chance(0.5) ? -1 : 1;
      this.e = side * this.rng.range(14, 30);
      this.driftPh = this.rng.range(0, 6.28);
    }
    if (p === 'beat') {
      this.beatT0 = this.t;
      this.lastBeatPos = 0;
      this.marker = this.env.difficulty >= 2 ? (this.rng.chance(0.5) ? 0.25 : 0.75) : 0.75;
      this.env.audio.sfx('click', { pitch: 1.2 });
    }
  }

  private accFrom(d: number, w: number, falloff: number) {
    if (d <= w * 0.3) return 1;
    if (d <= w) return 1 - ((d - w * 0.3) / (w * 0.7)) * 0.22;
    return Math.max(0, 0.78 - ((d - w) / (w * falloff)) * 0.78);
  }

  private confirmAlign() {
    const d = Math.abs(this.e);
    this.curAlign = this.accFrom(d, this.alignTol, 5);
    const x = this.sx(BX0 + this.e);
    if (this.curAlign > 0.92) this.floatText('Flush!', x, BASE_Y - 74, COLORS.gold);
    else if (this.curAlign > 0.6) this.floatText('Close', x, BASE_Y - 74, COLORS.good);
    else this.floatText('A little off', x, BASE_Y - 74, COLORS.ok);
    this.env.audio.sfx('snap', { volume: 0.7 });
    this.enter('beat');
  }

  private strike() {
    const elapsed = this.t - this.beatT0;
    if (elapsed < this.measure * 0.98) {
      this.floatText('Listen to the count first…', this.sx(232), TRACK_Y + 30, COLORS.dim);
      return;
    }
    const p = (elapsed / this.measure) % 1;
    let diff = p - this.marker;
    if (diff > 0.5) diff -= 1;
    if (diff < -0.5) diff += 1;
    const timing = this.accFrom(Math.abs(diff), this.beatHalfW, 2);
    const acc = clamp(this.curAlign * 0.6 + timing * 0.4);
    this.aligns.push(this.curAlign);
    this.timings.push(timing);
    this.accs.push(acc);
    // the new seams: sloppy strikes smear, misalignment makes the stack wavy
    const f = this.folds + 1;
    this.foldMud[f] = clamp((1 - acc) * 0.9 + (1 - timing) * 0.15, 0.02, 0.95);
    this.waveAmp = Math.min(4.5, this.waveAmp + Math.abs(this.e) * 0.12 + (1 - this.curAlign) * 0.6);
    this.nextPattern = this.renderPattern(f);
    this.hammerAnim = 1;
    const sx = this.sx(BX0 + HALF / 2);
    if (timing > 0.92) {
      this.env.audio.sfx('hammerPerfect', { pitch: 0.9 + this.folds * 0.03 });
      this.sparks(BX0 + HALF / 2, BASE_Y - BH, 18, COLORS.gold);
      this.floatText('On the off-beat!', sx, TRACK_Y + 30, COLORS.gold);
      this.shake(3);
    } else if (timing > 0.6) {
      this.env.audio.sfx('hammer', { pitch: 0.9 + this.folds * 0.03 });
      this.sparks(BX0 + HALF / 2, BASE_Y - BH, 10);
      this.floatText('Good', sx, TRACK_Y + 30, COLORS.good);
      this.shake(2);
    } else {
      this.env.audio.sfx('hammerMiss');
      this.sparks(BX0 + HALF / 2, BASE_Y - BH, 4, '#a07050');
      this.floatText(diff < 0 ? 'Early' : 'Late', sx, TRACK_Y + 30, COLORS.bad);
      this.shake(1);
    }
    this.enter('merge');
  }

  private finishFold() {
    this.folds++;
    if (this.nextPattern) this.pattern = this.nextPattern;
    this.nextPattern = null;
    const layers = Math.min(64, Math.pow(2, this.folds + 1));
    this.preview.surface.layers = layers;
    this.preview.surface.patternClarity = this.clarity();
    this.previewCanvas = this.sprite(this.preview);
    this.floatText(`${layers} layers`, this.sx(BX0 + HALF), BASE_Y - 12, COLORS.cream);
    if (this.folds >= this.totalFolds) return this.complete();
    this.status();
    this.enter('flip');
  }

  private clarity() {
    if (!this.accs.length) return 0.9;
    return clamp(Math.pow(mean(this.accs), 1.2));
  }

  private complete() {
    this.phase = 'done';
    const alignment = mean(this.aligns), timing = mean(this.timings);
    const accuracy = mean(this.accs);
    const consistency = 1 - clamp(stdev(this.accs) * 2);
    const score = clamp(accuracy * 0.85 + consistency * 0.15);
    const clarity = this.clarity();
    const layers = Math.min(64, Math.pow(2, this.totalFolds + 1));
    this.env.audio.sfx('success');
    const g = gradeOf(score);
    this.finish({
      score,
      details: { alignment, timing, consistency, folds: this.totalFolds },
      data: { layers, clarity: Math.round(clarity * 1000) / 1000 },
      summary: `${g} folding — ${layers} layers with ${clarity > 0.8 ? 'crisp, clean' : clarity > 0.6 ? 'clear' : clarity > 0.4 ? 'somewhat soft' : 'muddy, swirling'} lines.`,
    });
  }

  private sx(x: number) { return this.mirrored ? MW - x : x; }

  // ------------------------------------------------------------ input
  protected onPointerDown() {
    if (this.finished) return;
    if (this.phase === 'align') {
      this.drag = { active: true, x0: this.pointer.x, e0: this.e, t0: this.t, moved: 0 };
    } else if (this.phase === 'beat') this.strike();
  }
  protected onPointerMove() {
    if (this.phase === 'align' && this.drag.active && this.pointer.down) {
      const dx = this.pointer.x - this.drag.x0;
      this.drag.moved = Math.max(this.drag.moved, Math.abs(dx));
      this.e = clamp(this.drag.e0 + dx, -60, 60);
    }
  }
  protected onPointerUp() {
    if (this.phase === 'align' && this.drag.active) {
      this.drag.active = false;
      if (this.drag.moved < 3 && this.t - this.drag.t0 < 0.45) this.confirmAlign();
    }
  }

  // ------------------------------------------------------------ update
  protected update(dt: number) {
    this.phaseT += dt;
    this.hammerAnim = Math.max(0, this.hammerAnim - dt * 4);
    switch (this.phase) {
      case 'intro':
        if (this.phaseT > 1.1) this.enter('flip');
        break;
      case 'flip':
        if (this.phaseT >= 0.8) {
          this.env.audio.sfx('fold', { pitch: 0.95 + this.folds * 0.03 });
          this.shake(1.5);
          this.spawn(BX0 + 4, BASE_Y, { n: 6, vy: -20, spread: 50, life: 0.4, color: COLORS.ember, size: 1 });
          this.enter('align');
        }
        break;
      case 'align': {
        if (!this.drag.active) this.e += this.axisX() * 32 * dt;
        if (this.drift > 0 && !this.drag.active) this.e += Math.sin(this.t * 1.1 + this.driftPh) * this.drift * dt;
        this.e = clamp(this.e, -60, 60);
        if (this.wasPressed('Space', 'Enter')) this.confirmAlign();
        break;
      }
      case 'beat': {
        const pos = (this.t - this.beatT0) / this.measure;
        // ticks on each beat, and the off-beat cue during the count-in (always on easier levels)
        const prevPos = this.lastBeatPos;
        for (let k = Math.floor(prevPos * 2) + 1; k <= Math.floor(pos * 2); k++) {
          this.env.audio.sfx('click', { pitch: k % 2 === 0 ? 1.0 : 0.82, volume: 0.8 });
        }
        const mPrev = prevPos - this.marker, mNow = pos - this.marker;
        if (Math.floor(mNow) > Math.floor(mPrev) && mNow >= 0 && (this.cueAlways || pos < 1 + this.marker)) {
          this.env.audio.sfx('pop', { volume: pos < 1 ? 0.7 : 0.35 });
        }
        this.lastBeatPos = pos;
        if (this.wasPressed('Space', 'Enter')) this.strike();
        break;
      }
      case 'merge':
        if (this.phaseT >= 0.7) this.finishFold();
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.75);
    // anvil
    ctx.fillStyle = '#26262c';
    ctx.fillRect(BX0 - 30, ANVIL_Y, BW + 60, 18);
    ctx.fillStyle = '#3c3c46';
    ctx.fillRect(BX0 - 30, ANVIL_Y, BW + 60, 3);
    ctx.fillStyle = '#18181c';
    ctx.fillRect(BX0 + 50, ANVIL_Y + 18, 100, 30);
    ctx.fillRect(BX0 + 30, ANVIL_Y + 48, 140, 10);

    const glow = ctx.createRadialGradient(BX0 + HALF, BASE_Y + 20, 6, BX0 + HALF, BASE_Y + 20, 150);
    glow.addColorStop(0, 'rgba(255,150,70,0.28)');
    glow.addColorStop(1, 'rgba(255,150,70,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(BX0 - 40, BASE_Y - 110, BW + 80, 200);

    const pat = this.pattern;
    switch (this.phase) {
      case 'intro':
      case 'done':
        this.drawFlat(ctx, pat);
        break;
      case 'flip': {
        const k = clamp(this.phaseT / 0.8);
        const ease = k * k * (3 - 2 * k);
        // left half stays; right half rotates up and over the hinge
        ctx.drawImage(pat, 0, 0, HALF, BH, BX0, BASE_Y, HALF, BH);
        this.heatTint(ctx, BX0, BASE_Y, HALF, BH);
        ctx.save();
        ctx.translate(HINGE_X, BASE_Y);
        ctx.rotate(-Math.PI * ease);
        ctx.drawImage(pat, HALF, 0, HALF, BH, 0, 0, HALF, BH);
        this.heatTint(ctx, 0, 0, HALF, BH);
        ctx.restore();
        break;
      }
      case 'align':
      case 'beat':
        this.drawStack(ctx, pat, this.e);
        break;
      case 'merge': {
        const k = clamp(this.phaseT / 0.7);
        const ease = k * k * (3 - 2 * k);
        const next = this.nextPattern ?? pat;
        if (k < 0.25) this.drawStack(ctx, pat, this.e * (1 - k * 4));
        else {
          const kk = (ease - 0.16) / 0.84;
          const w = HALF + HALF * clamp(kk), h = BH * 2 - BH * clamp(kk);
          ctx.drawImage(next, BX0, ANVIL_Y - h, w, h);
          this.heatTint(ctx, BX0, ANVIL_Y - h, w, h);
        }
        break;
      }
    }

    // target edge guide
    if (this.phase === 'align' || this.phase === 'beat') {
      const flicker = this.env.quirk === 'flicker' && Math.sin(this.t * 6.7) > 0.55;
      if (!flicker) {
        ctx.fillStyle = COLORS.gold;
        for (let y = BASE_Y - BH - 10; y < ANVIL_Y + 6; y += 6) ctx.fillRect(BX0, y, 1, 3);
        ctx.fillStyle = 'rgba(240,200,96,0.25)';
        ctx.fillRect(BX0 - Math.round(this.alignTol), BASE_Y - BH - 10, Math.max(1, Math.round(this.alignTol * 2)), 4);
      }
      // the folded half's free edge marker
      const ex = Math.round(BX0 + this.e);
      ctx.fillStyle = Math.abs(this.e) <= this.alignTol ? COLORS.good : COLORS.cream;
      ctx.fillRect(ex - 1, BASE_Y - BH - 6, 3, 4);
    }

    // hammer
    const hx = BX0 + HALF / 2;
    const stackTop = this.phase === 'align' || this.phase === 'beat' ? BASE_Y - BH : BASE_Y;
    let lift = 26 + Math.sin(this.t * 3) * 2;
    if (this.phase === 'beat') {
      const pos = ((this.t - this.beatT0) / this.measure) % 1;
      lift = 6 + 8 * Math.abs(Math.cos(Math.PI * 2 * pos));
    }
    if (this.hammerAnim > 0) lift = 2 + (1 - this.hammerAnim) * 20;
    if (this.phase !== 'flip') {
      ctx.fillStyle = '#6a4a2a';
      ctx.fillRect(hx + 10, stackTop - lift - 46, 4, 40);
      ctx.fillStyle = '#5a5a66';
      ctx.fillRect(hx - 4, stackTop - lift - 12, 32, 12);
      ctx.fillStyle = '#8a8a96';
      ctx.fillRect(hx - 4, stackTop - lift - 12, 32, 3);
    }

    // preview of the finished piece
    this.panel(376, 20, 96, 230, 'rgba(30,20,16,0.55)', COLORS.panelEdge);
    const spr = this.previewCanvas;
    this.drawSprite(spr, 424, 134, spr.height * 2 <= 228 && spr.width * 2 <= 96 ? 2 : 1);

    if (this.phase === 'beat') this.drawTrack(ctx);
  }

  private drawFlat(ctx: CanvasRenderingContext2D, pat: HTMLCanvasElement) {
    ctx.drawImage(pat, BX0, BASE_Y);
    this.heatTint(ctx, BX0, BASE_Y, BW, BH);
  }

  private drawStack(ctx: CanvasRenderingContext2D, pat: HTMLCanvasElement, e: number) {
    // bottom: left half in place
    ctx.drawImage(pat, 0, 0, HALF, BH, BX0, BASE_Y, HALF, BH);
    this.heatTint(ctx, BX0, BASE_Y, HALF, BH);
    // top: right half, folded over (rotated 180° about the hinge), slid by e
    ctx.save();
    ctx.translate(HINGE_X + e, BASE_Y);
    ctx.rotate(-Math.PI);
    ctx.drawImage(pat, HALF, 0, HALF, BH, 0, 0, HALF, BH);
    this.heatTint(ctx, 0, 0, HALF, BH);
    ctx.restore();
    // seam shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(Math.round(BX0 + Math.max(0, e)), BASE_Y, HALF - Math.round(Math.abs(e)), 1);
  }

  private heatTint(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
    ctx.fillStyle = 'rgba(255,120,40,0.16)';
    ctx.fillRect(x, y, w, h);
  }

  private drawTrack(ctx: CanvasRenderingContext2D) {
    const w = TRACK_X1 - TRACK_X0, h = 12;
    this.panel(TRACK_X0 - 10, TRACK_Y - 10, w + 20, h + 24);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(TRACK_X0, TRACK_Y, w, h);
    const elapsed = this.t - this.beatT0;
    const pos = (elapsed / this.measure) % 1;
    // beats 1 and 2
    for (const b of [0, 0.5]) {
      const near = Math.min(Math.abs(pos - b), Math.abs(pos - b - 1), Math.abs(pos - b + 1));
      ctx.fillStyle = near < 0.04 ? COLORS.cream : 'rgba(255,244,220,0.5)';
      ctx.fillRect(Math.round(TRACK_X0 + b * w), TRACK_Y - 3, 3, h + 6);
    }
    ctx.fillStyle = 'rgba(255,244,220,0.5)';
    ctx.fillRect(TRACK_X1 - 1, TRACK_Y - 3, 2, h + 6);
    // off-beat marker
    const flicker = this.env.quirk === 'flicker' && Math.sin(this.t * 6.7) > 0.55;
    if (!flicker) {
      const mx = TRACK_X0 + this.marker * w;
      ctx.fillStyle = 'rgba(143,209,106,0.55)';
      ctx.fillRect(Math.round(mx - this.beatHalfW * w), TRACK_Y, Math.round(this.beatHalfW * 2 * w), h);
      ctx.fillStyle = COLORS.gold;
      ctx.fillRect(Math.round(mx) - 1, TRACK_Y, 3, h);
    }
    ctx.fillStyle = elapsed < this.measure ? COLORS.dim : COLORS.cream;
    ctx.fillRect(Math.round(TRACK_X0 + pos * w) - 1, TRACK_Y - 4, 2, h + 8);
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    const layers = Math.min(64, Math.pow(2, this.folds + 1));
    this.text(`Fold ${Math.min(this.folds + 1, this.totalFolds)} / ${this.totalFolds}`, 12, 14, { size: 10, color: COLORS.paper });
    this.text(`${layers} layers`, 12, 28, { size: 9, color: COLORS.gold });
    if (this.accs.length) this.text(`Clarity ${Math.round(this.clarity() * 100)}%`, 12, 42, { size: 9, color: COLORS.paper });
    if (this.phase === 'beat') {
      const w = TRACK_X1 - TRACK_X0;
      const lbl = (p: number, s: string) => this.text(s, this.sx(TRACK_X0 + p * w), TRACK_Y + 19, { size: 8, align: 'center', color: COLORS.dim });
      lbl(0, '1'); lbl(0.5, '2'); lbl(this.marker, '&');
      const counting = this.t - this.beatT0 < this.measure;
      this.text(counting ? 'Listen… one, two…' : 'Strike on the off-beat (&)', this.sx((TRACK_X0 + TRACK_X1) / 2), TRACK_Y - 18, { size: 9, align: 'center', color: counting ? COLORS.dim : COLORS.gold });
    }
    let hint = 'Watch the billet fold…';
    if (this.phase === 'align') hint = 'Drag or Left/Right to line the folded edge up with the gold line — tap / Space to set';
    if (this.phase === 'beat') hint = 'Click / tap / Space on the off-beat marker to weld the fold';
    this.text(hint, MW / 2, MH - 10, { size: 9, align: 'center', color: COLORS.paper });
  }
}

export const foldGame: MinigameDef = {
  id: 'fold',
  name: 'Pattern Folding',
  controls: 'Align: drag or Left/Right (A/D), then tap / Space / Enter to set. Weld: click / tap / Space on the off-beat.',
  instructions: (env) => [
    'Fold the two-tone billet again and again — each fold doubles its layers.',
    'Slide the folded half until its edge meets the gold line, then set it.',
    'Then listen to the two-beat count and strike on the off-beat marker (&) to weld it. Neat work keeps the layers crisp.',
    ...(env.difficulty >= 2 ? ['At this level the off-beat may fall before or after beat two.'] : []),
  ],
  create: (env) => new Fold(env),
};
