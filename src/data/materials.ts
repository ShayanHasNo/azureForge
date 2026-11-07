// Material library. Materials occupy different positions in a balanced design
// space — none is strictly better than another. Potential (props) is separate
// from craftsmanship: props only describe what a material *can* become.

import { rampFrom } from '../core/util.js';

export type MaterialKind = 'metal' | 'crystal' | 'wood' | 'leather' | 'bone' | 'gem' | 'stone';

export interface MaterialProps {
  hardness: number; // edge holding / scratch resistance
  toughness: number; // durability potential
  flexibility: number; // flexibility potential
  density: number; // fictional weight
  workability: number; // how forgiving the minigames are
  decorative: number; // how well it takes engraving, patterning and ornament
  magic: number; // magical affinity (enables glow, celestial work)
  luster: number; // how brightly it can be finished
}

export interface PrepProfile {
  /** Ideal condition on the 0..1 heat gauge */
  ideal: number;
  /** Half-width of the sweet band at beginner difficulty */
  band: number;
  /** How fast the material loses condition */
  cool: number;
  /** Random flare-ups / instability */
  volatility: number;
}

export type HammerRhythm = 'steady' | 'swing' | 'heavy' | 'delicate' | 'syncopated' | 'erratic';

export interface MaterialDef {
  id: string;
  name: string;
  kind: MaterialKind;
  description: string;
  /** Where the player can reliably get it — shown in the journal. */
  source: string;
  palette: string[]; // 6 shades dark→light
  accent?: string; // glow / special colour
  props: MaterialProps;
  rarity: 1 | 2 | 3 | 4 | 5;
  value: number; // gold per unit
  traits: string[];
  prep?: PrepProfile;
  rhythm?: HammerRhythm;
  translucent?: boolean;
  /** Natural affinity — materials that pair well (in compatibility). */
  pairsWith?: string[];
  /** Materials that clash (still allowed, just less compatible). */
  clashesWith?: string[];
  /** Mastery unlocks: creative options only — never stat bonuses. */
  mastery?: { level: number; kind: OptionKind; id: string }[];
}

export type OptionKind = 'profile' | 'tip' | 'guard' | 'pommel' | 'wrap' | 'texture' | 'finish' | 'engraving' | 'emblem' | 'shieldShape' | 'boss';

const P = (h: number, t: number, f: number, d: number, w: number, dec: number, m: number, l: number): MaterialProps => ({
  hardness: h, toughness: t, flexibility: f, density: d, workability: w, decorative: dec, magic: m, luster: l,
});

export const METALS: MaterialDef[] = [
  {
    id: 'brass', name: 'Brass', kind: 'metal', rarity: 1, value: 5,
    description: 'Warm, golden and forgiving. It takes engraving beautifully and carries a quiet, old-world glow.',
    source: 'Always stocked by Hollis at the village general store.',
    palette: ['#3b2410', '#6e4a1c', '#a87a2e', '#d4a64a', '#f0d27a', '#fff2c0'],
    props: P(42, 48, 58, 70, 88, 92, 20, 78),
    traits: ['warm', 'golden', 'decorative', 'traditional'],
    prep: { ideal: 0.5, band: 0.16, cool: 0.11, volatility: 0.05 }, rhythm: 'steady',
    pairsWith: ['copper', 'silver', 'bronze', 'iron'], clashesWith: ['starmetal'],
    mastery: [
      { level: 1, kind: 'engraving', id: 'filigree' },
      { level: 3, kind: 'finish', id: 'rosegold' },
      { level: 5, kind: 'pommel', id: 'gearwheel' },
    ],
  },
  {
    id: 'copper', name: 'Copper', kind: 'metal', rarity: 1, value: 4,
    description: 'Soft and flexible with a rosy sheen. Ages into lovely green patinas.',
    source: 'Always stocked by Hollis at the village general store.',
    palette: ['#3a1a10', '#6e3020', '#a4532f', '#d27b4a', '#efaa7a', '#ffe0c8'],
    props: P(32, 44, 74, 74, 92, 78, 30, 72),
    traits: ['warm', 'rosy', 'soft', 'rustic'],
    prep: { ideal: 0.42, band: 0.17, cool: 0.13, volatility: 0.04 }, rhythm: 'delicate',
    pairsWith: ['brass', 'bronze', 'gardenglass'], clashesWith: ['dragonsteel'],
    mastery: [
      { level: 1, kind: 'finish', id: 'verdigris' },
      { level: 3, kind: 'engraving', id: 'braid' },
      { level: 5, kind: 'texture', id: 'flamebloom' },
    ],
  },
  {
    id: 'bronze', name: 'Bronze', kind: 'metal', rarity: 1, value: 6,
    description: 'The metal of old heroes. Sturdy, honest and steeped in history.',
    source: 'Always stocked by Hollis; Brannoc trades bronze scrap cheaply.',
    palette: ['#2e2010', '#5a4020', '#8a6a34', '#b8924e', '#d8b878', '#f4e2b0'],
    props: P(54, 64, 46, 76, 76, 72, 15, 58),
    traits: ['earthy', 'ancient', 'sturdy', 'traditional'],
    prep: { ideal: 0.55, band: 0.15, cool: 0.1, volatility: 0.05 }, rhythm: 'heavy',
    pairsWith: ['brass', 'copper', 'iron', 'riverstone'],
    mastery: [
      { level: 1, kind: 'emblem', id: 'laurel' },
      { level: 3, kind: 'profile', id: 'kopis' },
      { level: 5, kind: 'finish', id: 'heirloom' },
    ],
  },
  {
    id: 'iron', name: 'Iron', kind: 'metal', rarity: 1, value: 4,
    description: 'Versatile, dependable and predictable. The backbone of every village forge.',
    source: 'Always stocked by Hollis; found at the Old Quarry.',
    palette: ['#1c1e22', '#3a3e44', '#5c626a', '#868c94', '#b0b6bc', '#e0e4e8'],
    props: P(60, 70, 54, 66, 72, 52, 10, 44),
    traits: ['cool', 'practical', 'dependable', 'traditional'],
    prep: { ideal: 0.6, band: 0.15, cool: 0.1, volatility: 0.05 }, rhythm: 'steady',
    pairsWith: ['bronze', 'brass', 'azuresteel', 'riverstone', 'dragonsteel'],
    mastery: [
      { level: 1, kind: 'texture', id: 'forgescale' },
      { level: 3, kind: 'guard', id: 'basket' },
      { level: 5, kind: 'engraving', id: 'tally' },
    ],
  },
  {
    id: 'silver', name: 'Silver', kind: 'metal', rarity: 2, value: 14,
    description: 'Bright and ceremonial with exquisite luster. Heavy, soft, and adored by collectors.',
    source: 'Hollis stocks a little; Lyra trades silver for night-themed work.',
    palette: ['#2c3038', '#5a6270', '#8c96a4', '#bcc6d2', '#dee6ee', '#ffffff'],
    props: P(38, 42, 62, 86, 74, 96, 55, 97),
    traits: ['cool', 'bright', 'ceremonial', 'lunar'],
    prep: { ideal: 0.45, band: 0.14, cool: 0.12, volatility: 0.06 }, rhythm: 'delicate',
    pairsWith: ['brass', 'moonstone', 'starmetal', 'gardenglass'],
    mastery: [
      { level: 1, kind: 'engraving', id: 'lacework' },
      { level: 3, kind: 'finish', id: 'mirror' },
      { level: 5, kind: 'emblem', id: 'chalice' },
    ],
  },
  {
    id: 'azuresteel', name: 'Azuresteel', kind: 'metal', rarity: 2, value: 16,
    description: 'The village\'s signature fantasy steel, folded with blue river-salts. Balanced in nearly every way.',
    source: 'Hollis stocks it once your reputation grows; Brannoc sometimes carries it.',
    palette: ['#121a2e', '#24365a', '#3c5a8c', '#5f86b8', '#94b8e0', '#d8ecff'],
    props: P(72, 74, 64, 62, 56, 60, 35, 72),
    traits: ['cool', 'blue', 'balanced', 'river'],
    prep: { ideal: 0.64, band: 0.12, cool: 0.12, volatility: 0.08 }, rhythm: 'swing',
    pairsWith: ['iron', 'silver', 'moonstone'],
    mastery: [
      { level: 1, kind: 'texture', id: 'riverwave' },
      { level: 3, kind: 'tip', id: 'swallowtail' },
      { level: 5, kind: 'finish', id: 'deepblue' },
    ],
  },
  {
    id: 'moonstone', name: 'Moonstone Alloy', kind: 'metal', rarity: 3, value: 24,
    description: 'A pearly, faintly translucent alloy that weighs almost nothing. Flexible but not especially tough.',
    source: 'Found reliably at Moonlit Lake; Lyra sells a little on clear nights.',
    palette: ['#2a2c3e', '#4c5070', '#7a80a8', '#a8b0d4', '#d0d8f0', '#f4f8ff'],
    accent: '#c8d8ff',
    props: P(54, 48, 82, 28, 50, 82, 70, 82),
    traits: ['cool', 'pearly', 'light', 'lunar', 'translucent'],
    prep: { ideal: 0.36, band: 0.11, cool: 0.18, volatility: 0.09 }, rhythm: 'delicate',
    translucent: true,
    pairsWith: ['silver', 'starmetal', 'gardenglass', 'azuresteel'], clashesWith: ['bronze', 'dragonsteel'],
    mastery: [
      { level: 1, kind: 'emblem', id: 'crescent' },
      { level: 3, kind: 'texture', id: 'tidal' },
      { level: 5, kind: 'finish', id: 'moonlit' },
    ],
  },
  {
    id: 'dragonsteel', name: 'Dragonsteel', kind: 'metal', rarity: 4, value: 32,
    description: 'Ember-dark steel from mountain vents. Enormous durability potential, but heavy, stiff and demanding to work.',
    source: 'Brannoc brings it down from the mountains every Thunderday; deposits at Ember Vents.',
    palette: ['#1a0c0c', '#3c1416', '#6a2420', '#9a3a28', '#c86a3c', '#f0b070'],
    accent: '#ff8a3c',
    props: P(88, 90, 36, 82, 28, 54, 45, 60),
    traits: ['warm', 'dark', 'fiery', 'mountain', 'heavy'],
    prep: { ideal: 0.78, band: 0.09, cool: 0.15, volatility: 0.14 }, rhythm: 'heavy',
    pairsWith: ['iron', 'bronze', 'riverstone'], clashesWith: ['moonstone', 'copper', 'gardenglass'],
    mastery: [
      { level: 1, kind: 'texture', id: 'emberscale' },
      { level: 3, kind: 'guard', id: 'talon' },
      { level: 5, kind: 'finish', id: 'smoulder' },
    ],
  },
  {
    id: 'starmetal', name: 'Star-metal', kind: 'metal', rarity: 4, value: 34,
    description: 'Fallen-star iron that shimmers with tiny points of light. Strongly magical, temperamental at the forge.',
    source: 'Gathered on Starfall Ridge after clear nights; Lyra trades it for celestial work.',
    palette: ['#0c0a20', '#221c4a', '#3c3478', '#6058b0', '#9a90e0', '#e8e0ff'],
    accent: '#b8a8ff',
    props: P(70, 58, 58, 46, 36, 86, 96, 86),
    traits: ['cool', 'celestial', 'starry', 'magical'],
    prep: { ideal: 0.58, band: 0.1, cool: 0.14, volatility: 0.2 }, rhythm: 'erratic',
    pairsWith: ['silver', 'moonstone'], clashesWith: ['brass', 'bronze'],
    mastery: [
      { level: 1, kind: 'engraving', id: 'constellation' },
      { level: 3, kind: 'emblem', id: 'comet' },
      { level: 5, kind: 'texture', id: 'nebula' },
    ],
  },
  {
    id: 'gardenglass', name: 'Gardenglass', kind: 'crystal', rarity: 3, value: 22,
    description: 'Living green crystal grown in the Glassgarden. Very hard and brilliantly clear, but brittle.',
    source: 'Wren grows it in the Glassgarden greenhouse; also found in the Whispering Woods hollow.',
    palette: ['#0e2a24', '#1c5446', '#2e8a6e', '#5cc49a', '#a0ecc8', '#e8fff4'],
    accent: '#a0ffd0',
    props: P(84, 30, 22, 40, 44, 92, 62, 96),
    traits: ['cool', 'verdant', 'translucent', 'delicate', 'nature'],
    prep: { ideal: 0.5, band: 0.1, cool: 0.16, volatility: 0.1 }, rhythm: 'delicate',
    translucent: true,
    pairsWith: ['silver', 'copper', 'moonstone'], clashesWith: ['dragonsteel'],
    mastery: [
      { level: 1, kind: 'engraving', id: 'petal' },
      { level: 3, kind: 'profile', id: 'thorn' },
      { level: 5, kind: 'finish', id: 'prism' },
    ],
  },
];

const wood = (id: string, name: string, base: string, d: Partial<MaterialProps>, value: number, desc: string, source: string, traits: string[], rarity: 1 | 2 | 3 = 1): MaterialDef => ({
  id, name, kind: id.includes('leather') ? 'leather' : id === 'bone' || id === 'antler' ? 'bone' : 'wood',
  description: desc, source, palette: rampFrom(base, 6, 0.7), rarity, value, traits,
  props: { hardness: 40, toughness: 50, flexibility: 50, density: 40, workability: 80, decorative: 50, magic: 10, luster: 30, ...d },
});

export const GRIPS: MaterialDef[] = [
  wood('oak', 'Oak', '#7a5230', { toughness: 62, density: 50 }, 2, 'Solid, comforting, unfussy.', 'Hollis always has oak offcuts.', ['earthy', 'traditional', 'rustic']),
  wood('walnut', 'Walnut', '#5a3a22', { decorative: 64, density: 48 }, 3, 'Dark, rich grain with a satin feel.', 'Hollis stocks walnut.', ['warm', 'elegant']),
  wood('birch', 'Birch', '#cdb88e', { density: 34, flexibility: 60 }, 2, 'Pale and light, like winter mornings.', 'Whispering Woods, always.', ['light', 'nature', 'pale']),
  wood('ebony', 'Ebony', '#2a201c', { hardness: 62, density: 62, decorative: 72 }, 8, 'Near-black and glassy smooth.', 'Fennick sometimes trades ebony.', ['dark', 'elegant', 'ceremonial'], 2),
  wood('leather', 'Tanned Leather', '#8a5530', { toughness: 58, density: 30 }, 2, 'Supple, grippy, honest.', 'Hollis always stocks leather.', ['warm', 'practical', 'rustic']),
  wood('blackleather', 'Black Leather', '#2e2424', { toughness: 58, density: 30, decorative: 58 }, 3, 'Dyed leather for sterner pieces.', 'Hollis stocks it.', ['dark', 'practical']),
  wood('bone', 'Bone', '#e2d8be', { hardness: 54, decorative: 70, density: 46 }, 4, 'Pale and carved-looking. Brannoc swears it brings luck.', 'Brannoc trades bone.', ['ancient', 'pale', 'rustic']),
  wood('antler', 'Antler', '#b89a74', { toughness: 64, decorative: 66, density: 44 }, 5, 'Shed antler from the woods — no two alike.', 'Whispering Woods (autumn especially).', ['nature', 'rustic', 'wild'], 2),
  wood('willowglass', 'Willowglass', '#7ad0b0', { hardness: 66, decorative: 82, magic: 40, luster: 70, density: 32 }, 10, 'Glassgarden willow — wood that half-remembers being crystal.', 'Wren, at the Glassgarden.', ['nature', 'translucent', 'verdant'], 3),
];

const gem = (id: string, name: string, base: string, value: number, traits: string[], source: string, rarity: 1 | 2 | 3 | 4 = 2, magic = 30): MaterialDef => ({
  id, name, kind: 'gem', description: `${name} — ${traits.join(', ')}.`, source,
  palette: rampFrom(base, 6, 0.75), rarity, value, traits,
  props: { hardness: 80, toughness: 40, flexibility: 0, density: 30, workability: 60, decorative: 90, magic, luster: 90 },
});

export const GEMS: MaterialDef[] = [
  gem('quartz', 'River Quartz', '#e6e8f2', 3, ['clear', 'humble'], 'Riverbank and the Old Quarry.', 1, 15),
  gem('garnet', 'Garnet', '#a01830', 8, ['warm', 'deep red'], 'Old Quarry; Hollis stocks a few.', 2),
  gem('amber', 'Amber', '#e09020', 6, ['warm', 'nature', 'golden'], 'Whispering Woods.', 1, 20),
  gem('jade', 'Jade', '#4aa070', 9, ['nature', 'verdant', 'calm'], 'Wren trades jade.', 2),
  gem('sapphire', 'Sapphire', '#2840c0', 14, ['cool', 'deep blue', 'regal'], 'Fennick trades sapphires.', 3),
  gem('moonpearl', 'Moonpearl', '#e8e4f4', 12, ['lunar', 'pearly'], 'Moonlit Lake.', 2, 60),
  gem('starshard', 'Starshard', '#b6a0ff', 18, ['celestial', 'glowing'], 'Starfall Ridge.', 3, 95),
  gem('emberstone', 'Emberstone', '#ff6a2a', 16, ['fiery', 'mountain', 'glowing'], 'Ember Vents.', 3, 70),
];

export const STONES: MaterialDef[] = [
  { id: 'riverstone', name: 'Riverstone', kind: 'stone', rarity: 1, value: 1, description: 'Smooth river pebbles, grey-green and speckled.', source: 'Riverbank, always.', palette: rampFrom('#7a8476', 6, 0.6), traits: ['earthy', 'mountain', 'river'], props: P(60, 50, 0, 70, 70, 60, 10, 30) },
  { id: 'slate', name: 'Slate Chips', kind: 'stone', rarity: 1, value: 1, description: 'Dark layered slate from the quarry.', source: 'Old Quarry, always.', palette: rampFrom('#4a4e58', 6, 0.6), traits: ['earthy', 'mountain', 'dark'], props: P(55, 45, 0, 70, 70, 55, 10, 25) },
  { id: 'obsidian', name: 'Obsidian Flake', kind: 'stone', rarity: 2, value: 5, description: 'Volcanic glass, black with a rainbow sheen.', source: 'Ember Vents.', palette: rampFrom('#2a2430', 6, 0.7), traits: ['dark', 'mountain', 'fiery'], props: P(80, 30, 0, 50, 50, 80, 30, 90) },
];

export const ALL_MATERIALS: MaterialDef[] = [...METALS, ...GRIPS, ...GEMS, ...STONES];
const BY_ID = new Map(ALL_MATERIALS.map((m) => [m.id, m]));

export function mat(id: string): MaterialDef {
  const m = BY_ID.get(id);
  if (!m) throw new Error(`Unknown material ${id}`);
  return m;
}
export function hasMat(id: string): boolean {
  return BY_ID.has(id);
}

/** Compatibility between two materials, 0..1 (0.5 = neutral). */
export function compatibility(a: string, b: string): number {
  if (a === b) return 0.7;
  const A = BY_ID.get(a), B = BY_ID.get(b);
  if (!A || !B) return 0.5;
  let c = 0.55;
  if (A.pairsWith?.includes(b) || B.pairsWith?.includes(a)) c += 0.3;
  if (A.clashesWith?.includes(b) || B.clashesWith?.includes(a)) c -= 0.3;
  const shared = A.traits.filter((t) => B.traits.includes(t)).length;
  c += Math.min(0.15, shared * 0.05);
  return Math.max(0, Math.min(1, c));
}

/** Difficulty contribution of a material (0 = easy, 1 = hardest). */
export function materialDifficulty(id: string): number {
  const m = BY_ID.get(id);
  if (!m) return 0.3;
  return Math.max(0, Math.min(1, (90 - m.props.workability) / 65));
}

/** Units of primary material each category needs. */
export const UNIT_COST: Record<string, { primary: number; secondary: number; grip: number }> = {
  sword: { primary: 3, secondary: 1, grip: 1 },
  dagger: { primary: 2, secondary: 1, grip: 1 },
  shield: { primary: 3, secondary: 2, grip: 1 },
};

/** Mastery XP thresholds per level. */
export const MASTERY_XP = [0, 1, 3, 6, 10, 15];
export function masteryLevel(xp: number): number {
  let lvl = 0;
  for (let i = 0; i < MASTERY_XP.length; i++) if (xp >= MASTERY_XP[i]) lvl = i;
  return lvl;
}
