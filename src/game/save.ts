// Save/load to localStorage with a versioned envelope, a rolling backup and
// JSON export/import so finished creations are never lost.

import { DEFAULT_SETTINGS, GameState, newGame } from './state';

const KEY = 'quietforge.save.v1';
const BACKUP = 'quietforge.save.v1.backup';

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function serialize(s: GameState): string {
  return JSON.stringify({ format: 'quietforge', savedAt: Date.now(), state: s });
}

export function deserialize(json: string): GameState {
  const env = JSON.parse(json);
  const raw = env && env.format === 'quietforge' ? env.state : env;
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) throw new Error('Not a Quiet Forge save');
  return migrate(raw);
}

/** Fill in any fields missing from older saves. */
export function migrate(raw: any): GameState {
  const base = newGame(raw.playerName ?? 'Smith', raw.workshopName ?? 'The Quiet Forge');
  const s: GameState = { ...base, ...raw };
  s.settings = { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) };
  s.stats = { ...base.stats, ...(raw.stats ?? {}) };
  s.decor = { ...base.decor, ...(raw.decor ?? {}) };
  for (const k of ['materials', 'mastery', 'relationships', 'locationVisits', 'merchantSales', 'seen'] as const) (s as any)[k] = { ...(raw[k] ?? {}) };
  for (const k of ['items', 'traditions', 'journals', 'upgrades', 'ownedDecor', 'extras', 'ownedExtras', 'displayed', 'gallery', 'requests', 'completedRequests', 'locations', 'combos', 'challenges', 'log'] as const)
    (s as any)[k] = Array.isArray(raw[k]) ? raw[k] : (base as any)[k];
  if (!s.traditions.includes('foundry')) s.traditions.unshift('foundry');
  return s;
}

export function saveGame(s: GameState): boolean {
  const st = storage();
  if (!st) return false;
  try {
    const prev = st.getItem(KEY);
    if (prev) st.setItem(BACKUP, prev);
    st.setItem(KEY, serialize(s));
    return true;
  } catch (e) {
    console.warn('Save failed', e);
    return false;
  }
}

export function loadGame(): GameState | null {
  const st = storage();
  if (!st) return null;
  for (const k of [KEY, BACKUP]) {
    const v = st.getItem(k);
    if (!v) continue;
    try {
      return deserialize(v);
    } catch (e) {
      console.warn('Corrupt save in', k, e);
    }
  }
  return null;
}

export function hasSave(): boolean {
  return !!storage()?.getItem(KEY);
}

export function deleteSave() {
  const st = storage();
  st?.removeItem(KEY);
  st?.removeItem(BACKUP);
}
