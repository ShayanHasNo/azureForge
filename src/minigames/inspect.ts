// Final inspection — slow and relaxed, with no timer. The finished piece is
// shown large (blades rotated guard-left, scale 3–4; pan by dragging, or by
// moving the loupe toward an edge). The item's blemishes are already rendered
// on the sprite; the player hovers a magnifying loupe and clicks suspected
// flaws. A click within tolerance of a flaw polishes it away (the sprite is
// re-rendered without it, with a gentle shine and a chime); a click on clean
// metal gives a soft tone and lowers a small "care" measure. Keyboard: arrows
// move the loupe, Space marks, Enter finishes. Finish any time with Enter or
// the "Finish inspection" button.
//
// Blemish positions come from blemishPixel(item, t, u) (the renderer's own
// mapping). A blemish that renders no visible pixels (e.g. it fell on an emblem)
// cannot be seen, so it is excluded from the found-fraction and counted as
// cleaned. Zero visible blemishes → a short "Flawless" state; score 0.95 + 0.05·care.
//
// score = 0.8 · found fraction + 0.2 · care
// data: { found: number[] } — indexes into env.item.blemishes
// details: found, care, wrongMarks

import { clamp } from '../core/util';
import { cloneItem } from '../item/factory';
import type { Blemish, Item } from '../item/types';
import { blemishPixel } from '../render/itemRenderer';
import { BaseMinigame, COLORS, MH, MW } from './base';
import { gradeOf, type MinigameDef, type MinigameEnv } from './types';

type V = [number, number];

// ------------------------------------------------------------ sprite <-> screen
interface Xf { cx: number; cy: number; s: number; rot: boolean; W: number; H: number }
/** Cell-space sprite point (cell (x,y) spans [x,x+1)) → screen. */
function s2scr(xf: Xf, sx: number, sy: number): V {
  const lx = (sx - xf.W / 2) * xf.s, ly = (sy - xf.H / 2) * xf.s;
  return xf.rot ? [xf.cx - ly, xf.cy + lx] : [xf.cx + lx, xf.cy + ly];
}
function scr2s(xf: Xf, x: number, y: number): V {
  const dx = (x - xf.cx) / xf.s, dy = (y - xf.cy) / xf.s;
  return xf.rot ? [xf.W / 2 + dy, xf.H / 2 - dx] : [xf.W / 2 + dx, xf.H / 2 + dy];
}
/** Pixel-cell (integer) sprite coordinate → screen centre of that cell. */
const spriteToScreen = (xf: Xf, x: number, y: number) => s2scr(xf, x + 0.5, y + 0.5);
const screenToSprite = (xf: Xf, X: number, Y: number): V => { const [a, b] = scr2s(xf, X, Y); return [a - 0.5, b - 0.5]; };

function drawXf(ctx: CanvasRenderingContext2D, img: HTMLCanvasElement, xf: Xf) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(Math.round(xf.cx), Math.round(xf.cy));
  if (xf.rot) ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -(xf.W * xf.s) / 2, -(xf.H * xf.s) / 2, xf.W * xf.s, xf.H * xf.s);
  ctx.restore();
}

function pixels(c: HTMLCanvasElement): Uint8ClampedArray | null {
  try { return c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? null; } catch { return null; }
}

/** Centre (cell space) of each blemish mark, matching the renderer's mark shapes. */
function blemishCentre(item: Item, b: Blemish): V {
  const [x, y] = blemishPixel(item, b.t, b.u);
  if (b.kind === 'pit') return [x + 0.5, y + 1];
  if (b.kind === 'scratch') return [x + 1.5, y - 0.5];
  return [x + 1, y + 0.5];
}

const LOUPE_R = 30;

class Inspect extends BaseMinigame {
  private preview: Item;
  private spr: HTMLCanvasElement;
  private xf: Xf;
  private base: V;
  private pan: V = [0, 0];
  private panMax: V = [0, 0];
  private sway: V = [0, 0];
  private loupe: V = [MW / 2, MH / 2];
  private lastP: V = [0, 0];
  private kbHold = 0;
  private press: { at: V; pan: V; moved: number } | null = null;
  private centres: V[] = [];
  private visible: boolean[] = [];
  private found = new Set<number>();
  private wrong = 0;
  private care = 1;
  private carePenalty: number;
  private tol: number;
  private shines: { p: number; life: number }[] = [];
  private flawless: boolean;
  private visibleCount = 0;
  private hintCool = 0;
  private sweep = 0;

  constructor(env: MinigameEnv) {
    super(env);
    const item = env.item;
    this.preview = cloneItem(item);
    this.spr = this.sprite(this.preview);
    const W = this.spr.width, H = this.spr.height;
    const blade = !!item.blade && item.category !== 'shield';
    const s = blade ? (item.category === 'dagger' ? 4 : 3) : 3;
    this.base = [240, 138];
    this.xf = { cx: this.base[0], cy: this.base[1], s, rot: blade, W, H };
    const ex = (blade ? H : W) * s, ey = (blade ? W : H) * s;
    this.panMax = [Math.max(0, (ex - (MW - 24)) / 2), Math.max(0, (ey - (MH - 70)) / 2)];
    this.tol = this.tune(3.2, 1.8) * (env.quirk === 'bursts' ? 1.25 : 1);
    this.carePenalty = this.tune(0.04, 0.08);
    // blemish centres and visibility (does removing it change any pixel?)
    const blems = item.blemishes ?? [];
    const full = pixels(this.spr);
    blems.forEach((b, i) => {
      this.centres.push(blemishCentre(item, b));
      let vis = true;
      if (full) {
        const c = cloneItem(item);
        c.blemishes = blems.filter((_, j) => j !== i);
        const other = pixels(this.sprite(c));
        if (other && other.length === full.length) {
          vis = false;
          for (let k = 0; k < full.length; k++) if (full[k] !== other[k]) { vis = true; break; }
        }
      }
      this.visible.push(vis);
      if (vis) this.visibleCount++;
    });
    this.flawless = this.visibleCount === 0;
    if (this.flawless) {
      this.floatText('Flawless — not a mark to be found', MW / 2, 70, COLORS.gold);
      env.audio.sfx('sparkle');
    }
    const [lx, ly] = s2scr(this.xf, W / 2, H / 2);
    this.loupe = [lx, ly];
    env.onStatus?.(this.statusText());
  }

  private statusText() {
    if (this.flawless) return 'Flawless';
    return this.env.difficulty < 2 ? `Flaws polished ${this.found.size} / ${this.visibleCount}` : `Flaws polished ${this.found.size}`;
  }

  private uiPointer(): V { return [this.mirrored ? MW - this.pointer.x : this.pointer.x, this.pointer.y]; }
  private finishRect() { return { x: MW - 132, y: MH - 40, w: 120, h: 20 }; }
  private overFinish() {
    const [x, y] = this.uiPointer();
    const r = this.finishRect();
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  private applyView() {
    this.xf.cx = Math.round(this.base[0] + this.pan[0] + this.sway[0]);
    this.xf.cy = Math.round(this.base[1] + this.pan[1] + this.sway[1]);
  }

  // ------------------------------------------------------------ update
  protected update(dt: number) {
    this.hintCool = Math.max(0, this.hintCool - dt);
    this.sweep += dt;
    for (const s of this.shines) s.life -= dt * 1.2;
    this.shines = this.shines.filter((s) => s.life > 0);
    if (this.env.quirk === 'drifting' && !this.reducedMotion) this.sway = [Math.sin(this.t * 0.4) * 4, Math.cos(this.t * 0.31) * 3];

    if ((this.pointer.justDown && this.overFinish()) || this.wasPressed('Enter')) { this.complete(); return; }

    const p: V = [this.pointer.x, this.pointer.y];
    const moved = p[0] !== this.lastP[0] || p[1] !== this.lastP[1];
    this.lastP = p;
    // keyboard loupe
    const ax = this.axisX(), ay = this.axisY();
    if (ax || ay) {
      this.kbHold += dt;
      const sp = (70 + 110 * clamp(this.kbHold / 1.2)) * (this.isDown('ShiftLeft', 'ShiftRight') ? 0.4 : 1);
      const n = Math.hypot(ax, ay) || 1;
      this.loupe = [clamp(this.loupe[0] + (ax / n) * sp * dt, 6, MW - 6), clamp(this.loupe[1] + (ay / n) * sp * dt, 30, MH - 30)];
    } else this.kbHold = 0;
    if (moved) this.loupe = [p[0], p[1]];
    // drag to pan / click to mark
    if (this.pointer.justDown && !this.overFinish()) this.press = { at: p, pan: [...this.pan] as V, moved: 0 };
    if (this.press && this.pointer.down) {
      const dx = p[0] - this.press.at[0], dy = p[1] - this.press.at[1];
      this.press.moved = Math.max(this.press.moved, Math.hypot(dx, dy));
      if (this.press.moved > 6) this.pan = [clamp(this.press.pan[0] + dx, -this.panMax[0], this.panMax[0]), clamp(this.press.pan[1] + dy, -this.panMax[1], this.panMax[1])];
    }
    if (this.press && this.pointer.justUp) {
      if (this.press.moved <= 6) this.mark(p);
      this.press = null;
    }
    if (this.wasPressed('Space')) this.mark(this.loupe);
    // edge auto-scroll (not while dragging)
    if (!this.press) {
      const e = 34, sp = 110 * dt;
      const lx = this.loupe[0], ly = this.loupe[1];
      if (lx < e) this.pan[0] = Math.min(this.panMax[0], this.pan[0] + sp);
      if (lx > MW - e) this.pan[0] = Math.max(-this.panMax[0], this.pan[0] - sp);
      if (ly < e + 10) this.pan[1] = Math.min(this.panMax[1], this.pan[1] + sp);
      if (ly > MH - e - 10) this.pan[1] = Math.max(-this.panMax[1], this.pan[1] - sp);
    }
    this.applyView();
  }

  private mark(at: V) {
    if (this.finished) return;
    const [sx, sy] = screenToSprite(this.xf, at[0], at[1]);
    // cell-space point under the click
    const cx = sx + 0.5, cy = sy + 0.5;
    let best = -1, bd = Infinity;
    this.centres.forEach((c, i) => {
      if (!this.visible[i]) return;
      const d = Math.hypot(c[0] - cx, c[1] - cy);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0 && bd <= this.tol) {
      if (this.found.has(best)) {
        if (this.hintCool <= 0) { this.hintCool = 0.6; this.floatText('Already polished', at[0], at[1] - 16, COLORS.dim); }
        return;
      }
      this.found.add(best);
      this.preview = cloneItem(this.env.item);
      this.preview.blemishes = this.env.item.blemishes.filter((_, i) => !this.found.has(i));
      this.spr = this.sprite(this.preview);
      this.shines.push({ p: best, life: 1 });
      const sp = s2scr(this.xf, this.centres[best][0], this.centres[best][1]);
      this.env.audio.sfx('polish', { volume: 0.6 });
      this.env.audio.sfx('chime', { pitch: 0.95 + this.found.size * 0.04 });
      this.spawn(sp[0], sp[1], { n: 10, spread: 50, vy: -16, life: 0.7, color: COLORS.cream, size: 1, g: 10 });
      const kind = this.env.item.blemishes[best]?.kind ?? 'pit';
      this.floatText(kind === 'pit' ? 'Pit filled' : kind === 'scratch' ? 'Scratch smoothed' : 'Scale lifted', sp[0], sp[1] - 18, COLORS.good);
      this.env.onStatus?.(this.statusText());
      if (this.found.size >= this.visibleCount && this.visibleCount > 0) {
        this.floatText('All clear — finish when ready', MW / 2, 60, COLORS.gold);
        this.env.audio.sfx('sparkle');
      }
    } else {
      this.wrong++;
      this.care = clamp(this.care - this.carePenalty);
      this.env.audio.sfx('soft', { volume: 0.6 });
      if (this.hintCool <= 0) { this.hintCool = 0.5; this.floatText('Looks fine here', at[0], at[1] - 16, COLORS.paper); }
    }
  }

  private complete() {
    if (this.finished) return;
    const visFound = [...this.found].filter((i) => this.visible[i]).length;
    const frac = this.visibleCount ? visFound / this.visibleCount : 1;
    const score = this.flawless ? 0.95 + 0.05 * this.care : 0.8 * frac + 0.2 * this.care;
    const found = new Set(this.found);
    this.visible.forEach((v, i) => { if (!v) found.add(i); });
    const foundArr = [...found].sort((a, b) => a - b);
    const missed = this.visibleCount - visFound;
    const g = gradeOf(score);
    this.env.audio.sfx('success');
    this.finish({
      score,
      details: { found: frac, care: this.care, wrongMarks: this.wrong },
      data: { found: foundArr },
      summary: this.flawless
        ? 'Flawless — a careful look found nothing to mend.'
        : `${g} inspection — ${missed === 0 ? 'every flaw found and polished away' : `${visFound} of ${this.visibleCount} flaws polished, ${missed} left as character`}${this.wrong > 3 ? ', with some extra fussing' : ''}.`,
    }, 1.0);
  }

  // ------------------------------------------------------------ draw
  protected draw(ctx: CanvasRenderingContext2D) {
    this.backdrop(0.35, '#2a221e');
    // inspection cloth + lamp pool
    ctx.fillStyle = 'rgba(46,58,52,0.55)';
    ctx.fillRect(10, 36, MW - 20, MH - 72);
    const lamp = ctx.createRadialGradient(MW / 2, 60, 10, MW / 2, 120, 300);
    lamp.addColorStop(0, 'rgba(255,240,200,0.14)');
    lamp.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, MW, MH);
    drawXf(ctx, this.spr, this.xf);
    // polish patches over fixed flaws
    for (const i of this.found) {
      const c = this.centres[i];
      const [x, y] = s2scr(this.xf, c[0], c[1]);
      const sh = this.shines.find((s) => s.p === i);
      const a = sh ? 0.15 + 0.45 * sh.life : 0.1;
      ctx.fillStyle = `rgba(255,250,235,${a})`;
      const r = Math.round(this.xf.s * 1.5);
      ctx.fillRect(Math.round(x) - r, Math.round(y) - r, r * 2, r * 2);
      if (sh) {
        ctx.strokeStyle = `rgba(255,240,200,${sh.life})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, 4 + (1 - sh.life) * 14, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // flawless shimmer sweep
    if (this.flawless) {
      const k = (this.sweep * 0.35) % 1.4 - 0.2;
      const x = 20 + k * (MW - 40);
      const g = ctx.createLinearGradient(x - 30, 0, x + 30, 0);
      g.addColorStop(0, 'rgba(255,250,230,0)');
      g.addColorStop(0.5, 'rgba(255,250,230,0.22)');
      g.addColorStop(1, 'rgba(255,250,230,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 30, 40, 60, MH - 80);
    }
    if (this.env.quirk === 'flicker' && Math.sin(this.t * 3.7) * Math.sin(this.t * 1.3) > 0.6) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(0, 0, MW, MH);
    }
    if (!this.finished) this.drawLoupe(ctx);
  }

  private drawLoupe(ctx: CanvasRenderingContext2D) {
    const [lx, ly] = this.loupe;
    const zoom = 2;
    const xf2: Xf = { ...this.xf, s: this.xf.s * zoom, cx: Math.round(zoom * this.xf.cx - (zoom - 1) * lx), cy: Math.round(zoom * this.xf.cy - (zoom - 1) * ly) };
    ctx.save();
    ctx.beginPath();
    ctx.arc(lx, ly, LOUPE_R, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#1a1612';
    ctx.fillRect(lx - LOUPE_R, ly - LOUPE_R, LOUPE_R * 2, LOUPE_R * 2);
    drawXf(ctx, this.spr, xf2);
    for (const i of this.found) {
      const [x, y] = s2scr(xf2, this.centres[i][0], this.centres[i][1]);
      ctx.fillStyle = 'rgba(255,250,235,0.12)';
      const r = Math.round(xf2.s * 1.5);
      ctx.fillRect(Math.round(x) - r, Math.round(y) - r, r * 2, r * 2);
    }
    // glass sheen
    const g = ctx.createRadialGradient(lx - 10, ly - 12, 2, lx, ly, LOUPE_R);
    g.addColorStop(0, 'rgba(255,255,255,0.16)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.02)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(lx - LOUPE_R, ly - LOUPE_R, LOUPE_R * 2, LOUPE_R * 2);
    ctx.restore();
    // rim + handle
    ctx.strokeStyle = '#a07a4a';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(lx, ly, LOUPE_R + 1, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#5a3e24';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(lx + LOUPE_R * 0.72, ly + LOUPE_R * 0.72); ctx.lineTo(lx + LOUPE_R * 1.25, ly + LOUPE_R * 1.25); ctx.stroke();
    // aim point
    ctx.fillStyle = 'rgba(255,240,200,0.7)';
    ctx.fillRect(Math.round(lx) - 3, Math.round(ly), 2, 1); ctx.fillRect(Math.round(lx) + 2, Math.round(ly), 2, 1);
    ctx.fillRect(Math.round(lx), Math.round(ly) - 3, 1, 2); ctx.fillRect(Math.round(lx), Math.round(ly) + 2, 1, 2);
  }

  protected drawOverlay(ctx: CanvasRenderingContext2D) {
    this.text('Final inspection', MW / 2, 12, { size: 10, align: 'center', color: COLORS.gold });
    this.text('Look closely for pits, scratches and scale • click / Space to polish one • drag or edges to pan', MW / 2, 26, { size: 8, align: 'center', color: COLORS.paper });
    this.text(this.statusText(), 12, MH - 14, { size: 10, color: COLORS.paper });
    this.text(`Care ${Math.round(this.care * 100)}%`, 170, MH - 14, { size: 10, color: this.care > 0.85 ? COLORS.paper : COLORS.ok });
    if (this.finished) return;
    const r = this.finishRect();
    const ready = this.flawless || (this.visibleCount > 0 && this.found.size >= this.visibleCount);
    const glow = ready ? 0.5 + 0.5 * Math.sin(this.t * 4) : 0;
    this.panel(r.x, r.y, r.w, r.h, ready ? `rgba(90,120,60,${0.75 + 0.2 * glow})` : this.overFinish() ? 'rgba(70,50,36,0.9)' : COLORS.panel, ready ? COLORS.good : COLORS.panelEdge);
    this.text('Finish inspection', r.x + r.w / 2, r.y + r.h / 2, { size: 10, align: 'center', color: COLORS.cream });
    void ctx;
  }
}

export const inspectGame: MinigameDef = {
  id: 'inspect',
  name: 'Final Inspection',
  controls: 'Move the loupe (mouse / touch / arrows), click or Space to polish a flaw, drag to pan, Enter or the button to finish.',
  instructions: () => [
    'Take your time — there is no timer.',
    'Look the piece over with the loupe and polish away any pits, scratches or scale you spot.',
    'Marking clean metal costs a little care. Finish whenever you are content.',
  ],
  create: (env) => new Inspect(env),
};
