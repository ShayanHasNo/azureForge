// Shared item actions: selling, gifting, fulfilling requests, with villager reactions.

import type { App } from '../../app';
import { audio } from '../../audio/audio';
import { el } from '../../core/util';
import { fulfilRequest, giftItem, ownedItems, salePrice, sellItem } from '../../game/progress';
import { weekday, isSeasonalMarket, relLevel } from '../../game/state';
import { displayName } from '../../item/factory';
import type { Item } from '../../item/types';
import { npc, NPCS, Reaction } from '../../village/npcs';
import { template } from '../../village/requests';
import { btn, confirmDialog, itemThumb, modal, toast } from '../dom';
import { portrait } from '../portrait';

export function fennickHere(app: App): boolean {
  const s = app.state;
  return isSeasonalMarket(s.day) || weekday(s.day) === 'Fireday';
}

export function showReaction(npcId: string, r: Reaction, extra?: string, onClose?: () => void) {
  const n = npc(npcId);
  const m = modal(`${n.name}`, { cls: 'narrow', onClose });
  const mood = r.mood === 'delighted' || r.mood === 'pleased' ? 'happy' : r.mood === 'unsure' ? 'unsure' : 'neutral';
  m.body.append(el('div', { class: 'dialog' }, portrait(n, mood), el('div', { class: 'speech' }, ...r.lines.map((l) => el('p', {}, l)))));
  if (extra) m.body.append(el('p', { class: 'small muted' }, extra));
  m.foot.append(btn('Thank you', () => m.close(), 'primary'));
  audio.sfx(r.mood === 'delighted' ? 'success' : 'chime');
}

export function sellFlow(app: App, item: Item, done: () => void) {
  const s = app.state;
  const counter = salePrice(s, item, 'counter');
  const m = modal(`Sell “${displayName(item)}”?`, { cls: 'narrow' });
  m.body.append(el('p', {}, 'Selling lets the piece go out into the world. It stays in your journal\'s records, but leaves your collection.'));
  m.body.append(el('p', {}, `Counter customers will pay `, el('b', {}, `${counter} gold`), '.'));
  if (fennickHere(app)) m.body.append(el('p', {}, 'Fennick the collector is in the village today and offers ', el('b', {}, `${salePrice(s, item, 'fennick')} gold`), ' — he pays for character and craft.'));
  else m.body.append(el('p', { class: 'small muted' }, 'Fennick the collector visits on Firedays and at the Seasonal Market, and pays more for remarkable work.'));
  m.foot.append(btn('Keep it', () => m.close(), 'ghost'));
  m.foot.append(btn(`Sell at counter (${counter}g)`, () => { sellItem(s, item, 'counter'); audio.sfx('coin'); toast(`Sold for ${counter} gold.`); m.close(); app.refresh(); done(); }));
  if (fennickHere(app)) m.foot.append(btn(`Sell to Fennick (${salePrice(s, item, 'fennick')}g)`, () => {
    const p = sellItem(s, item, 'fennick'); audio.sfx('coin'); m.close(); app.refresh(); done();
    showReaction('fennick', { score: 0.8, mood: 'pleased', lines: [`A fine provenance. ${p} gold, as agreed.`, item.stats!.uniqueness > 50 ? 'I have nothing else like it.' : 'It will sit well in my ledger.'] });
  }, 'primary'));
}

export function giveFlow(app: App, item: Item, done: () => void) {
  const s = app.state;
  const m = modal(`Give “${displayName(item)}”`, { cls: 'narrow' });
  if (s.requests.length) {
    m.body.append(el('h3', {}, 'Fulfil a request'));
    for (const r of s.requests) {
      const t = template(r.template);
      if (!t) continue;
      const n = npc(r.npc);
      m.body.append(el('div', { class: 'card click row', style: { marginBottom: '6px' }, onclick: () => {
        m.close();
        const f = fulfilRequest(s, r.id, item);
        if (!f) return;
        audio.sfx('coin');
        app.refresh();
        done();
        const mats = Object.entries(f.reward.materials).map(([k, v]) => `${v} ${k}`).join(', ');
        showReaction(r.npc, f, `Reward: ${f.reward.gold} gold, +${f.reward.rep} reputation, friendship +${f.reward.rel}${mats ? `, ${mats}` : ''}${f.reward.journal ? ', and a journal' : ''}.`);
      } }, portrait(n), el('div', {}, el('b', {}, n.name), el('div', { class: 'small' }, `“${t.text}”`))));
    }
  }
  m.body.append(el('h3', {}, 'Or simply give it as a gift'));
  const grid = el('div', { class: 'grid cols-3' });
  for (const n of NPCS) {
    grid.append(el('div', { class: 'card click', style: { textAlign: 'center' }, onclick: () => {
      confirmDialog(`Give it to ${n.name}?`, 'Gifts deepen friendships. The piece leaves your collection.', 'Give', () => {
        m.close();
        const r = giftItem(s, n.id, item);
        app.refresh();
        done();
        showReaction(n.id, r, `Friendship with ${n.name}: level ${relLevel(s, n.id)}.`);
      });
    } }, portrait(n), el('div', {}, n.name), el('div', { class: 'small muted' }, `Friendship ${relLevel(s, n.id)}`)));
  }
  m.body.append(grid);
}

export function pickItem(app: App, title: string, onPick: (i: Item) => void) {
  const items = ownedItems(app.state);
  const m = modal(title);
  if (!items.length) m.body.append(el('p', {}, 'You have no finished pieces yet. Visit the forge!'));
  const grid = el('div', { class: 'grid auto-grid' });
  for (const it of [...items].reverse()) grid.append(itemThumb(it, () => { m.close(); onPick(it); }));
  m.body.append(grid);
}
