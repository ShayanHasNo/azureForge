// The crafting journal: discovered materials and their properties, pairings,
// mastery unlocks, traditions, places, historical journals, challenges and log.

import type { App } from '../../app';
import { el } from '../../core/util';
import { compatibility, mat, masteryLevel, METALS } from '../../data/materials';
import { ALL_OPTION_LISTS } from '../../data/options';
import { TRADITIONS, STAGE_INFO } from '../../data/traditions';
import { CHALLENGES, COMBOS, traditionUnlockable } from '../../game/progress';
import { dateLabel } from '../../game/state';
import { JOURNALS, LOCATIONS } from '../../village/world';
import { modal, tabs } from '../dom';

export function openJournal(app: App, initial?: string) {
  const s = app.state;
  const m = modal('Crafting Journal');
  m.body.style.padding = '0';
  tabs(m.body, [['materials', 'Materials'], ['pairings', 'Pairings'], ['traditions', 'Traditions'], ['places', 'Places'], ['journals', 'Old journals'], ['challenges', 'Challenges'], ['log', 'Diary']], (id, body) => {
    if (id === 'materials') {
      body.append(el('p', { class: 'muted' }, 'Every metal has strengths and weaknesses — none is best at everything. Mastery comes from working a material, and unlocks new creative options (never raw power).'));
      const grid = el('div', { class: 'grid cols-2' });
      for (const mt of METALS) {
        const known = (s.materials[mt.id] ?? 0) > 0 || (s.mastery[mt.id] ?? 0) > 0 || s.items.some((i) => i.materials.primary === mt.id || i.materials.secondary === mt.id);
        const lvl = masteryLevel(s.mastery[mt.id] ?? 0);
        const p = mt.props;
        grid.append(el('div', { class: 'card' },
          el('div', { class: 'row' }, el('div', { class: 'matswatch', style: { background: known ? `linear-gradient(135deg, ${mt.palette[4]}, ${mt.palette[2]} 60%, ${mt.palette[1]})` : '#7a6a5a' } }), el('b', {}, known ? mt.name : '??? (undiscovered)'), el('span', { class: 'small muted', style: { marginLeft: 'auto' } }, `mastery ${lvl}`)),
          el('p', { class: 'small' }, known ? mt.description : `Where to find it: ${mt.source}`),
          known ? el('p', { class: 'small muted' }, `Hardness ${p.hardness} · Toughness ${p.toughness} · Flex ${p.flexibility} · Weight ${p.density} · Workability ${p.workability} · Decorative ${p.decorative} · Magic ${p.magic} · Luster ${p.luster}`) : null,
          known ? el('p', { class: 'small' }, `Source: ${mt.source}`) : null,
          el('div', { class: 'small' }, 'Mastery unlocks: ', ...(mt.mastery ?? []).map((u) => {
            const name = Object.values(ALL_OPTION_LISTS).flat().find((o) => o.id === u.id)?.name ?? u.id;
            return el('span', { class: `tag ${lvl >= u.level ? 'good' : ''}` }, `${lvl >= u.level ? '' : '🔒'}L${u.level} ${name}`);
          })),
        ));
      }
      body.append(grid);
    }
    if (id === 'pairings') {
      body.append(el('p', { class: 'muted' }, 'Pairings you have tried (primary & secondary). Compatibility affects structural integrity and artistic cohesion; clashing pairs are daring and add uniqueness.'));
      if (!s.combos.length) body.append(el('p', {}, 'No pairings recorded yet.'));
      for (const k of s.combos) {
        const [a, b] = k.split('+');
        const c = compatibility(a, b);
        body.append(el('div', { class: 'card', style: { marginBottom: '5px' } }, el('b', {}, `${mat(a).name} & ${mat(b).name}`), COMBOS[k] ? el('span', { class: 'tag gold', style: { marginLeft: '6px' } }, `“${COMBOS[k]}”`) : null, el('span', { class: 'small muted', style: { marginLeft: '8px' } }, `compatibility ${Math.round(c * 100)}%`)));
      }
      const hidden = Object.keys(COMBOS).filter((k) => !s.combos.includes(k)).length;
      body.append(el('p', { class: 'small muted' }, `${hidden} storied pairings remain undiscovered. Hint: metals that share a character tend to harmonise — moon with star, river with silver, forge with iron…`));
    }
    if (id === 'traditions') {
      for (const t of TRADITIONS) {
        const ok = s.traditions.includes(t.id) || traditionUnlockable(t, s);
        body.append(el('div', { class: 'card', style: { borderLeft: `5px solid ${t.color}`, marginBottom: '6px' } },
          el('b', {}, `${ok ? '' : '🔒 '}${t.name}`), el('p', { class: 'small' }, t.philosophy),
          el('p', { class: 'small muted' }, ok ? `Stages: ${t.stages.map((x) => STAGE_INFO[x].name).join(' → ')}` : t.unlock.hint),
          el('p', { class: 'small muted' }, `Primary materials: ${t.primaries.map((p) => mat(p).name).join(', ')}`)));
      }
    }
    if (id === 'places') {
      for (const l of LOCATIONS) {
        const known = s.locations.includes(l.id);
        body.append(el('div', { class: 'card', style: { marginBottom: '6px' } }, el('b', {}, known ? l.name : '🔒 Unknown place'), el('p', { class: 'small' }, known ? `${l.blurb} Reliable finds: ${l.yields}` : l.discover.hint), known ? el('p', { class: 'small muted' }, `Visited ${s.locationVisits[l.id] ?? 0} times.`) : null));
      }
    }
    if (id === 'journals') {
      for (const [jid, j] of Object.entries(JOURNALS)) {
        const has = s.journals.includes(jid);
        body.append(el('div', { class: 'card', style: { marginBottom: '6px' } }, el('b', {}, has ? j.title : '🔒 A missing journal'), has ? el('p', { style: { fontStyle: 'italic' } }, `“${j.text}”`) : el('p', { class: 'small muted' }, 'Somewhere out there — perhaps where an old tinkerer once worked.'), has ? el('p', { class: 'small' }, j.unlocks) : null));
      }
    }
    if (id === 'challenges') {
      body.append(el('p', { class: 'muted' }, 'Mastery challenges — reasons to return to every material.'));
      for (const c of CHALLENGES) {
        const done = s.challenges.includes(c.id);
        body.append(el('div', { class: 'card row between', style: { marginBottom: '5px' } }, el('div', {}, el('b', {}, `${done ? '✓ ' : ''}${c.name}`), el('div', { class: 'small' }, c.desc)), el('span', { class: 'small muted' }, `+${c.rep} rep, +${c.gold}g`)));
      }
    }
    if (id === 'log') {
      body.append(el('p', { class: 'muted' }, dateLabel(s)));
      for (const e of s.log) body.append(el('p', { class: 'small' }, el('b', {}, `Day ${e.day}: `), e.text));
    }
  }, initial);
}
