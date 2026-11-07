// Crafting traditions. Each has its own stage sequence, minigame variants,
// material palette and decorative language — they are not cosmetic skins.

export type StageId =
  | 'design' | 'materials' | 'heat' | 'anneal' | 'fusion' | 'fold' | 'damascus' | 'hammer' | 'grind'
  | 'inlay' | 'surface' | 'hilt' | 'engrave' | 'infusion' | 'finish' | 'appraisal';

export interface TraditionDef {
  id: string;
  name: string;
  blurb: string;
  philosophy: string;
  color: string;
  stages: StageId[];
  /** Stages whose order the player may rearrange (Experimental). */
  reorderable?: StageId[];
  /** Allowed primary materials. */
  primaries: string[];
  /** Base difficulty tier 1 (beginner) .. 4 (master). */
  tier: number;
  hammerStyle: 'steady' | 'heavy' | 'melodic' | 'syncopated' | 'wild';
  grindMode: 'symmetric' | 'organic' | 'delicate' | 'free';
  surfaceMode?: 'polish' | 'weather' | 'clarity';
  /** Extra decorative tags this tradition favours (affects cohesion). */
  favours: string[];
  unlock: { start?: boolean; reputation?: number; friend?: { npc: string; level: number }; journal?: string; hint: string };
  quirks?: boolean;
}

const ALL_METALS = ['brass', 'copper', 'bronze', 'iron', 'silver', 'azuresteel', 'moonstone', 'dragonsteel', 'starmetal'];

export const TRADITIONS: TraditionDef[] = [
  {
    id: 'foundry', name: 'Traditional Foundry', color: '#d88a3a',
    blurb: 'Balanced, dependable, honest work.',
    philosophy: 'Recognisable shapes and warm metal. The Foundry rewards steady hands and patient fundamentals — every stage, done well.',
    stages: ['design', 'materials', 'heat', 'hammer', 'grind', 'surface', 'hilt', 'engrave', 'finish', 'appraisal'],
    primaries: ALL_METALS, tier: 1, hammerStyle: 'steady', grindMode: 'symmetric', surfaceMode: 'polish',
    favours: ['traditional', 'practical', 'humble', 'warm'],
    unlock: { start: true, hint: 'Your grandmother\'s tradition.' },
  },
  {
    id: 'patternwrights', name: 'The Patternwrights', color: '#c25a8a',
    blurb: 'Folded layers and elaborate surfaces.',
    philosophy: 'Two metals become one through folding. Patternwrights add a folding stage with syncopated rhythms and judge their work by the clarity of its layers.',
    stages: ['design', 'materials', 'heat', 'fold', 'hammer', 'grind', 'surface', 'hilt', 'engrave', 'finish', 'appraisal'],
    primaries: ALL_METALS, tier: 2, hammerStyle: 'syncopated', grindMode: 'symmetric', surfaceMode: 'polish',
    favours: ['ornate', 'pattern', 'geometric', 'decorative'],
    unlock: { reputation: 12, journal: 'journal_folds', hint: 'Earn 12 reputation, or find the Patternwright journal in the Abandoned Workshop.' },
  },
  {
    id: 'celestial', name: 'The Celestial Atelier', color: '#8a7ae0',
    blurb: 'Starlight, runes and gentle glow.',
    philosophy: 'Metal that remembers the sky. The Atelier adds a starlight infusion stage — tracing living constellations — and favours runes, glow and iridescence.',
    stages: ['design', 'materials', 'heat', 'hammer', 'grind', 'surface', 'hilt', 'engrave', 'infusion', 'finish', 'appraisal'],
    primaries: ['silver', 'moonstone', 'starmetal', 'azuresteel', 'gardenglass', 'brass'], tier: 3, hammerStyle: 'melodic', grindMode: 'symmetric', surfaceMode: 'polish',
    favours: ['celestial', 'lunar', 'mystic', 'magical', 'starry'],
    unlock: { reputation: 30, friend: { npc: 'lyra', level: 3 }, hint: 'Befriend Lyra the astronomer, or earn 30 reputation.' },
  },
  {
    id: 'mountain', name: 'The Mountain Artisans', color: '#8a9a6a',
    blurb: 'Rugged, organic, stone-set.',
    philosophy: 'The mountain does not care for symmetry. Artisans strike with heavy charged blows, grind to organic lines, set stones by hand, and weather their surfaces rather than polishing them.',
    stages: ['design', 'materials', 'heat', 'hammer', 'grind', 'inlay', 'surface', 'hilt', 'finish', 'appraisal'],
    primaries: ['iron', 'bronze', 'dragonsteel', 'copper', 'brass', 'azuresteel'], tier: 2, hammerStyle: 'heavy', grindMode: 'organic', surfaceMode: 'weather',
    favours: ['mountain', 'earthy', 'rustic', 'wild', 'ancient'],
    unlock: { reputation: 20, friend: { npc: 'brannoc', level: 2 }, hint: 'Befriend Brannoc the mountain trader, or earn 20 reputation.' },
  },
  {
    id: 'glassgarden', name: 'The Glassgarden', color: '#4ac0a0',
    blurb: 'Delicate crystal and bright colour.',
    philosophy: 'Crystal is grown and ground, never beaten. Glassgarden work replaces the forge with a slow annealing curve, skips the hammer entirely, and judges surfaces by clarity.',
    stages: ['design', 'materials', 'anneal', 'grind', 'surface', 'hilt', 'engrave', 'finish', 'appraisal'],
    primaries: ['gardenglass', 'moonstone', 'silver', 'copper'], tier: 3, hammerStyle: 'steady', grindMode: 'delicate', surfaceMode: 'clarity',
    favours: ['nature', 'translucent', 'delicate', 'verdant', 'bright'],
    unlock: { reputation: 26, friend: { npc: 'wren', level: 3 }, hint: 'Befriend Wren of the Glassgarden, or earn 26 reputation.' },
  },
  {
    id: 'experimental', name: 'The Experimental Workshop', color: '#e0c040',
    blurb: 'No rules. Fuse, reorder, surprise.',
    philosophy: 'An old tinkerer\'s way: fuse any two metals, reorder the middle of the process however you like, and accept that every minigame may have a quirk. Results vary — sometimes spectacularly.',
    stages: ['design', 'materials', 'fusion', 'hammer', 'grind', 'surface', 'engrave', 'hilt', 'finish', 'appraisal'],
    reorderable: ['hammer', 'grind', 'surface', 'engrave'],
    primaries: [...ALL_METALS, 'gardenglass'], tier: 2, hammerStyle: 'wild', grindMode: 'free', surfaceMode: 'polish',
    favours: ['experimental', 'strange', 'magical'],
    unlock: { journal: 'journal_tinkerer', hint: 'Find the Tinkerer\'s notebook somewhere out in the world.' },
    quirks: true,
  },
];

export function tradition(id: string): TraditionDef {
  return TRADITIONS.find((t) => t.id === id) ?? TRADITIONS[0];
}

export const STAGE_INFO: Record<StageId, { name: string; icon: string; blurb: string }> = {
  design: { name: 'Concept & Design', icon: '✎', blurb: 'Decide what this piece wants to be.' },
  materials: { name: 'Materials', icon: '◆', blurb: 'Choose the metals and materials.' },
  heat: { name: 'Material Preparation', icon: '♨', blurb: 'Bring the metal to condition in the forge.' },
  anneal: { name: 'Annealing', icon: '❄', blurb: 'Cool the crystal slowly along its curve.' },
  fusion: { name: 'Alchemical Fusion', icon: '⚗', blurb: 'Fuse two metals into one unstable alloy.' },
  fold: { name: 'Pattern Folding', icon: '≋', blurb: 'Fold the layers to build the pattern.' },
  damascus: { name: 'Damascus Forging', icon: '❖', blurb: 'Stack, fold and etch the billet into its pattern.' },
  hammer: { name: 'Initial Shaping', icon: '⚒', blurb: 'Draw out the silhouette under the hammer.' },
  grind: { name: 'Structural Refinement', icon: '◐', blurb: 'Choose the construction and grind the profile true.' },
  inlay: { name: 'Stone Setting', icon: '◈', blurb: 'Set mountain stones into the piece.' },
  surface: { name: 'Surface Treatment', icon: '▤', blurb: 'Give the surface its texture.' },
  hilt: { name: 'Handle & Fittings', icon: '╋', blurb: 'Make and assemble the hilt.' },
  engrave: { name: 'Decoration', icon: '✧', blurb: 'Engrave, inscribe and set gems.' },
  infusion: { name: 'Starlight Infusion', icon: '✦', blurb: 'Trace a constellation into the metal.' },
  finish: { name: 'Final Finishing', icon: '✺', blurb: 'Choose the finish and inspect for flaws.' },
  appraisal: { name: 'Inspection & Appraisal', icon: '⌕', blurb: 'Admire, name and appraise your work.' },
};
