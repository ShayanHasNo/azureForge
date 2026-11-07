// Minigame contract. A minigame receives the current draft item (read-only),
// runs an interactive skill challenge, and resolves with a MinigameResult whose
// `data` the crafting engine writes into the item. Results are always real
// measurements of player input — never predetermined values.

import type { GameAudio } from '../audio/types';
import type { MaterialDef } from '../data/materials';
import type { Item } from '../item/types';
import type { View } from '../render/itemRenderer';

export interface MinigameEnv {
  canvas: HTMLCanvasElement;
  item: Item;
  material: MaterialDef;
  /** 0 = relaxed, 1 = beginner, 2 = intermediate, 3 = advanced, 4 = master (may be fractional). */
  difficulty: number;
  /** Stage-specific parameters, e.g. { mode: 'hilt' } or { finish: 'brushed' }. */
  params: Record<string, any>;
  /** Experimental Workshop quirk id, if any (see QUIRKS). */
  quirk?: string;
  audio: GameAudio;
  settings: { reducedMotion: boolean; highContrast: boolean; colorblind: boolean };
  /** Unlocked workshop upgrades (e.g. 'bellows', 'loupe', 'wheel'). */
  upgrades: string[];
  /** Render the item sprite at 1x (cached). */
  sprite: (item: Item, view?: View) => HTMLCanvasElement;
  /** Optional progress text callback for the host UI. */
  onStatus?: (text: string) => void;
}

export interface MinigameResult {
  /** 0..1 performance. */
  score: number;
  /** Named sub-measurements (0..1 unless noted) shown in the crafting history. */
  details: Record<string, number>;
  /** Stage-specific payload consumed by crafting/apply.ts (see each minigame for its shape). */
  data: Record<string, any>;
  /** One short human sentence about how it went. */
  summary: string;
}

export interface MinigameInstance {
  start(): Promise<MinigameResult>;
  destroy(): void;
}

export interface MinigameDef {
  id: string;
  name: string;
  /** Short instruction lines shown before starting. */
  instructions: (env: Omit<MinigameEnv, 'canvas'>) => string[];
  controls: string;
  create: (env: MinigameEnv) => MinigameInstance;
}

export const QUIRKS: Record<string, string> = {
  mirrored: 'Mirrored — left and right are swapped.',
  drifting: 'Drifting — targets slowly wander.',
  bursts: 'Bursts — the pace surges and slackens, but targets are larger.',
  flicker: 'Flicker — the guide flickers in and out.',
  generous: 'Generous — the workshop spirits are kind today.',
};

export function gradeOf(score: number): string {
  if (score >= 0.93) return 'Masterful';
  if (score >= 0.8) return 'Excellent';
  if (score >= 0.65) return 'Good';
  if (score >= 0.45) return 'Fair';
  return 'Rough';
}
