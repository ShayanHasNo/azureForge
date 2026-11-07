// Audio contract used across the game. Implemented by AudioEngine (audio.ts).

export type Sfx =
  | 'hammer' // good anvil strike
  | 'hammerPerfect' // perfect strike, brighter ring
  | 'hammerMiss' // dull off-beat thunk
  | 'sizzle' // quench / heat hiss
  | 'bellows' // single bellows puff
  | 'grind' // short grinding scrape
  | 'polish' // soft polishing swish
  | 'engrave' // graver scratch
  | 'click' // UI click
  | 'hover' // UI hover tick (very quiet)
  | 'place' // item placed / set down
  | 'snap' // component locks into place
  | 'chime' // gentle positive chime
  | 'success' // stage complete flourish
  | 'soft' // gentle "not quite" tone (never harsh)
  | 'pop' // tiny pop
  | 'sparkle' // magical sparkle
  | 'stone' // stone tap
  | 'glass' // glass tink
  | 'coin' // coins
  | 'page' // page turn
  | 'door' // door creak + bell
  | 'step' // footstep on boards
  | 'fold' // metal fold thud
  | 'star'; // star connect twinkle

export type LoopSfx = 'grind' | 'polish' | 'bellows' | 'heat';

export interface SfxOpts {
  pitch?: number; // playback-rate style multiplier (1 = normal)
  volume?: number; // 0..1 multiplier
  pan?: number; // -1..1
}

export interface GameAudio {
  sfx(name: Sfx, opts?: SfxOpts): void;
  /** Continuous sounds for held actions; intensity 0..1 can be updated each frame. */
  loop(name: LoopSfx, on: boolean, intensity?: number): void;
}
