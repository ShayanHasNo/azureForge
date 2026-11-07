// Shared minigame framework: fixed internal resolution, frame loop, unified
// pointer/keyboard/touch input, particles, floating feedback and drawing helpers.

import { clamp } from '../core/util';
import type { Item } from '../item/types';
import type { View } from '../render/itemRenderer';
import type { MinigameEnv, MinigameInstance, MinigameResult } from './types';

export const MW = 480;
export const MH = 270;

export const FONT = '"Pixelify Sans", "Silkscreen", "Courier New", monospace';

export const COLORS = {
  ink: '#2a1e18',
  paper: '#f4e6c8',
  cream: '#fff4dc',
  ember: '#ff8a3c',
  gold: '#f0c860',
  good: '#8fd16a',
  ok: '#e8c35a',
  bad: '#e07a5a',
  cool: '#7ab8e8',
  dim: '#8a7a68',
  panel: 'rgba(30,20,16,0.82)',
  panelEdge: '#6a4a30',
};

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g: number }
interface FloatText { text: string; x: number; y: number; life: number; color: string }

export abstract class BaseMinigame implements MinigameInstance {
  protected ctx: CanvasRenderingContext2D;
  protected t = 0;
  protected pointer = { x: 0, y: 0, down: false, justDown: false, justUp: false, inside: false };
  protected keys = new Set<string>();
  protected pressed = new Set<string>();
  protected particles: Particle[] = [];
  protected floats: FloatText[] = [];
  protected shakeAmt = 0;
  protected finished = false;
  private resolveFn?: (r: MinigameResult) => void;
  private raf = 0;
  private last = 0;
  private cleanup: (() => void)[] = [];
  private finishTimer = 0;
  private pending?: MinigameResult;
  protected readonly mirrored: boolean;

  constructor(protected env: MinigameEnv) {
    const c = env.canvas;
    c.width = MW;
    c.height = MH;
    this.ctx = c.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
    this.mirrored = env.quirk === 'mirrored';
    const toLocal = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width) * MW;
      const y = ((e.clientY - r.top) / r.height) * MH;
      if (this.mirrored) x = MW - x;
      this.pointer.x = x; this.pointer.y = y;
      this.pointer.inside = x >= 0 && y >= 0 && x <= MW && y <= MH;
    };
    const down = (e: PointerEvent) => {
      toLocal(e);
      this.pointer.down = true; this.pointer.justDown = true;
      try { c.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.onPointerDown();
      e.preventDefault();
    };
    const move = (e: PointerEvent) => { toLocal(e); this.onPointerMove(); };
    const up = (e: PointerEvent) => { toLocal(e); if (this.pointer.down) { this.pointer.down = false; this.pointer.justUp = true; this.onPointerUp(); } };
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      this.onKey(e.code, true);
    };
    const ku = (e: KeyboardEvent) => { this.keys.delete(e.code); this.onKey(e.code, false); };
    c.addEventListener('pointerdown', down);
    c.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    c.style.touchAction = 'none';
    this.cleanup.push(() => {
      c.removeEventListener('pointerdown', down);
      c.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    });
  }

  // ------------------------------------------------------------ lifecycle
  start(): Promise<MinigameResult> {
    return new Promise((res) => {
      this.resolveFn = res;
      this.last = performance.now();
      const frame = (ts: number) => {
        const dt = Math.min(0.05, (ts - this.last) / 1000);
        this.last = ts;
        this.t += dt;
        if (!this.finished) this.update(dt);
        this.stepEffects(dt);
        this.render();
        this.pointer.justDown = false; this.pointer.justUp = false; this.pressed.clear();
        if (this.pending) {
          this.finishTimer -= dt;
          if (this.finishTimer <= 0) {
            const r = this.pending; this.pending = undefined;
            this.resolveFn?.(r);
            return;
          }
        }
        this.raf = requestAnimationFrame(frame);
      };
      this.raf = requestAnimationFrame(frame);
    });
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.onDestroy();
  }

  /** Complete the minigame; the result resolves after a short pause so the last frame is visible. */
  protected finish(result: MinigameResult, delay = 0.9) {
    if (this.finished) return;
    this.finished = true;
    result.score = clamp(result.score);
    this.pending = result;
    this.finishTimer = delay;
  }

  protected abstract update(dt: number): void;
  protected abstract draw(ctx: CanvasRenderingContext2D): void;
  protected onPointerDown() {}
  protected onPointerUp() {}
  protected onPointerMove() {}
  protected onKey(_code: string, _down: boolean) {}
  protected onDestroy() {}

  // ------------------------------------------------------------ input helpers
  /** True on the frame the primary action happened (click/tap, Space or Enter). */
  protected action(): boolean {
    return this.pointer.justDown || this.pressed.has('Space') || this.pressed.has('Enter');
  }
  protected holding(): boolean {
    return this.pointer.down || this.keys.has('Space') || this.keys.has('Enter');
  }
  protected wasPressed(...codes: string[]) {
    return codes.some((c) => this.pressed.has(c));
  }
  protected isDown(...codes: string[]) {
    return codes.some((c) => this.keys.has(c));
  }
  /** Horizontal axis from keyboard (-1..1), respecting the mirrored quirk. */
  protected axisX(): number {
    let v = (this.isDown('ArrowRight', 'KeyD') ? 1 : 0) - (this.isDown('ArrowLeft', 'KeyA') ? 1 : 0);
    if (this.mirrored) v = -v;
    return v;
  }
  protected axisY(): number {
    return (this.isDown('ArrowDown', 'KeyS') ? 1 : 0) - (this.isDown('ArrowUp', 'KeyW') ? 1 : 0);
  }

  // ------------------------------------------------------------ difficulty helpers
  /** Lerp a tuning value from beginner (d=0) to master (d=4). */
  protected tune(easy: number, hard: number): number {
    const d = clamp(this.env.difficulty / 4, 0, 1);
    const g = this.env.quirk === 'generous' ? 0.75 : 1;
    return easy + (hard - easy) * d * g;
  }
  protected get reducedMotion() {
    return this.env.settings.reducedMotion;
  }

  // ------------------------------------------------------------ effects
  protected spawn(x: number, y: number, o: Partial<Particle> & { n?: number; spread?: number } = {}) {
    if (this.reducedMotion && (o.n ?? 1) > 3) o.n = 3;
    const n = o.n ?? 1;
    for (let i = 0; i < n; i++) {
      const sp = o.spread ?? 60;
      this.particles.push({
        x, y,
        vx: (o.vx ?? 0) + (Math.random() - 0.5) * sp,
        vy: (o.vy ?? -20) + (Math.random() - 0.5) * sp,
        life: o.life ?? 0.6, max: o.life ?? 0.6,
        color: o.color ?? COLORS.ember, size: o.size ?? 2, g: o.g ?? 80,
      });
    }
  }
  protected sparks(x: number, y: number, n = 12, color = COLORS.ember) {
    this.spawn(x, y, { n, spread: 160, vy: -60, life: 0.5, color, size: 2, g: 260 });
  }
  protected floatText(text: string, x: number, y: number, color: string = COLORS.cream) {
    this.floats.push({ text, x, y, life: 1, color });
  }
  protected shake(a: number) {
    if (!this.reducedMotion) this.shakeAmt = Math.max(this.shakeAmt, a);
  }
  private stepEffects(dt: number) {
    for (const p of this.particles) { p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const f of this.floats) { f.y -= 18 * dt; f.life -= dt * 0.9; }
    this.floats = this.floats.filter((f) => f.life > 0);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 18);
  }

  private render() {
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.shakeAmt > 0) ctx.translate((Math.random() - 0.5) * this.shakeAmt, (Math.random() - 0.5) * this.shakeAmt);
    if (this.mirrored) { ctx.translate(MW, 0); ctx.scale(-1, 1); }
    this.draw(ctx);
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // Text overlays are never mirrored.
    ctx.save();
    for (const f of this.floats) {
      ctx.globalAlpha = clamp(f.life * 1.5);
      const fx = this.mirrored ? MW - f.x : f.x;
      this.text(f.text, fx, f.y, { size: 12, color: f.color, align: 'center', shadow: true });
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    this.drawOverlay(ctx);
  }

  /** Optional HUD drawn after everything, never mirrored. */
  protected drawOverlay(_ctx: CanvasRenderingContext2D) {}

  // ------------------------------------------------------------ drawing helpers
  protected text(s: string, x: number, y: number, o: { size?: number; color?: string; align?: CanvasTextAlign; shadow?: boolean; bold?: boolean } = {}) {
    const ctx = this.ctx;
    ctx.font = `${o.bold ? 'bold ' : ''}${o.size ?? 10}px ${FONT}`;
    ctx.textAlign = o.align ?? 'left';
    ctx.textBaseline = 'middle';
    if (o.shadow !== false) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(s, Math.round(x) + 1, Math.round(y) + 1);
    }
    ctx.fillStyle = o.color ?? COLORS.cream;
    ctx.fillText(s, Math.round(x), Math.round(y));
  }
  protected panel(x: number, y: number, w: number, h: number, fill = COLORS.panel, edge = COLORS.panelEdge) {
    const ctx = this.ctx;
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = edge;
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
  }
  protected bar(x: number, y: number, w: number, h: number, v: number, color: string, back = 'rgba(0,0,0,0.5)') {
    const ctx = this.ctx;
    ctx.fillStyle = back;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.round(w * clamp(v)), h);
  }
  /** Draw an item sprite scaled by an integer, optionally rotated by 90° steps; (x,y) = centre. */
  protected drawSprite(img: HTMLCanvasElement, x: number, y: number, scale: number, quarterTurns = 0) {
    const ctx = this.ctx;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate((quarterTurns * Math.PI) / 2);
    ctx.drawImage(img, -Math.round((img.width * scale) / 2), -Math.round((img.height * scale) / 2), img.width * scale, img.height * scale);
    ctx.restore();
  }
  protected sprite(item: Item = this.env.item, view: View = 'front') {
    return this.env.sprite(item, view);
  }
  /** A warm workshop backdrop with a soft forge glow; `glow` 0..1. */
  protected backdrop(glow = 0.6, tint = '#3a2418') {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, MH);
    g.addColorStop(0, '#1a1210');
    g.addColorStop(1, tint);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, MW, MH);
    const r = ctx.createRadialGradient(MW / 2, MH * 0.9, 10, MW / 2, MH * 0.9, MW * 0.7);
    r.addColorStop(0, `rgba(255,140,60,${0.25 * glow})`);
    r.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, MW, MH);
    // subtle floor line
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, MH - 30, MW, 30);
  }
}
