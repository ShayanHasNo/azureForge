// The "Damascus certificate": pattern index, visibility and any rare colour.

import { el } from '../core/util';
import { FAMILY_INFO, formatVisibility, patternSpec, rareColor, visibilityBand } from '../item/damascus';
import type { Item } from '../item/types';
import { damascusSwatch } from '../render/damascusSwatch';

export function damascusCard(item: Item): HTMLElement | null {
  const d = item.surface.damascus;
  if (!d) return null;
  const spec = patternSpec(d.index);
  const rc = rareColor(d.color);
  const band = visibilityBand(d.visibility);
  const card = el('div', { class: `card damascus-card${rc ? ' rare' : ''}`, 'data-testid': 'damascus-card' },
    el('div', { class: 'row between' },
      el('b', { class: 'dm-index' }, `Pattern #${d.index}`),
      el('span', { class: 'tag' }, FAMILY_INFO[spec.family].name),
      spec.name ? el('span', { class: 'tag gold' }, `“${spec.name}”`) : null,
    ),
    damascusSwatch({ index: d.index, visibility: d.visibility, color: d.color, primary: item.materials.primary, secondary: item.materials.secondary, w: 120, h: 18, scale: 3 }),
    el('div', { class: 'dm-meter', title: 'Pattern visibility' }, el('i', { style: { width: `${d.visibility * 100}%` } })),
    el('div', { class: 'row between small' },
      el('span', {}, 'Visibility ', el('b', {}, formatVisibility(d.visibility)), ` · ${band}`),
      el('span', { class: 'muted' }, `Forge ${Math.round(d.forge * 100)}% · ${d.layers} layers`),
    ),
    rc
      ? el('div', { class: 'dm-rare', style: `--rc:${rc.hex};--rc2:${rc.hex2 ?? rc.hex}` }, el('b', {}, `✦ ${rc.name}`), ' — ', rc.blurb)
      : null,
    el('p', { class: 'small muted', style: { margin: '4px 0 0' } }, FAMILY_INFO[spec.family].blurb),
  );
  return card;
}
