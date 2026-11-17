// Tillering a bow. The roughed-out bow sits on a tillering tree and is drawn
// a little further at each of three steps (brace, half draw, full draw). Each
// limb has BOW_SECTIONS sections, each with a stiffness: 1.0 is right, more is
// too stiff (that part of the limb stays flat), less is weak (a hinge).
//
// The player reads the curve against the dashed target arc and scrapes wood
// from the belly of the stiff sections: click / tap a section (hold to keep
// scraping), or Left / Right to choose one and Space to scrape. Wood only
// comes off — a hinge cannot be put back, and every scrape costs a little draw
// weight. "Draw further" (Enter) moves to the next step, where the same
// differences show more clearly; after full draw it finishes.
//
// score = 0.55 · evenness + 0.2 · limb balance + 0.15 · (1 − hinge) + 0.1 · draw weight
// data: { upper[], lower[] (stiffness error per section, grip → tip), draw 0..1, hinge 0..1 }
// details: evenness, balance, hinge, drawWeight

import { seededRng } from '../core/rng';
import { clamp, hexToRgb, mean } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { BOW_SECTIONS } from '../item/factory';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

type V = [number, number];
const N = BOW_SECTIONS;
const HANDLE: V = [240, 74];
const HANDLE_HALF = 16; // the rigid handle section
const SEG = 30; // length of one limb section on screen
const DRAW = [0.3, 0.62, 1]; // how far the bow is drawn at each step
const STEP_NAMES = ['Braced', 'Half draw', 'Full draw'];
const BTN = { x: MW - 124, y: MH - 40, w: 112, h: 22 };

class Tiller extends BaseMinigame {
  private rng = seededRng(this.env.item.seed, 'tiller');
  /** stiffness per section: [0..N) left limb (upper), [N..2N) right limb (lower); grip → tip */
  private stiff: number[] = [];
  private step = 0;
  private drawNow = DRAW[0];
  private sel = 0;
  private tol: number;
  private hints: boolean;
  private scrapeHeld = 0;
  private scrapes = 0;
  private dust: number[] = new Array(N * 2).fill(0);
  private wood: string[];

  constructor(env: MinigameEnv) {
    super(env);
    const spread = this.tune(0.3, 0.55);
    for (let i = 0; i < N * 2; i++) {
      // every section starts too stiff; a few are much stiffer than the rest
      const lump = this.rng.chance(0.3) ? this.rng.range(0.15, 0.3) : 0;
      this.stiff.push(1 + this.rng.range(0.1, spread) + lump);
    }
    this.tol = this.tune(0.075, 0.04) * (env.quirk === 'bursts' ? 1.3 : 1);
    this.hints = env.difficulty < 2;
    const p = hasMat(env.item.materials.primary) ? mat(env.item.materials.primary).palette : mat('ash').palette;
    this.wood = p;
    this.status();
  }

  private status() {
    this.env.onStatus?.(`${STEP_NAMES[this.step]} — evenness ${Math.round(this.evenness() * 100)}%`);
  }

  // ------------------------------------------------------------ geometry
  /** Points along one limb (side −1 = left / upper, +1 = right / lower) for a stiffness list. */
  private limb(side: number, stiff: number[], draw: number): V[] {
    const pts: V[] = [[HANDLE[0] + side * HANDLE_HALF, HANDLE[1]]];
    let ang = 0;
    const bend = 0.21 * draw; // radians per section at the right stiffness
    for (let i = 0; i < N; i++) {
      // a stiff section bends less than its share, a weak one more
      ang += bend / Math.pow(stiff[i], 2.2);
      const [x, y] = pts[pts.length - 1];
      pts.push([x + side * Math.cos(ang) * SEG, y + Math.sin(ang) * SEG]);
    }
    return pts;
  }
  private sectionStiff(side: number) { return side < 0 ? this.stiff.slice(0, N) : this.stiff.slice(N); }

  private errors(): number[] { return this.stiff.map((s) => s - 1); }
  private evenness(): number {
    return clamp(1 - mean(this.errors().map((e) => Math.abs(e))) / 0.3);
  }
  private hinge(): number {
    return clamp((-Math.min(...this.errors()) - this.tol) * 4);
  }

  // ------------------------------------------------------------ input
  private uiPointer(): V { return [this.mirrored ? MW - this.pointer.x : this.pointer.x, this.pointer.y]; }
  private overBtn() { const [x, y] = this.uiPointer(); return this.hits(BTN, x, y); }

  private sectionAt(x: number, y: number): number {
    let best = -1, bd = 26;
    for (const side of [-1, 1]) {
      const pts = this.limb(side, this.sectionStiff(side), this.drawNow);
      for (let i = 0; i < N; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        const d = Math.hypot(x - mx, y - my);
        if (d < bd) { bd = d; best = (side < 0 ? 0 : N) + i; }
      }
    }
    return best;
  }

  private scrape(i: number, amount: number) {
    if (i < 0 || this.finished) return;
    this.sel = i;
    this.stiff[i] = Math.max(0.55, this.stiff[i] - amount);
    this.dust[i] = 1;
    this.scrapes++;
    if (this.scrapes % 3 === 0) this.env.audio.sfx('grind', { volume: 0.35, pitch: 1.1 + this.rng.range(-0.1, 0.1) });
    const side = i < N ? -1 : 1;
    const pts = this.limb(side, this.sectionStiff(side), this.drawNow);
    const k = i < N ? i : i - N;
    const mx = (pts[k][0] + pts[k + 1][0]) / 2, my = (pts[k][1] + pts[k + 1][1]) / 2;
    this.spawn(mx, my + 4, { n: 2, vy: 30, spread: 26, life: 0.5, color: this.wood[4], size: 1, g: 90 });
    if (this.stiff[i] < 1 - this.tol * 1.6 && this.stiff[i] + amount >= 1 - this.tol * 1.6) {
      this.floatText('Too thin — a hinge', mx, my - 14, COLORS.bad);
      this.env.audio.sfx('soft');
    }
    this.status();
  }

  private advance() {
    if (this.finished) return;
    if (this.step < DRAW.length - 1) {
      this.step++;
      this.env.audio.sfx('fold', { pitch: 0.8 + this.step * 0.15, volume: 0.6 });
      this.floatText(STEP_NAMES[this.step], MW / 2, 40, COLORS.gold);
      this.status();
    } else this.complete();
  }

  protected update(dt: number) {
    // ease the draw toward the current step
    this.drawNow += (DRAW[this.step] - this.drawNow) * Math.min(1, dt * 3);
    for (let i = 0; i < this.dust.length; i++) this.dust[i] = Math.max(0, this.dust[i] - dt * 2);
    if ((this.pointer.justDown && this.overBtn()) || this.wasPressed('Enter')) { this.advance(); return; }
    // keyboard: choose a section, hold Space to scrape
    if (this.wasPressed('ArrowLeft', 'KeyA')) this.sel = (this.sel + N * 2 - 1) % (N * 2);
    if (this.wasPressed('ArrowRight', 'KeyD')) this.sel = (this.sel + 1) % (N * 2);
    const rate = 0.16; // stiffness removed per second while scraping
    if (this.wasPressed('Space')) this.scrape(this.sel, 0.02);
    else if (this.isDown('Space')) this.scrape(this.sel, rate * dt);
    // pointer: tap a section for one pass of the scraper, hold to keep going
    if (this.pointer.justDown && !this.overBtn()) {
      const [x, y] = [this.pointer.x, this.pointer.y];
      const i = this.sectionAt(x, y);
      if (i >= 0) { this.scrape(i, 0.02); this.scrapeHeld = 0; }
    } else if (this.pointer.down && !this.overBtn()) {
      this.scrapeHeld += dt;
      if (this.scrapeHeld > 0.25) {
        const i = this.sectionAt(this.pointer.x, this.pointer.y);
        if (i >= 0) this.scrape(i, rate * dt);
      }
    }
  }

  private complete() {
    const err = this.errors();
    const up = err.slice(0, N), low = err.slice(N);
    const even = this.evenness();
    const balance = clamp(1 - Math.abs(mean(up) - mean(low)) / 0.2);
    const hinge = this.hinge();
    // draw weight: all the stiffness the stave still has, relative to the target
    const draw = clamp(mean(this.stiff) / 1, 0, 1.15);
    const drawScore = clamp(1 - Math.abs(draw - 1) / 0.25);
    const score = clamp(0.55 * even + 0.2 * balance + 0.15 * (1 - hinge) + 0.1 * drawScore);
    const g = gradeOf(score);
    this.env.audio.sfx('success');
    const worst = Math.max(...err.map((e) => Math.abs(e)));
    this.finish({
      score,
      details: { evenness: even, balance, hinge, drawWeight: clamp(draw) },
      data: { upper: up.map((e) => clamp(e / 0.5, -1, 1)), lower: low.map((e) => clamp(e / 0.5, -1, 1)), draw: clamp(draw), hinge },
      summary: `${g} tillering — ${hinge > 0.3 ? 'a hinge in one limb' : worst < this.tol * 1.5 ? 'both limbs bend in one clean arc' : even > 0.7 ? 'the limbs bend evenly, with a flat spot or two' : 'the limbs are still stiff in places'}${balance < 0.6 ? ', and one limb is stronger than the other' : ''}.`,
    });
  }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.3, '#2c2018');
    // the tillering tree: a post with a notch for the handle and a scale behind it
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(HANDLE[0] - 5, HANDLE[1] - 4, 10, MH - HANDLE[1] - 30);
    ctx.fillStyle = '#5a4028';
    ctx.fillRect(HANDLE[0] - 5, HANDLE[1] - 4, 3, MH - HANDLE[1] - 30);
    ctx.fillStyle = 'rgba(255,240,210,0.08)';
    for (let y = HANDLE[1] + 20; y < MH - 40; y += 20) ctx.fillRect(HANDLE[0] - 150, y, 300, 1);
    for (let x = HANDLE[0] - 150; x <= HANDLE[0] + 150; x += 30) ctx.fillRect(x, HANDLE[1] + 10, 1, MH - HANDLE[1] - 50);

    const ideal = new Array(N).fill(1);
    const tips: V[] = [];
    for (const side of [-1, 1]) {
      // target arc
      const tp = this.limb(side, ideal, this.drawNow);
      const flick = this.env.quirk === 'flicker' && Math.sin(this.t * 6.7) > 0.55;
      if (!flick) {
        ctx.strokeStyle = 'rgba(240,200,96,0.5)';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        tp.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1] + 9) : ctx.moveTo(p[0], p[1] + 9)));
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // the limb itself, section by section (thicker where it is stiffer)
      const st = this.sectionStiff(side);
      const pts = this.limb(side, st, this.drawNow);
      for (let i = 0; i < N; i++) {
        const gi = (side < 0 ? 0 : N) + i;
        const th = 3 + (1 - i / N) * 3 + (st[i] - 1) * 5;
        ctx.strokeStyle = this.wood[i % 2 ? 2 : 3];
        ctx.lineWidth = Math.max(2, th);
        ctx.lineCap = 'butt';
        ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1]); ctx.lineTo(pts[i + 1][0], pts[i + 1][1]); ctx.stroke();
        // back of the bow: a light line along the top edge
        ctx.strokeStyle = this.wood[5];
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pts[i][0], pts[i][1] - th / 2); ctx.lineTo(pts[i + 1][0], pts[i + 1][1] - th / 2); ctx.stroke();
        const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
        if (gi === this.sel) {
          ctx.strokeStyle = COLORS.cream;
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(mx) - 9.5, Math.round(my) - 9.5, 19, 19);
        }
        if (this.dust[gi] > 0) {
          const [r, g, b] = hexToRgb(this.wood[5]);
          ctx.fillStyle = `rgba(${r},${g},${b},${this.dust[gi] * 0.6})`;
          ctx.fillRect(Math.round(mx) - 6, Math.round(my) + 4, 12, 2);
        }
        // gentle guidance on easier settings: which way each section is off
        if (this.hints) {
          const e = st[i] - 1;
          if (e > this.tol) this.text('▲', this.mirrored ? MW - mx : mx, my - 13, { size: 8, align: 'center', color: e > 0.25 ? COLORS.ember : COLORS.ok, shadow: false });
          else if (e < -this.tol) this.text('▼', this.mirrored ? MW - mx : mx, my - 13, { size: 8, align: 'center', color: COLORS.bad, shadow: false });
        }
      }
      // nock
      const tip = pts[N];
      tips.push(tip);
      ctx.fillStyle = '#e8dcc0';
      ctx.fillRect(Math.round(tip[0]) - 2, Math.round(tip[1]) - 3, 4, 6);
    }
    // handle
    ctx.fillStyle = this.wood[2];
    ctx.fillRect(HANDLE[0] - HANDLE_HALF, HANDLE[1] - 6, HANDLE_HALF * 2, 12);
    ctx.fillStyle = '#6a3a24';
    ctx.fillRect(HANDLE[0] - HANDLE_HALF + 3, HANDLE[1] - 6, HANDLE_HALF * 2 - 6, 12);
    // string: from each tip down to the hook, and the rope to the pulley
    const hookY = Math.max(tips[0][1], tips[1][1]) + 24 + this.drawNow * 46;
    ctx.strokeStyle = '#e8e0c8';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(tips[0][0], tips[0][1]); ctx.lineTo(HANDLE[0], hookY); ctx.lineTo(tips[1][0], tips[1][1]); ctx.stroke();
    ctx.strokeStyle = '#a08a60';
    ctx.beginPath(); ctx.moveTo(HANDLE[0], hookY); ctx.lineTo(HANDLE[0], MH - 34); ctx.stroke();
    ctx.fillStyle = '#c8b080';
    ctx.fillRect(HANDLE[0] - 3, hookY - 2, 6, 5);
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    this.text(`Tillering — ${STEP_NAMES[this.step]}`, MW / 2, 12, { size: 10, align: 'center', color: COLORS.gold });
    this.text(this.touchInput ? 'Tap a flat, stiff part of a limb to scrape it (hold to keep scraping). Match the dashed curve.' : 'Click a flat, stiff part of a limb to scrape it (hold to keep going) • ←/→ + Space • match the dashed curve', MW / 2, 26, { size: 8, align: 'center', color: COLORS.paper });
    this.text(`Evenness ${Math.round(this.evenness() * 100)}%`, 12, MH - 14, { size: 10, color: COLORS.paper });
    const dw = clamp(mean(this.stiff));
    this.text(`Draw weight ${Math.round(dw * 100)}%`, 130, MH - 14, { size: 10, color: mean(this.stiff) < 0.97 ? COLORS.ok : COLORS.paper });
    if (this.hinge() > 0.05) this.text('Hinge!', 260, MH - 14, { size: 10, color: COLORS.bad });
    if (this.finished) return;
    const last = this.step === DRAW.length - 1;
    this.panel(BTN.x, BTN.y, BTN.w, BTN.h, this.overBtn() ? 'rgba(90,60,30,0.9)' : COLORS.panel, COLORS.gold);
    this.text(last ? 'Finish tillering' : 'Draw further', BTN.x + BTN.w / 2, BTN.y + BTN.h / 2, { size: 10, align: 'center', color: COLORS.cream });
  }
}

export const tillerGame: MinigameDef = {
  id: 'tiller',
  name: 'Tillering',
  controls: 'Click / tap a limb section to scrape it (hold to keep scraping), or ←/→ to choose and Space to scrape. "Draw further" or Enter moves on.',
  instructions: (env) => [
    'The bow goes on the tillering tree and is drawn a little further at each step.',
    'Where a limb stays flat it is too stiff. Scrape wood from that section until the limb follows the dashed curve.',
    'Wood only comes off: scrape a section too thin and it becomes a hinge that cannot be mended. Every scrape also costs a little draw weight.',
    ...(env.difficulty < 2 ? ['Small arrows mark sections that are too stiff (▲) or too thin (▼).'] : ['At this level there are no markers: read the curve.']),
  ],
  create: (env) => new Tiller(env),
};
