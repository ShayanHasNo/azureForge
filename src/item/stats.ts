// Item statistics. Bounded, independent contributions from:
//  1. material potential  2. design quality  3. execution quality
//  4. finishing quality   5. component compatibility
// Material sets a ceiling/character; craftsmanship decides how much of it is realised.

import { clamp, mean, stdev } from '../core/util.js';
import { compatibility, hasMat, mat, UNIT_COST } from '../data/materials.js';
import { APPROACHES, findOption, palette } from '../data/options.js';
import { tradition } from '../data/traditions.js';
import type { Category, Item, ItemStats, StageQuality } from './types.js';

const n = (v: number) => v / 100;

/** Weights of each stage in craftsmanship. Only stages that were performed count. */
const CRAFT_WEIGHTS: Record<keyof StageQuality, number> = {
  prep: 0.13, fold: 0.08, shaping: 0.17, structure: 0.15, inlay: 0.07, surface: 0.13, assembly: 0.13, engraving: 0.09, infusion: 0.07, finishing: 0.1,
};

export function stageScores(q: StageQuality): number[] {
  return (Object.keys(CRAFT_WEIGHTS) as (keyof StageQuality)[]).filter((k) => q[k] !== undefined).map((k) => q[k]!);
}

export function craftsmanshipOf(q: StageQuality): number {
  let w = 0, s = 0;
  for (const k of Object.keys(CRAFT_WEIGHTS) as (keyof StageQuality)[]) {
    const v = q[k];
    if (v === undefined) continue;
    w += CRAFT_WEIGHTS[k];
    s += CRAFT_WEIGHTS[k] * v;
  }
  if (!w) return 0;
  const avg = s / w;
  // Consistency bonus: steady, even work reads as mastery.
  const consistency = 1 - clamp(stdev(stageScores(q)) * 2.2);
  return clamp(avg * 0.96 + consistency * 0.04) * 100;
}

const q = (item: Item, k: keyof StageQuality, fallback = 0.55) => item.quality[k] ?? fallback;

/** Design coherence: how well the chosen options belong together (0..1). Experimental accepts anything. */
export function designCohesion(item: Item): number {
  const tags = collectDesignTags(item);
  const dir = item.design.direction;
  const trad = tradition(item.tradition);
  const want: Record<string, string[]> = {
    elegant: ['elegant', 'graceful', 'swift', 'bright', 'clean', 'feather'],
    heavy: ['heavy', 'mighty', 'steadfast', 'rustic'],
    ornamental: ['ornate', 'decorative', 'pattern', 'ceremonial', 'geometric'],
    minimalist: ['minimal', 'clean', 'practical'],
    ancient: ['ancient', 'historic', 'knot', 'rustic'],
    rustic: ['rustic', 'humble', 'handmade', 'earthy', 'practical'],
    ceremonial: ['ceremonial', 'regal', 'bright', 'ornate'],
    nature: ['nature', 'vine', 'verdant', 'wild', 'earthy', 'river', 'feather'],
    experimental: ['experimental', 'strange', 'magical'],
  };
  const avoid: Record<string, string[]> = {
    minimalist: ['ornate', 'decorative', 'pattern'],
    elegant: ['heavy'],
    heavy: ['swift', 'delicate', 'light'],
    rustic: ['ceremonial', 'regal'],
  };
  const w = want[dir] ?? [];
  const a = avoid[dir] ?? [];
  const hits = tags.filter((t) => w.includes(t)).length;
  const misses = tags.filter((t) => a.includes(t)).length;
  const tradHits = tags.filter((t) => trad.favours.includes(t)).length;
  const motif = item.design.motif;
  const motifEcho = motif !== 'none' && (item.decoration.engraving.pattern.includes(motif.slice(0, 4)) || item.decoration.emblem === motif || tags.includes(motif)) ? 0.08 : 0;
  const pal = palette(item.design.palette);
  const palHits = pal.tags.filter((t) => matTraits(item).includes(t)).length;
  let c = 0.5 + Math.min(0.28, hits * 0.055) - Math.min(0.3, misses * 0.08) + Math.min(0.12, tradHits * 0.03) + motifEcho + Math.min(0.08, palHits * 0.04);
  const compat = compatibility(item.materials.primary, item.materials.secondary);
  c += (compat - 0.55) * 0.25;
  if (dir === 'experimental') c = Math.max(c, 0.62 + Math.min(0.3, tags.filter((t) => t === 'strange' || t === 'experimental').length * 0.05));
  return clamp(c);
}

function matTraits(item: Item): string[] {
  const out: string[] = [];
  for (const id of [item.materials.primary, item.materials.secondary, item.materials.fusedWith]) if (id && hasMat(id)) out.push(...mat(id).traits);
  return out;
}

export function collectDesignTags(item: Item): string[] {
  const t: string[] = [];
  const add = (list: string, id?: string) => { if (id) t.push(...(findOption(list, id)?.tags ?? [])); };
  add('direction', item.design.direction);
  add('motif', item.design.motif);
  for (const i of item.design.intents) add('intent', i);
  add('approach', item.structure.approach);
  if (item.blade) { add('profile', item.blade.profile); add('tip', item.blade.tip); add('fuller', item.blade.fuller); }
  if (item.hilt) { add('guard', item.hilt.guard); add('pommel', item.hilt.pommel); add('wrap', item.hilt.wrap); }
  if (item.shield) { add('shieldShape', item.shield.shape); add('boss', item.shield.boss); }
  if (item.bow) { add('bowMethod', item.design.method); add('bowProfile', item.bow.profile); add('bowNock', item.bow.nock || 'self'); }
  if (item.arrows) { add('arrowPoint', item.arrows.point); add('fletchStyle', item.arrows.fletch); }
  if (item.armor) { add('armorMethod', item.armor.method); add('armorCut', item.armor.cut); }
  add('texture', item.surface.texture);
  add('engraving', item.decoration.engraving.pattern);
  add('emblem', item.decoration.emblem);
  add('finish', item.finish.finish);
  return t;
}

/** Decorative presence 0..1: how much ornament the design calls for. */
export function decorPresence(item: Item): number {
  let p = 0;
  const cx = (list: string, id: string) => findOption(list, id)?.complexity ?? 0;
  p += cx('engraving', item.decoration.engraving.pattern);
  p += cx('texture', item.surface.texture);
  p += cx('finish', item.finish.finish);
  if (item.hilt) p += cx('guard', item.hilt.guard) + cx('pommel', item.hilt.pommel) + cx('wrap', item.hilt.wrap);
  if (item.blade) p += cx('profile', item.blade.profile) + cx('tip', item.blade.tip);
  if (item.bow) p += cx('bowMethod', item.design.method ?? 'self') + cx('bowProfile', item.bow.profile) + cx('bowNock', item.bow.nock || 'self');
  if (item.arrows) p += cx('arrowPoint', item.arrows.point) + cx('fletchStyle', item.arrows.fletch) + (item.arrows.nock ? 0.04 : 0) + 0.06;
  if (item.armor) p += cx('armorMethod', item.armor.method) + (item.armor.cut === 'coat' ? 0.04 : 0);
  p += item.decoration.gems.length * 0.09;
  p += item.decoration.emblem !== 'none' ? 0.1 : 0;
  p += Math.min(0.12, item.decoration.inscription.trim().length * 0.012);
  p += item.decoration.stones.length * 0.04;
  p += item.decoration.constellation ? 0.12 : 0;
  if (item.decoration.engraving.inlay && item.decoration.engraving.pattern !== 'none') p += 0.06;
  if (item.surface.texture === 'layered') p += item.surface.patternClarity * 0.1;
  return clamp(p);
}

function approachMods(item: Item) {
  const a = APPROACHES.find((x) => x.id === item.structure.approach) ?? APPROACHES[0];
  const m = { ...a.mods };
  if (m.variance) {
    // Experimental structure: deterministic per-seed swing.
    const r = ((item.seed % 1000) / 1000 - 0.5) * 2;
    m.durability += r * m.variance;
    m.flexibility -= r * m.variance * 0.8;
    m.balance += ((item.seed >> 10) % 100 / 100 - 0.5) * m.variance;
  }
  return m;
}

/** Physical balance from design: where the balance point sits vs. ideal (0..1). */
export function physicsBalance(item: Item): { score: number; point: number; ideal: number } {
  if (!item.blade || !item.hilt) return { score: 0.75, point: 0, ideal: 0 };
  const b = item.blade, h = item.hilt;
  const P = mat(item.materials.primary).props;
  const S = hasMat(item.materials.secondary) ? mat(item.materials.secondary).props : P;
  const mods = approachMods(item);
  const widthF: Record<string, number> = { broad: 1.25, falchion: 1.2, leaf: 1.05, needle: 0.55, tapered: 0.75, wavy: 1.05, kopis: 1.15, thorn: 0.6, crag: 0.95, crystal: 0.85 };
  const bladeMass = b.length * b.width * (widthF[b.profile] ?? 1) * (0.6 + b.thickness) * (P.density / 60) * (1 + mods.weight);
  const pommelMass: Record<string, number> = { round: 1, disc: 0.75, faceted: 1.1, crescent: 0.8, wheel: 1.45, ring: 0.6, teardrop: 1.15, crown: 1.05, fishtail: 0.7, gearwheel: 1.3 };
  const guardMass = h.guardWidth * (h.guard === 'basket' ? 2 : h.guard === 'disc' ? 1.3 : 1) * 0.5;
  const pm = (pommelMass[h.pommel] ?? 1) * 22 * (S.density / 60) * (item.category === 'dagger' ? 0.55 : 1);
  // Balance point measured in px from the guard (positive = toward tip).
  const bladeCOM = b.length * 0.38;
  const pommelPos = -(h.gripLength + 5);
  const total = bladeMass + pm + guardMass;
  const point = (bladeMass * bladeCOM + pm * pommelPos) / total;
  const ideal = b.length * (item.category === 'dagger' ? 0.06 : 0.14);
  const err = Math.abs(point - ideal) / (b.length * 0.35);
  return { score: clamp(1 - err), point, ideal };
}

export function itemWeight(item: Item): number {
  const P = mat(item.materials.primary).props;
  const mods = approachMods(item);
  if (item.shield) {
    const s = item.shield;
    const face = isFaceWood(item) ? 0.45 : P.density / 70;
    const area = s.width * s.height * (s.shape === 'buckler' ? 0.4 : s.shape === 'tower' ? 1.15 : 0.8);
    return round1(area / 900 * (1 + face) * (1 + mods.weight) + 0.4);
  }
  if (item.bow) return round1(0.35 + (item.bow.length / 150) * (0.25 + item.bow.limb * 0.09) * (P.density / 50) + (item.bow.belly ? 0.12 : 0));
  if (item.arrows) return round1(item.arrows.count * (0.018 + (item.arrows.length / 100) * 0.03 * (P.density / 30)) + (item.arrows.point === 'broadhead' ? 0.06 : 0.03));
  if (item.armor) {
    const a = item.armor;
    const base: Record<string, number> = { gambeson: 2.2, cuirbouilli: 3.2, mail: 9.5, scale: 8, brigandine: 8.5, plate: 7.5 };
    const cut = a.cut === 'coat' ? 1.35 : a.cut === 'vest' ? 0.78 : 1;
    const metal = hasMat(item.materials.primary) && mat(item.materials.primary).kind === 'metal';
    return round1((base[a.method] ?? 5) * cut * (metal ? P.density / 66 : 0.7 + P.density / 130));
  }
  const b = item.blade;
  if (!b) return 1;
  const vol = b.length * b.width * (0.6 + b.thickness);
  const kg = (vol / 620) * (P.density / 65) * (1 + mods.weight) + 0.25;
  return round1(item.category === 'dagger' ? kg * 0.8 : kg);
}
const round1 = (v: number) => Math.round(v * 10) / 10;

function isFaceWood(item: Item) {
  const f = item.shield?.faceMaterial;
  return !!f && hasMat(f) && mat(f).kind !== 'metal' && mat(f).kind !== 'crystal';
}

export function uniquenessOf(item: Item): number {
  let u = 0.25;
  const tags = collectDesignTags(item);
  u += tags.filter((t) => t === 'strange' || t === 'experimental').length * 0.05;
  if (item.blade) {
    u += item.blade.asymmetry * 0.15;
    u += Math.min(0.1, Math.abs(item.blade.curve) * 0.1);
    if (!['straight', 'tapered'].includes(item.blade.profile)) u += 0.06;
  }
  u += item.mutations.length * 0.08;
  if (item.materials.fusedWith) u += 0.12;
  const c = compatibility(item.materials.primary, item.materials.secondary);
  if (c < 0.4) u += 0.08; // daring clash
  u += decorPresence(item) * 0.18;
  if (item.decoration.inscription.trim()) u += 0.05;
  if (item.decoration.constellation) u += 0.06;
  if (item.decoration.stones.length) u += 0.05;
  // Handmade quirks have character.
  u += Math.min(0.08, item.blemishes.length * 0.015);
  return clamp(u);
}

export function rarityOf(item: Item): { value: number; label: string } {
  const p = mat(item.materials.primary).rarity;
  const s = hasMat(item.materials.secondary) ? mat(item.materials.secondary).rarity : 1;
  const gems = item.decoration.gems.map((g) => (hasMat(g.gem) ? mat(g.gem).rarity : 1));
  let r = (p - 1) * 14 + (s - 1) * 5 + gems.reduce((a, b) => a + (b - 1) * 4, 0);
  r += item.mutations.length * 6 + (item.materials.fusedWith ? 8 : 0) + (item.decoration.constellation ? 6 : 0);
  r += uniquenessOf(item) * 18;
  const v = clamp(r, 0, 100);
  const label = v < 18 ? 'Common' : v < 34 ? 'Uncommon' : v < 52 ? 'Rare' : v < 70 ? 'Remarkable' : 'Singular';
  return { value: v, label };
}

export function gradeFor(craft: number): string {
  if (craft >= 93) return 'Legendary';
  if (craft >= 85) return 'Masterwork';
  if (craft >= 74) return 'Superior';
  if (craft >= 60) return 'Fine';
  if (craft >= 45) return 'Serviceable';
  return 'Rough';
}

export function materialCost(item: Item): number {
  const u = UNIT_COST[item.category];
  let c = mat(item.materials.primary).value * u.primary;
  if (hasMat(item.materials.secondary)) c += mat(item.materials.secondary).value * u.secondary;
  const grip = item.hilt?.gripMaterial ?? item.shield?.faceMaterial ?? item.materials.grip;
  if (grip && hasMat(grip)) c += mat(grip).value * u.grip;
  for (const g of item.decoration.gems) if (hasMat(g.gem)) c += mat(g.gem).value;
  if (item.materials.fusedWith && hasMat(item.materials.fusedWith)) c += mat(item.materials.fusedWith).value;
  return c;
}

export function computeStats(item: Item): ItemStats {
  const P = mat(item.materials.primary).props;
  const F = item.materials.fusedWith && hasMat(item.materials.fusedWith) ? mat(item.materials.fusedWith).props : null;
  // Fused alloys average their parents.
  const M = F ? (Object.fromEntries(Object.entries(P).map(([k, v]) => [k, (v + (F as any)[k]) / 2])) as unknown as typeof P) : P;
  const mods = approachMods(item);
  const thick = item.blade?.thickness ?? 0.5;
  const craft = craftsmanshipOf(item.quality);
  const C = craft / 100;
  const prep = q(item, 'prep'), shaping = q(item, 'shaping'), structure = q(item, 'structure'), assembly = q(item, 'assembly');
  const surface = q(item, 'surface'), finishing = q(item, 'finishing');
  const compat = compatibility(item.materials.primary, item.materials.secondary);
  const cohesion = designCohesion(item);

  const materialQuality = clamp(0.3 + 0.7 * Math.pow(prep, 0.9)) * 100;
  const realiseStruct = 0.5 * structure + 0.3 * prep + 0.2 * shaping;
  // Durability: half material potential, half how well it was realised.
  const durPotential = clamp(n(M.toughness) * 0.75 + n(M.hardness) * 0.25 + mods.durability + (thick - 0.5) * 0.12 + (item.blade?.fuller === 'ridge' ? 0.04 : 0));
  const durability = clamp(0.5 * durPotential + 0.5 * realiseStruct) * 100;
  const integrity = clamp((0.35 * ((n(M.hardness) + n(M.toughness)) / 2) + 0.65 * (0.45 * structure + 0.35 * assembly + 0.2 * shaping)) * (1 + mods.integrity) + (compat - 0.55) * 0.12) * 100;
  const phys = physicsBalance(item);
  const symmetryExec = item.blade && item.blade.asymmetry > 0.3 ? 0.5 * structure + 0.5 : structure;
  const balance = item.shield
    ? clamp(0.4 * (1 - Math.abs(item.shield.rimGap) / 4) + 0.6 * (0.6 * assembly + 0.4 * shaping)) * 100
    : clamp(0.38 * phys.score + 0.62 * (0.5 * assembly + 0.3 * symmetryExec + 0.2 * shaping) + mods.balance) * 100;
  const flexibility = clamp((0.62 * n(M.flexibility) + 0.38 * prep) * (1 + mods.flexibility) - (thick - 0.5) * 0.15) * 100;
  const weight = itemWeight(item);
  const presence = decorPresence(item);
  const decoExec = mean([q(item, 'engraving', finishing), finishing, surface, item.quality.inlay ?? surface, item.quality.infusion ?? surface]);
  const ornamentation = clamp(presence * (0.35 + 0.65 * decoExec) * (0.6 + 0.4 * n(M.decorative)) * (1 + mods.ornament) * 1.25 + 0.05) * 100;
  const complexity = clamp(presence * 1.1) * 100;
  const surfaceQuality = clamp(0.22 * n(M.luster) + 0.58 * surface + 0.2 * finishing) * 100;
  const uniqueness = uniquenessOf(item) * 100;
  const rarity = rarityOf(item);

  // Intent fulfilment: did the finished piece become what the design promised?
  const intentChecks: Record<string, () => number> = {
    swift: () => clamp(1.4 - weight / 1.6),
    steadfast: () => n(durability),
    graceful: () => n(balance),
    mighty: () => clamp(weight / 2 + n(integrity) * 0.4),
    mystic: () => clamp(n(M.magic) * 0.6 + (item.finish.finish === 'glow' || item.decoration.constellation ? 0.4 : 0)),
    humble: () => clamp(1 - presence * 1.4 + 0.2),
    regal: () => clamp(n(ornamentation) * 0.6 + n(surfaceQuality) * 0.4),
    wild: () => clamp(uniqueness / 100 + (item.blade?.asymmetry ?? 0) * 0.3),
  };
  const intents = item.design.intents.filter((i) => intentChecks[i]);
  const intentFulfillment = intents.length ? mean(intents.map((i) => intentChecks[i]())) * 100 : 60;

  let coverage = 0, compactness = 0;
  if (item.shield) {
    const s = item.shield;
    const areaF = { round: 0.78, heater: 0.82, kite: 0.75, tower: 0.95, buckler: 0.38 }[s.shape] ?? 0.78;
    coverage = clamp((s.width * s.height * areaF) / 4200 * (0.85 + 0.15 * assembly)) * 100;
  }
  if (item.category === 'dagger' && item.blade) {
    compactness = clamp(1 - (item.blade.length - 32) / 40 + 0.15 * assembly + 0.1 * (1 - weight)) * 100;
  }

  // Collector appeal: craftsmanship first, then uniqueness, ornament and cohesion. Rarity matters least.
  let appeal = 0.42 * C + 0.18 * uniqueness / 100 + 0.14 * ornamentation / 100 + 0.14 * cohesion + 0.06 * rarity.value / 100 + 0.06 * n(intentFulfillment);
  // Handmade charm: imperfect but characterful pieces still find admirers.
  if (C < 0.6 && uniqueness > 45) appeal += 0.05;
  const collectorAppeal = clamp(appeal) * 100;

  const matCost = materialCost(item);
  const rarityTier = 1 + Math.floor(rarity.value / 20) * 0.05;
  const value = Math.round(matCost * 1.15 + (14 + 260 * Math.pow(C, 2.2)) * (0.75 + 0.6 * collectorAppeal / 100) * rarityTier);

  let functional = item.shield ? mean([coverage, integrity, durability, balance]) : mean([durability, balance, integrity, flexibility]);

  // Bows, arrows and armour: what the piece is for decides its headline numbers. They are built
  // the same way as everything else — half what the material could give, half how well it was made.
  const extra: Partial<ItemStats> = {};
  let balanceOut = balance, durabilityOut = durability;
  if (item.bow) {
    const b = item.bow;
    const errs = [...b.upper, ...b.lower];
    const even = clamp(1 - mean(errs.map((e) => Math.abs(e))) / 0.55);
    const limbMatch = clamp(1 - Math.abs(mean(b.upper) - mean(b.lower)) / 0.4);
    const S = hasMat(b.string) ? mat(b.string).props : null;
    // method: what the construction adds to the stave
    const snap = b.belly ? 0.16 : b.backing === 'sinew' ? 0.1 : b.backing ? 0.05 : 0;
    const spring = clamp(n(M.flexibility) * 0.7 + n(M.toughness) * 0.3 + snap);
    const lengthF = (b.length - 120) / 44; // 0 short … 1 long
    const shape = { longbow: { cast: 0, smooth: 0.04, stable: 0.06 }, flatbow: { cast: -0.02, smooth: 0.02, stable: 0.08 }, recurve: { cast: 0.08, smooth: -0.02, stable: -0.05 }, reflex: { cast: 0.05, smooth: 0.06, stable: -0.03 } }[b.profile] ?? { cast: 0, smooth: 0, stable: 0 };
    const pounds = (26 + 46 * spring * (0.8 + 0.25 * (b.limb - 2) / 2)) * (0.55 + 0.45 * b.draw) * (1 - 0.12 * lengthF);
    const stringF = S ? clamp(1 - S.density / 90) * 0.5 + 0.5 * b.stringQuality : b.stringQuality;
    extra.drawWeight = Math.round(pounds);
    extra.cast = r(clamp(0.5 * (spring * 0.75 + 0.25 * stringF + shape.cast - n(M.density) * 0.12) + 0.5 * (0.5 * even + 0.25 * b.draw + 0.25 * prep) - b.hinge * 0.25) * 100);
    extra.smoothness = r(clamp(0.3 * (0.5 + 0.5 * lengthF + shape.smooth) + 0.7 * (0.7 * even + 0.3 * limbMatch) - b.hinge * 0.3) * 100);
    extra.stability = r(clamp(0.3 * (0.6 + shape.stable + 0.2 * lengthF) + 0.7 * (0.55 * limbMatch + 0.25 * assembly + 0.2 * b.stringQuality)) * 100);
    balanceOut = clamp(0.25 + 0.75 * (0.6 * limbMatch + 0.4 * even)) * 100;
    durabilityOut = clamp(0.5 * clamp(n(M.toughness) * 0.8 + (b.backing ? 0.14 : 0) + 0.06 * lengthF) + 0.5 * (0.5 * even + 0.25 * b.glue + 0.25 * prep) - b.hinge * 0.35) * 100;
    functional = mean([extra.cast!, extra.smoothness!, extra.stability!, durabilityOut]);
  } else if (item.arrows) {
    const a = item.arrows;
    const straightAvg = mean(a.straight);
    const spineSpread = clamp(Math.max(...a.spine.map((v) => Math.abs(v))) / 0.6);
    const fletchSpread = clamp(mean(a.fletchErr.map((v) => Math.abs(v))) * 1.4);
    const straightSpread = clamp((Math.max(...a.straight) - Math.min(...a.straight)) / 0.5);
    const Sm = hasMat(item.materials.secondary) ? mat(item.materials.secondary).props : M;
    const Fm = hasMat(item.materials.grip) ? mat(item.materials.grip).props : M;
    const head = { bodkin: { pen: 0.2, flight: 0.04 }, broadhead: { pen: 0.06, flight: -0.08 }, leaf: { pen: 0, flight: 0.08 }, flint: { pen: -0.06, flight: -0.03 } }[a.point] ?? { pen: 0, flight: 0 };
    const vane = { parabolic: 0.04, shield: 0.02, traditional: -0.02 }[a.fletch] ?? 0;
    extra.straightness = r(straightAvg * 100);
    extra.consistency = r(clamp(1 - 0.4 * spineSpread - 0.3 * fletchSpread - 0.3 * straightSpread) * 100);
    extra.flight = r(clamp(0.3 * (0.55 + (1 - n(M.density)) * 0.25 + n(Fm.toughness) * 0.15 + head.flight + vane) + 0.7 * (0.45 * straightAvg + 0.3 * (1 - fletchSpread) + 0.25 * (1 - spineSpread))) * 100);
    extra.penetration = r(clamp(0.5 * (n(Sm.hardness) * 0.7 + 0.2 + head.pen) + 0.5 * (0.6 * a.pointQuality + 0.4 * straightAvg)) * 100);
    balanceOut = extra.consistency!;
    durabilityOut = clamp(0.5 * (n(M.toughness) * 0.6 + n(Sm.toughness) * 0.4) + 0.5 * (0.5 * a.pointQuality + 0.5 * assembly)) * 100;
    functional = mean([extra.flight!, extra.consistency!, extra.penetration!, extra.straightness!]);
  } else if (item.armor) {
    const a = item.armor;
    const even = mean(a.even), dent = mean(a.dents);
    const made = clamp(0.5 * even + 0.3 * (1 - a.gaps) + 0.2 * (1 - dent)); // how well the repeated work went
    // what each construction is good and bad at (cut / thrust / blow, freedom to move, comfort)
    const kind: Record<string, { cut: number; pierce: number; blunt: number; move: number; comfort: number; cover: number }> = {
      gambeson: { cut: 0.42, pierce: 0.3, blunt: 0.62, move: 0.9, comfort: 0.9, cover: 0.9 },
      cuirbouilli: { cut: 0.55, pierce: 0.42, blunt: 0.5, move: 0.78, comfort: 0.66, cover: 0.8 },
      mail: { cut: 0.9, pierce: 0.55, blunt: 0.3, move: 0.74, comfort: 0.56, cover: 0.95 },
      scale: { cut: 0.8, pierce: 0.68, blunt: 0.6, move: 0.6, comfort: 0.5, cover: 0.86 },
      brigandine: { cut: 0.84, pierce: 0.76, blunt: 0.7, move: 0.68, comfort: 0.62, cover: 0.88 },
      plate: { cut: 0.95, pierce: 0.9, blunt: 0.82, move: 0.5, comfort: 0.42, cover: 0.82 },
    };
    const kd = kind[a.method] ?? kind.gambeson;
    const cutF = a.cut === 'coat' ? { cover: 1, move: -0.1 } : a.cut === 'vest' ? { cover: 0.68, move: 0.1 } : { cover: 0.84, move: 0 };
    const matF = clamp(0.55 + 0.25 * n(M.toughness) + 0.2 * n(M.hardness));
    const p = (base: number, w: number) => clamp(0.55 * base * matF * 1.15 + 0.45 * (0.65 * made + 0.2 * structure + 0.15 * shaping) * (0.5 + 0.5 * base)) * 100 * w;
    extra.protCut = r(p(kd.cut, 1));
    extra.protPierce = r(p(kd.pierce, 1 - a.gaps * 0.25));
    extra.protBlunt = r(p(kd.blunt, 1));
    extra.protection = r(mean([extra.protCut, extra.protPierce, extra.protBlunt]));
    extra.mobility = r(clamp(0.55 * (kd.move + cutF.move) + 0.45 * (0.5 * assembly + 0.3 * even + 0.2 * (1 - dent)) - Math.max(0, itemWeight(item) - 9) * 0.02) * 100);
    extra.comfort = r(clamp(0.5 * kd.comfort + 0.5 * (0.4 * assembly + 0.3 * surface + 0.3 * even)) * 100);
    coverage = clamp(kd.cover * cutF.cover * (0.85 + 0.15 * made)) * 100;
    balanceOut = clamp(0.3 + 0.7 * (0.5 * even + 0.5 * assembly)) * 100;
    durabilityOut = clamp(0.5 * clamp(n(M.toughness) * 0.75 + n(M.hardness) * 0.25) + 0.5 * (0.6 * made + 0.4 * realiseStruct)) * 100;
    functional = mean([extra.protection, extra.mobility, coverage, durabilityOut]);
  }
  const overall = clamp((0.5 * C + 0.2 * functional / 100 + 0.15 * collectorAppeal / 100 + 0.15 * materialQuality / 100)) * 100;

  return {
    ...extra,
    craftsmanship: r(craft), materialQuality: r(materialQuality), durability: r(durabilityOut), integrity: r(integrity), balance: r(balanceOut),
    flexibility: r(flexibility), weight, ornamentation: r(ornamentation), complexity: r(complexity), surfaceQuality: r(surfaceQuality),
    cohesion: r(cohesion * 100), uniqueness: r(uniqueness), collectorAppeal: r(collectorAppeal), intentFulfillment: r(intentFulfillment),
    coverage: r(coverage), compactness: r(compactness), rarity: r(rarity.value), rarityLabel: rarity.label, value, grade: gradeFor(craft), overall: r(overall),
  };
}
const r = (v: number) => Math.round(v);

/** Which stats a category headlines in the UI. */
export const HEADLINE_STATS: Record<Category, (keyof ItemStats)[]> = {
  sword: ['balance', 'durability', 'craftsmanship', 'ornamentation', 'collectorAppeal'],
  dagger: ['compactness', 'craftsmanship', 'ornamentation', 'rarity', 'balance'],
  shield: ['coverage', 'integrity', 'weight', 'surfaceQuality', 'ornamentation'],
  bow: ['drawWeight', 'cast', 'smoothness', 'stability', 'craftsmanship'],
  arrows: ['consistency', 'flight', 'penetration', 'straightness', 'craftsmanship'],
  armor: ['protection', 'mobility', 'coverage', 'comfort', 'craftsmanship'],
};

export const STAT_LABELS: Record<string, string> = {
  craftsmanship: 'Craftsmanship', materialQuality: 'Material quality', durability: 'Durability', integrity: 'Structural integrity',
  balance: 'Balance', flexibility: 'Flexibility', weight: 'Weight', ornamentation: 'Ornamental quality', complexity: 'Decorative complexity',
  surfaceQuality: 'Surface quality', cohesion: 'Artistic cohesion', uniqueness: 'Visual uniqueness', collectorAppeal: 'Collector appeal',
  intentFulfillment: 'Intent fulfilled', coverage: 'Coverage', compactness: 'Compactness', rarity: 'Rarity', value: 'Value', overall: 'Overall',
  drawWeight: 'Draw weight (lb)', cast: 'Cast', smoothness: 'Smoothness of draw', stability: 'Stability',
  consistency: 'Consistency of the set', straightness: 'Straightness', flight: 'Flight', penetration: 'Penetration',
  protection: 'Protection', protCut: 'Against cuts', protPierce: 'Against thrusts', protBlunt: 'Against blows', mobility: 'Mobility', comfort: 'Comfort',
};
