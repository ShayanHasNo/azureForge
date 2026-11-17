// Small DOM helpers shared by all screens.

import { isLegacy } from '../item/types';
import { el, isTouch } from '../core/util';
import { displayName } from '../item/factory';
import type { Item, ItemStats } from '../item/types';
import { renderItem, View } from '../render/itemRenderer';
import { downscaled, PixelImage, toCanvas } from '../render/pixel';
import { STAT_LABELS } from '../item/stats';

export { el };

let overlayStack: { root: HTMLElement; onClose?: () => void }[] = [];
let toastRoot: HTMLElement | null = null;
let clickSound: (() => void) | null = null;

export function setClickSound(f: () => void) {
  clickSound = f;
}
export function sfxClick() {
  clickSound?.();
}

export function btn(label: string, onClick: () => void, cls = '', attrs: Record<string, any> = {}): HTMLButtonElement {
  return el('button', { class: `btn ${cls}`, type: 'button', ...attrs, onclick: () => { sfxClick(); onClick(); } }, label);
}

export interface Modal { overlay: HTMLElement; panel: HTMLElement; head: HTMLElement; body: HTMLElement; foot: HTMLElement; close: () => void; setTitle: (t: string) => void }

export function modal(title: string, opts: { cls?: string; onClose?: () => void; closable?: boolean } = {}): Modal {
  const app = document.getElementById('app')!;
  const h2 = el('h2', {}, title);
  const closeBtn = opts.closable === false ? null : el('button', { class: 'btn small ghost', 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const head = el('div', { class: 'panel-head' }, h2, closeBtn);
  const body = el('div', { class: 'panel-body' });
  const foot = el('div', { class: 'panel-foot hidden' });
  const panel = el('div', { class: `panel ${opts.cls ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, head, body, foot);
  const overlay = el('div', { class: 'overlay' }, panel);
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay && opts.closable !== false) close(); });
  const entry = { root: overlay, onClose: opts.onClose };
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    overlay.remove();
    overlayStack = overlayStack.filter((x) => x !== entry);
    opts.onClose?.();
  }
  closeBtn?.addEventListener('click', () => { sfxClick(); close(); });
  overlayStack.push(entry);
  app.append(overlay);
  const observer = new MutationObserver(() => { if (foot.childElementCount) foot.classList.remove('hidden'); });
  observer.observe(foot, { childList: true });
  // Focus the first control for keyboard users; on touch, skip text fields so the on-screen keyboard does not pop up.
  setTimeout(() => (panel.querySelector(isTouch() ? 'button, [tabindex]' : 'button, input, [tabindex]') as HTMLElement | null)?.focus({ preventScroll: true }), 30);
  return { overlay, panel, head, body, foot, close, setTitle: (t) => (h2.textContent = t) };
}

export function closeTopModal(): boolean {
  const top = overlayStack[overlayStack.length - 1];
  if (!top) return false;
  const btn = top.root.querySelector('.panel-head .btn') as HTMLButtonElement | null;
  if (btn) btn.click();
  else return false;
  return true;
}
export function modalOpen(): boolean {
  return overlayStack.length > 0;
}
export function closeAllModals() {
  for (const m of [...overlayStack]) { m.root.remove(); m.onClose?.(); }
  overlayStack = [];
}

export function toast(text: string, ms = 4200) {
  if (!toastRoot) {
    toastRoot = el('div', { class: 'toast-root', 'aria-live': 'polite' });
    document.getElementById('app')!.append(toastRoot);
  }
  const t = el('div', { class: 'toast' }, text);
  toastRoot.append(t);
  setTimeout(() => t.remove(), ms);
}

export function tabs(container: HTMLElement, names: [string, string][], render: (id: string, body: HTMLElement) => void, initial?: string): { select: (id: string) => void } {
  const bar = el('div', { class: 'tabs', role: 'tablist' });
  const body = el('div', { class: 'panel-body' });
  let current = initial ?? names[0][0];
  const buttons = names.map(([id, label]) =>
    el('button', { class: 'tab', role: 'tab', onclick: () => { sfxClick(); select(id); } }, label),
  );
  bar.append(...buttons);
  function select(id: string) {
    current = id;
    buttons.forEach((b, i) => { b.classList.toggle('active', names[i][0] === id); b.setAttribute('aria-selected', String(names[i][0] === id)); });
    body.innerHTML = '';
    render(id, body);
  }
  container.append(bar, body);
  select(current);
  return { select };
}

/** Device pixels per CSS pixel, as a whole number (sprites are always drawn on whole device pixels). */
export function pixelRatio(): number {
  return Math.max(1, Math.min(4, Math.round(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)));
}

const fitCache = new WeakMap<PixelImage, Map<string, PixelImage>>();
/**
 * The item's sprite prepared for a box of (maxW × maxH) device pixels: an
 * integer upscale when there is room, otherwise an area-averaged reduction
 * (never a ragged nearest-neighbour shrink).
 */
export function fittedSprite(item: Item, view: View, maxW: number, maxH: number): { img: PixelImage; scale: number } {
  const full = renderItem(item, view);
  const f = Math.min(maxW / full.w, maxH / full.h);
  if (f >= 1) return { img: full, scale: Math.floor(f) };
  let m = fitCache.get(full);
  if (!m) fitCache.set(full, (m = new Map()));
  const key = f.toFixed(4);
  let small = m.get(key);
  if (!small) m.set(key, (small = downscaled(full, f)));
  return { img: small, scale: 1 };
}

/**
 * Item sprite sized to fit a (maxW × maxH) box of CSS pixels, drawn on whole
 * device pixels. With `cssSize` (default) the canvas is given its CSS size;
 * pass false where a stylesheet sizes it.
 */
export function spriteCanvas(item: Item, maxW: number, maxH: number, view: View = 'front', cssSize = true): HTMLCanvasElement {
  const dpr = pixelRatio();
  const { img, scale } = fittedSprite(item, view, maxW * dpr, maxH * dpr);
  const c = toCanvas(img, scale);
  if (cssSize) { c.style.width = `${c.width / dpr}px`; c.style.height = `${c.height / dpr}px`; }
  return c;
}

export function itemThumb(item: Item, onClick?: () => void, extra?: Node): HTMLElement {
  const c = spriteCanvas(item, 150, 150, 'front', false);
  const card = el('div', { class: `card thumb ${onClick ? 'click' : ''}`, tabindex: onClick ? '0' : undefined, role: onClick ? 'button' : undefined },
    c,
    el('div', { class: 'nm' }, (item.favorite ? '★ ' : '') + displayName(item)),
    el('div', { class: 'small muted' }, `${item.stats?.grade ?? ''} · ${item.stats?.rarityLabel ?? ''}`, isLegacy(item) ? el('span', { class: 'tag legacy', style: { marginLeft: '4px' } }, 'Legacy') : null),
    extra ?? null,
  );
  if (onClick) {
    card.addEventListener('click', () => { sfxClick(); onClick(); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
  }
  return card;
}

export function statRow(key: keyof ItemStats | string, value: number, max = 100, delta?: number, cls = ''): HTMLElement {
  const label = STAT_LABELS[key as string] ?? key;
  const shown = key === 'weight' ? `${value.toFixed(1)} kg` : key === 'value' ? `${value} g` : `${Math.round(value)}`;
  const pct = key === 'weight' ? Math.min(100, (value / 3) * 100) : Math.min(100, (value / max) * 100);
  const d = delta && Math.abs(delta) >= 1 ? el('span', { class: `delta ${delta > 0 ? 'up' : 'down'}` }, `${delta > 0 ? '+' : ''}${Math.round(delta)}`) : null;
  return el('div', { class: 'stat' }, el('span', {}, label), el('span', {}, shown, d), el('div', { class: 'bar' }, el('i', { class: cls, style: { width: `${pct}%` } })));
}

export function confirmDialog(title: string, text: string, yes: string, onYes: () => void, danger = false) {
  const m = modal(title, { cls: 'narrow' });
  m.body.append(el('p', {}, text));
  m.foot.append(btn('Cancel', () => m.close(), 'ghost'), btn(yes, () => { m.close(); onYes(); }, danger ? 'danger' : 'primary'));
}

export function fmtPct(v: number) {
  return `${Math.round(v * 100)}%`;
}
