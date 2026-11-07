// Procedural pixel portraits for villagers (original, generated from each NPC's colours).

import { hashString, seededRng } from '../core/rng';
import { shadeHex } from '../core/util';
import type { Npc } from '../village/npcs';

const cache = new Map<string, string>();

export function portrait(n: Npc, mood: 'neutral' | 'happy' | 'unsure' = 'neutral'): HTMLCanvasElement {
  const S = 16, scale = 4;
  const c = document.createElement('canvas');
  c.width = S * scale; c.height = S * scale;
  c.className = 'portrait';
  const key = n.id + mood;
  const ctx = c.getContext('2d')!;
  if (cache.has(key)) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = cache.get(key)!;
    return c;
  }
  const r = seededRng(hashString(n.id), 'portrait');
  const px = (x: number, y: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(x * scale, y * scale, scale, scale); };
  // background
  ctx.fillStyle = shadeHex(n.color, -0.55);
  ctx.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((x + y) % 5 === 0) px(x, y, shadeHex(n.color, -0.45));
  // shoulders / clothes
  for (let y = 12; y < 16; y++) for (let x = 2; x < 14; x++) px(x, y, y === 12 ? shadeHex(n.color, 0.15) : n.color);
  px(7, 12, shadeHex(n.color, -0.3)); px(8, 12, shadeHex(n.color, -0.3));
  // neck
  px(7, 11, shadeHex(n.skin, -0.2)); px(8, 11, shadeHex(n.skin, -0.2));
  // face
  for (let y = 4; y < 11; y++) for (let x = 5; x < 11; x++) {
    if ((y === 10 && (x === 5 || x === 10))) continue;
    px(x, y, x === 10 ? shadeHex(n.skin, -0.15) : n.skin);
  }
  // hair (style from seed)
  const style = r.int(0, 3);
  const hair = n.hair;
  for (let x = 4; x < 12; x++) px(x, 3, hair);
  for (let x = 5; x < 11; x++) px(x, 2, hair);
  if (style === 0) { for (let y = 4; y < 7; y++) { px(4, y, hair); px(11, y, hair); } }
  if (style === 1) { for (let y = 4; y < 11; y++) { px(4, y, hair); px(11, y, hair); } }
  if (style === 2) { px(5, 4, hair); px(6, 4, hair); px(4, 4, hair); px(11, 4, hair); }
  if (style === 3) { for (let x = 3; x < 13; x++) px(x, 2, shadeHex(n.color, -0.1)); for (let x = 5; x < 11; x++) px(x, 1, shadeHex(n.color, -0.1)); }
  // eyes
  const eye = '#2a1a14';
  px(6, 6, eye); px(9, 6, eye);
  px(6, 5, shadeHex(hair, 0.1)); px(9, 5, shadeHex(hair, 0.1));
  // cheeks + mouth
  px(5, 8, shadeHex(n.skin, -0.08)); px(10, 8, shadeHex(n.skin, -0.18));
  const mouth = shadeHex(n.skin, -0.45);
  if (mood === 'happy') { px(6, 8, mouth); px(7, 9, mouth); px(8, 9, mouth); px(9, 8, mouth); }
  else if (mood === 'unsure') { px(7, 9, mouth); px(8, 8, mouth); }
  else { px(7, 9, mouth); px(8, 9, mouth); }
  // beard for some
  if (['brannoc', 'teodor'].includes(n.id)) for (let x = 6; x < 10; x++) px(x, 10, hair);
  cache.set(key, c.toDataURL());
  return c;
}
