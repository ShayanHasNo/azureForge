// Forging / construction methods change a piece's stage sequence.
//
//  - Blades and shields follow their tradition's own stage list. A Damascus
//    dagger swaps the Patternwrights fold for its own forging stage, or slots
//    one in right after the metal is prepared.
//  - Bows, arrows and body armour follow the stage list of the chosen
//    construction method (a self bow is made differently from a composite
//    one; mail is made differently from plate). The tradition still sets the
//    difficulty, the decorative language and — in the Experimental Workshop —
//    the quirks.

import type { StageId, TraditionDef } from '../data/traditions';
import { hasMat, mat } from '../data/materials';
import type { Item } from '../item/types';

export type ForgingMethod = 'standard' | 'damascus';

export function methodOf(item: Item): ForgingMethod {
  return item.category === 'dagger' && item.design.method === 'damascus' ? 'damascus' : 'standard';
}

/** Can this tradition forge Damascus at all? (Needs real metals, so not crystal work.) */
export function traditionAllowsDamascus(trad: TraditionDef): boolean {
  return !trad.stages.includes('anneal');
}

/**
 * Return the stage list for a blade method. Pure and idempotent: applying it twice
 * gives the same list, and switching back to standard undoes Damascus.
 * `base` is the tradition's own list, used to restore a replaced fold stage.
 */
export function stagesForMethod(stages: StageId[], method: ForgingMethod, base: StageId[]): StageId[] {
  const out = [...stages];
  const at = out.indexOf('damascus');
  if (method === 'damascus') {
    if (at >= 0) return out;
    const fold = out.indexOf('fold');
    if (fold >= 0) { out[fold] = 'damascus'; return out; }
    const after = ['heat', 'fusion', 'materials'].map((s) => out.indexOf(s as StageId)).find((i) => i >= 0) ?? 1;
    out.splice(after + 1, 0, 'damascus');
    return out;
  }
  if (at < 0) return out;
  if (base.includes('fold') && !out.includes('fold')) out[at] = 'fold';
  else out.splice(at, 1);
  return out;
}

// ---------------------------------------------------------------- bows, arrows, armour
export const BOW_STAGES: Record<string, StageId[]> = {
  // one stave: rough it out, toast the belly, then tiller
  self: ['stave', 'bowheat', 'tiller', 'string'],
  // sinew / rawhide / hickory on the back takes the tension
  backed: ['stave', 'backing', 'tiller', 'string'],
  // strips glued up on a form, then shaped
  laminated: ['glueup', 'stave', 'tiller', 'string'],
  // wooden core, horn belly glued on, sinew back, a long cure
  composite: ['stave', 'glueup', 'backing', 'cure', 'tiller', 'string'],
};

export const ARMOR_STAGES: Record<string, StageId[]> = {
  gambeson: ['padding', 'quilt', 'lacing'],
  cuirbouilli: ['harden', 'mould', 'tooling', 'wax', 'straps'],
  mail: ['wire', 'rings', 'weave', 'rivets'],
  scale: ['plateheat', 'plates', 'lace'],
  brigandine: ['plateheat', 'plates', 'rivets'],
  plate: ['plateheat', 'raise', 'planish', 'articulate', 'burnish'],
};

/** Is this material worked hot (so its stage list starts at the forge)? */
const isMetal = (id: string) => hasMat(id) && (mat(id).kind === 'metal' || mat(id).kind === 'crystal');

/** The working stages (between materials and final finishing) for a bow, arrow set or armour. */
export function craftStages(item: Item): StageId[] {
  if (item.category === 'bow') return BOW_STAGES[item.design.method ?? 'self'] ?? BOW_STAGES.self;
  if (item.category === 'arrows') {
    // stone points are knapped cold; metal points are heated first
    return item.arrows?.point === 'flint' ? ['straighten', 'points', 'fletch'] : ['straighten', 'pointheat', 'points', 'fletch'];
  }
  if (item.category === 'armor') {
    const list = ARMOR_STAGES[item.design.method ?? 'gambeson'] ?? ARMOR_STAGES.gambeson;
    // scales of horn or hide are cut, not forged
    if (item.design.method === 'scale' && !isMetal(item.materials.primary)) return list.filter((s) => s !== 'plateheat');
    return list;
  }
  return [];
}

export const usesCraftStages = (item: Item) => item.category === 'bow' || item.category === 'arrows' || item.category === 'armor';

/**
 * The full stage list for a piece: its tradition's list (with Damascus applied) for blades and
 * shields, or design → materials → the craft's working stages → finish → appraisal.
 * `current` is the list so far, so a tradition's reordered stages are kept. Idempotent.
 */
export function stagesFor(item: Item, trad: TraditionDef, current: StageId[] = trad.stages): StageId[] {
  if (!usesCraftStages(item)) return stagesForMethod(current, methodOf(item), trad.stages);
  return ['design', 'materials', ...craftStages(item), 'finish', 'appraisal'];
}
