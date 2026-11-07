// The central item data structure. Every crafting stage writes into this, the
// renderer draws only from this, and save files store exactly this.

import type { StageId } from '../data/traditions.js';
import type { DamascusData } from './damascus.js';

export type Category = 'sword' | 'dagger' | 'shield';
export const ITEM_VERSION = 1;

export interface BladeGeometry {
  length: number; // blade length in sprite pixels
  width: number; // base half-width in pixels
  profile: string;
  tip: string;
  curve: number; // -1..1 centerline curvature
  thickness: number; // 0..1
  fuller: string;
  /** Per-segment edge deviations (fraction of half-width), from hammer + grind. */
  leftDev: number[];
  rightDev: number[];
  /** Centerline wobble per segment (pixels) from uneven hammering. */
  wobble: number[];
  /** Intentional artistic asymmetry (0..1). */
  asymmetry: number;
}

export interface ShieldGeometry {
  shape: string;
  width: number; // pixels
  height: number;
  rim: number; // rim width px
  boss: string;
  faceMaterial: string; // wood or metal id
  planks: number;
  /** dents / bumps around the face from hammering (0..1 magnitudes) */
  dents: number[];
  rimGap: number; // assembly misalignment of rim, px
}

export interface HiltConfig {
  guard: string;
  guardWidth: number; // half-width px
  gripLength: number; // px
  gripMaterial: string;
  wrap: string;
  wrapColor: string; // hex
  pommel: string;
  /** Assembly outcome: horizontal offset of guard (px) and tilt (px across width). */
  guardOffset: number;
  guardTilt: number;
  pommelOffset: number;
}

export interface EngravingConfig {
  pattern: string;
  /** Per-sample deviation of the traced line (-1..1), straight from the minigame. */
  jitter: number[];
  /** Sample indexes where the graver slipped (gaps). */
  slips: number[];
  crispness: number; // 0..1
  inlay: boolean; // filled with inlay colour
}

export interface GemSetting { slot: 'guard' | 'pommel' | 'blade' | 'boss'; gem: string }

export interface DecorationConfig {
  engraving: EngravingConfig;
  inscription: string;
  gems: GemSetting[];
  emblem: string;
  /** Stones set by the Mountain inlay stage: positions along blade (t), rotation quality */
  stones: { t: number; u: number; stone: string; rot: number }[];
  /** Constellation infused by the Celestial stage */
  constellation?: { points: [number, number][]; brightness: number };
}

export interface SurfaceConfig {
  texture: string;
  /** Coverage evenness map from polishing — 8 zones along the piece (0..1) */
  zones: number[];
  /** Pattern data from folding: number of layers & clarity */
  layers: number;
  patternClarity: number;
  /** Fusion swirl (Experimental): 0 = none */
  fusion: number;
  /** Damascus pattern (daggers forged with the Damascus method). */
  damascus?: DamascusData;
}

export interface FinishConfig {
  finish: string;
  glowColor?: string;
}

export interface MinigameRecord {
  id: string;
  score: number;
  grade: string;
  difficulty: number;
  details: Record<string, number>;
  summary: string;
}

export interface StageRecord {
  stage: StageId;
  name: string;
  choices: Record<string, string | number | boolean>;
  minigame?: MinigameRecord;
  notes: string[];
  at: number; // real timestamp
}

export interface StageQuality {
  prep?: number;
  fold?: number;
  shaping?: number;
  structure?: number;
  inlay?: number;
  surface?: number;
  assembly?: number;
  engraving?: number;
  infusion?: number;
  finishing?: number;
}

export interface Blemish { t: number; u: number; kind: 'pit' | 'scratch' | 'scale' }

export interface ItemStats {
  craftsmanship: number;
  materialQuality: number;
  durability: number;
  integrity: number;
  balance: number;
  flexibility: number;
  weight: number; // kg (fictional)
  ornamentation: number;
  complexity: number;
  surfaceQuality: number;
  cohesion: number;
  uniqueness: number;
  collectorAppeal: number;
  intentFulfillment: number;
  coverage: number; // shields
  compactness: number; // daggers
  rarity: number; // 0..100
  rarityLabel: string;
  value: number; // gold
  grade: string;
  overall: number;
}

export interface Item {
  id: string;
  version: number;
  seed: number;
  category: Category;
  tradition: string;
  name: string;
  customName?: string;
  creator: string;
  createdDay: number; // in-game day
  createdSeason: string;
  createdAt: number; // real timestamp
  design: { direction: string; motif: string; palette: string; intents: string[]; method?: 'standard' | 'damascus' };
  materials: { primary: string; secondary: string; grip: string; fusedWith?: string };
  structure: { approach: string };
  blade?: BladeGeometry;
  shield?: ShieldGeometry;
  hilt?: HiltConfig;
  surface: SurfaceConfig;
  decoration: DecorationConfig;
  finish: FinishConfig;
  quality: StageQuality;
  blemishes: Blemish[];
  /** Experimental quirks / mutations (procedural, from seed + decisions) */
  mutations: string[];
  history: StageRecord[];
  stats?: ItemStats;
  tags: string[];
  description?: string;
  favorite?: boolean;
  displayed?: boolean;
  sold?: boolean;
  giftedTo?: string;
  requestId?: string;
  /** Posted to the online market showcase. */
  showcase?: { id: string; token: string; at: number };
}
