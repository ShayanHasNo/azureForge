// Persistent game state and the small calendar that paces the game. No timers:
// time only moves when the player chooses (finishing a piece, exploring, resting).

import { hash32, newSeed } from '../core/rng';
import type { Item } from '../item/types';

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export type Season = (typeof SEASONS)[number];
export const PHASES = ['morning', 'afternoon', 'evening', 'night'] as const;
export type Phase = (typeof PHASES)[number];
export const WEEKDAYS = ['Moonday', 'Tideday', 'Windsday', 'Thunderday', 'Fireday', 'Starday', 'Sunday'];
export const DAYS_PER_SEASON = 12;

export interface Settings {
  master: number;
  music: number;
  ambient: number;
  sfx: number;
  difficulty: 'relaxed' | 'adaptive' | 'challenging';
  reducedMotion: boolean;
  highContrast: boolean;
  colorblind: boolean;
  uiScale: number;
  showDetailedStats: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8, music: 0.45, ambient: 0.6, sfx: 0.8, difficulty: 'adaptive',
  reducedMotion: false, highContrast: false, colorblind: false, uiScale: 1, showDetailedStats: false,
};

export interface Request {
  id: string;
  template: string;
  npc: string;
  postedDay: number;
}

export interface GameState {
  version: number;
  playerName: string;
  workshopName: string;
  worldSeed: number;
  day: number; // 1-based absolute day
  phase: number; // index into PHASES
  gold: number;
  reputation: number;
  materials: Record<string, number>;
  items: Item[];
  mastery: Record<string, number>;
  relationships: Record<string, number>;
  traditions: string[];
  journals: string[];
  upgrades: string[];
  decor: { wall: string; floor: string; lighting: string; window: string; forge: string; shelves: string };
  ownedDecor: string[]; // "slot:id"
  extras: string[]; // owned & enabled
  ownedExtras: string[];
  displayed: string[]; // item ids on the workshop rack
  gallery: string[]; // item ids in the collection room
  requests: Request[];
  completedRequests: string[];
  locations: string[]; // discovered
  locationVisits: Record<string, number>;
  combos: string[]; // discovered "a+b" pairings
  challenges: string[]; // completed challenge ids
  merchantSales: Record<string, number>; // "day:merchant:item" → bought
  log: { day: number; text: string }[];
  seen: Record<string, boolean>; // tutorial/dialogue flags
  stats: { crafted: number; sold: number; gifted: number; requests: number; explored: number; earned: number };
  settings: Settings;
  draft?: { item: Item; stages: string[]; index: number; materialsPaid: boolean } | null;
}

export function newGame(playerName = 'Smith', workshopName = 'The Quiet Forge'): GameState {
  return {
    version: 1,
    playerName,
    workshopName,
    worldSeed: newSeed(),
    day: 1,
    phase: 0,
    gold: 60,
    reputation: 0,
    materials: { iron: 6, brass: 6, copper: 3, bronze: 2, oak: 3, leather: 3, walnut: 1, riverstone: 2, quartz: 1 },
    items: [],
    mastery: {},
    relationships: { hollis: 2 },
    traditions: ['foundry'],
    journals: [],
    upgrades: [],
    decor: { wall: 'planks', floor: 'boards', lighting: 'candles', window: 'small', forge: 'brick', shelves: 'rack1' },
    ownedDecor: ['wall:planks', 'floor:boards', 'lighting:candles', 'window:small', 'forge:brick', 'shelves:rack1'],
    extras: ['cat'],
    ownedExtras: ['cat'],
    displayed: [],
    gallery: [],
    requests: [],
    completedRequests: [],
    locations: ['riverbank', 'woods', 'quarry'],
    locationVisits: {},
    combos: [],
    challenges: [],
    merchantSales: {},
    log: [{ day: 1, text: 'You unlock the door of your grandmother\'s workshop. The forge is cold, but the anvil still rings.' }],
    seen: {},
    stats: { crafted: 0, sold: 0, gifted: 0, requests: 0, explored: 0, earned: 0 },
    settings: { ...DEFAULT_SETTINGS },
    draft: null,
  };
}

// ---------------------------------------------------------------- calendar
export function seasonOf(day: number): Season {
  return SEASONS[Math.floor((day - 1) / DAYS_PER_SEASON) % 4];
}
export function dayOfSeason(day: number): number {
  return ((day - 1) % DAYS_PER_SEASON) + 1;
}
export function year(day: number): number {
  return Math.floor((day - 1) / (DAYS_PER_SEASON * 4)) + 1;
}
export function weekday(day: number): string {
  return WEEKDAYS[(day - 1) % 7];
}
export function phaseName(s: GameState): Phase {
  return PHASES[s.phase];
}
export function dateLabel(s: GameState): string {
  return `${weekday(s.day)}, ${dayOfSeason(s.day)} ${seasonOf(s.day)} · Year ${year(s.day)}`;
}
export function isSeasonalMarket(day: number): boolean {
  return dayOfSeason(day) >= DAYS_PER_SEASON - 1;
}
export type Weather = 'clear' | 'cloudy' | 'rain' | 'snow';
export function weatherOf(s: GameState, day = s.day): Weather {
  const h = hash32(s.worldSeed, day, 77) % 100;
  const season = seasonOf(day);
  if (season === 'Winter') return h < 30 ? 'snow' : h < 55 ? 'cloudy' : 'clear';
  if (season === 'Autumn') return h < 30 ? 'rain' : h < 55 ? 'cloudy' : 'clear';
  if (season === 'Spring') return h < 25 ? 'rain' : h < 45 ? 'cloudy' : 'clear';
  return h < 12 ? 'rain' : h < 30 ? 'cloudy' : 'clear';
}

export function addLog(s: GameState, text: string) {
  s.log.unshift({ day: s.day, text });
  if (s.log.length > 80) s.log.length = 80;
}

/** Advance time by one phase. Returns true if a new day began. */
export function advancePhase(s: GameState): boolean {
  if (s.phase < PHASES.length - 1) {
    s.phase++;
    return false;
  }
  s.phase = 0;
  s.day++;
  return true;
}

export function addMaterial(s: GameState, id: string, n: number) {
  s.materials[id] = Math.max(0, (s.materials[id] ?? 0) + n);
  if (s.materials[id] === 0) delete s.materials[id];
}
export function hasMaterials(s: GameState, need: Record<string, number>): boolean {
  return Object.entries(need).every(([k, v]) => (s.materials[k] ?? 0) >= v);
}

export function relLevel(s: GameState, npc: string): number {
  return Math.floor((s.relationships[npc] ?? 0) / 10);
}
export function addRel(s: GameState, npc: string, pts: number) {
  s.relationships[npc] = Math.max(0, Math.min(60, (s.relationships[npc] ?? 0) + pts));
}

export function displayCapacity(s: GameState): number {
  return { rack1: 3, rack2: 6, cabinet: 9 }[s.decor.shelves] ?? 3;
}
export function galleryCapacity(s: GameState): number {
  return s.upgrades.includes('collectionroom') ? 12 : 0;
}
