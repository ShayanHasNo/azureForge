// The view through the workshop window: sky by time of day, weather and the
// season's hints in the lane outside. Static layers are cached; clouds,
// stars, weather and drifting leaves animate per frame.

import { noise2, valueNoise } from '../core/rng';
import { mixHex } from '../core/util';
import type { WinGeo } from './layout';
import { C2D, disc, ellipse, makeCanvas, P, R, rgba } from './px';

export type Phase = 'morning' | 'afternoon' | 'evening' | 'night';
export type Weather = 'clear' | 'cloudy' | 'rain' | 'snow';
export type Season = 'Spring' | 'Summer' | 'Autumn' | 'Winter';

const SKY: Record<Phase, string[]> = {
  morning: ['#e9b47c', '#f2c98e', '#f8dcaa', '#fbebc8'],
  afternoon: ['#4f8fd0', '#6fa6dc', '#97c2e8', '#c6e2f4'],
  evening: ['#3e3570', '#8a4f7c', '#d8707a', '#f19a68', '#f8c474'],
  night: ['#050822', '#0a1132', '#111d48', '#1c2b5c'],
};

function skyAt(phase: Phase, t: number): string {
  const s = SKY[phase];
  const f = Math.max(0, Math.min(0.9999, t)) * (s.length - 1);
  const i = Math.floor(f);
  return mixHex(s[i], s[i + 1], f - i);
}

function weatherTint(col: string, weather: Weather, phase: Phase): string {
  const night = phase === 'night';
  if (weather === 'cloudy') return mixHex(col, night ? '#20243a' : '#a8aab0', 0.42);
  if (weather === 'rain') return mixHex(col, night ? '#141826' : '#6e7480', 0.62);
  if (weather === 'snow') return mixHex(col, night ? '#2a3048' : '#c9ced8', 0.55);
  return col;
}

/** Overall tone applied to the land layer. */
function landTone(col: string, phase: Phase, weather: Weather): string {
  let c = col;
  if (phase === 'morning') c = mixHex(c, '#f0c890', 0.18);
  if (phase === 'evening') c = mixHex(c, '#6a3a5a', 0.35);
  if (phase === 'night') c = mixHex(c, '#080c22', 0.68);
  if (weather === 'rain' || weather === 'cloudy') c = mixHex(c, '#5a6070', 0.2);
  return c;
}

export class OutsideView {
  private key = '';
  private sky?: HTMLCanvasElement;
  private land?: HTMLCanvasElement;
  private stars: { x: number; y: number; p: number; big: boolean }[] = [];
  private drops: { x: number; y: number; v: number; s: number }[] = [];
  private houses: { x: number; y: number; w: number; chim: number }[] = [];

  constructor(public geo: WinGeo) {}

  setGeo(geo: WinGeo) {
    if (geo.kind !== this.geo.kind) { this.geo = geo; this.key = ''; }
  }

  private build(phase: Phase, weather: Weather, season: Season) {
    const { w, h } = this.geo;
    const seed = 9137;
    // ---- sky
    const [sc, sx] = makeCanvas(w, h);
    for (let y = 0; y < h; y++) R(sx, 0, y, w, 1, weatherTint(skyAt(phase, y / h), weather, phase));
    const clear = weather === 'clear';
    if (phase === 'morning') {
      const cx = w * 0.26, cy = h * 0.52;
      if (clear) { disc(sx, cx, cy, 6, rgba('#fff2c8', 0.35)); disc(sx, cx, cy, 3.4, '#fff6dc'); }
      else disc(sx, cx, cy, 7, rgba('#fff4dc', 0.18));
    } else if (phase === 'afternoon') {
      const cx = w * 0.76, cy = h * 0.2;
      if (clear) { disc(sx, cx, cy, 5, rgba('#ffffff', 0.3)); disc(sx, cx, cy, 2.6, '#fffbea'); }
      else disc(sx, cx, cy, 6, rgba('#ffffff', 0.16));
    } else if (phase === 'evening') {
      const cx = w * 0.7, cy = h * 0.7;
      if (weather !== 'rain') { disc(sx, cx, cy, 7, rgba('#ffc070', clear ? 0.35 : 0.18)); if (clear) disc(sx, cx, cy, 4, '#ffb45c'); }
    } else {
      // stars + moon
      this.stars = [];
      if (weather !== 'rain') {
        const n = Math.round((w * h) / (weather === 'clear' ? 26 : 70));
        for (let i = 0; i < n; i++) {
          const x = Math.floor(noise2(seed, i, 1) * w), y = Math.floor(noise2(seed, i, 2) * h * 0.7);
          this.stars.push({ x, y, p: noise2(seed, i, 3) * 6.28, big: noise2(seed, i, 4) > 0.9 });
        }
        const mx = Math.round(w * 0.72), my = Math.round(h * 0.24);
        disc(sx, mx, my, 6, rgba('#c8d0ff', 0.12));
        disc(sx, mx, my, 3.6, '#f4ecd0');
        disc(sx, mx - 2, my - 1, 3, weatherTint(skyAt(phase, my / h), weather, phase));
        P(sx, mx + 2, my + 1, '#d8ceb0');
      }
    }
    this.sky = sc;

    // ---- land
    const [lc, lx] = makeCanvas(w, h);
    const hillY = Math.round(h * 0.6);
    const winter = season === 'Winter' || weather === 'snow';
    const hillCol = landTone(winter ? '#d4d8e2' : season === 'Autumn' ? '#a08a5a' : season === 'Spring' ? '#8ab07a' : '#6a9a68', phase, weather);
    const hill2 = landTone(winter ? '#e8ecf2' : season === 'Autumn' ? '#b07a3e' : season === 'Spring' ? '#7aa860' : '#4e8a4a', phase, weather);
    for (let x = 0; x < w; x++) {
      const y1 = hillY + Math.round(valueNoise(seed, x * 0.09, 0.5) * 6 - 3);
      R(lx, x, y1, 1, h - y1, hillCol);
      const y2 = Math.round(h * 0.72) + Math.round(valueNoise(seed + 5, x * 0.14, 2.5) * 4 - 2);
      R(lx, x, y2, 1, h - y2, hill2);
    }
    // village rooftops
    this.houses = [];
    const nH = Math.max(2, Math.floor(w / 13));
    for (let i = 0; i < nH; i++) {
      const hx = Math.round(4 + (i * (w - 8)) / nH + noise2(seed, i, 9) * 4);
      const hw = 7 + Math.floor(noise2(seed, i, 10) * 4);
      const hy = Math.round(h * 0.74) + Math.floor(noise2(seed, i, 11) * 3);
      if (hx > w * 0.08 && hx < w * 0.2) continue; // leave room for the tree
      this.houses.push({ x: hx, y: hy, w: hw, chim: noise2(seed, i, 12) > 0.5 ? 1 : 0 });
    }
    const lit = phase === 'evening' || phase === 'night';
    for (const ho of this.houses) {
      const wall = landTone(['#d8c4a0', '#c8b48e', '#e0d0b0'][ho.x % 3], phase, weather);
      const roof = landTone(winter ? '#eef0f6' : ['#8a3e30', '#6e4a3a', '#7a5a3a'][ho.w % 3], phase, weather);
      R(lx, ho.x, ho.y, ho.w, h - ho.y, wall);
      for (let k = 0; k <= Math.ceil(ho.w / 2); k++) R(lx, ho.x - 1 + k, ho.y - 1 - k, ho.w + 2 - k * 2, 1, roof);
      if (ho.chim) R(lx, ho.x + ho.w - 3, ho.y - 4, 2, 3, landTone('#6a5a50', phase, weather));
      const wc = lit ? '#ffd27a' : landTone('#5a6a80', phase, weather);
      P(lx, ho.x + 2, ho.y + 2, wc);
      if (ho.w > 8) P(lx, ho.x + ho.w - 3, ho.y + 2, wc);
    }
    // near ground
    const gy = h - 5;
    const gcol = winter ? '#f2f4f8' : season === 'Autumn' ? '#b8823e' : season === 'Spring' ? '#86c060' : '#5a9a48';
    for (let x = 0; x < w; x++) {
      const yy = gy + Math.round(valueNoise(seed + 9, x * 0.3, 0) * 2);
      R(lx, x, yy, 1, h - yy, landTone(gcol, phase, weather));
      if (!winter && noise2(seed, x, 77) > 0.82) P(lx, x, yy - 1, landTone(season === 'Autumn' ? '#d89a3a' : '#3e7a34', phase, weather));
      if (season === 'Spring' && noise2(seed, x, 78) > 0.86) P(lx, x, yy + 1, landTone(['#f4d0e0', '#fff4a0', '#ffffff'][x % 3], phase, weather));
    }
    // a tree just outside
    const tx = Math.max(4, Math.round(w * 0.14)), ty = Math.round(h * 0.42);
    const trunk = landTone('#4a3424', phase, weather);
    R(lx, tx, ty, 2, h - ty, trunk);
    R(lx, tx - 2, ty + 4, 2, 1, trunk); R(lx, tx + 2, ty + 2, 3, 1, trunk);
    if (season === 'Winter') {
      const br = landTone('#4a3a30', phase, weather);
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i - 2.5) * 0.45;
        for (let r = 1; r < 7; r++) P(lx, tx + Math.round(Math.cos(a) * r), ty + Math.round(Math.sin(a) * r), br);
        P(lx, tx + Math.round(Math.cos(a) * 6), ty + Math.round(Math.sin(a) * 6) - 1, landTone('#ffffff', phase, weather));
      }
    } else {
      const leaves = season === 'Spring' ? ['#6aa850', '#84bc60', '#f2b6c8', '#fad0dc'] : season === 'Summer' ? ['#2e6a30', '#3e7e3a', '#4e9244', '#2a5a2a'] : ['#c85a24', '#d8802e', '#e8aa3a', '#a8401e'];
      for (let y = -8; y <= 7; y++)
        for (let x = -8; x <= 8; x++) {
          const d = (x * x) / 64 + (y * y) / 52 + (valueNoise(seed + 3, (tx + x) * 0.5, (ty + y) * 0.5) - 0.5) * 0.7;
          if (d > 1) continue;
          const n = noise2(seed, tx + x, ty + y);
          let col = leaves[n < 0.4 ? 1 : n < 0.7 ? 0 : n < 0.85 ? 3 : 2];
          if (season === 'Spring') col = n > 0.72 ? leaves[2 + (n > 0.86 ? 1 : 0)] : leaves[n < 0.35 ? 0 : 1];
          if (y < -3 && n > 0.5 && season !== 'Spring') col = mixHex(col, '#ffffff', 0.15);
          P(lx, tx + x, ty + y, landTone(col, phase, weather));
        }
    }
    // frost in the corners of the glass in winter
    if (season === 'Winter') {
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (!this.geo.glass(x, y)) continue;
          const dl = Math.min(x, w - 1 - x), db = h - 1 - y;
          const d = Math.min(dl + db * 0.6, 99);
          if (d < 7 && noise2(seed, x, y + 200) * 7 > d) P(lx, x, y, rgba('#eef6ff', 0.55));
        }
    }
    this.land = lc;
    // drops on the glass
    this.drops = [];
    for (let i = 0; i < Math.round((w * h) / 140); i++) this.drops.push({ x: noise2(seed, i, 30) * w, y: noise2(seed, i, 31) * h, v: 0.6 + noise2(seed, i, 32) * 2.2, s: noise2(seed, i, 33) });
  }

  draw(c: C2D, t: number, phase: Phase, weather: Weather, season: Season, reduced: boolean) {
    const g = this.geo;
    const key = `${g.kind}|${phase}|${weather}|${season}`;
    if (key !== this.key) { this.build(phase, weather, season); this.key = key; }
    const { w, h } = g;
    c.save();
    c.translate(g.x, g.y);
    c.beginPath(); c.rect(0, 0, w, h); c.clip();
    c.drawImage(this.sky!, 0, 0);
    const night = phase === 'night';
    // twinkling stars
    for (const s of this.stars) {
      const tw = reduced ? 0.8 : 0.55 + 0.45 * Math.sin(t * 1.7 + s.p);
      P(c, s.x, s.y, rgba('#fff8e0', 0.35 + tw * 0.6));
      if (s.big && tw > 0.85) { P(c, s.x - 1, s.y, rgba('#fff8e0', 0.4)); P(c, s.x + 1, s.y, rgba('#fff8e0', 0.4)); }
    }
    // clouds
    const nC = weather === 'clear' ? 2 : weather === 'cloudy' ? 4 : 5;
    const cloudCol = weather === 'rain' ? (night ? '#1c2030' : '#7a808c') : night ? '#262c4c' : phase === 'evening' ? '#f0a49a' : phase === 'morning' ? '#fff0dc' : '#fbfaf6';
    const cloudSh = mixHex(cloudCol, night ? '#0a0c1c' : '#8a8aa0', 0.3);
    for (let i = 0; i < nC; i++) {
      const sp = 0.8 + noise2(7, i, 1) * 1.4;
      const span = w + 40;
      const cx = ((noise2(7, i, 2) * span + t * sp) % span) - 20;
      const cy = 3 + noise2(7, i, 3) * h * (weather === 'clear' ? 0.35 : 0.45);
      const sz = 3 + noise2(7, i, 4) * 3 + (weather === 'clear' ? 0 : 2);
      ellipse(c, cx, cy + 1, sz * 2.2, sz * 0.8, cloudSh);
      ellipse(c, cx - sz * 0.8, cy, sz, sz * 0.7, cloudCol);
      ellipse(c, cx + sz * 0.6, cy - sz * 0.3, sz * 1.2, sz * 0.9, cloudCol);
      ellipse(c, cx + sz * 1.6, cy + 0.5, sz * 0.8, sz * 0.5, cloudCol);
    }
    c.drawImage(this.land!, 0, 0);
    // village chimney smoke
    for (const ho of this.houses) {
      if (!ho.chim) continue;
      for (let k = 0; k < 4; k++) {
        const f = ((t * 0.35 + k * 0.25 + ho.x * 0.13) % 1);
        const sx = ho.x + ho.w - 2 + Math.sin(f * 5 + ho.x) * 1.2 + f * 3;
        const sy = ho.y - 5 - f * 10;
        P(c, sx, sy, rgba(night ? '#8890b0' : '#e8e4e0', 0.45 * (1 - f)));
      }
    }
    // weather particles
    if (weather === 'rain') {
      const n = Math.round((w * h) / (reduced ? 70 : 28));
      for (let i = 0; i < n; i++) {
        const sp = 90 + noise2(3, i, 1) * 60;
        const x = ((noise2(3, i, 2) * (w + 20) + t * sp * 0.25) % (w + 20)) - 10;
        const y = ((noise2(3, i, 3) * (h + 10) + t * sp) % (h + 10)) - 5;
        const col = rgba(night ? '#8a9ac8' : '#dce6f4', 0.5);
        P(c, x, y, col); P(c, x - 0.3, y - 1, col); P(c, x - 0.6, y - 2, rgba(night ? '#8a9ac8' : '#dce6f4', 0.25));
      }
    } else if (weather === 'snow') {
      const n = Math.round((w * h) / (reduced ? 60 : 24));
      for (let i = 0; i < n; i++) {
        const sp = 7 + noise2(4, i, 1) * 9;
        const x = ((noise2(4, i, 2) * (w + 10) + Math.sin(t * 0.8 + i) * 2 + t * 2) % (w + 10)) - 5;
        const y = ((noise2(4, i, 3) * (h + 6) + t * sp) % (h + 6)) - 3;
        P(c, x, y, rgba('#ffffff', noise2(4, i, 5) > 0.7 ? 0.95 : 0.7));
      }
    }
    // seasonal drifters
    if (season === 'Autumn' || season === 'Spring') {
      const n = reduced ? 2 : season === 'Autumn' ? 4 : 6;
      const cols = season === 'Autumn' ? ['#e07a2a', '#c8501e', '#eab040'] : ['#f8c4d4', '#ffe0ea', '#f4a8c0'];
      for (let i = 0; i < n; i++) {
        const sp = 5 + noise2(5, i, 1) * 5;
        const x = ((noise2(5, i, 2) * (w + 16) + t * (4 + sp * 0.6)) % (w + 16)) - 8;
        const y = ((noise2(5, i, 3) * (h + 10) + t * sp) % (h + 10)) - 5 + Math.sin(t * 2 + i) * 1.5;
        const col = landTone(cols[i % cols.length], phase, weather);
        P(c, x, y, col);
        if (season === 'Autumn' && Math.sin(t * 5 + i) > 0) P(c, x + 1, y, col);
      }
    } else if (season === 'Summer' && !night && weather === 'clear') {
      // a butterfly (or two) bobbing about
      for (let i = 0; i < 2; i++) {
        const x = w * 0.5 + Math.sin(t * 0.37 + i * 2) * w * 0.38;
        const y = h * 0.6 + Math.sin(t * 0.9 + i) * h * 0.15;
        const flap = Math.sin(t * 14 + i) > 0;
        const col = i ? '#fff2a0' : '#f4f4ff';
        P(c, x, y, col);
        if (flap) { P(c, x - 1, y - 1, col); P(c, x + 1, y - 1, col); }
      }
    }
    // a bird crossing on clear days now and then
    if (!night && weather !== 'rain') {
      const cyc = (t % 41) / 41;
      if (cyc < 0.35) {
        const bx = -4 + (cyc / 0.35) * (w + 8), by = h * 0.25 + Math.sin(cyc * 30) * 1.2;
        const up = Math.sin(t * 9) > 0;
        const bc = phase === 'evening' ? '#3a2438' : '#3a3a48';
        P(c, bx, by, bc); P(c, bx - 1, by + (up ? -1 : 0), bc); P(c, bx + 1, by + (up ? -1 : 0), bc);
      }
    }
    // raindrops sliding on the glass
    if (weather === 'rain') {
      for (const d of this.drops) {
        const y = (d.y + t * d.v * (d.s > 0.6 ? 3 : 0.6)) % (h + 4);
        P(c, d.x, y, rgba('#e8f0ff', 0.55));
        P(c, d.x, y + 1, rgba('#203048', 0.35));
        if (d.s > 0.6) for (let k = 2; k < 6; k++) P(c, d.x, y - k, rgba('#e8f0ff', 0.12));
      }
    }
    c.restore();
  }
}
