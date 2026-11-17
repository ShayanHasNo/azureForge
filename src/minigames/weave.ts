// Weaving mail, four rings in one. Every ring of a mail shirt passes through
// its two neighbours in the row above (and, once the next row is woven, two
// below). The patch hangs on the bench with one finished row; the player adds
// rings beneath it.
//
// Each new ring waits open in the tray. Drag it (or carry it with the arrow
// keys / WASD after picking it up with Space) through the two rings above its
// place — marked 1 and 2, in that order — and let go on the marked place to
// close it. A ring set down without passing through both neighbours hangs
// loose: a hole in the weave.
//
// Accuracy for a ring = how squarely it passed through each neighbour (60%),
// how close to its place it was set (25%) and whether it was done before the
// ring cooled (15%).
//
// score = 0.8 · mean accuracy (loose rings count 0) + 0.2 · consistency
// data: { even[8] (evenness top → bottom), gaps (fraction of loose rings) }
// details: accuracy, consistency, gaps

import { clamp, mean, stdev } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

interface Slot { x: number; y: number; row: number; acc: number | null; loose: boolean }

const PITCH = 44, ROW_H = 30, TOP = 62, RING = 15;
const TRAY: [number, number] = [56, 212];

class Weave extends BaseMinigame {
  private first: Array<[number, number]> = []; // the finished top row
  private slots: Slot[] = [];
  private cur = 0;
  private held = false;
  private rx = TRAY[0];
  private ry = TRAY[1];
  private gate = 0; // 0 none passed, 1 first passed, 2 both
  private best = [99, 99]; // closest approach to each neighbour's opening while it was due
  private timer = 0;
  private budget: number;
  private reach: number; // how near the opening counts as through it
  private pal: string[];
  private flash = 0;
  private sway = 0;

  constructor(env: MinigameEnv) {
    super(env);
    const n0 = 7;
    const x0 = MW / 2 + 30 - ((n0 - 1) * PITCH) / 2;
    for (let c = 0; c < n0; c++) this.first.push([x0 + c * PITCH, TOP]);
    const total = Math.round(this.tune(9, 15));
    for (let r = 1; r <= 3 && this.slots.length < total; r++) {
      for (let c = 0; c < n0 - r && this.slots.length < total; c++) this.slots.push({ x: x0 + (c + r / 2) * PITCH, y: TOP + r * ROW_H, row: r, acc: null, loose: false });
    }
    this.budget = this.tune(5.5, 3.2) * (env.quirk === 'bursts' ? 0.85 : 1);
    this.reach = this.tune(11, 7) * (env.quirk === 'bursts' ? 1.3 : 1);
    const id = env.item.materials.primary;
    this.pal = hasMat(id) ? mat(id).palette : mat('iron').palette;
    this.status();
  }

  private status() { this.env.onStatus?.(`Ring ${Math.min(this.cur + 1, this.slots.length)} / ${this.slots.length}`); }
  private drift(): number { return this.env.quirk === 'drifting' ? Math.sin(this.t * 0.9) * 7 : 0; }

  /** The two rings above the current place, left then right (their openings are the gates). */
  private gates(): Array<[number, number]> {
    const s = this.slots[this.cur];
    const d = this.drift();
    const fl = this.mirrored ? -1 : 1;
    const a: [number, number] = [s.x - (PITCH / 2) * fl + d, s.y - ROW_H + 5];
    const b: [number, number] = [s.x + (PITCH / 2) * fl + d, s.y - ROW_H + 5];
    return [a, b];
  }
  private place(): [number, number] { const s = this.slots[this.cur]; return [s.x + this.drift(), s.y]; }

  private pickUp() {
    if (this.held) return;
    this.held = true;
    this.env.audio.sfx('place', { volume: 0.4, pitch: 1.4 });
  }

  private setDown() {
    if (!this.held) return;
    this.held = false;
    const [px, py] = this.place();
    const d = Math.hypot(this.rx - px, this.ry - py);
    if (d > RING * 1.5) {
      // not at its place: the ring goes back to the tray, nothing lost but time
      if (this.gate > 0 || d < RING * 4) this.floatText('Set it on its place', px, py + 26, COLORS.dim);
      this.rx = TRAY[0]; this.ry = TRAY[1];
      this.gate = 0; this.best = [99, 99];
      return;
    }
    const s = this.slots[this.cur];
    if (this.gate < 2) {
      s.acc = 0; s.loose = true;
      this.floatText('Loose — not linked', px, py - 20, COLORS.bad);
      this.env.audio.sfx('soft');
      this.shake(2);
    } else {
      const through = mean(this.best.map((b) => clamp(1 - Math.max(0, b - this.reach * 0.3) / (this.reach * 0.7))));
      const seat = clamp(1 - Math.max(0, d - 3) / (RING * 1.5 - 3));
      const pace = this.timer <= this.budget ? 1 : clamp(1 - (this.timer - this.budget) / this.budget, 0.2, 1);
      s.acc = clamp(through * 0.6 + seat * 0.25 + pace * 0.15);
      if (s.acc > 0.9) { this.floatText('Linked', px, py - 20, COLORS.gold); this.env.audio.sfx('snap', { pitch: 1.3 }); this.sparks(px, py, 4, COLORS.gold); }
      else if (s.acc > 0.6) { this.floatText('Good', px, py - 20, COLORS.good); this.env.audio.sfx('snap', { volume: 0.6 }); }
      else { this.floatText(pace < 0.7 ? 'Slow' : 'Crooked', px, py - 20, COLORS.ok); this.env.audio.sfx('place', { volume: 0.5 }); }
    }
    this.flash = 1;
    this.cur++;
    this.gate = 0; this.best = [99, 99]; this.timer = 0;
    this.rx = TRAY[0]; this.ry = TRAY[1];
    this.status();
    if (this.cur >= this.slots.length) this.complete();
  }

  protected update(dt: number) {
    this.flash = Math.max(0, this.flash - dt * 4);
    this.sway += dt;
    if (this.finished || this.cur >= this.slots.length) return;
    this.timer += dt;
    // pointer: press anywhere to take the ring, drag, let go to set it
    if (this.pointer.justDown) { this.pickUp(); }
    if (this.held && this.pointer.down) { this.rx = this.pointer.x; this.ry = this.pointer.y - (this.touchInput ? 22 : 0); }
    if (this.pointer.justUp && this.held) { this.track(); this.setDown(); return; }
    // keyboard: Space takes the ring and sets it; arrows carry it
    if (this.wasPressed('Space', 'Enter')) {
      if (!this.held) { this.pickUp(); if (this.rx === TRAY[0]) { const g = this.gates()[0]; this.rx = g[0] - 30 * (this.mirrored ? -1 : 1); this.ry = g[1] + 34; } }
      else { this.track(); this.setDown(); return; }
    }
    if (this.held && !this.pointer.down) {
      const sp = this.isDown('ShiftLeft', 'ShiftRight') ? 40 : 110;
      this.rx = clamp(this.rx + this.axisX() * sp * dt, 8, MW - 8);
      this.ry = clamp(this.ry + this.axisY() * sp * dt, 30, MH - 20);
    }
    if (this.held) this.track();
  }

  /** Note how squarely the carried ring passes through the neighbour that is due. */
  private track() {
    if (this.gate >= 2) return;
    const g = this.gates()[this.gate];
    const d = Math.hypot(this.rx - g[0], this.ry - g[1]);
    if (d < this.best[this.gate]) this.best[this.gate] = d;
    // through: it came within reach and has begun to move away again, or sits dead centre
    if (this.best[this.gate] <= this.reach && (d > this.best[this.gate] + 2.5 || d < 1.5)) {
      this.gate++;
      this.env.audio.sfx('place', { volume: 0.35, pitch: this.gate === 1 ? 1.5 : 1.8 });
    }
  }

  private complete() {
    const all = this.slots.map((s) => s.acc ?? 0);
    const accuracy = mean(all);
    const gaps = this.slots.filter((s) => s.loose).length / this.slots.length;
    const consistency = 1 - clamp(stdev(all) * 1.8);
    const score = clamp(accuracy * 0.8 + consistency * 0.2);
    const rows = [1, 2, 3].map((r) => this.slots.filter((s) => s.row === r).map((s) => s.acc ?? 0)).filter((a) => a.length).map(mean);
    const even = Array.from({ length: 8 }, (_, i) => { const f = (i / 7) * (rows.length - 1); const a = Math.floor(f), b = Math.min(rows.length - 1, a + 1); return Math.round((rows[a] + (rows[b] - rows[a]) * (f - a)) * 1000) / 1000; });
    const g = gradeOf(score);
    this.env.audio.sfx('success');
    this.finish({
      score,
      details: { accuracy, consistency, gaps },
      data: { even, gaps: Math.round(gaps * 1000) / 1000 },
      summary: `${g} weave — ${gaps > 0 ? `${Math.round(gaps * this.slots.length)} ring${Math.round(gaps * this.slots.length) === 1 ? '' : 's'} left loose` : accuracy > 0.88 ? 'every ring through its neighbours, the rows lying flat' : accuracy > 0.68 ? 'sound, with a few rings sitting crooked' : 'it holds, but the rows pucker'}.`,
    });
  }

  // ------------------------------------------------------------ draw
  private ring(ctx: CanvasRenderingContext2D, x: number, y: number, tone: number, open = false, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3;
    ctx.strokeStyle = this.pal[1];
    ctx.beginPath(); ctx.ellipse(x, y + 1, RING, RING * 0.72, 0, open ? 0.5 : 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = this.pal[tone];
    ctx.beginPath(); ctx.ellipse(x, y, RING, RING * 0.72, 0, open ? 0.5 : 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.pal[5];
    ctx.beginPath(); ctx.ellipse(x, y - 1, RING, RING * 0.72, 0, Math.PI * 1.1, Math.PI * 1.6); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.3, '#241c18');
    const d = this.drift();
    // the bar the patch hangs from
    ctx.fillStyle = '#4a3624';
    ctx.fillRect(this.first[0][0] - 30 + d, TOP - 22, this.first[this.first.length - 1][0] - this.first[0][0] + 60, 5);
    for (const [x, y] of this.first) {
      ctx.fillStyle = '#6a5038'; ctx.fillRect(Math.round(x + d) - 1, y - 18, 2, 8);
      this.ring(ctx, x + d, y, 3);
    }
    // rings already woven
    this.slots.forEach((s, i) => {
      if (i >= this.cur) return;
      if (s.loose) this.ring(ctx, s.x + d + 5, s.y + 7, 2, true, 0.8);
      else {
        const off = (1 - (s.acc ?? 1)) * 5 * (i % 2 ? 1 : -1);
        this.ring(ctx, s.x + d + off, s.y + Math.abs(off) * 0.5, (s.acc ?? 1) > 0.8 ? 4 : 3);
      }
    });
    // the tray of open rings
    this.panel(18, 190, 78, 44, 'rgba(30,20,16,0.6)', COLORS.panelEdge);
    const left = this.slots.length - this.cur - (this.held ? 1 : 0);
    for (let i = 0; i < Math.min(3, Math.max(0, left)); i++) this.ring(ctx, TRAY[0] + (i - (this.held ? 0.5 : 0)) * 9 - 6, TRAY[1] + i * 2, 2, true, i === 0 && !this.held ? 1 : 0.55);
    if (this.finished || this.cur >= this.slots.length) return;
    // the place, and the two neighbours to pass through
    const [px, py] = this.place();
    const pulse = 0.5 + 0.5 * Math.sin(this.t * 5);
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = this.gate >= 2 ? COLORS.gold : 'rgba(255,244,220,0.45)';
    ctx.lineWidth = this.gate >= 2 ? 2 : 1;
    ctx.beginPath(); ctx.ellipse(px, py, RING, RING * 0.72, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    const flick = this.env.quirk === 'flicker' && Math.sin(this.t * 6.3) > 0.5;
    this.gates().forEach((g, i) => {
      const done = this.gate > i, due = this.gate === i;
      if (flick && !done) return;
      ctx.fillStyle = done ? 'rgba(160,220,140,0.9)' : due ? `rgba(240,200,96,${0.55 + 0.4 * pulse})` : 'rgba(255,244,220,0.3)';
      ctx.beginPath(); ctx.arc(g[0], g[1], due ? 5 : 4, 0, Math.PI * 2); ctx.fill();
      this.text(done ? '✓' : String(i + 1), g[0], g[1] + 3, { size: 8, align: 'center', color: '#1a1210', shadow: false, bold: true });
    });
    // the ring in hand, and the thread of where to go next
    if (this.held) {
      const target = this.gate < 2 ? this.gates()[this.gate] : [px, py];
      ctx.strokeStyle = 'rgba(240,200,96,0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(this.rx, this.ry); ctx.lineTo(target[0], target[1]); ctx.stroke();
      ctx.setLineDash([]);
      this.ring(ctx, this.rx, this.ry, 4, true);
      ctx.fillStyle = '#d8d8e0'; ctx.fillRect(Math.round(this.rx), Math.round(this.ry), 1, 1);
    }
    // cooling: the time left to set this ring cleanly
    this.bar(18, 240, 78, 5, clamp(1 - this.timer / this.budget), this.timer > this.budget ? COLORS.bad : COLORS.ember);
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    this.text('Weaving mail — four in one', MW / 2, 12, { size: 10, align: 'center', color: COLORS.gold });
    const hint = !this.held
      ? (this.touchInput ? 'Press and drag to carry a ring from the tray' : 'Press and drag (or Space, then arrows) to carry a ring from the tray')
      : this.gate === 0 ? 'Through the ring marked 1…'
      : this.gate === 1 ? '…then through the ring marked 2…'
      : (this.touchInput ? '…and let go on the dotted place' : '…and let go (or Space) on the dotted place');
    this.text(hint, MW / 2, 28, { size: 8, align: 'center', color: COLORS.paper });
    const done = this.slots.slice(0, this.cur);
    if (done.length) this.text(`Evenness ${Math.round(mean(done.map((s) => s.acc ?? 0)) * 100)}%`, MW - 12, MH - 14, { size: 10, align: 'right', color: COLORS.paper });
    this.text('Rings', 57, 186, { size: 8, align: 'center', color: COLORS.dim });
  }
}

export const weaveGame: MinigameDef = {
  id: 'weave',
  name: 'Weaving Mail',
  controls: 'Drag a ring from the tray through the rings marked 1 and 2, then let go on the dotted place. Keyboard: Space to take and set, arrows / WASD to carry (Shift = slower).',
  instructions: () => [
    'Mail is woven four-in-one: every ring passes through the two rings above it.',
    'Carry each open ring through the neighbour marked 1, then the one marked 2, and set it on its place to close it.',
    'Pass squarely through the middle of each neighbour and set the ring down before it cools. A ring set down without linking both hangs loose — a hole in the shirt.',
  ],
  create: (env) => new Weave(env),
};
