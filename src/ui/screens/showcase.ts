// The market showcase: show your pieces to other players and browse theirs.

import type { App } from '../../app';
import { audio } from '../../audio/audio';
import { el } from '../../core/util';
import { formatVisibility, rareColor } from '../../item/damascus';
import { displayName } from '../../item/factory';
import type { Item } from '../../item/types';
import { listShowcase, postToShowcase, withdrawFromShowcase, type ShowcasePost } from '../../showcase/client';
import { btn, modal, spriteCanvas, toast } from '../dom';
import { openItem } from './inspect';

/** Badge with pattern index, visibility and rare colour. */
export function damascusBadge(item: Item): HTMLElement | null {
  const d = item.surface.damascus;
  if (!d) return null;
  const rc = rareColor(d.color);
  return el('span', { class: `dm-badge${rc ? ' rare' : ''}`, style: rc ? `--rc:${rc.hex};--rc2:${rc.hex2 ?? rc.hex}` : undefined },
    `❖ #${d.index} · ${formatVisibility(d.visibility)}${rc ? ` · ${rc.name}` : ''}`);
}

/** "Show at market" / "Withdraw" button for an owned piece's inspection page. */
export function showcaseButtons(app: App, item: Item): HTMLButtonElement[] {
  const b = btn('', () => (item.showcase ? withdraw() : confirmPost()));
  const label = () => { b.textContent = item.showcase ? 'Withdraw from showcase' : 'Show at market…'; };
  label();

  function confirmPost() {
    const s = app.state;
    const m = modal('Show at the market?', { cls: 'narrow' });
    m.body.append(
      el('div', { class: 'row', style: { alignItems: 'flex-start' } },
        spriteCanvas(item, 80, 140),
        el('div', { style: { flex: '1' } },
          el('p', {}, 'Your piece goes into the online market showcase, where other players can admire it.'),
          el('p', { class: 'small' }, 'Everyone will see: the piece itself, its name ', el('b', {}, `“${displayName(item)}”`), ', your name ', el('b', {}, s.playerName), ' and your workshop ', el('b', {}, s.workshopName), '.'),
          el('p', { class: 'small muted' }, 'Your crafting notes stay private. You can withdraw it at any time; pieces leave the showcase on their own after 90 days.'),
          damascusBadge(item),
        )),
    );
    const go = btn('Show it', async () => {
      go.disabled = true;
      go.textContent = 'Carrying it to market…';
      const r = await postToShowcase(item, { player: s.playerName, workshop: s.workshopName });
      if (!r.ok) {
        toast(r.error);
        go.disabled = false;
        go.textContent = 'Show it';
        return;
      }
      item.showcase = { id: r.data.id, token: r.data.token, at: r.data.at };
      app.save();
      audio.sfx('chime');
      toast(`“${displayName(item)}” is on show at the market.`);
      label();
      m.close();
    }, 'primary');
    m.foot.append(btn('Not now', () => m.close(), 'ghost'), go);
  }

  async function withdraw() {
    b.disabled = true;
    const r = await withdrawFromShowcase(item);
    b.disabled = false;
    if (!r.ok && r.status !== 403) return toast(r.error);
    delete item.showcase;
    app.save();
    toast(r.ok ? 'Withdrawn from the showcase.' : 'That showcase entry could not be withdrawn, so it has been forgotten here.');
    label();
  }

  return [b];
}

/** The Showcase tab in the village: everyone's pieces, recent or rarest. */
export function showcaseTab(app: App, body: HTMLElement) {
  let sort: 'recent' | 'rarest' = 'recent';
  let offset = 0;
  const PAGE = 12;
  const mine = new Set(app.state.items.filter((i) => i.showcase).map((i) => i.showcase!.id));
  const toggles = el('div', { class: 'row' });
  const grid = el('div', { class: 'showcase-grid', 'data-testid': 'showcase-grid' });
  const status = el('p', { class: 'muted small' });
  const more = btn('Show more', () => load(false), 'ghost small');
  more.style.display = 'none';

  const setSort = (v: typeof sort) => {
    sort = v;
    toggles.querySelectorAll('button').forEach((x) => x.classList.toggle('primary', (x as HTMLElement).dataset.v === v));
    load(true);
  };
  for (const [v, l] of [['recent', 'Newest'], ['rarest', 'Rarest']] as const) {
    const t = btn(l, () => setSort(v), 'small');
    t.dataset.v = v;
    toggles.append(t);
  }
  body.append(
    el('p', { class: 'muted' }, 'Smiths from every village bring their proudest work here. Show your own from any piece\'s inspection page.'),
    toggles, status, grid, more,
  );

  async function load(reset: boolean) {
    if (reset) { offset = 0; grid.innerHTML = ''; }
    status.textContent = 'Walking over to the showcase…';
    more.style.display = 'none';
    const want = sort;
    const r = await listShowcase(sort, offset, PAGE);
    if (want !== sort) return;
    if (!r.ok) { status.textContent = r.error; return; }
    const { posts, total } = r.data;
    offset += PAGE;
    for (const p of posts) grid.append(card(p));
    status.textContent = total ? `${total} piece${total === 1 ? '' : 's'} on show.` : 'Nothing on show yet — be the first!';
    more.style.display = offset < total ? '' : 'none';
  }

  function card(p: ShowcasePost): HTMLElement {
    const it = p.item;
    const when = p.at ? new Date(p.at).toLocaleDateString() : '';
    const byline = `Shown by ${p.author.player} of ${p.author.workshop}${when ? ` · ${when}` : ''}`;
    return el('div', { class: 'card click showcase-card', role: 'button', tabindex: '0', onclick: () => openItem(app, it, { readOnly: true, byline }), onkeydown: (e: KeyboardEvent) => { if (e.key === 'Enter') openItem(app, it, { readOnly: true, byline }); } },
      spriteCanvas(it, 120, 150),
      el('b', {}, displayName(it)),
      el('div', { class: 'who' }, `${p.author.player} · ${p.author.workshop}`),
      el('div', { class: 'row', style: { justifyContent: 'center' } },
        el('span', { class: 'tag' }, it.stats?.grade ?? ''),
        mine.has(p.id) ? el('span', { class: 'tag good' }, 'Yours') : null),
      damascusBadge(it),
    );
  }

  setSort('recent');
}
