// Pieces made before the hi-res renderer (item.version 1) must keep their
// exact pixels forever. These hashes were recorded from the original renderer
// before any change to it; if one ever differs, legacy pieces have changed.

import { describe, expect, it } from 'vitest';
import { patternIndexFor } from '../src/item/damascus';
import { createDraft } from '../src/item/factory';
import { refreshDerived } from '../src/item/finalize';
import type { Item } from '../src/item/types';
import { clearRenderCache, renderItem } from '../src/render/itemRenderer';
import { SAMPLES } from './render.test';
import { deserialize, serialize } from '../src/game/save';
import { newGame } from '../src/game/state';
import { ITEM_VERSION, isLegacy } from '../src/item/types';
import { sanitizeShowcaseItem, toShowcasePayload } from '../src/showcase/sanitize';

function damascus(primary: string, secondary: string, seed: number, visibility: number, color?: string): Item {
  const it = createDraft('dagger', 'foundry', 'Tester', 1, 'Spring', seed);
  it.materials.primary = primary;
  it.materials.secondary = secondary;
  it.design.method = 'damascus';
  it.blade!.length = 52;
  it.blade!.width = 5;
  it.surface.damascus = { index: patternIndexFor(seed), visibility, forge: 1, layers: 64, ...(color ? { color } : {}) };
  it.blemishes = [{ t: 0.3, u: 0.2, kind: 'pit' }, { t: 0.6, u: -0.3, kind: 'scratch' }, { t: 0.45, u: 0.1, kind: 'scale' }];
  return refreshDerived(it);
}

export const LEGACY_SAMPLES = (): Item[] =>
  [...SAMPLES(), damascus('iron', 'silver', 11, 0.92), damascus('azuresteel', 'brass', 9, 0.3), damascus('iron', 'silver', 23, 0.9, 'frostvein'), damascus('dragonsteel', 'starmetal', 31, 0.95, 'aurora')]
    .map((i) => { i.version = 1; return i; });

export const GOLDEN: string[] = [
  'cfe31baf 764ea648 a6c4bd0d',
  '3a57d9d0 c8528ef0 7e2634f2',
  '59c9f296 4b0bfbfa e54533ae',
  '887baf2e 20513e36 e33d34a',
  '9e34caa7 3d06b243 71d66527',
  'b8bbe6c3 e6efb79b 9d882b16',
  'b5d1bd38 c869177f ead55bff',
  '73c7c546 9942c896 78ab24ca',
  '7263246d d920ced3 dc0c1b90',
  '4db0693e d1704274 6c9b4cf1',
  'f1303b85 272196ed f932a99a',
  'a89b88b0 59745020 c6f5c09a',
  'cb0486b0 afa9032c 32d3ab26',
  '8a2cb7c1 1118f119 89caa420',
];

describe('legacy (version 1) pieces', () => {
  it('render exactly as they always have', () => {
    clearRenderCache();
    const got = LEGACY_SAMPLES().map((i) => (['front', 'back', 'profile'] as const).map((v) => renderItem(i, v).hash()).join(' '));
    if (process.env.PRINT_GOLDEN) console.log('GOLDEN=' + JSON.stringify(got));
    expect(got).toEqual(GOLDEN);
  });

  it('stay legacy through the showcase: a version-1 (or unmarked) post keeps its version and pixels', () => {
    // (the hand-built Damascus samples have made-up visibility, which the showcase rightly rejects)
    LEGACY_SAMPLES().slice(0, 10).forEach((it, n) => {
      const payload = toShowcasePayload(it) as any;
      const marked = sanitizeShowcaseItem(JSON.parse(JSON.stringify(payload)));
      delete payload.version; // posts stored before versions were kept
      const unmarked = sanitizeShowcaseItem(payload);
      for (const r of [marked, unmarked]) {
        expect(r.ok).toBe(true);
        if (!r.ok) continue;
        expect(r.item.version).toBe(1);
        expect(isLegacy(r.item)).toBe(true);
        expect(renderItem(r.item, 'front').hash()).toBe(GOLDEN[n].split(' ')[0]);
      }
    });
    const forged = toShowcasePayload(LEGACY_SAMPLES()[0]) as any;
    forged.version = 99;
    const r = sanitizeShowcaseItem(forged);
    expect(r.ok && r.item.version).toBe(ITEM_VERSION);
  });

  it('stay legacy in saves; new pieces and unfinished drafts are current', () => {
    const s = newGame('Ash', 'Forge');
    const old = LEGACY_SAMPLES()[0];
    const unmarked = LEGACY_SAMPLES()[1];
    delete (unmarked as any).version;
    const fresh = createDraft('sword', 'foundry', 'Ash', 1, 'Spring', 5);
    const draft = LEGACY_SAMPLES()[2];
    s.items = [old, unmarked, fresh];
    s.draft = { item: draft, stages: ['design'], index: 0, materialsPaid: false };
    const back = deserialize(serialize(s));
    expect(back.items.map((i) => i.version)).toEqual([1, 1, ITEM_VERSION]);
    expect(back.draft!.item.version).toBe(ITEM_VERSION);
    expect(fresh.version).toBe(ITEM_VERSION);
    expect(isLegacy(fresh)).toBe(false);
    expect(renderItem(back.items[0], 'front').hash()).toBe(GOLDEN[0].split(' ')[0]);
  });
});
