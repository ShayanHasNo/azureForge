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
- **15 skill minigames:**
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
  - tillering a bow on the tillering tree: scrape each limb until both bend evenly at your draw weight
  - twisting a bowstring to the swing of a weight
  - bend-testing and straightening arrow shafts
  - fletching: three feathers a third of a turn apart, the cock feather square to the nock
  - flaw inspection, with a loupe and a raking **inspection lamp**: about half of all flaws are too faint to see by eye, and only glint when the lamp's light comes from the right side
- **6 crafting traditions**, each with its own stage sequence, minigame styles, materials and decorative language:
  - Traditional Foundry
  - Patternwrights
  - Celestial Atelier
  - Mountain Artisans
  - Glassgarden
  - Experimental Workshop, which lets you reorder stages and adds quirks
- **14 metals** — now including steel, sunbronze, crucible steel and meteoric iron — plus bow woods, arrow shafts, horn, sinew and thread, feathers, cloth, hides, gems and stones. Each has real trade-offs. Material mastery unlocks creative options, never stat bonuses.
- **Hi-res pixel art.** Sprites are drawn at twice the old resolution: same proportions, finer pixels, with crisp bevels, carved engraving and faceted gems. Pieces made before the change are **legacy** pieces: they keep their original look forever and carry a Legacy tag.
- **Procedural sprites** built in 8 layers: silhouette, material shading, secondary details, 15 textures, hilt and wrap, decoration (your traced engraving, inscription, emblems, gems, stones, constellations), 16 finishes, and effects.
- **Sword, dagger and shield** item categories, each with its own statistics.
- **Bows.** Buy the *Tillering Tree* to make bows by four real methods, each with its own stages and materials:
  - a **self bow** from a single stave, its belly toasted over the fire;
  - a **backed bow**, with sinew, rawhide or hickory glued to the back;
  - a **laminated bow**, glued up from strips of two woods;
  - a **composite horn bow** (horn belly, wooden core, sinew back, a long slow cure), once you have read the right journal.

  Longbow, flatbow, recurve and reflex shapes. The bow's drawn curve *is* your tillering: a stiff limb, a weak limb or a hinge all show in the sprite and in its draw weight, cast, smoothness and stability.
- **Arrows**, made as a **matched set of six** with the *Fletching Jig*: spine-matched and straightened shafts, forged bodkin, broadhead or leaf points (or knapped flint), and three fletching styles. A set is judged on how alike its arrows are as well as how good each one is.
- **Damascus daggers.** Choose the *Damascus* forging method for a dagger to stack, fold and etch two metals. Every Damascus dagger carries one of **1000 numbered patterns**, fixed by its steel: every #437 looks like every other #437, and a few indexes are named. Your forging and etching, plus a little luck, decide the pattern's **visibility**. Even flawless work never shows it at 100%. A handful of metal pairings can, very rarely, bloom into a **prized colour**. The finished dagger gets a certificate with its index, visibility and colour, and *Collection → Damascus index* tracks which of the 1000 patterns you've forged. Damascus is purely cosmetic: it never changes stats or value.
- **Market showcase.** Show any finished piece to other players from its inspection page, and browse everyone's pieces, newest or rarest, in *Village → Showcase*.
- **A village** with nine villagers. Each has their own tastes and story, and reacts to the actual properties of what you show them. Villagers post open-ended requests ("something that reminds me of the mountains…").
- **Predictable markets, exploration and journals.**
  - Seven market stalls keep fixed schedules, including Old Teodor's archery bench and Maren's mill loft.
  - Seven places to explore each list their reliable finds.
  - Historical journals and mastery challenges round out the world.
- **A customizable workshop:** decor, little touches (yes, there's a cat), tools that add new mechanics, a display rack showing your real creations, and a collection room.
- **Synthesized audio.** Generative ambient music, fire, rain, wind and village ambience, plus crafting sounds. Music, ambience and crafting sounds each have their own volume.
- **Phone-friendly.** Plays in portrait or landscape with touch alone: a thumb-reach bottom menu, full-screen panels, finger-sized buttons, a workshop camera that follows the smith on tall screens, and minigames that get the whole screen while you work. It can be added to the home screen.
- **Accessibility:** a Relaxed crafting mode, a readable text font (Atkinson Hyperlegible, or switch back to the classic pixel font), reduced motion, high-contrast panels, interface scaling and keyboard play.
- **Saving.** The game autosaves after every stage, keeps a rolling backup, and supports JSON export/import. An unfinished piece is saved and can be resumed.

## The online market showcase

The showcase is the game's only online feature, served by a small Vercel function (`api/showcase.ts`) backed by Redis.

- **Locally**, `npm run dev` and `npm run preview` serve the same API from an in-memory store, so it works with no setup. Posts disappear when the server stops.
- **On Vercel**, connect a Redis database to the project from the *Storage* tab (tick Production and Preview), then redeploy. Any of these work:
  - `REDIS_URL`, a standard `redis://` or `rediss://` connection string. This is what Vercel's Redis integration provides.
  - `KV_REST_API_URL` with `KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` with `UPSTASH_REDIS_REST_TOKEN` (Upstash's REST API).

  Until a database is connected, the Showcase tab says the market is quiet and the rest of the game is unaffected. Check a deployment by opening `/api/showcase?sort=recent`: an empty `posts` list means it's connected.

Posts are public and only lightly moderated: names are length-capped and stripped of control characters. Crafting history never leaves the player's save. Every field is validated against the game's own data, and a Damascus pattern is checked against the blade's seed, so a forged index or colour is rejected. Each address may post 5 pieces an hour. The newest 1000 posts are kept, each for up to 90 days, and players can withdraw their own.

## Tests

```bash
npm test
```

This runs renderer determinism, balance simulations, save round-trips and progression checks. To print the balance tables:

```bash
npm run sim
```

For a full browser playthrough with screenshots (a sword, a Damascus dagger, a bow, a set of arrows, then one piece from every tradition; `QUICK=1` stops after the arrows):

```bash
npm run e2e
```

For a touch-only playthrough on emulated phones (portrait, landscape and a small Android), which also checks that buttons are on screen and finger-sized:

```bash
npm run e2e:mobile
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the architecture, data model and design specifications, and [`docs/CHECKLIST.md`](docs/CHECKLIST.md) for the feature checklist.
