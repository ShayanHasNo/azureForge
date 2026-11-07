import './ui/style.css';
import { inject } from '@vercel/analytics';
import { App } from './app';
import { audio } from './audio/audio';
import { el } from './core/util';
import { hasSave, loadGame, saveGame } from './game/save';
import { addMaterial, GameState, newGame } from './game/state';
import { startNewDay } from './game/progress';
import { btn, modal } from './ui/dom';
import { npc } from './village/npcs';
import { portrait } from './ui/portrait';

function unlockAudio() {
  const go = () => { audio.unlock(); };
  window.addEventListener('pointerdown', go, { once: false });
  window.addEventListener('keydown', go, { once: false });
}

function start(state: GameState, fresh: boolean) {
  const app = new App(state);
  (window as any).__app = app; // handy for debugging & automated tests
  app.mountWorkshop();
  if (fresh) {
    const msgs = startNewDay(state);
    app.refresh();
    const h = npc('hollis');
    const m = modal('Welcome home', { cls: 'narrow' });
    m.body.append(
      el('div', { class: 'dialog' }, portrait(h, 'happy'), el('div', { class: 'speech' },
        el('p', {}, `“There you are! Your grandmother left you the forge, the anvil, and — well, the cat. I've stocked your shelves with a little iron, brass and copper to get you started.”`),
        el('p', {}, '“Walk to the forge and light it. Take your time — there\'s no rush in this village.”'))),
      el('p', { class: 'small muted' }, 'Tip: every piece is made through several hands-on stages. How well you work each one shapes the finished item — its look, its statistics and its story.'),
    );
    m.foot.append(btn('Light the forge', () => m.close(), 'primary'));
    void msgs;
  }
}

function title() {
  const root = document.getElementById('app')!;
  const saved = hasSave() ? loadGame() : null;
  const name = el('input', { type: 'text', value: 'Ash', maxlength: 20, 'aria-label': 'Your name' }) as HTMLInputElement;
  const shop = el('input', { type: 'text', value: 'The Quiet Forge', maxlength: 28, 'aria-label': 'Workshop name' }) as HTMLInputElement;
  const screen = el('div', { class: 'title-screen' },
    el('h1', {}, 'The Quiet Forge'),
    el('p', { class: 'sub' }, 'A cozy blacksmithing game about making things by hand. Every piece is unique, every stage matters, and your own skill shapes what you make.'),
    saved ? el('div', { class: 'box' }, el('b', {}, `Continue — ${saved.workshopName}`), el('span', { class: 'small' }, `Day ${saved.day} · ${saved.items.length} pieces made · ◉ ${saved.gold}`), btn('Continue', () => { screen.remove(); start(saved, false); }, 'primary')) : null,
    el('div', { class: 'box' }, el('b', {}, saved ? 'Or begin again' : 'Begin'), el('label', { class: 'small' }, 'Your name'), name, el('label', { class: 'small' }, 'Workshop name'), shop,
      btn(saved ? 'New game (replaces save)' : 'Open the workshop', () => {
        const s = newGame(name.value.trim() || 'Smith', shop.value.trim() || 'The Quiet Forge');
        saveGame(s);
        screen.remove();
        start(s, true);
      }, saved ? '' : 'primary')),
    el('p', { class: 'small', style: { opacity: '0.6' } }, 'Mouse, keyboard and touch supported · Sound is synthesised live — click to enable audio'),
  );
  root.append(screen);
}

inject();
unlockAudio();
title();
void addMaterial;
