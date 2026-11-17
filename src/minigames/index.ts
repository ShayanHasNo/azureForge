import type { MinigameDef } from './types';
import { hammerGame } from './hammer';
import { heatGame } from './heat';
import { annealGame } from './anneal';
import { fusionGame } from './fusion';
import { foldGame } from './fold';
import { grindGame } from './grind';
import { polishGame } from './polish';
import { engraveGame } from './engrave';
import { assemblyGame } from './assembly';
import { constellationGame } from './constellation';
import { inspectGame } from './inspect';
import { tillerGame } from './tiller';
import { stringGame } from './string';
import { straightenGame } from './straighten';
import { fletchGame } from './fletch';
import { stitchGame } from './stitch';
import { weaveGame } from './weave';

export const MINIGAMES: Record<string, MinigameDef> = Object.fromEntries(
  [hammerGame, heatGame, annealGame, fusionGame, foldGame, grindGame, polishGame, engraveGame, assemblyGame, constellationGame, inspectGame, tillerGame, stringGame, straightenGame, fletchGame, stitchGame, weaveGame].map((g) => [g.id, g]),
);
