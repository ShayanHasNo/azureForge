// Forging methods change a piece's stage sequence. Damascus (daggers only)
// swaps the Patternwrights fold for its own forging stage, or slots one in
// right after the metal is prepared.

import type { StageId, TraditionDef } from '../data/traditions';
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
 * Return the stage list for a method. Pure and idempotent: applying it twice
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
