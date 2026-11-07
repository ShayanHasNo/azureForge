// The crafting screen: the item dominates the view and evolves as each stage's
// decisions and minigame performance are applied.

import type { App } from '../../app';
import { audio } from '../../audio/audio';
import { el } from '../../core/util';
import { CraftSession } from '../../crafting/session';
import { Control, StageCtx } from '../../crafting/stages';
import { compatibility, hasMat, mat, masteryLevel } from '../../data/materials';
import { OptionDef } from '../../data/options';
import { STAGE_INFO, StageId, TRADITIONS } from '../../data/traditions';
import { UPGRADES } from '../../data/workshop';
import { recordCompletedItem, traditionUnlockable } from '../../game/progress';
import { CATEGORY_INFO, cloneItem } from '../../item/factory';
import { computeStats, HEADLINE_STATS, physicsBalance, STAT_LABELS } from '../../item/stats';
import type { Category, ItemStats } from '../../item/types';
import { MINIGAMES } from '../../minigames';
import { gradeOf, MinigameInstance, QUIRKS } from '../../minigames/types';
import { renderItem, View } from '../../render/itemRenderer';
import { toCanvas } from '../../render/pixel';
import { btn, confirmDialog, modal, sfxClick, statRow, toast } from '../dom';
import { Showcase } from '../showcase';
import { openItem } from './inspect';

// ---------------------------------------------------------------- new piece
export function openNewPiece(app: App) {
  const s = app.state;
  const m = modal('Begin a new piece');
  let category: Category = 'sword';
  let trad = 'foundry';
  const render = () => {
    m.body.innerHTML = '';
    m.body.append(el('h3', {}, 'What will you make?'));
    const cats = el('div', { class: 'grid cols-3' });
    const catReq: Record<Category, string | null> = { sword: null, dagger: 'smallanvil', shield: 'shieldframe' };
    for (const c of ['sword', 'dagger', 'shield'] as Category[]) {
      const req = catReq[c];
      const locked = req && !s.upgrades.includes(req);
      const card = el('div', { class: `card click ${category === c ? 'sel' : ''} ${locked ? 'locked' : ''}`, tabindex: '0', role: 'button' },
        el('b', {}, CATEGORY_INFO[c].name),
        el('div', { class: 'small muted' }, locked ? `Needs the ${UPGRADES.find((u) => u.id === req)?.name} (Workshop → Tools).` : c === 'sword' ? 'Balance, durability, ornament, appeal.' : c === 'dagger' ? 'Compact, detailed, collectible.' : 'Coverage, integrity, weight, surface.'),
      );
      card.onclick = () => { if (locked) return toast('Buy the tool at your workbench first.'); sfxClick(); category = c; render(); };
      cats.append(card);
    }
    m.body.append(cats, el('h3', {}, 'Crafting tradition'));
    const grid = el('div', { class: 'grid cols-2' });
    for (const t of TRADITIONS) {
      const ok = s.traditions.includes(t.id) || traditionUnlockable(t, s);
      const card = el('div', { class: `card click ${trad === t.id ? 'sel' : ''} ${ok ? '' : 'locked'}`, tabindex: '0', role: 'button', style: { borderLeft: `5px solid ${t.color}` } },
        el('b', {}, t.name), el('div', { class: 'small' }, ok ? t.philosophy : `🔒 ${t.unlock.hint}`),
        ok ? el('div', { class: 'small muted' }, `Stages: ${t.stages.filter((x) => x !== 'appraisal').map((x) => STAGE_INFO[x].name).join(' → ')}`) : null,
      );
      card.onclick = () => { if (!ok) return; sfxClick(); trad = t.id; render(); };
      grid.append(card);
    }
    m.body.append(grid);
  };
  render();
  m.foot.append(btn('Cancel', () => m.close(), 'ghost'), btn('Light the forge', () => {
    m.close();
    audio.sfx('sizzle');
    openCrafting(app, new CraftSession(s, category, trad));
  }, 'primary'));
}

// ---------------------------------------------------------------- crafting
export function openCrafting(app: App, session: CraftSession | null) {
  const s = app.state;
  if (!session) {
    if (!s.draft) return;
    session = new CraftSession(s, null, s.draft.item.tradition, s.draft as any);
  }
  const ses = session;
  app.setCrafting(true);
  const root = el('div', { class: 'craft' });
  const track = el('div', { class: 'craft-track', 'aria-label': 'Crafting stages' });
  const stageArea = el('div', { class: 'craft-stage' });
  const side = el('div', { class: 'craft-side' });
  const foot = el('div', { class: 'craft-foot' });
  root.append(track, stageArea, side, foot);
  app.root.append(root);

  let view: View = 'front';
  const showcase = new Showcase(ses.item, view, { w: 400, h: 500 }, { reducedMotion: s.settings.reducedMotion });
  const viewBar = el('div', { class: 'viewtoggle' });
  const fitShowcase = () => {
    const r = stageArea.getBoundingClientRect();
    showcase.setBox(Math.max(160, Math.floor(r.width)), Math.max(160, Math.floor(r.height)));
  };
  const ro = new ResizeObserver(fitShowcase);
  ro.observe(stageArea);
  let mg: MinigameInstance | null = null;
  let baseline: ItemStats = computeStats(ses.item);

  const close = () => {
    mg?.destroy();
    showcase.destroy();
    ro.disconnect();
    root.remove();
    app.setCrafting(false);
    app.refresh();
  };

  function renderTrack() {
    track.innerHTML = '';
    ses.stages.forEach((st, i) => {
      track.append(el('div', { class: `step ${i < ses.index ? 'done' : ''} ${i === ses.index ? 'cur' : ''}`, title: STAGE_INFO[st].blurb }, el('span', { class: 'ico' }, i < ses.index ? '✓' : STAGE_INFO[st].icon), STAGE_INFO[st].name));
    });
    (track.querySelector('.cur') as HTMLElement | null)?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function renderStats() {
    const cur = computeStats(ses.item);
    foot.innerHTML = '';
    const keys: (keyof ItemStats)[] = [...HEADLINE_STATS[ses.item.category], 'weight'];
    for (const k of [...new Set(keys)]) {
      const v = cur[k] as number, b = baseline[k] as number;
      const d = v - b;
      const shown = k === 'weight' ? `${v.toFixed(1)}kg` : String(Math.round(v));
      foot.append(el('div', { class: 'mini', title: 'Projected — unfinished stages are estimated' },
        el('div', { class: 'row between' }, el('span', {}, STAT_LABELS[k]), el('span', {}, shown, Math.abs(d) >= 1 && k !== 'weight' ? el('span', { class: `delta ${d > 0 ? 'up' : 'down'}` }, ` ${d > 0 ? '+' : ''}${Math.round(d)}`) : null)),
        el('div', { class: 'bar' }, el('i', { style: { width: `${k === 'weight' ? Math.min(100, v / 3 * 100) : v}%` } }))));
    }
    if (ses.item.blade && ses.item.hilt) {
      const pb = physicsBalance(ses.item);
      foot.append(el('div', { class: 'mini', title: 'Where the balance point sits relative to the ideal (just ahead of the guard).' },
        el('div', {}, `Balance point ${pb.point > pb.ideal ? 'blade-heavy' : 'hilt-heavy'} · ${Math.round(pb.score * 100)}%`),
        el('div', { class: 'bar' }, el('i', { style: { width: `${pb.score * 100}%` } }))));
    }
  }

  function showPreview() {
    stageArea.innerHTML = '';
    stageArea.append(showcase.canvas, viewBar);
    viewBar.innerHTML = '';
    for (const [v, label] of [['front', 'Front'], ['back', 'Back'], ['profile', 'Edge']] as [View, string][]) {
      viewBar.append(btn(label, () => { view = v; showcase.setView(v); showPreview(); }, `small ${view === v ? 'primary' : ''}`));
    }
    fitShowcase();
  }

  function refreshPreview() {
    showcase.setItem(ses.item);
    renderStats();
  }

  // ------------------------------------------------------------ controls
  function renderControls(body: HTMLElement, ctx: StageCtx, disabled: boolean) {
    for (const c of ses.stageDef.controls(ctx)) body.append(renderControl(c, disabled, () => { refreshPreview(); rerenderSide(); }, { state: s, preview: refreshPreview }));
  }

  let rerenderSide = () => {};

  function renderStage() {
    renderTrack();
    const st = ses.stage;
    if (st === 'appraisal') return finishPiece();
    showPreview();
    baseline = computeStats(ses.item);
    renderStats();
    rerenderSide = () => {
      const scroll = side.querySelector('.panel-body')?.scrollTop ?? 0;
      buildSide();
      const pb = side.querySelector('.panel-body');
      if (pb) pb.scrollTop = scroll;
    };
    buildSide();
  }

  function buildSide() {
    const st = ses.stage;
    side.innerHTML = '';
    const head = el('div', { class: 'panel-head' }, el('h2', {}, `${STAGE_INFO[st].icon} ${STAGE_INFO[st].name}`), el('span', { class: 'small' }, `${ses.index + 1}/${ses.stages.length}`));
    const body = el('div', { class: 'panel-body' });
    body.append(el('p', { class: 'muted small' }, `${STAGE_INFO[st].blurb} · ${ses.trad.name}`));
    renderControls(body, ses.ctx, false);
    if (ses.canReorder) body.append(reorderControl());
    const mgDef = ses.minigameFor();
    const pf = el('div', { class: 'panel-foot' });
    pf.append(btn('Set aside', () => {
      confirmDialog('Set this piece aside?', 'Your progress is saved. You can return to it from the forge at any time. (Abandoning returns its materials.)', 'Set aside', () => { ses.persist(); close(); });
    }, 'ghost small'));
    if (st === 'design' || st === 'materials') pf.append(btn('Abandon', () => confirmDialog('Abandon this piece?', 'Any materials already used will be returned to storage.', 'Abandon', () => { ses.abandon(); close(); }, true), 'ghost small'));
    if (ses.index > 0 && st === 'materials' && !ses.materialsPaid) pf.append(btn('← Back', () => { ses.index--; renderStage(); }, 'small'));
    const label = mgDef ? `Begin: ${MINIGAMES[mgDef.id]?.name ?? mgDef.id} →` : 'Continue →';
    pf.append(btn(label, () => proceed(), 'primary'));
    side.append(head, body, pf);
  }

  function reorderControl(): HTMLElement {
    const box = el('div', { class: 'ctl card' }, el('div', { class: 'lbl' }, 'Experimental: reorder the middle stages'));
    const r = ses.trad.reorderable ?? [];
    const order = ses.stages.filter((x) => r.includes(x));
    order.forEach((st, i) => {
      box.append(el('div', { class: 'row between' }, el('span', {}, `${i + 1}. ${STAGE_INFO[st].name}`), el('span', {},
        i > 0 ? btn('↑', () => { const o = [...order]; [o[i - 1], o[i]] = [o[i], o[i - 1]]; ses.reorder(o); renderTrack(); rerenderSide(); }, 'small') : null,
        i < order.length - 1 ? btn('↓', () => { const o = [...order]; [o[i + 1], o[i]] = [o[i], o[i + 1]]; ses.reorder(o); renderTrack(); rerenderSide(); }, 'small') : null)));
    });
    box.append(el('div', { class: 'help' }, 'Shaping after polishing? Engraving before grinding? Results vary — that is the point.'));
    return box;
  }

  function proceed() {
    const err = ses.commitDecisions();
    if (err) { audio.sfx('soft'); toast(err); return; }
    app.save();
    const mgDef = ses.minigameFor();
    if (!mgDef || !MINIGAMES[mgDef.id]) {
      ses.record();
      audio.sfx('chime');
      ses.next();
      app.save();
      renderStage();
      return;
    }
    showInstructions(mgDef.id, mgDef.params);
  }

  function difficultyName(d: number) {
    return d <= 0.05 ? 'Relaxed' : d < 1.2 ? 'Beginner' : d < 2.2 ? 'Intermediate' : d < 3.2 ? 'Advanced' : 'Master';
  }

  function showInstructions(id: string, params: Record<string, any>) {
    const def = MINIGAMES[id];
    const difficulty = ses.difficultyFor();
    const quirk = ses.quirkFor();
    const env = makeEnv(params, difficulty, quirk);
    side.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
    const card = el('div', { class: 'result-card' });
    const p = el('div', { class: 'panel narrow' });
    const lines = def.instructions(env as any);
    p.append(
      el('div', { class: 'panel-head' }, el('h2', {}, def.name)),
      el('div', { class: 'panel-body' },
        ...lines.map((l) => el('p', {}, l)),
        el('p', { class: 'small muted' }, `Controls: ${def.controls}`),
        el('p', {}, el('span', { class: 'tag gold' }, `Difficulty: ${difficultyName(difficulty)}`), ' ', hasMat(ses.item.materials.primary) ? el('span', { class: 'tag' }, mat(ses.item.materials.primary).name) : null, quirk ? el('span', { class: 'tag cool' }, `Quirk: ${QUIRKS[quirk]}`) : null),
        s.settings.difficulty !== 'relaxed' ? el('p', { class: 'small muted' }, 'Prefer something gentler? Relaxed crafting mode is in Settings — it keeps every mechanic but widens all tolerances.') : null,
      ),
    );
    const f = el('div', { class: 'panel-foot' }, btn('Not yet', () => { card.remove(); buildSide(); }, 'ghost'), btn('Begin', () => { card.remove(); runMinigame(id, env); }, 'primary'));
    p.append(f);
    card.append(p);
    stageArea.append(card);
    setTimeout(() => (f.querySelector('.primary') as HTMLElement)?.focus(), 20);
  }

  function makeEnv(params: Record<string, any>, difficulty: number, quirk?: string) {
    return {
      item: cloneItem(ses.item),
      material: mat(ses.item.materials.primary),
      difficulty,
      params,
      quirk,
      audio,
      settings: { reducedMotion: s.settings.reducedMotion, highContrast: s.settings.highContrast, colorblind: s.settings.colorblind },
      upgrades: s.upgrades,
      sprite: (it: any, v: View = 'front') => toCanvas(renderItem(it, v)),
    };
  }

  function runMinigame(id: string, env: ReturnType<typeof makeEnv>) {
    const def = MINIGAMES[id];
    stageArea.innerHTML = '';
    const canvas = el('canvas', { class: 'mg', tabindex: '0', 'aria-label': `${def.name} minigame` });
    stageArea.append(canvas);
    const status = el('p', { class: 'small' }, 'Working…');
    side.querySelector('.panel-body')?.prepend(el('div', { class: 'card' }, el('b', {}, def.name), status, el('p', { class: 'small muted' }, def.controls)));
    canvas.focus();
    const inst = def.create({ ...env, canvas, onStatus: (t) => (status.textContent = t) });
    mg = inst;
    const before = computeStats(ses.item);
    inst.start().then((res) => {
      inst.destroy();
      mg = null;
      (audio as any).stopAllLoops?.();
      ses.applyResult(res, env.difficulty);
      ses.persist();
      app.save();
      showPreview();
      refreshPreview();
      const after = computeStats(ses.item);
      showResult(def.name, res, before, after);
    });
  }

  function showResult(name: string, res: { score: number; summary: string; details: Record<string, number> }, before: ItemStats, after: ItemStats) {
    const g = gradeOf(res.score);
    audio.sfx(res.score >= 0.65 ? 'success' : 'chime');
    const card = el('div', { class: 'result-card' });
    const p = el('div', { class: 'panel narrow' });
    const changes = el('div', {});
    const keys = [...new Set([...HEADLINE_STATS[ses.item.category], 'craftsmanship', 'materialQuality'])] as (keyof ItemStats)[];
    for (const k of keys) changes.append(statRow(k, after[k] as number, 100, (after[k] as number) - (before[k] as number)));
    const det = Object.entries(res.details).filter(([, v]) => typeof v === 'number' && v >= 0 && v <= 1).slice(0, 5);
    p.append(
      el('div', { class: 'panel-head' }, el('h2', {}, `${name} complete`)),
      el('div', { class: 'panel-body' },
        el('div', { class: `grade ${g}` }, g),
        el('p', { style: { textAlign: 'center' } }, res.summary),
        det.length ? el('p', { class: 'small muted', style: { textAlign: 'center' } }, det.map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${Math.round(v * 100)}%`).join(' · ')) : null,
        el('h3', {}, 'Effect on the piece'), changes,
      ),
    );
    const f = el('div', { class: 'panel-foot' }, btn('Continue →', () => { card.remove(); ses.next(); app.save(); renderStage(); }, 'primary'));
    p.append(f);
    card.append(p);
    stageArea.append(card);
    setTimeout(() => (f.querySelector('button') as HTMLElement)?.focus(), 20);
  }

  function finishPiece() {
    const item = ses.finalize();
    const report = recordCompletedItem(s, item);
    app.spendTime();
    close();
    audio.sfx('success');
    openItem(app, item, { fresh: true });
    report.messages.forEach((m, i) => setTimeout(() => toast(m, 6000), 400 + i * 500));
  }

  renderStage();
}

// ---------------------------------------------------------------- generic control renderers
interface CtlEnv { state: App['state']; preview: () => void }
function renderControl(c: Control, disabled: boolean, changed: () => void, env: CtlEnv): HTMLElement {
  const wrap = el('div', { class: 'ctl' });
  const lbl = (t: string) => el('div', { class: 'lbl' }, t);
  const help = (t?: string): Node | string => (t ? el('div', { class: 'help' }, t) : '');
  switch (c.kind) {
    case 'info':
      wrap.append(el('div', { class: 'card', html: c.html }));
      break;
    case 'options': {
      wrap.append(lbl(c.label));
      const grid = el('div', { class: 'opt-grid', role: 'radiogroup', 'aria-label': c.label });
      for (const o of c.options as (OptionDef & { locked?: string })[]) {
        const b = el('button', { class: `opt ${c.get() === o.id ? 'sel' : ''} ${o.locked ? 'locked' : ''}`, role: 'radio', 'aria-checked': String(c.get() === o.id), title: o.locked ?? o.desc, disabled }, o.locked ? `🔒 ${o.name}` : o.name, o.desc ? el('small', {}, o.locked ?? o.desc) : null);
        b.onclick = () => { if (o.locked) { toast(o.locked); return; } sfxClick(); c.set(o.id); changed(); };
        grid.append(b);
      }
      wrap.append(grid, help(c.help));
      break;
    }
    case 'multi': {
      wrap.append(lbl(c.label));
      const grid = el('div', { class: 'opt-grid' });
      const cur = c.get();
      for (const o of c.options) {
        const on = cur.includes(o.id);
        const b = el('button', { class: `opt ${on ? 'sel' : ''}`, 'aria-pressed': String(on), disabled }, o.name, el('small', {}, o.desc));
        b.onclick = () => {
          sfxClick();
          let next = on ? cur.filter((x) => x !== o.id) : [...cur, o.id];
          if (next.length > c.max) next = next.slice(next.length - c.max);
          c.set(next); changed();
        };
        grid.append(b);
      }
      wrap.append(grid, help(c.help));
      break;
    }
    case 'slider': {
      const val = el('span', { class: 'muted' }, c.format ? c.format(c.get()) : String(c.get()));
      const input = el('input', { type: 'range', min: c.min, max: c.max, step: c.step, value: c.get(), disabled, 'aria-label': c.label }) as HTMLInputElement;
      let pending = 0;
      input.oninput = () => {
        c.set(Number(input.value));
        val.textContent = c.format ? c.format(Number(input.value)) : input.value;
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(env.preview); // live preview without rebuilding the control
      };
      wrap.append(el('div', { class: 'row between' }, el('b', {}, c.label), val), input, help(c.help));
      break;
    }
    case 'swatches': {
      wrap.append(lbl(c.label));
      const row = el('div', { class: 'swatches' });
      for (const sw of c.swatches) {
        const b = el('button', { class: `swatch ${c.get() === sw.id ? 'sel' : ''}`, title: sw.name, 'aria-label': sw.name, style: { background: sw.hex }, disabled });
        b.onclick = () => { sfxClick(); c.set(sw.id); changed(); };
        row.append(b);
      }
      wrap.append(row);
      break;
    }
    case 'materials': {
      wrap.append(lbl(c.label));
      const list = el('div', { class: 'grid' });
      const st = env.state;
      if (c.allowNone) {
        const b = el('div', { class: `card click ${!c.get() ? 'sel' : ''}` }, 'None');
        b.onclick = () => { c.set(''); changed(); };
        list.append(b);
      }
      for (const id of c.materials) {
        if (!hasMat(id)) continue;
        const m = mat(id);
        const have = st?.materials?.[id] ?? 0;
        const enough = have >= c.need;
        const sel = c.get() === id;
        if (!enough && !sel && have === 0) continue; // only show what you own (plus the selected)
        const lvl = masteryLevel(st?.mastery?.[id] ?? 0);
        const card = el('div', { class: `card click matcard ${sel ? 'sel' : ''} ${enough ? '' : 'locked'}`, tabindex: '0', role: 'button', title: m.description },
          el('div', { class: 'matswatch', style: { background: `linear-gradient(135deg, ${m.palette[4]}, ${m.palette[2]} 60%, ${m.palette[1]})` } }),
          el('div', {}, el('b', {}, m.name), ' ', el('span', { class: 'small muted' }, `${'★'.repeat(m.rarity)}${lvl ? ` · mastery ${lvl}` : ''}`)),
          el('div', { class: 'small' }, `${have}/${c.need}`),
          m.kind === 'metal' || m.kind === 'crystal' ? propsBars(m.props as unknown as Record<string, number>) : el('div', { class: 'small muted', style: { gridColumn: '1 / -1' } }, m.traits.join(', ')),
        );
        card.onclick = () => { if (!enough) { toast(`You need ${c.need} ${m.name} (have ${have}). ${m.source}`); return; } sfxClick(); c.set(id); changed(); };
        list.append(card);
      }
      if (!list.childElementCount) list.append(el('p', { class: 'muted small' }, 'Nothing suitable in storage. Visit the village or explore.'));
      wrap.append(list, help(c.help));
      // compatibility hint between primary and secondary
      break;
    }
    case 'text': {
      const input = el('input', { type: 'text', maxlength: c.max, value: c.get(), placeholder: c.placeholder ?? '', disabled, 'aria-label': c.label }) as HTMLInputElement;
      input.oninput = () => { c.set(input.value); env.preview(); };
      wrap.append(lbl(c.label), input);
      break;
    }
    case 'toggle': {
      const input = el('input', { type: 'checkbox', disabled }) as HTMLInputElement;
      input.checked = c.get();
      input.onchange = () => { sfxClick(); c.set(input.checked); changed(); };
      wrap.append(el('label', { class: 'row' }, input, c.label), help(c.help));
      break;
    }
    case 'gems': {
      wrap.append(lbl(c.label));
      const cur = c.get();
      if (!c.gems.length) wrap.append(el('p', { class: 'small muted' }, 'No gems in storage. Garnets come from the Old Quarry; amber from the woods.'));
      for (const slot of c.slots) {
        const sel = el('select', { disabled, 'aria-label': `Gem for ${slot}` }) as HTMLSelectElement;
        sel.append(el('option', { value: '' }, `${slot}: none`));
        for (const g of c.gems) sel.append(el('option', { value: g }, `${slot}: ${mat(g).name}`));
        sel.value = cur.find((x) => x.slot === slot)?.gem ?? '';
        sel.onchange = () => {
          let next = cur.filter((x) => x.slot !== slot);
          if (sel.value) next.push({ slot, gem: sel.value });
          if (next.length > c.max) { toast(`Only ${c.max} gem${c.max > 1 ? 's' : ''} — a Fine Workbench allows more.`); next = next.slice(-c.max); }
          c.set(next); changed();
        };
        wrap.append(el('div', { style: { marginBottom: '4px' } }, sel));
      }
      break;
    }
  }
  return wrap;
}

function propsBars(p: Record<string, number>): HTMLElement {
  const show: [string, string][] = [['hardness', 'Hard'], ['toughness', 'Tough'], ['flexibility', 'Flex'], ['density', 'Weight'], ['workability', 'Workable'], ['decorative', 'Decor'], ['magic', 'Magic'], ['luster', 'Luster']];
  return el('div', { class: 'props' }, ...show.map(([k, n]) => el('span', {}, n, el('i', {}, el('b', { style: { width: `${p[k]}%` } })))));
}

export function compatLabel(a: string, b: string): string {
  const c = compatibility(a, b);
  return c >= 0.8 ? 'Harmonious pairing' : c >= 0.55 ? 'Compatible' : c >= 0.4 ? 'Uneasy pairing' : 'Clashing (daring!)';
}

export { STAT_LABELS };
export type { StageId };
