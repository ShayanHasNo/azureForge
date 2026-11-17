import { describe, expect, it } from 'vitest';
import { ALL_MATERIALS, BOW_WOODS, CLOTHS, FEATHERS, FIBERS, HIDES, HORNS, METALS, SHAFT_WOODS, hasMat, mat } from '../src/data/materials';
import { ALL_OPTION_LISTS } from '../src/data/options';
import { TRADITIONS } from '../src/data/traditions';
import { newGame } from '../src/game/state';
import { simulateCraft } from '../src/crafting/simulate';
import { EMBLEM_BITMAPS, engravingPaths } from '../src/item/patterns';
import { renderItem } from '../src/render/itemRenderer';
import { LOCATIONS, MERCHANTS } from '../src/village/world';
import { NPCS } from '../src/village/npcs';

const OPTION_LIST_FOR: Record<string, string> = { profile: 'profile', tip: 'tip', guard: 'guard', pommel: 'pommel', wrap: 'wrap', texture: 'texture', finish: 'finish', engraving: 'engraving', emblem: 'emblem', shieldShape: 'shieldShape', boss: 'boss' };

describe('material library', () => {
  it('has unique ids, six-step palettes and sensible numbers', () => {
    const ids = new Set<string>();
    for (const m of ALL_MATERIALS) {
      expect(ids.has(m.id), `duplicate ${m.id}`).toBe(false);
      ids.add(m.id);
      expect(m.palette.length, m.id).toBe(6);
      for (const hex of m.palette) expect(hex, m.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(m.value).toBeGreaterThan(0);
      expect(m.source.length, `${m.id} has no source`).toBeGreaterThan(5);
      for (const v of Object.values(m.props)) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(100); }
    }
    expect(METALS.length).toBeGreaterThanOrEqual(14);
    for (const list of [BOW_WOODS, SHAFT_WOODS, HORNS, FIBERS, FEATHERS, CLOTHS, HIDES]) expect(list.length).toBeGreaterThanOrEqual(2);
    for (const [list, kind] of [[HORNS, 'horn'], [FIBERS, 'fiber'], [FEATHERS, 'feather'], [CLOTHS, 'cloth'], [HIDES, 'leather'], [BOW_WOODS, 'wood']] as const) for (const m of list) expect(m.kind).toBe(kind);
  });

  it('every metal can be worked, and every mastery unlock is a real option gated by that metal', () => {
    for (const m of METALS) {
      expect(m.prep, `${m.id} prep`).toBeTruthy();
      expect(m.rhythm, `${m.id} rhythm`).toBeTruthy();
      expect(TRADITIONS.some((t) => t.primaries.includes(m.id)), `${m.id} is in no tradition`).toBe(true);
      for (const u of m.mastery ?? []) {
        const opt = ALL_OPTION_LISTS[OPTION_LIST_FOR[u.kind]]?.find((o) => o.id === u.id);
        expect(opt, `${m.id} unlock ${u.kind}:${u.id}`).toBeTruthy();
        expect(opt!.gate?.mastery, `${u.id} gate`).toEqual({ material: m.id, level: u.level });
      }
      for (const p of [...(m.pairsWith ?? []), ...(m.clashesWith ?? [])]) expect(hasMat(p), `${m.id} pairs with unknown ${p}`).toBe(true);
    }
  });

  it('every emblem and engraving option can be drawn', () => {
    for (const o of ALL_OPTION_LISTS.emblem) if (o.id !== 'none') expect(EMBLEM_BITMAPS[o.id]?.length, o.id).toBe(7);
    for (const o of ALL_OPTION_LISTS.engraving) if (o.id !== 'none') expect(engravingPaths(o.id, 7).length, o.id).toBeGreaterThan(0);
  });

  it('the new metals and their unlocks render distinctly', () => {
    const base = (f: (i: ReturnType<typeof simulateCraft>) => void) => renderItem(simulateCraft({ primary: 'steel', skill: 0.9, seed: 31, setup: f })).hash();
    const plain = base(() => {});
    const variants = [
      base((i) => (i.surface.texture = 'watered')), base((i) => (i.surface.texture = 'widmanstatten')), base((i) => (i.surface.texture = 'rayed')),
      base((i) => (i.finish.finish = 'satin')), base((i) => (i.finish.finish = 'sunlit')), base((i) => (i.finish.finish = 'peacock')), base((i) => (i.finish.finish = 'skyiron')),
      base((i) => (i.hilt!.pommel = 'scentstopper')), base((i) => (i.decoration.engraving.pattern = 'arabesque')),
      base((i) => { i.blade!.width = 6; i.decoration.emblem = 'anvil'; }), base((i) => { i.blade!.width = 6; i.decoration.emblem = 'sunburst'; }), base((i) => { i.blade!.width = 6; i.decoration.emblem = 'meteor'; }),
    ];
    expect(new Set([plain, ...variants]).size).toBe(variants.length + 1);
    for (const id of ['steel', 'sunbronze', 'crucible', 'meteoric']) expect(simulateCraft({ primary: id, skill: 0.8, seed: 5 }).stats!.craftsmanship).toBeGreaterThan(50);
  });

  it('every material can actually be obtained, and stalls only sell real materials', () => {
    const got = new Set<string>(Object.keys(newGame('A', 'B').materials));
    const s = newGame('A', 'B');
    s.reputation = 99;
    for (const n of NPCS) s.relationships[n.id] = 99;
    for (const mer of MERCHANTS) {
      expect(NPCS.some((n) => n.id === mer.npc), `${mer.id} npc`).toBe(true);
      for (let day = 1; day <= 60; day++) {
        s.day = day;
        for (const line of mer.stock(s)) { expect(hasMat(line.id), `${mer.id} sells unknown ${line.id}`).toBe(true); expect(line.price).toBeGreaterThan(0); got.add(line.id); }
      }
    }
    for (const loc of LOCATIONS)
      for (let day = 1; day <= 60; day++)
        for (let visit = 0; visit < 8; visit++) {
          s.day = day; s.phase = day % 4; s.locationVisits[loc.id] = visit;
          for (const id of Object.keys(loc.visit(s).materials)) { expect(hasMat(id), `${loc.id} yields unknown ${id}`).toBe(true); got.add(id); }
        }
    const missing = ALL_MATERIALS.map((m) => m.id).filter((id) => !got.has(id));
    expect(missing).toEqual([]);
    expect(mat('steel').name).toBe('Steel');
  });
});
