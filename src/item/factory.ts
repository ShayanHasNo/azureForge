import { newId, newSeed } from '../core/rng.js';
import { palette } from '../data/options.js';
import { Category, Item, ITEM_VERSION } from './types.js';

export const SEGMENTS = 10;
/** Sections per bow limb that tillering works on. */
export const BOW_SECTIONS = 6;
/** Arrows in a matched set. */
export const ARROW_COUNT = 6;
const zeros = (n: number) => new Array(n).fill(0);

export const CATEGORY_INFO: Record<Category, { name: string; lengthRange: [number, number]; widthRange: [number, number]; gripRange: [number, number]; size: [number, number] }> = {
  sword: { name: 'Sword', lengthRange: [70, 118], widthRange: [3, 7], gripRange: [14, 26], size: [64, 176] },
  dagger: { name: 'Dagger', lengthRange: [32, 56], widthRange: [3, 6], gripRange: [11, 17], size: [48, 112] },
  shield: { name: 'Shield', lengthRange: [0, 0], widthRange: [0, 0], gripRange: [0, 0], size: [88, 104] },
  bow: { name: 'Bow', lengthRange: [120, 164], widthRange: [0, 0], gripRange: [0, 0], size: [56, 176] },
  arrows: { name: 'Arrows', lengthRange: [88, 112], widthRange: [0, 0], gripRange: [0, 0], size: [96, 128] },
  armor: { name: 'Body armour', lengthRange: [0, 0], widthRange: [0, 0], gripRange: [0, 0], size: [96, 112] },
};

/**
 * What the workshop offers. Body armour is drafted in the code (stages, minigames, sprites) but is
 * not finished or offered: it cannot be started, bought for, filtered by, or posted to the showcase.
 */
export const CRAFTABLE: Category[] = ['sword', 'dagger', 'shield', 'bow', 'arrows'];
export const isCraftable = (c: string): c is Category => (CRAFTABLE as string[]).includes(c);

export function createDraft(category: Category, tradition: string, creator: string, day: number, season: string, seed = newSeed()): Item {
  const pal = palette('hearth');
  const item: Item = {
    id: newId('it'),
    version: ITEM_VERSION,
    seed,
    category,
    tradition,
    name: 'Unnamed Work',
    creator,
    createdDay: day,
    createdSeason: season,
    createdAt: Date.now(),
    design: { direction: 'elegant', motif: 'none', palette: 'hearth', intents: [] },
    materials: { primary: 'iron', secondary: 'brass', grip: 'oak' },
    structure: { approach: 'balanced' },
    surface: { texture: 'smooth', zones: zeros(8).map(() => 0.6), layers: 0, patternClarity: 0, fusion: 0 },
    decoration: {
      engraving: { pattern: 'none', jitter: [], slips: [], crispness: 0.7, inlay: false },
      inscription: '',
      gems: [],
      emblem: 'none',
      stones: [],
    },
    finish: { finish: 'matte' },
    quality: {},
    blemishes: [],
    mutations: [],
    history: [],
    tags: [],
  };
  if (category === 'shield') {
    item.shield = { shape: 'round', width: 64, height: 64, rim: 3, boss: 'dome', faceMaterial: 'oak', planks: 5, dents: zeros(8), rimGap: 0 };
  } else if (category === 'bow') {
    item.design.method = 'self';
    item.materials = { primary: 'ash', secondary: 'linenthread', grip: 'leather' };
    item.bow = {
      profile: 'longbow', length: 148, limb: 3, upper: zeros(BOW_SECTIONS), lower: zeros(BOW_SECTIONS), draw: 0.7, hinge: 0,
      backing: '', belly: '', glue: 0.8, string: 'linenthread', stringQuality: 0.7, nock: '', gripMaterial: 'leather', wrapColor: pal.wrap,
    };
  } else if (category === 'arrows') {
    item.materials = { primary: 'cedar', secondary: 'iron', grip: 'goose' };
    item.arrows = {
      count: ARROW_COUNT, length: 100, point: 'bodkin', fletch: 'parabolic', nock: '', binding: 'linenthread', crest: pal.accent,
      straight: new Array(ARROW_COUNT).fill(0.8), spine: zeros(ARROW_COUNT), fletchErr: zeros(ARROW_COUNT), pointQuality: 0.7,
    };
  } else if (category === 'armor') {
    item.design.method = 'gambeson';
    item.materials = { primary: 'linen', secondary: 'brass', grip: 'wool' };
    item.armor = { method: 'gambeson', cut: 'jack', even: new Array(8).fill(0.75), gaps: 0.1, dents: zeros(8), trimColor: pal.accent };
  } else {
    const isDagger = category === 'dagger';
    item.blade = {
      length: isDagger ? 44 : 96,
      width: isDagger ? 4 : 5,
      profile: 'straight', tip: 'point', curve: 0, thickness: 0.5, fuller: 'single',
      leftDev: zeros(SEGMENTS), rightDev: zeros(SEGMENTS), wobble: zeros(SEGMENTS), asymmetry: 0,
    };
    item.hilt = {
      guard: 'straight', guardWidth: isDagger ? 9 : 13, gripLength: isDagger ? 13 : 19, gripMaterial: 'oak',
      wrap: 'spiral', wrapColor: pal.wrap, pommel: 'round', guardOffset: 0, guardTilt: 0, pommelOffset: 0,
    };
  }
  return item;
}

export function cloneItem<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

export function displayName(item: Item): string {
  return item.customName?.trim() || item.name;
}
