// Collection: every creation, sortable and filterable, plus the gallery room.

import type { App } from '../../app';
import { el } from '../../core/util';
import { mat } from '../../data/materials';
import { tradition, TRADITIONS } from '../../data/traditions';
import { ownedItems } from '../../game/progress';
import { galleryCapacity } from '../../game/state';
import { displayName } from '../../item/factory';
import type { Item } from '../../item/types';
import { renderItem } from '../../render/itemRenderer';
import { toCanvas } from '../../render/pixel';
import { itemThumb, modal, tabs } from '../dom';
import { openItem } from './inspect';

export function openCollection(app: App, initial = 'mine') {
  const s = app.state;
  const m = modal('Collection');
  m.body.style.padding = '0';
  const sel = { sort: 'date', filter: 'all', mat: 'all', trad: 'all', cat: 'all' };
  const t = tabs(m.body, [['mine', 'Your pieces'], ['gallery', 'Collection room'], ['records', 'Records (sold & given)']], (id, body) => {
    if (id === 'mine') renderList(body, ownedItems(s), true);
    if (id === 'records') renderList(body, s.items.filter((i) => i.sold || i.giftedTo), false);
    if (id === 'gallery') renderGallery(body);
  }, initial);

  function renderList(body: HTMLElement, items: Item[], controls: boolean) {
    const bar = el('div', { class: 'row', style: { marginBottom: '10px' } });
    const mk = (key: keyof typeof sel, label: string, opts: [string, string][]) => {
      const sl = el('select', { 'aria-label': label, style: { width: 'auto' } }) as HTMLSelectElement;
      for (const [v, n] of opts) sl.append(el('option', { value: v }, n));
      sl.value = sel[key];
      sl.onchange = () => { sel[key] = sl.value; draw(); };
      bar.append(el('span', { class: 'small' }, label), sl);
    };
    const mats = [...new Set(items.map((i) => i.materials.primary))];
    mk('sort', 'Sort', [['date', 'Newest'], ['oldest', 'Oldest'], ['craft', 'Craftsmanship'], ['rarity', 'Rarity'], ['value', 'Value'], ['name', 'Name']]);
    mk('filter', 'Show', [['all', 'All'], ['fav', 'Favourites'], ['master', 'Masterpieces (85+)'], ['displayed', 'On display']]);
    mk('mat', 'Material', [['all', 'Any'], ...mats.map((x) => [x, mat(x).name] as [string, string])]);
    mk('trad', 'Tradition', [['all', 'Any'], ...TRADITIONS.map((x) => [x.id, x.name] as [string, string])]);
    mk('cat', 'Type', [['all', 'Any'], ['sword', 'Swords'], ['dagger', 'Daggers'], ['shield', 'Shields']]);
    const grid = el('div', { class: 'grid auto-grid' });
    body.append(bar, grid);
    function draw() {
      let list = [...items];
      if (sel.filter === 'fav') list = list.filter((i) => i.favorite);
      if (sel.filter === 'master') list = list.filter((i) => (i.stats?.craftsmanship ?? 0) >= 85);
      if (sel.filter === 'displayed') list = list.filter((i) => s.displayed.includes(i.id) || s.gallery.includes(i.id));
      if (sel.mat !== 'all') list = list.filter((i) => i.materials.primary === sel.mat);
      if (sel.trad !== 'all') list = list.filter((i) => i.tradition === sel.trad);
      if (sel.cat !== 'all') list = list.filter((i) => i.category === sel.cat);
      const by: Record<string, (a: Item, b: Item) => number> = {
        date: (a, b) => b.createdAt - a.createdAt, oldest: (a, b) => a.createdAt - b.createdAt, craft: (a, b) => b.stats!.craftsmanship - a.stats!.craftsmanship,
        rarity: (a, b) => b.stats!.rarity - a.stats!.rarity, value: (a, b) => b.stats!.value - a.stats!.value, name: (a, b) => displayName(a).localeCompare(displayName(b)),
      };
      list.sort(by[sel.sort]);
      grid.innerHTML = '';
      if (!list.length) grid.append(el('p', { class: 'muted' }, items.length ? 'Nothing matches those filters.' : 'Nothing here yet — the forge is waiting.'));
      for (const it of list) grid.append(itemThumb(it, () => openItem(app, it, { onChange: () => t.select(controls ? 'mine' : 'records') }), el('div', { class: 'small muted' }, `${mat(it.materials.primary).name} · ${tradition(it.tradition).name.replace('The ', '')}`)));
    }
    draw();
  }

  function renderGallery(body: HTMLElement) {
    const cap = galleryCapacity(s);
    if (!cap) {
      body.append(el('p', {}, 'The back room is full of grandmother\'s old crates. Open it up as a Collection Room from Workshop → Tools to display twelve more pieces.'));
      return;
    }
    const owned = new Map(ownedItems(s).map((i) => [i.id, i]));
    const items = s.gallery.map((id) => owned.get(id)).filter(Boolean) as Item[];
    body.append(el('p', { class: 'muted' }, `${items.length}/${cap} plinths filled. Use “To gallery” on any piece to place it here.`));
    const c = document.createElement('canvas');
    const W = 640, H = 300;
    c.width = W; c.height = H;
    c.style.width = '100%';
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    // room
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#3a2a20'); g.addColorStop(0.7, '#4a3424'); g.addColorStop(0.71, '#2a1c14'); g.addColorStop(1, '#1e140e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 32) { ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(x, 0, 2, H * 0.7); }
    const per = 6;
    items.forEach((it, i) => {
      const row = Math.floor(i / per), col = i % per;
      const cx = 55 + col * 106, base = row === 0 ? 205 : 290;
      if (row > 1) return;
      const spot = ctx.createRadialGradient(cx, base - 60, 4, cx, base - 60, 70);
      spot.addColorStop(0, 'rgba(255,220,160,0.22)'); spot.addColorStop(1, 'rgba(255,220,160,0)');
      ctx.fillStyle = spot; ctx.fillRect(cx - 70, base - 140, 140, 150);
      ctx.fillStyle = '#6a5040'; ctx.fillRect(cx - 22, base - 6, 44, 10);
      ctx.fillStyle = '#8a6a50'; ctx.fillRect(cx - 22, base - 6, 44, 2);
      const img = toCanvas(renderItem(it));
      const sc = Math.min(1, 120 / img.height, 60 / img.width) * (row === 0 ? 1 : 0.7);
      const w = Math.floor(img.width * sc), h = Math.floor(img.height * sc);
      ctx.drawImage(img, Math.round(cx - w / 2), base - 6 - h, w, h);
    });
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
      const col = Math.round((x - 55) / 106), row = y < 210 ? 0 : 1;
      const it = items[row * per + col];
      if (it) openItem(app, it, { onChange: () => t.select('gallery') });
    });
    body.append(c);
    const grid = el('div', { class: 'grid auto-grid', style: { marginTop: '10px' } });
    for (const it of items) grid.append(itemThumb(it, () => openItem(app, it, { onChange: () => t.select('gallery') })));
    body.append(grid);
  }
}
