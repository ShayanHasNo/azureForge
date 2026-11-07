// The Quiet Forge — the animated workshop home scene.
//
// Internal resolution 320x180, composed on an offscreen canvas and scaled to
// the host canvas with nearest-neighbour (integer scale where possible).
// Static art is cached (see background.ts); fire, weather, lighting, ambient
// life and the smith are drawn per frame.

import { noise2, valueNoise } from '../core/rng';
import { clamp, hexToRgb, mixHex } from '../core/util';
import type { Item } from '../item/types';
import { BgInput, bgKey, BgResult, buildBackground } from './background';
import { ANVIL_BASE_Y, CEIL, FLOOR_Y, H, STATION_LABELS, StationDef, StationId, W, WALK_X0, WALK_X1, WALK_Y0, WALK_Y1 } from './layout';
import { OutsideView, Phase, Season, Weather } from './outside';
import { playerFrames, SPRITE_H, SPRITE_W } from './player';
import { BRASS, C2D, disc, ellipse, H as HL, IRON, L, makeCanvas, P, R, rgba, V } from './px';
import { windowGeo } from './layout';

export type { StationId } from './layout';
export { STATION_LABELS } from './layout';

export interface WorkshopViewState {
  decor: { wall: string; floor: string; lighting: string; window: string; forge: string; shelves: string };
  /** owned + enabled extras */
  extras: string[];
  /** owned upgrades */
  upgrades: string[];
  /** items on the display rack (up to capacity) */
  displayItems: Item[];
  phase: 'morning' | 'afternoon' | 'evening' | 'night';
  weather: 'clear' | 'cloudy' | 'rain' | 'snow';
  season: 'Spring' | 'Summer' | 'Autumn' | 'Winter';
  materialCount: number;
  bannerColor?: string;
  forgeLit: boolean;
}

export interface WorkshopSceneOptions {
  onInteract: (s: StationId) => void;
  onStep?: () => void;
  reducedMotion?: () => boolean;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; s: number }
interface Light { x: number; y: number; r: number; col: string; a: number; punch: number }

const FONT = '"Pixelify Sans", monospace';
const FONT_PX = 8;
const SPEED = 54; // px / s
const LETTERBOX = '#150d09';

const AMBIENT: Record<Phase, { col: string; a: number }> = {
  morning: { col: '#2a1630', a: 0.2 },
  afternoon: { col: '#1e1428', a: 0.1 },
  evening: { col: '#24102a', a: 0.5 },
  night: { col: '#060818', a: 0.76 },
};

const FLAME = ['#d8401a', '#ff8a28', '#ffd050', '#fff4c0'];

export class WorkshopScene {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private oc: C2D;
  private dark: HTMLCanvasElement;
  private dc: C2D;
  private fireCv: HTMLCanvasElement;
  private fc: C2D;
  private fireImg: ImageData;
  private outside = new OutsideView(windowGeo('small'));
  private bg: BgResult | null = null;
  private bgK = '';

  private raf = 0;
  private running = false;
  private destroyed = false;
  private last = 0;
  private t = 0;
  private ro?: ResizeObserver;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private sizeDirty = true;

  // the smith
  private px = 150;
  private py = 150;
  private face = 0; // 0 right, 1 left
  private walkT = 0;
  private walkFrame = 0;
  private moving = false;
  private keys = new Set<string>();
  private target: { x: number; y: number; station?: StationId } | null = null;
  private near: StationId | null = null;
  private hover: StationId | null = null;
  private inputOn = true;

  // ambient life
  private embers: Particle[] = [];
  private smoke: Particle[] = [];
  private dust: Particle[] = [];
  private emberAcc = 0;
  private smokeAcc = 0;
  private flick = 1;
  private catFlick = -10;
  private nextCatFlick = 5;
  private catEar = -10;
  private state: WorkshopViewState | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private getState: () => WorkshopViewState,
    private opts: WorkshopSceneOptions,
  ) {
    this.ctx = canvas.getContext('2d')!;
    [this.off, this.oc] = makeCanvas(W, H);
    [this.dark, this.dc] = makeCanvas(W, H);
    [this.fireCv, this.fc] = makeCanvas(23, 20);
    this.fireImg = this.fc.createImageData(23, 20);
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(() => { this.sizeDirty = true; });
      this.ro.observe(canvas);
    }
    window.addEventListener('resize', this.onResize);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.style.touchAction = 'none';
    canvas.style.imageRendering = 'pixelated';
    // repaint labels once the pixel font arrives
    try { (document as any).fonts?.load?.(`8px ${FONT}`); } catch { /* ignore */ }
  }

  // ------------------------------------------------------------ lifecycle
  start(): void {
    if (this.running || this.destroyed) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.keys.clear();
  }

  destroy(): void {
    this.stop();
    this.destroyed = true;
    this.ro?.disconnect();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.style.cursor = '';
  }

  setInputEnabled(on: boolean): void {
    this.inputOn = on;
    if (!on) {
      this.keys.clear();
      this.target = null;
      this.hover = null;
      this.canvas.style.cursor = '';
    }
  }

  // ------------------------------------------------------------ input
  private onResize = () => { this.sizeDirty = true; };
  private onBlur = () => { this.keys.clear(); };

  private isEditable(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || tag === 'A' || el.isContentEditable;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.running || !this.inputOn || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement | null)?.isContentEditable) return;
    if (k === 'arrowleft' || k === 'arrowright' || k === 'arrowup' || k === 'arrowdown' || k === 'a' || k === 'd' || k === 'w' || k === 's') {
      this.keys.add(k);
      this.target = null;
      if (k.startsWith('arrow')) e.preventDefault();
      return;
    }
    if (k === 'e' || k === 'enter' || k === ' ' || k === 'spacebar') {
      if (this.isEditable(e.target) && k !== 'e') return;
      if (e.repeat) return;
      if (this.near) {
        e.preventDefault();
        this.interact(this.near);
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };

  private toInternal(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const sx = this.canvas.width / Math.max(1, r.width), sy = this.canvas.height / Math.max(1, r.height);
    const bx = (e.clientX - r.left) * sx, by = (e.clientY - r.top) * sy;
    return [(bx - this.ox) / this.scale, (by - this.oy) / this.scale];
  }

  private hitStation(x: number, y: number): StationDef | null {
    if (!this.bg) return null;
    let best: StationDef | null = null, area = 1e9;
    for (const s of this.bg.stations) {
      const h = s.hit;
      if (x >= h.x && x < h.x + h.w && y >= h.y && y < h.y + h.h) {
        const a = h.w * h.h;
        if (a < area) { area = a; best = s; }
      }
    }
    return best;
  }

  private onPointerMove = (e: PointerEvent) => {
    if (!this.inputOn) return;
    const [x, y] = this.toInternal(e);
    const s = x >= 0 && y >= 0 && x < W && y < H ? this.hitStation(x, y) : null;
    this.hover = s ? s.id : null;
    this.canvas.style.cursor = s ? 'pointer' : '';
  };

  private onPointerLeave = () => { this.hover = null; this.canvas.style.cursor = ''; };

  private onPointerDown = (e: PointerEvent) => {
    if (!this.inputOn || !this.running) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const [x, y] = this.toInternal(e);
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    e.preventDefault();
    const s = this.hitStation(x, y);
    if (s) {
      if (Math.abs(this.px - s.ix) < 3 && Math.abs(this.py - s.iy) < 6) { this.interact(s.id); return; }
      this.target = { x: s.ix, y: s.iy, station: s.id };
    } else {
      this.target = { x: clamp(x, WALK_X0, WALK_X1), y: y >= FLOOR_Y ? clamp(y, WALK_Y0, WALK_Y1) : this.py };
    }
  };

  private interact(id: StationId) {
    this.target = null;
    try { this.opts.onInteract(id); } catch (err) { console.error(err); }
  }

  private reduced(): boolean {
    try { return !!this.opts.reducedMotion?.(); } catch { return false; }
  }

  // ------------------------------------------------------------ frame
  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.t += dt;
    let st: WorkshopViewState;
    try { st = this.getState(); } catch (err) { console.error(err); return; }
    this.state = st;
    if (this.sizeDirty) this.applySize();
    this.ensureBg(st);
    const reduced = this.reduced();
    this.update(dt, st, reduced);
    this.render(st, reduced);
    this.blit();
  };

  private applySize() {
    this.sizeDirty = false;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
  }

  private ensureBg(st: WorkshopViewState) {
    const input: BgInput = {
      decor: st.decor,
      extras: new Set(st.extras),
      upgrades: new Set(st.upgrades),
      displayItems: st.displayItems || [],
      season: st.season,
      materialCount: st.materialCount || 0,
      bannerColor: st.bannerColor || '#8a2a2a',
    };
    const key = bgKey(input);
    if (key === this.bgK && this.bg) return;
    this.bgK = key;
    this.bg = buildBackground(input);
    this.outside.setGeo(this.bg.win);
    this.fireImg = this.fc.createImageData(this.bg.mouth.w, this.bg.mouth.h);
    this.fireCv.width = this.bg.mouth.w; this.fireCv.height = this.bg.mouth.h;
  }

  // ------------------------------------------------------------ update
  private update(dt: number, st: WorkshopViewState, reduced: boolean) {
    const bg = this.bg!;
    // movement
    let dx = 0, dy = 0;
    if (this.inputOn) {
      if (this.keys.has('arrowleft') || this.keys.has('a')) dx -= 1;
      if (this.keys.has('arrowright') || this.keys.has('d')) dx += 1;
      if (this.keys.has('arrowup') || this.keys.has('w')) dy -= 1;
      if (this.keys.has('arrowdown') || this.keys.has('s')) dy += 1;
    }
    let moving = false;
    if (dx || dy) {
      const len = Math.hypot(dx, dy * 0.6) || 1;
      this.px += (dx / len) * SPEED * dt;
      this.py += ((dy * 0.6) / len) * SPEED * dt;
      moving = true;
      if (dx) this.face = dx > 0 ? 0 : 1;
    } else if (this.target) {
      const tx = this.target.x - this.px, ty = this.target.y - this.py;
      const d = Math.hypot(tx, ty);
      const step = SPEED * dt;
      if (d <= step || d < 0.5) {
        this.px = this.target.x; this.py = this.target.y;
        const s = this.target.station;
        this.target = null;
        if (s) {
          // face the station's centre
          const def = bg.stations.find((q) => q.id === s);
          if (def) { const c = def.hit.x + def.hit.w / 2; if (Math.abs(c - this.px) > 2) this.face = c > this.px ? 0 : 1; }
          this.interact(s);
        }
      } else {
        this.px += (tx / d) * step; this.py += (ty / d) * step;
        moving = true;
        if (Math.abs(tx) > 0.5) this.face = tx > 0 ? 0 : 1;
      }
    }
    this.px = clamp(this.px, WALK_X0, WALK_X1);
    this.py = clamp(this.py, WALK_Y0, WALK_Y1);
    if (moving) {
      const prev = this.walkFrame;
      this.walkT += dt * 8.5;
      this.walkFrame = Math.floor(this.walkT) % 4;
      if (this.walkFrame !== prev && (this.walkFrame === 0 || this.walkFrame === 2)) {
        try { this.opts.onStep?.(); } catch { /* ignore */ }
      }
    } else {
      this.walkT = 0; this.walkFrame = 0;
    }
    this.moving = moving;

    // nearest station
    let best: StationId | null = null, bd = 17;
    for (const s of bg.stations) {
      const d = Math.abs(this.px - s.ix) + Math.max(0, Math.abs(this.py - s.iy) - 14) * 0.5;
      if (d < bd) { bd = d; best = s.id; }
    }
    this.near = best;

    // forge flicker
    this.flick = reduced ? 1 : 0.92 + 0.05 * Math.sin(this.t * 11.3) + 0.04 * Math.sin(this.t * 6.7 + 1.3) + 0.03 * (valueNoise(3, this.t * 6, 0) - 0.5);
    if (!st.forgeLit) this.flick = reduced ? 1 : 0.97 + 0.03 * Math.sin(this.t * 2.1);

    // embers
    const m = bg.mouth;
    if (st.forgeLit) {
      this.emberAcc += dt * (reduced ? 3 : 11);
      while (this.emberAcc > 1) {
        this.emberAcc -= 1;
        if (this.embers.length > 60) break;
        this.embers.push({ x: m.x + 4 + Math.random() * (m.w - 8), y: m.y + 5 + Math.random() * 4, vx: (Math.random() - 0.5) * 10, vy: -(12 + Math.random() * 22), life: 0, max: 1.2 + Math.random() * 2.2, s: Math.random() * 6.28 });
      }
    }
    for (const p of this.embers) {
      p.life += dt;
      p.vy -= 3 * dt;
      p.vx += Math.sin(this.t * 3 + p.s) * 14 * dt;
      p.vx *= 1 - dt * 0.8;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.embers = this.embers.filter((p) => p.life < p.max && p.y > 2);

    // smoke
    this.smokeAcc += dt * (st.forgeLit ? (reduced ? 1.2 : 3) : 0.6);
    while (this.smokeAcc > 1) {
      this.smokeAcc -= 1;
      if (this.smoke.length > 24) break;
      this.smoke.push({ x: 91 + (Math.random() - 0.5) * 10, y: m.y + 2, vx: (Math.random() - 0.5) * 3, vy: -(5 + Math.random() * 5), life: 0, max: 3 + Math.random() * 2, s: Math.random() * 6.28 });
    }
    for (const p of this.smoke) {
      p.life += dt;
      p.x += (p.vx + Math.sin(this.t * 0.9 + p.s) * 2) * dt;
      p.y += p.vy * dt;
    }
    this.smoke = this.smoke.filter((p) => p.life < p.max);

    // dust motes
    const want = reduced ? 8 : 26;
    while (this.dust.length < want) this.dust.push(this.spawnDust(true));
    for (const p of this.dust) {
      p.life += dt;
      p.x += (p.vx + Math.sin(this.t * 0.5 + p.s) * 1.5) * dt;
      p.y += (p.vy + Math.cos(this.t * 0.4 + p.s) * 1.0) * dt;
      if (p.life > p.max) Object.assign(p, this.spawnDust(false));
    }

    // cat
    if (this.t > this.nextCatFlick) {
      this.catFlick = this.t;
      this.nextCatFlick = this.t + 5 + Math.random() * 7;
      if (Math.random() < 0.35) this.catEar = this.t + 0.6;
    }
  }

  private spawnDust(initial: boolean): Particle {
    const g = this.bg?.win;
    const cx = g ? g.cx : 170;
    const p: Particle = {
      x: cx - 30 + Math.random() * 70, y: (g ? g.y + g.h : 80) + Math.random() * 70,
      vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 1.6 + 0.4,
      life: initial ? Math.random() * 6 : 0, max: 5 + Math.random() * 6, s: Math.random() * 6.28,
    };
    return p;
  }

  // ------------------------------------------------------------ render
  private render(st: WorkshopViewState, reduced: boolean) {
    const c = this.oc, bg = this.bg!, t = this.t;
    const phase = st.phase, weather = st.weather;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.imageSmoothingEnabled = false;

    // 1. the world outside, then the static room over it
    this.outside.draw(c, t, phase, weather, st.season as Season, reduced);
    c.drawImage(bg.bg, 0, 0);

    // 2. non-emissive animated props
    this.drawDoorPane(c, phase);
    if (bg.clock) this.drawClock(c, bg.clock.x, bg.clock.y, phase, reduced);
    if (bg.chimes) this.drawChimes(c, bg.chimes.x, bg.chimes.y, reduced);
    if (bg.wheel) this.drawWheel(c, bg.wheel.x, bg.wheel.y, bg.wheel.r, reduced);
    if (bg.cat) this.drawCat(c, bg.cat.x, bg.cat.y, reduced);
    this.drawSmoke(c);

    // 3. depth-sorted: anvil layer vs smith
    this.drawPlayerShadow(c, st);
    const playerBehind = this.py < ANVIL_BASE_Y;
    if (!playerBehind) c.drawImage(bg.front, 0, 0);
    this.drawPlayer(c);
    if (playerBehind) c.drawImage(bg.front, 0, 0);

    // 4. lighting
    const night = this.darkness(phase, weather);
    const lights = this.collectLights(st, night);
    this.drawLighting(c, st, night, lights);

    // 5. emissive things on top of the darkness
    this.drawFire(c, st, reduced);
    this.drawEmissive(c, st, night, reduced);
    this.drawEmbers(c);
    this.drawDust(c, st, night);

    // 6. highlight + labels
    this.drawHighlights(c);
  }

  private darkness(phase: Phase, weather: Weather): number {
    let a = AMBIENT[phase].a;
    if (weather === 'cloudy') a += 0.06;
    if (weather === 'rain') a += 0.1;
    if (weather === 'snow') a += 0.04;
    return clamp(a, 0, 0.88);
  }

  private collectLights(st: WorkshopViewState, night: number): Light[] {
    const bg = this.bg!, L: Light[] = [];
    const f = this.flick;
    const m = bg.mouth;
    const fx = m.x + m.w / 2, fy = m.y + m.h * 0.55;
    if (st.forgeLit) {
      L.push({ x: fx, y: fy, r: 92 * f, col: '#ff8a38', a: 0.2 + night * 0.32, punch: 0.95 });
      L.push({ x: fx, y: fy + 2, r: 30 * f, col: '#ffb050', a: 0.18 + night * 0.25, punch: 1 });
    } else {
      L.push({ x: fx, y: m.y + m.h - 2, r: 26 * f, col: '#c84a20', a: 0.15 + night * 0.15, punch: 0.6 });
    }
    const g = bg.win;
    const winCol = st.phase === 'morning' ? '#ffe2a8' : st.phase === 'afternoon' ? '#eaf4ff' : st.phase === 'evening' ? '#ffb07a' : '#8a9ae0';
    const wr = st.phase === 'night' ? 28 : st.phase === 'evening' ? 46 : 62;
    const wd = st.weather === 'clear' ? 1 : 0.6;
    L.push({ x: g.cx, y: g.cy + 6, r: wr, col: winCol, a: (st.phase === 'night' ? 0.08 : 0.16) * wd, punch: (st.phase === 'night' ? 0.35 : 0.85) * wd });
    for (const lp of bg.lamps) {
      const fl = this.flick * (0.96 + 0.04 * Math.sin(this.t * 9 + lp.x));
      switch (lp.kind) {
        case 'candle': L.push({ x: lp.x, y: lp.y, r: 20 * fl, col: '#ffb860', a: 0.08 + night * 0.18, punch: 0.85 }); break;
        case 'lantern': L.push({ x: lp.x, y: lp.y, r: 40 * fl, col: '#ffc070', a: 0.1 + night * 0.22, punch: 0.9 }); break;
        case 'chandelier': L.push({ x: lp.x, y: lp.y + 4, r: 26 * fl, col: '#ffc070', a: 0.06 + night * 0.12, punch: 0.8 }); break;
        case 'jar': L.push({ x: lp.x, y: lp.y, r: 22 + Math.sin(this.t * 1.3 + lp.x) * 2, col: '#d8ff90', a: 0.08 + night * 0.16, punch: 0.75 }); break;
        case 'crystal': L.push({ x: lp.x, y: lp.y, r: 30 + Math.sin(this.t * 0.9 + lp.x) * 2, col: '#70ffa8', a: 0.08 + night * 0.18, punch: 0.85 }); break;
      }
    }
    if (st.decor.lighting === 'chandelier') L.push({ x: 190, y: 30, r: 96, col: '#ffc878', a: 0.06 + night * 0.12, punch: 0.75 });
    L.push({ x: bg.journalCandle.x, y: bg.journalCandle.y, r: 22 * this.flick, col: '#ffb860', a: 0.08 + night * 0.18, punch: 0.85 });
    const lane = st.phase === 'night' || st.phase === 'evening';
    L.push({ x: 18, y: 96, r: lane ? 22 : 18, col: lane ? '#ffc870' : '#d8ecff', a: 0.06 + night * 0.12, punch: 0.6 });
    if (bg.glassbloom) L.push({ x: 46, y: 52, r: 24 + Math.sin(this.t * 1.1) * 2, col: '#90f0e0', a: 0.06 + night * 0.16, punch: 0.75 });
    if (st.decor.shelves === 'cabinet') L.push({ x: 282, y: 34, r: 46, col: '#ffe2b0', a: 0.05 + night * 0.08, punch: 0.6 });
    if (bg.stations.some((s) => s.id === 'gallery')) L.push({ x: 311, y: 100, r: 28, col: '#ffd090', a: 0.06 + night * 0.12, punch: 0.75 });
    return L;
  }

  private shaft(st: WorkshopViewState): { pts: [number, number][]; a: number; col: string } | null {
    if (st.phase === 'night') return null;
    const g = this.bg!.win;
    const dx = st.phase === 'morning' ? 34 : st.phase === 'afternoon' ? -26 : -46;
    const w = g.w - 6;
    const x0 = g.x + 3, y0 = g.y + 3, y1 = g.y + g.h - 3;
    const fy = FLOOR_Y + 40;
    const pts: [number, number][] = [[x0, y0], [x0 + w, y0], [x0 + w + dx + 10, fy], [x0 + dx - 6, fy]];
    void y1;
    const a = (st.phase === 'evening' ? 0.1 : 0.16) * (st.weather === 'clear' ? 1 : st.weather === 'cloudy' ? 0.45 : 0.3);
    const col = g.kind === 'stained' ? '#ffd0a0' : st.phase === 'morning' ? '#ffe2a0' : st.phase === 'afternoon' ? '#fff6e0' : '#ffa070';
    return { pts, a, col };
  }

  private drawLighting(c: C2D, st: WorkshopViewState, night: number, lights: Light[]) {
    const d = this.dc;
    const amb = AMBIENT[st.phase];
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W, H);
    d.fillStyle = rgba(amb.col, night);
    d.fillRect(0, 0, W, H);
    // corners & rafters a touch darker
    const vg = d.createRadialGradient(160, 110, 70, 160, 110, 230);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, rgba(amb.col, 0.28 + night * 0.2));
    d.fillStyle = vg;
    d.fillRect(0, 0, W, H);
    d.fillStyle = rgba(amb.col, 0.12 + night * 0.12);
    d.fillRect(0, 0, W, CEIL - 2);
    // punch the light pools out of the darkness
    d.globalCompositeOperation = 'destination-out';
    for (const l of lights) {
      const g = d.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      g.addColorStop(0, `rgba(0,0,0,${l.punch})`);
      g.addColorStop(0.45, `rgba(0,0,0,${l.punch * 0.55})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      d.fillStyle = g;
      d.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    const sh = this.shaft(st);
    if (sh) {
      d.fillStyle = `rgba(0,0,0,${Math.min(0.6, sh.a * 3)})`;
      d.beginPath(); sh.pts.forEach(([x, y], i) => (i ? d.lineTo(x, y) : d.moveTo(x, y))); d.closePath(); d.fill();
    }
    c.drawImage(this.dark, 0, 0);

    // additive warm glow
    c.globalCompositeOperation = 'lighter';
    for (const l of lights) {
      const g = c.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      g.addColorStop(0, rgba(l.col, l.a));
      g.addColorStop(0.4, rgba(l.col, l.a * 0.4));
      g.addColorStop(1, rgba(l.col, 0));
      c.fillStyle = g;
      c.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    if (sh) {
      const [p0, , p2] = sh.pts;
      const g = c.createLinearGradient(0, p0[1], 0, p2[1]);
      g.addColorStop(0, rgba(sh.col, sh.a));
      g.addColorStop(0.7, rgba(sh.col, sh.a * 0.45));
      g.addColorStop(1, rgba(sh.col, 0));
      c.fillStyle = g;
      c.beginPath(); sh.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------ fire
  private drawFire(c: C2D, st: WorkshopViewState, reduced: boolean) {
    const m = this.bg!.mouth;
    const img = this.fireImg, d = img.data;
    d.fill(0);
    const t = reduced ? this.t * 0.5 : this.t;
    const lit = st.forgeLit;
    const bottom = m.y + m.h - 1;
    const pal = FLAME.map(hexToRgb);
    const coalLit = ['#5a1408', '#a8300c', '#e86418', '#ffa838', '#ffe080'].map(hexToRgb);
    const coalDim = ['#1e0804', '#3a0e06', '#5a1a0a', '#7a2a10'].map(hexToRgb);
    for (let lx = 0; lx < m.w; lx++) {
      const X = m.x + lx;
      const centre = 1 - Math.abs(lx - (m.w - 1) / 2) / (m.w / 2);
      const n1 = valueNoise(5, X * 0.32, t * 2.3), n2 = valueNoise(9, X * 0.9, t * 5.5);
      const fh = lit ? (4 + centre * 10) * (0.55 + n1 * 0.7) + n2 * 3 : 0;
      for (let ly = 0; ly < m.h; ly++) {
        const Y = m.y + ly;
        if (!m.inside(X, Y)) continue;
        const fb = bottom - Y;
        const i = (ly * m.w + lx) * 4;
        // firebox glow
        const gl = lit ? clamp(0.25 + centre * 0.35 - ly * 0.0 + (1 - fb / m.h) * 0.25) : 0.08;
        let r = 20 + gl * 120, g = 8 + gl * 30, b = 6 + gl * 8;
        if (fb < 3) {
          const h1 = noise2(77, X, Y), h2 = noise2(78, X, Y);
          const k = 0.5 + 0.5 * Math.sin(t * (1.2 + h1 * 2.5) + h2 * 6.28);
          const pal2 = lit ? coalLit : coalDim;
          const idx = Math.min(pal2.length - 1, Math.floor((lit ? k * 0.75 + (2 - fb) * 0.12 + h1 * 0.2 : k * 0.9) * pal2.length));
          [r, g, b] = pal2[Math.max(0, idx)];
          if (fb === 2 && h1 > 0.7) { r *= 0.5; g *= 0.5; b *= 0.5; }
        }
        if (lit && fb >= 2) {
          const f = (fb - 2) / Math.max(1, fh) + (valueNoise(13, X * 0.9, Y * 0.45 + t * 9) - 0.5) * 0.4;
          if (f < 1) {
            const c = pal[f < 0.25 ? 3 : f < 0.5 ? 2 : f < 0.78 ? 1 : 0];
            [r, g, b] = c;
          }
        }
        d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
      }
    }
    this.fc.putImageData(img, 0, 0);
    c.drawImage(this.fireCv, m.x, m.y);
    // heat glow on the hearth face just around the mouth
    if (lit) {
      c.globalCompositeOperation = 'lighter';
      const g = c.createRadialGradient(m.x + m.w / 2, m.y + m.h * 0.6, 4, m.x + m.w / 2, m.y + m.h * 0.6, 22 * this.flick);
      g.addColorStop(0, 'rgba(255,140,50,0.35)');
      g.addColorStop(1, 'rgba(255,100,40,0)');
      c.fillStyle = g;
      c.fillRect(m.x - 20, m.y - 20, m.w + 40, m.h + 40);
      c.globalCompositeOperation = 'source-over';
    }
  }

  private drawEmbers(c: C2D) {
    const cols = ['#fff2a8', '#ffc048', '#ff7a24', '#b8341a'];
    for (const p of this.embers) {
      const k = p.life / p.max;
      const col = cols[Math.min(3, Math.floor(k * 4))];
      P(c, p.x, p.y, rgba(col, k > 0.8 ? (1 - k) * 5 : 1));
      if (k < 0.25) P(c, p.x, p.y + 1, rgba(col, 0.35));
    }
  }

  private drawSmoke(c: C2D) {
    for (const p of this.smoke) {
      const k = p.life / p.max;
      const a = (k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8) * 0.16;
      if (p.y < 60) continue;
      disc(c, p.x, p.y, 1.5 + k * 4, rgba('#5e524e', a));
    }
  }

  private drawDust(c: C2D, st: WorkshopViewState, night: number) {
    const sh = this.shaft(st);
    const inside = (x: number, y: number, pts: [number, number][]) => {
      let ins = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins;
      }
      return ins;
    };
    for (const p of this.dust) {
      const k = p.life / p.max;
      const fade = k < 0.2 ? k / 0.2 : k > 0.8 ? (1 - k) / 0.2 : 1;
      const tw = 0.5 + 0.5 * Math.sin(this.t * 2 + p.s * 3);
      if (sh) {
        if (!inside(p.x, p.y, sh.pts)) continue;
        P(c, p.x, p.y, rgba('#fff6dc', fade * (0.25 + tw * 0.45) * (sh.a / 0.16)));
      } else if (st.forgeLit && night > 0.3) {
        // motes drifting in the forge glow instead
        const x = 70 + ((p.x - 140) % 60 + 60) % 60, y = 70 + (p.y % 50);
        P(c, x, y, rgba('#ffc890', fade * tw * 0.35));
      }
    }
  }

  // ------------------------------------------------------------ emissive props
  private flame(c: C2D, x: number, y: number, seed: number, big = false) {
    const t = this.t;
    const sway = Math.sin(t * 7 + seed) + Math.sin(t * 13.3 + seed * 2) * 0.5 > 0.9 ? 1 : Math.sin(t * 5 + seed) < -1.2 ? -1 : 0;
    const fx = Math.floor(x), fy = Math.floor(y);
    P(c, fx, fy + 1, FLAME[1]);
    P(c, fx, fy, FLAME[2]);
    P(c, fx + sway * (Math.sin(t * 3 + seed) > 0 ? 1 : 0), fy - 1, FLAME[3]);
    if (big) { P(c, fx, fy - 2, rgba(FLAME[3], 0.6)); P(c, fx - 1, fy + 1, rgba(FLAME[1], 0.6)); P(c, fx + 1, fy + 1, rgba(FLAME[1], 0.6)); }
    c.globalCompositeOperation = 'lighter';
    disc(c, fx, fy, 2, 'rgba(255,170,80,0.18)');
    c.globalCompositeOperation = 'source-over';
  }

  private drawEmissive(c: C2D, st: WorkshopViewState, night: number, reduced: boolean) {
    const bg = this.bg!, t = this.t;
    let i = 0;
    for (const lp of bg.lamps) {
      i++;
      if (lp.kind === 'candle' || lp.kind === 'chandelier') this.flame(c, lp.x, lp.y, i * 1.7);
      else if (lp.kind === 'lantern') {
        const a = 0.7 + 0.3 * Math.sin(t * 8 + i);
        R(c, lp.x - 2.5, lp.y - 3, 5, 6, rgba('#ffd890', 0.5 + night * 0.4));
        this.flame(c, lp.x, lp.y, i * 2.3);
        c.globalCompositeOperation = 'lighter';
        disc(c, lp.x, lp.y, 3, rgba('#ffb050', 0.2 * a));
        c.globalCompositeOperation = 'source-over';
      } else if (lp.kind === 'jar') {
        for (let k = 0; k < 4; k++) {
          const x = lp.x + Math.sin(t * (0.7 + k * 0.13) + k * 2.1 + i) * 2.2;
          const y = lp.y + Math.cos(t * (0.55 + k * 0.11) + k * 1.3 + i) * 3;
          const b = 0.5 + 0.5 * Math.sin(t * 2.4 + k * 1.7 + i);
          P(c, x, y, rgba('#eaff9a', 0.35 + b * 0.65));
        }
        if (night > 0.3 && !reduced) {
          // one adventurous firefly drifting near its jar
          const x = lp.x + Math.sin(t * 0.31 + i * 4) * 14, y = lp.y - 6 + Math.sin(t * 0.47 + i) * 8;
          const b = 0.5 + 0.5 * Math.sin(t * 1.9 + i);
          P(c, x, y, rgba('#eaff9a', b * 0.9));
          c.globalCompositeOperation = 'lighter';
          disc(c, x, y, 2, rgba('#d8ff80', b * 0.15));
          c.globalCompositeOperation = 'source-over';
        }
      } else if (lp.kind === 'crystal') {
        const b = 0.5 + 0.5 * Math.sin(t * 1.2 + i);
        c.globalCompositeOperation = 'lighter';
        for (const [dx, dy] of [[0, 0], [0, -1], [0, -2], [-1, 1], [1, 0]]) P(c, lp.x - 0.5 + dx, lp.y + dy, rgba('#60ff98', 0.25 + b * 0.35));
        disc(c, lp.x, lp.y, 3, rgba('#60ff98', 0.12 + b * 0.08));
        c.globalCompositeOperation = 'source-over';
        if (Math.sin(t * 0.7 + i * 3) > 0.97) P(c, lp.x + 1, lp.y - 3, '#ffffff');
      }
    }
    this.flame(c, bg.journalCandle.x, bg.journalCandle.y, 99);
    // glassbloom shimmer
    if (bg.glassbloom) {
      c.globalCompositeOperation = 'lighter';
      bg.glassbloom.forEach((b, k) => {
        const a = 0.25 + 0.2 * Math.sin(t * 1.5 + k * 1.1);
        disc(c, b.x, b.y, 1.5, rgba(['#80f0e0', '#f0a0e0', '#b0a0ff'][k % 3], a));
      });
      c.globalCompositeOperation = 'source-over';
      const sp = Math.floor(t * 1.3) % (bg.glassbloom.length * 3);
      if (sp < bg.glassbloom.length && !reduced) { const b = bg.glassbloom[sp]; P(c, b.x + 1, b.y - 1, rgba('#ffffff', 0.9)); }
    }
    // dragon's sleepy eyes glow with the fire
    if (bg.dragonEyes) {
      const a = st.forgeLit ? 0.6 + 0.3 * this.flick : 0.25;
      for (const e of bg.dragonEyes) {
        HL(c, e.x - 2, e.x + 2, e.y, rgba(st.forgeLit ? '#ffb030' : '#a83a1a', a));
        P(c, e.x, e.y, rgba('#fff0a0', a * 0.8));
      }
    }
    // lane light through the door pane after dusk
    if (st.phase === 'evening' || st.phase === 'night') {
      const p = bg.doorPane;
      R(c, p.x, p.y, p.w, p.h, rgba('#ffcf70', st.phase === 'night' ? 0.85 : 0.55));
      V(c, p.x + 4, p.y, p.y + p.h - 1, '#3a2416'); HL(c, p.x, p.x + p.w - 1, p.y + 3, '#3a2416');
      // light under the door
      HL(c, 9, 27, 125, rgba('#ffcf70', 0.5));
    }
    // gallery glow
    if (bg.stations.some((s) => s.id === 'gallery')) {
      c.globalCompositeOperation = 'lighter';
      R(c, 305, 84, 12, 42, rgba('#ffc070', 0.04 + night * 0.06));
      c.globalCompositeOperation = 'source-over';
    }
  }

  // ------------------------------------------------------------ ambient props
  private drawDoorPane(c: C2D, phase: Phase) {
    const p = this.bg!.doorPane;
    const col = phase === 'morning' ? '#f4dcae' : phase === 'afternoon' ? '#bcdcf0' : phase === 'evening' ? '#e89a70' : '#2a3462';
    R(c, p.x, p.y, p.w, p.h, col);
    R(c, p.x, p.y + p.h - 2, p.w, 2, mixHex(col, '#3a5a3a', 0.4));
    V(c, p.x + 4, p.y, p.y + p.h - 1, '#3a2416');
    HL(c, p.x, p.x + p.w - 1, p.y + 3, '#3a2416');
    P(c, p.x + 1, p.y + 1, 'rgba(255,255,255,0.35)');
  }

  private drawClock(c: C2D, cx: number, cy: number, phase: Phase, reduced: boolean) {
    const hour = phase === 'morning' ? 8 : phase === 'afternoon' ? 14 : phase === 'evening' ? 18.5 : 22;
    const min = (this.t / 240) % 1;
    const ha = ((hour % 12) / 12 + min / 12) * Math.PI * 2, ma = min * Math.PI * 2;
    L(c, cx, cy, cx + Math.round(Math.sin(ha) * 2), cy - Math.round(Math.cos(ha) * 2), '#2a1a10');
    L(c, cx, cy, cx + Math.round(Math.sin(ma) * 3), cy - Math.round(Math.cos(ma) * 3), '#4a3a2a');
    P(c, cx, cy, BRASS[2]);
    // pendulum
    const a = (reduced ? 0.15 : 0.32) * Math.sin(this.t * Math.PI);
    const px = cx, py = cy + 10, len = 14;
    const bx = px + Math.sin(a) * len, by = py + Math.cos(a) * len;
    c.save();
    c.beginPath(); c.rect(cx - 3, cy + 9, 7, 17); c.clip();
    L(c, px, py, bx, by, BRASS[2]);
    disc(c, bx, by, 1.6, BRASS[4]);
    P(c, bx - 1, by - 1, BRASS[6]);
    c.restore();
  }

  private drawChimes(c: C2D, x: number, y: number, reduced: boolean) {
    const t = this.t;
    const gust = reduced ? 0 : Math.max(0, Math.sin(t * 0.23) - 0.6) * 2.5;
    const base = Math.sin(t * 1.1) * (reduced ? 0.4 : 0.8) + Math.sin(t * 3.7) * gust;
    V(c, x, y, y + 15, '#a8946a');
    const ry = y + 16;
    const sx = Math.round(base * 0.5);
    HL(c, x - 4 + sx, x + 4 + sx, ry, WOODC);
    HL(c, x - 3 + sx, x + 3 + sx, ry + 1, '#5a3a24');
    const lens = [6, 9, 8, 5];
    lens.forEach((len, i) => {
      const ox = -3 + i * 2 + sx;
      const sw = Math.sin(t * (1.5 + i * 0.27) + i) * (reduced ? 0.3 : 0.7) + base * 0.6;
      const tx = x + ox + Math.round(sw * 0.8);
      P(c, x + ox, ry + 2, '#a8946a');
      V(c, tx, ry + 3, ry + 3 + len, i % 2 ? '#c8ccd4' : BRASS[4]);
      P(c, tx, ry + 3, '#ffffff');
    });
    // clapper + sail
    const cx = x + sx + Math.round(base);
    V(c, cx, ry + 2, ry + 10, '#a8946a');
    P(c, cx, ry + 7, '#6a4a2a');
    R(c, cx - 1, ry + 11, 3, 3, '#c8a878');
  }

  private drawWheel(c: C2D, x: number, y: number, r: number, reduced: boolean) {
    const a = this.t * (reduced ? 0.6 : 1.6);
    for (let k = 0; k < 3; k++) {
      const ang = a + (k * Math.PI * 2) / 3;
      L(c, x, y, x + Math.round(Math.cos(ang) * (r - 3)), y + Math.round(Math.sin(ang) * (r - 3)), '#9a8a6a');
    }
    // a scuff on the felt that travels round
    const sa = a * 1.0;
    P(c, x + Math.round(Math.cos(sa) * (r - 1)), y + Math.round(Math.sin(sa) * (r - 1)), '#a89878');
    P(c, x + Math.round(Math.cos(sa + 0.25) * (r - 1)), y + Math.round(Math.sin(sa + 0.25) * (r - 1)), '#c8b898');
    disc(c, x, y, 1, BRASS[3]);
    P(c, x, y, BRASS[5]);
  }

  private drawCat(c: C2D, x: number, by: number, reduced: boolean) {
    const t = this.t;
    const breath = reduced ? 0 : Math.sin(t * 1.7) > 0.2 ? 1 : 0;
    const flickAge = t - this.catFlick;
    const flick = !reduced && flickAge >= 0 && flickAge < 0.6;
    const ear = !reduced && t < this.catEar && t > this.catEar - 0.25;
    const O = '#2a160c';
    const body = (col: string | null, ox: number, oy: number) => {
      const cc = (k: string) => col || k;
      // body loaf
      ellipse(c, x + 8 + ox, by - 3 + oy, 6, 2.5 + breath * 0.5, cc('#d8803a'));
      R(c, x + 3 + ox, by - 2 + oy, 11, 2, cc('#d8803a'));
      // head
      disc(c, x + 2 + ox, by - 3 + oy, 2.5, cc('#e08c44'));
      // ears
      P(c, x + 0 + ox, by - 6 + oy - (ear ? 1 : 0), cc('#d8803a'));
      P(c, x + 3 + ox, by - 6 + oy, cc('#d8803a'));
      P(c, x + 0 + ox, by - 5 + oy, cc('#e08c44'));
      P(c, x + 3 + ox, by - 5 + oy, cc('#e08c44'));
      // tail curled along the front
      if (flick) {
        const up = Math.sin(flickAge * 10) > 0 ? 1 : 0;
        HL(c, x + 6 + ox, x + 14 + ox, by - 1 + oy, cc('#c8702e'));
        P(c, x + 5 + ox, by - 2 + oy - up, cc('#c8702e'));
        P(c, x + 4 + ox, by - 3 + oy - up, cc('#f0e0c8'));
      } else {
        HL(c, x + 5 + ox, x + 14 + ox, by - 1 + oy, cc('#c8702e'));
        P(c, x + 4 + ox, by - 1 + oy, cc('#f0e0c8'));
      }
    };
    // outline pass then colour
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) body(O, ox, oy);
    body(null, 0, 0);
    // stripes
    for (const sx of [7, 10, 13]) { P(c, x + sx, by - 5 - breath + (sx === 13 ? 1 : 0), '#a8561e'); P(c, x + sx, by - 4 - breath + 1, '#b8662a'); }
    P(c, x + 1, by - 5, '#a8561e');
    // inner ears
    P(c, x + 0, by - 5 - (ear ? 1 : 0), '#f0a0a0'); P(c, x + 3, by - 5, '#f0a0a0');
    // closed eyes, nose, cheek
    P(c, x + 1, by - 3, '#4a2410'); P(c, x + 3, by - 3, '#4a2410');
    P(c, x + 2, by - 2, '#f08a8a');
    P(c, x + 0, by - 2, '#f6e6cc'); P(c, x + 4, by - 2, '#f6e6cc');
    // forelimb tucked
    P(c, x + 5, by - 1, '#f6e6cc');
    // z z z when it's late
    const st = this.state;
    if (st && (st.phase === 'night' || st.phase === 'evening') && !reduced) {
      const cyc = (t % 3.2) / 3.2;
      const zx = Math.floor(x - 1 - cyc * 3), zy = Math.floor(by - 8 - cyc * 9);
      const a = cyc < 0.15 ? cyc / 0.15 : 1 - cyc;
      const col = rgba('#f0e6d0', a * 0.8);
      HL(c, zx, zx + 2, zy, col); P(c, zx + 1, zy + 1, col); HL(c, zx, zx + 2, zy + 2, col);
    }
  }

  // ------------------------------------------------------------ the smith
  private drawPlayerShadow(c: C2D, st: WorkshopViewState) {
    const x = Math.round(this.px), y = Math.round(this.py);
    ellipse(c, x, y, 4, 1, 'rgba(10,5,2,0.45)');
    // long soft shadow thrown away from the forge's flicker
    if (st.forgeLit) {
      const m = this.bg!.mouth;
      const fx = m.x + m.w / 2, fy = BASE_FLOOR;
      const dx = x - fx, dy = (y - fy) * 2.2;
      const dist = Math.hypot(dx, dy) || 1;
      if (dist < 150) {
        const ux = dx / dist, uy = (dy / dist) * 0.35;
        const len = clamp(900 / dist, 6, 22) * this.flick;
        const strength = clamp(1 - dist / 150) * (0.2 + this.darkness(st.phase, st.weather) * 0.3);
        for (let k = 1; k < len; k += 1.2) {
          const a = strength * (1 - k / len);
          ellipse(c, x + ux * k, y + uy * k, 2.5 + k * 0.05, 0.6, rgba('#0a0502', a));
        }
      }
    }
  }

  private drawPlayer(c: C2D) {
    const fr = playerFrames();
    const x = Math.round(this.px - SPRITE_W / 2), y = Math.round(this.py - SPRITE_H + 1);
    let img: HTMLCanvasElement;
    if (this.moving) img = fr.walk[this.face][this.walkFrame];
    else {
      const blink = this.t % 4.1 < 0.13;
      const breath = Math.sin(this.t * 2.1) > 0.35 ? 1 : 0;
      img = blink ? fr.idle[this.face][2] : fr.idle[this.face][breath];
    }
    c.drawImage(img, x, y);
  }

  // ------------------------------------------------------------ highlights & labels
  private drawHighlights(c: C2D) {
    const bg = this.bg!;
    const show: { id: StationId; key: boolean }[] = [];
    if (this.inputOn && this.near) show.push({ id: this.near, key: true });
    if (this.inputOn && this.hover && this.hover !== this.near) show.push({ id: this.hover, key: false });
    const pulse = 0.55 + 0.3 * Math.sin(this.t * 4);
    for (const s of show) {
      const o = bg.outlines.get(s.id);
      if (!o) continue;
      c.globalAlpha = s.key ? pulse : pulse * 0.75;
      c.drawImage(o.c, o.x, o.y);
      c.globalAlpha = 1;
    }
    for (const s of show) {
      const def = bg.stations.find((d) => d.id === s.id);
      if (def) this.drawLabel(c, STATION_LABELS[s.id], s.key, def.lx, def.ly);
    }
  }

  private textCache = new Map<string, HTMLCanvasElement>();
  /** Text rendered once with the pixel font, alpha-thresholded so it stays crisp when scaled. */
  private text(str: string, col: string): HTMLCanvasElement {
    let ready = false;
    try { ready = !!(document as any).fonts?.check?.(`${FONT_PX}px "Pixelify Sans"`); } catch { /* ignore */ }
    const key = str + '|' + col + '|' + ready;
    let cv = this.textCache.get(key);
    if (cv) return cv;
    const [, mc] = makeCanvas(1, 1);
    mc.font = `${FONT_PX}px ${FONT}`;
    const w = Math.ceil(mc.measureText(str).width) + 2;
    const [tc, tx] = makeCanvas(w, FONT_PX + 4);
    tx.font = `${FONT_PX}px ${FONT}`;
    tx.textBaseline = 'alphabetic';
    tx.fillStyle = '#fff';
    tx.fillText(str, 1, FONT_PX);
    const img = tx.getImageData(0, 0, tc.width, tc.height);
    const [r, g, b] = hexToRgb(col);
    for (let i = 0; i < img.data.length; i += 4) {
      const a = img.data[i + 3];
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
      img.data[i + 3] = a > 105 ? 255 : 0;
    }
    tx.putImageData(img, 0, 0);
    cv = tc;
    if (this.textCache.size > 60) this.textCache.clear();
    this.textCache.set(key, cv);
    return cv;
  }

  private drawLabel(c: C2D, text: string, key: boolean, cx: number, by: number) {
    const ts = this.text(text, '#f6e8c8');
    const tw = ts.width - 2;
    const kw = key ? 10 : 0;
    const w = tw + 8 + kw, h = 12;
    const x = Math.round(clamp(cx - w / 2, 2, W - 2 - w));
    const y = Math.round(clamp(by - h - 3, 2, H - h - 2));
    const bgc = 'rgba(30,18,12,0.9)';
    R(c, x + 1, y, w - 2, h, bgc);
    R(c, x, y + 1, w, h - 2, bgc);
    HL(c, x + 1, x + w - 2, y, '#c8964e');
    HL(c, x + 1, x + w - 2, y + h - 1, '#7a5a30');
    V(c, x, y + 1, y + h - 2, '#a87a40');
    V(c, x + w - 1, y + 1, y + h - 2, '#a87a40');
    // little pointer
    const px = Math.round(clamp(cx, x + 4, x + w - 5));
    HL(c, px - 1, px + 1, y + h, bgc); P(c, px, y + h + 1, bgc);
    if (key) {
      R(c, x + 3, y + 2, 8, 8, '#e8c070');
      HL(c, x + 3, x + 10, y + 9, '#a87a30');
      c.drawImage(this.text('E', '#2a1a0e'), x + 4, y + 1);
    }
    // soft drop shadow, then the text
    c.globalAlpha = 0.5;
    c.drawImage(this.text(text, '#000000'), x + 4 + kw, y + 2);
    c.globalAlpha = 1;
    c.drawImage(ts, x + 3 + kw, y + 1);
  }

  // ------------------------------------------------------------ blit
  private blit() {
    const ctx = this.ctx, cw = this.canvas.width, ch = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = LETTERBOX;
    ctx.fillRect(0, 0, cw, ch);
    let s = Math.min(cw / W, ch / H);
    if (s >= 1) {
      const si = Math.floor(s);
      if (si / s >= 0.85) s = si;
    }
    this.scale = s;
    this.ox = Math.floor((cw - W * s) / 2);
    this.oy = Math.floor((ch - H * s) / 2);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, 0, W, H, this.ox, this.oy, Math.round(W * s), Math.round(H * s));
  }
}

const WOODC = '#7a5034';
const BASE_FLOOR = 128;
void IRON;
