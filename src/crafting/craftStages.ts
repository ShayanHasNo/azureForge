// Stages of the bowyer's, fletcher's and armourer's crafts.
//
// Each stage is data: what it tells the player, which minigame it runs, which
// part of craftsmanship it counts toward and how its result is written into
// the piece. The stage *sequences* live in crafting/method.ts.
//
// Sources for the methods: self bows are one stave worked to an even bend by
// tillering; backed bows add sinew, rawhide or a hickory strip to take the
// tension; laminated bows are strips glued on a form; composite bows put horn
// on the belly (compression) and sinew on the back (tension) with hide glue
// and a slow cure. Arrows want spine-matched, straightened shafts, three
// feathers a third of a turn apart, and a point socketed or bound on. Armour:
// quilted gambeson, hardened leather (cuir bouilli), riveted 4-in-1 mail,
// laced scale and lamellar, brigandine plates riveted inside cloth, and plate
// raised over stakes, planished and articulated.

import { clamp } from '../core/util';
import { BOW_WOODS, FEATHERS, FIBERS, hasMat, HORNS, mat, METALS, SHAFT_WOODS, type MaterialDef } from '../data/materials';
import {
  ARMOR_CUTS, ARMOR_METHODS, ARROW_POINTS, BOW_METHODS, BOW_NOCKS, BOW_PROFILES, ENGRAVINGS, FLETCH_STYLES, PALETTES, WRAP_COLORS,
} from '../data/options';
import type { CraftStageId } from '../data/traditions';
import { ARROW_COUNT, BOW_SECTIONS, CATEGORY_INFO } from '../item/factory';
import type { Item, StageQuality } from '../item/types';
import type { MinigameResult } from '../minigames/types';
import { withAvailability, type Control, type StageCtx, type StageDef } from './stageTypes';

const info = (html: string): Control => ({ kind: 'info', key: 'info', html });
const name = (id: string) => (hasMat(id) ? mat(id).name.toLowerCase() : id);
const arr = (v: any, n: number, lo: number, hi: number, fill = 0): number[] => {
  const a = Array.isArray(v) ? v.slice(0, n).map((x) => clamp(Number(x) || 0, lo, hi)) : [];
  while (a.length < n) a.push(fill);
  return a;
};
const ids = (list: MaterialDef[]) => list.map((m) => m.id);
const metalIds = () => ids(METALS.filter((m) => m.kind === 'metal'));

// ---------------------------------------------------------------- materials each craft can use
/** What a method's main material may be, and what the two supporting slots mean. */
export interface MaterialPlan {
  primary: { label: string; options: string[]; need: number; help?: string };
  secondary: { label: string; options: string[]; need: number; help?: string };
  grip: { label: string; options: string[]; need: number; help?: string };
}

export function materialPlan(item: Item): MaterialPlan | null {
  if (item.category === 'bow') {
    const m = item.design.method ?? 'self';
    return {
      primary: {
        label: m === 'composite' ? 'Core wood' : m === 'laminated' ? 'Belly wood' : 'Stave', options: ids(BOW_WOODS), need: 2,
        help: 'Flexible wood bends further and casts faster; tough wood resists the crushing on the belly; dense wood makes heavier, slower limbs.',
      },
      secondary: { label: 'Bowstring', options: ids(FIBERS), need: 1, help: 'A light, low-stretch string wastes less of the bow\'s energy.' },
      grip: { label: 'Grip wrap', options: ['leather', 'blackleather', 'rawhide'], need: 1 },
    };
  }
  if (item.category === 'arrows') {
    const flint = item.arrows?.point === 'flint';
    return {
      primary: { label: 'Shafts', options: [...ids(SHAFT_WOODS), 'ash', 'birch', 'bamboo'], need: 2, help: 'Light shafts fly flatter; tough shafts survive more shots.' },
      secondary: flint
        ? { label: 'Point stone', options: ['flint', 'obsidian'], need: 2 }
        : { label: 'Point metal', options: metalIds(), need: 1, help: 'Hard metal keeps a point; soft metal is easier to forge cleanly.' },
      grip: { label: 'Feathers', options: ids(FEATHERS), need: 2, help: 'Stiff feathers steer well in the wet; showy ones are for presentation.' },
    };
  }
  if (item.category === 'armor') {
    const m = item.design.method ?? 'gambeson';
    const buckles = { label: 'Buckles & fittings', options: metalIds(), need: 1 };
    switch (m) {
      case 'gambeson': return {
        primary: { label: 'Outer cloth', options: ['linen', 'canvas', 'velvet'], need: 3 },
        secondary: buckles,
        grip: { label: 'Padding', options: ['wool', 'linen'], need: 2, help: 'Wool is soft and springy; layered linen is denser and tougher.' },
      };
      case 'cuirbouilli': return {
        primary: { label: 'Hide', options: ['thickhide', 'rawhide', 'leather', 'blackleather'], need: 3, help: 'Thick, firm hide hardens best.' },
        secondary: buckles,
        grip: { label: 'Lining', options: ['linen', 'wool'], need: 1 },
      };
      case 'mail': return {
        primary: { label: 'Ring wire', options: metalIds(), need: 4, help: 'Tough wire makes rings that hold; soft wire is easier to draw and rivet.' },
        secondary: { label: 'Edge rings & buckles', options: metalIds(), need: 1 },
        grip: { label: 'Padded lining', options: ['linen', 'wool', 'canvas'], need: 1 },
      };
      case 'scale': return {
        primary: { label: 'Plates', options: [...metalIds(), ...ids(HORNS), 'thickhide'], need: 3, help: 'Metal, horn or hardened hide — small plates all the same size.' },
        secondary: buckles,
        grip: { label: 'Lacing & backing', options: ['rawhide', 'leather', 'silk', 'sinew'], need: 2 },
      };
      case 'brigandine': return {
        primary: { label: 'Plates', options: metalIds(), need: 3 },
        secondary: { label: 'Rivets', options: metalIds(), need: 1, help: 'The rivet heads are all that shows — bright metal makes the pattern.' },
        grip: { label: 'Cloth cover', options: ['canvas', 'velvet', 'leather', 'linen'], need: 2 },
      };
      default: return {
        primary: { label: 'Sheet metal', options: metalIds(), need: 5, help: 'Tough, hard metal makes the best plate — and the hardest to raise.' },
        secondary: { label: 'Trim & rivets', options: metalIds(), need: 1 },
        grip: { label: 'Straps', options: ['leather', 'blackleather', 'rawhide'], need: 1 },
      };
    }
  }
  return null;
}

/** Extra materials a method uses beyond the three slots. */
export function extraNeeds(item: Item): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (id: string | undefined, n: number) => { if (id && hasMat(id)) out[id] = (out[id] ?? 0) + n; };
  if (item.bow) { add(item.bow.backing, 1); add(item.bow.belly, 1); if (item.bow.nock && item.bow.nock !== 'self') add(item.bow.nock, 1); }
  if (item.arrows) { add(item.arrows.binding, 1); add(item.arrows.nock, 1); }
  return out;
}

/** Make sure the three material slots hold something the chosen method can use. */
export function fitMaterials(item: Item, owned: (id: string) => number) {
  const plan = materialPlan(item);
  if (!plan) return;
  const pick = (cur: string, slot: MaterialPlan['primary']) => (slot.options.includes(cur) ? cur : slot.options.find((id) => owned(id) >= slot.need) ?? slot.options[0]);
  item.materials.primary = pick(item.materials.primary, plan.primary);
  item.materials.secondary = pick(item.materials.secondary, plan.secondary);
  item.materials.grip = pick(item.materials.grip, plan.grip);
  if (item.bow) {
    const m = item.design.method ?? 'self';
    item.bow.string = item.materials.secondary;
    item.bow.gripMaterial = item.materials.grip;
    const backs = backingOptions(m);
    item.bow.backing = backs.length ? (backs.includes(item.bow.backing) ? item.bow.backing : backs.find((id) => owned(id) >= 1) ?? backs[0]) : '';
    item.bow.belly = m === 'composite' ? (ids(HORNS).includes(item.bow.belly) ? item.bow.belly : ids(HORNS).find((id) => owned(id) >= 1) ?? 'oxhorn') : '';
  }
  if (item.armor) item.armor.method = item.design.method ?? 'gambeson';
}

function backingOptions(method: string): string[] {
  if (method === 'backed') return ['sinew', 'rawhide', 'hickory'];
  if (method === 'laminated') return ['hickory', 'bamboo', 'ash', 'elm'];
  if (method === 'composite') return ['sinew'];
  return [];
}

// ---------------------------------------------------------------- design & materials controls
export function craftDesignControls(ctx: StageCtx): Control[] {
  const { item } = ctx;
  const c: Control[] = [];
  const info0 = CATEGORY_INFO[item.category];
  if (item.bow) {
    const b = item.bow;
    c.push(
      { kind: 'options', key: 'method', label: 'Construction', options: withAvailability(BOW_METHODS, ctx), get: () => item.design.method ?? 'self', set: (v) => (item.design.method = v), help: 'Each method is made in a different order, with different materials.' },
      { kind: 'options', key: 'profile', label: 'Shape', options: BOW_PROFILES, get: () => b.profile, set: (v) => (b.profile = v) },
      { kind: 'slider', key: 'length', label: 'Length, nock to nock', min: info0.lengthRange[0], max: info0.lengthRange[1], step: 2, get: () => b.length, set: (v) => (b.length = v), format: (v) => `${v} px`, help: 'A longer bow is smoother and kinder to the wood; a shorter one is handier and faster.' },
      { kind: 'options', key: 'nock', label: 'Nocks', options: BOW_NOCKS, get: () => b.nock || 'self', set: (v) => (b.nock = v === 'self' ? '' : v) },
    );
  } else if (item.arrows) {
    const a = item.arrows;
    c.push(
      { kind: 'options', key: 'point', label: 'Points', options: ARROW_POINTS, get: () => a.point, set: (v) => (a.point = v) },
      { kind: 'options', key: 'fletch', label: 'Fletching', options: FLETCH_STYLES, get: () => a.fletch, set: (v) => (a.fletch = v) },
      { kind: 'slider', key: 'length', label: 'Shaft length', min: info0.lengthRange[0], max: info0.lengthRange[1], step: 2, get: () => a.length, set: (v) => (a.length = v), format: (v) => `${v} px` },
      { kind: 'swatches', key: 'crest', label: 'Cresting colour', swatches: PALETTES.map((p) => ({ id: p.accent, name: p.name, hex: p.accent })), get: () => a.crest, set: (v) => (a.crest = v) },
    );
  } else if (item.armor) {
    const a = item.armor;
    c.push(
      { kind: 'options', key: 'method', label: 'Construction', options: ARMOR_METHODS, get: () => item.design.method ?? 'gambeson', set: (v) => { item.design.method = v; a.method = v; }, help: 'Each kind of armour is made in its own way, from its own materials.' },
      { kind: 'options', key: 'cut', label: 'Cut', options: ARMOR_CUTS, get: () => a.cut, set: (v) => (a.cut = v) },
      { kind: 'swatches', key: 'trim', label: 'Trim colour', swatches: PALETTES.map((p) => ({ id: p.accent, name: p.name, hex: p.accent })), get: () => a.trimColor, set: (v) => (a.trimColor = v) },
    );
  }
  return c;
}

export function craftMaterialControls(ctx: StageCtx): Control[] {
  const { item } = ctx;
  const plan = materialPlan(item);
  if (!plan) return [];
  const c: Control[] = [];
  const slot = (key: 'primary' | 'secondary' | 'grip'): Control => ({
    kind: 'materials', key, label: plan[key].label, materials: plan[key].options, need: plan[key].need, help: plan[key].help,
    get: () => item.materials[key],
    set: (v) => {
      item.materials[key] = v;
      if (item.bow && key === 'secondary') item.bow.string = v;
      if (item.bow && key === 'grip') item.bow.gripMaterial = v;
    },
  });
  c.push(slot('primary'));
  if (item.bow) {
    const b = item.bow, m = item.design.method ?? 'self';
    const backs = backingOptions(m);
    if (backs.length > 1) c.push({ kind: 'materials', key: 'backing', label: m === 'laminated' ? 'Back lamination' : 'Backing', materials: backs, need: 1, get: () => b.backing, set: (v) => (b.backing = v), help: m === 'laminated' ? 'The back strip works in tension: hickory and bamboo excel.' : 'Sinew adds the most snap; rawhide and hickory mostly keep the back from lifting a splinter.' });
    else if (backs.length === 1) c.push(info(`The back is laid with <b>${name(backs[0])}</b> in hide glue.`));
    if (m === 'composite') c.push({ kind: 'materials', key: 'belly', label: 'Horn belly', materials: ids(HORNS), need: 1, get: () => b.belly, set: (v) => (b.belly = v) });
    c.push(slot('secondary'), slot('grip'));
    c.push({ kind: 'swatches', key: 'wrapColor', label: 'Grip colour', swatches: WRAP_COLORS.filter((w) => w.hex).map((w) => ({ id: w.hex, name: w.name, hex: w.hex })), get: () => b.wrapColor, set: (v) => (b.wrapColor = v) });
  } else if (item.arrows) {
    const a = item.arrows;
    c.push(slot('secondary'), slot('grip'));
    c.push({ kind: 'materials', key: 'binding', label: 'Binding thread', materials: ['linenthread', 'sinew', 'silk'], need: 1, get: () => a.binding, set: (v) => (a.binding = v) });
    c.push({ kind: 'materials', key: 'nock', label: 'Horn nock inserts (optional)', materials: ids(HORNS), need: 1, allowNone: true, get: () => a.nock, set: (v) => (a.nock = v), help: 'A sliver of horn in the nock keeps a heavy bow\'s string from splitting the shaft.' });
  } else {
    c.push(slot('secondary'), slot('grip'));
  }
  return c;
}

export function craftMaterialNeeds(item: Item): Record<string, number> {
  const plan = materialPlan(item);
  const need: Record<string, number> = {};
  if (!plan) return need;
  const add = (id: string, n: number) => { if (id) need[id] = (need[id] ?? 0) + n; };
  add(item.materials.primary, plan.primary.need);
  add(item.materials.secondary, plan.secondary.need);
  add(item.materials.grip, plan.grip.need);
  for (const [id, n] of Object.entries(extraNeeds(item))) add(id, n);
  return need;
}

// ---------------------------------------------------------------- the working stages
export interface CraftStage {
  /** Which part of craftsmanship this stage counts toward. */
  quality: keyof StageQuality;
  minigame: string;
  info: (item: Item) => string;
  params?: (ctx: StageCtx) => Record<string, any>;
  controls?: (ctx: StageCtx) => Control[];
  /** Write the measured result into the piece (the stage score is recorded separately). */
  apply?: (item: Item, r: MinigameResult) => void;
  /** Skip the minigame (the stage is then decisions only). */
  skip?: (item: Item) => boolean;
}

const zones = (item: Item, r: MinigameResult) => { if (Array.isArray(r.data.zones)) item.surface.zones = arr(r.data.zones, 8, 0, 1, 0.6); };
const dents = (item: Item, r: MinigameResult) => { if (item.armor) item.armor.dents = arr(r.data.dents, 8, 0, 1); };
const rows = (item: Item, r: MinigameResult) => {
  if (!item.armor) return;
  // Later row-work (rivets after weaving, straps after quilting) blends with what is already there.
  const fresh = arr(r.data.even, 8, 0, 1, clamp(r.score));
  const first = item.armor.even.every((v) => v === 0.75) && item.armor.gaps === 0.1;
  item.armor.even = first ? fresh : item.armor.even.map((v, i) => Math.round((v * 0.5 + fresh[i] * 0.5) * 1000) / 1000);
  const g = clamp(Number(r.data.gaps ?? 1 - r.score));
  item.armor.gaps = Math.round((first ? g : (item.armor.gaps + g) / 2) * 1000) / 1000;
};

export const CRAFT_STAGES: Record<CraftStageId, CraftStage> = {
  // ------------------------------------------------------------ bows
  stave: {
    quality: 'shaping', minigame: 'polish', params: () => ({ texture: 'brushed', mode: 'polish' }),
    info: (i) => `Work the <b>${name(i.materials.primary)}</b> stave down with the drawknife and rasp: long, even strokes from grip to tip, following the grain. Leave the back alone — one unbroken growth ring.`,
    apply: zones,
  },
  bowheat: {
    quality: 'prep', minigame: 'heat',
    info: (i) => `Hold the belly of the <b>${name(i.materials.primary)}</b> over the coals. Toasted evenly it hardens and gains spring; scorched, it turns brittle.`,
  },
  backing: {
    quality: 'surface', minigame: 'polish', params: () => ({ texture: 'smooth', mode: 'polish' }),
    info: (i) => `Lay the <b>${name(i.bow?.backing || 'sinew')}</b> along the back in hide glue. Cover it completely and evenly: a thin patch is where a backing lifts.`,
    apply: (item, r) => { zones(item, r); if (item.bow) item.bow.glue = Math.round(clamp(0.5 * item.bow.glue + 0.5 * r.score) * 1000) / 1000; },
  },
  glueup: {
    quality: 'fold', minigame: 'fold', params: (c) => ({ secondary: c.item.bow?.belly || c.item.bow?.backing || c.item.materials.primary, mode: 'laminate' }),
    info: (i) => i.design.method === 'composite'
      ? `Glue the <b>${name(i.bow?.belly || 'oxhorn')}</b> belly to the core. Line the grooved faces up and press them home before the hide glue chills.`
      : `Stack the <b>${name(i.materials.primary)}</b> belly and the <b>${name(i.bow?.backing || 'hickory')}</b> back on the form. Line each layer up, then clamp it.`,
    apply: (item, r) => { if (item.bow) item.bow.glue = Math.round(clamp(Number(r.data.clarity ?? r.score)) * 1000) / 1000; },
  },
  cure: {
    quality: 'prep', minigame: 'anneal',
    info: () => 'Hide glue and sinew shrink as they dry, pulling the bow into reflex. Keep the drying room on its slow curve: too warm and the glue lets go, too damp and it never sets.',
  },
  tiller: {
    quality: 'structure', minigame: 'tiller',
    info: () => 'Put the bow on the tillering tree and draw it a little at a time. Where a limb stays flat it is too stiff: scrape wood from the belly there. Never scrape a spot that already bends too much — a hinge cannot be put back.',
    apply: (item, r) => {
      if (!item.bow) return;
      item.bow.upper = arr(r.data.upper, BOW_SECTIONS, -1, 1).map((v) => Math.round(v * 1000) / 1000);
      item.bow.lower = arr(r.data.lower, BOW_SECTIONS, -1, 1).map((v) => Math.round(v * 1000) / 1000);
      item.bow.draw = Math.round(clamp(Number(r.data.draw ?? r.score)) * 1000) / 1000;
      item.bow.hinge = Math.round(clamp(Number(r.data.hinge ?? 0)) * 1000) / 1000;
    },
  },
  string: {
    quality: 'assembly', minigame: 'string',
    info: (i) => `Twist a string of <b>${name(i.materials.secondary)}</b>: two bundles, each twisted one way and laid over the other the opposite way, so they lock. Keep the rhythm and the twists stay even.`,
    apply: (item, r) => { if (item.bow) item.bow.stringQuality = Math.round(clamp(Number(r.data.even ?? r.score)) * 1000) / 1000; },
  },
  // ------------------------------------------------------------ arrows
  straighten: {
    quality: 'structure', minigame: 'straighten',
    info: (i) => `First bend-test the <b>${name(i.materials.primary)}</b> shafts and keep the ${ARROW_COUNT} that match — arrows of the same spine fly alike. Then sight down each one and ease out its bends over a little heat.`,
    apply: (item, r) => {
      if (!item.arrows) return;
      item.arrows.straight = arr(r.data.straight, ARROW_COUNT, 0, 1, 0.6).map((v) => Math.round(v * 1000) / 1000);
      item.arrows.spine = arr(r.data.spine, ARROW_COUNT, -1, 1).map((v) => Math.round(v * 1000) / 1000);
    },
  },
  pointheat: {
    quality: 'prep', minigame: 'heat',
    info: (i) => `Bring the <b>${name(i.materials.secondary)}</b> point blanks to heat.`,
  },
  points: {
    quality: 'shaping', minigame: 'hammer', params: (c) => ({ style: c.item.arrows?.point === 'flint' ? 'swing' : c.item.arrows?.point === 'broadhead' ? 'heavy' : 'steady' }),
    info: (i) => i.arrows?.point === 'flint'
      ? `Knap the <b>${name(i.materials.secondary)}</b>: strike flakes from the edge in a steady swing. Each point is bound into a split shaft with ${name(i.arrows.binding)}.`
      : `Forge the ${i.arrows?.point ?? 'bodkin'} points from <b>${name(i.materials.secondary)}</b>, drawing each socket out over the horn of the anvil.`,
    apply: (item, r) => { if (item.arrows) item.arrows.pointQuality = Math.round(clamp(1 - (arr(r.data.dents, 8, 0, 1).reduce((a, b) => a + b, 0) / 8) * 1.2) * 1000) / 1000; },
  },
  fletch: {
    quality: 'assembly', minigame: 'fletch',
    info: (i) => `Three <b>${name(i.materials.grip)}</b> vanes to each shaft, a third of a turn apart, with the cock feather square to the nock so it clears the bow.`,
    apply: (item, r) => { if (item.arrows) item.arrows.fletchErr = arr(r.data.fletchErr, ARROW_COUNT, -1, 1).map((v) => Math.round(v * 1000) / 1000); },
  },
  // ------------------------------------------------------------ gambeson
  padding: {
    quality: 'surface', minigame: 'polish', params: () => ({ texture: 'smooth', mode: 'polish' }),
    info: (i) => `Spread the <b>${name(i.materials.grip)}</b> between the layers of <b>${name(i.materials.primary)}</b>. Cover every part evenly: a thin patch is a weak patch.`,
    apply: zones,
  },
  quilt: {
    quality: 'structure', minigame: 'stitch', params: () => ({ mode: 'stitch' }),
    info: () => 'Stitch the channels from collar to hem. Even, close stitches hold the padding where it was laid.',
    apply: rows,
  },
  lacing: {
    quality: 'assembly', minigame: 'stitch', params: () => ({ mode: 'lace' }),
    info: () => 'Work the eyelets down both edges and lace the closures, one side then the other.',
    apply: rows,
  },
  // ------------------------------------------------------------ hardened leather
  harden: {
    quality: 'prep', minigame: 'heat',
    info: (i) => `Soak the <b>${name(i.materials.primary)}</b>, then bring the water up to just short of a simmer. Too cool and the hide stays soft; too hot and it shrivels and cracks.`,
  },
  mould: {
    quality: 'shaping', minigame: 'hammer', params: () => ({ style: 'steady' }),
    info: () => 'Stretch the hot hide over the wooden form and work it down with the mallet, all the way round, before it sets.',
    apply: dents,
  },
  tooling: {
    quality: 'engraving', minigame: 'engrave', params: (c) => ({ pattern: c.item.decoration.engraving.pattern }),
    skip: (i) => i.decoration.engraving.pattern === 'none',
    controls: (ctx) => [
      { kind: 'options', key: 'engraving', label: 'Tooled pattern', options: withAvailability(ENGRAVINGS, ctx), get: () => ctx.item.decoration.engraving.pattern, set: (v) => (ctx.item.decoration.engraving.pattern = v) },
      { kind: 'toggle', key: 'inlay', label: 'Colour the tooling', get: () => ctx.item.decoration.engraving.inlay, set: (v) => (ctx.item.decoration.engraving.inlay = v) },
    ],
    info: () => 'While the leather is still a little damp, cut and stamp the decoration. Leave it plain if you prefer.',
    apply: (item, r) => {
      const e = item.decoration.engraving;
      e.jitter = (Array.isArray(r.data.jitter) ? r.data.jitter.slice(0, 400) : []).map((v: number) => Math.round(clamp(Number(v) || 0, -1, 1) * 1000) / 1000);
      e.slips = (Array.isArray(r.data.slips) ? r.data.slips.slice(0, 60) : []).map((v: number) => Math.round(v));
      e.crispness = clamp(Number(r.data.crispness ?? r.score));
    },
  },
  wax: {
    quality: 'surface', minigame: 'polish', params: () => ({ texture: 'smooth', mode: 'polish' }),
    info: () => 'Rub hot wax into the hardened leather and burnish it. Even coverage keeps the rain out.',
    apply: zones,
  },
  straps: {
    quality: 'assembly', minigame: 'stitch', params: () => ({ mode: 'rivet' }),
    info: (i) => `Rivet on the straps and the <b>${name(i.materials.secondary)}</b> buckles.`,
    apply: rows,
  },
  // ------------------------------------------------------------ mail
  wire: {
    quality: 'prep', minigame: 'heat',
    info: (i) => `Soften the <b>${name(i.materials.primary)}</b> rod in the fire so it can be pulled through the draw-plate without snapping.`,
  },
  rings: {
    quality: 'shaping', minigame: 'hammer', params: () => ({ style: 'syncopated' }),
    info: () => 'Wind the wire round the mandrel, cut the coil into rings, then flatten and pierce each overlapped end — tap, tap, strike.',
    apply: dents,
  },
  weave: {
    quality: 'structure', minigame: 'weave',
    info: () => 'Four in one: every ring passes through two rings of the row above and will hold two of the row below. Thread each ring through both, then set it down.',
    apply: rows,
  },
  rivets: {
    quality: 'assembly', minigame: 'stitch', params: () => ({ mode: 'rivet' }),
    info: (i) => i.armor?.method === 'brigandine'
      ? `Rivet each plate to the inside of the <b>${name(i.materials.grip)}</b>. Only the <b>${name(i.materials.secondary)}</b> rivet heads will show, so set them in clean rows.`
      : 'Close every ring with a wedge rivet. One clean blow each.',
    apply: rows,
  },
  // ------------------------------------------------------------ scale, brigandine, plate
  plateheat: {
    quality: 'prep', minigame: 'heat',
    info: (i) => `Bring the <b>${name(i.materials.primary)}</b> to working heat.`,
  },
  plates: {
    quality: 'shaping', minigame: 'hammer', params: () => ({ style: 'steady' }),
    info: (i) => `Cut the small plates of <b>${name(i.materials.primary)}</b>, dish each one a little and punch its holes. They only lie flat together if they are all alike.`,
    apply: dents,
  },
  lace: {
    quality: 'structure', minigame: 'stitch', params: () => ({ mode: 'lace' }),
    info: (i) => `Lace the plates into rows with <b>${name(i.materials.grip)}</b>, then lace each row over the one below.`,
    apply: rows,
  },
  raise: {
    quality: 'shaping', minigame: 'hammer', params: () => ({ style: 'heavy' }),
    info: () => 'Raise the breastplate over the stakes: work round it course by course, each blow moving a little metal inward, until the flat sheet has become a deep bowl.',
    apply: dents,
  },
  planish: {
    quality: 'structure', minigame: 'polish', params: () => ({ texture: 'hammered', mode: 'polish' }),
    info: () => 'Planish the plate with close, light, evenly spaced blows from a polished hammer, until the lumps of raising are gone.',
    apply: (item, r) => {
      zones(item, r);
      // good planishing takes out most of what raising left behind
      if (item.armor) item.armor.dents = item.armor.dents.map((d) => Math.round(d * (1 - 0.8 * clamp(r.score)) * 1000) / 1000);
    },
  },
  articulate: {
    quality: 'assembly', minigame: 'stitch', params: () => ({ mode: 'rivet' }),
    info: (i) => `Rivet the lames of the fauld on leathers so they slide over one another, and set the <b>${name(i.materials.secondary)}</b> buckles.`,
    apply: rows,
  },
  burnish: {
    quality: 'surface', minigame: 'polish', params: (c) => ({ texture: c.state.upgrades.includes('wheel') ? 'reflective' : 'smooth', mode: 'polish', wheel: c.state.upgrades.includes('wheel') }),
    info: () => 'Bring up the final surface: slow, complete passes over every part of the plate.',
    apply: zones,
  },
};

/** StageDef (controls + minigame) for a craft stage. */
export function craftStageDef(id: CraftStageId): StageDef {
  const st = CRAFT_STAGES[id];
  return {
    id,
    controls: (ctx) => [info(st.info(ctx.item)), ...(st.controls?.(ctx) ?? [])],
    minigame: (ctx) => (st.skip?.(ctx.item) ? null : { id: st.minigame, params: st.params?.(ctx) ?? {} }),
  };
}
