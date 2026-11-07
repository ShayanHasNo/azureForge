// Open-ended villager requests. Each is evaluated against the actual item
// (its tags, stats, and the asker's own tastes), never a checklist of exact options.

import { hash32, seededRng } from '../core/rng';
import type { ItemStats } from '../item/types';
import type { Item } from '../item/types';
import { evaluateFor, npc, Reaction } from './npcs';

export interface RequestTemplate {
  id: string;
  npc: string;
  text: string;
  hint: string;
  category?: 'sword' | 'dagger' | 'shield';
  likes: Record<string, number>;
  stats?: Partial<Record<keyof ItemStats, number>>;
  reward: { gold: number; rep: number; rel: number; materials?: Record<string, number>; journal?: string; extra?: string };
  minRep?: number;
  requiresUpgrade?: string;
  once?: boolean;
}

export const REQUESTS: RequestTemplate[] = [
  { id: 'maren_mountains', npc: 'maren', text: 'I want something that reminds me of the mountains where I grew up.', hint: 'Think stone, weathered surfaces, earthy colours, ridgelines.', likes: { mountain: 1.4, earthy: 1, rustic: 0.6, wild: 0.4, heavy: 0.3 }, reward: { gold: 70, rep: 4, rel: 8, materials: { slate: 2 } } },
  { id: 'teodor_balance', npc: 'teodor', category: 'sword', text: 'A sword that balances on two fingers, just behind the guard. Nothing more, nothing less.', hint: 'Balance comes from proportions, pommel weight and a well-fitted hilt.', likes: { graceful: 0.6, steadfast: 0.4 }, stats: { balance: 2.2 }, reward: { gold: 90, rep: 5, rel: 9 } },
  { id: 'pip_knife', npc: 'pip', category: 'dagger', text: 'Can you make me a tiny knife? A WEIRD one. With a face on it. Or not a face. Just weird.', hint: 'Pip loves strange, colourful, handmade things. You\'ll need the Horned Bench Anvil for daggers.', likes: { strange: 1.4, experimental: 1, handmade: 0.8, magical: 0.6 }, stats: { uniqueness: 1.2 }, reward: { gold: 30, rep: 3, rel: 10, materials: { amber: 1, quartz: 1 } }, requiresUpgrade: 'smallanvil' },
  { id: 'lyra_night', npc: 'lyra', text: 'Make me something that holds a little of the night sky.', hint: 'Silver, moonstone, star motifs, glow — or a constellation.', likes: { celestial: 1.4, lunar: 1, starry: 1, magical: 0.7 }, reward: { gold: 80, rep: 5, rel: 10, materials: { moonstone: 2 } } },
  { id: 'ilse_oath', npc: 'ilse', text: 'The chapel needs an oath-blade for the spring vows. It must be beautiful, and it must say something.', hint: 'Ceremony, ornament, a fine finish — and an inscription.', likes: { ceremonial: 1.2, regal: 0.8, inscribed: 1.4, ornate: 0.6, bright: 0.4 }, stats: { ornamentation: 0.8, cohesion: 0.6 }, reward: { gold: 120, rep: 6, rel: 9, materials: { silver: 2 } }, minRep: 4 },
  { id: 'brannoc_pass', npc: 'brannoc', text: 'The high pass eats soft things. Make me something that would survive it.', hint: 'Durability and integrity matter. Brannoc distrusts shine.', likes: { mountain: 0.6, heavy: 0.5, steadfast: 0.8, bright: -0.4 }, stats: { durability: 1.6, integrity: 1 }, reward: { gold: 100, rep: 5, rel: 10, materials: { dragonsteel: 2 } }, minRep: 3 },
  { id: 'wren_garden', npc: 'wren', text: 'Something for the garden gate. It should feel like it grew there.', hint: 'Nature motifs, green tones, vines, leaves, delicate shapes.', likes: { nature: 1.4, verdant: 1, vine: 0.8, delicate: 0.6, translucent: 0.5 }, reward: { gold: 80, rep: 5, rel: 10, materials: { gardenglass: 2 } }, minRep: 6 },
  { id: 'fennick_soul', npc: 'fennick', text: 'Bring me a piece with a soul. I will know it when I see it.', hint: 'Fennick values craftsmanship and uniqueness above all.', likes: { ornate: 0.3, strange: 0.3 }, stats: { craftsmanship: 1.6, uniqueness: 1, collectorAppeal: 1 }, reward: { gold: 200, rep: 8, rel: 8, materials: { sapphire: 1, ebony: 1 } }, minRep: 10 },
  { id: 'hollis_brass', npc: 'hollis', text: 'My shop sign fell down. I\'d love a brass piece to hang over the door — something warm that says "come in".', hint: 'Warm, golden, welcoming. Brass suits it — but it\'s your call.', likes: { warm: 1.2, golden: 1, traditional: 0.5, brass: 0.8 }, reward: { gold: 60, rep: 3, rel: 8, materials: { brass: 3 } } },
  { id: 'teodor_shield', npc: 'teodor', category: 'shield', text: 'My old gate shield finally split. A new one, broad and honest?', hint: 'Coverage and integrity. You\'ll need the Shield Frame.', likes: { steadfast: 0.8, traditional: 0.6 }, stats: { coverage: 1.4, integrity: 1.2 }, reward: { gold: 140, rep: 6, rel: 10 }, requiresUpgrade: 'shieldframe' },
  { id: 'maren_humble', npc: 'maren', text: 'Something plain and useful for my son, who\'s off to the river barges. Nothing fancy, mind.', hint: 'Humble, practical, durable. Less ornament is more here.', likes: { humble: 1.2, practical: 1, minimal: 0.8, ornate: -1 }, stats: { durability: 0.8 }, reward: { gold: 55, rep: 3, rel: 8 } },
  { id: 'pip_dragon', npc: 'pip', text: 'I want to feel like a DRAGON. Can you make dragon things?', hint: 'Fiery, dramatic, wild — dragonsteel, ember tones, flame motifs.', likes: { fiery: 1.4, wild: 0.8, strange: 0.5, mountain: 0.3 }, reward: { gold: 40, rep: 3, rel: 10, materials: { emberstone: 1 } }, minRep: 5 },
  { id: 'lyra_instrument', npc: 'lyra', text: 'I need a fine, precise little blade for cutting star-charts. Quiet, exact and pale.', hint: 'Small and precise; silver or moonstone suit Lyra.', category: 'dagger', likes: { lunar: 0.8, cool: 0.6, elegant: 0.6, minimal: 0.4 }, stats: { craftsmanship: 1, compactness: 0.8 }, reward: { gold: 90, rep: 4, rel: 10, materials: { starmetal: 1 } }, requiresUpgrade: 'smallanvil', minRep: 6 },
  { id: 'ilse_bell', npc: 'ilse', text: 'Something ancient-feeling for the chapel\'s reliquary. As though it had always been there.', hint: 'Aged finishes, old motifs, knotwork and runes.', likes: { ancient: 1.4, historic: 1, knot: 0.6, ceremonial: 0.4 }, reward: { gold: 110, rep: 5, rel: 9, materials: { bronze: 3 } }, minRep: 8 },
  { id: 'brannoc_gift', npc: 'brannoc', text: 'My sister\'s wedding is in the high villages. A gift — rugged, but beautiful. Stones from home would be good.', hint: 'Mountain character with real beauty. Stone setting is the Mountain way.', likes: { mountain: 1, earthy: 0.6, ornate: 0.5, wild: 0.4 }, stats: { cohesion: 0.8, ornamentation: 0.6 }, reward: { gold: 130, rep: 6, rel: 10, materials: { obsidian: 2 } }, minRep: 10 },
  { id: 'wren_glass', npc: 'wren', text: 'Could you make something translucent? I want to hold it up to the window and see the garden through it.', hint: 'Gardenglass or moonstone, clear surfaces.', likes: { translucent: 1.6, verdant: 0.6, delicate: 0.5, bright: 0.5 }, stats: { surfaceQuality: 0.8 }, reward: { gold: 100, rep: 5, rel: 10, materials: { willowglass: 1, jade: 1 } }, minRep: 12 },
  { id: 'fennick_common', npc: 'fennick', text: 'A wager with a rival collector: I say a master can make a treasure from common iron or brass. Prove me right.', hint: 'Use iron, brass, copper or bronze — and make it superb.', likes: { iron: 0.8, brass: 0.8, copper: 0.8, bronze: 0.8 }, stats: { craftsmanship: 2, collectorAppeal: 0.8 }, reward: { gold: 220, rep: 8, rel: 8, journal: 'journal_masters' }, minRep: 14 },
];

export function template(id: string): RequestTemplate | undefined {
  return REQUESTS.find((r) => r.id === id);
}

export interface Fulfilment extends Reaction {
  categoryOk: boolean;
  reward: { gold: number; rep: number; rel: number; materials: Record<string, number>; journal?: string };
}

export function evaluateRequest(t: RequestTemplate, item: Item): Fulfilment {
  const n = npc(t.npc);
  const reaction = evaluateFor(n, item, t.likes, t.stats ?? {});
  const categoryOk = !t.category || t.category === item.category;
  let score = reaction.score;
  if (!categoryOk) score *= 0.7;
  const k = score < 0.35 ? 0.4 : score < 0.55 ? 0.7 : score < 0.75 ? 1 : 1.3;
  const reward = {
    gold: Math.round(t.reward.gold * k),
    rep: Math.max(1, Math.round(t.reward.rep * k)),
    rel: Math.max(2, Math.round(t.reward.rel * k)),
    materials: score >= 0.45 ? { ...(t.reward.materials ?? {}) } : {},
    journal: t.reward.journal,
  };
  const lines = [...reaction.lines];
  if (!categoryOk) lines.push(`I did rather hope for a ${t.category}... but I'll treasure it anyway.`);
  return { ...reaction, score, lines, categoryOk, reward };
}

/** Pick which request to post next — deterministic from world seed & day, skipping completed one-offs. */
export function nextRequest(worldSeed: number, day: number, rep: number, upgrades: string[], active: string[], completed: string[]): RequestTemplate | null {
  const pool = REQUESTS.filter((r) => !active.includes(r.id) && !completed.includes(r.id) && (r.minRep ?? 0) <= rep && (!r.requiresUpgrade || upgrades.includes(r.requiresUpgrade)));
  if (!pool.length) return null;
  const rng = seededRng(hash32(worldSeed, day), 'request');
  // Prefer lower-requirement requests first so the early game is gentle.
  pool.sort((a, b) => (a.minRep ?? 0) - (b.minRep ?? 0));
  return pool[Math.floor(rng.next() * Math.min(pool.length, 4))];
}
