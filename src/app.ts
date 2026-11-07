// Application controller: owns the game state, persistence, audio and the
// workshop scene, and routes between screens.

import { audio } from './audio/audio';
import { el } from './core/util';
import { tradition } from './data/traditions';
import { saveGame } from './game/save';
import { dateLabel, displayCapacity, GameState, phaseName, seasonOf, weatherOf } from './game/state';
import { checkUnlocks, ownedItems, passTime, rest } from './game/progress';
import { closeTopModal, modalOpen, setClickSound, toast, btn } from './ui/dom';
import { WorkshopScene, StationId, WorkshopViewState } from './workshop/scene';
import { openCrafting, openNewPiece } from './ui/screens/crafting';
import { openInventory } from './ui/screens/inventory';
import { openJournal } from './ui/screens/journal';
import { openCollection } from './ui/screens/collection';
import { openVillage } from './ui/screens/village';
import { openCustomize } from './ui/screens/customize';
import { openSettings } from './ui/screens/settings';
import { palette } from './data/options';

export class App {
  root: HTMLElement;
  scene?: WorkshopScene;
  hud!: HTMLElement;
  bottom!: HTMLElement;
  crafting = false;
  private keyHandler = (e: KeyboardEvent) => this.onKey(e);

  constructor(public state: GameState) {
    this.root = document.getElementById('app')!;
    setClickSound(() => audio.sfx('click'));
    this.applySettings();
  }

  // ---------------------------------------------------------------- lifecycle
  mountWorkshop() {
    this.root.querySelectorAll('.scene, .hud, .bottombar').forEach((n) => n.remove());
    const canvas = el('canvas', { class: 'scene', 'aria-label': 'Your workshop. Use A/D or arrows to walk, E to interact, or click a station.' });
    this.hud = el('div', { class: 'hud' });
    this.bottom = el('div', { class: 'bottombar' });
    this.root.append(canvas, this.hud, this.bottom);
    this.scene = new WorkshopScene(canvas, () => this.viewState(), {
      onInteract: (s) => { if (!modalOpen() && !this.crafting) this.interact(s); },
      onStep: () => audio.sfx('step', { volume: 0.35 }),
      reducedMotion: () => this.state.settings.reducedMotion,
    });
    this.scene.start();
    this.renderHud();
    window.addEventListener('keydown', this.keyHandler);
    this.updateAmbience();
    audio.startMusic();
    const msgs = checkUnlocks(this.state);
    msgs.forEach((m) => toast(m));
    if (this.state.draft) setTimeout(() => toast('You have an unfinished piece on the anvil — visit the forge to continue it.'), 600);
    this.save();
  }

  viewState(): WorkshopViewState {
    const s = this.state;
    const owned = new Map(ownedItems(s).map((i) => [i.id, i]));
    return {
      decor: s.decor,
      extras: s.extras,
      upgrades: s.upgrades,
      displayItems: s.displayed.map((id) => owned.get(id)).filter(Boolean).slice(0, displayCapacity(s)) as any,
      phase: phaseName(s),
      weather: weatherOf(s),
      season: seasonOf(s.day),
      materialCount: Object.values(s.materials).reduce((a, b) => a + b, 0),
      bannerColor: palette(s.items[s.items.length - 1]?.design.palette ?? 'hearth').accent,
      forgeLit: true,
    };
  }

  save() {
    if (!saveGame(this.state)) toast('Could not save — your browser storage may be full or disabled.');
  }

  applySettings() {
    const st = this.state.settings;
    document.documentElement.style.setProperty('--scale', String(st.uiScale));
    document.body.classList.toggle('hc', st.highContrast);
    audio.setVolumes({ master: st.master, music: st.music, ambient: st.ambient, sfx: st.sfx });
  }

  updateAmbience() {
    const s = this.state;
    const ph = phaseName(s);
    const w = weatherOf(s);
    audio.setAmbient({ fire: this.crafting ? 0.8 : 0.55, rain: w === 'rain', wind: w === 'snow' ? 0.6 : w === 'cloudy' ? 0.35 : 0.18, village: ph === 'night' ? 0.25 : 0.4, night: ph === 'night' || ph === 'evening' });
    audio.setMusicMood(this.crafting ? 'craft' : ph === 'night' || ph === 'evening' ? 'night' : 'day');
  }

  // ---------------------------------------------------------------- HUD
  renderHud() {
    const s = this.state;
    const w = weatherOf(s);
    const wIcon = { clear: '☀', cloudy: '☁', rain: '☂', snow: '❄' }[w];
    const phIcon = { morning: '🌅', afternoon: '🌞', evening: '🌇', night: '🌙' }[phaseName(s)];
    this.hud.innerHTML = '';
    this.hud.append(
      el('div', { class: 'chip', title: s.workshopName }, el('b', {}, s.workshopName)),
      el('div', { class: 'chip' }, `${dateLabel(s)}`),
      el('div', { class: 'chip', title: 'Time of day & weather' }, `${phIcon} ${phaseName(s)} · ${wIcon} ${w}`),
      el('div', { class: 'chip', title: 'Gold' }, '◉ ', el('b', {}, String(s.gold))),
      el('div', { class: 'chip', title: 'Reputation' }, '✦ ', el('b', {}, String(s.reputation))),
      el('div', { class: 'spacer' }),
      el('div', { class: 'menu' },
        btn('Craft', () => this.interact('forge'), 'primary', { title: 'Begin a new piece (F)' }),
        btn('Materials', () => openInventory(this), '', { title: 'Inventory (I)' }),
        btn('Journal', () => openJournal(this), '', { title: 'Journal (J)' }),
        btn('Collection', () => openCollection(this), '', { title: 'Collection (C)' }),
        btn('Village', () => openVillage(this), '', { title: 'Village (V)' }),
        btn('Workshop', () => openCustomize(this), '', { title: 'Customise & upgrade (U)' }),
        btn('Rest', () => this.rest(), 'ghost', { title: 'Sleep until morning (R)' }),
        btn('⚙', () => openSettings(this), 'ghost iconbtn', { title: 'Settings (Esc)', 'aria-label': 'Settings' }),
      ),
    );
    const last = s.log[0]?.text ?? '';
    this.bottom.textContent = last ? `“${last}”` : 'Walk with A/D or ←/→ · E to use a station · or click anything.';
  }

  refresh() {
    this.renderHud();
    this.updateAmbience();
    this.save();
  }

  // ---------------------------------------------------------------- actions
  interact(s: StationId) {
    audio.sfx('click');
    switch (s) {
      case 'forge':
      case 'anvil':
        if (this.state.draft) openCrafting(this, null);
        else openNewPiece(this);
        break;
      case 'workbench': openCustomize(this, 'tools'); break;
      case 'storage': openInventory(this); break;
      case 'finishing': openCollection(this); break;
      case 'journal': audio.sfx('page'); openJournal(this); break;
      case 'display': openCustomize(this, 'display'); break;
      case 'door': audio.sfx('door'); openVillage(this); break;
      case 'gallery': openCollection(this, 'gallery'); break;
    }
  }

  /** Spend one phase of time (crafting, exploring). */
  spendTime() {
    const msgs = passTime(this.state);
    msgs.forEach((m) => toast(m));
    this.refresh();
  }

  rest() {
    const msgs = rest(this.state);
    toast(`A new day: ${dateLabel(this.state)}.`);
    msgs.forEach((m) => toast(m));
    this.refresh();
  }

  setCrafting(on: boolean) {
    this.crafting = on;
    this.scene?.setInputEnabled(!on);
    this.updateAmbience();
  }

  traditionName(id: string) {
    return tradition(id).name;
  }

  private onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') {
      if (closeTopModal()) return;
      if (!this.crafting) openSettings(this);
      return;
    }
    if (this.crafting || modalOpen()) return;
    const map: Record<string, () => void> = {
      KeyI: () => openInventory(this), KeyJ: () => openJournal(this), KeyC: () => openCollection(this), KeyV: () => openVillage(this),
      KeyU: () => openCustomize(this), KeyR: () => this.rest(), KeyF: () => this.interact('forge'),
    };
    const f = map[e.code];
    if (f) { e.preventDefault(); f(); }
  }
}
