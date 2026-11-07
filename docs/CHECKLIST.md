# Project checklist

Status key: **Not started**, **In progress**, **Implemented** (code is in and works), **Tested** (covered by automated tests or the browser playthrough), **Completed** (tested, and polished for this milestone).

## Phase 0 – Planning & architecture
| Feature | Status |
|---|---|
| Architecture, data model, dependency map, specs (`docs/ARCHITECTURE.md`) | Completed |
| Modular project foundation (TypeScript + Vite) | Completed |

## Phase 1 – Workshop prototype
| Feature | Status |
|---|---|
| Animated pixel workshop: fire, embers, smoke, lighting, weather, seasons | Tested (browser) |
| Player character, walking, click-to-walk, station interaction | Tested (browser) |
| Forge, anvil, workbench, storage, finishing bench, journal, display rack, door, gallery | Tested (browser) |
| Basic inventory / material storage | Tested |
| HUD and screens | Tested (browser) |

## Phase 2 – Core item architecture
| Feature | Status |
|---|---|
| Item data model (geometry, materials, surface, decoration, history, seed) | Tested |
| 8-layer procedural sprite renderer (front, back, edge views) | Tested (determinism and uniqueness) |
| Exact reproduction from saved data | Tested (`tests/save.test.ts`) |

## Phase 3 – Multi-stage crafting engine
| Feature | Status |
|---|---|
| 10-stage sword pipeline, from design to appraisal | Tested (browser playthrough) |
| Choices and performance recorded per stage | Tested |
| Stages can be added, removed or reordered per tradition | Tested (Experimental reorder) |
| Unfinished pieces saved and resumable; abandoning a piece refunds its materials | Implemented |

## Phase 4 – Skill-based minigames
| Minigame | Status |
|---|---|
| Hammering (6 rhythm styles) | Tested |
| Heat management (+ bellows mechanic) | Tested |
| Shape grinding (symmetric / organic / delicate / free) | Tested |
| Precision polishing (per-texture scoring, wheel mode) | Tested |
| Engraving by tracing (+ loupe) | Tested |
| Assembly: hilt, stone inlay, shield rim | Tested |
| Final inspection | Tested |
| Annealing, fusion, pattern folding, constellation infusion | Tested |
| Difficulty scaling, Experimental quirks, Relaxed mode | Implemented |

## Phase 5 – Materials & balancing
| Feature | Status |
|---|---|
| 10 metals/crystals, 9 grips, 8 gems, 3 stones with trade-offs | Completed |
| Craftsmanship-first stat model, no exponential rarity scaling | Tested (`tests/balance.test.ts`) |
| Expert brass beats average dragonsteel | Tested |
| No material dominates every stat | Tested |

## Phase 6 – Crafting traditions
| Feature | Status |
|---|---|
| Foundry, Patternwrights, Celestial, Mountain, Glassgarden, Experimental, each with distinct stages and minigames | Tested (browser playthrough of all six) |

## Phase 7 – Workshop progression & customisation
| Feature | Status |
|---|---|
| Decor (walls, floors, lighting, windows, forges, racks) and touches | Implemented |
| Tools that add mechanics and categories | Implemented |
| Display rack showing real sprites; collection room | Implemented |

## Phase 8 – Village & NPCs
| Feature | Status |
|---|---|
| 9 villagers with tastes, stories, friendship and portraits | Implemented |
| Reactions that reference actual item features | Implemented |
| 17 open-ended requests | Implemented |
| 5 merchants on predictable schedules, including the seasonal market | Implemented |

## Phase 9 – Progression & discovery
| Feature | Status |
|---|---|
| 7 exploration locations with predictable yields | Implemented |
| Historical journals, traditions unlocked through friendship, reputation or journals | Tested |
| Material mastery that unlocks options, not stats | Tested |
| Storied material pairings, challenges | Implemented |
| Item categories (dagger, shield) unlocked by tools | Tested |

## Phase 10 – Polish
| Feature | Status |
|---|---|
| Synthesized SFX, ambience and generative music, with 3 volume controls plus master | Implemented |
| Accessibility: Relaxed mode, reduced motion, high contrast, UI scale, keyboard and touch | Implemented |
| Save reliability: autosave, backup, export and import, migration | Tested |
