// Workshop customisation: decor, extras, tools/upgrades and display arrangement.

import type { App } from '../../app';
import { audio } from '../../audio/audio';
import { el } from '../../core/util';
import { DECOR, DecorSlot, EXTRAS, UPGRADES } from '../../data/workshop';
import { checkUnlocks, ownedItems, removeFromDisplays } from '../../game/progress';
import { addLog, displayCapacity } from '../../game/state';
import { btn, itemThumb, modal, tabs, toast } from '../dom';

export function openCustomize(app: App, initial = 'decor') {
  const s = app.state;
  const m = modal('Your Workshop');
  m.body.style.padding = '0';
  const t = tabs(m.body, [['decor', 'Decor'], ['extras', 'Touches'], ['tools', 'Tools & expansions'], ['display', 'Display rack']], (id, body) => {
    if (id === 'decor') decor(body);
    if (id === 'extras') extras(body);
    if (id === 'tools') tools(body);
    if (id === 'display') display(body);
  }, initial);
  const redraw = (tab: string) => { app.refresh(); t.select(tab); };

  function decor(body: HTMLElement) {
    body.append(el('p', { class: 'muted' }, `◉ ${s.gold} gold. Decor is yours to express — it changes nothing but how home feels.`));
    const slots: [DecorSlot, string][] = [['wall', 'Walls'], ['floor', 'Floor'], ['lighting', 'Lighting'], ['window', 'Window'], ['forge', 'Forge'], ['shelves', 'Display rack']];
    for (const [slot, name] of slots) {
      body.append(el('h3', {}, name));
      const grid = el('div', { class: 'grid auto-grid' });
      for (const d of DECOR.filter((x) => x.slot === slot)) {
        const key = `${slot}:${d.id}`;
        const own = s.ownedDecor.includes(key);
        const active = s.decor[slot] === d.id;
        grid.append(el('div', { class: `card ${active ? 'sel' : ''}` }, el('b', {}, d.name), el('div', { class: 'small' }, d.desc),
          el('div', { style: { marginTop: '4px' } }, active ? el('span', { class: 'tag good' }, 'In use') : own ? btn('Use', () => { s.decor[slot] = d.id; audio.sfx('place'); redraw('decor'); }, 'small') : btn(`Buy ${d.cost}g`, () => {
            if (s.gold < d.cost) return toast('Not enough gold.');
            s.gold -= d.cost; s.ownedDecor.push(key); s.decor[slot] = d.id; audio.sfx('coin'); addLog(s, `You fitted ${d.name.toLowerCase()} in the workshop.`); redraw('decor');
          }, 'small primary'))));
      }
      body.append(grid);
    }
  }

  function extras(body: HTMLElement) {
    const grid = el('div', { class: 'grid auto-grid' });
    for (const x of EXTRAS) {
      const own = s.ownedExtras.includes(x.id);
      const on = s.extras.includes(x.id);
      grid.append(el('div', { class: `card ${on ? 'sel' : ''}` }, el('b', {}, x.name), el('div', { class: 'small' }, x.desc), el('div', { style: { marginTop: '4px' } },
        own ? btn(on ? 'Put away' : 'Set out', () => { s.extras = on ? s.extras.filter((e) => e !== x.id) : [...s.extras, x.id]; audio.sfx('place'); redraw('extras'); }, 'small')
          : btn(`Buy ${x.cost}g`, () => { if (s.gold < x.cost) return toast('Not enough gold.'); s.gold -= x.cost; s.ownedExtras.push(x.id); s.extras.push(x.id); audio.sfx('coin'); redraw('extras'); }, 'small primary'))));
    }
    body.append(grid);
  }

  function tools(body: HTMLElement) {
    body.append(el('p', { class: 'muted' }, 'Tools add new mechanics, options and kinds of work. They never simply make your items stronger.'));
    const grid = el('div', { class: 'grid cols-2' });
    for (const u of UPGRADES) {
      const own = s.upgrades.includes(u.id);
      const repOk = (u.reputation ?? 0) <= s.reputation;
      grid.append(el('div', { class: `card ${own ? 'sel' : ''}` }, el('b', {}, u.name), el('div', { class: 'small' }, u.desc), el('div', { class: 'small', style: { marginTop: '3px' } }, `→ ${u.effect}`),
        el('div', { style: { marginTop: '5px' } }, own ? el('span', { class: 'tag good' }, 'Owned') : !repOk ? el('span', { class: 'small muted' }, `Needs ${u.reputation} reputation`) : btn(`Buy ${u.cost}g`, () => {
          if (s.gold < u.cost) return toast('Not enough gold — fulfil a request or sell a piece.');
          s.gold -= u.cost; s.upgrades.push(u.id); audio.sfx('success'); addLog(s, `New in the workshop: ${u.name}.`); toast(`${u.name}: ${u.effect}`);
          checkUnlocks(s).forEach((x) => toast(x));
          redraw('tools');
        }, 'small primary'))));
    }
    body.append(grid);
  }

  function display(body: HTMLElement) {
    const cap = displayCapacity(s);
    const items = ownedItems(s);
    body.append(el('p', { class: 'muted' }, `Choose up to ${cap} pieces for the workshop rack (${s.displayed.length}/${cap}). A bigger rack is in Decor.`));
    if (!items.length) body.append(el('p', {}, 'Nothing to display yet.'));
    const grid = el('div', { class: 'grid auto-grid' });
    for (const it of [...items].reverse()) {
      const on = s.displayed.includes(it.id);
      grid.append(itemThumb(it, () => {
        if (on) removeFromDisplays(s, it.id);
        else {
          if (s.displayed.length >= cap) return toast('The rack is full.');
          removeFromDisplays(s, it.id); s.displayed.push(it.id); audio.sfx('place');
        }
        redraw('display');
      }, el('span', { class: `tag ${on ? 'good' : ''}` }, on ? 'On display' : s.gallery.includes(it.id) ? 'In gallery' : 'In storage')));
    }
    body.append(grid);
  }
}
