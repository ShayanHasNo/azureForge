import { describe, expect, it } from 'vitest';
import { createDraft, cloneItem } from '../src/item/factory';
import { refreshDerived } from '../src/item/finalize';
import { renderItem, clearRenderCache } from '../src/render/itemRenderer';
import { sheet, writePng } from './helpers/png';
import type { Item } from '../src/item/types';

function sample(over: (i: Item) => void, cat: 'sword' | 'dagger' | 'shield' = 'sword', seed = 1234): Item {
  const it = createDraft(cat, 'foundry', 'Tester', 1, 'Spring', seed);
  over(it);
  return refreshDerived(it);
}

export const SAMPLES = (): Item[] => [
  sample((i) => { i.materials.primary = 'brass'; i.materials.secondary = 'copper'; i.decoration.engraving.pattern = 'vine'; i.decoration.engraving.inlay = true; i.surface.texture = 'brushed'; i.finish.finish = 'glossy'; }),
  sample((i) => { i.materials.primary = 'dragonsteel'; i.materials.secondary = 'iron'; i.blade!.profile = 'falchion'; i.blade!.width = 6; i.blade!.tip = 'clipped'; i.hilt!.guard = 'talon'; i.hilt!.pommel = 'wheel'; i.surface.texture = 'emberscale'; i.finish.finish = 'smoulder'; i.hilt!.gripMaterial = 'blackleather'; }, 'sword', 99),
  sample((i) => { i.materials.primary = 'starmetal'; i.materials.secondary = 'silver'; i.blade!.profile = 'tapered'; i.blade!.tip = 'spear'; i.hilt!.guard = 'crescent'; i.hilt!.pommel = 'crescent'; i.surface.texture = 'nebula'; i.finish.finish = 'glow'; i.decoration.engraving.pattern = 'stars'; i.decoration.constellation = { points: [[0.1, -0.3], [0.2, 0.3], [0.32, -0.1], [0.45, 0.4]], brightness: 0.9 }; }, 'sword', 7),
  sample((i) => { i.materials.primary = 'gardenglass'; i.materials.secondary = 'silver'; i.blade!.profile = 'leaf'; i.hilt!.guard = 'winged'; i.hilt!.pommel = 'teardrop'; i.hilt!.gripMaterial = 'willowglass'; i.hilt!.wrap = 'none'; i.surface.texture = 'rippled'; i.finish.finish = 'prism'; }, 'sword', 31),
  sample((i) => { i.materials.primary = 'iron'; i.materials.secondary = 'bronze'; i.blade!.profile = 'curved'; i.blade!.width = 4; i.hilt!.guard = 'disc'; i.surface.texture = 'weathered'; i.finish.finish = 'aged'; i.blade!.asymmetry = 0.5; i.decoration.stones = [{ t: 0.15, u: 0, stone: 'riverstone', rot: 0.2 }, { t: 0.3, u: 0.1, stone: 'slate', rot: -0.4 }]; }, 'sword', 55),
  sample((i) => { i.materials.primary = 'azuresteel'; i.materials.secondary = 'silver'; i.blade!.profile = 'wavy'; i.blade!.fuller = 'ridge'; i.surface.texture = 'layered'; i.surface.layers = 14; i.surface.patternClarity = 0.8; i.finish.finish = 'contrast'; i.hilt!.wrap = 'crosshatch'; i.decoration.gems = [{ slot: 'pommel', gem: 'sapphire' }, { slot: 'guard', gem: 'garnet' }]; i.decoration.emblem = 'star'; }, 'sword', 77),
  sample((i) => { i.materials.primary = 'moonstone'; i.materials.secondary = 'silver'; i.blade!.length = 50; i.decoration.engraving.pattern = 'runes'; i.finish.finish = 'moonlit'; i.hilt!.pommel = 'ring'; }, 'dagger', 5),
  sample((i) => { i.materials.primary = 'copper'; i.materials.secondary = 'brass'; i.blade!.profile = 'leaf'; i.finish.finish = 'verdigris'; i.surface.texture = 'hammered'; i.hilt!.gripMaterial = 'antler'; i.hilt!.wrap = 'bands'; }, 'dagger', 8),
  sample((i) => { i.materials.primary = 'iron'; i.materials.secondary = 'brass'; i.decoration.emblem = 'mountain'; i.shield!.boss = 'none'; i.shield!.shape = 'heater'; i.shield!.width = 66; i.shield!.height = 84; }, 'shield', 3),
  sample((i) => { i.materials.primary = 'silver'; i.materials.secondary = 'brass'; i.shield!.faceMaterial = 'silver'; i.shield!.shape = 'round'; i.shield!.width = 76; i.decoration.engraving.pattern = 'knotwork'; i.decoration.gems = [{ slot: 'boss', gem: 'garnet' }]; i.surface.texture = 'reflective'; }, 'shield', 4),
];

describe('procedural renderer', () => {
  it('renders every sample with visible pixels', () => {
    for (const it of SAMPLES()) {
      const img = renderItem(it);
      let n = 0;
      for (let k = 3; k < img.data.length; k += 4) if (img.data[k] > 0) n++;
      expect(n).toBeGreaterThan(200);
    }
  });
  it('is deterministic: same data → identical pixels', () => {
    for (const it of SAMPLES()) {
      const a = renderItem(it).hash();
      clearRenderCache();
      const b = renderItem(cloneItem(JSON.parse(JSON.stringify(it)))).hash();
      expect(b).toBe(a);
    }
  });
  it('different parameters → different sprites', () => {
    const hashes = SAMPLES().map((i) => renderItem(i).hash());
    expect(new Set(hashes).size).toBe(hashes.length);
  });
  it('writes a sample sheet when SHEET is set', () => {
    if (!process.env.SHEET) return;
    const imgs = SAMPLES().flatMap((i) => [renderItem(i, 'front')]);
    writePng(process.env.SHEET, sheet(imgs), 3);
    const views = SAMPLES().slice(0, 3).flatMap((i) => [renderItem(i, 'front'), renderItem(i, 'back'), renderItem(i, 'profile')]);
    writePng(process.env.SHEET.replace('.png', '-views.png'), sheet(views), 3);
  });
});
