// Shared shapes for crafting stages: the decisions a stage offers (controls),
// its context, and its definition. Kept apart from stages.ts so the craft
// stage tables can use them without an import cycle.

import type { OptionDef } from '../data/options';
import type { StageId, TraditionDef } from '../data/traditions';
import { optionAvailable } from '../game/progress';
import type { GameState } from '../game/state';
import type { Item } from '../item/types';

export interface StageCtx {
  item: Item;
  state: GameState;
  tradition: TraditionDef;
}

export type Control =
  | { kind: 'options'; key: string; label: string; options: OptionDef[]; get: () => string; set: (id: string) => void; help?: string }
  | { kind: 'multi'; key: string; label: string; options: OptionDef[]; max: number; get: () => string[]; set: (ids: string[]) => void; help?: string }
  | { kind: 'slider'; key: string; label: string; min: number; max: number; step: number; get: () => number; set: (v: number) => void; format?: (v: number) => string; help?: string }
  | { kind: 'swatches'; key: string; label: string; swatches: { id: string; name: string; hex: string }[]; get: () => string; set: (id: string) => void }
  | { kind: 'materials'; key: string; label: string; materials: string[]; need: number; get: () => string; set: (id: string) => void; allowNone?: boolean; help?: string }
  | { kind: 'text'; key: string; label: string; max: number; get: () => string; set: (v: string) => void; placeholder?: string }
  | { kind: 'toggle'; key: string; label: string; get: () => boolean; set: (v: boolean) => void; help?: string }
  | { kind: 'gems'; key: string; label: string; slots: string[]; max: number; gems: string[]; get: () => { slot: string; gem: string }[]; set: (v: { slot: string; gem: string }[]) => void }
  | { kind: 'info'; key: string; html: string };

export interface StageDef {
  id: StageId;
  controls: (ctx: StageCtx) => Control[];
  minigame?: (ctx: StageCtx) => { id: string; params: Record<string, any> } | null;
  validate?: (ctx: StageCtx) => string | null;
}

/** Filter + annotate options by availability (unavailable ones are shown locked). */
export function withAvailability(list: OptionDef[], ctx: StageCtx): (OptionDef & { locked?: string })[] {
  return list
    .filter((o) => !o.gate?.categories || o.gate.categories.includes(ctx.item.category))
    .map((o) => {
      const a = optionAvailable(o, ctx.state, ctx.tradition.id, ctx.item.category);
      return a.ok ? o : { ...o, locked: a.reason };
    });
}

