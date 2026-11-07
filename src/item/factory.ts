import { newId, newSeed } from '../core/rng';
import { palette } from '../data/options';
import { Category, Item, ITEM_VERSION } from './types';

export const SEGMENTS = 10;
const zeros = (n: number) => new Array(n).fill(0);

export const CATEGORY_INFO: Record<Category, { name: string; lengthRange: [number, number]; widthRange: [number, number]; gripRange: [number, number]; size: [number, number] }> = {
  sword: { name: 'Sword', lengthRange: [70, 118], widthRange: [3, 7], gripRange: [14, 26], size: [64, 176] },
  dagger: { name: 'Dagger', lengthRange: [32, 56], widthRange: [3, 6], gripRange: [11, 17], size: [48, 112] },
  shield: { name: 'Shield', lengthRange: [0, 0], widthRange: [0, 0], gripRange: [0, 0], size: [88, 104] },
};

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
