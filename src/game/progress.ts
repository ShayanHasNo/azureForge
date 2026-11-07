// Progression: option availability, unlocks, mastery, reputation, requests,
// selling and gifting. Progression expands possibilities — it never inflates stats.

import { compatibility, hasMat, mat, masteryLevel, METALS } from '../data/materials';
import type { OptionDef } from '../data/options';
import { TRADITIONS, tradition, TraditionDef } from '../data/traditions';
import { UPGRADES } from '../data/workshop';
import { displayName } from '../item/factory';
import type { Item } from '../item/types';
import { evaluateFor, npc, Reaction } from '../village/npcs';
import { evaluateRequest, Fulfilment, nextRequest, template } from '../village/requests';
import { JOURNALS, LOCATIONS } from '../village/world';
import { addLog, addMaterial, addRel, advancePhase, GameState, relLevel } from './state';

// ---------------------------------------------------------------- options
export interface Availability { ok: boolean; reason?: string }

export function optionAvailable(opt: OptionDef, s: GameState, traditionId: string, category: string): Availability {
  const g = opt.gate;
  if (!g) return { ok: true };
  if (g.categories && !g.categories.includes(category)) return { ok: false, reason: 'Not for this kind of piece.' };
  const anyGate = g.traditions || g.upgrade || g.journal || g.mastery;
  if (!anyGate) return { ok: true };
  if (g.traditions?.includes(traditionId)) return { ok: true };
  if (g.upgrade && s.upgrades.includes(g.upgrade)) return { ok: true };
  if (g.journal && s.journals.includes(g.journal)) return { ok: true };
  if (g.mastery && masteryLevel(s.mastery[g.mastery.material] ?? 0) >= g.mastery.level) return { ok: true };
  const why: string[] = [];
  if (g.traditions) why.push(g.traditions.map((t) => tradition(t).name).join(' / '));
  if (g.upgrade) why.push(UPGRADES.find((u) => u.id === g.upgrade)?.name ?? g.upgrade);
  if (g.journal) why.push(JOURNALS[g.journal]?.title ?? g.journal);
  if (g.mastery) why.push(`${mat(g.mastery.material).name} mastery ${g.mastery.level}`);
  return { ok: false, reason: `Requires ${why.join(' or ')}` };
}

// ---------------------------------------------------------------- traditions & discovery
export function traditionUnlockable(t: TraditionDef, s: GameState): boolean {
  const u = t.unlock;
  if (u.start) return true;
  if (u.reputation !== undefined && s.reputation >= u.reputation) return true;
  if (u.friend && relLevel(s, u.friend.npc) >= u.friend.level) return true;
  if (u.journal && s.journals.includes(u.journal)) return true;
  return false;
}

/** Check for newly unlocked traditions/locations; returns messages for the player. */
export function checkUnlocks(s: GameState): string[] {
  const msgs: string[] = [];
  for (const t of TRADITIONS) {
    if (!s.traditions.includes(t.id) && traditionUnlockable(t, s)) {
      s.traditions.push(t.id);
      msgs.push(`New tradition: ${t.name}. ${t.blurb}`);
      addLog(s, `You learned the ways of ${t.name}.`);
    }
  }
  for (const l of LOCATIONS) {
    if (!s.locations.includes(l.id) && l.discover.check(s)) {
      s.locations.push(l.id);
      msgs.push(`New place to explore: ${l.name}.`);
      addLog(s, `You heard about ${l.name}.`);
    }
  }
  if (!s.upgrades.includes('smallanvil') && !s.seen.dagger_hint && s.stats.crafted >= 1) {
    s.seen.dagger_hint = true;
    msgs.push('Hollis mentions a horned bench anvil in the workbench catalogue — perfect for daggers.');
  }
  return msgs;
}

// ---------------------------------------------------------------- crafting outcomes
export const COMBOS: Record<string, string> = {
  'brass+copper': 'Rosegilt', 'iron+bronze': 'Old Road', 'silver+moonstone': 'Night Silver', 'silver+starmetal': 'Skyglass', 'dragonsteel+iron': 'Forgeheart',
  'gardenglass+copper': 'Verdant Bloom', 'azuresteel+silver': 'Riverlight', 'moonstone+starmetal': 'Twilight', 'brass+silver': 'Chapel Gilt', 'bronze+dragonsteel': 'Barrowfire',
};
export function comboKey(a: string, b: string) {
  return [a, b].sort().join('+');
}
export function comboName(a: string, b: string): string | undefined {
  return COMBOS[comboKey(a, b)];
}

export interface CompletionReport { messages: string[]; masteryUps: { material: string; level: number }[] }

export function recordCompletedItem(s: GameState, item: Item): CompletionReport {
  const messages: string[] = [];
  const masteryUps: CompletionReport['masteryUps'] = [];
  s.items.push(item);
  s.stats.crafted++;
  const craft = item.stats?.craftsmanship ?? 50;
  const xpFor = (id: string, amt: number) => {
    if (!hasMat(id) || mat(id).kind !== 'metal' && mat(id).kind !== 'crystal') return;
    const before = masteryLevel(s.mastery[id] ?? 0);
    s.mastery[id] = (s.mastery[id] ?? 0) + amt;
    const after = masteryLevel(s.mastery[id]);
    if (after > before) masteryUps.push({ material: id, level: after });
  };
  // Mastery grows with practice; well-made pieces teach a little more.
  xpFor(item.materials.primary, 1 + (craft >= 75 ? 0.5 : 0));
  if (item.materials.secondary !== item.materials.primary) xpFor(item.materials.secondary, 0.34);
  if (item.materials.fusedWith) xpFor(item.materials.fusedWith, 0.5);
  for (const u of masteryUps) {
    const unl = mat(u.material).mastery?.filter((m) => m.level === u.level) ?? [];
    messages.push(`${mat(u.material).name} mastery ${u.level}!${unl.length ? ' New options: ' + unl.map((x) => `${x.id} (${x.kind})`).join(', ') + '.' : ''}`);
  }
  const key = comboKey(item.materials.primary, item.materials.secondary);
  if (item.materials.primary !== item.materials.secondary && !s.combos.includes(key)) {
    s.combos.push(key);
    const name = COMBOS[key];
    const c = compatibility(item.materials.primary, item.materials.secondary);
    messages.push(name ? `Discovered a storied pairing: “${name}” (${key.replace('+', ' & ')}).` : `New pairing recorded in your journal: ${key.replace('+', ' & ')} — compatibility ${Math.round(c * 100)}%.`);
  }
  // Small reputation for fine work: word gets around.
  if (craft >= 74) { s.reputation += 1; messages.push('Word of your fine work spreads (+1 reputation).'); }
  for (const ch of CHALLENGES) {
    if (s.challenges.includes(ch.id)) continue;
    if (ch.check(item, s)) {
      s.challenges.push(ch.id);
      s.reputation += ch.rep;
      s.gold += ch.gold;
      messages.push(`Challenge complete: ${ch.name}! +${ch.rep} reputation, +${ch.gold} gold.`);
      addLog(s, `Completed the challenge “${ch.name}”.`);
    }
  }
  addLog(s, `You finished “${displayName(item)}” — ${item.stats?.grade ?? ''} ${item.category} of ${mat(item.materials.primary).name.toLowerCase()}.`);
  messages.push(...checkUnlocks(s));
  return { messages, masteryUps };
}

// ---------------------------------------------------------------- challenges
export interface Challenge { id: string; name: string; desc: string; rep: number; gold: number; check: (i: Item, s: GameState) => boolean }
const COMMON = ['iron', 'brass', 'copper', 'bronze'];
const c = (i: Item) => i.stats?.craftsmanship ?? 0;
export const CHALLENGES: Challenge[] = [
  { id: 'first', name: 'First Light', desc: 'Finish your first piece.', rep: 1, gold: 10, check: () => true },
  { id: 'fine_iron', name: 'Honest Iron', desc: 'Make a Fine (60+) piece of iron.', rep: 2, gold: 20, check: (i) => i.materials.primary === 'iron' && c(i) >= 60 },
  { id: 'brass_master', name: 'The Brass Masterpiece', desc: 'Make a Masterwork (85+) piece of brass.', rep: 5, gold: 80, check: (i) => i.materials.primary === 'brass' && c(i) >= 85 },
  { id: 'common_ground', name: 'Common Ground', desc: 'After owning dragonsteel or star-metal, make a Superior (74+) piece from a common metal.', rep: 4, gold: 50, check: (i, s) => COMMON.includes(i.materials.primary) && c(i) >= 74 && s.items.some((x) => ['dragonsteel', 'starmetal'].includes(x.materials.primary)) },
  { id: 'flawless', name: 'Not a Mark', desc: 'Finish a piece with no remaining flaws.', rep: 2, gold: 25, check: (i) => i.blemishes.length === 0 },
  { id: 'handmade', name: 'Marks of the Hand', desc: 'Finish a piece with five or more handmade flaws — and love it anyway.', rep: 1, gold: 15, check: (i) => i.blemishes.length >= 5 },
  { id: 'asym', name: 'The Crooked Path', desc: 'Make a deliberately asymmetric piece (asymmetry 50%+).', rep: 2, gold: 20, check: (i) => (i.blade?.asymmetry ?? 0) >= 0.5 },
  { id: 'six_metals', name: 'Many Fires', desc: 'Make pieces from six different primary metals.', rep: 4, gold: 60, check: (_i, s) => new Set(s.items.map((x) => x.materials.primary)).size >= 6 },
  { id: 'traditions3', name: 'Three Schools', desc: 'Finish pieces in three different traditions.', rep: 4, gold: 60, check: (_i, s) => new Set(s.items.map((x) => x.tradition)).size >= 3 },
  { id: 'legend', name: 'Legend of the Quiet Forge', desc: 'Make a Legendary (93+) piece.', rep: 8, gold: 150, check: (i) => c(i) >= 93 },
  { id: 'singular', name: 'Singular', desc: 'Make a piece of Singular rarity.', rep: 4, gold: 50, check: (i) => i.stats?.rarityLabel === 'Singular' },
];

// ---------------------------------------------------------------- days & requests
export function startNewDay(s: GameState): string[] {
  const msgs: string[] = [];
  // Expire nothing — requests wait patiently. Post a new one every other day, up to 3.
  if (s.requests.length < 3 && (s.day % 2 === 1 || s.requests.length === 0)) {
    const t = nextRequest(s.worldSeed, s.day, s.reputation, s.upgrades, s.requests.map((r) => r.template), s.completedRequests);
    if (t) {
      s.requests.push({ id: `${t.id}_${s.day}`, template: t.id, npc: t.npc, postedDay: s.day });
      msgs.push(`${npc(t.npc).name} pinned a new request to the notice board.`);
    }
  }
  msgs.push(...checkUnlocks(s));
  return msgs;
}

export function rest(s: GameState): string[] {
  do advancePhase(s);
  while (s.phase !== 0);
  addLog(s, 'You bank the forge and sleep soundly.');
  return startNewDay(s);
}

/** Pass one phase of time; triggers new-day events if a day rolls over. */
export function passTime(s: GameState): string[] {
  return advancePhase(s) ? startNewDay(s) : [];
}

export function fulfilRequest(s: GameState, requestId: string, item: Item): Fulfilment | null {
  const req = s.requests.find((r) => r.id === requestId);
  if (!req) return null;
  const t = template(req.template);
  if (!t) return null;
  const f = evaluateRequest(t, item);
  s.requests = s.requests.filter((r) => r.id !== requestId);
  s.completedRequests.push(t.id);
  s.gold += f.reward.gold;
  s.stats.earned += f.reward.gold;
  s.reputation += f.reward.rep;
  addRel(s, t.npc, f.reward.rel);
  for (const [m, n] of Object.entries(f.reward.materials)) addMaterial(s, m, n);
  if (f.reward.journal && !s.journals.includes(f.reward.journal)) s.journals.push(f.reward.journal);
  item.giftedTo = t.npc;
  item.requestId = t.id;
  removeFromDisplays(s, item.id);
  s.stats.requests++;
  addLog(s, `${npc(t.npc).name} received “${displayName(item)}” for their request.`);
  return f;
}

export function giftItem(s: GameState, npcId: string, item: Item): Reaction {
  const n = npc(npcId);
  const r = evaluateFor(n, item);
  const pts = Math.round(r.score * 12 - 2);
  addRel(s, npcId, Math.max(1, pts));
  if (r.mood === 'delighted') s.reputation += 1;
  item.giftedTo = npcId;
  removeFromDisplays(s, item.id);
  s.stats.gifted++;
  addLog(s, `You gave “${displayName(item)}” to ${n.name}.`);
  return r;
}

export function salePrice(s: GameState, item: Item, buyer: 'counter' | 'fennick'): number {
  const v = item.stats?.value ?? 10;
  if (buyer === 'counter') return Math.round(v * 0.8);
  const st = item.stats!;
  let mult = 0.85 + (st.collectorAppeal / 100) * 0.45 + (st.uniqueness / 100) * 0.15;
  if (s.journals.includes('journal_masters') && COMMON.includes(item.materials.primary) && st.craftsmanship >= 85) mult *= 1.1;
  return Math.round(v * mult);
}

export function sellItem(s: GameState, item: Item, buyer: 'counter' | 'fennick'): number {
  const p = salePrice(s, item, buyer);
  s.gold += p;
  s.stats.earned += p;
  s.stats.sold++;
  item.sold = true;
  removeFromDisplays(s, item.id);
  if (buyer === 'fennick') addRel(s, 'fennick', 2);
  if ((item.stats?.craftsmanship ?? 0) >= 85) s.reputation += 1;
  addLog(s, `Sold “${displayName(item)}” for ${p} gold.`);
  return p;
}

export function removeFromDisplays(s: GameState, id: string) {
  s.displayed = s.displayed.filter((x) => x !== id);
  s.gallery = s.gallery.filter((x) => x !== id);
}

export function ownedItems(s: GameState): Item[] {
  return s.items.filter((i) => !i.sold && !i.giftedTo);
}

export function metalList(): string[] {
  return METALS.map((m) => m.id);
}
