// Data-driven crafting stages. Each stage declares the decisions it offers
// (controls), how they write into the item, and which minigame it runs.
// Stages can be added, removed or reordered per tradition.

import { clamp } from '../core/util';
import { GEMS, GRIPS, hasMat, mat, METALS, STONES, UNIT_COST } from '../data/materials';
import {
  APPROACHES, DIRECTIONS, EMBLEMS, METHODS, ENGRAVINGS, FINISHES, FULLERS, GUARDS, INTENTS, MOTIFS, OptionDef, PALETTES, POMMELS, PROFILES,
  SHIELD_SHAPES, BOSSES, TEXTURES, TIPS, WRAP_COLORS, WRAPS, palette,
} from '../data/options';
import { StageId, TraditionDef } from '../data/traditions';
import { optionAvailable } from '../game/progress';
import type { GameState } from '../game/state';
import { CATEGORY_INFO } from '../item/factory';
import type { Item } from '../item/types';
import { RARE_COLORS } from '../item/damascus';
import { methodOf, traditionAllowsDamascus } from './method';

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

const owned = (s: GameState, id: string) => s.materials[id] ?? 0;
const isBlade = (i: Item) => i.category !== 'shield';

export const STAGES: Record<StageId, StageDef> = {
  design: {
    id: 'design',
    controls: (ctx) => {
      const { item } = ctx;
      const c: Control[] = [];
      if (item.category === 'dagger' && traditionAllowsDamascus(ctx.tradition)) {
        c.push({
          kind: 'options', key: 'method', label: 'Forging method', options: withAvailability(METHODS, ctx), get: () => methodOf(item), set: (v) => (item.design.method = v as any),
          help: 'Damascus daggers carry one of 1000 numbered patterns. Your forging decides how clearly it shows — and some metal pairs can, very rarely, bloom into a prized colour.',
        });
      }
      c.push(
        { kind: 'options', key: 'direction', label: 'Artistic direction', options: DIRECTIONS, get: () => item.design.direction, set: (v) => (item.design.direction = v) },
        { kind: 'options', key: 'motif', label: 'Decorative motif', options: MOTIFS, get: () => item.design.motif, set: (v) => (item.design.motif = v) },
        {
          kind: 'swatches', key: 'palette', label: 'Colour palette', swatches: PALETTES.map((p) => ({ id: p.id, name: p.name, hex: p.accent })), get: () => item.design.palette,
          set: (v) => { item.design.palette = v; if (item.hilt) item.hilt.wrapColor = palette(v).wrap; },
        },
        { kind: 'multi', key: 'intents', label: 'Intended qualities (up to two)', options: INTENTS, max: 2, get: () => item.design.intents, set: (v) => (item.design.intents = v), help: 'At appraisal, the piece is judged on whether it became what you intended.' },
      );
      if (isBlade(item)) {
        c.push({ kind: 'options', key: 'profile', label: 'Silhouette', options: PROFILES, get: () => item.blade!.profile, set: (v) => (item.blade!.profile = v) });
        c.push({ kind: 'options', key: 'tip', label: 'Tip', options: TIPS, get: () => item.blade!.tip, set: (v) => (item.blade!.tip = v) });
        const info = CATEGORY_INFO[item.category];
        c.push({ kind: 'slider', key: 'length', label: 'Proportions — blade length', min: info.lengthRange[0], max: info.lengthRange[1], step: 1, get: () => item.blade!.length, set: (v) => (item.blade!.length = v), format: (v) => `${v} px` });
      } else {
        c.push({ kind: 'options', key: 'shape', label: 'Silhouette', options: SHIELD_SHAPES, get: () => item.shield!.shape, set: (v) => (item.shield!.shape = v) });
      }
      return c;
    },
  },

  materials: {
    id: 'materials',
    controls: ({ item, state, tradition }) => {
      const cost = UNIT_COST[item.category];
      const damascus = methodOf(item) === 'damascus';
      const primaries = tradition.primaries.filter((m) => hasMat(m));
      const c: Control[] = [];
      if (item.category === 'shield') {
        const faces = [...GRIPS.filter((g) => g.kind === 'wood').map((g) => g.id), ...primaries];
        c.push({ kind: 'materials', key: 'face', label: 'Face material (wood planks or metal)', materials: faces, need: cost.grip, get: () => item.shield!.faceMaterial, set: (v) => (item.shield!.faceMaterial = v), help: 'A wooden face is light; a metal face takes surface treatments across the whole shield.' });
      }
      c.push({ kind: 'materials', key: 'primary', label: item.category === 'shield' ? 'Primary metal (boss & metalwork)' : 'Primary material (blade)', materials: primaries, need: cost.primary, get: () => item.materials.primary, set: (v) => (item.materials.primary = v) });
      c.push({ kind: 'materials', key: 'secondary', label: item.category === 'shield' ? 'Secondary metal (rim & boss)' : 'Secondary metal (fittings, inlays, patterns)', materials: METALS.map((m) => m.id), need: cost.secondary, get: () => item.materials.secondary, set: (v) => (item.materials.secondary = v) });
      if (tradition.id === 'experimental') {
        c.push({ kind: 'materials', key: 'fused', label: 'Metal to fuse into the primary (Alchemical Fusion)', materials: METALS.map((m) => m.id).filter((m) => m !== item.materials.primary), need: 1, get: () => item.materials.fusedWith ?? '', set: (v) => (item.materials.fusedWith = v || undefined) });
      }
      if (damascus) {
        c.unshift(info(`<b>Damascus:</b> the primary and secondary metals are stacked and folded together, so choose two different metals. Legend says a few pairings can bloom into a prized colour: ${RARE_COLORS.map((r) => `${mat(r.pair[0]).name} with ${mat(r.pair[1]).name}`).join(', ')}.`));
      }
      if (item.hilt) c.push({ kind: 'materials', key: 'grip', label: 'Grip material', materials: GRIPS.map((g) => g.id), need: cost.grip, get: () => item.hilt!.gripMaterial, set: (v) => { item.hilt!.gripMaterial = v; item.materials.grip = v; } });
      void state;
      return c;
    },
    validate: ({ item, state, tradition }) => {
      const need = materialNeeds(item);
      for (const [id, n] of Object.entries(need)) if (owned(state, id) < n) return `You need ${n} ${mat(id).name} (you have ${owned(state, id)}). Visit the village or explore.`;
      if (tradition.id === 'experimental' && !item.materials.fusedWith) return 'Choose a metal to fuse.';
      if (methodOf(item) === 'damascus') {
        if (item.materials.secondary === item.materials.primary) return 'Damascus needs two different metals — choose a contrasting secondary.';
        if (mat(item.materials.primary).kind !== 'metal') return 'Damascus is forged from metal — choose a metal primary.';
      }
      if (tradition.id === 'patternwrights' && item.materials.secondary === item.materials.primary) return 'Patternwrights fold two different metals — choose a contrasting secondary.';
      return null;
    },
  },

  heat: {
    id: 'heat',
    controls: ({ item }) => [info(`Bring the <b>${mat(item.materials.primary).name.toLowerCase()}</b> to working condition. ${prepHint(item.materials.primary)}`)],
    minigame: () => ({ id: 'heat', params: {} }),
  },
  anneal: {
    id: 'anneal',
    controls: ({ item }) => [info(`Crystal is never beaten. Cool the <b>${mat(item.materials.primary).name.toLowerCase()}</b> slowly along its annealing curve — clarity depends on patience.`)],
    minigame: () => ({ id: 'anneal', params: {} }),
  },
  fusion: {
    id: 'fusion',
    controls: ({ item }) => [info(`Fuse <b>${mat(item.materials.primary).name}</b> with <b>${item.materials.fusedWith ? mat(item.materials.fusedWith).name : '?'}</b>. Unstable alloys may develop strange, one-of-a-kind traits.`)],
    minigame: ({ item }) => ({ id: 'fusion', params: { second: item.materials.fusedWith } }),
  },
  damascus: {
    id: 'damascus',
    controls: ({ item }) => [info(`Stack <b>${mat(item.materials.primary).name}</b> and <b>${mat(item.materials.secondary).name}</b> into a billet, fold it, then etch it to reveal the pattern. Clean folds and a well-timed etch make the pattern stand out — though even perfect work never shows it at 100%.`)],
    minigame: ({ item }) => ({ id: 'fold', params: { mode: 'damascus', secondary: item.materials.secondary } }),
  },
  fold: {
    id: 'fold',
    controls: ({ item }) => [info(`Fold <b>${mat(item.materials.primary).name}</b> with <b>${mat(item.materials.secondary).name}</b>. More, cleaner folds make a finer layered pattern — choose the <i>Layered pattern</i> texture later to show it off.`)],
    minigame: ({ item }) => ({ id: 'fold', params: { secondary: item.materials.secondary } }),
  },

  hammer: {
    id: 'hammer',
    controls: ({ item }) => {
      if (!isBlade(item)) {
        return [
          { kind: 'slider', key: 'width', label: 'Width', min: 44, max: 80, step: 2, get: () => item.shield!.width, set: (v) => (item.shield!.width = v), format: (v) => `${v} px` },
          { kind: 'slider', key: 'height', label: 'Height', min: 50, max: 96, step: 2, get: () => item.shield!.height, set: (v) => (item.shield!.height = v), format: (v) => `${v} px` },
          { kind: 'options', key: 'boss', label: 'Boss', options: BOSSES, get: () => item.shield!.boss, set: (v) => (item.shield!.boss = v) },
          { kind: 'slider', key: 'planks', label: 'Planks', min: 3, max: 9, step: 1, get: () => item.shield!.planks, set: (v) => (item.shield!.planks = v) },
        ];
      }
      const b = item.blade!;
      const info = CATEGORY_INFO[item.category];
      return [
        { kind: 'slider', key: 'length', label: 'Length', min: info.lengthRange[0], max: info.lengthRange[1], step: 1, get: () => b.length, set: (v) => (b.length = v), format: (v) => `${v} px` },
        { kind: 'slider', key: 'width', label: 'Width', min: info.widthRange[0], max: info.widthRange[1], step: 0.5, get: () => b.width, set: (v) => (b.width = v), format: (v) => `${v * 2} px` },
        { kind: 'slider', key: 'thickness', label: 'Thickness', min: 0, max: 1, step: 0.05, get: () => b.thickness, set: (v) => (b.thickness = v), format: pct, help: 'Thicker is tougher and heavier, less flexible.' },
        { kind: 'slider', key: 'curve', label: 'Curvature', min: -1, max: 1, step: 0.05, get: () => b.curve, set: (v) => (b.curve = v), format: (v) => (v === 0 ? 'straight' : `${v > 0 ? 'right' : 'left'} ${Math.round(Math.abs(v) * 100)}%`) },
        { kind: 'slider', key: 'asymmetry', label: 'Intentional asymmetry', min: 0, max: 1, step: 0.05, get: () => b.asymmetry, set: (v) => (b.asymmetry = v), format: pct, help: 'Artistic asymmetry is never penalised as a mistake.' },
      ];
    },
    minigame: ({ tradition, item }) => {
      const map: Record<string, string> = { steady: 'steady', heavy: 'heavy', melodic: 'melodic', syncopated: 'syncopated', wild: 'wild' };
      let style = map[tradition.hammerStyle] ?? 'steady';
      if (style === 'steady' && (mat(item.materials.primary).rhythm === 'swing' || mat(item.materials.primary).rhythm === 'erratic')) style = 'swing';
      return { id: 'hammer', params: { style } };
    },
  },

  grind: {
    id: 'grind',
    controls: ({ item }) => {
      const c: Control[] = [{ kind: 'options', key: 'approach', label: 'Construction approach', options: APPROACHES, get: () => item.structure.approach, set: (v) => (item.structure.approach = v) }];
      if (isBlade(item)) c.push({ kind: 'options', key: 'fuller', label: 'Fuller / spine', options: FULLERS, get: () => item.blade!.fuller, set: (v) => (item.blade!.fuller = v) });
      return c;
    },
    minigame: ({ tradition }) => ({ id: 'grind', params: { mode: tradition.grindMode } }),
  },

  inlay: {
    id: 'inlay',
    controls: ({ item, state }) => {
      const stones = STONES.map((s) => s.id).filter((id) => owned(state, id) > 0);
      const sel = (item as any)._inlay ?? ((item as any)._inlay = { count: 3, stones: stones.slice(0, 2) });
      return [
        info('Mountain artisans set river and mountain stones by hand. Each stone you set uses one from storage.'),
        { kind: 'slider', key: 'count', label: 'Number of stones', min: 2, max: 6, step: 1, get: () => sel.count, set: (v) => (sel.count = v) },
        { kind: 'materials', key: 'stone1', label: 'Main stone', materials: STONES.map((s) => s.id), need: 1, get: () => sel.stones[0] ?? '', set: (v) => (sel.stones[0] = v) },
        { kind: 'materials', key: 'stone2', label: 'Accent stone (optional)', materials: STONES.map((s) => s.id), need: 1, allowNone: true, get: () => sel.stones[1] ?? '', set: (v) => (sel.stones[1] = v) },
      ];
    },
    validate: ({ item, state }) => {
      const sel = (item as any)._inlay;
      if (!sel || !sel.stones[0]) return 'Choose a stone.';
      const per = stonesNeeded(sel);
      for (const [id, n] of Object.entries(per)) if (owned(state, id) < n) return `Not enough ${mat(id).name} (need ${n}, have ${owned(state, id)}). Riverstone is always at the Riverbank; slate at the Old Quarry.`;
      return null;
    },
    minigame: ({ item }) => {
      const sel = (item as any)._inlay;
      return { id: 'assembly', params: { mode: 'inlay', count: sel.count, stones: sel.stones.filter(Boolean) } };
    },
  },

  surface: {
    id: 'surface',
    controls: (ctx) => [{ kind: 'options', key: 'texture', label: 'Surface texture', options: withAvailability(methodOf(ctx.item) === 'damascus' ? TEXTURES.filter((t) => t.id !== 'layered') : TEXTURES, ctx), get: () => ctx.item.surface.texture, set: (v) => (ctx.item.surface.texture = v), help: 'Each texture is scored differently when you work it.' }],
    validate: ({ item }) => (item.surface.texture === 'layered' && item.materials.secondary === item.materials.primary ? 'Layered patterns need a contrasting secondary metal.' : null),
    minigame: ({ item, tradition, state }) => ({ id: 'polish', params: { texture: item.surface.texture, mode: tradition.surfaceMode ?? 'polish', wheel: state.upgrades.includes('wheel') } }),
  },

  hilt: {
    id: 'hilt',
    controls: (ctx) => {
      const { item, state } = ctx;
      const gemList = GEMS.map((g) => g.id).filter((id) => owned(state, id) > 0);
      const slots = item.category === 'shield' ? ['boss'] : state.upgrades.includes('gemsetter') ? ['pommel', 'guard', 'blade'] : ['pommel'];
      const maxGems = state.upgrades.includes('finebench') ? 2 : 1;
      const wrapSw = WRAP_COLORS.filter((w) => w.hex).map((w) => ({ id: w.hex, name: w.name, hex: w.hex }));
      const pal = palette(item.design.palette);
      wrapSw.unshift({ id: pal.wrap, name: `${pal.name} (palette)`, hex: pal.wrap });
      if (item.category === 'shield') {
        return [
          { kind: 'slider', key: 'rim', label: 'Rim width', min: 1, max: 4, step: 1, get: () => item.shield!.rim, set: (v) => (item.shield!.rim = v) },
          { kind: 'swatches', key: 'strap', label: 'Grip strap colour', swatches: wrapSw, get: () => item.hilt?.wrapColor ?? pal.wrap, set: (v) => { item.hilt = item.hilt ?? hiltFallback(item); item.hilt.wrapColor = v; } },
          { kind: 'gems', key: 'gems', label: 'Gem for the boss', slots, max: 1, gems: gemList, get: () => item.decoration.gems, set: (v) => (item.decoration.gems = v as any) },
        ];
      }
      const h = item.hilt!;
      const info = CATEGORY_INFO[item.category];
      return [
        { kind: 'options', key: 'guard', label: 'Guard', options: withAvailability(GUARDS, ctx), get: () => h.guard, set: (v) => (h.guard = v) },
        { kind: 'slider', key: 'guardWidth', label: 'Guard width', min: 5, max: item.category === 'dagger' ? 14 : 22, step: 1, get: () => h.guardWidth, set: (v) => (h.guardWidth = v), format: (v) => `${v * 2} px` },
        { kind: 'slider', key: 'gripLength', label: 'Grip length', min: info.gripRange[0], max: info.gripRange[1], step: 1, get: () => h.gripLength, set: (v) => (h.gripLength = v), format: (v) => `${v} px` },
        { kind: 'options', key: 'wrap', label: 'Wrapping', options: withAvailability(WRAPS, ctx), get: () => h.wrap, set: (v) => (h.wrap = v) },
        { kind: 'swatches', key: 'wrapColor', label: 'Wrap colour', swatches: wrapSw, get: () => h.wrapColor, set: (v) => (h.wrapColor = v) },
        { kind: 'options', key: 'pommel', label: 'Pommel (also sets the balance)', options: withAvailability(POMMELS, ctx), get: () => h.pommel, set: (v) => (h.pommel = v) },
        { kind: 'gems', key: 'gems', label: `Gems (up to ${maxGems})`, slots, max: maxGems, gems: gemList, get: () => item.decoration.gems, set: (v) => (item.decoration.gems = v as any) },
      ];
    },
    validate: ({ item, state }) => {
      const need: Record<string, number> = {};
      for (const g of item.decoration.gems) need[g.gem] = (need[g.gem] ?? 0) + 1;
      for (const [id, n] of Object.entries(need)) if (owned(state, id) < n) return `Not enough ${mat(id).name}.`;
      return null;
    },
    minigame: ({ item }) => ({ id: 'assembly', params: { mode: item.category === 'shield' ? 'rim' : 'hilt' } }),
  },

  engrave: {
    id: 'engrave',
    controls: (ctx) => {
      const { item } = ctx;
      const e = item.decoration.engraving;
      return [
        { kind: 'options', key: 'engraving', label: 'Engraving', options: withAvailability(ENGRAVINGS, ctx), get: () => e.pattern, set: (v) => (e.pattern = v) },
        { kind: 'toggle', key: 'inlay', label: 'Inlay the engraving in palette colour', get: () => e.inlay, set: (v) => (e.inlay = v) },
        { kind: 'options', key: 'emblem', label: 'Personal emblem', options: withAvailability(EMBLEMS, ctx), get: () => item.decoration.emblem, set: (v) => (item.decoration.emblem = v) },
        { kind: 'text', key: 'inscription', label: isBlade(item) ? 'Inscription (shown on the back of the blade)' : 'Inscription', max: 16, placeholder: 'e.g. Hold fast', get: () => item.decoration.inscription, set: (v) => (item.decoration.inscription = v.replace(/[^\w\s'.,!-]/g, '').slice(0, 16)) },
      ];
    },
    minigame: ({ item }) => (item.decoration.engraving.pattern === 'none' ? null : { id: 'engrave', params: { pattern: item.decoration.engraving.pattern } }),
  },

  infusion: {
    id: 'infusion',
    controls: () => [info('Trace a living constellation into the metal. Its brightness depends on the steadiness of your hand.')],
    minigame: () => ({ id: 'constellation', params: {} }),
  },

  finish: {
    id: 'finish',
    controls: (ctx) => {
      const c: Control[] = [{ kind: 'options', key: 'finish', label: 'Final finish', options: withAvailability(FINISHES, ctx), get: () => ctx.item.finish.finish, set: (v) => (ctx.item.finish.finish = v) }];
      if (ctx.item.finish.finish === 'glow')
        c.push({ kind: 'swatches', key: 'glow', label: 'Glow colour', swatches: PALETTES.map((p) => ({ id: p.glow, name: p.name, hex: p.glow })), get: () => ctx.item.finish.glowColor ?? palette(ctx.item.design.palette).glow, set: (v) => (ctx.item.finish.glowColor = v) });
      return c;
    },
    validate: ({ item }) => {
      if (item.finish.finish === 'glow') {
        const m = Math.max(mat(item.materials.primary).props.magic, item.materials.fusedWith ? mat(item.materials.fusedWith).props.magic : 0);
        if (m < 40 && !item.decoration.gems.some((g) => hasMat(g.gem) && mat(g.gem).props.magic >= 60)) return 'Fantasy glow needs a magically receptive material (magic 40+) or a glowing gem.';
      }
      return null;
    },
    minigame: () => ({ id: 'inspect', params: {} }),
  },

  appraisal: { id: 'appraisal', controls: () => [] },
};

function hiltFallback(item: Item) {
  return { guard: 'straight', guardWidth: 10, gripLength: 16, gripMaterial: 'leather', wrap: 'none', wrapColor: palette(item.design.palette).wrap, pommel: 'round', guardOffset: 0, guardTilt: 0, pommelOffset: 0 };
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const info = (html: string): Control => ({ kind: 'info', key: 'info', html });

function prepHint(id: string): string {
  const p = mat(id).prep!;
  const parts: string[] = [];
  parts.push(p.ideal > 0.7 ? 'It wants a fierce, high heat.' : p.ideal < 0.42 ? 'It prefers a gentle, low heat.' : 'It likes a moderate heat.');
  if (p.band < 0.11) parts.push('Its working window is narrow.');
  if (p.volatility > 0.12) parts.push('Expect flare-ups.');
  if (p.cool > 0.14) parts.push('It cools quickly.');
  return parts.join(' ');
}

export function stonesNeeded(sel: { count: number; stones: string[] }): Record<string, number> {
  const list = sel.stones.filter(Boolean);
  const out: Record<string, number> = {};
  for (let i = 0; i < sel.count; i++) {
    const id = list[i % list.length];
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

/** Materials the piece consumes when work begins. */
export function materialNeeds(item: Item): Record<string, number> {
  const cost = UNIT_COST[item.category];
  const need: Record<string, number> = {};
  const add = (id: string | undefined, n: number) => { if (id) need[id] = (need[id] ?? 0) + n; };
  add(item.materials.primary, cost.primary);
  add(item.materials.secondary, cost.secondary);
  if (item.hilt && item.category !== 'shield') add(item.hilt.gripMaterial, cost.grip);
  if (item.shield) add(item.shield.faceMaterial, cost.grip);
  add(item.materials.fusedWith, 1);
  return need;
}

export function clampItem(item: Item) {
  if (item.blade) {
    const info = CATEGORY_INFO[item.category];
    item.blade.length = clamp(item.blade.length, info.lengthRange[0], info.lengthRange[1]);
  }
}
