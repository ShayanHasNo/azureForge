import { describe, expect, it } from 'vitest';
import { simulateCraft } from '../src/crafting/simulate';
import { METALS } from '../src/data/materials';
import { renderItem } from '../src/render/itemRenderer';
import type { ItemStats } from '../src/item/types';

const EXPERT = 0.95, AVERAGE = 0.62, POOR = 0.35;
const avg = (primary: string, skill: number, n = 6, extra: Partial<Parameters<typeof simulateCraft>[0]> = {}) => {
  const items = Array.from({ length: n }, (_, k) => simulateCraft({ primary, skill, seed: 500 + k * 17, ...extra }));
  const keys = Object.keys(items[0].stats!) as (keyof ItemStats)[];
  const out: Record<string, number> = {};
  for (const k of keys) if (typeof items[0].stats![k] === 'number') out[k] = items.reduce((a, i) => a + (i.stats![k] as number), 0) / n;
  return out;
};

describe('craftsmanship-first balance', () => {
  it('expert brass outperforms average dragonsteel overall', () => {
    const brass = avg('brass', EXPERT), dragon = avg('dragonsteel', AVERAGE);
    console.table({ brass_expert: brass, dragonsteel_average: dragon });
    expect(brass.craftsmanship).toBeGreaterThan(dragon.craftsmanship + 20);
    expect(brass.overall).toBeGreaterThan(dragon.overall);
    expect(brass.value).toBeGreaterThan(dragon.value);
    expect(brass.collectorAppeal).toBeGreaterThan(dragon.collectorAppeal);
    expect(brass.balance).toBeGreaterThan(dragon.balance);
    // Material still matters: dragonsteel keeps its durability character, but the gap is bounded.
    expect(Math.abs(dragon.durability - brass.durability)).toBeLessThan(15);
  });
  it('average iron beats poorly crafted silver', () => {
    const iron = avg('iron', AVERAGE), silver = avg('silver', POOR);
    expect(iron.overall).toBeGreaterThan(silver.overall);
    expect(iron.durability).toBeGreaterThan(silver.durability);
    expect(iron.craftsmanship).toBeGreaterThan(silver.craftsmanship);
  });
  it('mastercrafted common metals beat poorly made rare metals in value and quality', () => {
    for (const common of ['iron', 'brass', 'copper', 'bronze'])
      for (const rare of ['dragonsteel', 'starmetal', 'moonstone']) {
        const a = avg(common, EXPERT, 4), b = avg(rare, POOR, 4);
        expect(a.overall, `${common} vs ${rare}`).toBeGreaterThan(b.overall);
        expect(a.value, `${common} vs ${rare} value`).toBeGreaterThan(b.value);
      }
  });
  it('at equal craftsmanship no material dominates every statistic', () => {
    const stats = ['durability', 'flexibility', 'balance', 'ornamentation', 'surfaceQuality', 'materialQuality'];
    const res = Object.fromEntries(METALS.filter((m) => m.kind === 'metal').map((m) => [m.id, avg(m.id, 0.8, 3)]));
    console.table(Object.fromEntries(Object.entries(res).map(([k, v]) => [k, Object.fromEntries([...stats, 'weight', 'value', 'overall'].map((s) => [s, Math.round(v[s] * 10) / 10]))])));
    for (const [id, s] of Object.entries(res)) {
      const beatenSomewhere = Object.entries(res).some(([o, t]) => o !== id && stats.some((k) => t[k] > s[k] + 0.5));
      expect(beatenSomewhere, `${id} dominates`).toBe(true);
    }
    // Light metals are genuinely lighter; heavy metals heavier — a real trade-off.
    expect(res.moonstone.weight).toBeLessThan(res.dragonsteel.weight);
    // Value spread across materials at equal skill stays modest (no exponential rarity scaling).
    const values = Object.values(res).map((v) => v.value);
    expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.9);
  });
  it('different structural approaches with identical materials produce different trade-offs', () => {
    const r = avg('iron', 0.8, 3, { setup: (i) => (i.structure.approach = 'reinforced') });
    const l = avg('iron', 0.8, 3, { setup: (i) => (i.structure.approach = 'lightweight') });
    expect(r.durability).toBeGreaterThan(l.durability);
    expect(l.weight).toBeLessThan(r.weight);
    expect(l.flexibility).toBeGreaterThan(r.flexibility);
  });
});

describe('skill influence', () => {
  it('identical design + materials, different execution → different item', () => {
    const a = simulateCraft({ primary: 'iron', skill: 0.95, seed: 42, setup: (i) => (i.decoration.engraving.pattern = 'vine') });
    const b = simulateCraft({ primary: 'iron', skill: 0.4, seed: 42, setup: (i) => (i.decoration.engraving.pattern = 'vine') });
    expect(a.stats!.craftsmanship).toBeGreaterThan(b.stats!.craftsmanship + 30);
    expect(renderItem(a).hash()).not.toBe(renderItem(b).hash());
    expect(b.blemishes.length).toBeGreaterThan(a.blemishes.length);
  });
  it('poor performance is meaningful but not crushing', () => {
    const p = simulateCraft({ primary: 'brass', skill: 0.3, seed: 9 });
    expect(p.stats!.value).toBeGreaterThan(10);
    expect(p.stats!.durability).toBeGreaterThan(25);
  });
  it('every tradition pipeline produces a valid item', () => {
    for (const t of ['foundry', 'patternwrights', 'celestial', 'mountain', 'glassgarden', 'experimental']) {
      const prim = t === 'glassgarden' ? 'gardenglass' : t === 'celestial' ? 'starmetal' : 'iron';
      const it = simulateCraft({ primary: prim, secondary: 'silver', skill: 0.7, tradition: t });
      expect(it.stats!.craftsmanship).toBeGreaterThan(40);
      expect(renderItem(it).hash()).toBeTruthy();
    }
  });
});
