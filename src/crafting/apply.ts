// Applies minigame results to the central item data. This is the single place
// where measured player performance becomes geometry, texture and quality.

import { seededRng } from '../core/rng';
import { clamp } from '../core/util';
import { SEGMENTS } from '../item/factory';
import type { Blemish, Item } from '../item/types';
import type { MinigameResult } from '../minigames/types';

const arr = (v: any, n: number, fill = 0): number[] => (Array.isArray(v) ? v.slice(0, n).map(Number) : new Array(n).fill(fill));

export type ApplyFn = (item: Item, r: MinigameResult) => void;

export const APPLY: Record<string, ApplyFn> = {
  heat: (item, r) => { item.quality.prep = r.score; },
  anneal: (item, r) => { item.quality.prep = r.score; },
  fusion: (item, r) => {
    item.quality.prep = r.score;
    item.surface.fusion = clamp(Number(r.data.mix ?? 0.5), 0.15, 0.85);
    // Fusion can produce procedural mutations — more likely with daring, imperfect fusions.
    const rng = seededRng(item.seed, 'fusion-mutation');
    const pool = ['colorband', 'speckle', 'ghostedge', 'veins', 'halo', 'inverted'];
    const chance = 0.35 + (1 - r.score) * 0.3 + (Number(r.data.volatility ?? 0) * 0.2);
    const muts: string[] = [];
    if (rng.chance(chance)) muts.push(rng.pick(pool));
    if (rng.chance(chance * 0.35)) muts.push(rng.pick(pool));
    item.mutations = [...new Set(muts)];
  },
  fold: (item, r) => {
    item.quality.fold = r.score;
    item.surface.layers = Math.round(Number(r.data.layers ?? 8));
    item.surface.patternClarity = clamp(Number(r.data.clarity ?? r.score));
  },
  hammer: (item, r) => {
    item.quality.shaping = r.score;
    if (item.blade) {
      item.blade.leftDev = arr(r.data.leftDev, SEGMENTS).map((v) => clamp(v, -0.6, 0.6));
      item.blade.rightDev = arr(r.data.rightDev, SEGMENTS).map((v) => clamp(v, -0.6, 0.6));
      item.blade.wobble = arr(r.data.wobble, SEGMENTS).map((v) => clamp(v, -2.5, 2.5));
    }
    if (item.shield) item.shield.dents = arr(r.data.dents, 8).map((v) => clamp(v));
  },
  grind: (item, r) => {
    item.quality.structure = r.score;
    if (item.blade) {
      if (r.data.leftDev) item.blade.leftDev = arr(r.data.leftDev, SEGMENTS).map((v) => clamp(v, -0.6, 0.6));
      if (r.data.rightDev) item.blade.rightDev = arr(r.data.rightDev, SEGMENTS).map((v) => clamp(v, -0.6, 0.6));
      if (r.data.wobble) item.blade.wobble = arr(r.data.wobble, SEGMENTS).map((v) => clamp(v, -2.5, 2.5));
    }
    if (item.shield) {
      if (r.data.dents) item.shield.dents = arr(r.data.dents, 8).map((v) => clamp(v));
      if (r.data.rimGap !== undefined) item.shield.rimGap = clamp(Number(r.data.rimGap), -3, 3);
    }
  },
  inlay: (item, r) => {
    item.quality.inlay = r.score;
    const stones = Array.isArray(r.data.stones) ? r.data.stones : [];
    item.decoration.stones = stones.slice(0, 8).map((s: any) => ({ t: clamp(Number(s.t), 0.02, 0.9), u: clamp(Number(s.u), -0.8, 0.8), stone: String(s.stone ?? 'riverstone'), rot: clamp(Number(s.rot ?? 0), -1, 1) }));
  },
  surface: (item, r) => {
    item.quality.surface = r.score;
    item.surface.zones = arr(r.data.zones, 8, 0.6).map((v) => clamp(v));
  },
  hilt: (item, r) => {
    item.quality.assembly = r.score;
    if (item.hilt) {
      item.hilt.guardOffset = Math.round(clamp(Number(r.data.guardOffset ?? 0), -3, 3));
      item.hilt.guardTilt = Math.round(clamp(Number(r.data.guardTilt ?? 0), -3, 3));
      item.hilt.pommelOffset = Math.round(clamp(Number(r.data.pommelOffset ?? 0), -2, 2));
    }
    if (item.shield && r.data.rimGap !== undefined) item.shield.rimGap = Math.round(clamp(Number(r.data.rimGap), -3, 3));
  },
  engrave: (item, r) => {
    item.quality.engraving = r.score;
    const e = item.decoration.engraving;
    e.jitter = arr(r.data.jitter, 400).map((v) => Math.round(clamp(v, -1, 1) * 1000) / 1000);
    e.slips = arr(r.data.slips, 60).map((v) => Math.round(v));
    e.crispness = clamp(Number(r.data.crispness ?? r.score));
  },
  infusion: (item, r) => {
    item.quality.infusion = r.score;
    const pts = Array.isArray(r.data.points) ? r.data.points : [];
    item.decoration.constellation = { points: pts.slice(0, 12).map((p: any) => [clamp(Number(p[0]), 0.02, 0.95), clamp(Number(p[1]), -0.9, 0.9)] as [number, number]), brightness: clamp(Number(r.data.brightness ?? r.score)) };
  },
  finish: (item, r) => {
    item.quality.finishing = r.score;
    const found: number[] = Array.isArray(r.data.found) ? r.data.found.map(Number) : [];
    item.blemishes = item.blemishes.filter((_, i) => !found.includes(i));
  },
};

/** Map stage → minigame id. */
export const STAGE_MINIGAME: Record<string, string> = {
  heat: 'heat', anneal: 'anneal', fusion: 'fusion', fold: 'fold', hammer: 'hammer', grind: 'grind',
  inlay: 'assembly', surface: 'polish', hilt: 'assembly', engrave: 'engrave', infusion: 'constellation', finish: 'inspect',
};

/**
 * Blemishes come from how earlier stages actually went (deterministic from seed + scores).
 * They are generated just before final inspection, where the player may find and fix them.
 */
export function generateBlemishes(item: Item): Blemish[] {
  const rng = seededRng(item.seed, 'blemish');
  const q = item.quality;
  const weak = (v: number | undefined) => (v === undefined ? 0 : clamp(1 - v));
  const n = Math.round(2 + weak(q.prep) * 3 + weak(q.shaping) * 3 + weak(q.structure) * 2 + weak(q.surface) * 3);
  const kinds: Blemish['kind'][] = ['pit', 'scratch', 'scale'];
  const out: Blemish[] = [];
  for (let i = 0; i < Math.min(9, n); i++) out.push({ t: rng.range(0.06, 0.8), u: rng.range(-0.6, 0.6), kind: rng.pick(kinds) });
  return out;
}
