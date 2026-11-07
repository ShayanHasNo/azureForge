# The Quiet Forge

The Quiet Forge is a cozy pixel-art blacksmithing game about crafting, mastery and making things by hand.

You've inherited your grandmother's small workshop in a peaceful village. Every piece you make goes through a series of hands-on stages. Your design choices, your materials and your actual skill in each minigame decide what the item looks like, how it performs and the story it carries.

No two items are alike: every sprite is generated procedurally from the item's stored parameters. An expertly crafted brass sword can genuinely outshine a carelessly made dragonsteel one.

## Play

```bash
npm install
npm run dev
```

Then open the printed URL. To build a static version:

```bash
npm run build
```

The build writes a static site to `dist/` that can be hosted anywhere.

### Controls

**In the workshop:**

| Action | Keys |
|---|---|
| Walk | <kbd>A</kbd>/<kbd>D</kbd> or <kbd>←</kbd>/<kbd>→</kbd> |
| Use a station | <kbd>E</kbd> |
| Click to walk and interact | Mouse or touch |

**Shortcuts:**

| Key | Opens |
|---|---|
| <kbd>F</kbd> | Craft |
| <kbd>I</kbd> | Materials |
| <kbd>J</kbd> | Journal |
| <kbd>C</kbd> | Collection |
| <kbd>V</kbd> | Village |
| <kbd>U</kbd> | Workshop |
| <kbd>R</kbd> | Rest |
| <kbd>Esc</kbd> | Settings / close |

Every minigame supports mouse, touch and keyboard. Its controls are shown before it starts.

## What's in the game

- **Crafting pipeline.** Concept & design, materials, material preparation, shaping, structural refinement, surface treatment, handle & fittings, decoration, final finishing, then inspection & appraisal. Every stage records your choices and measured performance in the item's history.
- **11 skill minigames:**
  - timing-based hammering, in six rhythm styles
  - heat management (with a bellows mechanic once you own one)
  - glass annealing
  - alchemical fusion
  - pattern folding
  - removal-only shape grinding
  - texture-specific polishing
  - engraving by tracing
  - component assembly and stone setting
  - constellation infusion
  - flaw inspection
- **6 crafting traditions**, each with its own stage sequence, minigame styles, materials and decorative language:
  - Traditional Foundry
  - Patternwrights
  - Celestial Atelier
  - Mountain Artisans
  - Glassgarden
  - Experimental Workshop, which lets you reorder stages and adds quirks
- **10 metals** (plus woods, leathers, gems and stones), each with real trade-offs. Material mastery unlocks creative options, never stat bonuses.
- **Procedural sprites** built in 8 layers: silhouette, material shading, secondary details, 15 textures, hilt and wrap, decoration (your traced engraving, inscription, emblems, gems, stones, constellations), 16 finishes, and effects.
- **Sword, dagger and shield** item categories, each with its own statistics.
- **A village** with nine villagers. Each has their own tastes and story, and reacts to the actual properties of what you show them. Villagers post open-ended requests ("something that reminds me of the mountains…").
- **Predictable markets, exploration and journals.**
  - Five market stalls keep fixed schedules.
  - Seven places to explore each list their reliable finds.
  - Historical journals and mastery challenges round out the world.
- **A customizable workshop:** decor, little touches (yes, there's a cat), tools that add new mechanics, a display rack showing your real creations, and a collection room.
- **Synthesized audio.** Generative ambient music, fire, rain, wind and village ambience, plus crafting sounds. Music, ambience and crafting sounds each have their own volume.
- **Accessibility:** a Relaxed crafting mode, reduced motion, high-contrast panels, interface scaling and keyboard play.
- **Saving.** The game autosaves after every stage, keeps a rolling backup, and supports JSON export/import. An unfinished piece is saved and can be resumed.

## Tests

```bash
npm test
```

This runs renderer determinism, balance simulations, save round-trips and progression checks. To print the balance tables:

```bash
npm run sim
```

For a full browser playthrough with screenshots:

```bash
npm run e2e
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture, data model and design specifications, and [`docs/CHECKLIST.md`](docs/CHECKLIST.md) for the feature checklist.
