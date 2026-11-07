import type { App } from '../../app';
import { el } from '../../core/util';
import { ALL_MATERIALS, masteryLevel, MASTERY_XP } from '../../data/materials';
import { modal } from '../dom';

export function openInventory(app: App) {
  const s = app.state;
  const m = modal('Material Storage');
  const groups: [string, string[]][] = [['Metals & crystal', ['metal', 'crystal']], ['Grips & woods', ['wood', 'leather', 'bone']], ['Gems', ['gem']], ['Stones', ['stone']]];
  const total = Object.values(s.materials).reduce((a, b) => a + b, 0);
  m.body.append(el('p', { class: 'muted' }, `${total} units in storage. Materials are only ever used when you begin a piece — set a piece aside or abandon it and nothing is lost.`));
  for (const [title, kinds] of groups) {
    m.body.append(el('h3', {}, title));
    const grid = el('div', { class: 'grid auto-grid' });
    for (const mt of ALL_MATERIALS.filter((x) => kinds.includes(x.kind))) {
      const n = s.materials[mt.id] ?? 0;
      const xp = s.mastery[mt.id] ?? 0;
      const lvl = masteryLevel(xp);
      grid.append(el('div', { class: 'card', style: { opacity: n ? '1' : '0.6' }, title: mt.description },
        el('div', { class: 'row' }, el('div', { class: 'matswatch', style: { background: `linear-gradient(135deg, ${mt.palette[4]}, ${mt.palette[2]} 60%, ${mt.palette[1]})` } }), el('b', {}, mt.name), el('span', { style: { marginLeft: 'auto', fontSize: '1.2em' } }, `×${n}`)),
        el('div', { class: 'small muted' }, `${'★'.repeat(mt.rarity)} · ${mt.value}g each`),
        el('div', { class: 'small' }, mt.source),
        (mt.kind === 'metal' || mt.kind === 'crystal') ? el('div', { class: 'small' }, `Mastery ${lvl}${lvl < 5 ? ` (${Math.round(xp * 10) / 10}/${MASTERY_XP[lvl + 1]} xp)` : ' — complete'}`) : null,
      ));
    }
    m.body.append(grid);
  }
}
