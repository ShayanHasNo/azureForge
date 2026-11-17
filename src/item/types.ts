// The central item data structure. Every crafting stage writes into this, the
// renderer draws only from this, and save files store exactly this.

import type { StageId } from '../data/traditions.js';
import type { DamascusData } from './damascus.js';

export type Category = 'sword' | 'dagger' | 'shield' | 'bow' | 'arrows' | 'armor';
/**
 * Item data version. Version 1 pieces were made before the hi-res renderer and
 * are "legacy": they keep their original look forever (render/legacy).
 */
export const ITEM_VERSION = 2;
export const isLegacy = (item: { version?: number }): boolean => (item.version ?? 1) < 2;

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

/** A bow, seen from the side: the stave arcs away from the string. Lengths are in logical sprite pixels. */
export interface BowGeometry {
  profile: string; // longbow | flatbow | recurve | reflex
  length: number; // nock to nock
  /** Limb thickness at the grip (px). */
  limb: number;
  /** Stiffness error of each limb section after tillering, grip → tip (-1 weak/hinged … +1 stiff). */
  upper: number[];
  lower: number[];
  /** Draw weight reached, as a fraction of what the stave could give (0..1). */
  draw: number;
  /** Worst hinge left in a limb (0 none … 1 severe). */
  hinge: number;
  /** Backing strip material (sinew, rawhide, hickory…), or ''. */
  backing: string;
  /** Horn belly material (composite bows), or ''. */
  belly: string;
  /** Evenness of the backing / lamination glue line (0..1). */
  glue: number;
  /** Bowstring fibre and how evenly it was twisted (0..1). */
  string: string;
  stringQuality: number;
  /** Horn nock overlays, or '' for self nocks. */
  nock: string;
  gripMaterial: string;
  wrapColor: string;
}

/** A matched set of arrows. Arrays hold one value per arrow. */
export interface ArrowsGeometry {
  count: number;
  length: number; // shaft length, px
  point: string; // bodkin | broadhead | leaf | flint
  fletch: string; // parabolic | shield | traditional
  nock: string; // '' self nock, or a horn id
  binding: string; // thread material
  crest: string; // crest colour (hex)
  /** How straight each shaft is (0..1). */
  straight: number[];
  /** Spine (stiffness) of each shaft relative to the set's target (-1..1; 0 = matched). */
  spine: number[];
  /** Fletching alignment error of each arrow (-1..1). */
  fletchErr: number[];
  /** How cleanly the points were made (0..1). */
  pointQuality: number;
}

/** Body armour, drawn front-on. */
export interface ArmorGeometry {
  method: string; // gambeson | cuirbouilli | mail | scale | brigandine | plate
  cut: string; // vest | jack | coat
  /** Evenness of the repeated work (stitches, links, lacing, rivets) in 8 bands, top → bottom (0..1). */
  even: number[];
  /** Fraction of the repeated work that went wrong: skipped stitches, mis-linked rings, proud rivets (0..1). */
  gaps: number;
  /** Dents / lumps left by forming, in 8 sectors (0..1). */
  dents: number[];
  trimColor: string;
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

/** Scores of the stages a piece went through. Crafts map their own stages onto these (e.g. tillering → structure). */
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

export interface Blemish {
  t: number;
  u: number;
  kind: 'pit' | 'scratch' | 'scale';
  /** How deep / obvious the flaw is, 0..1 (absent = 1). Faint ones are best found with the inspection lamp. */
  depth?: number;
}

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
  coverage: number; // shields, armour
  compactness: number; // daggers
  // bows
  drawWeight?: number; // pounds
  cast?: number;
  smoothness?: number;
  stability?: number;
  // arrows
  consistency?: number;
  straightness?: number;
  flight?: number;
  penetration?: number;
  // armour
  protection?: number;
  protCut?: number;
  protPierce?: number;
  protBlunt?: number;
  mobility?: number;
  comfort?: number;
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
  /** `method` is the forging / construction method: 'damascus' for daggers, a bow or armour method, or undefined. */
  design: { direction: string; motif: string; palette: string; intents: string[]; method?: string };
  materials: { primary: string; secondary: string; grip: string; fusedWith?: string };
  structure: { approach: string };
  blade?: BladeGeometry;
  shield?: ShieldGeometry;
  bow?: BowGeometry;
  arrows?: ArrowsGeometry;
  armor?: ArmorGeometry;
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
