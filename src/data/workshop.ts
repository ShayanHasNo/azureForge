// Workshop decor, tools and expansions. Decor is purely expressive; tools add
// new crafting mechanics or options (never flat stat boosts).

export type DecorSlot = 'wall' | 'floor' | 'lighting' | 'window' | 'forge' | 'shelves';
export interface DecorDef { id: string; slot: DecorSlot; name: string; cost: number; desc: string; capacity?: number; requires?: string }

export const DECOR: DecorDef[] = [
  { id: 'planks', slot: 'wall', name: 'Timber Planks', cost: 0, desc: 'Warm, knotted planks.' },
  { id: 'stone', slot: 'wall', name: 'Fieldstone', cost: 60, desc: 'Grey-gold stones mortared by hand.' },
  { id: 'plaster', slot: 'wall', name: 'Limewash Plaster', cost: 45, desc: 'Soft cream walls with timber beams.' },
  { id: 'brick', slot: 'wall', name: 'Red Brick', cost: 70, desc: 'Sturdy rose-red brick.' },
  { id: 'panelled', slot: 'wall', name: 'Dark Panelling', cost: 110, desc: 'Polished walnut panels.' },
  { id: 'tiles', slot: 'wall', name: 'Glazed Tiles', cost: 130, desc: 'Sea-green glazed tiles.' },

  { id: 'boards', slot: 'floor', name: 'Floorboards', cost: 0, desc: 'Worn, honest boards.' },
  { id: 'flagstone', slot: 'floor', name: 'Flagstones', cost: 55, desc: 'Cool, uneven slabs.' },
  { id: 'herringbone', slot: 'floor', name: 'Herringbone', cost: 90, desc: 'Parquet in a herringbone weave.' },
  { id: 'terracotta', slot: 'floor', name: 'Terracotta', cost: 75, desc: 'Sun-warm clay tiles.' },
  { id: 'rushmat', slot: 'floor', name: 'Rush Matting', cost: 35, desc: 'Woven rushes underfoot.' },

  { id: 'candles', slot: 'lighting', name: 'Candles', cost: 0, desc: 'A few candle stubs.' },
  { id: 'lanterns', slot: 'lighting', name: 'Hanging Lanterns', cost: 50, desc: 'Brass lanterns on chains.' },
  { id: 'chandelier', slot: 'lighting', name: 'Iron Chandelier', cost: 120, desc: 'A wheel of candles overhead.' },
  { id: 'fireflyjars', slot: 'lighting', name: 'Firefly Jars', cost: 80, desc: 'Jars of drifting lights.' },
  { id: 'crystallamps', slot: 'lighting', name: 'Crystal Lamps', cost: 160, desc: 'Gardenglass lamps that glow green.' },

  { id: 'small', slot: 'window', name: 'Small Window', cost: 0, desc: 'A small square window.' },
  { id: 'large', slot: 'window', name: 'Wide Window', cost: 70, desc: 'A broad window onto the lane.' },
  { id: 'round', slot: 'window', name: 'Round Window', cost: 60, desc: 'A porthole of old glass.' },
  { id: 'stained', slot: 'window', name: 'Stained Glass', cost: 150, desc: 'Coloured leaded glass.' },

  { id: 'brick', slot: 'forge', name: 'Brick Forge', cost: 0, desc: 'Grandmother\'s old forge.' },
  { id: 'stone', slot: 'forge', name: 'Stone Forge', cost: 90, desc: 'A rugged mountain-style hearth.' },
  { id: 'copperhood', slot: 'forge', name: 'Copper Hood', cost: 140, desc: 'A gleaming copper chimney hood.' },
  { id: 'dragonmaw', slot: 'forge', name: 'Dragon-maw Forge', cost: 260, desc: 'A forge mouth carved like a sleeping dragon.' },

  { id: 'rack1', slot: 'shelves', name: 'Simple Rack', cost: 0, desc: 'Holds 3 pieces.', capacity: 3 },
  { id: 'rack2', slot: 'shelves', name: 'Long Rack', cost: 80, desc: 'Holds 6 pieces.', capacity: 6 },
  { id: 'cabinet', slot: 'shelves', name: 'Glass Cabinet', cost: 180, desc: 'Holds 9 pieces.', capacity: 9 },
];

export interface ExtraDef { id: string; name: string; cost: number; desc: string }
export const EXTRAS: ExtraDef[] = [
  { id: 'rug', name: 'Woven Rug', cost: 30, desc: 'A red-and-ochre rug before the forge.' },
  { id: 'plants', name: 'Potted Plants', cost: 25, desc: 'Ferns and herbs on the sill.' },
  { id: 'cat', name: 'Sleepy Cat', cost: 0, desc: 'Ember, the forge cat. Adopted, not bought.' },
  { id: 'banner', name: 'Guild Banner', cost: 60, desc: 'A banner in your design colours.' },
  { id: 'bookshelf', name: 'Bookshelf', cost: 70, desc: 'For journals and almanacs.' },
  { id: 'clock', name: 'Brass Clock', cost: 90, desc: 'A ticking brass wall clock.' },
  { id: 'chimes', name: 'Wind Chimes', cost: 40, desc: 'Chimes by the door.' },
  { id: 'glassbloom', name: 'Glassbloom Planter', cost: 110, desc: 'Crystal flowers from the Glassgarden.' },
];

export interface UpgradeDef { id: string; name: string; cost: number; desc: string; effect: string; reputation?: number }
export const UPGRADES: UpgradeDef[] = [
  { id: 'smallanvil', name: 'Horned Bench Anvil', cost: 40, desc: 'A small anvil for fine work.', effect: 'Unlocks daggers.' },
  { id: 'bellows', name: 'Leather Bellows', cost: 60, desc: 'Grandmother\'s bellows, re-stitched.', effect: 'Adds a bellows control to heat preparation (hold B / the bellows button for a gentle, steady push).' },
  { id: 'loupe', name: 'Engraver\'s Loupe', cost: 70, desc: 'A brass loupe on a stand.', effect: 'Unlocks knotwork & feather engraving; shows a magnified guide while engraving.' },
  { id: 'wheel', name: 'Polishing Wheel', cost: 90, desc: 'A treadle-driven felt wheel.', effect: 'Unlocks the reflective texture; polishing gains a wheel mode with a steadier contact.' },
  { id: 'finebench', name: 'Fine Workbench', cost: 110, desc: 'A bench with vices and fine tools.', effect: 'Unlocks ring guards, wire wraps and a second gem slot.' },
  { id: 'gemsetter', name: 'Gem-setter\'s Kit', cost: 80, desc: 'Prongs, bezels and patience.', effect: 'Allows gems on the guard and blade as well as the pommel.' },
  { id: 'shieldframe', name: 'Shield Frame', cost: 150, desc: 'A jig for planking and rimming shields.', effect: 'Unlocks shields.', reputation: 6 },
  { id: 'collectionroom', name: 'Collection Room', cost: 220, desc: 'Open up the back room as a gallery.', effect: 'Adds a gallery room with 12 more display plinths.', reputation: 10 },
];

export function decor(slot: DecorSlot, id: string) {
  return DECOR.find((d) => d.slot === slot && d.id === id);
}
