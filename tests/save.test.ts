import { describe, expect, it } from 'vitest';
import { simulateCraft } from '../src/crafting/simulate';
import { deserialize, serialize } from '../src/game/save';
import { newGame } from '../src/game/state';
import { clearRenderCache, renderItem } from '../src/render/itemRenderer';
import { computeStats } from '../src/item/stats';
import { recordCompletedItem, optionAvailable } from '../src/game/progress';
import { TEXTURES } from '../src/data/options';

describe('save & reproduction', () => {
  it('items survive a save/load round trip and reproduce exactly', () => {
    const s = newGame('Tester');
    for (const [p, t] of [['brass', 'foundry'], ['starmetal', 'celestial'], ['iron', 'mountain'], ['gardenglass', 'glassgarden'], ['iron', 'experimental']] as const)
      recordCompletedItem(s, simulateCraft({ primary: p, tradition: t, skill: 0.7, secondary: 'silver', setup: (i) => { i.decoration.engraving.pattern = 'vine'; i.decoration.inscription = 'Hold fast'; } }));
    const hashes = s.items.map((i) => [renderItem(i, 'front').hash(), renderItem(i, 'back').hash(), renderItem(i, 'profile').hash()].join());
    const loaded = deserialize(serialize(s));
    clearRenderCache();
    expect(loaded.items.length).toBe(5);
    loaded.items.forEach((i, k) => {
      expect([renderItem(i, 'front').hash(), renderItem(i, 'back').hash(), renderItem(i, 'profile').hash()].join()).toBe(hashes[k]);
      expect(computeStats(i)).toEqual(s.items[k].stats);
      expect(i.history.length).toBeGreaterThan(0);
    });
  });
  it('progression grants mastery and unlocks creative options (not stats)', () => {
    const s = newGame();
    const forge = TEXTURES.find((t) => t.id === 'forgescale')!;
    expect(optionAvailable(forge, s, 'foundry', 'sword').ok).toBe(false);
    const r = recordCompletedItem(s, simulateCraft({ primary: 'iron', skill: 0.8 }));
    expect(r.masteryUps.some((m) => m.material === 'iron')).toBe(true);
    expect(optionAvailable(forge, s, 'foundry', 'sword').ok).toBe(true);
  });
  it('migrates partial/old saves without losing items', () => {
    const s = newGame();
    s.items.push(simulateCraft({ primary: 'copper', skill: 0.5 }));
    const raw = JSON.parse(serialize(s));
    delete raw.state.settings; delete raw.state.challenges; delete raw.state.gallery;
    const l = deserialize(JSON.stringify(raw));
    expect(l.items.length).toBe(1);
    expect(l.settings.music).toBeGreaterThan(0);
    expect(Array.isArray(l.gallery)).toBe(true);
  });
});
