// Headless crafting simulation used by automated balance tests. It drives the
// real stage pipeline (APPLY + blemishes + stats) with synthetic minigame
// results representing a given skill level.

import { Rng, seededRng } from '../core/rng';
import { clamp } from '../core/util';
import { tradition } from '../data/traditions';
import { createDraft, SEGMENTS } from '../item/factory';
import { refreshDerived } from '../item/finalize';
import { engravingPaths, pathSampleCount } from '../item/patterns';
import type { Category, Item } from '../item/types';
import type { MinigameResult } from '../minigames/types';
import { APPLY, generateBlemishes, STAGE_MINIGAME } from './apply';
import { fitMaterials } from './craftStages';
import { stagesFor, usesCraftStages } from './method';
import { ARROW_COUNT, BOW_SECTIONS } from '../item/factory';

const CORE: Record<string, true> = { design: true, materials: true, heat: true, anneal: true, fusion: true, fold: true, damascus: true, hammer: true, grind: true, inlay: true, surface: true, hilt: true, engrave: true, infusion: true, finish: true, appraisal: true };

/** Synthetic result for a minigame at skill s (0..1) with natural variation. */
export function syntheticResult(stage: string, item: Item, skill: number, r: Rng): MinigameResult {
  const score = clamp(skill + r.normal() * 0.04);
  const err = 1 - score;
  const devs = (k: number) => Array.from({ length: SEGMENTS }, () => r.normal() * err * k);
  const data: Record<string, any> = {};
  // the bowyer's, fletcher's and armourer's stages: shaped by the minigame each one runs
  if (!(stage in CORE)) {
    switch (STAGE_MINIGAME[stage]) {
      case 'polish': data.zones = Array.from({ length: 8 }, () => clamp(score + r.normal() * 0.05)); break;
      case 'hammer': data.dents = Array.from({ length: 8 }, () => clamp(Math.abs(r.normal()) * err)); break;
      case 'fold': Object.assign(data, { layers: 4, clarity: score }); break;
      case 'engrave': {
        const n = pathSampleCount(engravingPaths(item.decoration.engraving.pattern, item.seed));
        Object.assign(data, { jitter: Array.from({ length: n }, () => clamp(r.normal() * err * 1.4, -1, 1)), slips: err > 0.3 ? [Math.floor(n / 2)] : [], crispness: score });
        break;
      }
      case 'tiller': {
        const limb = () => Array.from({ length: BOW_SECTIONS }, () => clamp(r.normal() * err * 0.9 + err * 0.3, -1, 1));
        Object.assign(data, { upper: limb(), lower: limb(), draw: clamp(1 - err * 0.25), hinge: err > 0.55 ? clamp((err - 0.55) * 2) : 0 });
        break;
      }
      case 'string': data.even = score; break;
      case 'straighten': Object.assign(data, { straight: Array.from({ length: ARROW_COUNT }, () => clamp(score + r.normal() * 0.05)), spine: Array.from({ length: ARROW_COUNT }, () => clamp(r.normal() * err * 0.7, -1, 1)) }); break;
      case 'fletch': data.fletchErr = Array.from({ length: ARROW_COUNT }, () => clamp(r.normal() * err * 0.9, -1, 1)); break;
      case 'stitch':
      case 'weave': Object.assign(data, { even: Array.from({ length: 8 }, () => clamp(score + r.normal() * 0.05)), gaps: clamp(err * 0.5) }); break;
    }
    return { score, details: {}, data, summary: '' };
  }
  switch (stage) {
    case 'hammer':
      Object.assign(data, { leftDev: devs(0.2), rightDev: devs(0.2), wobble: devs(0.8), dents: Array.from({ length: 8 }, () => Math.abs(r.normal()) * err) });
      break;
    case 'grind':
      Object.assign(data, { leftDev: devs(0.12), rightDev: devs(0.12), dents: Array.from({ length: 8 }, () => Math.abs(r.normal()) * err * 0.5) });
      break;
    case 'surface':
      data.zones = Array.from({ length: 8 }, () => clamp(score + r.normal() * 0.05));
      break;
    case 'hilt':
      Object.assign(data, { guardOffset: Math.round(r.normal() * err * 3), guardTilt: Math.round(r.normal() * err * 3), pommelOffset: Math.round(r.normal() * err * 2), rimGap: r.normal() * err * 3 });
      break;
    case 'engrave': {
      const n = pathSampleCount(engravingPaths(item.decoration.engraving.pattern, item.seed));
      data.jitter = Array.from({ length: n }, () => clamp(r.normal() * err * 1.4, -1, 1));
      data.slips = err > 0.3 ? [Math.floor(n / 2)] : [];
      data.crispness = score;
      break;
    }
    case 'fold':
      Object.assign(data, { layers: Math.round(8 + score * 24), clarity: score });
      break;
    case 'damascus':
      Object.assign(data, { layers: Math.round(16 + score * 48), forge: score });
      break;
    case 'fusion':
      Object.assign(data, { mix: 0.5, volatility: err });
      break;
    case 'inlay':
      data.stones = [0.15, 0.3, 0.45].map((t) => ({ t, u: r.normal() * 0.1, stone: 'riverstone', rot: r.normal() * err }));
      break;
    case 'infusion':
      data.points = [[0.1, 0], [0.2, 0.3], [0.35, -0.2], [0.5, 0.2]];
      data.brightness = score;
      break;
    case 'finish':
      data.found = item.blemishes.map((_, i) => i).filter(() => r.chance(score));
      break;
  }
  return { score, details: {}, data, summary: '' };
}

export interface SimSpec {
  category?: Category;
  tradition?: string;
  primary: string;
  secondary?: string;
  skill: number;
  seed?: number;
  setup?: (i: Item) => void;
}

export function simulateCraft(spec: SimSpec): Item {
  const seed = spec.seed ?? 1000;
  const item = createDraft(spec.category ?? 'sword', spec.tradition ?? 'foundry', 'Sim', 1, 'Spring', seed);
  if (usesCraftStages(item)) {
    // bows, arrows and armour: the method decides which materials fit
    spec.setup?.(item);
    item.materials.primary = spec.primary;
    if (spec.secondary) item.materials.secondary = spec.secondary;
    fitMaterials(item, () => 99);
  } else {
    item.materials.primary = spec.primary;
    item.materials.secondary = spec.secondary ?? 'brass';
    if (spec.tradition === 'experimental') item.materials.fusedWith = 'copper';
    spec.setup?.(item);
  }
  const r = seededRng(seed, 'sim' + spec.skill);
  for (const stage of stagesFor(item, tradition(item.tradition))) {
    if (stage === 'finish') item.blemishes = generateBlemishes(item);
    if ((stage === 'engrave' || stage === 'tooling') && item.decoration.engraving.pattern === 'none') continue;
    const fn = APPLY[stage];
    if (!fn) continue;
    const res = syntheticResult(stage, item, spec.skill, r);
    fn(item, res);
    item.history.push({ stage, name: stage, choices: {}, minigame: { id: stage, score: res.score, grade: '', difficulty: 1, details: {}, summary: 'simulated' }, notes: ['simulated'], at: 0 });
  }
  return refreshDerived(item, true);
}
