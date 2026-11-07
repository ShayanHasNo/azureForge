// Timing-based hammering. The piece lies on the anvil; each segment is struck
// in turn. Strike timing shapes the actual geometry: early strikes swell the
// left edge, late strikes the right, and inconsistency makes the spine wobble.
//
// Styles (by tradition / material rhythm):
//  steady     — indicator sweeps evenly; fixed zone.
//  swing      — eased sweep with zones that move between strikes.
//  syncopated — two zones per sweep, struck in order (Patternwrights).
//  heavy      — hold to charge a blow, release inside the band (Mountain).
//  melodic    — notes glide toward a strike line in a melody (Celestial).
//  wild       — a different style for every segment (Experimental).
//
// data: blades → { leftDev[10], rightDev[10], wobble[10] }; shields → { dents[8] }
// details: accuracy, consistency, perfectRate, strikes

import { seededRng } from '../core/rng';
import { clamp, mean, stdev } from '../core/util';
import { SEGMENTS, cloneItem } from '../item/factory';
import { bladeLayout } from '../render/itemRenderer';
import type { Item } from '../item/types';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

type Style = 'steady' | 'swing' | 'syncopated' | 'heavy' | 'melodic';

interface Strike { seg: number; acc: number; signed: number }

class Hammer extends BaseMinigame {
  private segs: number;
  private seg = 0;
  private strikeInSeg = 0;
  private strikesPerSeg: number;
  private strikes: Strike[] = [];
  private style: Style = 'steady';
  private rng = seededRng(this.env.item.seed, 'hammer');
  // sweep state
  private p = 0; // indicator 0..1
  private dir = 1;
  private speed = 0.9;
  private zone = 0.5;
  private zones: number[] = [];
  private zoneIdx = 0;
  private halfW = 0.08;
  // heavy
  private charge = 0;
  private charging = false;
  private band = [0.7, 0.85];
  // melodic
  private notes: { x: number; hit: boolean; missed: boolean }[] = [];
  private noteSpeed = 120;
  private preview: Item;
  private previewCanvas: HTMLCanvasElement;
  private flash = 0;
  private hammerAnim = 0;
  private readonly isShield: boolean;
  private leftDev: number[];
  private rightDev: number[];
  private wobble: number[];
  private dents: number[];

  constructor(env: MinigameEnv) {
    super(env);
    this.isShield = env.item.category === 'shield';
    this.segs = this.isShield ? 8 : SEGMENTS;
    this.strikesPerSeg = Math.round(this.tune(2, 3));
    this.halfW = this.tune(0.1, 0.038);
    const rhythm = env.material.rhythm ?? 'steady';
    const matSpeed = rhythm === 'delicate' ? 0.85 : rhythm === 'heavy' ? 0.8 : rhythm === 'erratic' ? 1.1 : 1;
    this.speed = this.tune(0.75, 1.45) * matSpeed * (env.quirk === 'bursts' ? 1.1 : 1);
    if (env.quirk === 'bursts') this.halfW *= 1.35;
    this.leftDev = new Array(SEGMENTS).fill(0);
    this.rightDev = new Array(SEGMENTS).fill(0);
    this.wobble = new Array(SEGMENTS).fill(0);
    this.dents = new Array(8).fill(0);
    if (!this.isShield) {
      this.leftDev = [...env.item.blade!.leftDev];
      this.rightDev = [...env.item.blade!.rightDev];
      this.wobble = [...env.item.blade!.wobble];
    }
    this.preview = cloneItem(env.item);
    this.previewCanvas = this.sprite(this.preview);
    this.beginSegment();
  }

  private pickStyle(): Style {
    const s = this.env.params.style as string;
    if (s === 'wild') return this.rng.pick(['steady', 'swing', 'syncopated', 'heavy', 'melodic'] as Style[]);
    if (s === 'heavy' || s === 'melodic' || s === 'syncopated' || s === 'swing') return s;
    if (this.env.material.rhythm === 'swing' || this.env.material.rhythm === 'erratic') return 'swing';
    return 'steady';
  }

  private beginSegment() {
    this.style = this.pickStyle();
    this.strikeInSeg = 0;
    this.newTarget();
    if (this.style === 'melodic') this.spawnMelody();
  }

  private newTarget() {
    this.zone = this.style === 'steady' ? 0.5 : this.rng.range(0.25, 0.75);
    if (this.style === 'syncopated') {
      const a = this.rng.range(0.2, 0.42), b = this.rng.range(0.6, 0.82);
      this.zones = this.dir > 0 ? [a, b] : [b, a];
      this.zoneIdx = 0;
    }
    if (this.style === 'heavy') {
      const c = this.rng.range(0.62, 0.86);
      const w = this.halfW * 1.1;
      this.band = [c - w, c + w];
      this.charge = 0;
    }
  }

  private spawnMelody() {
    this.notes = [];
    const lineX = 120;
    let x = MW + 20;
    const gaps = [60, 40, 80, 40, 60, 100, 40];
    for (let i = 0; i < this.strikesPerSeg; i++) {
      this.notes.push({ x, hit: false, missed: false });
      x += this.rng.pick(gaps) * this.tune(1.2, 0.8);
    }
    this.noteSpeed = this.tune(95, 160);
    void lineX;
  }

  // ------------------------------------------------------------ strikes
  private registerStrike(acc: number, signed: number) {
    acc = clamp(acc);
    this.strikes.push({ seg: this.seg, acc, signed });
    const perfect = acc > 0.92;
    const x = this.segmentX(this.seg), y = 150;
    this.hammerAnim = 1;
    this.flash = 0.25;
    if (perfect) {
      this.env.audio.sfx('hammerPerfect', { pitch: 0.95 + this.seg * 0.015 });
      this.sparks(x, y, 18, COLORS.gold);
      this.floatText('Perfect!', x, y - 34, COLORS.gold);
      this.shake(3);
    } else if (acc > 0.6) {
      this.env.audio.sfx('hammer', { pitch: 0.9 + this.seg * 0.012 });
      this.sparks(x, y, 10);
      this.floatText('Good', x, y - 34, COLORS.good);
      this.shake(2);
    } else {
      this.env.audio.sfx('hammerMiss');
      this.sparks(x, y, 4, '#a07050');
      this.floatText(signed < 0 ? 'Early' : 'Late', x, y - 34, COLORS.bad);
      this.shake(1);
    }
    // Shape the actual geometry.
    const err = 1 - acc;
    if (this.isShield) {
      this.dents[this.seg] = clamp(this.dents[this.seg] + err * 0.5, 0, 1);
    } else {
      const i = this.seg;
      const k = err * 0.32 / this.strikesPerSeg;
      if (signed < 0) this.leftDev[i] += k * 1.2; else this.rightDev[i] += k * 1.2;
      // Uneven blows thin the other edge slightly.
      if (signed < 0) this.rightDev[i] -= k * 0.4; else this.leftDev[i] -= k * 0.4;
      this.wobble[i] += signed * err * 0.9 / this.strikesPerSeg;
      this.preview.blade!.leftDev = [...this.leftDev];
      this.preview.blade!.rightDev = [...this.rightDev];
      this.preview.blade!.wobble = [...this.wobble];
      this.previewCanvas = this.sprite(this.preview);
    }
    this.strikeInSeg++;
    if (this.strikeInSeg >= this.strikesPerSeg) {
      this.seg++;
      if (this.seg >= this.segs) return this.complete();
      this.beginSegment();
    } else this.newTarget();
    this.env.onStatus?.(`Segment ${Math.min(this.seg + 1, this.segs)} / ${this.segs}`);
  }

  private accFromDistance(d: number) {
    // Inside the zone: 0.78..1. Outside: falls to 0 at 3× zone width.
    const w = this.halfW;
    if (d <= w * 0.3) return 1;
    if (d <= w) return 1 - ((d - w * 0.3) / (w * 0.7)) * 0.22;
    return Math.max(0, 0.78 - ((d - w) / (w * 2)) * 0.78);
  }

  private complete() {
    const accs = this.strikes.map((s) => s.acc);
    const accuracy = mean(accs);
    const consistency = 1 - clamp(stdev(accs) * 2);
    const perfectRate = accs.filter((a) => a > 0.92).length / Math.max(1, accs.length);
    const score = clamp(accuracy * 0.82 + consistency * 0.12 + perfectRate * 0.06);
    const data = this.isShield
      ? { dents: this.dents.map((d) => Math.round(d * 1000) / 1000) }
      : { leftDev: this.leftDev.map(r3), rightDev: this.rightDev.map(r3), wobble: this.wobble.map(r3) };
    const g = gradeOf(score);
    this.env.audio.sfx('success');
    this.finish({
      score,
      details: { accuracy, consistency, perfectRate, strikes: accs.length },
      data,
      summary: `${g} hammer work — ${Math.round(perfectRate * 100)}% perfect strikes, ${consistency > 0.75 ? 'beautifully even' : consistency > 0.5 ? 'fairly even' : 'a little uneven'} rhythm.`,
    });
  }

  // ------------------------------------------------------------ update
  protected update(dt: number) {
    this.flash = Math.max(0, this.flash - dt);
    this.hammerAnim = Math.max(0, this.hammerAnim - dt * 4);
    let sp = this.speed;
    if (this.env.quirk === 'bursts') sp *= 0.7 + 0.6 * (0.5 + 0.5 * Math.sin(this.t * 2.3));
    if (this.env.material.rhythm === 'erratic') sp *= 0.85 + 0.3 * Math.sin(this.t * 5.1);
    if (this.env.quirk === 'drifting') this.zone = clamp(this.zone + Math.sin(this.t * 1.3) * dt * 0.08, 0.15, 0.85);

    switch (this.style) {
      case 'steady':
      case 'swing':
      case 'syncopated': {
        const eased = this.style === 'swing' ? 0.55 + 0.9 * Math.sin(Math.PI * clamp(this.p, 0.02, 0.98)) : 1;
        this.p += this.dir * sp * eased * dt;
        if (this.p > 1) { this.p = 1; this.dir = -1; this.onSweepEnd(); }
        if (this.p < 0) { this.p = 0; this.dir = 1; this.onSweepEnd(); }
        if (this.action()) {
          const target = this.style === 'syncopated' ? this.zones[this.zoneIdx] : this.zone;
          const d = Math.abs(this.p - target);
          const acc = this.accFromDistance(d);
          const signed = (this.p - target) * this.dir < 0 ? -1 : 1;
          if (this.style === 'syncopated') {
            this.zoneIdx++;
            if (this.zoneIdx >= this.zones.length) this.zoneIdx = 0;
          }
          this.registerStrike(acc, signed);
        }
        break;
      }
      case 'heavy': {
        if (this.holding()) {
          if (!this.charging) { this.charging = true; this.charge = 0; }
          this.charge += dt * sp * 0.55 * (0.5 + this.charge);
          if (this.charge > 1.08) {
            // Over-charged: the blow glances. Gentle, not punishing.
            this.charging = false;
            this.charge = 0;
            this.registerStrike(0.35, 1);
          }
        } else if (this.charging) {
          this.charging = false;
          const [a, b] = this.band;
          const c = (a + b) / 2;
          const d = this.charge < a ? a - this.charge : this.charge > b ? this.charge - b : 0;
          const acc = d === 0 ? 1 - (Math.abs(this.charge - c) / (b - a)) * 0.2 : this.accFromDistance(d + this.halfW);
          this.registerStrike(acc, this.charge < c ? -1 : 1);
          this.charge = 0;
        }
        break;
      }
      case 'melodic': {
        const lineX = 120;
        const win = this.tune(26, 12);
        for (const n of this.notes) n.x -= this.noteSpeed * dt;
        const next = this.notes.find((n) => !n.hit && !n.missed);
        if (next && next.x < lineX - win * 2.2) {
          next.missed = true;
          this.registerStrike(0.3, 1);
        } else if (next && this.action()) {
          const d = Math.abs(next.x - lineX);
          if (d < win * 3) {
            next.hit = true;
            const acc = d < win * 0.35 ? 1 : d < win ? 1 - ((d - win * 0.35) / (win * 0.65)) * 0.22 : Math.max(0, 0.78 - ((d - win) / (win * 2)) * 0.78);
            this.registerStrike(acc, next.x > lineX ? -1 : 1);
          }
        }
        if (this.style === 'melodic' && this.notes.every((n) => n.hit || n.missed) && this.seg < this.segs) {
          // safety: melody ended without completing segment (shouldn't happen)
          this.spawnMelody();
        }
        break;
      }
    }
  }

  private onSweepEnd() {
    if (this.style === 'syncopated') this.zoneIdx = 0;
  }

  // ------------------------------------------------------------ draw
  private segmentX(seg: number) {
    // The piece is drawn horizontally: guard on the left, tip on the right.
    if (this.isShield) return 240 + Math.cos((seg / 8) * Math.PI * 2) * 40;
    const lay = bladeLayout(this.env.item);
    const scale = this.env.item.category === 'dagger' ? 3 : 2;
    const t = (seg + 0.5) / this.segs;
    const spriteY = lay.bladeBase - t * this.env.item.blade!.length;
    return 255 + (lay.H / 2 - spriteY) * scale;
  }

  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.8);
    // anvil
    ctx.fillStyle = '#26262c';
    ctx.fillRect(70, 160, 370, 22);
    ctx.fillStyle = '#3c3c46';
    ctx.fillRect(70, 160, 370, 4);
    ctx.fillStyle = '#18181c';
    ctx.fillRect(200, 182, 110, 40);
    ctx.fillRect(170, 222, 170, 14);
    ctx.fillStyle = '#4a4a56';
    ctx.fillRect(40, 166, 30, 8);

    // the piece
    const spr = this.previewCanvas;
    if (this.isShield) {
      this.drawSprite(spr, 240, 120, 2);
      const a = (this.seg / 8) * Math.PI * 2;
      ctx.strokeStyle = 'rgba(255,150,60,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(240, 120, 48, a - 0.35, a + 0.35);
      ctx.stroke();
    } else {
      // rotate so the tip points right; blade spans ~x 90..420
      const scale = this.env.item.category === 'dagger' ? 3 : 2;
      ctx.save();
      const lay = spr.height;
      ctx.translate(255, 152);
      ctx.rotate(Math.PI / 2);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(spr, -Math.round((spr.width * scale) / 2), -Math.round((lay * scale) / 2), spr.width * scale, lay * scale);
      ctx.restore();
      // heat glow on the current segment
      const sx = this.segmentX(this.seg);
      const g = ctx.createRadialGradient(sx, 150, 2, sx, 150, 26);
      g.addColorStop(0, 'rgba(255,170,70,0.55)');
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 30, 120, 60, 60);
    }

    // hammer
    const hx = this.segmentX(this.seg);
    const lift = this.hammerAnim > 0 ? (1 - this.hammerAnim) * 0 : 18 + Math.sin(this.t * 3) * 2;
    ctx.fillStyle = '#6a4a2a';
    ctx.fillRect(hx + 8, 96 - lift, 4, 46);
    ctx.fillStyle = '#5a5a66';
    ctx.fillRect(hx - 4, 130 - lift, 28, 12);
    ctx.fillStyle = '#8a8a96';
    ctx.fillRect(hx - 4, 130 - lift, 28, 3);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,220,160,${this.flash})`;
      ctx.fillRect(0, 0, MW, MH);
    }
    this.drawTrack(ctx);
  }

  private drawTrack(ctx: CanvasRenderingContext2D) {
    const x0 = 90, w = 300, y = 40, h = 16;
    this.panel(x0 - 10, y - 14, w + 20, h + 34);
    if (this.style === 'heavy') {
      // vertical-feel charge bar drawn horizontally
      this.bar(x0, y, w, h, this.charge, this.charge > this.band[1] ? COLORS.bad : COLORS.ember);
      ctx.fillStyle = 'rgba(143,209,106,0.45)';
      ctx.fillRect(x0 + this.band[0] * w, y, (this.band[1] - this.band[0]) * w, h);
      this.text('Hold to charge — release in the green band', x0 + w / 2, y + h + 10, { size: 9, align: 'center', color: COLORS.paper });
    } else if (this.style === 'melodic') {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x0, y, w, h);
      const lineX = 120;
      ctx.fillStyle = COLORS.gold;
      ctx.fillRect(lineX - 1, y - 4, 2, h + 8);
      for (const n of this.notes) {
        if (n.hit || n.x > x0 + w + 10 || n.x < x0 - 10) continue;
        ctx.fillStyle = n.missed ? COLORS.dim : '#c8b8ff';
        ctx.fillRect(Math.round(n.x) - 3, y + 3, 6, h - 6);
      }
      this.text('Strike as each note meets the golden line', x0 + w / 2, y + h + 10, { size: 9, align: 'center', color: COLORS.paper });
    } else {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x0, y, w, h);
      const zs = this.style === 'syncopated' ? this.zones : [this.zone];
      zs.forEach((z, i) => {
        const active = this.style !== 'syncopated' || i === this.zoneIdx;
        const flicker = this.env.quirk === 'flicker' && Math.sin(this.t * 7) > 0.6;
        if (flicker) return;
        ctx.fillStyle = active ? 'rgba(143,209,106,0.55)' : 'rgba(143,209,106,0.2)';
        ctx.fillRect(x0 + (z - this.halfW) * w, y, this.halfW * 2 * w, h);
        ctx.fillStyle = active ? 'rgba(240,200,96,0.9)' : 'rgba(240,200,96,0.3)';
        ctx.fillRect(x0 + (z - this.halfW * 0.3) * w, y, this.halfW * 0.6 * w, h);
      });
      ctx.fillStyle = COLORS.cream;
      ctx.fillRect(Math.round(x0 + this.p * w) - 1, y - 3, 3, h + 6);
      const hint = this.style === 'syncopated' ? 'Strike both zones in order on each sweep' : 'Strike when the marker crosses the gold';
      this.text(hint, x0 + w / 2, y + h + 10, { size: 9, align: 'center', color: COLORS.paper });
    }
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    const total = this.segs * this.strikesPerSeg;
    this.text(`Strikes ${this.strikes.length}/${total}`, 12, MH - 14, { size: 10, color: COLORS.paper });
    const acc = this.strikes.length ? mean(this.strikes.map((s) => s.acc)) : 0;
    this.text(`Accuracy ${Math.round(acc * 100)}%`, MW - 12, MH - 14, { size: 10, color: COLORS.paper, align: 'right' });
    const label: Record<Style, string> = { steady: 'Steady rhythm', swing: 'Swinging rhythm', syncopated: 'Syncopated rhythm', heavy: 'Heavy blows', melodic: 'Melodic strikes' };
    this.text(label[this.style], MW / 2, MH - 14, { size: 10, color: COLORS.gold, align: 'center' });
  }
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export const hammerGame: MinigameDef = {
  id: 'hammer',
  name: 'Hammering',
  controls: 'Click / tap / Space to strike. Heavy style: hold and release.',
  instructions: (env) => {
    const s = env.params.style;
    const base = ['Work along the piece segment by segment.', 'Early strikes swell the left edge, late strikes the right — your timing becomes its shape.'];
    if (s === 'heavy') return ['Mountain style: hold to charge each blow, release inside the green band.', ...base];
    if (s === 'melodic') return ['Celestial style: strike as each note meets the golden line.', ...base];
    if (s === 'syncopated') return ['Patternwright style: two zones per sweep — strike both, in order.', ...base];
    if (s === 'wild') return ['Experimental: every segment has a different rhythm.', ...base];
    return ['Strike as the marker crosses the gold centre of the green zone.', ...base];
  },
  create: (env) => new Hammer(env),
};
