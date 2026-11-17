// Fletching. Each arrow is seen end-on, nock toward you: a circle with the
// nock groove across it. A feather turns slowly round the shaft in the jig;
// tap (click / Space) to glue it down as it reaches each of the three marked
// places — the cock feather square to the nock groove, then the two hen
// feathers a third of a turn either side. Three feathers per arrow, six arrows.
//
// With the fletching jig, later arrows follow the first: part of each arrow's
// error is replaced by the first arrow's, so a well-set first arrow makes a
// matched set (and a poor one is copied too).
//
// score = mean accuracy of all 18 feathers
// data: { fletchErr[ARROW_COUNT] −1..1 (mean signed error of each arrow) }
// details: accuracy, consistency

import { seededRng } from '../core/rng';
import { clamp, hexToRgb, mean, stdev } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { ARROW_COUNT } from '../item/factory';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

const C: [number, number] = [190, 138];
const R_SHAFT = 16;
const R_VANE = 74;
const TAU = Math.PI * 2;
/** Feather positions, measured from the nock groove (which lies left–right): cock feather straight up. */
const TARGETS = [-Math.PI / 2, -Math.PI / 2 + TAU / 3, -Math.PI / 2 + (2 * TAU) / 3];

const angDiff = (a: number, b: number) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

class Fletch extends BaseMinigame {
  private rng = seededRng(this.env.item.seed, 'fletch');
  private arrow = 0;
  private feather = 0;
  private angle = 0;
  private speed: number;
  private tol: number;
  private placed: number[][] = []; // signed error (radians) of each feather, per arrow
  private glue = 0;
  private pause = 0.8;
  private pal: string[];
  private accs: number[] = [];

  constructor(env: MinigameEnv) {
    super(env);
    this.speed = this.tune(1.7, 3.1) * (env.quirk === 'bursts' ? 0.9 : 1);
    this.tol = this.tune(0.3, 0.14) * (env.quirk === 'bursts' ? 1.3 : 1);
    const id = env.item.materials.grip;
    this.pal = hasMat(id) ? mat(id).palette : mat('goose').palette;
    this.startArrow();
  }

  private startArrow() {
    this.feather = 0;
    this.placed.push([]);
    // the feather starts well before the first mark, turning toward it
    this.angle = TARGETS[0] - this.rng.range(2.2, 3.4);
    this.pause = 0.5;
    this.env.onStatus?.(`Arrow ${this.arrow + 1} / ${ARROW_COUNT}`);
  }

  private place() {
    if (this.finished || this.pause > 0) return;
    const err = angDiff(this.angle, TARGETS[this.feather]);
    const d = Math.abs(err);
    const acc = d <= this.tol * 0.3 ? 1 : d <= this.tol ? 1 - ((d - this.tol * 0.3) / (this.tol * 0.7)) * 0.25 : Math.max(0, 0.75 - ((d - this.tol) / (this.tol * 2.5)) * 0.75);
    this.accs.push(acc);
    this.placed[this.arrow].push(err);
    this.glue = 1;
    const x = C[0] + Math.cos(this.angle) * R_VANE, y = C[1] + Math.sin(this.angle) * R_VANE;
    const fx = this.mirrored ? MW - x : x;
    if (acc > 0.92) { this.floatText('True', fx, y - 8, COLORS.gold); this.env.audio.sfx('snap', { pitch: 1.1 }); }
    else if (acc > 0.6) { this.floatText('Close', fx, y - 8, COLORS.good); this.env.audio.sfx('place'); }
    else { this.floatText(err < 0 ? 'Early' : 'Late', fx, y - 8, COLORS.ok); this.env.audio.sfx('soft'); }
    this.feather++;
    if (this.feather >= 3) {
      this.arrow++;
      if (this.arrow >= ARROW_COUNT) return this.complete();
      this.startArrow();
    } else {
      // the next feather comes round from a little way back
      this.angle = TARGETS[this.feather] - this.rng.range(1.6, 2.6);
      this.pause = 0.25;
    }
  }

  protected update(dt: number) {
    this.glue = Math.max(0, this.glue - dt * 3);
    if (this.finished) return;
    if (this.pause > 0) { this.pause -= dt; return; }
    let sp = this.speed;
    if (this.env.quirk === 'drifting') sp *= 1 + 0.25 * Math.sin(this.t * 2.3);
    this.angle += sp * dt;
    // a feather that goes a full turn past its mark is set where it was
    if (angDiff(this.angle, TARGETS[this.feather]) > 0 && this.angle - TARGETS[this.feather] > Math.PI * 1.7) this.place();
    if (this.action()) this.place();
  }

  private complete() {
    const jig = (this.env.upgrades ?? []).includes('fletchjig');
    const raw = this.placed.map((p) => mean(p) / this.tol / 2.5);
    // the jig copies the first arrow's setting onto the rest
    const errs = raw.map((e, i) => clamp(i === 0 || !jig ? e : e * 0.55 + raw[0] * 0.45, -1, 1));
    const accuracy = mean(this.accs);
    const consistency = 1 - clamp(stdev(errs) * 2.5);
    const score = clamp(accuracy * 0.85 + consistency * 0.15);
    const g = gradeOf(score);
    this.env.audio.sfx('success');
    this.finish({
      score,
      details: { accuracy, consistency },
      data: { fletchErr: errs.map((v) => Math.round(v * 1000) / 1000) },
      summary: `${g} fletching — ${accuracy > 0.88 ? 'every vane set true, a third of a turn apart' : accuracy > 0.68 ? 'the vanes sit well, a few a touch off' : 'several vanes sit crooked'}${consistency > 0.85 ? ', and the arrows match' : ''}.`,
    });
  }

  // ------------------------------------------------------------ draw
  private vane(ctx: CanvasRenderingContext2D, a: number, alpha: number, ghost = false) {
    const [r, g, b] = hexToRgb(this.pal[ghost ? 2 : 4]);
    const [r2, g2, b2] = hexToRgb(this.pal[2]);
    const ca = Math.cos(a), sa = Math.sin(a);
    // a feather seen end-on: a thin blade leaning a little, with a darker quill
    ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.lineWidth = ghost ? 1 : 5;
    ctx.beginPath(); ctx.moveTo(C[0] + ca * (R_SHAFT + 1), C[1] + sa * (R_SHAFT + 1)); ctx.lineTo(C[0] + ca * R_VANE, C[1] + sa * R_VANE); ctx.stroke();
    if (ghost) return;
    ctx.strokeStyle = `rgba(${r2},${g2},${b2},${alpha})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(C[0] + ca * (R_SHAFT + 1), C[1] + sa * (R_SHAFT + 1)); ctx.lineTo(C[0] + ca * R_VANE, C[1] + sa * R_VANE); ctx.stroke();
  }

  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.3, '#2a2018');
    // jig
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(C[0] - 110, C[1] + 92, 220, 10);
    ctx.fillRect(C[0] - 6, C[1] + R_SHAFT, 12, 80);
    // the three marks
    const flick = this.env.quirk === 'flicker' && Math.sin(this.t * 6.7) > 0.55;
    TARGETS.forEach((a, i) => {
      if (flick) return;
      const done = i < this.feather, now = i === this.feather && !this.finished;
      ctx.strokeStyle = done ? 'rgba(143,209,106,0.5)' : now ? COLORS.gold : 'rgba(240,200,96,0.3)';
      ctx.lineWidth = now ? 2 : 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(C[0] + Math.cos(a) * (R_SHAFT + 4), C[1] + Math.sin(a) * (R_SHAFT + 4)); ctx.lineTo(C[0] + Math.cos(a) * (R_VANE + 8), C[1] + Math.sin(a) * (R_VANE + 8)); ctx.stroke();
      ctx.setLineDash([]);
      if (now) {
        // the tolerance arc
        ctx.strokeStyle = 'rgba(143,209,106,0.55)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(C[0], C[1], R_VANE + 8, a - this.tol, a + this.tol); ctx.stroke();
      }
    });
    // feathers already glued on this arrow
    (this.placed[this.arrow] ?? []).forEach((e, i) => this.vane(ctx, TARGETS[i] + e, 1));
    // the turning feather
    if (!this.finished && this.feather < 3) this.vane(ctx, this.angle, 0.9);
    // shaft end and nock groove
    ctx.fillStyle = '#c8a070';
    ctx.beginPath(); ctx.arc(C[0], C[1], R_SHAFT, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e8c898';
    ctx.beginPath(); ctx.arc(C[0] - 3, C[1] - 3, R_SHAFT - 5, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3a2414';
    ctx.fillRect(C[0] - R_SHAFT, C[1] - 2, R_SHAFT * 2, 4);
    if (this.glue > 0) { ctx.strokeStyle = `rgba(255,244,220,${this.glue})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(C[0], C[1], R_SHAFT + 6 + (1 - this.glue) * 14, 0, TAU); ctx.stroke(); }

    // the finished arrows, as small end-on views
    this.panel(356, 30, 108, 204, 'rgba(30,20,16,0.55)', COLORS.panelEdge);
    for (let i = 0; i < ARROW_COUNT; i++) {
      const cx = 384 + (i % 2) * 52, cy = 62 + Math.floor(i / 2) * 62;
      ctx.fillStyle = i < this.arrow ? '#c8a070' : 'rgba(200,160,112,0.25)';
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, TAU); ctx.fill();
      const p = this.placed[i];
      if (!p || i > this.arrow) continue;
      p.forEach((e, k) => {
        const a = TARGETS[k] + e;
        ctx.strokeStyle = this.pal[4];
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * 6, cy + Math.sin(a) * 6); ctx.lineTo(cx + Math.cos(a) * 20, cy + Math.sin(a) * 20); ctx.stroke();
      });
    }
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    this.text(`Fletching — arrow ${Math.min(this.arrow + 1, ARROW_COUNT)} of ${ARROW_COUNT}`, 190, 12, { size: 10, align: 'center', color: COLORS.gold });
    this.text(this.feather === 0 ? 'Cock feather: square to the nock groove' : 'Hen feather: a third of a turn on', 190, 28, { size: 8, align: 'center', color: COLORS.paper });
    this.text(this.touchInput ? 'Tap as the feather reaches the gold mark' : 'Click / Space as the feather reaches the gold mark', 190, MH - 12, { size: 9, align: 'center', color: COLORS.paper });
    if (this.accs.length) this.text(`Accuracy ${Math.round(mean(this.accs) * 100)}%`, 12, 14, { size: 9, color: COLORS.paper });
  }
}

export const fletchGame: MinigameDef = {
  id: 'fletch',
  name: 'Fletching',
  controls: 'Click / tap / Space to glue each feather down as it reaches its mark.',
  instructions: (env) => [
    'You are looking down the shaft from the nock end. A feather turns slowly round it in the jig.',
    'Glue it down at each gold mark: the cock feather square to the nock groove, then two hen feathers a third of a turn either side.',
    ...((env.upgrades ?? []).includes('fletchjig') ? ['Your jig copies the first arrow onto the rest, so take most care with that one.'] : []),
  ],
  create: (env) => new Fletch(env),
};
