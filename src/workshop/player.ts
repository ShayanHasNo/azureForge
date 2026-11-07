// The smith: a small procedurally composed pixel sprite (~10x18) with idle
// breathing, blinking and a 4-frame walk cycle. Frames are composed once
// from part rects, outlined, and cached (plus mirrored copies for facing left).

import { makeCanvas } from './px';

const PAL: Record<string, string> = {
  o: '#22140e', // outline
  h: '#7a3e1c', H: '#a85a2a', d: '#4e2410', // hair
  s: '#eab48c', S: '#c8906a', r: '#e8907a', // skin, shadow, blush
  e: '#2a1a14', // eye
  w: '#e6d6b4', W: '#b8a684', // linen shirt
  a: '#6e4228', A: '#4e2c18', k: '#d0a04a', // leather apron, dark, brass
  p: '#3c3a50', P: '#2c2a3c', // trousers
  b: '#2e1e14', B: '#4a3020', // boots
  x: '#f0e8d8', // headband/kerchief light
  c: '#b8423a', C: '#8a2e28', // kerchief red
};

export const SPRITE_W = 12;
export const SPRITE_H = 19;

type Grid = (string | null)[][];

function blank(): Grid {
  return Array.from({ length: SPRITE_H }, () => Array<string | null>(SPRITE_W).fill(null));
}

// Hand-placed pixel rows (facing right). '.' = empty.
const HEAD = [
  '..hhhh..',
  '.hHHHhh.',
  'hhHhhhhh',
  'Cccccccc',
  'hhssssss',
  'hhsssess',
  'hhSssrss',
  '.hSSsss.',
];
const TORSO = [
  '.wwaaww.',
  'xwaaaawx',
  'SaaaaaAs',
  'SAAkAAAs',
  'SaaaaaaS',
  '.aaaaaa.',
];
// legs rows 14..16 for: idle, walk0 (front leg forward), walk1 (passing), walk2 (back leg forward), walk3 (passing)
const LEGS: Record<string, string[]> = {
  idle: ['..PPpp..', '..PPpp..', '..bbbbb.'],
  w0: ['..PPpp..', '.PP..pp.', 'bb....bbb'],
  w1: ['..PPpp..', '..PPpb..', '..bb.bb.'],
  w2: ['..PPpp..', '.pp..PP.', 'bbb...bb'],
  w3: ['..PPpp..', '..bPpp..', '.bb.bbb.'],
};

/** Compose one frame, facing right. walk: -1 idle, 0..3 walk. */
function compose(walk: number, breath: number, blink: boolean): Grid {
  const g = blank();
  const put = (x: number, y: number, k: string) => {
    const X = x + 1, Y = y + 1;
    if (X >= 0 && Y >= 0 && X < SPRITE_W && Y < SPRITE_H) g[Y][X] = k;
  };
  const rows = (art: string[], x0: number, y0: number, map?: (k: string, x: number, y: number) => string) => {
    art.forEach((row, j) => { for (let i = 0; i < row.length; i++) { let k = row[i]; if (k === '.') continue; if (map) k = map(k, i, j); put(x0 + i, y0 + j, k); } });
  };
  const passing = walk === 1 || walk === 3;
  const o = passing ? -1 : 0;
  const legs = walk < 0 ? LEGS.idle : LEGS['w' + walk];
  rows(legs, 0, 14);
  if (passing) rows(['..PPpp..'], 0, 13);
  const swing = walk === 0 ? 1 : walk === 2 ? -1 : 0;
  rows(TORSO, 0, 8 + o, (k, x, y) => k);
  if (swing) {
    // front forearm swings opposite the front leg
    for (let y = 10; y <= 12; y++) put(7, y + o, y === 12 ? 'a' : y === 11 ? 'A' : 'a');
    for (let y = 10; y <= 12; y++) put(7 - swing, y + o, 's');
  }
  rows(HEAD, 0, 0 + o + breath, (k) => (blink && k === 'e' ? 'S' : k));
  return g;
}

function outline(g: Grid): Grid {
  const o = g.map((r) => r.slice());
  for (let y = 0; y < SPRITE_H; y++)
    for (let x = 0; x < SPRITE_W; x++) {
      if (g[y][x]) continue;
      const n = (yy: number, xx: number) => yy >= 0 && xx >= 0 && yy < SPRITE_H && xx < SPRITE_W && !!g[yy][xx];
      if (n(y - 1, x) || n(y + 1, x) || n(y, x - 1) || n(y, x + 1)) o[y][x] = 'o';
    }
  return o;
}

function toCanvas(g: Grid, flip: boolean): HTMLCanvasElement {
  const [cv, c] = makeCanvas(SPRITE_W, SPRITE_H);
  for (let y = 0; y < SPRITE_H; y++)
    for (let x = 0; x < SPRITE_W; x++) {
      const k = g[y][x];
      if (!k) continue;
      c.fillStyle = PAL[k];
      c.fillRect(flip ? SPRITE_W - 1 - x : x, y, 1, 1);
    }
  return cv;
}

export interface PlayerFrames {
  idle: HTMLCanvasElement[][]; // [face][breath 0/1] (blink variants at index 2)
  walk: HTMLCanvasElement[][]; // [face][frame]
}

let cached: PlayerFrames | null = null;
export function playerFrames(): PlayerFrames {
  if (cached) return cached;
  const idle: HTMLCanvasElement[][] = [[], []];
  const walk: HTMLCanvasElement[][] = [[], []];
  for (let f = 0; f < 2; f++) {
    const flip = f === 1;
    idle[f].push(toCanvas(outline(compose(-1, 0, false)), flip));
    idle[f].push(toCanvas(outline(compose(-1, 1, false)), flip));
    idle[f].push(toCanvas(outline(compose(-1, 0, true)), flip));
    for (let k = 0; k < 4; k++) walk[f].push(toCanvas(outline(compose(k, 0, false)), flip));
  }
  cached = { idle, walk };
  return cached;
}
