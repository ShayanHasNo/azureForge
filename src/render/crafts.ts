// Sprites for the bowyer's, fletcher's and armourer's work. Like the blade and
// shield renderers, every pixel comes from the piece's stored data: a bow's
// curve shows how it was tillered, a set of arrows shows each shaft's
// straightness and fletching, and armour shows every stitch, link and rivet as
// it was made.

import { noise2, valueNoise } from '../core/rng';
import { clamp, rampFrom, sampleCurve } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { CATEGORY_INFO } from '../item/factory';
import { EMBLEM_BITMAPS, engravingPaths } from '../item/patterns';
import type { Item } from '../item/types';
import {
  Canvas, compose, drawBlemishes, drawFinishShade, L_BLADE, L_BOSS, L_EMBLEM, L_FACE, L_GRIP, L_RIM, L_WRAP, line, makeCtx, matPalette, upscaleBitmap, type Ctx, type View,
} from './itemRenderer';
import type { PixelImage } from './pixel';

export function renderCraft(item: Item, view: View, k: number): PixelImage {
  const [W, H] = CATEGORY_INFO[item.category].size;
  const c = new Canvas(W * k, H * k);
  const ctx = makeCtx(item, c, view, k);
  if (item.bow) drawBow(ctx, view === 'profile');
  else if (item.arrows) drawArrows(ctx);
  else if (item.armor) drawArmor(ctx);
  organicFinish(ctx);
  drawFinishShade(ctx);
  drawBlemishes(ctx, null);
  const img = compose(ctx);
  return view === 'back' ? img.mirrored() : img;
}

/** Glossy / aged finishes on wood, leather and cloth (metal parts are handled by drawFinishShade). */
function organicFinish(ctx: Ctx) {
  const { item, c, seed, k } = ctx;
  const f = item.finish.finish;
  if (f !== 'glossy' && f !== 'aged') return;
  for (let i = 0; i < c.layer.length; i++) {
    const L = c.layer[i];
    if (L !== L_GRIP && L !== L_WRAP && L !== L_FACE) continue;
    if (f === 'glossy') { if (c.shade[i] > 3.4) c.shade[i] += 0.5; }
    else {
      const x = (i % c.w) / k, y = Math.floor(i / c.w) / k;
      c.addTint(i, [72, 52, 34], 0.16 + 0.14 * valueNoise(seed + 71, x / 4, y / 4));
    }
  }
}

// ============================================================ bows
interface BowShape { cy: number; half: number; xs: number }

function bowShape(item: Item): BowShape {
  const [, H] = CATEGORY_INFO.bow.size;
  return { cy: H / 2 - 0.5, half: item.bow!.length / 2, xs: 13 };
}

/** Centre line of the limb at s (−1 top tip … 0 grip … 1 bottom tip), in logical pixels. */
function bowX(item: Item, sh: BowShape, s: number): number {
  const b = item.bow!;
  const a = Math.abs(s);
  const depth = b.profile === 'flatbow' ? 15 : b.profile === 'recurve' ? 14 : b.profile === 'reflex' ? 13 : 17;
  // one long arc; a flatbow bends more toward the tips, with a stiff handle
  let x = sh.xs + depth * (1 - Math.pow(a, b.profile === 'flatbow' ? 2.5 : 2.05));
  if (b.profile === 'recurve') x += 7 * Math.pow(Math.max(0, a - 0.7) / 0.3, 2); // tips sweep forward
  if (b.profile === 'reflex') { x -= 3.2 * Math.max(0, 1 - a / 0.22); x += 3.5 * Math.pow(Math.max(0, a - 0.6) / 0.4, 2); } // handle set back, limbs forward
  // how it was tillered: a stiff section stays flatter, a weak one bends away
  const err = sampleCurve(s < 0 ? b.upper : b.lower, a);
  x -= err * 3.2 * Math.sin(Math.PI * Math.min(1, a * 1.05));
  // an untillered limb is simply stronger: the whole limb sits a little flatter or fuller
  const limbMean = (s < 0 ? b.upper : b.lower).reduce((p, v) => p + v, 0) / Math.max(1, b.upper.length);
  x -= limbMean * 1.6 * a;
  return x;
}

function bowThickness(item: Item, s: number): number {
  const b = item.bow!;
  const a = Math.abs(s);
  const flat = b.profile === 'flatbow';
  let t = (b.limb + (flat ? -0.6 : 0.4)) * (1 - 0.62 * a) + 0.9;
  if (a < 0.1) t += flat ? 1.6 : 1.1; // the handle
  return t;
}

function drawBow(ctx: Ctx, front: boolean) {
  const { item, c, k, seed } = ctx;
  const b = item.bow!;
  const sh = bowShape(item);
  const hi = k > 1;
  const WOOD = ctx.P;
  const BACK = b.backing && hasMat(b.backing) ? c.addPalette('back', matPalette(b.backing)) : -1;
  const BELLY = b.belly && hasMat(b.belly) ? c.addPalette('belly', matPalette(b.belly)) : -1;
  const NOCK = b.nock && hasMat(b.nock) ? c.addPalette('nock', matPalette(b.nock)) : -1;
  const WRAP = c.addPalette('bowwrap', rampFrom(b.wrapColor || '#6a3a24', 6, 0.7));
  const STR = c.addPalette('string', matPalette(b.string, 'linenthread'));
  const laminated = item.design.method === 'laminated';
  const y0 = Math.round((sh.cy - sh.half) * k), y1 = Math.round((sh.cy + sh.half) * k) + (k - 1);
  if (front) {
    // seen from the belly: the width of the limbs (wide and flat, or narrow and deep)
    const cx = (c.w - 1) / 2;
    for (let y = y0; y <= y1; y++) {
      const s = clamp((y / k - sh.cy) / sh.half, -1, 1), a = Math.abs(s);
      const w = (b.profile === 'flatbow' ? (a < 0.12 ? 2.2 : 5.2 * (1 - 0.72 * Math.pow(a, 1.6))) : b.profile === 'longbow' ? 2.6 * (1 - 0.6 * a) + 0.5 : 3.6 * (1 - 0.66 * a) + 0.5) * k;
      for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) {
        const u = (x - cx) / Math.max(1, w);
        let s0 = 3.2 - u * 1.2 + (valueNoise(seed + 50, (x / k) * 1.6, y / k / 5) - 0.5) * 0.9;
        if (hi && (x === Math.round(cx - w) || x === Math.round(cx + w))) s0 += x < cx ? 0.7 : -0.9;
        const grip = a < 0.1, nock = a > 0.965;
        c.put(x, y, grip ? L_WRAP : nock && NOCK >= 0 ? L_BOSS : L_FACE, grip ? WRAP : nock && NOCK >= 0 ? NOCK : BELLY >= 0 ? BELLY : WOOD, grip ? 3.2 - u * 1.2 + (Math.floor(y / k) % 2 ? 0.5 : -0.3) : s0);
      }
    }
    return;
  }
  // side view: the stave arcs away from the string
  for (let y = y0; y <= y1; y++) {
    const s = clamp((y / k - sh.cy) / sh.half, -1, 1), a = Math.abs(s);
    const xc = bowX(item, sh, s) * k + (k - 1) / 2;
    const th = bowThickness(item, s) * k;
    const xl = Math.round(xc - th / 2), xr = Math.round(xc + th / 2);
    const grip = a < 0.1, nock = a > 0.965;
    for (let x = xl; x <= xr; x++) {
      const u = (x - xl) / Math.max(1, xr - xl); // 0 belly (string side) … 1 back
      let layer = L_FACE, pal = WOOD;
      let s0 = 3.4 - u * 1.0 + (valueNoise(seed + 50, (x / k) * 0.8, y / k / 6) - 0.5) * 1.0;
      if (hi) s0 += (noise2(seed + 53, x, Math.floor(y / (6 * k))) - 0.5) * 0.4; // fine grain along the limb
      if (nock && NOCK >= 0) { layer = L_BOSS; pal = NOCK; s0 = 3.6 - u * 1.4; }
      else if (grip) {
        layer = L_WRAP; pal = WRAP;
        const band = Math.floor(y / k) % 3;
        s0 = 3.3 - u * 1.3 + (hi ? (y % (3 * k) === 0 ? 0.8 : y % (3 * k) === 3 * k - 1 ? -0.8 : 0) : band === 0 ? 0.5 : 0);
      } else {
        if (BELLY >= 0 && u < 0.36) { pal = BELLY; layer = L_BOSS; s0 = 3.2 - u * 0.8; } // horn belly
        if (BACK >= 0 && (laminated ? u > 0.5 : u > 0.78 || x === xr)) { pal = BACK; layer = laminated ? L_FACE : L_RIM; s0 = 3.5 - (u - 0.6) * 1.2; }
        // the glue line: a poor glue-up shows as a dark, wandering seam
        if (hi && (BACK >= 0 || BELLY >= 0)) {
          const seam = laminated ? 0.5 : BELLY >= 0 && u < 0.5 ? 0.36 : 0.78;
          if (Math.abs(u - seam) < 0.6 / Math.max(2, xr - xl) + (1 - b.glue) * 0.12 * noise2(seed + 57, 0, Math.floor(y / (2 * k)))) s0 = 1.4 + b.glue;
        }
      }
      if (x === xl) s0 += 0.5; else if (x === xr) s0 -= 0.8;
      // a hinge shows as a hard crease in the belly
      if (b.hinge > 0.25 && !grip) {
        const limb = s < 0 ? b.upper : b.lower;
        const worst = limb.indexOf(Math.min(...limb));
        const at = (worst + 0.5) / limb.length;
        if (Math.min(...limb) < -0.2 && Math.abs(a - at) < 0.012 && u < 0.6) s0 = 0.8;
      }
      c.put(x, y, layer, pal, s0);
    }
  }
  // nock grooves
  for (const s of [-1, 1]) {
    const y = Math.round((sh.cy + s * sh.half * 0.975) * k);
    const xc = Math.round(bowX(item, sh, s * 0.975) * k);
    for (let n = 0; n < k; n++) if (c.is(xc - k + n, y)) c.shade[c.idx(xc - k + n, y)] = 1.0;
  }
  // the string: tip to tip, with a served centre. Uneven twisting shows as little lumps.
  const tipTop = bowX(item, sh, -0.975) * k, tipBot = bowX(item, sh, 0.975) * k;
  const ya = Math.round((sh.cy - sh.half * 0.975) * k), yb = Math.round((sh.cy + sh.half * 0.975) * k);
  for (let y = ya; y <= yb; y++) {
    const f = (y - ya) / Math.max(1, yb - ya);
    const x = Math.round(tipTop + (tipBot - tipTop) * f - 2 * k);
    const served = Math.abs(f - 0.5) < 0.07;
    const lump = noise2(seed + 61, 3, Math.floor(y / (2 * k))) > 0.35 + b.stringQuality * 0.65;
    const tw = Math.floor(y / k) % 2;
    c.put(x, y, L_WRAP, served ? WRAP : STR, served ? 3.4 : tw ? 4.2 : 3.2);
    if (served || lump || (hi && b.stringQuality < 0.45 && tw)) c.put(x + 1, y, L_WRAP, served ? WRAP : STR, served ? 2.4 : 2.8);
    if (served && hi) c.put(x - 1, y, L_WRAP, WRAP, 4.2);
  }
}

// ============================================================ arrows
const ARROW_GAP = 14;

function arrowX(item: Item, i: number, t: number, k: number): number {
  const [W] = CATEGORY_INFO.arrows.size;
  const a = item.arrows!;
  const base = W / 2 - 0.5 + (i - (a.count - 1) / 2) * ARROW_GAP;
  // an unstraightened shaft bows to one side (which side comes from the piece's seed)
  const dir = noise2(item.seed + 5, i, 0) > 0.5 ? 1 : -1;
  const bow = (1 - (a.straight[i] ?? 0.8)) * 5.5 * Math.sin(Math.PI * t) * dir;
  return (base + bow) * k + (k - 1) / 2;
}

function arrowSpan(item: Item): { nockY: number; tipY: number; len: number } {
  const [, H] = CATEGORY_INFO.arrows.size;
  const a = item.arrows!;
  const nockY = H - 6;
  return { nockY, tipY: nockY - a.length, len: a.length };
}

function drawArrows(ctx: Ctx) {
  const { item, c, k, seed } = ctx;
  const a = item.arrows!;
  const hi = k > 1;
  const SHAFT = ctx.P;
  const flint = a.point === 'flint';
  const POINT = c.addPalette('point', matPalette(item.materials.secondary, flint ? 'flint' : 'iron'));
  const FEATHER = c.addPalette('feather', matPalette(item.materials.grip, 'goose'));
  const BIND = c.addPalette('bind', matPalette(a.binding, 'linenthread'));
  const CREST = c.addPalette('crest', rampFrom(a.crest || '#d8642a', 6, 0.7));
  const NOCK = a.nock && hasMat(a.nock) ? c.addPalette('anock', matPalette(a.nock)) : -1;
  const barred = ['turkey', 'pheasant'].includes(item.materials.grip);
  const { nockY, len } = arrowSpan(item);
  const flLen = a.fletch === 'traditional' ? 22 : a.fletch === 'shield' ? 15 : 17;
  const flAt = 5; // gap between nock and the back of the fletching
  const half = hi ? 1 : 0; // shaft half-width in device pixels
  for (let i = 0; i < a.count; i++) {
    const err = a.fletchErr[i] ?? 0;
    for (let y = Math.round((nockY - len) * k); y <= Math.round(nockY * k) + (k - 1); y++) {
      const t = clamp((nockY * k + (k - 1) - y) / (len * k)); // 0 nock … 1 tip
      const dn = (nockY - y / k); // logical distance from the nock
      const xc = Math.round(arrowX(item, i, t, k));
      // fletching: two vanes in view (the third faces us, drawn as a pale line on the shaft)
      const fv = (dn - flAt) / flLen; // 0 back of the vane … 1 front
      if (fv >= 0 && fv <= 1) {
        const prof = a.fletch === 'traditional' ? 5.2 * (1 - fv) + 0.6
          : a.fletch === 'shield' ? (fv < 0.14 ? 4.4 * (0.55 + fv * 2) : 4.6 * Math.pow(1 - (fv - 0.14) / 0.86, 0.7))
          : 4.6 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.12 + fv * 0.9)), 0.75);
        for (const side of [-1, 1]) {
          // a vane set off its mark stands wider on one side and narrower on the other
          const w = Math.max(0, prof * (1 + side * err * 0.75)) * k;
          for (let n = 1; n <= Math.round(w); n++) {
            const x = xc + side * (half + n);
            const bar = barred && Math.floor((dn + n / k * 0.6) / 3) % 2 === 0;
            let s0 = (side < 0 ? 3.8 : 3.0) - (n / Math.max(1, w)) * 0.7 + (bar ? -1.3 : 0);
            if (hi && n === Math.round(w)) s0 += side < 0 ? 0.6 : -0.7;
            if (hi && (y + n) % (2 * k) === 0) s0 -= 0.35; // the barbs of the feather
            c.put(x, y, L_GRIP, FEATHER, s0);
          }
        }
      }
      // shaft
      for (let n = -half; n <= half; n++) {
        let layer = L_FACE, pal = SHAFT;
        let s0 = 3.2 - n * 1.0 + (noise2(seed + 21 + i, 0, Math.floor(y / (5 * k))) - 0.5) * 0.5;
        if (dn < 2.2) { if (NOCK >= 0) { pal = NOCK; layer = L_BOSS; } else s0 -= 0.9; } // nock
        else if ((dn >= flAt - 1.2 && dn < flAt) || (dn >= flAt + flLen && dn < flAt + flLen + 1.6)) { pal = BIND; layer = L_WRAP; s0 = 3.4 - n + (Math.floor(y / Math.max(1, k / 2)) % 2 ? 0.5 : -0.4); } // thread binding
        else if (dn >= flAt + flLen + 3 && dn < flAt + flLen + 9 && Math.floor((dn - flAt - flLen - 3) / 2) % 2 === 0) { pal = CREST; layer = L_WRAP; s0 = 3.6 - n * 0.8; } // crest bands
        else if (fv >= 0 && fv <= 1 && n === 0) { pal = FEATHER; layer = L_GRIP; s0 = 4.6; } // the third vane, edge-on
        else if (len - dn < 3.4 && flint) { pal = BIND; layer = L_WRAP; s0 = 3.2 - n + (Math.floor(y / Math.max(1, k / 2)) % 2 ? 0.6 : -0.4); } // sinew holding a stone point
        c.put(xc + n, y, layer, pal, s0);
      }
      // nock groove
      if (dn < 1 && hi) c.put(xc, y, L_FACE, SHAFT, 0.6);
    }
    // the point
    const tipX = arrowX(item, i, 1, k), baseY = (nockY - len) * k;
    const q = a.pointQuality;
    const ph = (a.point === 'bodkin' ? 10 : a.point === 'leaf' ? 10 : a.point === 'flint' ? 8 : 9) * k;
    for (let py = 0; py < ph; py++) {
      const v = py / ph; // 0 tip … 1 base
      let w = a.point === 'bodkin' ? 0.3 + 1.5 * Math.sin(Math.PI * Math.min(1, v * 1.15)) * (v < 0.87 ? 1 : 0.7)
        : a.point === 'leaf' ? 0.3 + 2.7 * Math.sin(Math.PI * Math.pow(v, 0.8))
        : a.point === 'flint' ? 0.4 + 3.0 * Math.pow(v, 0.75) * (v < 0.82 ? 1 : 0.55)
        : 0.3 + 3.6 * v; // broadhead
      // rough work leaves the edges uneven
      const rough = (1 - q) * 1.3;
      const wl = Math.max(0.3, w + (noise2(seed + 31 + i, 1, Math.floor(py / k)) - 0.5) * rough + (flint ? (noise2(seed + 33 + i, 2, Math.floor(py / k)) - 0.5) * 0.9 : 0)) * k;
      const wr = Math.max(0.3, w + (noise2(seed + 32 + i, 3, Math.floor(py / k)) - 0.5) * rough + (flint ? (noise2(seed + 34 + i, 4, Math.floor(py / k)) - 0.5) * 0.9 : 0)) * k;
      const y = Math.round(baseY - ph + py);
      for (let x = Math.round(tipX - wl); x <= Math.round(tipX + wr); x++) {
        const u = (x - tipX) / Math.max(1, x < tipX ? wl : wr);
        let s0 = u < 0 ? 4.1 : 2.3;
        if (Math.abs(x - tipX) < 0.6 * k && a.point !== 'broadhead') s0 = flint ? 3.2 : 4.7; // the ridge
        if (flint) s0 += (noise2(seed + 35, Math.floor(x / k), Math.floor(py / (2 * k))) - 0.5) * 1.6; // flake scars
        if (x === Math.round(tipX - wl)) s0 = 4.9; else if (x === Math.round(tipX + wr)) s0 = 1.5;
        c.put(x, y, L_BLADE, POINT, s0);
      }
      // a broadhead's barbs: cut away behind the widest part
      if (a.point === 'broadhead' && v > 0.86) for (let x = Math.round(tipX - 1.2 * k); x <= Math.round(tipX + 1.2 * k); x++) if (c.is(x, y, L_BLADE)) c.shade[c.idx(x, y)] = 2.6;
    }
    if (a.point === 'broadhead') {
      // open the notch between socket and barbs
      for (let py = Math.round(ph * 0.9); py < ph; py++) for (const side of [-1, 1]) for (let n = Math.round(1.4 * k); n < Math.round(2.6 * k); n++) {
        const x = Math.round(tipX + side * n), y = Math.round(baseY - ph + py);
        if (c.in(x, y)) c.layer[c.idx(x, y)] = 0;
      }
    }
  }
}

// ============================================================ body armour
// A torso garment seen from the front. The outline comes from the cut; the
// surface comes from how it was made: quilted channels, moulded hide, rings
// linked four-in-one, laced scales, rivet heads through cloth, or raised plate.
// The evenness of the row-work (armor.even), what was skipped (armor.gaps) and
// the lumps left by forming (armor.dents) all show.
type Pt = [number, number];
/** Right half of each cut as (distance from the centre line, y), in logical pixels before centring. */
const ARMOR_CUTS: Record<string, { bottom: number; lift: number; half: Pt[] }> = {
  vest: { bottom: 72, lift: 17, half: [[0, 5], [16, 5], [18, 8], [15, 18], [15.5, 26], [21, 34], [21.5, 42], [19.5, 58], [21, 72], [0, 72]] },
  jack: { bottom: 86, lift: 10, half: [[0, 5], [19, 5], [36, 19], [31, 32], [22, 27], [22, 42], [20.5, 60], [24, 86], [0, 86]] },
  coat: { bottom: 106, lift: 0, half: [[0, 5], [19, 5], [36, 19], [31, 32], [22, 27], [22, 42], [20.5, 60], [28, 106], [0, 106]] },
};
const ARMOR_TOP = 5, CHEST_Y = 39, WAIST_Y = 58;

interface ArmorGeo { W: number; H: number; cx: number; oy: number; bottom: number; cut: string; half: Pt[] }
function armorGeo(item: Item): ArmorGeo {
  const [W, H] = CATEGORY_INFO.armor.size;
  const cut = item.armor && item.armor.cut in ARMOR_CUTS ? item.armor.cut : 'jack';
  const sh = ARMOR_CUTS[cut];
  return { W, H, cx: W / 2 - 0.5, oy: sh.lift, bottom: sh.bottom, cut, half: sh.half };
}

/** Is the garment-local point (dx from the centre line, y) part of the garment? */
function armorInside(g: ArmorGeo, dx: number, y: number): boolean {
  const ax = Math.abs(dx);
  if (y < ARMOR_TOP || y > g.bottom) return false;
  if ((ax / 8) ** 2 + ((y - 4.5) / 8.5) ** 2 < 1) return false; // the neck opening
  if (g.cut === 'coat' && y > 80 && ax < (y - 80) * 0.1) return false; // split for riding
  let inside = false;
  const p = g.half;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && ax < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) inside = !inside;
  }
  return inside;
}

/** Half-width of the body (not the sleeves) at garment-local y. */
function armorHalfWidth(g: ArmorGeo, y: number): number {
  let w = 0;
  for (let dx = 0; dx < 30; dx += 0.5) { if (armorInside(g, dx, y) && (g.cut === 'vest' || dx <= 22.5 || y > 33)) w = dx; }
  return w;
}

/** Where tooled or etched decoration runs on body armour: a ring on the chest (logical pixels). */
export function armorToolingGeo(item?: Item) {
  const [W, H] = CATEGORY_INFO.armor.size;
  const oy = item?.armor ? armorGeo(item).oy : ARMOR_CUTS.jack.lift;
  return { W, H, cx: W / 2 - 0.5, cy: CHEST_Y + oy, rx: 21, ry: 21 };
}

const isMetalMat = (id: string) => hasMat(id) && mat(id).kind === 'metal';

function drawArmor(ctx: Ctx) {
  const { item, c, k, seed } = ctx;
  const a = item.armor!;
  const g = armorGeo(item);
  const hi = k > 1;
  const m = a.method;
  const w = c.w, h = c.h;
  const BODY = m === 'brigandine' ? c.addPalette('cover', matPalette(item.materials.grip, 'canvas')) : ctx.P;
  const LINING = c.addPalette('lining', matPalette(m === 'mail' ? item.materials.grip : 'linen', 'linen'));
  const LACE = c.addPalette('lace', matPalette(m === 'scale' ? item.materials.grip : 'linenthread', 'linenthread'));
  const STRAP = c.addPalette('strap', matPalette(m === 'plate' ? item.materials.grip : 'leather', 'leather'));
  const TRIM = c.addPalette('trim', rampFrom(a.trimColor || '#8a2a2a', 6, 0.7));
  const FIT = ctx.S; // buckles, rivets and edge rings
  const surface = clamp(item.quality.surface ?? 0.7);
  const fitted = clamp(item.quality.assembly ?? 0.7);
  const cxd = g.cx * k + (k - 1) / 2; // the centre line in device pixels

  // ---- outline, and each pixel's distance in from the edge
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (armorInside(g, x / k - g.cx, y / k - g.oy)) mask[y * w + x] = 1;
  const dist = new Float32Array(w * h);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : dist[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    dist[i] = mask[i] ? Math.min(at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.4, at(x + 1, y - 1) + 1.4) : 0;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (mask[i]) dist[i] = Math.min(dist[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.4, at(x - 1, y + 1) + 1.4);
  }
  /** Hem, collar and cuffs: where a garment is bound or trimmed. */
  const border = (ax: number, ly: number): boolean => {
    if (ly > g.bottom - 2.6) return true;
    if ((ax / 10.6) ** 2 + ((ly - 4.5) / 11.1) ** 2 < 1) return true;
    if (g.cut === 'vest') return false;
    // the cuff runs from (36,19) to (31,32)
    const t = clamp(((ax - 36) * -5 + (ly - 19) * 13) / 194);
    return Math.hypot(ax - (36 - 5 * t), ly - (19 + 13 * t)) < 2.6 && ax > 26;
  };

  // ---- the surface
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!mask[i]) continue;
    const lx = x / k, ly = y / k - g.oy;
    const dx = lx - g.cx, ax = Math.abs(dx);
    const v = clamp((ly - ARMOR_TOP) / (g.bottom - ARMOR_TOP));
    const ev = clamp(sampleCurve(a.even, v));
    const sleeve = g.cut !== 'vest' && ax > 21.5 && ly < 33;
    const d = dist[i] / k;
    const dent = clamp(sampleCurve(a.dents, (Math.atan2(ly - CHEST_Y, dx) / (Math.PI * 2) + 1) % 1));
    const edge = border(ax, ly);
    // the roundness of a body: lit from the upper left, turning away at the sides
    let s = 3.3 - (dx / 24) * 0.9 - (v - 0.35) * 0.5 - (sleeve ? 0.35 : 0) - (d < 1.2 ? 0.5 : 0);
    let layer = L_FACE, pal = BODY;
    switch (m) {
      case 'cuirbouilli': {
        // moulded hide: smooth and hard, with the swell of the form it was shaped over
        s += (valueNoise(seed + 91, lx / 7, ly / 7) - 0.5) * 0.7;
        s += Math.sin(Math.hypot(dx, ly - CHEST_Y) * 0.9) * dent * 1.3; // lumps where the moulding went badly
        if (!sleeve) {
          const chest = ly - (37 + (1 - Math.min(1, (ax / 21) ** 2)) * 4);
          if (chest >= 0 && chest * k < 1) s = 1.9; else if (chest < 0 && chest > -1.6) s += 0.55;
          for (const ry of [48, 55, 62, 70, 78, 86, 94]) {
            if (ry > g.bottom - 5) break;
            const r = ly - ry - (ax / 21) ** 2 * 1.5;
            if (r >= 0 && r * k < 1) s = 2.0; else if (r >= 1 / k && r < 1.4) s += 0.5;
          }
          // the hard shine of waxed leather
          s += 1.1 * surface * Math.max(0, 1 - Math.hypot((dx + 9) / 5, (ly - 25) / 9));
        } else {
          const f = (((ax - 20) * 0.75 + (ly - 5) * 0.66) % 5 + 5) % 5;
          if (f * k < 1) s = 2.0; else s += 0.5 - f * 0.22;
        }
        // a stitched edge all round
        if (d >= 2 && d < 2 + 1 / k) {
          const n = Math.floor((x + y) / (hi ? 3 : 2));
          if (n % 2 === 0 && noise2(seed + 93, n, 0) >= a.gaps * 0.8) { pal = LACE; layer = L_WRAP; s = 4.3; } else s -= 0.7;
        }
        break;
      }
      case 'mail': {
        // rings linked four-in-one: each row sits half a ring across from the one above
        const cw = 3 * k, ch = 2 * k;
        const sag = Math.round((1 - ev) * 1.5 * k * (valueNoise(seed + 101, lx / 6, ly / 9) - 0.5) * 2);
        const yy = y + sag + 400 * ch;
        const row = Math.floor(yy / ch);
        const xx = x + (row % 2 ? Math.ceil(cw / 2) : 0) + 400 * cw;
        const col = Math.floor(xx / cw);
        const ux = ((xx - col * cw + 0.5) / cw) * 2 - 1, uy = ((yy - row * ch + 0.5) / ch) * 2 - 1;
        if (noise2(seed + 103, col, row) < a.gaps * 0.45 && d > 2) { pal = LINING; layer = L_GRIP; s = 1.5 + (uy < 0 ? 0 : 0.6); break; } // a ring never linked: the lining shows
        if (edge) { pal = FIT; layer = L_RIM; } // a border of bright rings
        if (!hi) { s += ux < -0.3 ? -1.4 : uy < 0 ? 0.7 : -0.2; break; }
        const dd = Math.hypot(ux, uy * 0.9);
        if (dd < 0.42) s = 1.3; // through the ring
        else if (dd > 1.0) s = 1.9; // between rings
        else {
          s += 0.55 - ux * 0.5 - uy * 1.1; // the wire, lit from above
          if (uy < -0.5 && ux > 0 && ux < 0.34 && noise2(seed + 105, col, row) < fitted) s = 5; // the rivet that closes it
        }
        break;
      }
      case 'scale': {
        // rows of small plates, each row lapping the one below
        const SW = 5, SH = 4;
        const row = Math.floor(ly / SH);
        const q = (dx + 600 + (row % 2 ? SW / 2 : 0)) / SW;
        const col = Math.floor(q), fx = q - col;
        const fy = ly - row * SH + (1 - ev) * 1.3 * (noise2(seed + 111, col, row) - 0.5) * 2;
        const lost = noise2(seed + 113, col, row) < a.gaps * 0.45;
        const corner = fy > SH - 1.6 && Math.abs(fx - 0.5) > 0.5 - (fy - (SH - 1.6)) * 0.15;
        if (fy < 0.9 || corner) s = lost ? 1.2 : 1.7; // in the shadow of the row above
        else {
          s += 0.9 - (fx - 0.5) * 1.4 - (fy / SH) * 0.6 + (noise2(seed + 115, col, row) - 0.5) * 0.5 * (0.4 + dent);
          if (hi && fy > SH - 0.9) s += 0.5; // the lit lower lip
          if (lost) s -= 1.4; // a scale hanging by one lace sits dull and crooked
          else if (fy >= 1.1 && fy < 1.1 + (hi ? 1 : 1.01) && Math.abs(fx - 0.5) < (hi ? 0.11 : 0.1)) { pal = LACE; layer = L_WRAP; s = 3.8; } // the lace through it
        }
        break;
      }
      case 'brigandine': {
        // cloth over plates: the plates only show as shapes pressing through, and as rivet heads
        const PW = 8, PH = 9;
        const row = Math.floor(ly / PH);
        const q = (dx + 600 + (row % 2 ? PW / 2 : 0)) / PW;
        const fx = (q - Math.floor(q)) * PW * k, fy = (ly - row * PH) * k;
        if (hi) s += (noise2(seed + 121, x, y) - 0.5) * 0.3 + ((x + y) % 2 ? 0.08 : -0.08); // the weave
        s += Math.sin(Math.hypot(dx, ly - CHEST_Y) * 0.8) * dent * 1.1; // uneven plates make a lumpy coat
        if (fy < 1) s -= 0.7; else if (hi && fy < 2) s += 0.35;
        if (fx < 1) s -= 0.45;
        break;
      }
      case 'plate': {
        if (sleeve) {
          // spaulder lames over the shoulder
          const f = (((ax - 20) * 0.75 + (ly - 5) * 0.66) % 5 + 5) % 5;
          s += 1.0 - f * 0.4;
          if (f * k < 1) s = 4.8; else if (f > 5 - 1 / k - 0.01) s = 1.4;
        } else if (ly < WAIST_Y) {
          // the breastplate: a deep bowl, brightest where it turns to the light
          const nx = dx / 22, ny = (ly - 34) / 26;
          s = 3.2 + (-nx * 0.85 - ny * 0.55) * 1.5 + (1 - Math.min(1, nx * nx + ny * ny)) * 0.5;
          if (Math.abs(dx + 8 + (ly - 30) * 0.25) < 1.1 && ly > 17 && ly < 45) s += 1.0 * surface; // the long highlight of a burnished plate
          s += (noise2(seed + 131, Math.floor(lx / 2.5), Math.floor(ly / 2.5)) - 0.5) * dent * 3.4; // facets the planishing hammer left
          if (Math.abs(x - cxd) < 1) s = x < cxd ? 4.9 : 2.1; // the medial ridge
          if (d < 1.6) s = d * k < 1.5 ? 2.2 : 4.6; // rolled edges at the neck and arms
          if (ly > WAIST_Y - 1.2) s = 1.6; // the waist, where the fauld hangs
        } else {
          // the fauld: lames sliding one over another
          const f = (ly - WAIST_Y) % 6;
          s = 3.1 - (dx / 24) * 1.0 + 1.3 - f * 0.42;
          if (f * k < 1) s = 4.8; else if (f > 6 - 1 / k - 0.01) s = 1.4;
          if (Math.abs(x - cxd) < 1 && f * k >= 1) s += x < cxd ? 0.5 : -0.6;
        }
        break;
      }
      default: {
        // gambeson: padding quilted into upright channels
        const CH = 6;
        const base = Math.floor((dx + 603) / CH);
        const wob = (1 - ev) * 2.2 * (valueNoise(seed + 81, base * 3.1, ly / 6) - 0.5) * 2;
        const q = (dx + wob + 603) / CH;
        const chn = Math.floor(q), fx = q - chn;
        const skipped = noise2(seed + 83, chn, Math.floor(ly / 5)) < a.gaps * 0.9;
        if (fx * CH * k < 1 && !sleeve) {
          // the line of stitching — or, where it was skipped, nothing holding the padding
          if (skipped) s += 0.1;
          else if (Math.floor(y / (hi ? 3 : 2)) % 2 === 0) { pal = LACE; layer = L_WRAP; s = 4.3; }
          else s = 1.7;
        } else if (sleeve) {
          const f = (((ax - 20) * 0.75 + (ly - 5) * 0.66) % 5 + 5) % 5;
          s += f * k < 1 ? -1.5 : (Math.sin((Math.PI * f) / 5) - 0.55) * 1.3;
        } else s += (Math.sin(Math.PI * fx) - 0.55) * (skipped ? 0.5 : 1.5); // the padding puffs up between seams
        s += (valueNoise(seed + 87, lx / 4, ly / 4) - 0.5) * (1 - surface) * 2.2; // unevenly laid padding
        if (hi) s += (noise2(seed + 85, x, Math.floor(y / 2)) - 0.5) * 0.28; // the weave of the cloth
        break;
      }
    }
    // bound edges: hem, collar and cuffs
    if (edge && d < 2.3 && m !== 'mail' && m !== 'plate') {
      pal = TRIM; layer = L_WRAP;
      s = 3.5 - (dx / 24) * 0.8 + (d * k < 1.5 ? -0.8 : hi && d > 1.7 ? -1.0 : 0.3);
    }
    c.put(x, y, layer, pal, s);
    c.bt[i] = v;
    c.bu[i] = clamp(dx / 24, -1, 1);
  }

  // ---- fittings
  const body = (x: number, y: number) => c.in(x, y) && mask[y * w + x] === 1;
  /** A small domed rivet head at device (x, y). */
  const rivet = (x: number, y: number, palIdx = FIT) => {
    x = Math.round(x); y = Math.round(y);
    if (!hi) { if (body(x, y)) c.put(x, y, L_BOSS, palIdx, 5); return; }
    for (const [ox, oy2, sh] of [[0, 0, 5], [1, 0, 3.8], [0, 1, 3.4], [1, 1, 1.5]] as const) if (body(x + ox, y + oy2)) c.put(x + ox, y + oy2, L_BOSS, palIdx, sh);
  };
  /** A missing rivet: just the hole. */
  const hole = (x: number, y: number) => { x = Math.round(x); y = Math.round(y); if (body(x, y)) c.shade[y * w + x] = 0.8; };
  const dev = (dx: number, ly: number): Pt => [(g.cx + dx) * k + (k - 1) / 2, (ly + g.oy) * k];
  /** A strap with a buckle: from (dx0, ly) running `len` to the right. */
  const strap = (dx0: number, ly: number, len: number, buckleAt: number) => {
    for (let n = 0; n < len * k; n++) for (let t = 0; t < 2 * k; t++) {
      const [x, y] = dev(dx0 + n / k, ly + t / k);
      if (body(Math.round(x), Math.round(y))) c.put(x, y, L_WRAP, STRAP, t === 0 ? 4.0 : t === 2 * k - 1 ? 1.8 : 3.0);
    }
    const [bx, by] = dev(dx0 + buckleAt, ly - 0.5);
    for (let yy = 0; yy < 3 * k; yy++) for (let xx = 0; xx < 2.5 * k; xx++) {
      const rim = yy === 0 || xx === 0 || yy === 3 * k - 1 || xx >= 2.5 * k - 1;
      if (!rim && hi) continue;
      if (body(Math.round(bx + xx), Math.round(by + yy))) c.put(bx + xx, by + yy, L_BOSS, FIT, yy === 0 || xx === 0 ? 4.8 : 2.4);
    }
  };
  const missing = (n: number) => noise2(seed + 141, n, 7) < a.gaps * 0.7;
  const jig = (n: number, salt: number) => (1 - clamp(sampleCurve(a.even, 0.5))) * 1.4 * (noise2(seed + 143 + salt, n, 3) - 0.5) * 2;

  if (m === 'brigandine') {
    // three rivet heads across the top of every hidden plate
    const PW = 8, PH = 9;
    let n = 0;
    for (let row = 0; row * PH < g.bottom; row++) for (let col = -6; col <= 6; col++) for (let r = 0; r < 3; r++, n++) {
      const dx = (col + (row % 2 ? 0 : 0.5)) * PW - PW / 2 + PW * (0.25 + r * 0.25) + jig(n, 0);
      const ly = row * PH + 2.6 + jig(n, 1);
      if (Math.abs(dx) > 21.5 && ly < 33 && g.cut !== 'vest') continue; // sleeves are plain cloth
      const [x, y] = dev(dx, ly);
      const xi = Math.round(x), yi = Math.round(y);
      if (!body(xi, yi) || dist[yi * w + xi] < 2.5 * k || c.layer[yi * w + xi] === L_WRAP) continue;
      if (missing(n)) hole(x, y); else rivet(x, y);
    }
    for (const ly of [22, 36, 50]) strap(-6, ly, 12, 7);
  } else if (m === 'plate') {
    // sliding rivets down both sides of the fauld, and the straps at the shoulders
    let n = 0;
    for (let ly = WAIST_Y + 2.5; ly < g.bottom - 1; ly += 6) for (const side of [-1, 1]) {
      const hw = armorHalfWidth(g, ly) - 3.5;
      const [x, y] = dev(side * hw + jig(n, 0), ly + jig(n, 1));
      if (missing(n++)) hole(x, y); else rivet(x, y);
    }
    for (const side of [-1, 1]) {
      strap(side * 13 - 2.5, 7, 5, 1.5);
      const [x, y] = dev(side * 17.5, 22);
      rivet(x, y);
    }
  } else if (m === 'cuirbouilli') {
    // side straps and buckles
    let n = 0;
    for (const ly of [45, 54]) {
      if (ly > g.bottom - 8) continue;
      const hw = armorHalfWidth(g, ly);
      strap(-hw + 0.5, ly, 7, 4.5);
      strap(hw - 7.5, ly, 7, 1);
      for (const side of [-1, 1]) {
        const [x, y] = dev(side * (hw - 8.5) + jig(n, 0), ly + 0.5 + jig(n, 1));
        if (missing(n++)) hole(x, y); else rivet(x, y);
      }
    }
  } else if (m === 'gambeson') {
    // the front opening, closed with pairs of laced points
    for (let y = Math.round((13 + g.oy) * k); y <= (g.bottom + g.oy - 2.6) * k; y++) {
      const x = Math.round(cxd + 0.5);
      if (body(x, y) && c.layer[y * w + x] !== L_WRAP || body(x, y) && c.pal[y * w + x] !== TRIM) c.put(x, y, L_FACE, BODY, 1.5);
      if (hi && body(x - 1, y) && c.pal[y * w + x - 1] !== TRIM) c.put(x - 1, y, L_FACE, BODY, 4.2);
    }
    let n = 0;
    for (let ly = 17; ly < g.bottom - 7; ly += 9, n++) {
      if (missing(n)) continue; // a point never laced
      const tilt = jig(n, 2);
      for (let t = -3 * k; t <= 3 * k; t++) {
        const [x, y] = dev(t / k, ly + (t / (3 * k)) * tilt * 0.8);
        if (body(Math.round(x), Math.round(y))) c.put(x, y, L_WRAP, TRIM, Math.abs(t) > 2 * k ? 2.4 : 4.4);
        if (hi && body(Math.round(x), Math.round(y) + 1)) c.put(x, y + 1, L_WRAP, TRIM, 2.0);
      }
      for (const side of [-1, 1]) { const [x, y] = dev(side * 3.5, ly + side * tilt * 0.8); rivet(x - (hi ? 0.5 : 0), y, FIT); }
    }
  } else if (m === 'mail') {
    // a slit at the throat with a clasp
    for (let y = Math.round((12.5 + g.oy) * k); y <= (19 + g.oy) * k; y++) { const x = Math.round(cxd + 0.5); if (body(x, y)) c.put(x, y, L_GRIP, LINING, 1.4); }
    const [x, y] = dev(0, 14.5);
    rivet(x - (hi ? 0.5 : 0), y);
  }

  // ---- decoration: an emblem on the chest, tooling or etching round it
  const tg = armorToolingGeo(item);
  const bm0 = m === 'mail' || m === 'scale' ? undefined : EMBLEM_BITMAPS[item.decoration.emblem];
  if (bm0) {
    const scale = 2 * k;
    const bm = upscaleBitmap(bm0, scale);
    const n = 7 * scale;
    const ex = Math.round(tg.cx * k + (k - 1) / 2 - n / 2 + 0.5), ey = Math.round(tg.cy * k - n / 2 + 0.5);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (bm[y][x] !== '#') continue;
      const px = ex + x, py = ey + y;
      if (!c.is(px, py, L_FACE)) continue;
      const i = c.idx(px, py);
      c.layer[i] = L_EMBLEM;
      c.addTint(i, ctx.accentRgb, 0.85);
      if (hi && (y + 1 >= n || x + 1 >= n || bm[y + 1][x] !== '#' || bm[y][x + 1] !== '#')) c.shade[i] -= 0.9;
    }
  }
  const e = item.decoration.engraving;
  if (e.pattern !== 'none' && (m === 'cuirbouilli' || m === 'plate')) {
    const paths = engravingPaths(e.pattern, item.seed);
    const slips = new Set(e.slips);
    const toXY = (t: number, u: number, j: number): Pt => {
      const ang = ((t - 0.07) / 0.53) * Math.PI * 2 - Math.PI / 2;
      const rr = 0.66 + (u + j * 0.28) * 0.09;
      return [(tg.cx + Math.cos(ang) * tg.rx * rr) * k + (k - 1) / 2, (tg.cy + Math.sin(ang) * tg.ry * rr) * k + (k - 1) / 2];
    };
    const cut: number[] = [];
    const mark = (px: number, py: number) => {
      if (!c.is(px, py, L_FACE, L_EMBLEM)) return;
      const i = c.idx(px, py);
      c.shade[i] = 1.2 + (1 - e.crispness);
      if (e.inlay) c.addTint(i, ctx.inlayRgb, 0.8);
      cut.push(i);
    };
    let sN = 0;
    for (const p of paths) for (let n = 0; n < p.length; n++, sN++) {
      const j = e.jitter.length ? e.jitter[sN % e.jitter.length] : 0;
      const [x, y] = toXY(p[n][0], p[n][1], j);
      if (n > 0 && !slips.has(sN)) {
        const jp = e.jitter.length ? e.jitter[(sN - 1) % e.jitter.length] : 0;
        const [xp, yp] = toXY(p[n - 1][0], p[n - 1][1], jp);
        line(xp, yp, x, y, mark);
      } else mark(Math.round(x), Math.round(y));
    }
    if (hi) {
      const isCut = new Set(cut);
      for (const i of cut) { const j = i + w + 1; if (j < c.layer.length && !isCut.has(j) && (c.layer[j] === L_FACE || c.layer[j] === L_EMBLEM)) c.shade[j] = Math.min(5, c.shade[j] + 0.7); }
    }
  }
}

// ============================================================ blemish placement
/** Device-pixel position of a blemish on a bow, arrow set or armour (null for other pieces). */
export function craftBlemishPoint(item: Item, t: number, u: number, k: number): [number, number] | null {
  if (item.bow) {
    const sh = bowShape(item);
    const s = clamp((t - 0.43) * 2.3, -0.92, 0.92);
    const s2 = Math.abs(s) < 0.13 ? (s < 0 ? -0.16 : 0.16) : s; // not under the grip wrap
    return [(bowX(item, sh, s2) + u * bowThickness(item, s2) * 0.3) * k, (sh.cy + s2 * sh.half) * k];
  }
  if (item.arrows) {
    const a = item.arrows;
    const i = clamp(Math.floor(((u + 0.6) / 1.2) * a.count), 0, a.count - 1);
    const { nockY, len } = arrowSpan(item);
    const tt = 0.34 + clamp(t) * 0.5; // on the bare shaft, clear of fletching and point
    return [arrowX(item, i, tt, k), (nockY - tt * len) * k];
  }
  if (item.armor) {
    // on the body of the garment, clear of the collar and the hem
    const g = armorGeo(item);
    const ly = 16 + clamp(t) * (g.bottom - 16 - 6);
    const hw = Math.max(4, armorHalfWidth(g, ly) - 4);
    const dx = clamp(u, -1, 1) * hw;
    return [(g.cx + (Math.abs(dx) < 2 ? (dx < 0 ? -2.5 : 2.5) : dx)) * k, (ly + g.oy) * k];
  }
  return null;
}
