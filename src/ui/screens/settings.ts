import type { App } from '../../app';
import { audio } from '../../audio/audio';
import { el, isTouch } from '../../core/util';
import { deleteSave, deserialize, serialize } from '../../game/save';
import { btn, confirmDialog, modal, toast } from '../dom';

export function openSettings(app: App) {
  const s = app.state.settings;
  const m = modal('Settings', { cls: 'narrow', onClose: () => app.save() });
  const slider = (label: string, key: 'master' | 'music' | 'ambient' | 'sfx') => {
    const v = el('span', { class: 'muted' }, `${Math.round(s[key] * 100)}%`);
    const i = el('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s[key], 'aria-label': label }) as HTMLInputElement;
    i.oninput = () => { s[key] = Number(i.value); v.textContent = `${Math.round(s[key] * 100)}%`; app.applySettings(); };
    i.onchange = () => audio.sfx(key === 'music' ? 'chime' : key === 'ambient' ? 'pop' : 'hammer');
    return el('div', { class: 'ctl' }, el('div', { class: 'row between' }, el('b', {}, label), v), i);
  };
  const check = (label: string, key: 'reducedMotion' | 'highContrast' | 'colorblind' | 'showDetailedStats', help?: string) => {
    const i = el('input', { type: 'checkbox' }) as HTMLInputElement;
    i.checked = s[key];
    i.onchange = () => { s[key] = i.checked; app.applySettings(); };
    return el('div', { class: 'ctl' }, el('label', { class: 'row' }, i, label), help ? el('div', { class: 'help' }, help) : null);
  };
  m.body.append(el('h3', {}, 'Sound'), slider('Master volume', 'master'), slider('Music', 'music'), slider('Ambience (fire, rain, village)', 'ambient'), slider('Crafting sounds', 'sfx'));
  m.body.append(el('h3', {}, 'Crafting'));
  const diff = el('select', { 'aria-label': 'Crafting difficulty' }) as HTMLSelectElement;
  for (const [v, n] of [['relaxed', 'Relaxed — every mechanic, very generous tolerances'], ['adaptive', 'Adaptive — scales with tradition & material (recommended)'], ['challenging', 'Challenging — tighter windows, more complexity']]) diff.append(el('option', { value: v }, n));
  diff.value = s.difficulty;
  diff.onchange = () => { s.difficulty = diff.value as any; };
  m.body.append(el('div', { class: 'ctl' }, el('b', {}, 'Minigame difficulty'), diff, el('div', { class: 'help' }, 'Your skill still decides the result in every mode; harder materials naturally ask more of you in Adaptive.')));
  m.body.append(check('Show detailed stage statistics', 'showDetailedStats'));
  m.body.append(el('h3', {}, 'Accessibility'), check('Reduce motion (fewer particles, no shake or bob)', 'reducedMotion'), check('High-contrast panels', 'highContrast'));
  const scale = el('input', { type: 'range', min: 0.85, max: 1.4, step: 0.05, value: s.uiScale, 'aria-label': 'Interface scale' }) as HTMLInputElement;
  scale.onchange = () => { s.uiScale = Number(scale.value); app.applySettings(); };
  m.body.append(el('div', { class: 'ctl' }, el('b', {}, 'Interface scale'), scale));
  const font = el('select', { 'aria-label': 'Text font' }) as HTMLSelectElement;
  for (const [v, n] of [['readable', 'Readable — clear, easy-to-read text (recommended)'], ['pixel', 'Pixel — the classic pixel-art look everywhere']]) font.append(el('option', { value: v }, n));
  font.value = s.textFont ?? 'readable';
  font.onchange = () => { s.textFont = font.value as 'readable' | 'pixel'; app.applySettings(); };
  m.body.append(el('div', { class: 'ctl' }, el('b', {}, 'Text font'), font, el('div', { class: 'help' }, 'Titles and buttons keep the pixel font either way.')));
  m.body.append(el('h3', {}, 'Save data'), el('p', { class: 'small muted' }, 'The game saves automatically after every stage, purchase and finished piece.'));
  const fileIn = el('input', { type: 'file', accept: '.json,application/json', class: 'hidden' }) as HTMLInputElement;
  fileIn.onchange = async () => {
    const f = fileIn.files?.[0];
    if (!f) return;
    try {
      const st = deserialize(await f.text());
      app.state = st;
      app.save();
      location.reload();
    } catch (e) { toast('That file is not a Quiet Forge save.'); }
  };
  m.body.append(el('div', { class: 'row' },
    btn('Save now', () => { app.save(); toast('Saved.'); }),
    btn('Export save', async () => {
      const name = `quiet-forge-day${app.state.day}.json`;
      const blob = new Blob([serialize(app.state)], { type: 'application/json' });
      // Phones: hand the file to the share sheet (Save to Files, AirDrop…), where a download link is unreliable.
      try {
        const file = new File([blob], name, { type: 'application/json' });
        const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
        if (isTouch() && nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], title: 'The Quiet Forge save' }); return; }
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return; // the player closed the share sheet
      }
      const a = el('a', { href: URL.createObjectURL(blob), download: name });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }),
    btn('Import save', () => fileIn.click()),
    btn('Delete save', () => confirmDialog('Delete everything?', 'This permanently erases your workshop and every creation in this browser. Export first if you want to keep them.', 'Delete', () => { deleteSave(); location.reload(); }, true), 'danger'),
    fileIn));
  m.body.append(el('h3', {}, 'Controls'), el('p', { class: 'small' }, 'Touch: tap the floor to walk and a station to use it; the menu along the bottom opens everything else. Every minigame can be played by touch.'), el('p', { class: 'small' }, 'Keyboard & mouse — Workshop: A/D or ←/→ to walk, E/Enter to use a station, or click/tap anything. Shortcuts: F craft · I materials · J journal · C collection · V village · U workshop · R rest · Esc settings/close.'));
  m.foot.append(btn('Done', () => m.close(), 'primary'));
}
