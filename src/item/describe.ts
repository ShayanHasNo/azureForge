// Dynamic naming and description, composed from the item's actual properties.

import { seededRng } from '../core/rng.js';
import { hasMat, mat } from '../data/materials.js';
import { optionName, palette, WRAP_COLORS } from '../data/options.js';
import { tradition } from '../data/traditions.js';
import { collectDesignTags, computeStats, decorPresence } from './stats.js';
import type { Item } from './types.js';
import { FAMILY_INFO, patternSpec, rareColor } from './damascus.js';

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
  steel: ['Steel', 'Keen', 'True'], sunbronze: ['Sun', 'Gold', 'Noon'], crucible: ['Watered', 'Crucible', 'Mirror'], meteoric: ['Sky-iron', 'Fallen', 'Thunder'],
};
const SUFFIX = ['song', 'fang', 'warden', 'light', 'thorn', 'keeper', 'whisper', 'fall', 'mark', 'heart', 'call', 'ward', 'tide', 'bloom', 'brand'];
const NOUNS: Record<string, string[]> = {
  sword: ['Blade', 'Sword', 'Brand', 'Edge', 'Longblade'], dagger: ['Dagger', 'Knife', 'Fang', 'Thorn', 'Dirk'], shield: ['Shield', 'Ward', 'Bulwark', 'Aegis', 'Guard'],
  bow: ['Bow', 'Stave', 'Bough', 'Bender'], arrows: ['Sheaf', 'Flight', 'Quiver', 'Arrows'], armor: ['Coat', 'Harness', 'Ward', 'Mantle'],
};
const DIRECTION_ADJ: Record<string, string[]> = {
  elegant: ['Graceful', 'Slender', 'Willow'], heavy: ['Stout', 'Heavy', 'Broad'], ornamental: ['Gilded', 'Ornate', 'Adorned'], minimalist: ['Plain', 'Quiet', 'Clean'],
  ancient: ['Old', 'Barrow', 'Elder'], rustic: ['Hearth', 'Village', 'Homespun'], ceremonial: ['Oath', 'Hall', 'Crowned'], nature: ['Wild', 'Green', 'Rooted'],
  experimental: ['Curious', 'Strange', 'Wandering'],
};
const PLACES = ['the Hollow', 'Low Mill', 'the Ridge', 'the Long Field', 'Saltbrook', 'the Old Road', 'Winterbarrow', 'the Quiet Forge', 'Ashford', 'the Lantern Hill'];

export function generateName(item: Item): string {
  const r = seededRng(item.seed, 'name');
  const motif = MOTIF_WORDS[item.design.motif] ?? MOTIF_WORDS.none;
  const mw = MAT_WORDS[item.materials.primary] ?? (hasMat(item.materials.primary) ? [mat(item.materials.primary).name.split(' ')[0]] : ['Iron']);
  let nouns = NOUNS[item.category] ?? ['Work'];
  if (item.bow) nouns = [...nouns, { longbow: 'Longbow', flatbow: 'Flatbow', recurve: 'Recurve', reflex: 'Hornbow' }[item.bow.profile] ?? 'Bow'];
  if (item.armor) nouns = [...nouns, ...({ gambeson: ['Gambeson', 'Aketon'], cuirbouilli: ['Cuirass', 'Jerkin'], mail: ['Hauberk', 'Byrnie'], scale: ['Scale Coat', 'Lamellar'], brigandine: ['Brigandine', 'Coat of Plates'], plate: ['Cuirass', 'Breastplate'] }[item.armor.method] ?? [])];
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
  watered: 'a fine watered grain', widmanstatten: 'crossing sky-crystal bands', rayed: 'fine rays spreading from the guard',
};

function grip(item: Item) {
  const h = item.hilt!;
  const gm = hasMat(h.gripMaterial) ? mat(h.gripMaterial).name.toLowerCase() : h.gripMaterial;
  const wc = WRAP_COLORS.find((w) => w.hex === h.wrapColor)?.name.toLowerCase();
  const wrap = h.wrap === 'none' ? '' : h.wrap === 'wire' ? ' bound in twisted wire' : ` wrapped in ${wc ? wc + ' ' : ''}${optionName('wrap', h.wrap).toLowerCase().replace(' wrap', '')} cord`;
  return `${gm}${wrap}`;
}

/** Descriptions for bows, arrows and armour: what it is, how it was built, and how the making went. */
function craftDescription(item: Item): string {
  const s = item.stats ?? computeStats(item);
  const nm = (id?: string) => (id && hasMat(id) ? mat(id).name.toLowerCase() : '');
  const gradeAdj: Record<string, string> = { Legendary: 'breathtaking', Masterwork: 'masterful', Superior: 'superbly made', Fine: 'finely made', Serviceable: 'serviceable', Rough: 'roughly made but honest' };
  const art = /^[aeiou]/i.test(gradeAdj[s.grade]) ? 'An' : 'A';
  const parts: string[] = [];
  if (item.bow) {
    const b = item.bow;
    const kind = { self: 'self bow', backed: `${nm(b.backing) || 'sinew'}-backed bow`, laminated: 'laminated bow', composite: 'composite horn bow' }[item.design.method ?? 'self'] ?? 'bow';
    const shape = { longbow: 'a tall, deep-bellied longbow', flatbow: 'a wide-limbed flatbow', recurve: 'a recurve, its tips swept forward', reflex: 'a reflex-deflex bow, its handle set back' }[b.profile] ?? 'a bow';
    parts.push(`${art} ${gradeAdj[s.grade]} ${kind} of ${nm(item.materials.primary)}: ${shape}${b.belly ? `, with a belly of ${nm(b.belly)}` : ''}${item.design.method === 'laminated' && b.backing ? `, backed with a strip of ${nm(b.backing)}` : ''}.`);
    const errs = [...b.upper, ...b.lower].map((e) => Math.abs(e));
    const even = 1 - errs.reduce((p, v) => p + v, 0) / Math.max(1, errs.length) / 0.55;
    parts.push(b.hinge > 0.3 ? 'One limb has a hinge where too much wood came off — it will shoot, but it should not be drawn hard.'
      : even > 0.85 ? 'Both limbs bend in one clean, even arc from grip to nock.' : even > 0.6 ? 'The limbs bend evenly, with a flat spot here and there.' : 'The limbs are still stiff in places, and do not quite match.');
    parts.push(`It draws about ${s.drawWeight ?? 40} pounds, strung with ${nm(b.string) || 'linen'}${b.stringQuality > 0.85 ? ' twisted tight and even' : b.stringQuality < 0.5 ? ' that is loose in places' : ''}${b.nock ? `, with ${nm(b.nock)} nocks` : ''}, and the grip is bound in ${nm(b.gripMaterial) || 'leather'}.`);
  } else if (item.arrows) {
    const a = item.arrows;
    const head = { bodkin: 'bodkin points', broadhead: 'barbed broadheads', leaf: 'slim leaf points', flint: 'knapped stone points' }[a.point] ?? 'points';
    const vane = { parabolic: 'low parabolic', shield: 'shield-cut', traditional: 'long triangular' }[a.fletch] ?? '';
    parts.push(`${art} ${gradeAdj[s.grade]} set of ${a.count} arrows: ${nm(item.materials.primary)} shafts, ${head} of ${nm(item.materials.secondary)}, and ${vane} fletchings of ${nm(item.materials.grip)} bound with ${nm(a.binding) || 'thread'}.`);
    const st = a.straight.reduce((p, v) => p + v, 0) / Math.max(1, a.straight.length);
    parts.push(st > 0.88 ? 'Every shaft is straight as a ray.' : st > 0.7 ? 'Most of the shafts are true; one or two still carry a slight bow.' : 'Several shafts still bow to one side.');
    parts.push((s.consistency ?? 0) > 80 ? 'They are closely matched in spine and fletching, and will fly alike.' : (s.consistency ?? 0) > 55 ? 'They are a fair match for one another.' : 'They are a mixed lot: each will fly a little differently.');
    if (a.nock) parts.push(`The nocks are reinforced with slivers of ${nm(a.nock)}.`);
  } else if (item.armor) {
    const a = item.armor;
    const kind = { gambeson: 'quilted gambeson', cuirbouilli: 'cuirass of hardened leather', mail: 'coat of riveted mail', scale: 'coat of laced scales', brigandine: 'brigandine', plate: 'plate cuirass' }[a.method] ?? 'armour';
    const cut = { vest: 'cut short and sleeveless', jack: 'hip-length, with short sleeves', coat: 'skirted to the thigh' }[a.cut] ?? '';
    const of = a.method === 'brigandine' ? `${nm(item.materials.primary)} plates under ${nm(item.materials.grip)}, studded with ${nm(item.materials.secondary)} rivets`
      : a.method === 'gambeson' ? `${nm(item.materials.primary)} stuffed with ${nm(item.materials.grip)}`
      : a.method === 'scale' ? `${nm(item.materials.primary)} laced with ${nm(item.materials.grip)}` : nm(item.materials.primary);
    parts.push(`${art} ${gradeAdj[s.grade]} ${kind} of ${of}, ${cut}.`);
    const even = a.even.reduce((p, v) => p + v, 0) / Math.max(1, a.even.length);
    const work = { gambeson: 'stitching', cuirbouilli: 'strap-work', mail: 'links', scale: 'lacing', brigandine: 'rivets', plate: 'riveting' }[a.method] ?? 'work';
    parts.push(even > 0.85 && a.gaps < 0.08 ? `The ${work} ${work.endsWith('s') ? 'are' : 'is'} close, even and without a gap.` : even > 0.65 ? `The ${work} ${work.endsWith('s') ? 'are' : 'is'} sound, a little uneven in places.` : `The ${work} ${work.endsWith('s') ? 'wander' : 'wanders'}, and ${a.gaps > 0.2 ? 'there are gaps a point could find' : 'shows the hand that made it'}.`);
    const dent = a.dents.reduce((p, v) => p + v, 0) / Math.max(1, a.dents.length);
    if (['plate', 'cuirbouilli'].includes(a.method)) parts.push(dent < 0.12 ? 'Its surface is smooth and true.' : dent < 0.3 ? 'A few low hammer marks remain.' : 'It is still lumpy from the forming.');
    parts.push(`It turns ${(s.protCut ?? 0) >= (s.protBlunt ?? 0) ? 'a cut better than a blow' : 'a blow better than a cut'}, and ${(s.mobility ?? 0) > 70 ? 'moves easily with the body' : (s.mobility ?? 0) > 50 ? 'is no great burden to wear' : 'is heavy to move in'}.`);
  }
  const e = item.decoration.engraving;
  if (e.pattern !== 'none') parts.push(`It is tooled with a ${optionName('engraving', e.pattern).toLowerCase()} pattern${e.crispness > 0.8 ? ', cut with real precision' : ''}.`);
  if (item.decoration.emblem !== 'none') parts.push(`It bears a ${optionName('emblem', item.decoration.emblem).toLowerCase()} emblem.`);
  if (item.blemishes.length) parts.push(`${item.blemishes.length === 1 ? 'A single small flaw remains' : `${item.blemishes.length} small flaws remain`} — honest signs of the hand that made it.`);
  return parts.join(' ');
}

export function generateDescription(item: Item): string {
  if (item.bow || item.arrows || item.armor) return craftDescription(item);
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
  } else parts.push(`It has ${surf}${item.finish.finish !== 'matte' ? ` under a ${optionName('finish', item.finish.finish).toLowerCase()} finish` : ' and a soft matte finish'}.`);

  if (item.hilt) {
    const pom = optionName('pommel', item.hilt.pommel).toLowerCase();
    const gem = item.decoration.gems.find((g) => g.slot === 'pommel');
    parts.push(`The grip is ${grip(item)}, below a ${optionName('guard', item.hilt.guard).toLowerCase()} guard, ending in a ${pom} pommel${gem && hasMat(gem.gem) ? ` set with ${mat(gem.gem).name.toLowerCase()}` : ''}.`);
  }
  if (item.decoration.inscription.trim()) parts.push(`An inscription runs along the back: “${item.decoration.inscription.trim()}”.`);
  if (item.decoration.constellation) parts.push('A constellation of infused starlight glimmers beneath the surface.');
  if (item.decoration.stones.length) parts.push(`${item.decoration.stones.length} mountain stones are set by hand into the metal.`);
  const dm = item.surface.damascus;
  if (dm) {
    const rc = rareColor(dm.color);
    const v = dm.visibility;
    parts.push(`Its Damascus steel carries pattern #${dm.index}, a ${FAMILY_INFO[patternSpec(dm.index).family].name.toLowerCase()} pattern ${v >= 0.85 ? 'standing out crisp and bright' : v >= 0.6 ? 'clearly visible in the steel' : v >= 0.35 ? 'showing softly through the surface' : 'only a ghost beneath the polish'}${rc ? `, its layers blooming a rare ${rc.name.toLowerCase()}` : ''}.`);
  }

  // Distinguishing features
  const dist: string[] = [];
  if (item.blade && item.blade.asymmetry > 0.3) dist.push('asymmetrical form');
  if (decorPresence(item) > 0.5) dist.push('dense ornamentation');
  if (rareColor(item.surface.damascus?.color)) dist.push(`rare ${rareColor(item.surface.damascus?.color)!.name} Damascus`);
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
  for (const id of [item.materials.primary, item.materials.secondary, item.materials.fusedWith, item.hilt?.gripMaterial, item.bow?.backing, item.bow?.belly, item.arrows || item.armor || item.bow ? item.materials.grip : undefined]) if (id && hasMat(id)) mat(id).traits.forEach((x) => t.add(x));
  t.add(item.category);
  if (item.design.method) t.add(item.design.method);
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
