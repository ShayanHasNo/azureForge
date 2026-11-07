// Damascus forging for daggers.
//
// A Damascus dagger carries a *pattern index* from 1 to 1000. The index alone
// decides what the pattern looks like (every #437 is the same #437), the way a
// paint seed does on a collectible knife. The *visibility* of the pattern comes
// from how well the billet was forged plus a seeded roll — even a flawless
// forge never reaches 100%. Certain metal pairs can, very rarely, bloom into a
// prized colour.
//
// Everything here is pure and deterministic (no DOM), so the renderer, the
// tests and the showcase server all agree on the same results.

import { hash32, hashString, seededRng } from '../core/rng.js';

export const PATTERN_COUNT = 1000;

export interface DamascusData {
  /** Pattern index, 1..1000. Derived from the item seed. */
  index: number;
  /** Pattern visibility 0..1 (never quite 1). */
  visibility: number;
  /** Forge quality 0..1 measured in the Damascus forging minigame. */
  forge: number;
  /** Number of layers in the billet (informational). */
  layers: number;
  /** Rare colour id, if one bloomed. */
  color?: string;
}

// ---------------------------------------------------------------- pattern index
export function patternIndexFor(seed: number): number {
  return seededRng(seed, 'damascus-index').int(1, PATTERN_COUNT);
}

export type PatternFamily =
  | 'wave' | 'ladder' | 'raindrop' | 'twist' | 'feather' | 'chevron' | 'herringbone' | 'ripple' | 'mosaic' | 'starburst';

export const FAMILY_INFO: Record<PatternFamily, { name: string; weight: number; blurb: string }> = {
  wave: { name: 'Wave', weight: 14, blurb: 'Long rolling layers, like a tide drawn in steel.' },
  ladder: { name: 'Ladder', weight: 12, blurb: 'Flowing layers crossed by regular rungs.' },
  raindrop: { name: 'Raindrop', weight: 12, blurb: 'Rings spreading like rain on still water.' },
  twist: { name: 'Twist', weight: 12, blurb: 'Bars of twisted billet, alternating in direction.' },
  feather: { name: 'Feather', weight: 11, blurb: 'Layers split down the spine and swept back like a quill.' },
  chevron: { name: 'Chevron', weight: 10, blurb: 'Crisp nested arrows pointing to the tip.' },
  herringbone: { name: 'Herringbone', weight: 9, blurb: 'Alternating diagonal panels, tightly woven.' },
  ripple: { name: 'Ripple', weight: 12, blurb: 'Wandering, organic layers — no two lines alike.' },
  mosaic: { name: 'Mosaic', weight: 6, blurb: 'Tiles of layered steel set at different angles.' },
  starburst: { name: 'Starburst', weight: 2, blurb: 'Layers radiating from a single bright point. Very rare.' },
};

const FAMILIES = Object.keys(FAMILY_INFO) as PatternFamily[];
const FAMILY_TOTAL = FAMILIES.reduce((a, f) => a + FAMILY_INFO[f].weight, 0);

/** A handful of indexes are named and hand-tuned. Collectors hunt for these. */
export const NAMED_PATTERNS: Record<number, { name: string; family: PatternFamily; tweak?: Partial<PatternSpec> }> = {
  1: { name: 'First Light', family: 'starburst', tweak: { freq: 9, cx: 0.5, sharp: 0.2 } },
  7: { name: 'Seven Seas', family: 'wave', tweak: { freq: 7, warp: 0.55, warpFreq: 1.5 } },
  77: { name: 'Twin Rivers', family: 'feather', tweak: { freq: 11, twist: 2.4, warp: 0.3 } },
  128: { name: 'Binary Bloom', family: 'mosaic', tweak: { freq: 8, cells: 8 } },
  333: { name: 'Thorn Crown', family: 'chevron', tweak: { freq: 13, twist: 3.2, sharp: 0.12 } },
  500: { name: 'Halfway Tide', family: 'raindrop', tweak: { freq: 10, cells: 5 } },
  777: { name: 'Lucky Strike', family: 'twist', tweak: { freq: 14, twist: 3.5, cells: 7 } },
  1000: { name: 'The Last Fold', family: 'ladder', tweak: { freq: 16, warp: 0.35, cells: 10, sharp: 0.1 } },
};

export interface PatternSpec {
  index: number;
  family: PatternFamily;
  name?: string;
  /** Layer bands along the blade. */
  freq: number;
  phase: number;
  warp: number;
  warpFreq: number;
  twist: number;
  /** Cell / rung / bar count along the blade. */
  cells: number;
  /** Band edge softness (smaller = crisper). */
  sharp: number;
  /** Starburst / focal point along the blade. */
  cx: number;
  /** Noise seed for organic families. */
  noise: number;
}

const specCache = new Map<number, PatternSpec>();

export function patternSpec(index: number): PatternSpec {
  const idx = clampIndex(index);
  const hit = specCache.get(idx);
  if (hit) return hit;
  const r = seededRng(hash32(idx, 0xda5c05), 'damascus-spec');
  let roll = r.next() * FAMILY_TOTAL;
  let family: PatternFamily = 'wave';
  for (const f of FAMILIES) {
    roll -= FAMILY_INFO[f].weight;
    if (roll < 0) { family = f; break; }
  }
  let spec: PatternSpec = {
    index: idx,
    family,
    freq: r.range(6, 18),
    phase: r.next(),
    warp: r.range(0.05, 0.5),
    warpFreq: r.range(0.6, 2.6),
    twist: r.range(0.8, 3.4),
    cells: r.int(3, 9),
    sharp: r.range(0.1, 0.32),
    cx: r.range(0.3, 0.7),
    noise: hash32(idx, 0x5eed),
  };
  const named = NAMED_PATTERNS[idx];
  if (named) spec = { ...spec, ...named.tweak, family: named.family, name: named.name };
  specCache.set(idx, spec);
  return spec;
}

function clampIndex(i: number) {
  const n = Math.round(Number(i) || 1);
  return Math.min(PATTERN_COUNT, Math.max(1, n));
}

const TAU = Math.PI * 2;
const frac = (v: number) => v - Math.floor(v);
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Small smooth noise (independent of the item seed — the index decides everything). */
function vnoise(seed: number, x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const n = (a: number, b: number) => hash32(seed, a, b) / 4294967296;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = n(xi, yi), b = n(xi + 1, yi), c = n(xi, yi + 1), d = n(xi + 1, yi + 1);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Blade width relative to length — keeps isotropic patterns round on a thin blade. */
const ASPECT = 0.2;

/**
 * Pattern intensity at blade-local coordinates. `t` runs 0 (guard) → 1 (tip),
 * `u` runs -1 (left edge) → 1 (right edge). Returns 0..1, where 1 is a bright
 * (secondary-metal) layer.
 */
export function damascusField(spec: PatternSpec, t: number, u: number): number {
  const { freq, phase, warp, warpFreq, twist, cells, noise } = spec;
  const uw = u * ASPECT; // u in "blade length" units
  let g: number;
  switch (spec.family) {
    case 'wave':
      g = t * freq + warp * 2 * Math.sin(TAU * (u * warpFreq * 0.5 + t * warpFreq + phase));
      break;
    case 'ladder': {
      const rung = Math.exp(-Math.pow((frac(t * cells + phase) - 0.5) / 0.12, 2));
      g = t * freq + warp * Math.sin(TAU * (u * warpFreq * 0.4 + phase)) + rung * 1.4 * (0.6 + 0.4 * Math.cos(u * Math.PI));
      break;
    }
    case 'raindrop': {
      const cy = t * cells, cu = (u + 1) * 0.5 * Math.max(1, cells * ASPECT * 2);
      const ix = Math.floor(cy), iu = Math.floor(cu);
      let best = 9;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const jx = ix + a + 0.2 + 0.6 * (hash32(noise, ix + a, iu + b) / 4294967296);
        const ju = iu + b + 0.2 + 0.6 * (hash32(noise + 1, ix + a, iu + b) / 4294967296);
        const d = Math.hypot(cy - jx, (cu - ju) * 0.9);
        if (d < best) best = d;
      }
      g = best * freq * 0.45 + t * freq * 0.25 + phase;
      break;
    }
    case 'twist': {
      const bar = Math.floor(t * cells);
      const dir = bar % 2 === 0 ? 1 : -1;
      g = t * freq * 0.6 + dir * u * twist * 1.6 + phase + 0.3 * Math.sin(TAU * frac(t * cells));
      break;
    }
    case 'feather':
      g = t * freq - twist * Math.pow(Math.abs(u), 0.65) * 1.4 + warp * Math.sin(TAU * (t * warpFreq * 2 + phase)) * 0.6 + (u < 0 ? 0.5 * warp : 0);
      break;
    case 'chevron':
      g = t * freq - twist * Math.abs(u) * 1.2 + phase;
      break;
    case 'herringbone': {
      const panel = Math.floor(t * cells * 1.5);
      const dir = panel % 2 === 0 ? 1 : -1;
      g = t * freq * 0.5 + dir * u * twist * 2.2 + phase;
      break;
    }
    case 'ripple':
      g = t * freq + (vnoise(noise, t * warpFreq * 4, u * warpFreq * 1.5) - 0.5) * (2 + warp * 6) + phase;
      break;
    case 'mosaic': {
      const ct = Math.floor(t * cells), cu = u < 0 ? 0 : 1;
      const ang = (hash32(noise, ct, cu) / 4294967296) * Math.PI;
      const lt = frac(t * cells) - 0.5, lu = (u - (cu ? 0.5 : -0.5)) * 0.9;
      g = (lt * Math.cos(ang) + lu * Math.sin(ang)) * freq * 0.6 + phase + ct * 0.37;
      break;
    }
    case 'starburst': {
      const dt = t - spec.cx, du = uw * 1.4;
      const ang = Math.atan2(du, dt);
      const dist = Math.hypot(dt, du);
      g = (ang / TAU) * Math.round(cells * 2 + 6) + dist * freq * 0.8 + phase;
      break;
    }
  }
  const v = 0.5 + 0.5 * Math.sin(TAU * g);
  return smooth(0.5 - spec.sharp, 0.5 + spec.sharp, v);
}

/** Sample the pattern into a w×h grid (t across x, u across y). Pure — used by swatches and tests. */
export function samplePattern(index: number, w: number, h: number): Float32Array {
  const spec = patternSpec(index);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const u = h > 1 ? (y / (h - 1)) * 2 - 1 : 0;
    for (let x = 0; x < w; x++) out[y * w + x] = damascusField(spec, (x + 0.5) / w, u);
  }
  return out;
}

// ---------------------------------------------------------------- visibility
export const VISIBILITY_CAP = 0.985;

/**
 * Pattern visibility from forge quality plus a seeded roll. A perfect forge
 * lands between roughly 78% and 98.5% and only rarely above 95%.
 */
export function visibilityFor(seed: number, forge: number): number {
  const f = Math.min(1, Math.max(0, Number(forge) || 0));
  const r = seededRng(seed, 'damascus-vis').next();
  const roll = 0.78 + 0.205 * r * r;
  const v = 0.03 + 0.97 * Math.pow(f, 1.4) * roll;
  return Math.round(Math.min(VISIBILITY_CAP, Math.max(0.02, v)) * 10000) / 10000;
}

export const VISIBILITY_BANDS: { min: number; name: string }[] = [
  { min: 0.85, name: 'Pristine' },
  { min: 0.6, name: 'Vivid' },
  { min: 0.35, name: 'Clear' },
  { min: 0.15, name: 'Faint' },
  { min: 0, name: 'Ghost' },
];

export function visibilityBand(v: number): string {
  return (VISIBILITY_BANDS.find((b) => v >= b.min) ?? VISIBILITY_BANDS[VISIBILITY_BANDS.length - 1]).name;
}

export function formatVisibility(v: number): string {
  return `${(Math.round(v * 10000) / 100).toFixed(2)}%`;
}

// ---------------------------------------------------------------- rare colours
export interface RareColor { id: string; name: string; hex: string; hex2?: string; pair: [string, string]; chance: number; blurb: string }

export const RARE_COLORS: RareColor[] = [
  { id: 'frostvein', name: 'Frostvein', hex: '#9fd8ff', pair: ['iron', 'silver'], chance: 0.02, blurb: 'Pale winter-blue veins, as if the steel had frozen mid-fold.' },
  { id: 'emberrose', name: 'Ember Rose', hex: '#ff7a8a', pair: ['bronze', 'copper'], chance: 0.02, blurb: 'Layers glowing the soft pink of a dying coal.' },
  { id: 'sunsetgold', name: 'Sunset Gold', hex: '#ffb347', pair: ['brass', 'copper'], chance: 0.018, blurb: 'Warm bands of evening gold.' },
  { id: 'bloodmoon', name: 'Bloodmoon', hex: '#d0283e', pair: ['dragonsteel', 'iron'], chance: 0.01, blurb: 'Deep crimson layers that seem to drink the light.' },
  { id: 'abyssalteal', name: 'Abyssal Teal', hex: '#2fd6c8', pair: ['azuresteel', 'moonstone'], chance: 0.008, blurb: 'The cold, luminous teal of deep water.' },
  { id: 'voidviolet', name: 'Void Violet', hex: '#8a5cff', pair: ['silver', 'starmetal'], chance: 0.006, blurb: 'Violet layers flecked like the night between stars.' },
  { id: 'aurora', name: 'Aurora', hex: '#7cffc4', hex2: '#b07cff', pair: ['dragonsteel', 'starmetal'], chance: 0.004, blurb: 'Shifting green-to-violet bands. Almost never seen.' },
];

const pairKey = (a: string, b: string) => [a, b].sort().join('+');
const COLOR_BY_PAIR = new Map(RARE_COLORS.map((c) => [pairKey(c.pair[0], c.pair[1]), c]));
const COLOR_BY_ID = new Map(RARE_COLORS.map((c) => [c.id, c]));

export function rareColor(id?: string): RareColor | undefined {
  return id ? COLOR_BY_ID.get(id) : undefined;
}

/** The rare colour this metal pair *could* produce, if any. */
export function rareColorForPair(primary: string, secondary: string): RareColor | undefined {
  if (!primary || !secondary || primary === secondary) return undefined;
  return COLOR_BY_PAIR.get(pairKey(primary, secondary));
}

export function rareColorChance(primary: string, secondary: string, forge: number): number {
  const c = rareColorForPair(primary, secondary);
  if (!c) return 0;
  const f = Math.min(1, Math.max(0, Number(forge) || 0));
  return c.chance * (0.4 + 0.6 * f);
}

/** One seeded roll — reproducible from item data so it can be verified. */
export function rollRareColor(seed: number, primary: string, secondary: string, forge: number): string | undefined {
  const c = rareColorForPair(primary, secondary);
  if (!c) return undefined;
  const r = seededRng(seed, 'damascus-color').next();
  return r < rareColorChance(primary, secondary, forge) ? c.id : undefined;
}

// ---------------------------------------------------------------- building & describing
export function rollDamascus(seed: number, primary: string, secondary: string, forge: number, layers: number): DamascusData {
  const f = Math.round(Math.min(1, Math.max(0, Number(forge) || 0)) * 10000) / 10000;
  const d: DamascusData = {
    index: patternIndexFor(seed),
    visibility: visibilityFor(seed, f),
    forge: f,
    layers: Math.max(2, Math.min(256, Math.round(layers) || 32)),
  };
  const color = rollRareColor(seed, primary, secondary, f);
  if (color) d.color = color;
  return d;
}

/** Re-derive the parts of a Damascus record that must follow from the item data. */
export function damascusConsistent(seed: number, primary: string, secondary: string, d: DamascusData): boolean {
  if (d.index !== patternIndexFor(seed)) return false;
  if (Math.abs(d.visibility - visibilityFor(seed, d.forge)) > 0.0002) return false;
  return (d.color ?? undefined) === rollRareColor(seed, primary, secondary, d.forge);
}

export function patternTitle(index: number): string {
  const s = patternSpec(index);
  return s.name ? `${FAMILY_INFO[s.family].name} — “${s.name}”` : FAMILY_INFO[s.family].name;
}

export function describeDamascus(d: DamascusData): string {
  const parts = [`Pattern #${d.index}`, patternTitle(d.index), `${formatVisibility(d.visibility)} ${visibilityBand(d.visibility)}`];
  const c = rareColor(d.color);
  if (c) parts.push(c.name);
  return parts.join(' · ');
}

/** Showcase sort score only (rare colour > named pattern > visibility). Never used for in-game value. */
export function damascusPrestige(d?: DamascusData): number {
  if (!d) return 0;
  const c = rareColor(d.color);
  return (c ? 1000 + Math.round((1 - c.chance * 40) * 100) : 0) + (patternSpec(d.index).name ? 200 : 0) + d.visibility * 100;
}

/** Stable short hash of a pattern for tests. */
export function patternHash(index: number, w = 48, h = 12): number {
  const s = samplePattern(index, w, h);
  let str = '';
  for (let i = 0; i < s.length; i++) str += s[i] > 0.5 ? '1' : '0';
  return hashString(str);
}
