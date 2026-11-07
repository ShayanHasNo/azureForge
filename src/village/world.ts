// Merchants and exploration. Acquisition is predictable: every location and
// stall says what it reliably offers, with only gentle variation.

import { hash32, seededRng } from '../core/rng';
import { mat } from '../data/materials';
import { GameState, isSeasonalMarket, Phase, PHASES, relLevel, seasonOf, weatherOf, weekday } from '../game/state';

export interface StockLine { id: string; price: number; stock: number }
export interface Merchant {
  id: string;
  name: string;
  npc: string;
  blurb: string;
  schedule: string;
  open: (s: GameState) => boolean;
  stock: (s: GameState) => StockLine[];
}

const price = (id: string, mult = 1) => Math.max(1, Math.round(mat(id).value * mult));
const phase = (s: GameState): Phase => PHASES[s.phase];

export const MERCHANTS: Merchant[] = [
  {
    id: 'general', name: 'Hollis\'s General Store', npc: 'hollis', schedule: 'Every day, morning to evening.',
    blurb: 'Common metals, woods, leather and a few stones. Always stocked.',
    open: (s) => phase(s) !== 'night',
    stock: (s) => {
      const lines: StockLine[] = [
        { id: 'iron', price: price('iron'), stock: 12 }, { id: 'brass', price: price('brass'), stock: 12 }, { id: 'copper', price: price('copper'), stock: 10 },
        { id: 'bronze', price: price('bronze'), stock: 8 }, { id: 'oak', price: price('oak'), stock: 8 }, { id: 'walnut', price: price('walnut'), stock: 6 },
        { id: 'leather', price: price('leather'), stock: 8 }, { id: 'blackleather', price: price('blackleather'), stock: 5 }, { id: 'quartz', price: price('quartz'), stock: 4 },
        { id: 'garnet', price: price('garnet', 1.1), stock: 2 }, { id: 'silver', price: price('silver', 1.1), stock: 2 },
      ];
      if (s.reputation >= 10) lines.push({ id: 'azuresteel', price: price('azuresteel'), stock: 3 });
      return lines;
    },
  },
  {
    id: 'mountain', name: 'Brannoc\'s Mule Cart', npc: 'brannoc', schedule: 'Thunderdays and Stardays, until evening.',
    blurb: 'Dragonsteel, bone and mountain stone, straight from the high passes.',
    open: (s) => ['Thunderday', 'Starday'].includes(weekday(s.day)) && phase(s) !== 'night',
    stock: (s) => {
      const r = relLevel(s, 'brannoc');
      const lines: StockLine[] = [
        { id: 'dragonsteel', price: price('dragonsteel', r >= 2 ? 0.9 : 1), stock: 2 + Math.min(2, r) }, { id: 'iron', price: price('iron', 0.9), stock: 8 },
        { id: 'bronze', price: price('bronze', 0.8), stock: 6 }, { id: 'bone', price: price('bone'), stock: 4 }, { id: 'slate', price: price('slate'), stock: 6 },
        { id: 'riverstone', price: price('riverstone'), stock: 6 }, { id: 'azuresteel', price: price('azuresteel'), stock: 2 },
      ];
      if (r >= 1) lines.push({ id: 'obsidian', price: price('obsidian'), stock: 3 });
      if (r >= 2) lines.push({ id: 'emberstone', price: price('emberstone'), stock: 1 });
      return lines;
    },
  },
  {
    id: 'celestial', name: 'Lyra\'s Night Stall', npc: 'lyra', schedule: 'Evenings and nights, every day.',
    blurb: 'Silver, moonstone and — for friends — star-metal.',
    open: (s) => phase(s) === 'evening' || phase(s) === 'night',
    stock: (s) => {
      const r = relLevel(s, 'lyra');
      const clear = weatherOf(s) === 'clear';
      const lines: StockLine[] = [
        { id: 'silver', price: price('silver'), stock: 3 }, { id: 'moonstone', price: price('moonstone'), stock: 2 + (clear ? 1 : 0) },
        { id: 'moonpearl', price: price('moonpearl'), stock: 2 },
      ];
      if (r >= 1) lines.push({ id: 'starmetal', price: price('starmetal'), stock: 1 + Math.min(2, r - 1) });
      if (r >= 2) lines.push({ id: 'starshard', price: price('starshard'), stock: 1 });
      return lines;
    },
  },
  {
    id: 'glassgarden', name: 'The Glassgarden Greenhouse', npc: 'wren', schedule: 'Every day except Moonday, mornings and afternoons.',
    blurb: 'Gardenglass, willowglass, jade and woodland things.',
    open: (s) => weekday(s.day) !== 'Moonday' && (phase(s) === 'morning' || phase(s) === 'afternoon'),
    stock: (s) => {
      const r = relLevel(s, 'wren');
      const lines: StockLine[] = [
        { id: 'gardenglass', price: price('gardenglass', r >= 2 ? 0.9 : 1), stock: 1 + Math.min(3, r) }, { id: 'birch', price: price('birch'), stock: 6 },
        { id: 'jade', price: price('jade'), stock: 2 }, { id: 'amber', price: price('amber'), stock: 2 },
      ];
      if (r >= 1) lines.push({ id: 'willowglass', price: price('willowglass'), stock: 2 });
      return lines;
    },
  },
  {
    id: 'seasonal', name: 'Seasonal Market', npc: 'fennick', schedule: 'The last two days of every season.',
    blurb: 'Traders from the river towns with seasonal and decorative materials.',
    open: (s) => isSeasonalMarket(s.day) && phase(s) !== 'night',
    stock: (s) => {
      const season = seasonOf(s.day);
      const base: StockLine[] = [{ id: 'ebony', price: price('ebony'), stock: 2 }, { id: 'sapphire', price: price('sapphire'), stock: 1 }];
      const by: Record<string, StockLine[]> = {
        Spring: [{ id: 'jade', price: price('jade', 0.8), stock: 3 }, { id: 'amber', price: price('amber', 0.8), stock: 3 }, { id: 'birch', price: 1, stock: 6 }],
        Summer: [{ id: 'garnet', price: price('garnet', 0.8), stock: 3 }, { id: 'copper', price: 3, stock: 10 }, { id: 'gardenglass', price: price('gardenglass', 0.9), stock: 2 }],
        Autumn: [{ id: 'antler', price: price('antler', 0.8), stock: 3 }, { id: 'amber', price: price('amber', 0.7), stock: 3 }, { id: 'bronze', price: 4, stock: 8 }],
        Winter: [{ id: 'moonpearl', price: price('moonpearl', 0.8), stock: 3 }, { id: 'silver', price: price('silver', 0.85), stock: 4 }, { id: 'starshard', price: price('starshard', 0.9), stock: 1 }],
      };
      return [...base, ...by[season]];
    },
  },
];

export function boughtToday(s: GameState, merchant: string, id: string): number {
  return s.merchantSales[`${s.day}:${merchant}:${id}`] ?? 0;
}

// ---------------------------------------------------------------- exploration
export interface Location {
  id: string;
  name: string;
  blurb: string;
  yields: string; // shown to the player: what you reliably find
  discover: { hint: string; check: (s: GameState) => boolean };
  available: (s: GameState) => { ok: boolean; why?: string };
  visit: (s: GameState) => { materials: Record<string, number>; journal?: string; text: string };
}

const visits = (s: GameState, id: string) => s.locationVisits[id] ?? 0;
const vr = (s: GameState, id: string) => seededRng(hash32(s.worldSeed, s.day, visits(s, id)), 'explore:' + id);

export const LOCATIONS: Location[] = [
  {
    id: 'riverbank', name: 'The Riverbank', blurb: 'Willows, kingfishers and smooth stones.',
    yields: 'Always 2–3 riverstones; usually a quartz pebble; copper nuggets after rain.',
    discover: { hint: 'Known from the start.', check: () => true },
    available: () => ({ ok: true }),
    visit: (s) => {
      const r = vr(s, 'riverbank');
      const m: Record<string, number> = { riverstone: r.int(2, 3) };
      if (r.chance(0.75)) m.quartz = 1;
      if (weatherOf(s) === 'rain') m.copper = 2;
      return { materials: m, text: weatherOf(s) === 'rain' ? 'Rain has washed copper nuggets into the shallows.' : 'The river is low and clear. Smooth stones gleam in the shallows.' };
    },
  },
  {
    id: 'woods', name: 'The Whispering Woods', blurb: 'Birch groves and old amber trees.',
    yields: 'Always birch; amber most visits; antler in autumn; a gardenglass seedling in the hollow on every third visit.',
    discover: { hint: 'Known from the start.', check: () => true },
    available: () => ({ ok: true }),
    visit: (s) => {
      const r = vr(s, 'woods');
      const m: Record<string, number> = { birch: 2 };
      if (r.chance(0.7)) m.amber = 1;
      if (seasonOf(s.day) === 'Autumn') m.antler = 1;
      if ((visits(s, 'woods') + 1) % 3 === 0) m.gardenglass = 1;
      return { materials: m, text: m.gardenglass ? 'In the hollow, a sliver of green crystal has grown from the roots of a birch.' : 'Birch leaves whisper overhead. Amber beads glow on an old trunk.' };
    },
  },
  {
    id: 'quarry', name: 'The Old Quarry', blurb: 'Grey terraces and rusty seams.',
    yields: 'Always 2 iron ore and 2 slate; a garnet on every second visit.',
    discover: { hint: 'Known from the start.', check: () => true },
    available: () => ({ ok: true }),
    visit: (s) => {
      const m: Record<string, number> = { iron: 2, slate: 2 };
      if ((visits(s, 'quarry') + 1) % 2 === 0) m.garnet = 1;
      return { materials: m, text: m.garnet ? 'A dark red garnet glints in a split of slate.' : 'You chip iron ore from a rusty seam.' };
    },
  },
  {
    id: 'ruin', name: 'The Abandoned Workshop', blurb: 'A tinkerer\'s workshop, roof fallen in, full of notes.',
    yields: 'Old bronze scrap; historical crafting journals on your first three visits.',
    discover: { hint: 'Earn 4 reputation — Hollis will mention it.', check: (s) => s.reputation >= 4 },
    available: () => ({ ok: true }),
    visit: (s) => {
      const journals = ['journal_folds', 'journal_tinkerer', 'journal_ancients'];
      const j = journals.find((x) => !s.journals.includes(x));
      const m: Record<string, number> = { bronze: 2 };
      if (j) return { materials: m, journal: j, text: `Under a collapsed bench you find a water-stained journal: “${JOURNALS[j].title}”.` };
      return { materials: m, text: 'You sift the old workshop for bronze scrap. The tinkerer\'s chalk marks are still on the walls.' };
    },
  },
  {
    id: 'lake', name: 'Moonlit Lake', blurb: 'A still mountain lake that shimmers at night.',
    yields: 'In the evening or at night: 1–2 moonstone and a moonpearl.',
    discover: { hint: 'Befriend Lyra, or earn 8 reputation.', check: (s) => relLevel(s, 'lyra') >= 1 || s.reputation >= 8 },
    available: (s) => (phase(s) === 'evening' || phase(s) === 'night' ? { ok: true } : { ok: false, why: 'The lake only shimmers in the evening and at night.' }),
    visit: (s) => {
      const r = vr(s, 'lake');
      return { materials: { moonstone: r.int(1, 2), moonpearl: 1 }, text: 'Moonlight pools on the water. Pale stones gleam beneath the surface.' };
    },
  },
  {
    id: 'ridge', name: 'Starfall Ridge', blurb: 'A high ridge where stars fall on clear nights.',
    yields: 'At night in clear or cloudy weather: 1–2 star-metal; a starshard in clear weather.',
    discover: { hint: 'Become good friends with Lyra (friendship 2), or earn 22 reputation.', check: (s) => relLevel(s, 'lyra') >= 2 || s.reputation >= 22 },
    available: (s) => {
      if (phase(s) !== 'night') return { ok: false, why: 'Stars only fall at night.' };
      if (['rain', 'snow'].includes(weatherOf(s))) return { ok: false, why: 'Too stormy tonight — try another night.' };
      return { ok: true };
    },
    visit: (s) => {
      const r = vr(s, 'ridge');
      const m: Record<string, number> = { starmetal: r.int(1, 2) };
      if (weatherOf(s) === 'clear') m.starshard = 1;
      return { materials: m, text: 'A streak of light — and a smoking fragment of star-metal in the heather.' };
    },
  },
  {
    id: 'vents', name: 'The Ember Vents', blurb: 'Warm fissures in the high pass.',
    yields: 'Always 1 dragonsteel ore and 2 obsidian; an emberstone on every second visit.',
    discover: { hint: 'Befriend Brannoc (friendship 2), or earn 18 reputation.', check: (s) => relLevel(s, 'brannoc') >= 2 || s.reputation >= 18 },
    available: (s) => (seasonOf(s.day) === 'Winter' && weatherOf(s) === 'snow' ? { ok: false, why: 'The pass is snowed in today.' } : { ok: true }),
    visit: (s) => {
      const m: Record<string, number> = { dragonsteel: 1, obsidian: 2 };
      if ((visits(s, 'vents') + 1) % 2 === 0) m.emberstone = 1;
      return { materials: m, text: 'Heat shimmers from the fissures. Dark, ember-veined ore lies at the edges.' };
    },
  },
];

export const JOURNALS: Record<string, { title: string; text: string; unlocks: string }> = {
  journal_folds: {
    title: 'The Patternwright\'s Folio',
    text: 'Fold the billet as you would fold a letter you mean to keep. Every fold doubles the lines; every careless strike blurs them.',
    unlocks: 'Unlocks the Patternwright tradition and the layered texture in every tradition.',
  },
  journal_tinkerer: {
    title: 'The Tinkerer\'s Notebook',
    text: 'Rules are a recipe someone else wrote. Fuse what should not fuse. Do things out of order. Write down what happens.',
    unlocks: 'Unlocks the Experimental Workshop tradition.',
  },
  journal_ancients: {
    title: 'Notes on the Barrow Smiths',
    text: 'The old smiths of the barrows cut runes before they cut edges, and knotted their guards like rope.',
    unlocks: 'Unlocks knotwork engraving and the knot guard without the loupe.',
  },
  journal_masters: {
    title: 'A Master\'s Ledger',
    text: 'A list of every common-metal masterpiece Fennick has bought, with prices that would make a dragon blush.',
    unlocks: 'A keepsake. Collectors now pay 10% more for masterwork common-metal pieces.',
  },
};
