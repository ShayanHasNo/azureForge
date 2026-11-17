// Twisting a bowstring (a Flemish twist). Two bundles of thread hang from a
// peg. A weight swings between them like a pendulum; each time it reaches a
// side, that bundle is twisted and laid over the other. The player taps the
// LEFT side as the weight reaches the left and the RIGHT side as it reaches
// the right (tap left / right half of the bench, or ← / →; A / D).
//
// Good timing gives a tight, even twist. A tap on the wrong side or far off
// the beat leaves a loose, lumpy twist; a swing with no tap is a skipped twist.
// The string on the right grows as it is made, showing every twist.
//
// score = 0.75 · mean timing + 0.25 · consistency (with skipped twists counted as 0)
// data: { even: 0..1, twists }
// details: timing, consistency, skipped

import { seededRng } from '../core/rng';
import { clamp, hexToRgb, mean, stdev } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

const PEG: [number, number] = [170, 44];
const ARM = 120;
const SWING = 0.62; // radians each side

class StringTwist extends BaseMinigame {
  private rng = seededRng(this.env.item.seed, 'string');
  private total: number;
  private period: number; // seconds per half swing (one twist)
  private window: number; // timing tolerance as a fraction of a half swing
  private beat = 0; // index of the twist being made
  private acc: number[] = [];
  private judged = false; // has the current half swing been judged?
  private skipped = 0;
  private flash = 0;
  private pal: string[];
  private startDelay = 1.2;

  constructor(env: MinigameEnv) {
    super(env);
    this.total = Math.round(this.tune(14, 22));
    this.period = this.tune(0.78, 0.5) * (env.quirk === 'bursts' ? 0.92 : 1);
    this.window = this.tune(0.3, 0.16) * (env.quirk === 'bursts' ? 1.3 : 1);
    const id = env.item.materials.secondary;
    this.pal = hasMat(id) ? mat(id).palette : mat('linenthread').palette;
    this.env.onStatus?.(`Twist 0 / ${this.total}`);
  }

  /** Phase within the current half swing, 0 (just left a side) → 1 (reaching the other). */
  private phase(): number {
    const t = this.t - this.startDelay;
    if (t < 0) return 0;
    return (t / this.period) % 1;
  }
  private half(): number { return Math.max(0, Math.floor((this.t - this.startDelay) / this.period)); }
  /** Which side the weight is heading to on this half swing: +1 right, −1 left. */
  private side(h = this.half()): number { return h % 2 === 0 ? 1 : -1; }
  private angle(): number {
    const t = this.t - this.startDelay;
    if (t < 0) return -SWING;
    return -SWING * Math.cos((t / this.period) * Math.PI);
  }

  private judge(sideTapped: number) {
    if (this.finished || this.t < this.startDelay) return;
    // a tap belongs to whichever arrival is nearer: the end of this half swing or the start of it
    const ph = this.phase();
    let h = this.half();
    let off = 1 - ph; // time until the weight arrives, in half swings
    if (ph < 0.5 && h > 0) { h -= 1; off = ph; } // just after an arrival
    if (h < this.beat) { this.floatText('Wait for the swing', MW / 2, 60, COLORS.dim); return; }
    if (h > this.beat) return; // this arrival was already missed and counted
    const right = this.side(h) === sideTapped;
    let a = off <= this.window * 0.35 ? 1 : off <= this.window ? 1 - ((off - this.window * 0.35) / (this.window * 0.65)) * 0.3 : Math.max(0, 0.7 - ((off - this.window) / this.window) * 0.7);
    if (!right) a *= 0.25;
    this.record(a, right);
  }

  private record(a: number, right = true) {
    this.acc.push(a);
    this.beat++;
    this.flash = 1;
    const x = PEG[0] + Math.sin(this.angle()) * ARM, y = PEG[1] + Math.cos(this.angle()) * ARM;
    if (!right) { this.floatText('Wrong side', x, y - 20, COLORS.bad); this.env.audio.sfx('soft'); }
    else if (a > 0.92) { this.floatText('Tight', x, y - 20, COLORS.gold); this.env.audio.sfx('snap', { pitch: 1 + this.beat * 0.01 }); }
    else if (a > 0.6) { this.floatText('Good', x, y - 20, COLORS.good); this.env.audio.sfx('snap', { volume: 0.6 }); }
    else { this.floatText('Loose', x, y - 20, COLORS.ok); this.env.audio.sfx('soft', { volume: 0.6 }); }
    this.env.onStatus?.(`Twist ${this.beat} / ${this.total}`);
    if (this.beat >= this.total) this.complete();
  }

  protected update(dt: number) {
    this.flash = Math.max(0, this.flash - dt * 4);
    if (this.finished) return;
    // an arrival that went by with no tap is a skipped twist
    const h = this.half(), ph = this.phase();
    if (this.t > this.startDelay && h - 1 >= this.beat && ph > this.window) {
      this.skipped++;
      this.acc.push(0);
      this.beat++;
      this.floatText('Skipped', MW / 2 - 70, 70, COLORS.dim);
      this.env.onStatus?.(`Twist ${this.beat} / ${this.total}`);
      if (this.beat >= this.total) { this.complete(); return; }
    }
    let tap = 0;
    if (this.wasPressed('ArrowLeft', 'KeyA')) tap = -1;
    if (this.wasPressed('ArrowRight', 'KeyD')) tap = 1;
    if (this.pointer.justDown) tap = this.pointer.x < PEG[0] ? -1 : 1;
    if (tap) this.judge(this.mirrored && !this.pointer.justDown ? -tap : tap);
  }

  private complete() {
    const timing = mean(this.acc);
    const consistency = 1 - clamp(stdev(this.acc) * 2);
    const score = clamp(timing * 0.75 + consistency * 0.25);
    const g = gradeOf(score);
    this.env.audio.sfx('success');
    this.finish({
      score,
      details: { timing, consistency, skipped: clamp(this.skipped / this.total) },
      data: { even: Math.round(score * 1000) / 1000, twists: this.total },
      summary: `${g} string — ${this.total} twists, ${score > 0.85 ? 'tight and even from loop to loop' : score > 0.65 ? 'even enough to shoot well' : this.skipped > 2 ? 'with several skipped' : 'loose and lumpy in places'}.`,
    });
  }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.35, '#2a2018');
    const [r, g, b] = hexToRgb(this.pal[4]);
    // bench and peg
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(30, 30, 280, 8);
    ctx.fillStyle = '#8a6a40';
    ctx.fillRect(PEG[0] - 3, PEG[1] - 12, 6, 14);
    // side markers
    for (const s of [-1, 1]) {
      const x = PEG[0] + Math.sin(s * SWING) * ARM, y = PEG[1] + Math.cos(s * SWING) * ARM;
      const active = !this.finished && this.side() === s && this.t >= this.startDelay;
      ctx.strokeStyle = active ? COLORS.gold : 'rgba(240,200,96,0.3)';
      ctx.lineWidth = active ? 2 : 1;
      ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.stroke();
      if (active) {
        // the ring closes as the weight approaches
        const k = 1 - this.phase();
        ctx.strokeStyle = `rgba(255,244,220,${0.25 + 0.6 * (1 - k)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 13 + k * 22, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // the two bundles, hanging and swinging
    const a = this.angle();
    const wx = PEG[0] + Math.sin(a) * ARM, wy = PEG[1] + Math.cos(a) * ARM;
    for (const off of [-3, 3]) {
      ctx.strokeStyle = off < 0 ? this.pal[4] : this.pal[3];
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(PEG[0] + off * 0.3, PEG[1]); ctx.quadraticCurveTo(PEG[0] + Math.sin(a) * ARM * 0.4 + off, PEG[1] + ARM * 0.5, wx + off * 0.6, wy); ctx.stroke();
    }
    ctx.fillStyle = `rgba(${r},${g},${b},${0.5 + 0.5 * this.flash})`;
    ctx.fillRect(Math.round(wx) - 5, Math.round(wy) - 4, 10, 10);
    ctx.fillStyle = '#6a5038';
    ctx.fillRect(Math.round(wx) - 5, Math.round(wy) + 4, 10, 3);

    // the string made so far: one lozenge per twist, tight twists small and even
    this.panel(336, 24, 128, 216, 'rgba(30,20,16,0.55)', COLORS.panelEdge);
    const x0 = 400, y0 = 34, step = Math.min(10, 196 / this.total);
    for (let i = 0; i < this.acc.length; i++) {
      const q = this.acc[i];
      const w = 3 + (1 - q) * 5 + (i % 2 ? 0.6 : 0);
      const y = y0 + i * step;
      ctx.fillStyle = q === 0 ? 'rgba(0,0,0,0.5)' : this.pal[i % 2 ? 4 : 3];
      ctx.beginPath();
      ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y + step / 2); ctx.lineTo(x0, y + step); ctx.lineTo(x0 - w, y + step / 2);
      ctx.closePath(); ctx.fill();
      if (q > 0) { ctx.fillStyle = this.pal[5]; ctx.fillRect(Math.round(x0 - w * 0.4), Math.round(y + step * 0.3), 1, Math.max(1, Math.round(step * 0.3))); }
    }
    // the loop at the top
    ctx.strokeStyle = this.pal[4];
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x0, y0 - 4, 4, 0, Math.PI * 2); ctx.stroke();
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    this.text('Twisting the string', 170, 12, { size: 10, align: 'center', color: COLORS.gold });
    const waiting = this.t < this.startDelay;
    this.text(waiting ? 'Watch the swing…' : this.touchInput ? 'Tap the side the weight is swinging to, as it arrives' : 'Tap ← / → (or click that side) as the weight reaches it', 170, MH - 12, { size: 9, align: 'center', color: waiting ? COLORS.dim : COLORS.paper });
    this.text(`${this.beat} / ${this.total}`, 400, MH - 12, { size: 9, align: 'center', color: COLORS.paper });
    if (this.acc.length) this.text(`Evenness ${Math.round(mean(this.acc) * 100)}%`, 12, 14, { size: 9, color: COLORS.paper });
  }
}

export const stringGame: MinigameDef = {
  id: 'string',
  name: 'Twisting the String',
  controls: 'Tap ← or → (A / D), or click / tap the left or right side, as the swinging weight reaches that side.',
  instructions: () => [
    'A bowstring is two bundles of thread, each twisted one way and laid over the other the opposite way.',
    'A weight swings between the bundles. Each time it reaches a side, tap that side to make the twist.',
    'On the beat, the twist is tight. Late, early or on the wrong side, it is loose — and a string is only as good as its loosest twist.',
  ],
  create: (env) => new StringTwist(env),
};
