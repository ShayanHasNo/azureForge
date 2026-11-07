// Inspection & appraisal: the finished piece in detail, its full crafting
// history, and what to do with it.

import type { App } from '../../app';
import { audio } from '../../audio/audio';
import { el } from '../../core/util';
import { hasMat, mat } from '../../data/materials';
import { optionName, palette } from '../../data/options';
import { tradition } from '../../data/traditions';
import { comboName, ownedItems, removeFromDisplays } from '../../game/progress';
import { displayCapacity, galleryCapacity } from '../../game/state';
import { CATEGORY_INFO, displayName } from '../../item/factory';
import { generateDescription, generateName, MUTATION_WORDS } from '../../item/describe';
import { HEADLINE_STATS, STAT_LABELS } from '../../item/stats';
import type { Item, ItemStats } from '../../item/types';
import { bladeLayout, renderItem, View } from '../../render/itemRenderer';
import { toCanvas } from '../../render/pixel';
import { btn, itemThumb, modal, spriteCanvas, statRow, tabs, toast } from '../dom';
import { Showcase } from '../showcase';
import { giveFlow, sellFlow } from './actions';
import { damascusCard } from '../damascusCard';
import { describeDamascus, rareColor } from '../../item/damascus';
import { showcaseButtons } from './showcase';

const MATERIAL_STATS = new Set(['flexibility', 'weight', 'rarity']);

export interface OpenItemOpts {
  fresh?: boolean;
  onChange?: () => void;
  /** Viewing someone else's piece (online showcase): no renaming, no actions. */
  readOnly?: boolean;
  /** Shown for read-only pieces. */
  byline?: string;
}

export function openItem(app: App, item: Item, opts: OpenItemOpts = {}) {
  const s = app.state;
  const st = item.stats!;
  const m = modal(opts.fresh ? 'Inspection & Appraisal' : displayName(item), { onClose: () => { sc.destroy(); opts.onChange?.(); } });
  const owned = !opts.readOnly && !item.sold && !item.giftedTo;
  const wrap = el('div', { class: 'inspect' });
  const show = el('div', { class: 'showcase' });
  const sc = new Showcase(item, 'front', { w: 380, h: 460 }, { reducedMotion: s.settings.reducedMotion });
  show.append(sc.canvas);
  let detail: HTMLCanvasElement | null = null;
  const views = el('div', { class: 'viewtoggle' });
  const setView = (v: View | 'detail') => {
    detail?.remove();
    detail = null;
    if (v === 'detail') {
      sc.canvas.style.display = 'none';
      detail = detailCanvas(item);
      show.append(detail);
    } else {
      sc.canvas.style.display = '';
      sc.setView(v);
    }
    views.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', b.dataset.v === v));
  };
  for (const [v, l] of [['front', 'Front'], ['back', 'Back'], ['profile', 'Edge'], ['detail', 'Detail']] as const) {
    const b = btn(l, () => setView(v), 'small');
    b.dataset.v = v;
    views.append(b);
  }
  show.append(views);
  setView('front');

  const info = el('div', {});
  const nameInput = el('input', { class: 'namefield', value: displayName(item), 'aria-label': 'Item name', maxlength: 48, readonly: !!opts.readOnly }) as HTMLInputElement;
  nameInput.onchange = () => { item.customName = nameInput.value.trim() || undefined; m.setTitle(opts.fresh ? 'Inspection & Appraisal' : displayName(item)); app.save(); };
  const reroll = btn('↻', () => { item.seed = item.seed; const n = generateName({ ...item, seed: (item.seed + Date.now()) >>> 0 }); item.customName = n; nameInput.value = n; app.save(); }, 'small ghost', { title: 'Suggest another name' });
  info.append(...[
    el('div', { class: 'row' }, nameInput, opts.readOnly ? null : reroll),
    opts.byline ? el('p', { class: 'small muted' }, opts.byline) : null,
    el('div', { class: 'row', style: { margin: '6px 0' } },
      el('span', { class: 'tag gold' }, st.grade), el('span', { class: 'tag' }, st.rarityLabel), el('span', { class: 'tag', style: { background: tradition(item.tradition).color } }, tradition(item.tradition).name),
      el('span', { class: 'tag cool' }, CATEGORY_INFO[item.category].name), el('span', { class: 'small muted' }, `◉ ${st.value} gold · by ${item.creator}, day ${item.createdDay} of ${item.createdSeason}`),
    ),
    el('p', {}, item.description ?? generateDescription(item)),
    damascusCard(item),
  ].filter((n): n is HTMLElement => !!n));
  if (item.sold) info.append(el('p', { class: 'muted' }, 'This piece was sold.'));
  if (item.giftedTo) info.append(el('p', { class: 'muted' }, `This piece now belongs to ${item.giftedTo[0].toUpperCase() + item.giftedTo.slice(1)}.`));

  const tabHost = el('div', { class: 'card', style: { padding: '0', marginTop: '8px' } });
  tabs(tabHost, [['stats', 'Statistics'], ['materials', 'Composition'], ['history', 'Crafting history'], ['compare', 'Compare']], (id, body) => {
    if (id === 'stats') statsTab(body, item, s.settings.showDetailedStats);
    if (id === 'materials') materialsTab(body, item);
    if (id === 'history') { if (item.history.length || !opts.readOnly) historyTab(body, item); else body.append(el('p', { class: 'muted' }, 'The maker keeps their crafting notes private.')); }
    if (id === 'compare') compareTab(body, item, app);
  });
  info.append(tabHost);
  wrap.append(show, info);
  m.body.append(wrap);
  const fit = () => { const r = show.getBoundingClientRect(); sc.setBox(Math.max(200, Math.floor(r.width)), Math.max(300, Math.min(Math.floor(r.height), window.innerHeight - 240))); };
  requestAnimationFrame(fit);

  if (owned) {
    const favBtn = btn(item.favorite ? '★ Favourite' : '☆ Favourite', () => { item.favorite = !item.favorite; favBtn.textContent = item.favorite ? '★ Favourite' : '☆ Favourite'; app.save(); }, 'ghost');
    const onRack = s.displayed.includes(item.id);
    const dispBtn = btn(onRack ? 'Take off display' : 'Put on display rack', () => {
      if (s.displayed.includes(item.id)) removeFromDisplays(s, item.id);
      else {
        if (s.displayed.length >= displayCapacity(s)) return toast('The rack is full — swap pieces in Workshop → Display, or buy a bigger rack.');
        removeFromDisplays(s, item.id);
        s.displayed.push(item.id);
        audio.sfx('place');
      }
      dispBtn.textContent = s.displayed.includes(item.id) ? 'Take off display' : 'Put on display rack';
      app.refresh();
    });
    m.foot.append(favBtn, dispBtn);
    if (galleryCapacity(s)) {
      m.foot.append(btn('To gallery', () => {
        if (s.gallery.includes(item.id)) return toast('Already in the gallery.');
        if (s.gallery.length >= galleryCapacity(s)) return toast('The gallery is full.');
        removeFromDisplays(s, item.id); s.gallery.push(item.id); audio.sfx('place'); toast('Placed in the collection room.'); app.refresh();
      }));
    }
    m.foot.append(...showcaseButtons(app, item));
    m.foot.append(btn('Give…', () => giveFlow(app, item, () => m.close())), btn('Sell…', () => sellFlow(app, item, () => m.close())));
  }
  m.foot.append(btn(opts.fresh ? 'Admire & close' : 'Close', () => m.close(), 'primary'));
  if (opts.fresh) setTimeout(() => toast(`“${displayName(item)}” — ${st.grade}, ${st.rarityLabel}.`), 300);
  const dm = item.surface.damascus;
  if (opts.fresh && dm) {
    const rc = rareColor(dm.color);
    setTimeout(() => {
      toast(`❖ ${describeDamascus(dm)}`, 6500);
      if (rc) { audio.sfx('success'); toast(`✦ Incredibly rare: a ${rc.name} Damascus bloom!`, 8000); }
    }, 900);
  }
}

function detailCanvas(item: Item): HTMLCanvasElement {
  const img = renderItem(item, 'front');
  const src = toCanvas(img);
  let sx = 0, sy = 0, sw = img.w, sh = img.h;
  if (item.blade) {
    const lay = bladeLayout(item);
    sy = Math.max(0, lay.guardTop - 26); sh = img.h - sy; sx = 0; sw = img.w;
  } else { sx = img.w * 0.2; sy = img.h * 0.2; sw = img.w * 0.6; sh = img.h * 0.6; }
  const scale = Math.max(2, Math.floor(Math.min(380 / sw, 440 / sh)));
  const c = document.createElement('canvas');
  c.width = sw * scale; c.height = sh * scale;
  c.style.maxWidth = '100%'; c.style.maxHeight = '100%';
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

function statsTab(body: HTMLElement, item: Item, detailed: boolean) {
  const st = item.stats!;
  const head = HEADLINE_STATS[item.category];
  body.append(el('h3', {}, `${item.category[0].toUpperCase() + item.category.slice(1)} qualities`));
  for (const k of head) body.append(statRow(k, st[k] as number, 100, undefined, MATERIAL_STATS.has(k) ? 'mat' : ''));
  body.append(el('h3', {}, 'All characteristics'));
  const all: (keyof ItemStats)[] = ['craftsmanship', 'materialQuality', 'durability', 'integrity', 'balance', 'flexibility', 'weight', 'surfaceQuality', 'ornamentation', 'complexity', 'cohesion', 'uniqueness', 'intentFulfillment', 'collectorAppeal', 'rarity'];
  if (item.category === 'shield') all.push('coverage');
  if (item.category === 'dagger') all.push('compactness');
  const grid = el('div', { class: 'grid cols-2' });
  for (const k of all.filter((k) => !head.includes(k))) grid.append(statRow(k, st[k] as number, 100, undefined, MATERIAL_STATS.has(k) ? 'mat' : ''));
  body.append(grid);
  body.append(el('p', { class: 'small muted' }, 'Gold bars are driven mostly by your craftsmanship; blue bars mostly by the material itself. Every stat blends both.'));
  if (detailed) {
    body.append(el('h3', {}, 'Stage performance'));
    for (const [k, v] of Object.entries(item.quality)) if (v !== undefined) body.append(statRow(k, v * 100));
  }
}

function materialsTab(body: HTMLElement, item: Item) {
  const row = (label: string, id?: string, note = '') => {
    if (!id || !hasMat(id)) return null;
    const m = mat(id);
    return el('div', { class: 'card matcard', style: { marginBottom: '5px' } },
      el('div', { class: 'matswatch', style: { background: `linear-gradient(135deg, ${m.palette[4]}, ${m.palette[2]} 60%, ${m.palette[1]})` } }),
      el('div', {}, el('b', {}, `${label}: ${m.name}`), ' ', el('span', { class: 'small muted' }, note || m.traits.join(', '))), el('span', { class: 'small' }, '★'.repeat(m.rarity)));
  };
  const combo = comboName(item.materials.primary, item.materials.secondary);
  body.append(el('div', {},
    row('Primary', item.materials.primary), row('Secondary', item.materials.secondary, combo ? `storied pairing “${combo}”` : ''), row('Fused with', item.materials.fusedWith),
    row(item.category === 'shield' ? 'Face' : 'Grip', item.hilt?.gripMaterial ?? item.shield?.faceMaterial),
    ...item.decoration.gems.map((g) => row(`Gem (${g.slot})`, g.gem)),
    ...item.decoration.stones.map((g, i) => row(`Stone ${i + 1}`, g.stone)),
  ));
  const d = item.design;
  body.append(el('h3', {}, 'Design'), el('p', {}, `${optionName('direction', d.direction)} direction · ${optionName('motif', d.motif)} motif · ${palette(d.palette).name} palette${d.intents.length ? ` · intended ${d.intents.join(' & ')}` : ''}`));
  if (item.blade) body.append(el('p', { class: 'small' }, `${optionName('profile', item.blade.profile)} profile, ${optionName('tip', item.blade.tip)} tip, ${item.blade.length}px long, ${optionName('approach', item.structure.approach)} construction, ${optionName('fuller', item.blade.fuller)}.`));
  if (item.hilt && item.blade) body.append(el('p', { class: 'small' }, `${optionName('guard', item.hilt.guard)} guard, ${optionName('wrap', item.hilt.wrap)}, ${optionName('pommel', item.hilt.pommel)} pommel.`));
  body.append(el('p', { class: 'small' }, `${optionName('texture', item.surface.texture)} surface · ${optionName('finish', item.finish.finish)} finish${item.decoration.engraving.pattern !== 'none' ? ` · ${optionName('engraving', item.decoration.engraving.pattern)} engraving` : ''}${item.decoration.emblem !== 'none' ? ` · ${optionName('emblem', item.decoration.emblem)} emblem` : ''}.`));
  if (item.mutations.length) body.append(el('p', {}, 'Mutations: ', ...item.mutations.map((x) => el('span', { class: 'tag cool' }, MUTATION_WORDS[x] ?? x))));
  body.append(el('h3', {}, 'Signature'), el('p', { class: 'small muted' }, `Seed ${item.seed.toString(16)} · visual signature ${renderItem(item).hash()} · id ${item.id}${item.surface.damascus ? ` · ${describeDamascus(item.surface.damascus)}` : ''}`), el('p', {}, ...item.tags.slice(0, 24).map((t) => el('span', { class: 'tag' }, t))));
}

function historyTab(body: HTMLElement, item: Item) {
  const tl = el('div', { class: 'timeline' });
  for (const h of item.history) {
    const choices = Object.entries(h.choices).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => `${k}: ${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`);
    tl.append(el('div', { class: 'ev' },
      el('b', {}, h.name), h.minigame ? el('span', { class: 'tag gold', style: { marginLeft: '6px' } }, `${h.minigame.grade} · ${Math.round(h.minigame.score * 100)}%`) : null,
      choices.length ? el('div', { class: 'small muted' }, choices.join(' · ')) : null,
      h.minigame ? el('div', { class: 'small' }, h.minigame.summary) : null,
      h.notes.length ? el('div', { class: 'small muted' }, h.notes.join('; ')) : null,
    ));
  }
  if (!item.history.length) tl.append(el('p', {}, 'No history recorded.'));
  body.append(tl);
}

function compareTab(body: HTMLElement, item: Item, app: App) {
  const others = app.state.items.filter((i) => i.id !== item.id);
  if (!others.length) { body.append(el('p', { class: 'muted' }, 'Make another piece to compare versions of your designs.')); return; }
  const similar = [...others].sort((a, b) => score(b) - score(a));
  function score(o: Item) { return (o.category === item.category ? 2 : 0) + (o.materials.primary === item.materials.primary ? 1 : 0) + (o.design.direction === item.design.direction ? 1 : 0); }
  const sel = el('select', { 'aria-label': 'Compare with' }) as HTMLSelectElement;
  for (const o of similar) sel.append(el('option', { value: o.id }, `${displayName(o)} (${o.stats?.grade}, ${o.materials.primary})`));
  const out = el('div', {});
  const draw = () => {
    const o = others.find((x) => x.id === sel.value)!;
    out.innerHTML = '';
    const keys: (keyof ItemStats)[] = ['craftsmanship', 'durability', 'balance', 'integrity', 'flexibility', 'ornamentation', 'uniqueness', 'collectorAppeal', 'value'];
    const table = el('table', { style: { width: '100%', borderCollapse: 'collapse' } });
    table.append(el('tr', {}, el('th', {}, ''), el('th', {}, displayName(item)), el('th', {}, displayName(o))));
    for (const k of keys) {
      const a = item.stats![k] as number, b = o.stats![k] as number;
      table.append(el('tr', {}, el('td', {}, STAT_LABELS[k]), el('td', { style: { fontWeight: a > b ? '600' : '400' } }, String(a)), el('td', { style: { fontWeight: b > a ? '600' : '400' } }, String(b))));
    }
    out.append(el('div', { class: 'row', style: { justifyContent: 'space-around' } }, spriteCanvas(item, 120, 220), spriteCanvas(o, 120, 220)), table);
  };
  sel.onchange = draw;
  body.append(sel, out);
  draw();
  void itemThumb; void ownedItems;
}
