// Engraving and decoration geometry, shared by the renderer and the engraving
// minigame so that what the player traces is exactly what gets cut.
// Coordinates are blade-local: t = 0 at the guard → 1 at the tip,
// u = -1 at the left edge → 1 at the right edge.

import { seededRng } from '../core/rng';

export type Pt = [number, number];
export type Path = Pt[];

const T0 = 0.07;
const T1 = 0.6;

function sampled(n: number, f: (k: number) => Pt): Path {
  const out: Path = [];
  for (let i = 0; i <= n; i++) out.push(f(i / n));
  return out;
}

export function engravingPaths(pattern: string, seed: number): Path[] {
  const r = seededRng(seed, 'engrave:' + pattern);
  const span = T1 - T0;
  switch (pattern) {
    case 'none':
      return [];
    case 'vine': {
      const main = sampled(40, (k) => [T0 + k * span, 0.38 * Math.sin(k * Math.PI * 4.5)]);
      const leaves: Path[] = [];
      for (let i = 1; i < 9; i++) {
        const k = i / 9;
        const t = T0 + k * span;
        const u = 0.38 * Math.sin(k * Math.PI * 4.5);
        const dir = Math.cos(k * Math.PI * 4.5) > 0 ? 1 : -1;
        leaves.push([[t, u], [t + 0.02, u + dir * 0.28], [t + 0.035, u + dir * 0.12]]);
      }
      return [main, ...leaves];
    }
    case 'waves':
      return [
        sampled(36, (k) => [T0 + k * span, -0.35 + 0.18 * Math.sin(k * Math.PI * 6)]),
        sampled(36, (k) => [T0 + k * span, 0.35 + 0.18 * Math.sin(k * Math.PI * 6 + 1.4)]),
      ];
    case 'geometric': {
      const zig: Path = [];
      const n = 10;
      for (let i = 0; i <= n; i++) zig.push([T0 + (i / n) * span, i % 2 ? 0.45 : -0.45]);
      const diamonds: Path[] = [];
      for (let i = 0; i < n; i += 2) {
        const t = T0 + ((i + 0.5) / n) * span;
        const d = span / n / 2;
        diamonds.push([[t - d * 0.7, 0], [t, 0.18], [t + d * 0.7, 0], [t, -0.18], [t - d * 0.7, 0]]);
      }
      return [zig, ...diamonds];
    }
    case 'mountains': {
      const ridge: Path = [];
      const n = 7;
      for (let i = 0; i <= n; i++) {
        const peak = i % 2 === 1;
        ridge.push([T0 + 0.02 + (peak ? r.range(0.08, 0.14) : 0.01), -0.8 + (1.6 * i) / n]);
      }
      const ridge2: Path = ridge.map(([t, u]) => [t + 0.05, u * 0.8] as Pt);
      return [ridge, ridge2.slice(1, -1)];
    }
    case 'runes': {
      const paths: Path[] = [];
      const count = 7;
      for (let i = 0; i < count; i++) {
        const tc = T0 + 0.02 + (i / count) * span;
        const h = (span / count) * 0.7;
        const strokes = r.int(2, 3);
        paths.push([[tc, 0], [tc + h, 0]]);
        for (let s = 0; s < strokes; s++) {
          const a = tc + r.range(0, h);
          const b = tc + r.range(0, h);
          const side = r.chance(0.5) ? 1 : -1;
          paths.push([[a, 0], [b, side * r.range(0.25, 0.5)]]);
        }
      }
      return paths;
    }
    case 'knotwork':
      return [
        sampled(48, (k) => [T0 + k * span, 0.42 * Math.sin(k * Math.PI * 6)]),
        sampled(48, (k) => [T0 + k * span, -0.42 * Math.sin(k * Math.PI * 6)]),
        sampled(48, (k) => [T0 + k * span, 0.18 * Math.cos(k * Math.PI * 12)]),
      ];
    case 'stars': {
      const thread = sampled(24, (k) => [T0 + k * span, 0.1 * Math.sin(k * 9)]);
      const stars: Path[] = [];
      for (let i = 0; i < 7; i++) {
        const t = T0 + r.range(0.02, span - 0.02);
        const u = r.range(-0.55, 0.55);
        const d = 0.012;
        stars.push([[t - d, u], [t + d, u]], [[t, u - 0.14], [t, u + 0.14]]);
      }
      return [thread, ...stars];
    }
    case 'flames': {
      const paths: Path[] = [];
      for (let f = -1; f <= 1; f++) {
        const h = 0.18 + r.range(0, 0.12) - Math.abs(f) * 0.06;
        paths.push(sampled(14, (k) => [T0 + k * h, f * 0.4 + 0.18 * Math.sin(k * Math.PI * 2) * (1 - k)]));
      }
      return paths;
    }
    case 'feather': {
      const quill = sampled(20, (k) => [T0 + k * span, 0]);
      const barbs: Path[] = [];
      for (let i = 1; i < 14; i++) {
        const t = T0 + (i / 14) * span;
        const w = 0.55 * Math.sin((i / 14) * Math.PI);
        barbs.push([[t, 0], [t + 0.03, -w]], [[t, 0], [t + 0.03, w]]);
      }
      return [quill, ...barbs];
    }
    case 'filigree': {
      const paths: Path[] = [];
      for (let i = 0; i < 5; i++) {
        const tc = T0 + 0.04 + (i / 5) * span;
        const side = i % 2 ? 1 : -1;
        paths.push(sampled(16, (k) => {
          const a = k * Math.PI * 3;
          const rad = 0.05 * (1 - k * 0.8);
          return [tc + Math.sin(a) * rad, side * 0.25 + (Math.cos(a) * rad * 8) * side];
        }));
      }
      paths.push(sampled(30, (k) => [T0 + k * span, 0.25 * Math.sin(k * Math.PI * 5)]));
      return paths;
    }
    case 'braid':
      return [0, 1, 2].map((p) => sampled(42, (k) => [T0 + k * span, 0.4 * Math.sin(k * Math.PI * 7 + (p * Math.PI * 2) / 3)]));
    case 'tally': {
      const paths: Path[] = [];
      for (let i = 0; i < 12; i++) {
        const t = T0 + (i / 12) * span;
        if (i % 5 === 4) paths.push([[t - 0.08, -0.5], [t, 0.5]]);
        else paths.push([[t, -0.4], [t + 0.004, 0.4]]);
      }
      return paths;
    }
    case 'lacework': {
      const paths: Path[] = [];
      for (let i = 0; i < 6; i++) {
        const tc = T0 + 0.04 + (i / 6) * span;
        paths.push(sampled(14, (k) => [tc + 0.035 * Math.sin(k * Math.PI * 2), 0.4 * Math.cos(k * Math.PI * 2)]));
      }
      return paths;
    }
    case 'constellation': {
      const pts: Pt[] = [];
      for (let i = 0; i < 7; i++) pts.push([T0 + (i / 6) * span, r.range(-0.5, 0.5)]);
      return [pts];
    }
    case 'petal': {
      const paths: Path[] = [];
      for (let i = 0; i < 8; i++) {
        const tc = T0 + r.range(0, span);
        const uc = r.range(-0.45, 0.45);
        paths.push(sampled(8, (k) => [tc + 0.025 * Math.sin(k * Math.PI * 2), uc + 0.22 * Math.sin(k * Math.PI)]));
      }
      return paths;
    }
    default:
      return [sampled(20, (k) => [T0 + k * span, 0])];
  }
}

/** Total number of sample points (used to size minigame jitter arrays). */
export function pathSampleCount(paths: Path[]): number {
  return paths.reduce((n, p) => n + p.length, 0);
}

// ---------------------------------------------------------------- emblems (7x7)
export const EMBLEM_BITMAPS: Record<string, string[]> = {
  sun: ['..#.#..', '.#...#.', '#.###.#', '..###..', '#.###.#', '.#...#.', '..#.#..'],
  moon: ['..###..', '.##....', '##.....', '##.....', '##.....', '.##....', '..###..'],
  leaf: ['...#...', '..###..', '.##.##.', '.#.#.#.', '.##.##.', '..###..', '...#...'],
  mountain: ['.......', '...#...', '..###..', '.##.#..', '##...##', '#.....#', '#######'],
  star: ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '##...##'],
  wave: ['.......', '.##....', '#..#..#', '....##.', '.##....', '#..#..#', '....##.'],
  hammer: ['#####..', '#####..', '..#....', '..#....', '..#....', '..#....', '..#....'],
  crown: ['#..#..#', '#.###.#', '#######', '#.#.#.#', '#######', '#######', '.......'],
  eye: ['.......', '..###..', '.#...#.', '#..#..#', '.#...#.', '..###..', '.......'],
  flame: ['...#...', '..##...', '..###..', '.####..', '.#####.', '.##.##.', '..###..'],
  key: ['.###...', '#...#..', '.###...', '..#....', '..##...', '..#....', '..###..'],
  laurel: ['#.....#', '##...##', '.#...#.', '.##.##.', '..#.#..', '..###..', '...#...'],
  crescent: ['...###.', '..##...', '.##....', '.##....', '.##....', '..##...', '...###.'],
  chalice: ['#######', '#######', '.#####.', '..###..', '...#...', '..###..', '.#####.'],
  comet: ['......#', '....##.', '..###..', '.###...', '####...', '###....', '.#.....'],
};

// ---------------------------------------------------------------- inscription glyphs
/** Each character becomes a seeded 3x5 rune-like glyph. */
export function glyphFor(ch: string): string[] {
  const code = ch.toUpperCase().charCodeAt(0);
  const r = seededRng(code, 'glyph');
  const rows: string[] = [];
  for (let y = 0; y < 5; y++) {
    let row = '';
    for (let x = 0; x < 3; x++) row += x === 1 || r.chance(0.42) ? '#' : '.';
    rows.push(row);
  }
  return rows;
}
