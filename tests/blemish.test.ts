import { describe, expect, it } from 'vitest';
import { generateBlemishes } from '../src/crafting/apply';
import { simulateCraft } from '../src/crafting/simulate';
import { clearRenderCache, renderItem } from '../src/render/itemRenderer';
import { sanitizeShowcaseItem, toShowcasePayload } from '../src/showcase/sanitize';
import { UPGRADES } from '../src/data/workshop';

/** Total colour difference between a piece with one blemish and without it. */
function contrast(depth: number, kind: 'pit' | 'scratch' | 'scale'): number {
  const it = simulateCraft({ category: 'sword', primary: 'iron', skill: 0.9, seed: 12 });
  it.blemishes = [];
  clearRenderCache();
  const clean = renderItem(it);
  it.blemishes = [{ t: 0.4, u: 0.1, kind, depth }];
  const marked = renderItem(it);
  let d = 0;
  for (let k = 0; k < clean.data.length; k++) d += Math.abs(clean.data[k] - marked.data[k]);
  return d;
}

describe('blemishes and the inspection lamp', () => {
  it('new pieces roll a mix of obvious and faint blemishes', () => {
    let faint = 0, deep = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const it = simulateCraft({ category: 'sword', primary: 'iron', skill: 0.4, seed });
      const bl = generateBlemishes(it);
      expect(bl).toEqual(generateBlemishes(it)); // deterministic
      for (const b of bl) {
        expect(b.depth).toBeGreaterThan(0);
        expect(b.depth).toBeLessThanOrEqual(1);
        if (b.depth! < 0.5) faint++; else deep++;
      }
    }
    expect(faint).toBeGreaterThan(deep * 0.6);
    expect(deep).toBeGreaterThan(faint * 0.6);
  });

  it('faint blemishes barely mark the sprite; deep ones are plain to see', () => {
    for (const kind of ['pit', 'scratch', 'scale'] as const) {
      const faint = contrast(0.1, kind), deep = contrast(1, kind);
      expect(faint).toBeGreaterThan(0);
      expect(deep).toBeGreaterThan(faint * 2);
    }
  });

  it('depth survives the showcase and the lantern upgrade exists', () => {
    const it = simulateCraft({ category: 'sword', primary: 'iron', skill: 0.5, seed: 3 });
    it.blemishes = [{ t: 0.3, u: 0, kind: 'pit', depth: 0.2 }, { t: 0.5, u: 0.2, kind: 'scale' }];
    const r = sanitizeShowcaseItem(toShowcasePayload(it));
    expect(r.ok && r.item.blemishes).toEqual(it.blemishes);
    expect(UPGRADES.some((u) => u.id === 'lantern')).toBe(true);
  });
});
