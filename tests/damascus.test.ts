import { describe, expect, it } from 'vitest';
import { tradition, TRADITIONS } from '../src/data/traditions';
import { simulateCraft } from '../src/crafting/simulate';
import { stagesForMethod } from '../src/crafting/method';
import {
  damascusConsistent, describeDamascus, NAMED_PATTERNS, PATTERN_COUNT, patternHash, patternIndexFor, patternSpec, RARE_COLORS, rareColorForPair,
  rollDamascus, rollRareColor, visibilityBand, visibilityFor, VISIBILITY_CAP,
} from '../src/item/damascus';
import { createDraft } from '../src/item/factory';
import { refreshDerived } from '../src/item/finalize';
import type { Item } from '../src/item/types';
import { clearRenderCache, renderItem } from '../src/render/itemRenderer';
import { sheet, writePng } from './helpers/png';

function dagger(primary: string, secondary: string, seed: number, d?: Partial<NonNullable<Item['surface']['damascus']>>): Item {
  const it = createDraft('dagger', 'foundry', 'Tester', 1, 'Spring', seed);
  it.materials.primary = primary;
  it.materials.secondary = secondary;
  it.design.method = 'damascus';
  it.blade!.length = 52;
  it.blade!.width = 5;
  if (d) it.surface.damascus = { index: patternIndexFor(seed), visibility: 0.9, forge: 1, layers: 64, ...d };
  return refreshDerived(it);
}

describe('damascus patterns', () => {
  it('pattern index is 1..1000 and deterministic per seed', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 5000; s++) {
      const i = patternIndexFor(s);
      expect(i).toBeGreaterThanOrEqual(1);
      expect(i).toBeLessThanOrEqual(PATTERN_COUNT);
      expect(patternIndexFor(s)).toBe(i);
      seen.add(i);
    }
    expect(seen.size).toBeGreaterThan(950);
  });

  it('every index is its own pattern', () => {
    const hashes = new Set<number>();
    for (let i = 1; i <= PATTERN_COUNT; i++) hashes.add(patternHash(i));
    expect(hashes.size).toBeGreaterThanOrEqual(990);
    for (const k of Object.keys(NAMED_PATTERNS)) expect(patternSpec(Number(k)).name).toBeTruthy();
  });

  it('even a perfect forge never reaches 100% visibility', () => {
    const v: number[] = [];
    for (let s = 0; s < 10000; s++) v.push(visibilityFor(s, 1));
    v.sort((a, b) => a - b);
    expect(v[v.length - 1]).toBeLessThanOrEqual(VISIBILITY_CAP);
    expect(v[v.length - 1]).toBeLessThan(0.99);
    expect(v[0]).toBeGreaterThan(0.75);
    const top = v.filter((x) => x >= 0.95).length / v.length;
    expect(top).toBeGreaterThan(0.03);
    expect(top).toBeLessThan(0.2);
  });

  it('visibility follows forge quality', () => {
    const med = (f: number) => {
      const v = Array.from({ length: 2000 }, (_, s) => visibilityFor(s, f)).sort((a, b) => a - b);
      return v[1000];
    };
    expect(med(1)).toBeGreaterThan(0.8);
    expect(med(0.5)).toBeLessThan(0.45);
    expect(med(0.2)).toBeLessThan(med(0.5));
    expect(visibilityBand(0.9)).toBe('Pristine');
    expect(visibilityBand(0.05)).toBe('Ghost');
  });

  it('rare colours only come from their metal pairs and are very rare', () => {
    expect(rollRareColor(1, 'iron', 'iron', 1)).toBeUndefined();
    expect(rareColorForPair('brass', 'bronze')).toBeUndefined();
    for (const c of RARE_COLORS) {
      expect(rareColorForPair(c.pair[1], c.pair[0])?.id).toBe(c.id);
      let n = 0;
      const N = 40000;
      for (let s = 0; s < N; s++) if (rollRareColor(s, c.pair[0], c.pair[1], 1) === c.id) n++;
      expect(n / N).toBeGreaterThan(c.chance * 0.6);
      expect(n / N).toBeLessThan(c.chance * 1.4);
      expect(n / N).toBeLessThan(0.03);
    }
    // poor forging lowers the odds
    let poor = 0, good = 0;
    for (let s = 0; s < 40000; s++) {
      if (rollRareColor(s, 'iron', 'silver', 0)) poor++;
      if (rollRareColor(s, 'iron', 'silver', 1)) good++;
    }
    expect(poor).toBeLessThan(good);
  });

  it('a rolled record is consistent and detects forgery', () => {
    const d = rollDamascus(4242, 'iron', 'silver', 0.9, 64);
    expect(damascusConsistent(4242, 'iron', 'silver', d)).toBe(true);
    expect(damascusConsistent(4242, 'iron', 'silver', { ...d, index: (d.index % 1000) + 1 })).toBe(false);
    expect(damascusConsistent(4242, 'iron', 'silver', { ...d, visibility: 0.98 })).toBe(false);
    expect(damascusConsistent(4242, 'iron', 'silver', { ...d, color: d.color ? undefined : 'frostvein' })).toBe(false);
    expect(describeDamascus(d)).toMatch(/^Pattern #\d+ · /);
  });
});

describe('damascus method pipeline', () => {
  it('stagesForMethod is idempotent and reversible', () => {
    for (const t of TRADITIONS) {
      const base = t.stages;
      const d1 = stagesForMethod(base, 'damascus', base);
      expect(d1.filter((s) => s === 'damascus').length).toBe(1);
      expect(d1).not.toContain('fold');
      expect(stagesForMethod(d1, 'damascus', base)).toEqual(d1);
      expect(stagesForMethod(d1, 'standard', base)).toEqual(base);
      expect(stagesForMethod(base, 'standard', base)).toEqual(base);
    }
    const pw = stagesForMethod(tradition('patternwrights').stages, 'damascus', tradition('patternwrights').stages);
    expect(pw.indexOf('damascus')).toBe(tradition('patternwrights').stages.indexOf('fold'));
    const fd = stagesForMethod(tradition('foundry').stages, 'damascus', tradition('foundry').stages);
    expect(fd[fd.indexOf('heat') + 1]).toBe('damascus');
  });

  it('simulated Damascus daggers carry pattern data and are cosmetic only', () => {
    const mk = (method?: 'damascus', skill = 0.95) => simulateCraft({ category: 'dagger', primary: 'iron', secondary: 'silver', skill, seed: 321, setup: (i) => { if (method) i.design.method = method; } });
    const plain = mk();
    const dam = mk('damascus');
    expect(plain.surface.damascus).toBeUndefined();
    const d = dam.surface.damascus!;
    expect(d.index).toBe(patternIndexFor(dam.seed));
    expect(d.visibility).toBeGreaterThan(0.6);
    expect(d.visibility).toBeLessThan(0.99);
    expect(damascusConsistent(dam.seed, 'iron', 'silver', d)).toBe(true);
    expect(dam.history.some((h) => h.stage === 'damascus')).toBe(true);
    // same item without its pattern: identical value and rarity
    const stripped = JSON.parse(JSON.stringify(dam)) as Item;
    delete stripped.surface.damascus;
    refreshDerived(stripped, true);
    expect(stripped.stats!.value).toBe(dam.stats!.value);
    expect(stripped.stats!.rarity).toBe(dam.stats!.rarity);
    expect(mk('damascus', 0.3).surface.damascus!.visibility).toBeLessThan(d.visibility);
  });
});

describe('damascus rendering', () => {
  it('renders deterministically and visibility changes the sprite', () => {
    const a = dagger('iron', 'silver', 11, { visibility: 0.1 });
    const b = dagger('iron', 'silver', 11, { visibility: 0.95 });
    const plain = dagger('iron', 'silver', 11);
    const ha = renderItem(a).hash();
    clearRenderCache();
    expect(renderItem(JSON.parse(JSON.stringify(a))).hash()).toBe(ha);
    expect(renderItem(b).hash()).not.toBe(ha);
    expect(renderItem(plain).hash()).not.toBe(renderItem(b).hash());
    const rare = dagger('iron', 'silver', 11, { visibility: 0.95, color: 'frostvein' });
    expect(renderItem(rare).hash()).not.toBe(renderItem(b).hash());
  });

  it('writes a contact sheet when DAMASCUS_SHEET is set', () => {
    if (!process.env.DAMASCUS_SHEET) return;
    const imgs = [
      ...[1, 7, 77, 128, 333, 500, 777, 1000].map((idx, k) => renderItem(dagger('iron', 'silver', 100 + k, { index: idx, visibility: 0.92 }))),
      ...[0.05, 0.2, 0.4, 0.6, 0.8, 0.95].map((v) => renderItem(dagger('azuresteel', 'brass', 9, { index: 437, visibility: v }))),
      ...RARE_COLORS.map((c, k) => renderItem(dagger(c.pair[0], c.pair[1], 200 + k, { index: 200 + k * 97, visibility: 0.9, color: c.id }))),
    ];
    writePng(process.env.DAMASCUS_SHEET, sheet(imgs), 4);
  });
});
