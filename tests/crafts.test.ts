import { describe, expect, it } from 'vitest';
import { CRAFT_STAGES, materialPlan } from '../src/crafting/craftStages';
import { ARMOR_STAGES, BOW_STAGES, craftStages, stagesFor } from '../src/crafting/method';
import { simulateCraft } from '../src/crafting/simulate';
import { STAGES } from '../src/crafting/stages';
import { APPLY, STAGE_MINIGAME } from '../src/crafting/apply';
import { hasMat } from '../src/data/materials';
import { ALL_OPTION_LISTS, ARROW_POINTS, BOW_METHODS, BOW_PROFILES, FLETCH_STYLES } from '../src/data/options';
import { STAGE_INFO, tradition, TRADITIONS, type CraftStageId } from '../src/data/traditions';
import { UPGRADES } from '../src/data/workshop';
import { CATEGORY_INFO, CRAFTABLE, createDraft } from '../src/item/factory';
import { HEADLINE_STATS, STAT_LABELS } from '../src/item/stats';
import type { Category, Item } from '../src/item/types';
import { MINIGAMES } from '../src/minigames';
import { clearRenderCache, renderItem, RENDER_SCALE } from '../src/render/itemRenderer';
import { sanitizeShowcaseItem, toShowcasePayload } from '../src/showcase/sanitize';
import { sheet, writePng } from './helpers/png';

const bow = (method: string, skill = 0.85, seed = 3, extra: (i: Item) => void = () => {}) =>
  simulateCraft({ category: 'bow', primary: 'yew', skill, seed, setup: (i) => { i.design.method = method; extra(i); } });
const arrows = (point: string, skill = 0.85, seed = 4, extra: (i: Item) => void = () => {}) =>
  simulateCraft({ category: 'arrows', primary: 'cedar', secondary: point === 'flint' ? 'flint' : 'iron', skill, seed, setup: (i) => { i.arrows!.point = point; extra(i); } });
const visible = (it: Item) => { const im = renderItem(it); let n = 0; for (let k = 3; k < im.data.length; k += 4) if (im.data[k] > 0) n++; return n; };

describe('category plumbing', () => {
  it('every category has a size, headline stats with labels, an unlock and stage definitions', () => {
    for (const c of Object.keys(CATEGORY_INFO) as Category[]) {
      expect(HEADLINE_STATS[c].length).toBeGreaterThanOrEqual(4);
      for (const k of HEADLINE_STATS[c]) expect(STAT_LABELS[k], `${c}.${k}`).toBeTruthy();
      const it = createDraft(c, 'foundry', 'T', 1, 'Spring', 9);
      for (const st of stagesFor(it, tradition('foundry'))) {
        expect(STAGES[st], st).toBeTruthy();
        expect(STAGE_INFO[st].name, st).toBeTruthy();
      }
    }
    for (const id of ['tillertree', 'fletchjig']) expect(UPGRADES.some((u) => u.id === id)).toBe(true);
  });

  it('every craft stage names a real minigame and a way to apply it, and no method uses a quality slot twice', () => {
    for (const [id, st] of Object.entries(CRAFT_STAGES)) {
      expect(MINIGAMES[st.minigame], `${id} → ${st.minigame}`).toBeTruthy();
      expect(STAGE_MINIGAME[id]).toBe(st.minigame);
      expect(APPLY[id]).toBeTruthy();
    }
    for (const list of [...Object.values(BOW_STAGES), ...Object.values(ARMOR_STAGES), ['straighten', 'pointheat', 'points', 'fletch'] as CraftStageId[]]) {
      const slots = (list as CraftStageId[]).map((s) => CRAFT_STAGES[s].quality);
      expect(new Set(slots).size, list.join(',')).toBe(slots.length);
      expect(slots).not.toContain('finishing');
    }
  });

  it('material plans only offer real materials', () => {
    for (const c of ['bow', 'arrows', 'armor'] as Category[]) {
      const it = createDraft(c, 'foundry', 'T', 1, 'Spring', 9);
      const methods = c === 'bow' ? Object.keys(BOW_STAGES) : c === 'armor' ? Object.keys(ARMOR_STAGES) : ['x'];
      for (const m of methods) {
        it.design.method = m;
        const plan = materialPlan(it)!;
        for (const slot of [plan.primary, plan.secondary, plan.grip]) {
          expect(slot.options.length).toBeGreaterThan(0);
          for (const id of slot.options) expect(hasMat(id), `${c}/${m}: ${id}`).toBe(true);
        }
      }
    }
  });
});

describe('body armour is shelved', () => {
  it('is not offered, sold for, or accepted by the showcase', () => {
    expect(CRAFTABLE).toEqual(['sword', 'dagger', 'shield', 'bow', 'arrows']);
    expect(UPGRADES.some((u) => /armour/i.test(u.name + u.effect))).toBe(false);
    const it = createDraft('armor', 'foundry', 'T', 1, 'Spring', 9);
    expect(sanitizeShowcaseItem(toShowcasePayload(it)).ok).toBe(false);
  });
});

describe('bows', () => {
  it('each construction method follows its own stages, in every tradition', () => {
    expect(craftStages(bow('self'))).toEqual(['stave', 'bowheat', 'tiller', 'string']);
    expect(craftStages(bow('composite'))).toEqual(['stave', 'glueup', 'backing', 'cure', 'tiller', 'string']);
    for (const m of BOW_METHODS) {
      for (const t of TRADITIONS) {
        const it = simulateCraft({ category: 'bow', primary: 'ash', skill: 0.8, tradition: t.id, seed: 2, setup: (i) => { i.design.method = m.id; } });
        expect(it.history.map((h) => h.stage)).toEqual([...craftStages(it), 'finish']);
        expect(it.stats!.craftsmanship).toBeGreaterThan(55);
        expect(it.stats!.drawWeight).toBeGreaterThan(20);
      }
      const it = bow(m.id);
      expect(it.bow!.backing !== '').toBe(m.id !== 'self');
      expect(it.bow!.belly !== '').toBe(m.id === 'composite');
    }
  });

  it('tillering is what makes a bow: skill beats wood, and a hinge costs dearly', () => {
    const fine = bow('self', 0.95), rough = bow('self', 0.35);
    expect(fine.stats!.smoothness!).toBeGreaterThan(rough.stats!.smoothness! + 20);
    expect(fine.stats!.cast!).toBeGreaterThan(rough.stats!.cast! + 15);
    const ashExpert = simulateCraft({ category: 'bow', primary: 'ash', skill: 0.95, seed: 3 });
    const osagePoor = simulateCraft({ category: 'bow', primary: 'osage', skill: 0.4, seed: 3 });
    expect(ashExpert.stats!.overall).toBeGreaterThan(osagePoor.stats!.overall);
    expect(ashExpert.stats!.value).toBeGreaterThan(osagePoor.stats!.value);
    const hinged = bow('self', 0.95, 3);
    hinged.bow!.hinge = 0.9; hinged.bow!.upper[3] = -0.8;
    const before = bow('self', 0.95, 3).stats!;
    const { computeStats } = { computeStats: (i: Item) => simulateStats(i) };
    expect(computeStats(hinged).cast!).toBeLessThan(before.cast! - 10);
  });

  it('no method or shape is best at everything', () => {
    const stats = ['cast', 'smoothness', 'stability', 'durability', 'drawWeight'] as const;
    const byMethod = Object.fromEntries(BOW_METHODS.map((m) => [m.id, bow(m.id, 0.85, 7).stats!]));
    const byShape = Object.fromEntries(BOW_PROFILES.map((p) => [p.id, bow('self', 0.85, 7, (i) => { i.bow!.profile = p.id; }).stats!]));
    for (const group of [byMethod, byShape])
      for (const [id, s] of Object.entries(group)) {
        const beaten = Object.entries(group).some(([o, t]) => o !== id && (stats.some((k) => (t[k] ?? 0) > (s[k] ?? 0)) || t.weight < s.weight || t.value < s.value));
        expect(beaten, `${id} dominates`).toBe(true);
      }
    // sinew and horn add cast; a longer bow is smoother
    expect(byMethod.composite.cast!).toBeGreaterThan(byMethod.self.cast!);
    const short = bow('self', 0.85, 7, (i) => { i.bow!.length = 122; }), long = bow('self', 0.85, 7, (i) => { i.bow!.length = 164; });
    expect(long.stats!.smoothness!).toBeGreaterThan(short.stats!.smoothness!);
    expect(short.stats!.drawWeight!).toBeGreaterThan(long.stats!.drawWeight!);
  });

  it('renders every method and shape, differently, and shows how it was tillered', () => {
    const all = BOW_METHODS.flatMap((m) => BOW_PROFILES.map((p) => bow(m.id, 0.8, 5, (i) => { i.bow!.profile = p.id; })));
    const hashes = all.map((i) => renderItem(i).hash());
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const it of all) {
      expect(visible(it)).toBeGreaterThan(300);
      expect(renderItem(it).w).toBe(CATEGORY_INFO.bow.size[0] * RENDER_SCALE);
      expect(renderItem(it, 'profile').hash()).not.toBe(renderItem(it).hash());
    }
    expect(renderItem(bow('self', 0.95, 5)).hash()).not.toBe(renderItem(bow('self', 0.35, 5)).hash());
    const a = bow('backed', 0.8, 5);
    clearRenderCache();
    expect(renderItem(JSON.parse(JSON.stringify(a))).hash()).toBe(renderItem(a).hash());
  });
});

describe('arrows', () => {
  it('stone points skip the forge; metal points are heated first', () => {
    expect(craftStages(arrows('flint'))).toEqual(['straighten', 'points', 'fletch']);
    expect(craftStages(arrows('bodkin'))).toEqual(['straighten', 'pointheat', 'points', 'fletch']);
    expect(arrows('flint').materials.secondary).toBe('flint');
  });

  it('a matched, straight set flies better than a mixed one', () => {
    const fine = arrows('bodkin', 0.95), rough = arrows('bodkin', 0.35);
    for (const k of ['consistency', 'flight', 'straightness', 'penetration'] as const) expect(fine.stats![k]!, k).toBeGreaterThan(rough.stats![k]! + 10);
    const mixed = arrows('bodkin', 0.95);
    mixed.arrows!.spine = [0.6, -0.5, 0.1, 0.4, -0.6, 0];
    expect(simulateStats(mixed).consistency!).toBeLessThan(fine.stats!.consistency! - 15);
  });

  it('points and fletchings are real trade-offs and all render', () => {
    const pts = Object.fromEntries(ARROW_POINTS.map((p) => [p.id, arrows(p.id, 0.85, 8)]));
    expect(pts.bodkin.stats!.penetration!).toBeGreaterThan(pts.leaf.stats!.penetration!);
    expect(pts.leaf.stats!.flight!).toBeGreaterThan(pts.broadhead.stats!.flight!);
    const all = [...Object.values(pts), ...FLETCH_STYLES.map((f) => arrows('bodkin', 0.85, 8, (i) => { i.arrows!.fletch = f.id; i.materials.grip = 'turkey'; }))];
    const hashes = all.map((i) => renderItem(i).hash());
    expect(new Set(hashes).size).toBe(hashes.length);
    for (const it of all) expect(visible(it)).toBeGreaterThan(400);
    expect(renderItem(arrows('bodkin', 0.95, 8)).hash()).not.toBe(renderItem(arrows('bodkin', 0.3, 8)).hash());
  });
});

describe('bows and arrows on the showcase', () => {
  it('survive the sanitizer with identical sprites', () => {
    for (const it of [bow('self'), bow('composite', 0.7, 9, (i) => { i.bow!.nock = 'oxhorn'; i.bow!.profile = 'recurve'; }), arrows('flint', 0.6), arrows('broadhead', 0.9, 2, (i) => { i.arrows!.nock = 'buffalohorn'; })]) {
      const r = sanitizeShowcaseItem(JSON.parse(JSON.stringify(toShowcasePayload(it))));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(renderItem(r.item).hash()).toBe(renderItem(it).hash());
      expect(r.item.stats!.overall).toBe(it.stats!.overall);
    }
    const bad = toShowcasePayload(bow('self')) as any;
    bad.bow.length = 99999; bad.bow.backing = 'unobtainium'; bad.bow.upper = [9, 9, 'x'];
    const r = sanitizeShowcaseItem(bad);
    expect(r.ok && r.item.bow!.length).toBe(CATEGORY_INFO.bow.lengthRange[1]);
    expect(r.ok && r.item.bow!.backing).toBe('');
    for (const list of ['bowMethod', 'bowProfile', 'arrowPoint', 'fletchStyle']) expect(ALL_OPTION_LISTS[list].length).toBeGreaterThan(2);
  });

  it('writes a contact sheet when CRAFT_SHEET is set', () => {
    if (!process.env.CRAFT_SHEET) return;
    const imgs = [...BOW_METHODS.map((m, k) => renderItem(bow(m.id, 0.85, 20 + k, (i) => { i.bow!.profile = BOW_PROFILES[k % 4].id; }))), ...ARROW_POINTS.map((p, k) => renderItem(arrows(p.id, 0.8, 30 + k)))];
    writePng(process.env.CRAFT_SHEET, sheet(imgs), 2);
  });
});

import { computeStats as simulateStats } from '../src/item/stats';
