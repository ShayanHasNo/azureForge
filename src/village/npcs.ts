// Villagers: identities, tastes, stories and reactions grounded in the actual
// properties of the item they're shown.

import { seededRng, hashString } from '../core/rng';
import { clamp } from '../core/util';
import { hasMat, mat } from '../data/materials';
import { optionName } from '../data/options';
import type { Item, ItemStats } from '../item/types';

export interface Npc {
  id: string;
  name: string;
  role: string;
  personality: string;
  story: string;
  color: string; // portrait accent
  hair: string;
  skin: string;
  likes: Record<string, number>; // tag → weight (negative = dislike)
  statLikes: Partial<Record<keyof ItemStats, number>>;
  favMaterials: string[];
  categories?: string[];
  greetings: string[];
}

export const NPCS: Npc[] = [
  {
    id: 'hollis', name: 'Hollis', role: 'Keeper of the general store', color: '#c08a40', hair: '#8a8a8a', skin: '#e0b090',
    personality: 'Warm, chatty, endlessly practical.', story: 'Hollis sold your grandmother iron for forty years and still keeps her account book under the counter.',
    likes: { warm: 1, traditional: 1, practical: 0.8, golden: 0.6, humble: 0.5, strange: -0.4 }, statLikes: { craftsmanship: 0.8, durability: 0.5 },
    favMaterials: ['brass', 'iron'], greetings: ['Morning! Kettle\'s on.', 'Your grandmother would be proud, you know.', 'Iron\'s cheap this week — don\'t tell anyone.'],
  },
  {
    id: 'maren', name: 'Maren', role: 'The miller', color: '#7a9a5a', hair: '#5a3a20', skin: '#d8a07a',
    personality: 'Plain-spoken and steady; distrusts fuss.', story: 'Maren grew up high in the mountain villages before the mill brought her down to the river. She misses the wind on the ridges.',
    likes: { practical: 1, mountain: 1, earthy: 0.8, dependable: 0.8, rustic: 0.7, humble: 0.7, ornate: -0.7, ceremonial: -0.4 }, statLikes: { durability: 0.9, balance: 0.5, integrity: 0.6 },
    favMaterials: ['iron', 'bronze'], greetings: ['Flour on my sleeves again.', 'The wheel\'s turning nicely today.', 'Simple things last longest.'],
  },
  {
    id: 'teodor', name: 'Old Teodor', role: 'Retired gate-guard', color: '#6a7a9a', hair: '#e0e0e0', skin: '#c89070',
    personality: 'Gruff, kind, obsessed with balance.', story: 'Teodor guarded the north gate for thirty winters without once drawing his sword in anger. He still checks every blade\'s balance on two fingers.',
    likes: { steadfast: 1, graceful: 0.7, traditional: 0.8, practical: 0.6, swift: 0.4, strange: -0.5 }, statLikes: { balance: 1.2, durability: 0.8, integrity: 0.6, craftsmanship: 0.5 },
    favMaterials: ['iron', 'azuresteel', 'bronze'], categories: ['sword', 'shield'], greetings: ['Hmph. Let\'s see your work.', 'Balance, young smith. Balance.', 'Knees ache. Rain\'s coming.'],
  },
  {
    id: 'lyra', name: 'Lyra', role: 'Astronomer on Lantern Hill', color: '#7a6ae0', hair: '#2a2a4a', skin: '#f0d0c0',
    personality: 'Dreamy, precise, happiest at night.', story: 'Lyra maps the sky from a tower full of brass instruments. She has been waiting years for someone who can work star-metal.',
    likes: { celestial: 1.2, lunar: 1, starry: 1, magical: 0.9, mystic: 0.8, cool: 0.4, bright: 0.4, rustic: -0.3 }, statLikes: { uniqueness: 0.6, surfaceQuality: 0.5 },
    favMaterials: ['starmetal', 'moonstone', 'silver'], greetings: ['Did you see the moon last night?', 'The Lantern constellation is rising.', 'I brought tea. It\'s gone cold. Sorry.'],
  },
  {
    id: 'brannoc', name: 'Brannoc', role: 'Mountain trader', color: '#9a6a3a', hair: '#8a3a1a', skin: '#c08060',
    personality: 'Loud, generous, suspicious of anything shiny.', story: 'Brannoc walks his mule down from the high passes every Thunderday with ore, bone and stories. He grew up beside the Ember Vents.',
    likes: { mountain: 1.2, earthy: 0.9, rustic: 0.8, wild: 0.7, heavy: 0.6, asymmetric: 0.6, handmade: 0.6, fiery: 0.5, bright: -0.5, delicate: -0.5 }, statLikes: { durability: 0.8, integrity: 0.5 },
    favMaterials: ['dragonsteel', 'iron', 'bronze'], greetings: ['Ha! The forge is warm!', 'Mule\'s grumpy. So am I. Show me something.', 'The pass was snowed in, but here I am.'],
  },
  {
    id: 'pip', name: 'Pip', role: 'Hollis\'s grandchild', color: '#e0a040', hair: '#d8a030', skin: '#f0c8a0',
    personality: 'Curious, loud, loves anything odd.', story: 'Pip wants to be a smith "or a dragon, whichever is easier." They collect strange pebbles and stranger questions.',
    likes: { strange: 1.2, experimental: 1, handmade: 0.9, wild: 0.6, magical: 0.6, ornate: 0.3, fiery: 0.5, minimal: -0.4 }, statLikes: { uniqueness: 1, compactness: 0.4 },
    favMaterials: ['copper', 'starmetal', 'gardenglass'], categories: ['dagger'], greetings: ['Is that hot? Can I touch it? No? Okay.', 'I found a pebble shaped like a fish!', 'Make something WEIRD.'],
  },
  {
    id: 'ilse', name: 'Sister Ilse', role: 'Keeper of the chapel', color: '#c0b0e0', hair: '#4a3a3a', skin: '#e8c8b0',
    personality: 'Serene, exacting, quietly funny.', story: 'Ilse tends the old chapel and its bell. She keeps a list of every oath sworn there for two hundred years.',
    likes: { ceremonial: 1.2, regal: 1, ornate: 0.8, bright: 0.7, inscribed: 0.9, elegant: 0.6, lunar: 0.3, rustic: -0.3, strange: -0.4 }, statLikes: { ornamentation: 0.8, cohesion: 0.7, surfaceQuality: 0.6 },
    favMaterials: ['silver', 'brass'], greetings: ['Peace on your forge.', 'The bell needs a new clapper. Someday.', 'Beauty is a kind of care.'],
  },
  {
    id: 'fennick', name: 'Fennick', role: 'Travelling collector', color: '#3a7a6a', hair: '#1a1a1a', skin: '#d0a888',
    personality: 'Polished, appraising, secretly sentimental.', story: 'Fennick travels the river towns buying "pieces with a soul". His ledger is legendary. He pays well — for the right thing.',
    likes: { ornate: 0.6, strange: 0.5, celestial: 0.3, pattern: 0.5, ancient: 0.4 }, statLikes: { craftsmanship: 1.2, uniqueness: 0.9, collectorAppeal: 1, rarity: 0.3 },
    favMaterials: [], greetings: ['Ah. Let us see what the river brought me.', 'Every piece has a provenance. What is yours?', 'I can wait. Good things are slow.'],
  },
  {
    id: 'wren', name: 'Wren', role: 'Keeper of the Glassgarden', color: '#4ac0a0', hair: '#3a6a3a', skin: '#e0b898',
    personality: 'Gentle, distracted, talks to plants.', story: 'Wren grows living crystal in a greenhouse at the edge of the woods, coaxing gardenglass from seed over many seasons.',
    likes: { nature: 1.2, verdant: 1, translucent: 0.9, delicate: 0.8, bright: 0.5, vine: 0.7, river: 0.4, heavy: -0.5, fiery: -0.4 }, statLikes: { surfaceQuality: 0.6, cohesion: 0.6 },
    favMaterials: ['gardenglass', 'copper', 'moonstone'], greetings: ['Shh — the glass is sprouting.', 'You smell of smoke. It\'s nice.', 'Have you ever listened to crystal grow?'],
  },
];

export function npc(id: string): Npc {
  return NPCS.find((n) => n.id === id) ?? NPCS[0];
}

const TAG_PHRASES: Record<string, string> = {
  warm: 'that warm colour', traditional: 'the traditional lines', practical: 'how practical it is', golden: 'that golden glow', humble: 'its humility',
  mountain: 'the mountain feel of it', earthy: 'those earthy tones', dependable: 'how dependable it feels', rustic: 'the rustic character', ornate: 'all that ornament',
  ceremonial: 'the ceremonial air', steadfast: 'how steadfast it is', graceful: 'its grace', swift: 'how quick it feels', strange: 'how strange it is', celestial: 'the starlight in it',
  lunar: 'the moon-pale sheen', starry: 'those little stars', magical: 'the magic humming in it', mystic: 'its mystery', cool: 'the cool tones', bright: 'how bright it is',
  wild: 'the wildness of it', heavy: 'the weight of it', asymmetric: 'the deliberate asymmetry', handmade: 'the handmade marks', fiery: 'the fire in it', delicate: 'its delicacy',
  experimental: 'how experimental it is', regal: 'its regal bearing', inscribed: 'the inscription', elegant: 'its elegance', pattern: 'the patterning', ancient: 'how ancient it looks',
  nature: 'the touch of nature', verdant: 'the green life in it', translucent: 'the way light passes through', vine: 'the vines', river: 'the river feeling', minimal: 'the plainness',
};
const STAT_PHRASES: Record<string, [string, string]> = {
  balance: ['it sits so evenly in the hand', 'the balance is off'],
  durability: ['it\'ll last a lifetime', 'it doesn\'t feel like it will last'],
  integrity: ['it\'s solidly made', 'it feels a little loose'],
  craftsmanship: ['the workmanship is superb', 'the workmanship is rough'],
  uniqueness: ['I\'ve never seen anything like it', 'it\'s a little ordinary'],
  ornamentation: ['the decoration is lovely', 'it\'s rather plain for my taste'],
  surfaceQuality: ['the surface is beautiful', 'the surface is uneven'],
  cohesion: ['every part belongs together', 'the parts don\'t quite agree'],
  collectorAppeal: ['it has a soul', 'it lacks something'],
  compactness: ['it fits in my pocket', 'it\'s bulky'],
  rarity: ['what rare materials', 'common stuff, that'],
};

export interface Reaction {
  score: number; // 0..1
  lines: string[];
  mood: 'delighted' | 'pleased' | 'polite' | 'unsure';
}

export function evaluateFor(n: Npc, item: Item, extraLikes: Record<string, number> = {}, extraStats: Partial<Record<keyof ItemStats, number>> = {}): Reaction {
  const s = item.stats!;
  const likes = { ...n.likes, ...extraLikes };
  const statLikes = { ...n.statLikes, ...extraStats };
  const contribs: { key: string; v: number; kind: 'tag' | 'stat' | 'mat' }[] = [];
  for (const [tag, w] of Object.entries(likes)) if (item.tags.includes(tag)) contribs.push({ key: tag, v: w * 0.12, kind: 'tag' });
  for (const [k, w] of Object.entries(statLikes)) {
    const v = ((s as any)[k] ?? 50) / 100;
    contribs.push({ key: k, v: (v - 0.55) * (w ?? 0) * 0.5, kind: 'stat' });
  }
  if (n.favMaterials.includes(item.materials.primary)) contribs.push({ key: item.materials.primary, v: 0.12, kind: 'mat' });
  if (n.categories && !n.categories.includes(item.category)) contribs.push({ key: 'category', v: -0.05, kind: 'tag' });
  const total = contribs.reduce((a, c) => a + c.v, 0);
  const score = clamp(0.5 + total);
  const r = seededRng(hashString(n.id) ^ item.seed, 'react');
  const pos = contribs.filter((c) => c.v > 0.03).sort((a, b) => b.v - a.v);
  const neg = contribs.filter((c) => c.v < -0.03).sort((a, b) => a.v - b.v);
  const phrase = (c: { key: string; kind: string }, good: boolean) => {
    if (c.kind === 'mat') return hasMat(c.key) ? `${mat(c.key).name.toLowerCase()} — my favourite` : c.key;
    if (c.kind === 'stat') return STAT_PHRASES[c.key]?.[good ? 0 : 1] ?? c.key;
    return TAG_PHRASES[c.key] ?? c.key;
  };
  const lines: string[] = [];
  const mood: Reaction['mood'] = score > 0.75 ? 'delighted' : score > 0.58 ? 'pleased' : score > 0.42 ? 'polite' : 'unsure';
  const openers = {
    delighted: ['Oh! Oh, look at this.', 'This is wonderful.', 'Now THIS is something.'],
    pleased: ['This is lovely work.', 'I like this.', 'Hm! Very nice.'],
    polite: ['It\'s... interesting.', 'Thank you, truly.', 'Well, it has something.'],
    unsure: ['I\'m not sure it\'s for me.', 'Hm. It\'s not quite me.', 'It\'s well meant, I can tell.'],
  };
  lines.push(r.pick(openers[mood]));
  if (pos.length) {
    const a = phrase(pos[0], true);
    const b = pos[1] ? phrase(pos[1], true) : null;
    lines.push(b ? `I love ${a} — and ${b}.` : `I love ${a}.`);
  }
  if (neg.length && mood !== 'delighted') lines.push(`Though ${phrase(neg[0], false)}${neg[0].kind === 'tag' ? ' isn\'t really to my taste' : ''}.`);
  // Reference a concrete visible feature.
  const e = item.decoration.engraving.pattern;
  if (e !== 'none' && r.chance(0.6)) lines.push(`The ${optionName('engraving', e).toLowerCase()} engraving ${item.decoration.engraving.crispness > 0.75 ? 'is so crisp' : 'has such a handmade wander to it'}.`);
  else if (item.blemishes.length >= 3 && (likes.handmade ?? 0) > 0) lines.push('And those little marks — you can see a real person made it.');
  return { score, lines, mood };
}
