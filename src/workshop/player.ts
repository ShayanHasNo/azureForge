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
export const SPRITE_H = 20;

type Grid = (string | null)[][];

function blank(): Grid {
  return Array.from({ length: SPRITE_H }, () => Array<string | null>(SPRITE_W).fill(null));
}

/** Compose one frame, facing right. walk: -1 idle, 0..3 walk. */
function compose(walk: number, breath: number, blink: boolean): Grid {
  const g = blank();
  const put = (x: number, y: number, k: string) => {
    const X = x + 1, Y = y + 1;
    if (X >= 0 && Y >= 0 && X < SPRITE_W && Y < SPRITE_H) g[Y][X] = k;
  };
  const rect = (x: number, y: number, w: number, h: number, k: string) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(x + i, y + j, k); };

  const passing = walk === 1 || walk === 3;
  const bob = walk >= 0 ? (passing ? -1 : 0) : breath; // body offset (y)
  // ---- legs (inner rows 13..15)
  const hip = 13 + bob;
  const legs = (lx: number, foot: number, back: boolean) => {
    for (let y = hip; y <= 14; y++) rect(lx, y, 2, 1, back ? 'P' : 'p');
    rect(lx + foot, 15, 2, 1, 'b');
    put(lx + foot + 2, 15, back ? 'b' : 'B');
  };
  if (walk < 0 || passing) {
    legs(2, 0, true);
    legs(4, 0, false);
  } else {
    const s = walk === 0 ? 1 : -1;
    legs(3 - s, -s, true);
    legs(3 + s, s > 0 ? 0 : 0, false);
  }
  // ---- torso (rows 8..12) shirt with apron
  const ty = 8 + bob;
  rect(1, ty, 6, 5, 'w');
  rect(1, ty + 3, 1, 2, 'W');
  rect(2, ty + 1, 5, 5, 'a');
  rect(3, ty, 3, 1, 'a');
  rect(2, ty + 5, 5, 1, 'A');
  put(6, ty + 1, 'A'); put(6, ty + 2, 'A');
  rect(2, ty + 3, 5, 1, 'A');
  put(4, ty + 3, 'k');
  put(2, ty, 'k'); put(6, ty, 'k');
  // ---- arms: rolled sleeves (shirt upper, skin forearm)
  const swing = walk < 0 ? 0 : walk === 0 ? 1 : walk === 2 ? -1 : 0;
  // back arm
  put(0, ty, 'W'); put(0, ty + 1, 'x');
  put(0 - (swing > 0 ? 1 : 0), ty + 2, 'S'); put(0 - (swing > 0 ? 1 : 0), ty + 3, 'S');
  put(0 - (swing > 0 ? 1 : 0), ty + 4, 'S');
  // front arm
  put(7, ty, 'w'); put(7, ty + 1, 'x');
  put(7 + (swing < 0 ? 0 : swing), ty + 2, 's'); put(7 + (swing < 0 ? 0 : swing), ty + 3, 's');
  put(7 + (swing > 0 ? 1 : swing < 0 ? -1 : 0), ty + 4, 's');
  // ---- head (rows 0..7)
  const hy = 0 + bob;
  rect(1, hy + 1, 6, 6, 's');
  rect(2, hy, 5, 1, 'h');
  rect(1, hy + 1, 6, 2, 'h');
  put(3, hy, 'H'); put(4, hy, 'H'); put(3, hy + 1, 'H');
  rect(0, hy + 2, 2, 4, 'h'); put(0, hy + 6, 'd'); put(1, hy + 6, 'h');
  put(2, hy + 3, 'h'); put(6, hy + 3, 'h');
  // kerchief band
  rect(1, hy + 2, 6, 1, 'c'); put(0, hy + 2, 'C'); put(-1, hy + 3, 'C'); put(-1, hy + 4, 'c');
  // face
  put(5, hy + 4, blink ? 'S' : 'e');
  put(7, hy + 4, 's'); // nose
  put(4, hy + 5, 'r');
  put(6, hy + 6, 'S'); put(5, hy + 6, 's');
  rect(2, hy + 6, 2, 1, 'S');
  put(1, hy + 5, 'S');
  // neck
  put(3, hy + 7, 'S'); put(4, hy + 7, 'S');
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
