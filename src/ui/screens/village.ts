// The village: market stalls, villagers, the notice board and exploration.

import type { App } from '../../app';
import { audio } from '../../audio/audio';
import { el } from '../../core/util';
import { mat } from '../../data/materials';
import { addLog, addMaterial, phaseName, relLevel, weatherOf, weekday } from '../../game/state';
import { checkUnlocks } from '../../game/progress';
import { NPCS, npc } from '../../village/npcs';
import { template } from '../../village/requests';
import { boughtToday, JOURNALS, LOCATIONS, MERCHANTS } from '../../village/world';
import { btn, modal, tabs, toast } from '../dom';
import { portrait } from '../portrait';
import { fennickHere, giveFlow, pickItem } from './actions';

export function openVillage(app: App, initial = 'market') {
  const s = app.state;
  const m = modal(`The Village — ${weekday(s.day)} ${phaseName(s)}`);
  m.body.style.padding = '0';
  const t = tabs(m.body, [['market', 'Market'], ['board', `Notice board (${s.requests.length})`], ['people', 'Villagers'], ['explore', 'Explore']], (id, body) => {
    if (id === 'market') market(body);
    if (id === 'board') board(body);
    if (id === 'people') people(body);
    if (id === 'explore') explore(body);
  }, initial);
  const reopen = (tab: string) => { m.close(); openVillage(app, tab); };

  function market(body: HTMLElement) {
    body.append(el('p', { class: 'muted' }, `You have ◉ ${s.gold} gold. Every stall keeps a predictable schedule — check the journal for where things come from.`));
    for (const mer of MERCHANTS) {
      const open = mer.open(s);
      const card = el('div', { class: 'card', style: { marginBottom: '8px' } });
      card.append(el('div', { class: 'row' }, portrait(npc(mer.npc)), el('div', {}, el('b', {}, mer.name), el('div', { class: 'small' }, mer.blurb), el('div', { class: `small ${open ? '' : 'muted'}` }, open ? '● Open now' : `Closed — ${mer.schedule}`))));
      if (open) {
        const grid = el('div', { class: 'grid auto-grid', style: { marginTop: '6px' } });
        for (const line of mer.stock(s)) {
          const left = line.stock - boughtToday(s, mer.id, line.id);
          const mt = mat(line.id);
          grid.append(el('div', { class: 'card row between', style: { background: '#fff4dc' } },
            el('div', {}, el('div', { class: 'row' }, el('div', { class: 'matswatch', style: { background: `linear-gradient(135deg, ${mt.palette[4]}, ${mt.palette[2]} 60%, ${mt.palette[1]})`, width: '16px', height: '16px' } }), el('b', {}, mt.name)), el('div', { class: 'small muted' }, `${line.price}g · ${left} left · you have ${s.materials[line.id] ?? 0}`)),
            btn('Buy', () => {
              if (left <= 0) return toast('Sold out until tomorrow.');
              if (s.gold < line.price) return toast('Not enough gold. Sell or fulfil a request.');
              s.gold -= line.price;
              addMaterial(s, line.id, 1);
              s.merchantSales[`${s.day}:${mer.id}:${line.id}`] = boughtToday(s, mer.id, line.id) + 1;
              audio.sfx('coin');
              app.refresh();
              reopen('market');
            }, 'small', { disabled: left <= 0 || s.gold < line.price })));
        }
        card.append(grid);
      }
      body.append(card);
    }
    body.append(el('div', { class: 'card' }, el('b', {}, 'Selling'), el('p', { class: 'small' }, `Sell finished pieces from their inspection page. ${fennickHere(app) ? 'Fennick the collector is in the village today!' : 'Fennick the collector visits on Firedays and at the Seasonal Market.'}`)));
  }

  function board(body: HTMLElement) {
    body.append(el('p', { class: 'muted' }, 'Requests never expire. Interpret them however you like — villagers judge the piece you actually make.'));
    if (!s.requests.length) body.append(el('p', {}, 'The board is empty today. New requests appear every other morning.'));
    for (const r of s.requests) {
      const tp = template(r.template);
      if (!tp) continue;
      const n = npc(r.npc);
      body.append(el('div', { class: 'card', style: { marginBottom: '8px' } }, el('div', { class: 'dialog' }, portrait(n), el('div', { style: { flex: '1' } },
        el('b', {}, n.name), el('span', { class: 'small muted' }, ` · ${n.role}`), el('div', { class: 'speech', style: { margin: '4px 0' } }, `“${tp.text}”`),
        el('div', { class: 'small muted' }, `Hint: ${tp.hint}`), el('div', { class: 'small' }, `Reward around ${tp.reward.gold} gold, +${tp.reward.rep} reputation${tp.reward.materials ? ', plus materials' : ''}${tp.category ? ` · wants a ${tp.category}` : ''}`),
        el('div', { style: { marginTop: '6px' } }, btn('Offer a piece…', () => pickItem(app, `Offer to ${n.name}`, (it) => { m.close(); giveFlow(app, it, () => {}); }), 'small primary')),
      ))));
    }
  }

  function people(body: HTMLElement) {
    const grid = el('div', { class: 'grid cols-2' });
    for (const n of NPCS) {
      const lvl = relLevel(s, n.id);
      const pts = s.relationships[n.id] ?? 0;
      const likes = Object.entries(n.likes).filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => k);
      grid.append(el('div', { class: 'card' },
        el('div', { class: 'dialog' }, portrait(n), el('div', {}, el('b', {}, n.name), el('div', { class: 'small muted' }, n.role), el('div', { class: 'small' }, `Friendship ${lvl} ${'♥'.repeat(Math.min(6, lvl))}${'♡'.repeat(Math.max(0, 6 - lvl))}`))),
        el('p', { class: 'small' }, n.story),
        el('p', { class: 'small muted' }, `${n.personality} ${pts >= 5 ? `Seems to love: ${likes.join(', ')}.` : 'Get to know them to learn their tastes.'}`),
        el('div', { class: 'speech small' }, `“${n.greetings[(s.day + n.id.length) % n.greetings.length]}”`),
        el('div', { style: { marginTop: '6px' } }, btn('Give a piece…', () => pickItem(app, `A gift for ${n.name}`, (it) => { m.close(); giveFlow(app, it, () => {}); }), 'small')),
      ));
    }
    body.append(grid);
  }

  function explore(body: HTMLElement) {
    body.append(el('p', { class: 'muted' }, `Exploring takes one part of the day. It's ${phaseName(s)}, weather: ${weatherOf(s)}. Every place lists what it reliably offers.`));
    for (const l of LOCATIONS) {
      const known = s.locations.includes(l.id);
      const av = known ? l.available(s) : { ok: false, why: l.discover.hint };
      body.append(el('div', { class: 'card row between', style: { marginBottom: '6px' } },
        el('div', { style: { flex: '1' } }, el('b', {}, known ? l.name : '🔒 Unknown place'), el('div', { class: 'small' }, known ? `${l.blurb} ${l.yields}` : l.discover.hint), !av.ok && known ? el('div', { class: 'small muted' }, av.why ?? '') : null),
        known ? btn('Go', () => {
          const res = l.visit(s);
          s.locationVisits[l.id] = (s.locationVisits[l.id] ?? 0) + 1;
          s.stats.explored++;
          for (const [k, v] of Object.entries(res.materials)) addMaterial(s, k, v);
          if (res.journal && !s.journals.includes(res.journal)) s.journals.push(res.journal);
          addLog(s, `Explored ${l.name}: ${res.text}`);
          audio.sfx('step');
          m.close();
          const r = modal(l.name, { cls: 'narrow' });
          r.body.append(el('p', {}, res.text), el('h3', {}, 'You found'), el('p', {}, Object.entries(res.materials).map(([k, v]) => `${v} × ${mat(k).name}`).join(', ')));
          if (res.journal) r.body.append(el('div', { class: 'card' }, el('b', {}, JOURNALS[res.journal].title), el('p', { style: { fontStyle: 'italic' } }, `“${JOURNALS[res.journal].text}”`), el('p', { class: 'small' }, JOURNALS[res.journal].unlocks)));
          r.foot.append(btn('Head home', () => r.close(), 'primary'));
          app.spendTime();
          checkUnlocks(s).forEach((x) => toast(x));
          app.refresh();
        }, 'primary small', { disabled: !av.ok }) : null));
    }
  }
  void t;
}
