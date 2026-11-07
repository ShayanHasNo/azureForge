// All creative options available during crafting. Availability is gated by
// traditions, workshop tools, discovered journals and material mastery — gates
// only ever add creative possibilities, never raw power.

export interface Gate {
  traditions?: string[]; // available only in these traditions (unless also unlocked otherwise)
  upgrade?: string; // workshop upgrade id required
  journal?: string; // historical journal id required
  mastery?: { material: string; level: number }; // material mastery requirement
  categories?: string[];
}

export interface OptionDef {
  id: string;
  name: string;
  desc: string;
  tags?: string[];
  gate?: Gate;
  /** Decorative complexity this option adds (0..1) */
  complexity?: number;
}

const o = (id: string, name: string, desc: string, tags: string[] = [], gate?: Gate, complexity = 0): OptionDef => ({ id, name, desc, tags, gate, complexity });

// -------------------------------------------------------------- design
export const DIRECTIONS: OptionDef[] = [
  o('elegant', 'Elegant', 'Long lines, fine proportions, restraint.', ['elegant', 'graceful']),
  o('heavy', 'Heavy-looking', 'Broad, weighty, reassuring.', ['heavy', 'mighty']),
  o('ornamental', 'Ornamental', 'A canvas for decoration.', ['ornate', 'decorative']),
  o('minimalist', 'Minimalist', 'Nothing that does not need to be there.', ['minimal', 'clean']),
  o('ancient', 'Ancient', 'As if pulled from a barrow mound.', ['ancient', 'historic']),
  o('rustic', 'Rustic', 'Honest village work with a handmade feel.', ['rustic', 'humble']),
  o('ceremonial', 'Ceremonial', 'Made for halls, oaths and processions.', ['ceremonial', 'regal']),
  o('nature', 'Nature-inspired', 'Leaves, roots, rivers and stone.', ['nature', 'wild']),
  o('experimental', 'Experimental', 'Break a rule or two on purpose.', ['experimental', 'strange']),
];

export const MOTIFS: OptionDef[] = [
  o('none', 'No motif', 'Let the material speak.'),
  o('vine', 'Vine', 'Curling growth.', ['nature', 'vine']),
  o('mountain', 'Mountain', 'Peaks and ridgelines.', ['mountain', 'earthy']),
  o('wave', 'Wave', 'River and tide.', ['river', 'wave', 'cool']),
  o('star', 'Star', 'Night sky and constellations.', ['celestial', 'starry']),
  o('sun', 'Sun', 'Warm radiance.', ['warm', 'sun']),
  o('moon', 'Moon', 'Pale and quiet.', ['lunar', 'cool']),
  o('flame', 'Flame', 'The forge itself.', ['fiery', 'warm']),
  o('knot', 'Knot', 'Bonds and family.', ['knot', 'ancient']),
  o('feather', 'Feather', 'Lightness and travel.', ['light', 'feather']),
  o('geometric', 'Geometric', 'Clean, repeated forms.', ['geometric', 'clean']),
];

export const INTENTS: OptionDef[] = [
  o('swift', 'Swift', 'Should feel light and quick.', ['swift']),
  o('steadfast', 'Steadfast', 'Should last a lifetime.', ['steadfast']),
  o('graceful', 'Graceful', 'Should be beautifully balanced.', ['graceful']),
  o('mighty', 'Mighty', 'Should feel heavy and powerful.', ['mighty']),
  o('mystic', 'Mystic', 'Should hum with quiet magic.', ['mystic']),
  o('humble', 'Humble', 'Should be simple and useful.', ['humble']),
  o('regal', 'Regal', 'Should be fit for a hall.', ['regal']),
  o('wild', 'Wild', 'Should feel untamed and organic.', ['wild']),
];

export interface PaletteDef { id: string; name: string; accent: string; wrap: string; inlay: string; glow: string; tags: string[] }
export const PALETTES: PaletteDef[] = [
  { id: 'hearth', name: 'Warm Hearth', accent: '#d8642a', wrap: '#8a2e1e', inlay: '#f0c060', glow: '#ffb060', tags: ['warm'] },
  { id: 'winter', name: 'Winter Steel', accent: '#9ec8e8', wrap: '#2e3e5a', inlay: '#e8f4ff', glow: '#bfe4ff', tags: ['cool'] },
  { id: 'forest', name: 'Deep Forest', accent: '#4a8a4a', wrap: '#2e4a2a', inlay: '#c8e090', glow: '#a8f0a0', tags: ['nature', 'verdant'] },
  { id: 'dusk', name: 'Dusk', accent: '#b0608a', wrap: '#4a2a4e', inlay: '#f0b0d0', glow: '#ff9ad0', tags: ['dusk'] },
  { id: 'seaglass', name: 'Sea Glass', accent: '#4ab8b0', wrap: '#1e4a52', inlay: '#b0f0e8', glow: '#90fff0', tags: ['cool', 'river'] },
  { id: 'royal', name: 'Royal', accent: '#5a4ac0', wrap: '#3a1e6a', inlay: '#f0d060', glow: '#d0b0ff', tags: ['regal', 'ceremonial'] },
  { id: 'ember', name: 'Ember', accent: '#e0401e', wrap: '#2a1414', inlay: '#ff9a3a', glow: '#ff7a30', tags: ['fiery', 'warm'] },
  { id: 'earth', name: 'Earthen', accent: '#9a7a4a', wrap: '#5a4430', inlay: '#d8c098', glow: '#e8d0a0', tags: ['earthy', 'rustic'] },
];

// -------------------------------------------------------------- geometry
export const PROFILES: OptionDef[] = [
  o('straight', 'Straight', 'A classic, even blade.', ['traditional'], { categories: ['sword', 'dagger'] }),
  o('tapered', 'Tapered', 'Narrows steadily to a fine point.', ['elegant'], { categories: ['sword', 'dagger'] }),
  o('leaf', 'Leaf', 'Swells gently before the tip, like a leaf.', ['nature', 'ancient'], { categories: ['sword', 'dagger'] }),
  o('broad', 'Broad', 'Wide and generous along its whole length.', ['heavy'], { categories: ['sword', 'dagger'] }),
  o('curved', 'Curved', 'A sweeping, single-edged curve.', ['graceful'], { categories: ['sword', 'dagger'] }),
  o('falchion', 'Falchion', 'Widens toward a heavy, clipped tip.', ['heavy', 'rustic'], { categories: ['sword', 'dagger'] }),
  o('needle', 'Needle', 'Very slender and light.', ['swift', 'elegant'], { categories: ['sword', 'dagger'] }),
  o('wavy', 'Flame-wave', 'Rippling edges like a candle flame.', ['experimental', 'fiery', 'ornate'], { traditions: ['patternwrights', 'experimental'], categories: ['sword', 'dagger'] }, 0.15),
  o('kopis', 'Kopis', 'Forward-curving ancient bronze-age blade.', ['ancient'], { mastery: { material: 'bronze', level: 3 }, categories: ['sword', 'dagger'] }, 0.05),
  o('thorn', 'Thorn', 'Narrow with tiny thorny barbs.', ['nature', 'strange'], { mastery: { material: 'gardenglass', level: 3 }, categories: ['sword', 'dagger'] }, 0.12),
  o('crag', 'Crag', 'Irregular, stone-like facets along the edge.', ['mountain', 'wild'], { traditions: ['mountain'], categories: ['sword', 'dagger'] }, 0.08),
  o('crystal', 'Crystal Spire', 'Faceted, prism-like segments.', ['translucent', 'delicate'], { traditions: ['glassgarden'], categories: ['sword', 'dagger'] }, 0.1),
];

export const TIPS: OptionDef[] = [
  o('point', 'Point', 'A symmetrical point.'),
  o('spear', 'Spear', 'A long, concave point.', ['swift']),
  o('clipped', 'Clipped', 'A clipped back edge.', ['practical']),
  o('rounded', 'Rounded', 'A gentle, rounded tip.', ['ceremonial', 'humble']),
  o('chisel', 'Chisel', 'A single angled cut.', ['rustic']),
  o('hooked', 'Hooked', 'A tip that hooks to one side.', ['strange', 'wild']),
  o('swallowtail', 'Swallowtail', 'A forked twin tip.', ['strange', 'ornate'], { mastery: { material: 'azuresteel', level: 3 } }, 0.08),
];

export const GUARDS: OptionDef[] = [
  o('straight', 'Crossguard', 'A straight cross with knobbed ends.', ['traditional']),
  o('downswept', 'Downswept', 'Quillons curving toward the hand.', ['elegant']),
  o('upswept', 'Upswept', 'Quillons curving toward the blade.', ['ornate']),
  o('disc', 'Disc', 'A round disc guard.', ['minimal']),
  o('winged', 'Winged', 'Flared, wing-like quillons.', ['ceremonial', 'feather'], undefined, 0.08),
  o('crescent', 'Crescent', 'A deep crescent arc.', ['lunar'], undefined, 0.06),
  o('knot', 'Knot', 'A knotted central boss.', ['knot', 'ancient'], undefined, 0.06),
  o('stub', 'Stub', 'A small, minimal stop.', ['minimal', 'swift']),
  o('ring', 'Ring', 'A crossguard with a side ring.', ['ornate'], { upgrade: 'finebench' }, 0.06),
  o('basket', 'Basket', 'A protective woven-bar guard.', ['heavy', 'steadfast'], { mastery: { material: 'iron', level: 3 } }, 0.12),
  o('talon', 'Talon', 'Clawed quillons like a dragon\'s grip.', ['fiery', 'wild'], { mastery: { material: 'dragonsteel', level: 3 } }, 0.12),
];

export const POMMELS: OptionDef[] = [
  o('round', 'Round', 'A simple ball pommel.', ['traditional']),
  o('disc', 'Disc', 'A flat wheel-like disc.', ['minimal']),
  o('faceted', 'Faceted', 'A cut, many-sided pommel.', ['geometric']),
  o('crescent', 'Crescent', 'A crescent cap.', ['lunar']),
  o('wheel', 'Wheel', 'A heavy wheel pommel.', ['heavy']),
  o('ring', 'Ring', 'An open ring.', ['light', 'ancient']),
  o('teardrop', 'Teardrop', 'A tapering drop.', ['elegant']),
  o('crown', 'Crown', 'A pointed crown.', ['regal', 'ceremonial'], undefined, 0.08),
  o('fishtail', 'Fishtail', 'A split, flaring end.', ['ancient', 'wild']),
  o('gearwheel', 'Gearwheel', 'A toothed brass gear.', ['strange', 'ornate'], { mastery: { material: 'brass', level: 5 } }, 0.12),
];

export const WRAPS: OptionDef[] = [
  o('none', 'Bare grip', 'Show the grip material itself.', ['minimal']),
  o('spiral', 'Spiral wrap', 'A diagonal spiral cord.', ['traditional']),
  o('crosshatch', 'Cross-hatch', 'Diamond-pattern binding.', ['ornate'], undefined, 0.05),
  o('bands', 'Bands', 'Spaced bands of cord.', ['rustic']),
  o('braided', 'Braided', 'Chevron braid.', ['ornate', 'knot'], undefined, 0.06),
  o('wire', 'Wire twist', 'Twisted fine wire in the fitting metal.', ['elegant'], { upgrade: 'finebench' }, 0.08),
];

export const WRAP_COLORS = [
  { id: 'crimson', name: 'Crimson', hex: '#8a2430' },
  { id: 'forest', name: 'Forest', hex: '#2e5a32' },
  { id: 'navy', name: 'Navy', hex: '#24305a' },
  { id: 'ochre', name: 'Ochre', hex: '#b88a2e' },
  { id: 'plum', name: 'Plum', hex: '#5a2a5a' },
  { id: 'charcoal', name: 'Charcoal', hex: '#2e2e34' },
  { id: 'cream', name: 'Cream', hex: '#e0d4b4' },
  { id: 'teal', name: 'Teal', hex: '#2a7a7a' },
  { id: 'palette', name: 'Design palette', hex: '' },
];

// -------------------------------------------------------------- structure
export interface ApproachDef extends OptionDef { mods: { durability: number; weight: number; flexibility: number; balance: number; ornament: number; integrity: number; variance: number } }
export const APPROACHES: ApproachDef[] = [
  { ...o('balanced', 'Balanced', 'Even thickness and an honest spine. No weaknesses, no extremes.'), mods: { durability: 0, weight: 0, flexibility: 0, balance: 0.06, ornament: 0, integrity: 0.03, variance: 0 } },
  { ...o('reinforced', 'Reinforced', 'A thick central ridge. Tough and heavy; less flexible.', ['steadfast', 'heavy']), mods: { durability: 0.14, weight: 0.18, flexibility: -0.14, balance: -0.04, ornament: -0.03, integrity: 0.1, variance: 0 } },
  { ...o('lightweight', 'Lightweight', 'Deep fullers and a thin section. Quick and lively, a little fragile.', ['swift', 'light']), mods: { durability: -0.1, weight: -0.22, flexibility: 0.14, balance: 0.04, ornament: 0, integrity: -0.06, variance: 0 } },
  { ...o('ornamental', 'Ornamental', 'A wide flat for decoration. Beautiful canvas; modest strength.', ['ornate']), mods: { durability: -0.06, weight: 0.02, flexibility: 0, balance: -0.02, ornament: 0.16, integrity: -0.04, variance: 0 } },
  { ...o('experimental', 'Experimental', 'Unusual internal structure. Results vary wildly — sometimes wonderfully.', ['experimental', 'strange']), mods: { durability: 0, weight: 0, flexibility: 0, balance: 0, ornament: 0.05, integrity: 0, variance: 0.18 } },
];

// -------------------------------------------------------------- forging method (daggers)
export const METHODS: OptionDef[] = [
  o('standard', 'Standard forging', 'A single, honest billet.'),
  o('damascus', 'Damascus', 'Stack, fold and etch two metals into one of 1000 collectible patterns. How clearly the pattern shows depends on your forging — and a little luck.', ['pattern', 'ornate'], { categories: ['dagger'] }, 0.15),
];

export const FULLERS: OptionDef[] = [
  o('none', 'None', 'A plain flat section.'),
  o('single', 'Single fuller', 'One central groove.', ['traditional']),
  o('double', 'Twin fullers', 'Two narrow grooves.', ['elegant'], undefined, 0.04),
  o('ridge', 'Central ridge', 'A raised diamond ridge.', ['steadfast']),
];

// -------------------------------------------------------------- surface
export const TEXTURES: OptionDef[] = [
  o('smooth', 'Smooth', 'An even, quiet surface. Rewards complete, even coverage.', ['clean', 'minimal']),
  o('brushed', 'Brushed', 'Fine parallel grain. Rewards long, consistent vertical strokes.', ['practical']),
  o('hammered', 'Hammered', 'Visible peen marks. Rewards evenly spaced dabs.', ['rustic', 'handmade'], undefined, 0.05),
  o('weathered', 'Weathered', 'Wind-worn and patinated. Rewards varied, loose coverage.', ['ancient', 'mountain', 'rustic'], undefined, 0.05),
  o('reflective', 'Reflective', 'Mirror-bright. Rewards slow, steady, complete passes.', ['bright', 'ceremonial'], { upgrade: 'wheel' }),
  o('layered', 'Layered pattern', 'Folded two-metal waves. Needs a contrasting secondary metal.', ['ornate', 'pattern'], { traditions: ['patternwrights', 'experimental'], journal: 'journal_folds' }, 0.18),
  o('iridescent', 'Iridescent', 'Rainbow oil-sheen colours.', ['magical', 'strange'], { traditions: ['celestial', 'glassgarden', 'experimental'] }, 0.12),
  o('rippled', 'Rippled', 'Glass-like ripples across the surface.', ['translucent', 'river'], { traditions: ['glassgarden'] }, 0.08),
  o('stonefleck', 'Stone-flecked', 'Speckled like river granite.', ['mountain', 'earthy'], { traditions: ['mountain'] }, 0.06),
  o('forgescale', 'Forge-scale', 'Dark fire-scale left proudly on the steel.', ['rustic', 'fiery'], { mastery: { material: 'iron', level: 1 } }, 0.06),
  o('flamebloom', 'Flame-bloom', 'Heat-tinted blooms of rose and violet.', ['fiery', 'strange'], { mastery: { material: 'copper', level: 5 } }, 0.12),
  o('riverwave', 'River-wave', 'Blue-grey flowing lines.', ['river', 'cool'], { mastery: { material: 'azuresteel', level: 1 } }, 0.1),
  o('tidal', 'Tidal', 'Concentric tide-rings.', ['lunar', 'river'], { mastery: { material: 'moonstone', level: 3 } }, 0.1),
  o('emberscale', 'Ember-scale', 'Glowing scale-like plates.', ['fiery', 'mountain'], { mastery: { material: 'dragonsteel', level: 1 } }, 0.12),
  o('nebula', 'Nebula', 'Clouds of violet starlight.', ['celestial', 'magical'], { mastery: { material: 'starmetal', level: 5 } }, 0.16),
];

// -------------------------------------------------------------- decoration
export const ENGRAVINGS: OptionDef[] = [
  o('none', 'No engraving', 'Leave the blade clean.'),
  o('vine', 'Vine', 'A curling vine with leaves.', ['nature', 'vine'], undefined, 0.3),
  o('waves', 'Waves', 'Twin flowing lines.', ['river', 'wave'], undefined, 0.25),
  o('geometric', 'Geometric', 'Zigzags and diamonds.', ['geometric'], undefined, 0.25),
  o('mountains', 'Ridgeline', 'A mountain ridge near the guard.', ['mountain'], undefined, 0.2),
  o('runes', 'Runes', 'A column of old runes.', ['ancient', 'mystic'], undefined, 0.35),
  o('knotwork', 'Knotwork', 'Interlaced crossing bands.', ['knot', 'ancient'], { upgrade: 'loupe', journal: 'journal_ancients' }, 0.45),
  o('stars', 'Starfield', 'Scattered stars on a thread of light.', ['celestial', 'starry'], undefined, 0.3),
  o('flames', 'Flames', 'Tongues of flame rising from the guard.', ['fiery'], undefined, 0.35),
  o('feather', 'Feather', 'A central quill with angled barbs.', ['feather', 'light'], { upgrade: 'loupe' }, 0.4),
  o('filigree', 'Filigree', 'Delicate brass scrollwork.', ['ornate'], { mastery: { material: 'brass', level: 1 } }, 0.55),
  o('braid', 'Braid', 'A three-strand braid.', ['knot', 'ornate'], { mastery: { material: 'copper', level: 3 } }, 0.5),
  o('tally', 'Tally marks', 'Honest notches, one for every lesson.', ['rustic', 'humble'], { mastery: { material: 'iron', level: 5 } }, 0.2),
  o('lacework', 'Lacework', 'Silver-fine lace ovals.', ['ornate', 'ceremonial'], { mastery: { material: 'silver', level: 1 } }, 0.55),
  o('constellation', 'Constellation', 'Joined stars of a named sky.', ['celestial'], { mastery: { material: 'starmetal', level: 1 } }, 0.5),
  o('petal', 'Petals', 'Falling glassgarden petals.', ['nature', 'delicate'], { mastery: { material: 'gardenglass', level: 1 } }, 0.45),
];

export const EMBLEMS: OptionDef[] = [
  o('none', 'No emblem', ''),
  o('sun', 'Sun', '', ['sun', 'warm']),
  o('moon', 'Moon', '', ['lunar']),
  o('leaf', 'Leaf', '', ['nature']),
  o('mountain', 'Mountain', '', ['mountain']),
  o('star', 'Star', '', ['celestial']),
  o('wave', 'Wave', '', ['river']),
  o('hammer', 'Hammer', '', ['humble', 'traditional']),
  o('crown', 'Crown', '', ['regal']),
  o('eye', 'Eye', '', ['mystic', 'strange']),
  o('flame', 'Flame', '', ['fiery']),
  o('key', 'Key', '', ['ancient']),
  o('laurel', 'Laurel', '', ['ancient', 'regal'], { mastery: { material: 'bronze', level: 1 } }),
  o('crescent', 'Crescent', '', ['lunar'], { mastery: { material: 'moonstone', level: 1 } }),
  o('chalice', 'Chalice', '', ['ceremonial'], { mastery: { material: 'silver', level: 5 } }),
  o('comet', 'Comet', '', ['celestial'], { mastery: { material: 'starmetal', level: 3 } }),
];

export const FINISHES: OptionDef[] = [
  o('matte', 'Matte', 'Soft, low-sheen, understated.', ['minimal', 'practical']),
  o('glossy', 'Glossy', 'Deep shine with bright glints.', ['bright']),
  o('aged', 'Aged', 'Darkened and storied, like an heirloom.', ['ancient', 'historic']),
  o('etched', 'Etched pattern', 'A fine etched diamond lattice.', ['geometric', 'ornate'], undefined, 0.12),
  o('polished', 'Decorative polish', 'Sparkling high points.', ['bright', 'ceremonial']),
  o('contrast', 'Contrasting edges', 'Edges inlaid in the secondary metal.', ['ornate', 'pattern'], undefined, 0.12),
  o('glow', 'Fantasy glow', 'A gentle aura. Needs a magically receptive material.', ['magical', 'mystic'], { traditions: ['celestial', 'experimental', 'glassgarden'] }, 0.1),
  o('frosted', 'Frosted', 'A pale satin frost.', ['cool', 'delicate'], { traditions: ['glassgarden', 'celestial'] }),
  o('rosegold', 'Rose-gold wash', 'A blush of copper over gold.', ['warm', 'ornate'], { mastery: { material: 'brass', level: 3 } }, 0.06),
  o('verdigris', 'Verdigris', 'Sea-green copper patina.', ['ancient', 'nature'], { mastery: { material: 'copper', level: 1 } }, 0.06),
  o('heirloom', 'Heirloom', 'Generations of hand-polish.', ['ancient', 'historic'], { mastery: { material: 'bronze', level: 5 } }, 0.06),
  o('mirror', 'True mirror', 'A finish so bright it reflects the sky.', ['bright', 'ceremonial'], { mastery: { material: 'silver', level: 3 } }, 0.06),
  o('deepblue', 'Deep-blue temper', 'Oil-blued steel.', ['cool', 'river'], { mastery: { material: 'azuresteel', level: 5 } }, 0.06),
  o('moonlit', 'Moonlit', 'Faint silver light beneath the surface.', ['lunar', 'magical'], { mastery: { material: 'moonstone', level: 5 } }, 0.08),
  o('smoulder', 'Smoulder', 'Embers that never quite go out.', ['fiery', 'magical'], { mastery: { material: 'dragonsteel', level: 5 } }, 0.1),
  o('prism', 'Prism', 'Splits light into colour bands.', ['translucent', 'magical'], { mastery: { material: 'gardenglass', level: 5 } }, 0.1),
];

// -------------------------------------------------------------- shields
export const SHIELD_SHAPES: OptionDef[] = [
  o('round', 'Round', 'A classic round shield.', ['traditional']),
  o('heater', 'Heater', 'Flat top, curved to a point.', ['ceremonial']),
  o('kite', 'Kite', 'Long and tapering.', ['elegant']),
  o('tower', 'Tower', 'Tall and broad.', ['heavy', 'steadfast']),
  o('buckler', 'Buckler', 'Small and quick.', ['swift', 'minimal']),
];
export const BOSSES: OptionDef[] = [
  o('dome', 'Dome boss', 'A raised dome.'),
  o('spike', 'Spiked boss', 'A pointed boss.', ['wild']),
  o('flat', 'Flat boss', 'A low disc.', ['minimal']),
  o('none', 'No boss', 'A plain face.', ['minimal']),
];

export const ALL_OPTION_LISTS: Record<string, OptionDef[]> = {
  direction: DIRECTIONS, motif: MOTIFS, intent: INTENTS, profile: PROFILES, tip: TIPS, guard: GUARDS, pommel: POMMELS,
  wrap: WRAPS, texture: TEXTURES, engraving: ENGRAVINGS, emblem: EMBLEMS, finish: FINISHES, fuller: FULLERS,
  approach: APPROACHES, method: METHODS, shieldShape: SHIELD_SHAPES, boss: BOSSES,
};

export function findOption(list: string, id: string): OptionDef | undefined {
  return ALL_OPTION_LISTS[list]?.find((x) => x.id === id);
}
export function optionName(list: string, id: string): string {
  return findOption(list, id)?.name ?? id;
}
export function palette(id: string): PaletteDef {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}
