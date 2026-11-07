# The Quiet Forge: architecture & design specification

This document covers the Phase 0 deliverables: the feature breakdown, the system dependency map, the data architecture, and the visual, minigame and balancing specifications.

## Technology

- **TypeScript + Vite.** Static web app. All game state lives in `localStorage`. The one exception is the optional online market showcase: a Vercel function (`api/showcase.ts`, logic in `server/`) backed by Upstash Redis, with an in-memory stand-in during `vite dev`/`preview`. Modules that function imports use explicit `.js` import extensions, because Vercel runs it as plain Node ESM (a test enforces this).
- **Canvas 2D** draws the workshop scene, the procedural item sprites and every minigame. All of it is pixel art, scaled with nearest-neighbour.
- **DOM/CSS** handles menus, panels and crafting decisions, so the UI stays accessible and keyboard-navigable.
- **Web Audio** synthesises all sound at runtime: SFX, ambience and generative music. There are no audio files.
- **Vitest** runs the renderer determinism tests and the automated balance simulations (`npm test`).

## Module map

```
src/
  core/        rng.ts (seeded RNG, hashing, value noise) · util.ts (math, colour, DOM el())
  data/        materials.ts · options.ts (all creative options + gates) · traditions.ts · workshop.ts (decor/tools)
  item/        types.ts (THE item data structure) · factory.ts · patterns.ts (engraving geometry, emblems)
               stats.ts (bounded stat model) · describe.ts (names, descriptions, tags) · finalize.ts
  render/      pixel.ts (DOM-free RGBA buffer) · itemRenderer.ts (layered procedural sprites)
  crafting/    stages.ts (data-driven stage controls) · session.ts (pipeline) · apply.ts (results → item)
               simulate.ts (headless pipeline for balance tests)
  minigames/   types.ts (contract) · base.ts (framework) · hammer, heat, anneal, fusion, fold, grind,
               polish, engrave, assembly, constellation, inspect · index.ts (registry)
  game/        state.ts (state + calendar) · save.ts (versioned save/backup/export) · progress.ts
  village/     npcs.ts (villagers + reactions) · requests.ts · world.ts (merchants, exploration, journals)
  audio/       types.ts (contract) · audio.ts (synth engine)
  workshop/    scene.ts (animated pixel workshop, player character, stations)
  ui/          dom.ts · showcase.ts · portrait.ts · style.css · screens/*
  app.ts       application controller · main.ts (title screen / boot)
```

## Dependency map

```
data ──► item ──► render
  │        │        │
  │        ▼        ▼
  ├──► crafting ◄── minigames (results only, via MinigameResult)
  │        │
  ▼        ▼
game (state, progress, save) ◄── village
  │
  ▼
app / ui  ──► workshop scene, audio
```

The rules that keep this architecture extensible:

- **Minigames never mutate the item.** They receive a clone and return a `MinigameResult` (`score`, `details`, `data`). `crafting/apply.ts` is the only place where measured performance is written into the item.
- **The renderer reads only the item.** `renderItem(item, view)` is a pure function of the stored parameters and `item.seed`, and it's cached by a key built from the visual parameters.
- **Stats are recomputable.** `computeStats(item)` is pure, so stats can be rebuilt from saved data at any time.
- **Stages are data.** `StageDef` declares controls, validation and a minigame. A tradition is an ordered list of stage IDs, so adding, removing or reordering stages needs no engine changes. Experimental reorders them at runtime.
- **Options are data.** An option's `gate` can be a tradition, a tool, a journal, a material-mastery level or a category. `optionAvailable()` evaluates gates in one place.

**Damascus** (`item/damascus.ts`): a dagger whose `design.method` is `damascus` gets a `damascus` stage (`crafting/method.ts` swaps it in for `fold`, or inserts it after preparation). The pattern index (1–1000) comes from `item.seed`. The pattern's shape comes from the index alone (`patternSpec`, `damascusField`), so an index always looks the same. Visibility and rare colour are seeded rolls on the forge quality, so the server can re-derive and verify them. The data lives in `surface.damascus` and is drawn by `drawDamascus` in the renderer. It is cosmetic: stats and value ignore it.

Adding new content:

| To add | Do this |
|---|---|
| A material | Add an entry in `data/materials.ts`. It gets palette, props, a prep profile, rhythm, pairings and mastery unlocks automatically. |
| An option | Add an entry to the list in `data/options.ts`. If it's a new visual, add a case in `itemRenderer.ts`. |
| A tradition | Add an entry in `data/traditions.ts` with its stage list and minigame styles. |
| A minigame | Create a class that extends `BaseMinigame`, add it to `minigames/index.ts`, and add an `APPLY` entry. |
| An item category | Add it to `CATEGORY_INFO`, give it a render path, and add its `HEADLINE_STATS`. |

## Data architecture: the item

`item/types.ts` holds the following fields:

- **Identity:** `id`, `seed`, `version`, `category`, `tradition`, `name`/`customName`, `creator`, and the in-game and real creation dates.
- **Design:** `design` (`direction`, `motif`, `palette`, `intents`), `materials` (`primary`, `secondary`, `grip`, `fusedWith`) and `structure.approach`.
- **Geometry:** `blade` (`length`, `width`, `profile`, `tip`, `curve`, `thickness`, `fuller`, `leftDev[]`/`rightDev[]`/`wobble[]` per-segment deviations, `asymmetry`), `shield` (`shape`, size, `rim`, `boss`, face material, `planks`, `dents[]`, `rimGap`), and `hilt` (`guard`, `grip`, `wrap`, `pommel`, plus the assembly offsets and tilt).
- **Surface and decoration:** `surface` (`texture`, polish `zones[8]`, fold `layers`/`clarity`, `fusion`), `decoration` (engraving `pattern` with the player's traced `jitter[]`, `slips[]` and `crispness`; `inscription`; `gems`; `emblem`; set `stones`; infused `constellation`) and `finish`.
- **Craft record:** `quality` (per-stage performance from 0 to 1), `blemishes` (the flaws left after inspection), `mutations`, and `history` (every stage's choices plus its minigame record: `score`, `grade`, `difficulty`, `details`, `summary`).
- **Derived (recomputable):** `stats`, `tags`, `description`.

Saving stores this structure verbatim. The tests confirm that a JSON round-trip reproduces identical pixels.

## Visual specification

- The workshop is drawn at an internal resolution of 320×180. Item sprites are 64×176 (swords), 48×112 (daggers) and 88×104 (shields), with a coloured "selout" outline and 4×4 Bayer dithering between palette shades.
- The palette is warm and earthy. Each material has its own hand-picked 6-shade ramp.
- Sprites are built in 8 layers:
  1. Silhouette, from profile, tip, deviations, curve and asymmetry.
  2. Primary material shading: bevels, fullers and ridges.
  3. Secondary details: guard, pommel, contrast edges and layered folds.
  4. Surface texture: 15 textures, plus polish-zone mottling.
  5. Hilt: grip grain and wrap patterns.
  6. Decoration: engraving traced with the player's actual jitter, inscription glyphs, emblems, gems, stones and constellation.
  7. Finish colour transforms: 16 finishes.
  8. Effects: glow halo and mutations.
- Presentation-only animation (glint sweep, glow motes, float) lives in `ui/showcase.ts`, never in the sprite data.

## Minigame specification

| Minigame | Stage(s) | Measures | Writes |
|---|---|---|---|
| Hammer (steady/swing/syncopated/heavy/melodic/wild) | Initial shaping | timing accuracy, consistency, perfect rate | per-segment edge deviations and spine wobble (shield: dents) |
| Heat | Preparation | time-weighted closeness to the material's sweet band | material quality |
| Anneal | Glassgarden prep | following a cooling curve, smoothness | material quality |
| Fusion | Experimental prep | holding a target mix under turbulence | fusion mix, mutation odds |
| Fold | Patternwrights | alignment and off-beat strike per fold | layer count, pattern clarity |
| Fold, Damascus mode | Damascus forging (daggers) | folding as above, then pulling the blade from the etching bath at peak contrast | forge quality → `surface.damascus` (index from seed, visibility = forge + seeded roll, capped at 98.5%; rare colour roll for certain metal pairs) |
| Grind (symmetric/organic/delicate/free) | Structural refinement | removal-only edge alignment vs a target, smoothness | final edge deviations (shield: planished dents) |
| Polish | Surface | per-texture criteria: coverage, stroke straightness, dab spacing, varied coverage, steadiness | 8 zone qualities |
| Assembly (hilt/inlay/rim) | Hilt, Mountain stone setting | positional and rotational alignment | guard/pommel offsets and tilt, stone placements, rim gap |
| Engrave | Decoration | perpendicular deviation, smoothness, completion | per-sample jitter, slips, crispness |
| Constellation | Celestial infusion | link precision and order | star points, brightness |
| Inspect | Final finishing | flaws found, care | removes found blemishes |

Difficulty runs from 0 (Relaxed) to 4 (Master). It comes from the tradition tier, the material's workability and the player's setting. Difficulty changes tolerances and complexity, such as extra zones, fold counts, ideal-heat shifts and rhythm styles, rather than only speed. The Experimental tradition adds quirks: mirrored, drifting, bursts, flicker or generous.

## Material balancing specification

- Material **potential** (props) and **craftsmanship** (stage performance) are independent inputs.
- Craftsmanship is the weighted mean of the stages actually performed, plus a small consistency bonus. It never depends on material.
- Each stat blends the two inputs in bounded proportions:
  - durability: 50% potential, 50% realisation
  - integrity: 35% / 65%
  - balance: 38% design physics, 62% execution
  - flexibility: 62% material
  - collector appeal: 42% craftsmanship, with only 6% from rarity
- Value grows roughly with craft² × appeal. Material cost adds linearly, so rarity never multiplies value exponentially.
- Every material has a niche:
  - **Brass**: decorative, forgiving.
  - **Copper**: flexible, cheap.
  - **Bronze**: sturdy, ancient.
  - **Iron**: balanced, dependable.
  - **Silver**: luster, ornament, heavy.
  - **Azuresteel**: all-round, a little demanding.
  - **Moonstone**: lightest, most flexible.
  - **Dragonsteel**: most durable; heavy, stiff and hardest to work.
  - **Star-metal**: magical, volatile.
  - **Gardenglass**: hard and brilliant, but brittle.
- Common metals stay relevant through:
  - forgiving minigames
  - mastery unlocks that only those metals provide
  - villager tastes
  - requests (Fennick's common-metal wager)
  - challenges (*Common Ground*, *The Brass Masterpiece*)
- `tests/balance.test.ts` verifies:
  - expert brass beats average dragonsteel on overall quality, value, appeal and balance, while staying within 15 points on durability
  - average iron beats poor silver
  - expert common metals beat every poorly made rare metal
  - no metal dominates every stat at equal skill
  - the value spread at equal skill stays under 1.9×
  - structural approaches create real trade-offs

## Progression

Progression in this design expands possibilities. It never inflates stats.

- **Reputation** comes from requests, fine work, challenges and sales. It unlocks merchant stock, places, tools and traditions.
- **Friendship** comes from requests and gifts. It unlocks traditions (Lyra, Brannoc, Wren), stall stock and places.
- **Historical journals**, found in the Abandoned Workshop, unlock the Patternwright and Experimental traditions, plus knotwork.
- **Material mastery** comes from crafting with a material. Each metal unlocks 3 exclusive options.
- **Tools** unlock daggers, shields, the bellows mechanic, the wheel/reflective texture, the loupe and engraving patterns, fine fittings, gem slots and the collection room.
- **Challenges** are mastery goals that reward returning to common materials.
