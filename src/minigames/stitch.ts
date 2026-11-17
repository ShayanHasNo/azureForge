// Row-work: the repeated hand-work of an armourer. One minigame, three modes.
//
//   stitch — quilting a gambeson: a needle runs along each channel; tap as it
//            crosses every chalk mark to take a stitch there.
//   lace   — lacing eyelets or rows of plates: the holes alternate upper and
//            lower; tap the UPPER half of the work (or ↑ / W) for an upper
//            hole and the LOWER half (↓ / S) for a lower one, as the awl
//            reaches it.
//   rivet  — setting rivets: the marks come in groups of three; one clean blow
//            (tap / Space) on each as the hammer passes over it.
//
// The tool moves steadily along each row, turning at the end like a plough
// (boustrophedon). A tap near a mark makes that stitch / hole / rivet; how near
// decides how even it is. A mark passed with no tap is a gap. In lace mode the
// wrong half counts as a poor stitch.
//
// score = 0.8 · mean accuracy (gaps count 0) + 0.2 · consistency
// data: { even[8] (evenness top → bottom), gaps (fraction missed or botched) }
// details: accuracy, consistency, gaps

import { seededRng } from '../core/rng';
import { clamp, hexToRgb, mean, stdev } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

type Mode = 'stitch' | 'lace' | 'rivet';
interface Mark { x: number; up: boolean; acc: number | null; off: number }

const X0 = 46, X1 = 434, TOP = 58, ROW_GAP = 34;

class Stitch extends BaseMinigame {
  private rng = seededRng(this.env.item.seed, 'stitch:' + (this.env.params.mode ?? 'stitch'));
  private mode: Mode;
  private rows: Mark[][] = [];
  private row = 0;
  private pos = 0; // 0..1 along the current row, in the direction of travel
  private speed: number;
  private window: number; // tolerance in px
  private next = 0; // index of the next mark in the current row (in travel order)
  private startDelay = 1;
  private cloth: string[];
  private thread: string[];
  private metal: string[];
  private strike = 0;

  constructor(env: MinigameEnv) {
    super(env);
    const m = String(env.params.mode ?? 'stitch');
    this.mode = m === 'lace' || m === 'rivet' ? m : 'stitch';
    const nRows = 5;
    const per = Math.round(this.tune(6, 8));
    for (let r = 0; r < nRows; r++) {
      const marks: Mark[] = [];
      if (this.mode === 'rivet') {
        // groups of three, with a breath between groups
        const groups = Math.round(per / 3) + 1;
        for (let g = 0; g < groups; g++) for (let k = 0; k < 3; k++) marks.push({ x: (g + 0.5) / groups + (k - 1) * (0.26 / groups), up: false, acc: null, off: 0 });
      } else {
        for (let k = 0; k < per; k++) {
          // a quilter's marks are regular; drifting marks wander a little
          const j = env.quirk === 'drifting' ? this.rng.range(-0.25, 0.25) / per : 0;
          marks.push({ x: (k + 0.5) / per + j, up: k % 2 === 0, acc: null, off: 0 });
        }
      }
      this.rows.push(marks);
    }
    this.speed = this.tune(0.2, 0.34) * (env.quirk === 'bursts' ? 0.9 : 1); // rows per second
    this.window = this.tune(13, 7) * (env.quirk === 'bursts' ? 1.3 : 1);
    const it = env.item;
    const pick = (id: string, fb: string) => (hasMat(id) ? mat(id).palette : mat(fb).palette);
    this.cloth = pick(this.mode === 'rivet' && it.armor?.method !== 'brigandine' ? it.materials.primary : this.mode === 'rivet' ? it.materials.grip : it.materials.primary, 'linen');
    this.thread = pick(it.armor?.method === 'scale' ? it.materials.grip : 'linenthread', 'linenthread');
    this.metal = pick(it.materials.secondary, 'brass');
    this.status();
  }

  private status() {
    const done = this.rows.flat().filter((m) => m.acc !== null).length;
    this.env.onStatus?.(`${this.mode === 'rivet' ? 'Rivets' : this.mode === 'lace' ? 'Holes' : 'Stitches'} ${done} / ${this.rows.flat().length}`);
  }

  /** Marks of the current row in the order the tool meets them. */
  private order(r = this.row): Mark[] {
    const ms = this.rows[r];
    return r % 2 === 0 ? ms : [...ms].reverse();
  }
  private toolX(): number {
    const p = this.row % 2 === 0 ? this.pos : 1 - this.pos;
    return X0 + p * (X1 - X0);
  }
  private markX(m: Mark) { return X0 + m.x * (X1 - X0); }
  private rowY(r: number) { return TOP + r * ROW_GAP; }

  private tap(up: boolean | null) {
    if (this.finished || this.t < this.startDelay) return;
    const ms = this.order();
    const m = ms[this.next];
    if (!m) return;
    const d = Math.abs(this.toolX() - this.markX(m));
    if (d > this.window * 2.4) { this.floatText('Not yet', this.fx(this.toolX()), this.rowY(this.row) - 16, COLORS.dim); return; }
    let acc = d <= this.window * 0.35 ? 1 : d <= this.window ? 1 - ((d - this.window * 0.35) / (this.window * 0.65)) * 0.3 : Math.max(0, 0.7 - ((d - this.window) / (this.window * 1.4)) * 0.7);
    const wrong = this.mode === 'lace' && up !== null && up !== m.up;
    if (wrong) acc *= 0.3;
    m.acc = acc;
    m.off = (this.toolX() - this.markX(m)) * (this.row % 2 === 0 ? 1 : -1);
    this.next++;
    this.strike = 1;
    const x = this.fx(this.markX(m)), y = this.rowY(this.row);
    if (wrong) { this.floatText('Wrong side', x, y - 16, COLORS.bad); this.env.audio.sfx('soft'); }
    else if (acc > 0.92) { this.env.audio.sfx(this.mode === 'rivet' ? 'hammerPerfect' : 'snap', { pitch: this.mode === 'rivet' ? 1.5 : 1.2, volume: 0.6 }); if (this.mode === 'rivet') this.sparks(this.markX(m), y, 5, COLORS.gold); }
    else if (acc > 0.55) this.env.audio.sfx(this.mode === 'rivet' ? 'hammer' : 'place', { volume: 0.5, pitch: 1.3 });
    else { this.floatText(m.off < 0 ? 'Early' : 'Late', x, y - 16, COLORS.ok); this.env.audio.sfx('soft', { volume: 0.5 }); }
    this.status();
  }
  private fx(x: number) { return this.mirrored ? MW - x : x; }

  protected update(dt: number) {
    this.strike = Math.max(0, this.strike - dt * 5);
    if (this.finished || this.t < this.startDelay) return;
    let sp = this.speed;
    if (this.env.quirk === 'bursts') sp *= 1 + 0.3 * Math.sin(this.t * 1.7);
    this.pos += sp * dt;
    // marks the tool has gone past untouched are gaps
    const ms = this.order();
    while (this.next < ms.length) {
      const m = ms[this.next];
      const past = (this.toolX() - this.markX(m)) * (this.row % 2 === 0 ? 1 : -1);
      if (past <= this.window * 2.4) break;
      m.acc = 0; m.off = 0;
      this.next++;
      this.floatText(this.mode === 'rivet' ? 'Missed' : 'Skipped', this.fx(this.markX(m)), this.rowY(this.row) - 16, COLORS.dim);
      this.status();
    }
    if (this.pos >= 1) {
      for (; this.next < ms.length; this.next++) { ms[this.next].acc = 0; }
      this.row++;
      this.pos = 0;
      this.next = 0;
      if (this.row >= this.rows.length) { this.complete(); return; }
      this.env.audio.sfx('page', { volume: 0.3 });
    }
    // input
    if (this.mode === 'lace') {
      if (this.wasPressed('ArrowUp', 'KeyW')) this.tap(true);
      else if (this.wasPressed('ArrowDown', 'KeyS')) this.tap(false);
      else if (this.wasPressed('Space', 'Enter')) this.tap(null);
      else if (this.pointer.justDown) this.tap(this.pointer.y < this.rowY(this.row));
    } else if (this.action()) this.tap(null);
  }

  private complete() {
    const all = this.rows.flat().map((m) => m.acc ?? 0);
    const accuracy = mean(all);
    const gaps = all.filter((a) => a < 0.2).length / all.length;
    const consistency = 1 - clamp(stdev(all) * 1.8);
    const score = clamp(accuracy * 0.8 + consistency * 0.2);
    // five worked rows spread over the eight bands of the garment
    const perRow = this.rows.map((r) => mean(r.map((m) => m.acc ?? 0)));
    const even = Array.from({ length: 8 }, (_, i) => { const f = (i / 7) * (perRow.length - 1); const a = Math.floor(f), b = Math.min(perRow.length - 1, a + 1); return Math.round((perRow[a] + (perRow[b] - perRow[a]) * (f - a)) * 1000) / 1000; });
    const g = gradeOf(score);
    const what = this.mode === 'rivet' ? 'rivets' : this.mode === 'lace' ? 'lacing' : 'stitching';
    this.env.audio.sfx('success');
    this.finish({
      score,
      details: { accuracy, consistency, gaps },
      data: { even, gaps: Math.round(gaps * 1000) / 1000 },
      summary: `${g} ${what} — ${gaps > 0.15 ? `${Math.round(gaps * all.length)} ${this.mode === 'rivet' ? 'rivets missed' : 'places skipped'}` : accuracy > 0.88 ? 'close, even and regular' : accuracy > 0.68 ? 'sound, a little uneven' : 'it wanders'}.`,
    });
  }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.3, '#2a2018');
    // the work: a panel of cloth (or leather, or plates under cloth)
    const [cr, cg, cb] = hexToRgb(this.cloth[3]);
    ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
    ctx.fillRect(X0 - 22, TOP - 26, X1 - X0 + 44, ROW_GAP * this.rows.length + 22);
    ctx.fillStyle = this.cloth[2];
    for (let y = TOP - 26; y < TOP - 26 + ROW_GAP * this.rows.length + 22; y += 4) ctx.fillRect(X0 - 22, y, X1 - X0 + 44, 1);
    ctx.fillStyle = this.cloth[4];
    ctx.fillRect(X0 - 22, TOP - 26, X1 - X0 + 44, 2);
    this.rows.forEach((ms, r) => {
      const y = this.rowY(r);
      // quilted channels puff up between the rows
      if (this.mode === 'stitch') { ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(X0 - 18, y + 6, X1 - X0 + 36, ROW_GAP - 14); }
      if (this.mode === 'rivet') { ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; ctx.strokeRect(X0 - 14.5, y - 13.5, X1 - X0 + 29, 27); }
      for (const m of ms) {
        const x = this.markX(m);
        const my = this.mode === 'lace' ? y + (m.up ? -7 : 7) : y;
        if (m.acc === null) {
          // chalk mark still to do
          const flick = this.env.quirk === 'flicker' && Math.sin(this.t * 6.7) > 0.55;
          if (!flick) { ctx.fillStyle = r === this.row ? 'rgba(255,244,220,0.85)' : 'rgba(255,244,220,0.35)'; ctx.fillRect(Math.round(x) - 1, Math.round(my) - 3, 2, 6); }
        } else if (m.acc < 0.2) {
          ctx.fillStyle = 'rgba(0,0,0,0.3)';
          ctx.fillRect(Math.round(x) - 2, Math.round(my) - 1, 4, 2);
        } else if (this.mode === 'rivet') {
          const px = Math.round(x + m.off * 0.7);
          ctx.fillStyle = this.metal[1]; ctx.fillRect(px - 3, Math.round(my) - 2, 6, 6);
          ctx.fillStyle = this.metal[m.acc > 0.8 ? 4 : 3]; ctx.fillRect(px - 3, Math.round(my) - 3, 5, 5);
          ctx.fillStyle = this.metal[5]; ctx.fillRect(px - 2, Math.round(my) - 2, 2, 2);
        } else {
          // a stitch: neat ones are short and level, poor ones long and slanted
          const len = 7 + (1 - m.acc) * 6, slant = (1 - m.acc) * 4 * (m.off < 0 ? -1 : 1);
          ctx.strokeStyle = this.thread[m.acc > 0.8 ? 5 : 4];
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x + m.off * 0.7 - len / 2, my - slant / 2); ctx.lineTo(x + m.off * 0.7 + len / 2, my + slant / 2); ctx.stroke();
          if (this.mode === 'lace') { ctx.fillStyle = this.metal[3]; ctx.fillRect(Math.round(x) - 2, Math.round(my) - 2, 4, 4); ctx.fillStyle = '#1a1210'; ctx.fillRect(Math.round(x) - 1, Math.round(my) - 1, 2, 2); }
        }
      }
    });
    if (this.finished || this.row >= this.rows.length) return;
    // the tool
    const x = this.toolX(), y = this.rowY(this.row);
    const lift = this.strike > 0 ? 0 : 4;
    if (this.mode === 'rivet') {
      ctx.fillStyle = '#6a4a2a'; ctx.fillRect(Math.round(x) + 5, y - 34 - lift, 3, 24);
      ctx.fillStyle = '#5a5a66'; ctx.fillRect(Math.round(x) - 6, y - 14 - lift, 16, 8);
      ctx.fillStyle = '#8a8a96'; ctx.fillRect(Math.round(x) - 6, y - 14 - lift, 16, 2);
    } else {
      ctx.strokeStyle = '#d8d8e0'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y - 2 + (this.strike > 0 ? 2 : 0)); ctx.lineTo(x + (this.row % 2 === 0 ? -9 : 9), y - 18 - lift); ctx.stroke();
      ctx.strokeStyle = this.thread[4];
      ctx.beginPath(); ctx.moveTo(x + (this.row % 2 === 0 ? -9 : 9), y - 18 - lift); ctx.quadraticCurveTo(x + (this.row % 2 === 0 ? -30 : 30), y - 30, x + (this.row % 2 === 0 ? -44 : 44), y - 8); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(240,200,96,0.5)';
    ctx.fillRect(Math.round(x), y - 12, 1, 24);
  }

  protected drawOverlay(_ctx: CanvasRenderingContext2D) {
    const title = this.mode === 'rivet' ? 'Riveting' : this.mode === 'lace' ? 'Lacing' : 'Quilting';
    this.text(title, MW / 2, 12, { size: 10, align: 'center', color: COLORS.gold });
    const hint = this.t < this.startDelay ? 'Ready…'
      : this.mode === 'lace' ? (this.touchInput ? 'Tap above the row for an upper hole, below it for a lower one, as the awl arrives' : 'As the awl reaches a hole: ↑ (or click above the row) for an upper hole, ↓ (below) for a lower one')
      : this.mode === 'rivet' ? (this.touchInput ? 'Tap as the hammer passes over each mark — three to a group' : 'Click / Space as the hammer passes over each mark — three to a group')
      : (this.touchInput ? 'Tap as the needle crosses each chalk mark' : 'Click / Space as the needle crosses each chalk mark');
    this.text(hint, MW / 2, 28, { size: 8, align: 'center', color: COLORS.paper });
    const done = this.rows.flat().filter((m) => m.acc !== null);
    if (done.length) this.text(`Evenness ${Math.round(mean(done.map((m) => m.acc ?? 0)) * 100)}%`, 12, MH - 14, { size: 10, color: COLORS.paper });
    this.text(`Row ${Math.min(this.row + 1, this.rows.length)} / ${this.rows.length}`, MW - 12, MH - 14, { size: 10, align: 'right', color: COLORS.paper });
  }
}

export const stitchGame: MinigameDef = {
  id: 'stitch',
  name: 'Row-work',
  controls: 'Click / tap / Space as the tool crosses each mark. Lacing: ↑ / ↓ (or tap above / below the row) for upper and lower holes.',
  instructions: (env) => {
    const m = env.params?.mode;
    return m === 'lace' ? [
      'The awl travels along each row, turning at the end like a plough.',
      'The holes alternate: upper, lower, upper, lower. Make each one as the awl reaches it — on the right side.',
      'A hole on the wrong side, or far off its mark, pulls the lacing crooked.',
    ] : m === 'rivet' ? [
      'The hammer travels along each row. The rivets sit in groups of three.',
      'One clean blow on each mark as the hammer passes over it. A mark passed by is a rivet left proud.',
    ] : [
      'The needle travels along each channel, turning at the end like a plough.',
      'Take a stitch at every chalk mark. Even stitches hold the padding where you laid it; a skipped mark lets it shift.',
    ];
  },
  create: (env) => new Stitch(env),
};
