// Animated item showcase: the static procedural sprite plus presentation-only
// effects (glint sweep, glow motes, gentle float). The sprite itself is untouched.

import { hexToRgb } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { palette } from '../data/options';
import type { Item } from '../item/types';
import { renderItem, View } from '../render/itemRenderer';
import { toCanvas } from '../render/pixel';

export class Showcase {
  canvas = document.createElement('canvas');
  private raf = 0;
  private t = 0;
  private motes: { x: number; y: number; vy: number; life: number }[] = [];
  private sprite!: HTMLCanvasElement;
  private img!: ReturnType<typeof renderItem>;
  private scale = 2;
  constructor(public item: Item, public view: View = 'front', private box: { w: number; h: number } = { w: 360, h: 460 }, private opts: { reducedMotion?: boolean; zoom?: number; background?: boolean } = {}) {
    this.canvas.style.maxWidth = '100%';
    this.canvas.style.maxHeight = '100%';
    this.refresh();
    const loop = (ts: number) => {
      this.t = ts / 1000;
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  setView(v: View) {
    this.view = v;
    this.refresh();
  }
  setItem(item: Item) {
    this.item = item;
    this.refresh();
  }
  setBox(w: number, h: number) {
    this.box = { w, h };
    this.refresh();
  }
  refresh() {
    this.img = renderItem(this.item, this.view);
    this.sprite = toCanvas(this.img);
    const zoom = this.opts.zoom ?? 1;
    this.scale = Math.max(1, Math.floor(Math.min((this.box.w - 20) / this.img.w, (this.box.h - 20) / this.img.h) * zoom));
    this.canvas.width = Math.max(this.box.w, 60);
    this.canvas.height = Math.max(this.box.h, 60);
  }
  private glowColor(): string {
    const f = this.item.finish;
    if (f.finish === 'glow') return f.glowColor ?? palette(this.item.design.palette).glow;
    if (f.finish === 'smoulder') return '#ff7a30';
    if (f.finish === 'moonlit') return '#c8d8ff';
    if (this.item.decoration.constellation) return '#c8b8ff';
    const p = this.item.materials.primary;
    if (hasMat(p) && mat(p).props.magic >= 70) return mat(p).accent ?? '#ffffff';
    return '';
  }
  draw() {
    const c = this.canvas, ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    const rm = this.opts.reducedMotion;
    const bob = rm ? 0 : Math.round(Math.sin(this.t * 1.2) * 2);
    const w = this.img.w * this.scale, h = this.img.h * this.scale;
    const x = Math.round((c.width - w) / 2), y = Math.round((c.height - h) / 2) + bob;
    // soft floor shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(c.width / 2, y + h + 4, w * 0.3, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    const glow = this.glowColor();
    if (glow) {
      const [r, g, b] = hexToRgb(glow);
      const grad = ctx.createRadialGradient(c.width / 2, c.height / 2, 10, c.width / 2, c.height / 2, Math.max(w, h) * 0.6);
      grad.addColorStop(0, `rgba(${r},${g},${b},${0.18 + 0.06 * Math.sin(this.t * 2)})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.drawImage(this.sprite, x, y, w, h);
    // glint sweep across the opaque pixels
    if (!rm) {
      const period = 4.5;
      const k = (this.t % period) / period;
      if (k < 0.35) {
        const pos = (k / 0.35) * (h + w) - w;
        // pixel-stepped glint drawn only where sprite pixels exist
        const step = this.scale;
        for (let py = 0; py < this.img.h; py++) {
          const px = Math.round((pos - py * this.scale * 0.6) / this.scale);
          for (let dx = 0; dx < 2; dx++) {
            const sx = px + dx;
            if (sx < 0 || sx >= this.img.w) continue;
            if (this.img.alpha(sx, py) < 200) continue;
            ctx.fillStyle = 'rgba(255,255,240,0.35)';
            ctx.fillRect(x + sx * step, y + py * step, step, step);
          }
        }
      }
      if (glow) {
        if (Math.random() < 0.25) {
          const b = this.img.bounds();
          this.motes.push({ x: x + (b.x + Math.random() * b.w) * this.scale, y: y + (b.y + Math.random() * b.h) * this.scale, vy: -10 - Math.random() * 20, life: 1 });
        }
        const [r, g, bb] = hexToRgb(glow);
        for (const m of this.motes) {
          m.y += m.vy / 60;
          m.life -= 1 / 90;
          ctx.fillStyle = `rgba(${r},${g},${bb},${Math.max(0, m.life)})`;
          ctx.fillRect(Math.round(m.x), Math.round(m.y), this.scale > 2 ? 3 : 2, this.scale > 2 ? 3 : 2);
        }
        this.motes = this.motes.filter((m) => m.life > 0);
      }
    }
  }
  destroy() {
    cancelAnimationFrame(this.raf);
    this.canvas.remove();
  }
}
