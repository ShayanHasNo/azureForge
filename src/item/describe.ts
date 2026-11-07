// Dynamic naming and description, composed from the item's actual properties.

import { seededRng } from '../core/rng';
import { hasMat, mat } from '../data/materials';
import { optionName, palette, WRAP_COLORS } from '../data/options';
import { tradition } from '../data/traditions';
import { collectDesignTags, computeStats, decorPresence } from './stats';
import type { Item } from './types';

const MOTIF_WORDS: Record<string, string[]> = {
  vine: ['Vine', 'Ivy', 'Bramble', 'Tendril'], mountain: ['Ridge', 'Peak', 'Cairn', 'Crag'], wave: ['Tide', 'River', 'Current', 'Brook'],
  star: ['Star', 'Comet', 'Lantern', 'Vigil'], sun: ['Sun', 'Dawn', 'Noon', 'Hearth'], moon: ['Moon', 'Crescent', 'Dusk', 'Tide'],
  flame: ['Ember', 'Flame', 'Cinder', 'Forge'], knot: ['Knot', 'Oath', 'Kin', 'Bond'], feather: ['Feather', 'Wing', 'Swift', 'Lark'],
  geometric: ['Facet', 'Lattice', 'Prism', 'Compass'], none: ['Quiet', 'Plain', 'Honest', 'Still'],
};
const MAT_WORDS: Record<string, string[]> = {
  brass: ['Brass', 'Gilt', 'Bell'], copper: ['Copper', 'Rose', 'Penny'], bronze: ['Bronze', 'Barrow', 'Elder'], iron: ['Iron', 'Anvil', 'Hearth'],
  silver: ['Silver', 'Pale', 'Chime'], azuresteel: ['Azure', 'River', 'Blue'], moonstone: ['Moon', 'Pearl', 'Mist'], dragonsteel: ['Dragon', 'Ember', 'Scale'],
  starmetal: ['Star', 'Sky', 'Fallen'], gardenglass: ['Glass', 'Leaf', 'Green'],
};
const SUFFIX = ['song', 'fang', 'warden', 'light', 'thorn', 'keeper', 'whisper', 'fall', 'mark', 'heart', 'call', 'ward', 'tide', 'bloom', 'brand'];
const NOUNS: Record<string, string[]> = {
  sword: ['Blade', 'Sword', 'Brand', 'Edge', 'Longblade'], dagger: ['Dagger', 'Knife', 'Fang', 'Thorn', 'Dirk'], shield: ['Shield', 'Ward', 'Bulwark', 'Aegis', 'Guard'],
};
const DIRECTION_ADJ: Record<string, string[]> = {
  elegant: ['Graceful', 'Slender', 'Fine'], heavy: ['Stout', 'Heavy', 'Broad'], ornamental: ['Gilded', 'Ornate', 'Adorned'], minimalist: ['Plain', 'Quiet', 'Clean'],
  ancient: ['Old', 'Barrow', 'Elder'], rustic: ['Hearth', 'Village', 'Homespun'], ceremonial: ['Oath', 'Hall', 'Crowned'], nature: ['Wild', 'Green', 'Rooted'],
  experimental: ['Curious', 'Strange', 'Wandering'],
};
const PLACES = ['the Hollow', 'Low Mill', 'the Ridge', 'the Long Field', 'Saltbrook', 'the Old Road', 'Winterbarrow', 'the Quiet Forge', 'Ashford', 'the Lantern Hill'];

export function generateName(item: Item): string {
  const r = seededRng(item.seed, 'name');
  const motif = MOTIF_WORDS[item.design.motif] ?? MOTIF_WORDS.none;
  const mw = MAT_WORDS[item.materials.primary] ?? ['Iron'];
  let nouns = NOUNS[item.category];
  if (item.blade?.profile === 'curved') nouns = [...nouns, 'Saber'];
  if (item.blade?.profile === 'falchion') nouns = [...nouns, 'Falchion'];
  if (item.blade?.profile === 'wavy') nouns = [...nouns, 'Flamberge'];
  if (item.shield?.shape === 'buckler') nouns = ['Buckler', ...nouns];
  const adj = DIRECTION_ADJ[item.design.direction] ?? ['Fine'];
  const form = r.int(0, 4);
  switch (form) {
    case 0: return `${r.pick(motif)}${r.pick(SUFFIX)}`;
    case 1: return `The ${r.pick(adj)} ${r.pick(mw)} ${r.pick(nouns)}`;
    case 2: return `${r.pick(mw)}${r.pick(SUFFIX)}, ${r.pick(nouns)} of ${r.pick(PLACES)}`;
    case 3: return `${r.pick(motif)} ${r.pick(nouns)}`;
    default: return `${r.pick(adj)} ${r.pick(motif)}${r.pick(SUFFIX)}`;
  }
}

const PROFILE_PHRASE: Record<string, string> = {
  straight: 'a straight, even blade', tapered: 'a blade that narrows steadily', leaf: 'a leaf-shaped blade that swells before the tip', broad: 'a broad, generous blade',
  curved: 'a sweeping curved blade', falchion: 'a blade that widens toward a heavy tip', needle: 'a needle-slim blade', wavy: 'a flame-waved blade',
  kopis: 'a forward-curving kopis blade', thorn: 'a thorn-barbed blade', crag: 'a craggy, faceted blade', crystal: 'a faceted crystal spire',
};
const TIP_PHRASE: Record<string, string> = {
  point: 'a clean point', spear: 'a long spear point', clipped: 'a clipped tip', rounded: 'a gentle rounded tip', chisel: 'a chisel tip', hooked: 'a hooked tip', swallowtail: 'a forked swallowtail tip',
};
const TEXTURE_PHRASE: Record<string, string> = {
  smooth: 'a smooth surface', brushed: 'a fine brushed grain', hammered: 'proud hammer-marks', weathered: 'a weathered, wind-worn skin', reflective: 'a mirror-bright face',
  layered: 'folded, rippling layers', iridescent: 'an oil-sheen of rainbow colour', rippled: 'glassy ripples', stonefleck: 'a speckled stone-like skin', forgescale: 'proud forge-scale',
  flamebloom: 'rose-and-violet heat blooms', riverwave: 'blue river-wave lines', tidal: 'concentric tide-rings', emberscale: 'glowing ember-scales', nebula: 'clouds of violet starlight',
};

function grip(item: Item) {
  const h = item.hilt!;
  const gm = hasMat(h.gripMaterial) ? mat(h.gripMaterial).name.toLowerCase() : h.gripMaterial;
  const wc = WRAP_COLORS.find((w) => w.hex === h.wrapColor)?.name.toLowerCase();
  const wrap = h.wrap === 'none' ? '' : h.wrap === 'wire' ? ' bound in twisted wire' : ` wrapped in ${wc ? wc + ' ' : ''}${optionName('wrap', h.wrap).toLowerCase().replace(' wrap', '')} cord`;
  return `${gm}${wrap}`;
}

export function generateDescription(item: Item): string {
  const s = item.stats ?? computeStats(item);
  const r = seededRng(item.seed, 'desc');
  const P = mat(item.materials.primary);
  const S = hasMat(item.materials.secondary) ? mat(item.materials.secondary) : null;
  const trad = tradition(item.tradition);
  const parts: string[] = [];
  const gradeAdj: Record<string, string> = { Legendary: 'breathtaking', Masterwork: 'masterful', Superior: 'superbly made', Fine: 'finely made', Serviceable: 'serviceable', Rough: 'roughly made but honest' };
  const dirAdj = optionName('direction', item.design.direction).toLowerCase();
  const verb = P.kind === 'crystal' ? 'ground' : item.tradition === 'glassgarden' ? 'grown and ground' : 'forged';
  const primaryDesc = `${r.pick(P.traits.slice(0, 2))} ${P.name.toLowerCase()}`;
  const fused = item.materials.fusedWith && hasMat(item.materials.fusedWith) ? ` fused with ${mat(item.materials.fusedWith).name.toLowerCase()}` : '';
  const article = /^[aeiou]/i.test(gradeAdj[s.grade]) ? 'An' : 'A';
  parts.push(`${article} ${gradeAdj[s.grade]}, ${dirAdj} ${item.category} ${verb} from ${primaryDesc}${fused}${S && item.category !== 'shield' ? ` with ${S.name.toLowerCase()} fittings` : ''}.`);

  if (item.blade) {
    const b = item.blade;
    let shape = `It has ${PROFILE_PHRASE[b.profile] ?? 'a blade'} ending in ${TIP_PHRASE[b.tip] ?? 'a point'}`;
    if (Math.abs(b.curve) > 0.25 && b.profile !== 'curved') shape += `, bending gently to the ${b.curve > 0 ? 'right' : 'left'}`;
    if (b.asymmetry > 0.3) shape += ', deliberately asymmetrical';
    parts.push(shape + '.');
  } else if (item.shield) {
    const sh = item.shield;
    const face = hasMat(sh.faceMaterial) ? mat(sh.faceMaterial).name.toLowerCase() : sh.faceMaterial;
    parts.push(`A ${optionName('shieldShape', sh.shape).toLowerCase()} shield with a ${face} face${sh.boss !== 'none' ? ` and a ${optionName('boss', sh.boss).toLowerCase()}` : ''}, rimmed in ${S?.name.toLowerCase() ?? 'metal'}.`);
  }

  const e = item.decoration.engraving;
  const surf = TEXTURE_PHRASE[item.surface.texture] ?? 'a plain surface';
  if (e.pattern !== 'none') {
    const hand = e.crispness > 0.82 ? 'cut with real precision' : e.crispness > 0.6 ? 'cut with a steady hand' : 'wandering here and there — clearly cut by hand';
    parts.push(`Its ${surf.replace(/^an? /, '')} carries a ${optionName('engraving', e.pattern).toLowerCase()} engraving${e.inlay ? ` inlaid in ${palette(item.design.palette).name.toLowerCase()} tones` : ''}, ${hand}.`);
  } else parts.push(`The surface shows ${surf}${item.finish.finish !== 'matte' ? ` under a ${optionName('finish', item.finish.finish).toLowerCase()} finish` : ''}.`);

  if (item.hilt) {
    const pom = optionName('pommel', item.hilt.pommel).toLowerCase();
    const gem = item.decoration.gems.find((g) => g.slot === 'pommel');
    parts.push(`The grip is ${grip(item)}, below a ${optionName('guard', item.hilt.guard).toLowerCase()} guard, ending in a ${pom} pommel${gem && hasMat(gem.gem) ? ` set with ${mat(gem.gem).name.toLowerCase()}` : ''}.`);
  }
  if (item.decoration.inscription.trim()) parts.push(`An inscription runs along the back: “${item.decoration.inscription.trim()}”.`);
  if (item.decoration.constellation) parts.push('A constellation of infused starlight glimmers beneath the surface.');
  if (item.decoration.stones.length) parts.push(`${item.decoration.stones.length} mountain stones are set by hand into the metal.`);

  // Distinguishing features
  const dist: string[] = [];
  if (item.blade && item.blade.asymmetry > 0.3) dist.push('asymmetrical form');
  if (decorPresence(item) > 0.5) dist.push('dense ornamentation');
  if (item.mutations.length) dist.push(`unexpected ${item.mutations.map((m) => MUTATION_WORDS[m] ?? m).join(' and ')}`);
  if (['weathered', 'forgescale', 'iridescent', 'nebula', 'layered'].includes(item.surface.texture)) dist.push(`${optionName('texture', item.surface.texture).toLowerCase()} surface`);
  if (['glow', 'aged', 'smoulder', 'prism', 'moonlit', 'verdigris'].includes(item.finish.finish)) dist.push(`${optionName('finish', item.finish.finish).toLowerCase()} finish`);
  if (dist.length) {
    const d = dist.slice(0, 2).join(' and ');
    const cmp = item.tradition === 'foundry' ? 'from the everyday work of the village' : `even among the work of ${trad.name}`;
    parts.push(`Its ${d} set${dist.length === 1 && !d.endsWith('s') ? 's' : ''} it apart ${cmp}.`);
  }

  // Craft notes: highlight best and weakest stage.
  const entries = Object.entries(item.quality).filter(([, v]) => v !== undefined) as [string, number][];
  if (entries.length) {
    entries.sort((a, b) => b[1] - a[1]);
    const [best, bv] = entries[0];
    const [worst, wv] = entries[entries.length - 1];
    if (bv > 0.85) parts.push(`${STAGE_WORDS[best] ?? 'The work'} is remarkable.`);
    if (wv < 0.45) parts.push(`${STAGE_WORDS[worst] ?? 'Some of the work'} is uneven — the marks of its making.`);
    else if (item.blemishes.length) parts.push(`${item.blemishes.length === 1 ? 'A single small flaw remains' : `${item.blemishes.length} small flaws remain`} — honest signs of the hand that made it.`);
  }
  return parts.join(' ');
}

const STAGE_WORDS: Record<string, string> = {
  prep: 'The forge-work on the metal', fold: 'The folding of its layers', shaping: 'The hammer work', structure: 'The grinding of its profile', inlay: 'The stone setting',
  surface: 'The surface work', assembly: 'The fit of its hilt', engraving: 'The engraving', infusion: 'The starlight infusion', finishing: 'The final finishing',
};
export const MUTATION_WORDS: Record<string, string> = {
  colorband: 'colour bands', speckle: 'starry speckling', ghostedge: 'ghostly translucent edges', veins: 'luminous veins', inverted: 'inverted shading', halo: 'soft halo',
};

export function computeTags(item: Item): string[] {
  const t = new Set<string>(collectDesignTags(item));
  for (const id of [item.materials.primary, item.materials.secondary, item.materials.fusedWith, item.hilt?.gripMaterial]) if (id && hasMat(id)) mat(id).traits.forEach((x) => t.add(x));
  for (const g of item.decoration.gems) if (hasMat(g.gem)) mat(g.gem).traits.forEach((x) => t.add(x));
  for (const st of item.decoration.stones) if (hasMat(st.stone)) mat(st.stone).traits.forEach((x) => t.add(x));
  palette(item.design.palette).tags.forEach((x) => t.add(x));
  t.add(item.tradition);
  t.add(item.materials.primary);
  if (item.blade && item.blade.asymmetry > 0.3) t.add('asymmetric');
  if (item.blemishes.length >= 3) t.add('handmade');
  if (item.decoration.inscription.trim()) t.add('inscribed');
  if (item.decoration.constellation) t.add('celestial');
  if (item.decoration.stones.length) t.add('mountain');
  if (decorPresence(item) > 0.45) t.add('ornate');
  if (decorPresence(item) < 0.12) t.add('minimal');
  if (item.mutations.length) t.add('strange');
  return [...t];
}
