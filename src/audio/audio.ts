// The Quiet Forge - fully synthesized audio engine (Web Audio API, no files).
//
// Graph:
//   sources -> {music,ambient,sfx} dry bus -----------------------> master
//   sources -> {music,ambient,sfx} wet bus -> reverb (generated IR) -> master
//   master -> gentle compressor -> destination
//
// Nothing is created until unlock() is called from a user gesture. Every public
// method is a safe no-op before unlock and swallows audio errors.

import type { GameAudio, LoopSfx, Sfx, SfxOpts } from './types';

export interface Volumes {
  master: number;
  music: number;
  ambient: number;
  sfx: number;
}

export type MusicMood = 'day' | 'night' | 'craft' | 'village';

export interface AmbientState {
  /** Forge fire level 0..1. */
  fire: number;
  rain: boolean;
  /** Wind level 0..1. */
  wind: number;
  /** Distant village life 0..1 (birds by day, crickets by night). */
  village: number;
  night: boolean;
}

// ---------------------------------------------------------------- helpers

const clamp = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
/** Number of Poisson-ish events for a rate (per second) over dt seconds. */
const events = (rate: number, dt: number): number => Math.floor(rate * dt + Math.random());

const TICK_MS = 200;
const MUSIC_LOOKAHEAD = 0.9;
const MAX_VOICES = 48;
const EPS = 0.0001;

interface Beds {
  fire: GainNode;
  fireHiss: GainNode;
  rain: GainNode;
  wind: GainNode;
  windAmp: GainNode;
  windBand: BiquadFilterNode;
  murmur: GainNode;
}

interface Graph {
  ctx: AudioContext;
  master: GainNode;
  musicDry: GainNode;
  musicWet: GainNode;
  ambientDry: GainNode;
  ambientWet: GainNode;
  sfxDry: GainNode;
  sfxWet: GainNode;
  reverbIn: GainNode;
  // music internals
  musicFade: GainNode;
  padFilter: BiquadFilterNode;
  melodyBus: GainNode;
  delay: DelayNode;
  // noise
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  beds: Beds;
}

interface Voice {
  ctx: AudioContext;
  t: number;
  p: number;
  out: GainNode;
}

interface BiquadSpec {
  type: BiquadFilterType;
  f: number;
  q?: number;
  fEnd?: number;
  fTime?: number;
}

interface ToneSpec {
  type?: OscillatorType;
  f: number;
  t?: number; // offset from voice start
  a?: number; // attack
  d: number; // decay
  g: number; // peak gain
  fEnd?: number;
  fTime?: number;
  detune?: number;
  dest?: AudioNode;
}

interface NoiseSpec {
  color?: 'white' | 'pink' | 'brown';
  t?: number;
  a?: number;
  d: number;
  g: number;
  filters?: BiquadSpec[];
  mod?: { f: number; depth: number; type?: OscillatorType };
  rate?: number;
  dest?: AudioNode;
}

interface LoopVoice {
  level: GainNode;
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  intensity: number;
  update: (i: number, now: number) => void;
}

// ---------------------------------------------------------------- music definitions

interface Chord {
  bass: number; // semitones from root (bass register)
  pad: number[]; // semitones from root (pad register)
}

const I_MAJ7: Chord = { bass: 0, pad: [4, 7, 11, 14] }; // rootless maj9-ish
const I_ADD9: Chord = { bass: 0, pad: [2, 4, 7, 12] };
const VI_7: Chord = { bass: -3, pad: [4, 7, 9, 12] };
const VI_9: Chord = { bass: -3, pad: [0, 4, 7, 11] };
const IV_MAJ9: Chord = { bass: -7, pad: [2, 5, 9, 16] };
const V_SUS: Chord = { bass: -5, pad: [7, 9, 12, 14] };

interface MoodDef {
  bpm: number;
  root: number; // midi
  prog: Chord[];
  beatsPerChord: number;
  scale: number[];
  melLo: number;
  melHi: number;
  noteProb: number;
  eighthProb: number;
  restProb: number;
  padCutoff: number;
  pluckCutoff: number;
  instrument: 'pluck' | 'bell';
  padLevel: number;
  melLevel: number;
  bassProb: number;
}

const PENTA = [0, 2, 4, 7, 9];

const MOODS: Record<MusicMood, MoodDef> = {
  day: {
    bpm: 62, root: 62, prog: [I_MAJ7, VI_7, IV_MAJ9, V_SUS], beatsPerChord: 8, scale: PENTA,
    melLo: 69, melHi: 86, noteProb: 0.26, eighthProb: 0.12, restProb: 0.25,
    padCutoff: 1300, pluckCutoff: 2800, instrument: 'pluck', padLevel: 0.04, melLevel: 0.22, bassProb: 0.5,
  },
  night: {
    bpm: 50, root: 62, prog: [VI_9, IV_MAJ9, I_MAJ7, V_SUS], beatsPerChord: 8, scale: PENTA,
    melLo: 62, melHi: 79, noteProb: 0.18, eighthProb: 0.05, restProb: 0.35,
    padCutoff: 750, pluckCutoff: 1600, instrument: 'bell', padLevel: 0.045, melLevel: 0.17, bassProb: 0.6,
  },
  craft: {
    bpm: 70, root: 62, prog: [I_ADD9, IV_MAJ9, VI_9, V_SUS], beatsPerChord: 8, scale: PENTA,
    melLo: 74, melHi: 91, noteProb: 0.3, eighthProb: 0.18, restProb: 0.2,
    padCutoff: 1700, pluckCutoff: 4200, instrument: 'pluck', padLevel: 0.034, melLevel: 0.19, bassProb: 0.4,
  },
  village: {
    bpm: 74, root: 67, prog: [I_MAJ7, IV_MAJ9, VI_7, V_SUS], beatsPerChord: 8, scale: PENTA,
    melLo: 67, melHi: 86, noteProb: 0.34, eighthProb: 0.2, restProb: 0.2,
    padCutoff: 1500, pluckCutoff: 3600, instrument: 'pluck', padLevel: 0.034, melLevel: 0.21, bassProb: 0.45,
  },
};

/** Minimum seconds between identical sfx triggers. */
const MIN_GAP: Partial<Record<Sfx, number>> = {
  hover: 0.05,
  step: 0.05,
  click: 0.03,
  coin: 0.05,
  page: 0.08,
  door: 0.3,
  sparkle: 0.04,
  star: 0.04,
  success: 0.15,
  sizzle: 0.08,
  bellows: 0.08,
};
const DEFAULT_GAP = 0.025;

const DEFAULT_VOLUMES: Volumes = { master: 0.8, music: 0.5, ambient: 0.6, sfx: 0.8 };

// ---------------------------------------------------------------- engine

export class AudioEngine implements GameAudio {
  private g: Graph | null = null;
  private failed = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private vol: Volumes = { ...DEFAULT_VOLUMES };
  private amb: AmbientState = { fire: 0, rain: false, wind: 0, village: 0, night: false };

  private loops = new Map<LoopSfx, LoopVoice>();
  private lastPlayed = new Map<Sfx, number>();
  private activeVoices = 0;
  private ksCache = new Map<number, { buf: AudioBuffer; rate: number }>();
  private lastTick = 0;
  private nextGust = 0;

  // music state
  private musicWanted = false;
  private musicPlaying = false;
  private mood: MusicMood = 'day';
  private pendingMood: MusicMood | null = null;
  private nextBeat = 0;
  private beatInChord = 0;
  private chordIdx = 0;
  private melIdx = 6;
  private melodyOn = true;
  private melNotes: number[] = [];

  constructor() {
    // Intentionally empty: no AudioContext until unlock().
  }

  /** True once an AudioContext exists. */
  get unlocked(): boolean {
    return this.g !== null;
  }

  // ------------------------------------------------------------ lifecycle

  unlock(): Promise<void> {
    try {
      if (this.failed || typeof window === 'undefined') return Promise.resolve();
      if (!this.g) this.build();
      const g = this.g as Graph | null;
      if (!g) return Promise.resolve();
      const st = g.ctx.state as string;
      if (st === 'closed') return Promise.resolve();
      if (st !== 'running') {
        return g.ctx.resume().then(
          () => undefined,
          () => undefined,
        );
      }
    } catch {
      this.failed = true;
    }
    return Promise.resolve();
  }

  private build(): void {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      this.failed = true;
      return;
    }
    const ctx = new Ctor({ latencyHint: 'interactive' });

    const gain = (v: number, dest?: AudioNode | AudioParam): GainNode => {
      const n = ctx.createGain();
      n.gain.value = v;
      if (dest instanceof AudioParam) n.connect(dest);
      else if (dest) n.connect(dest);
      return n;
    };

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);

    const master = gain(this.vol.master, comp);

    // Reverb
    const reverb = ctx.createConvolver();
    reverb.buffer = this.makeImpulse(ctx, 2.2);
    const reverbReturn = gain(0.9, master);
    reverb.connect(reverbReturn);
    // Darken the reverb input slightly for warmth.
    const reverbIn = gain(1);
    const revTone = ctx.createBiquadFilter();
    revTone.type = 'lowpass';
    revTone.frequency.value = 4500;
    reverbIn.connect(revTone);
    revTone.connect(reverb);

    const musicDry = gain(this.vol.music, master);
    const musicWet = gain(this.vol.music, reverbIn);
    const ambientDry = gain(this.vol.ambient, master);
    const ambientWet = gain(this.vol.ambient, reverbIn);
    const sfxDry = gain(this.vol.sfx, master);
    const sfxWet = gain(this.vol.sfx, reverbIn);

    // Music internals
    const musicFade = gain(0);
    musicFade.connect(musicDry);
    const musicSend = gain(0.38, musicWet);
    musicFade.connect(musicSend);

    const padFilter = ctx.createBiquadFilter();
    padFilter.type = 'lowpass';
    padFilter.frequency.value = MOODS.day.padCutoff;
    padFilter.Q.value = 0.5;
    padFilter.connect(musicFade);
    // Slow breathing on the pad cutoff.
    const padLfo = ctx.createOscillator();
    padLfo.frequency.value = 0.055;
    const padLfoAmt = gain(220, padFilter.frequency);
    padLfo.connect(padLfoAmt);
    padLfo.start();

    const melodyBus = gain(1, musicFade);
    const delay = ctx.createDelay(3);
    delay.delayTime.value = (60 / MOODS.day.bpm) * 0.75;
    const fbFilter = ctx.createBiquadFilter();
    fbFilter.type = 'lowpass';
    fbFilter.frequency.value = 2000;
    const fb = gain(0.3);
    melodyBus.connect(delay);
    delay.connect(fbFilter);
    fbFilter.connect(fb);
    fb.connect(delay);
    const delayWet = gain(0.2, musicFade);
    fbFilter.connect(delayWet);

    const white = this.makeNoise(ctx, 'white', 3);
    const pink = this.makeNoise(ctx, 'pink', 5);
    const brown = this.makeNoise(ctx, 'brown', 5);

    // Ambient beds
    const loopSrc = (buf: AudioBuffer, rate = 1): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(0, Math.random() * buf.duration * 0.9);
      return s;
    };
    const bq = (type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      return n;
    };

    // fire: low rumble + flickering hiss
    const fire = gain(0, ambientDry);
    fire.connect(gain(0.08, ambientWet));
    const fireLowF = bq('lowpass', 380);
    loopSrc(brown).connect(fireLowF);
    fireLowF.connect(gain(0.9, fire));
    const fireHissF = bq('bandpass', 1600, 0.7);
    loopSrc(pink, 0.97).connect(fireHissF);
    const fireHiss = gain(0.1, fire);
    fireHissF.connect(fireHiss);

    // rain: two decorrelated pink layers, wide
    const rain = gain(0, ambientDry);
    rain.connect(gain(0.25, ambientWet));
    for (const side of [-0.6, 0.6]) {
      const hp = bq('highpass', 600);
      const lp = bq('lowpass', 4800);
      loopSrc(pink, side < 0 ? 1 : 1.03).connect(hp);
      hp.connect(lp);
      let tail: AudioNode = lp;
      if (typeof ctx.createStereoPanner === 'function') {
        const pn = ctx.createStereoPanner();
        pn.pan.value = side;
        lp.connect(pn);
        tail = pn;
      }
      tail.connect(rain);
    }

    // wind: slowly wandering bandpass
    const wind = gain(0, ambientDry);
    wind.connect(gain(0.2, ambientWet));
    const windBand = bq('bandpass', 500, 1.8);
    const windAmp = gain(0.7, wind);
    loopSrc(pink, 0.9).connect(windBand);
    windBand.connect(windAmp);

    // village murmur: very faint low chatter-like band
    const murmur = gain(0, ambientDry);
    const murF = bq('bandpass', 320, 0.9);
    loopSrc(brown, 1.1).connect(murF);
    murF.connect(murmur);

    this.g = {
      ctx, master, musicDry, musicWet, ambientDry, ambientWet, sfxDry, sfxWet, reverbIn,
      musicFade, padFilter, melodyBus, delay, white, pink, brown,
      beds: { fire, fireHiss, rain, wind, windAmp, windBand, murmur },
    };

    this.applyAmbient();
    this.lastTick = ctx.currentTime;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    if (this.musicWanted) {
      this.musicWanted = false;
      this.startMusic();
    }
  }

  private alive(): Graph | null {
    const g = this.g;
    if (!g) return null;
    if ((g.ctx.state as string) === 'closed') return null;
    return g;
  }

  // ------------------------------------------------------------ buffers

  private makeNoise(ctx: AudioContext, color: 'white' | 'pink' | 'brown', seconds: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if (color === 'white') {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else if (color === 'pink') {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    } else {
      let last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // Crossfade the loop seam.
    const fade = Math.min(2048, Math.floor(len / 8));
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[i] = d[i] * k + d[len - fade + i] * (1 - k);
    }
    return buf;
  }

  /** Warm, diffuse ~2s stereo impulse response, darkening over time. */
  private makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const pre = Math.floor(sr * 0.012);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        if (i < pre) {
          d[i] = 0;
          continue;
        }
        const t = (i - pre) / sr;
        const frac = i / len;
        const k = 0.55 - 0.47 * frac; // one-pole coefficient: brighter early, darker tail
        lp += k * (Math.random() * 2 - 1 - lp);
        const env = Math.exp(-3.0 * t) * (1 - frac) * Math.min(1, t / 0.006);
        d[i] = lp * env;
      }
    }
    return buf;
  }

  /** Karplus-Strong pluck, rendered once per midi note and cached. */
  private ksBuffer(ctx: AudioContext, midi: number): { buf: AudioBuffer; rate: number } {
    const hit = this.ksCache.get(midi);
    if (hit) return hit;
    const sr = ctx.sampleRate;
    const f = mtof(midi);
    const period = sr / f;
    const N = Math.max(2, Math.round(period - 0.5));
    const len = Math.floor(sr * 2.6);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let prev = 0;
    let mean = 0;
    for (let i = 0; i < N; i++) {
      prev = prev * 0.55 + (Math.random() * 2 - 1) * 0.45; // softened excitation
      d[i] = prev;
      mean += prev;
    }
    mean /= N;
    for (let i = 0; i < N; i++) d[i] -= mean;
    const rho = Math.pow(0.001, 1 / (2.2 * f));
    for (let i = N; i < len; i++) {
      const a = d[i - N];
      const b = i - N - 1 >= 0 ? d[i - N - 1] : a;
      d[i] = rho * 0.5 * (a + b);
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    const norm = peak > 0 ? 0.8 / peak : 1;
    const fadeLen = Math.floor(sr * 0.08);
    for (let i = 0; i < len; i++) {
      const tail = len - i < fadeLen ? (len - i) / fadeLen : 1;
      d[i] *= norm * tail;
    }
    const entry = { buf, rate: (N + 0.5) / period };
    this.ksCache.set(midi, entry);
    return entry;
  }

  // ------------------------------------------------------------ volumes

  setVolumes(v: Partial<Volumes>): void {
    try {
      for (const k of ['master', 'music', 'ambient', 'sfx'] as const) {
        const x = v[k];
        if (typeof x === 'number') this.vol[k] = clamp(x, 0, 1);
      }
      const g = this.alive();
      if (!g) return;
      const now = g.ctx.currentTime;
      const ramp = (p: AudioParam, x: number): void => {
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.setTargetAtTime(x, now, 0.06);
      };
      ramp(g.master.gain, this.vol.master);
      ramp(g.musicDry.gain, this.vol.music);
      ramp(g.musicWet.gain, this.vol.music);
      ramp(g.ambientDry.gain, this.vol.ambient);
      ramp(g.ambientWet.gain, this.vol.ambient);
      ramp(g.sfxDry.gain, this.vol.sfx);
      ramp(g.sfxWet.gain, this.vol.sfx);
    } catch {
      /* ignore */
    }
  }

  getVolumes(): Volumes {
    return { ...this.vol };
  }

  // ------------------------------------------------------------ ambient

  setAmbient(state: Partial<AmbientState>): void {
    try {
      const a = this.amb;
      if (typeof state.fire === 'number') a.fire = clamp(state.fire, 0, 1);
      if (typeof state.wind === 'number') a.wind = clamp(state.wind, 0, 1);
      if (typeof state.village === 'number') a.village = clamp(state.village, 0, 1);
      if (typeof state.rain === 'boolean') a.rain = state.rain;
      if (typeof state.night === 'boolean') a.night = state.night;
      this.applyAmbient();
    } catch {
      /* ignore */
    }
  }

  getAmbient(): AmbientState {
    return { ...this.amb };
  }

  private applyAmbient(): void {
    const g = this.alive();
    if (!g) return;
    const now = g.ctx.currentTime;
    const a = this.amb;
    const b = g.beds;
    b.fire.gain.setTargetAtTime(a.fire * 0.3, now, 0.8);
    b.rain.gain.setTargetAtTime(a.rain ? 0.2 : 0, now, 1.2);
    b.wind.gain.setTargetAtTime(a.wind * 0.28, now, 1.0);
    b.murmur.gain.setTargetAtTime(a.village * (a.night ? 0.2 : 1) * 0.05, now, 1.5);
  }

  // ------------------------------------------------------------ scheduler

  private tick(): void {
    try {
      const g = this.alive();
      if (!g) return;
      if ((g.ctx.state as string) !== 'running') return;
      const now = g.ctx.currentTime;
      const dt = clamp(now - this.lastTick, 0, 0.5);
      this.lastTick = now;
      this.tickAmbient(g, now, dt);
      this.tickLoops(g, now, dt);
      if (this.musicPlaying) this.tickMusic(g, now);
    } catch {
      /* ignore */
    }
  }

  private tickAmbient(g: Graph, now: number, dt: number): void {
    const a = this.amb;
    const b = g.beds;
    const win = TICK_MS / 1000;
    const at = (): number => now + 0.05 + Math.random() * win;

    // Fire: flicker the hiss and scatter crackles.
    if (a.fire > 0.01) {
      b.fireHiss.gain.setTargetAtTime(rand(0.04, 0.16), now, 0.12);
      const n = events(a.fire * 6, dt);
      for (let i = 0; i < n; i++) this.crackle(g, at(), a.fire * 0.8, g.ambientDry);
    }

    // Wind gusts.
    if (now >= this.nextGust) {
      this.nextGust = now + rand(1.5, 4.5);
      b.windBand.frequency.setTargetAtTime(rand(280, 900), now, rand(1, 2.5));
      b.windAmp.gain.setTargetAtTime(rand(0.35, 1), now, rand(0.8, 2));
    }

    // Rain drips on glass.
    if (a.rain) {
      const n = events(0.9, dt);
      for (let i = 0; i < n; i++) this.drip(g, at());
    }

    // Village life.
    if (a.village > 0.01) {
      if (a.night) {
        const n = events(a.village * 0.45, dt);
        for (let i = 0; i < n; i++) this.cricket(g, at(), a.village);
      } else {
        const n = events(a.village * 0.12, dt);
        for (let i = 0; i < n; i++) this.bird(g, at(), a.village);
      }
    }
  }

  private tickLoops(g: Graph, now: number, dt: number): void {
    const heat = this.loops.get('heat');
    if (heat) {
      const n = events(1.5 + heat.intensity * 7, dt);
      for (let i = 0; i < n; i++) {
        this.crackle(g, now + 0.05 + Math.random() * (TICK_MS / 1000), 0.4 + heat.intensity * 0.6, heat.level);
      }
    }
  }

  // ------------------------------------------------------------ ambient events

  private panNode(ctx: AudioContext, pan: number, dest: AudioNode): AudioNode {
    if (typeof ctx.createStereoPanner !== 'function') return dest;
    const p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    p.connect(dest);
    return p;
  }

  private crackle(g: Graph, t: number, strength: number, dest: AudioNode): void {
    const ctx = g.ctx;
    const src = ctx.createBufferSource();
    src.buffer = g.white;
    const f = ctx.createBiquadFilter();
    const low = Math.random() < 0.2;
    f.type = 'bandpass';
    f.frequency.value = low ? rand(500, 1100) : rand(1500, 5200);
    f.Q.value = rand(0.7, 2.5);
    const env = ctx.createGain();
    const d = low ? rand(0.02, 0.04) : rand(0.004, 0.018);
    const pk = strength * rand(0.15, 0.7) * (low ? 0.8 : 0.5);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(pk, t + 0.001);
    env.gain.exponentialRampToValueAtTime(EPS, t + d);
    src.connect(f);
    f.connect(env);
    env.connect(this.panNode(ctx, rand(-0.35, 0.35), dest));
    src.start(t, Math.random() * (g.white.duration - 0.1));
    src.stop(t + d + 0.02);
  }

  private drip(g: Graph, t: number): void {
    const ctx = g.ctx;
    const o = ctx.createOscillator();
    const env = ctx.createGain();
    const f0 = rand(1700, 3200);
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * rand(1.4, 1.8), t + 0.035);
    const pk = rand(0.015, 0.045);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(pk, t + 0.002);
    env.gain.exponentialRampToValueAtTime(EPS, t + 0.06);
    o.connect(env);
    const out = this.panNode(ctx, rand(-0.8, 0.8), g.ambientDry);
    env.connect(out);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    env.connect(send);
    send.connect(g.ambientWet);
    o.start(t);
    o.stop(t + 0.08);
  }

  private bird(g: Graph, t: number, level: number): void {
    const ctx = g.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.025 * level;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5000;
    out.connect(lp);
    lp.connect(this.panNode(ctx, rand(-0.9, 0.9), g.ambientDry));
    const send = ctx.createGain();
    send.gain.value = 0.6;
    lp.connect(send);
    send.connect(g.ambientWet);

    const base = rand(2400, 3800);
    const n = 2 + Math.floor(Math.random() * 4);
    const gap = rand(0.09, 0.16);
    const trill = Math.random() < 0.25;
    for (let i = 0; i < n; i++) {
      const s = t + i * (trill ? 0.05 : gap) + rand(0, 0.02);
      const len = trill ? 0.04 : rand(0.06, 0.11);
      const f = base * (trill ? 1 : rand(0.92, 1.1));
      const o = ctx.createOscillator();
      const e = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, s);
      o.frequency.exponentialRampToValueAtTime(f * rand(1.15, 1.45), s + len * 0.4);
      o.frequency.exponentialRampToValueAtTime(f * rand(0.85, 1), s + len);
      e.gain.setValueAtTime(0, s);
      e.gain.linearRampToValueAtTime(1, s + 0.008);
      e.gain.exponentialRampToValueAtTime(EPS, s + len);
      o.connect(e);
      e.connect(out);
      o.start(s);
      o.stop(s + len + 0.02);
    }
  }

  private cricket(g: Graph, t: number, level: number): void {
    const ctx = g.ctx;
    const o = ctx.createOscillator();
    const e = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = rand(4200, 4900);
    const pulses = 3 + Math.floor(Math.random() * 3);
    const pk = 0.012 * level;
    const repeats = Math.random() < 0.5 ? 2 : 1;
    e.gain.setValueAtTime(0, t);
    let end = t;
    for (let r = 0; r < repeats; r++) {
      for (let k = 0; k < pulses; k++) {
        const s = t + r * 0.35 + k * 0.028;
        e.gain.setValueAtTime(0, s);
        e.gain.linearRampToValueAtTime(pk, s + 0.005);
        e.gain.linearRampToValueAtTime(0, s + 0.02);
        end = s + 0.03;
      }
    }
    o.connect(e);
    e.connect(this.panNode(ctx, rand(-0.9, 0.9), g.ambientDry));
    o.start(t);
    o.stop(end + 0.02);
  }

  // ------------------------------------------------------------ music

  startMusic(): void {
    try {
      this.musicWanted = true;
      const g = this.alive();
      if (!g) return;
      if (this.musicPlaying) return;
      this.musicPlaying = true;
      const now = g.ctx.currentTime;
      if (this.pendingMood) {
        this.mood = this.pendingMood;
        this.pendingMood = null;
      }
      this.nextBeat = now + 0.3;
      this.beatInChord = 0;
      this.chordIdx = 0;
      this.melodyOn = true;
      this.applyMood(g, now, true);
      g.musicFade.gain.cancelScheduledValues(now);
      g.musicFade.gain.setValueAtTime(g.musicFade.gain.value, now);
      g.musicFade.gain.setTargetAtTime(1, now, 1.2);
    } catch {
      /* ignore */
    }
  }

  stopMusic(): void {
    try {
      this.musicWanted = false;
      const g = this.alive();
      if (!g) return;
      this.musicPlaying = false;
      const now = g.ctx.currentTime;
      g.musicFade.gain.cancelScheduledValues(now);
      g.musicFade.gain.setValueAtTime(g.musicFade.gain.value, now);
      g.musicFade.gain.setTargetAtTime(0, now, 0.9);
    } catch {
      /* ignore */
    }
  }

  setMusicMood(mood: MusicMood): void {
    try {
      if (!(mood in MOODS)) return;
      if (mood === this.mood && this.pendingMood === null) return;
      if (!this.musicPlaying) {
        // Not playing: take effect immediately (or on start).
        this.mood = mood;
        this.pendingMood = null;
        const g = this.alive();
        if (g) this.applyMood(g, g.ctx.currentTime, false);
        return;
      }
      this.pendingMood = mood === this.mood ? null : mood;
    } catch {
      /* ignore */
    }
  }

  getMusicMood(): MusicMood {
    return this.pendingMood ?? this.mood;
  }

  isMusicPlaying(): boolean {
    return this.musicPlaying || (!this.g && this.musicWanted);
  }

  private applyMood(g: Graph, t: number, instant: boolean): void {
    const def = MOODS[this.mood];
    const tc = instant ? 0.05 : 2.5;
    g.padFilter.frequency.setTargetAtTime(def.padCutoff, t, tc);
    g.delay.delayTime.setTargetAtTime((60 / def.bpm) * 0.75, t, instant ? 0.01 : 0.6);
    const notes: number[] = [];
    for (let m = def.melLo; m <= def.melHi; m++) {
      if (def.scale.includes((((m - def.root) % 12) + 12) % 12)) notes.push(m);
    }
    const prevMidi = this.melNotes[this.melIdx];
    this.melNotes = notes;
    if (prevMidi !== undefined) {
      let best = 0;
      for (let i = 0; i < notes.length; i++) {
        if (Math.abs(notes[i] - prevMidi) < Math.abs(notes[best] - prevMidi)) best = i;
      }
      this.melIdx = best;
    } else {
      this.melIdx = Math.floor(notes.length / 2);
    }
  }

  private tickMusic(g: Graph, now: number): void {
    if (this.nextBeat < now - 0.25) this.nextBeat = now + 0.1; // recover from throttled tabs
    let guard = 0;
    while (this.nextBeat < now + MUSIC_LOOKAHEAD && guard++ < 16) {
      this.nextBeat += this.scheduleBeat(g, this.nextBeat);
    }
  }

  /** Schedule one beat at time t; returns that beat's duration. */
  private scheduleBeat(g: Graph, t: number): number {
    if (this.beatInChord === 0) {
      const def0 = MOODS[this.mood];
      if (this.chordIdx % def0.prog.length === 0) {
        // Phrase boundary: apply pending mood, decide whether the melody rests.
        if (this.pendingMood) {
          this.mood = this.pendingMood;
          this.pendingMood = null;
          this.chordIdx = 0;
          this.applyMood(g, t, false);
        }
        this.melodyOn = Math.random() > MOODS[this.mood].restProb;
      }
    }
    const def = MOODS[this.mood];
    const beat = 60 / def.bpm;
    const bpc = def.beatsPerChord;
    const chord = def.prog[this.chordIdx % def.prog.length];

    if (this.beatInChord === 0) {
      const dur = bpc * beat;
      this.padChord(g, t, chord, def, dur);
      if (Math.random() < def.bassProb) this.lowNote(g, t + rand(0, beat), def.root - 12 + chord.bass, dur);
    }

    if (this.melodyOn && this.melNotes.length) {
      const breath = this.beatInChord >= bpc - 2 && Math.random() < 0.7;
      const prob = def.noteProb * (this.beatInChord === 0 ? 1.4 : 1);
      if (!breath && Math.random() < prob) {
        this.stepMelody(def, chord, this.beatInChord === 0);
        this.melodyNote(g, t + rand(0, 0.015), this.melNotes[this.melIdx], rand(0.6, 1), def);
        if (Math.random() < def.eighthProb) {
          this.stepMelody(def, chord, false);
          this.melodyNote(g, t + beat / 2, this.melNotes[this.melIdx], rand(0.4, 0.7), def);
        }
      }
    }

    this.beatInChord++;
    if (this.beatInChord >= bpc) {
      this.beatInChord = 0;
      this.chordIdx++;
    }
    return beat;
  }

  private stepMelody(def: MoodDef, chord: Chord, preferChordTone: boolean): void {
    const n = this.melNotes.length;
    const step = pick([-2, -1, -1, -1, 0, 1, 1, 1, 2, 3, -3]);
    let idx = clamp(this.melIdx + step, 0, n - 1);
    // Gentle pull toward the middle of the range.
    if (idx <= 1 && Math.random() < 0.5) idx += 2;
    if (idx >= n - 2 && Math.random() < 0.5) idx -= 2;
    if (preferChordTone) {
      const pcs = new Set(chord.pad.map((s) => (((s % 12) + 12) % 12)));
      const isCt = (i: number): boolean => pcs.has((((this.melNotes[i] - def.root) % 12) + 12) % 12);
      if (!isCt(idx)) {
        for (const d of [1, -1, 2, -2]) {
          const j = idx + d;
          if (j >= 0 && j < n && isCt(j)) {
            idx = j;
            break;
          }
        }
      }
    }
    this.melIdx = clamp(Math.round(idx), 0, n - 1);
  }

  private padChord(g: Graph, t: number, chord: Chord, def: MoodDef, dur: number): void {
    const ctx = g.ctx;
    const attack = Math.min(2.6, dur * 0.4);
    const release = 3;
    const vg = ctx.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(def.padLevel, t + attack);
    vg.gain.setValueAtTime(def.padLevel, t + dur);
    vg.gain.linearRampToValueAtTime(0, t + dur + release);
    vg.connect(g.padFilter);
    const stop = t + dur + release + 0.1;
    for (const s of chord.pad) {
      const m = def.root - 12 + s;
      const f = mtof(m);
      const ng = ctx.createGain();
      ng.gain.value = m > 66 ? 0.75 : 1; // keep upper voices soft
      ng.connect(vg);
      const o1 = ctx.createOscillator();
      o1.type = 'triangle';
      o1.frequency.value = f;
      o1.detune.value = rand(-8, -4);
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f;
      o2.detune.value = rand(4, 8);
      o1.connect(ng);
      o2.connect(ng);
      o1.start(t);
      o2.start(t);
      o1.stop(stop);
      o2.stop(stop);
    }
  }

  private lowNote(g: Graph, t: number, midi: number, dur: number): void {
    const ctx = g.ctx;
    const f = mtof(midi);
    const env = ctx.createGain();
    const len = Math.min(dur + 1.5, 7);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.11, t + 0.9);
    env.gain.exponentialRampToValueAtTime(EPS, t + len);
    env.connect(g.musicFade);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.12;
    o.connect(env);
    o2.connect(g2);
    g2.connect(env);
    o.start(t);
    o2.start(t);
    o.stop(t + len + 0.05);
    o2.stop(t + len + 0.05);
  }

  private melodyNote(g: Graph, t: number, midi: number, vel: number, def: MoodDef): void {
    const ctx = g.ctx;
    const lvl = def.melLevel * vel;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = def.pluckCutoff;
    lp.Q.value = 0.6;
    lp.connect(g.melodyBus);
    if (def.instrument === 'pluck') {
      const { buf, rate } = this.ksBuffer(ctx, midi);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(lvl, t + 0.006);
      env.gain.setTargetAtTime(0, t + 1.4, 0.4);
      src.connect(env);
      env.connect(lp);
      src.start(t);
      src.stop(t + buf.duration);
    } else {
      // Soft electric-piano-ish bell for night.
      const f = mtof(midi);
      const parts: [number, number, number][] = [
        [1, 1, 2.4],
        [2, 0.18, 1.2],
        [4, 0.06, 0.35],
      ];
      for (const [r, gn, dec] of parts) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * r;
        const e = ctx.createGain();
        e.gain.setValueAtTime(0, t);
        e.gain.linearRampToValueAtTime(lvl * gn * 0.7, t + 0.012);
        e.gain.exponentialRampToValueAtTime(EPS, t + dec);
        o.connect(e);
        e.connect(lp);
        o.start(t);
        o.stop(t + dec + 0.05);
      }
    }
  }

  // ------------------------------------------------------------ sfx primitives

  private voice(g: Graph, opts: SfxOpts | undefined, gain: number, wet: number, life: number, jitter = 0.015): Voice {
    const ctx = g.ctx;
    const t = ctx.currentTime + 0.005;
    const p = clamp(opts?.pitch ?? 1, 0.25, 4) * (1 + rand(-jitter, jitter));
    const vol = clamp(opts?.volume ?? 1, 0, 1.5);
    const out = ctx.createGain();
    out.gain.value = gain * vol;
    let tail: AudioNode = out;
    let pan: StereoPannerNode | null = null;
    if (opts?.pan && typeof ctx.createStereoPanner === 'function') {
      pan = ctx.createStereoPanner();
      pan.pan.value = clamp(opts.pan, -1, 1);
      out.connect(pan);
      tail = pan;
    }
    tail.connect(g.sfxDry);
    let send: GainNode | null = null;
    if (wet > 0) {
      send = ctx.createGain();
      send.gain.value = wet;
      tail.connect(send);
      send.connect(g.sfxWet);
    }
    this.activeVoices++;
    setTimeout(() => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
      try {
        out.disconnect();
        pan?.disconnect();
        send?.disconnect();
      } catch {
        /* ignore */
      }
    }, (life + 0.4) * 1000);
    return { ctx, t, p, out };
  }

  private biquad(ctx: AudioContext, s: BiquadSpec, t: number, total: number): BiquadFilterNode {
    const f = ctx.createBiquadFilter();
    f.type = s.type;
    f.frequency.setValueAtTime(clamp(s.f, 20, 20000), t);
    if (s.fEnd !== undefined) {
      f.frequency.exponentialRampToValueAtTime(clamp(s.fEnd, 20, 20000), t + (s.fTime ?? total));
    }
    f.Q.value = s.q ?? (s.type === 'bandpass' ? 1 : 0.707);
    return f;
  }

  private filt(v: Voice, type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
    const n = v.ctx.createBiquadFilter();
    n.type = type;
    n.frequency.value = clamp(f, 20, 20000);
    n.Q.value = q;
    n.connect(v.out);
    return n;
  }

  private tone(v: Voice, s: ToneSpec): void {
    const ctx = v.ctx;
    const t = v.t + (s.t ?? 0);
    const a = s.a ?? 0.002;
    const total = a + s.d;
    const o = ctx.createOscillator();
    o.type = s.type ?? 'sine';
    o.frequency.setValueAtTime(clamp(s.f, 10, 20000), t);
    if (s.fEnd !== undefined) o.frequency.exponentialRampToValueAtTime(clamp(s.fEnd, 10, 20000), t + (s.fTime ?? total));
    if (s.detune) o.detune.value = s.detune;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(s.g, t + a);
    e.gain.exponentialRampToValueAtTime(EPS, t + total);
    o.connect(e);
    e.connect(s.dest ?? v.out);
    o.start(t);
    o.stop(t + total + 0.03);
  }

  private noise(v: Voice, g: Graph, s: NoiseSpec): void {
    const ctx = v.ctx;
    const t = v.t + (s.t ?? 0);
    const a = s.a ?? 0.002;
    const total = a + s.d;
    const buf = s.color === 'brown' ? g.brown : s.color === 'pink' ? g.pink : g.white;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (s.rate) src.playbackRate.value = s.rate;
    if (total > buf.duration - 0.2) src.loop = true;
    let node: AudioNode = src;
    for (const fs of s.filters ?? []) {
      const bq = this.biquad(ctx, fs, t, total);
      node.connect(bq);
      node = bq;
    }
    let lfo: OscillatorNode | null = null;
    if (s.mod) {
      const depth = clamp(s.mod.depth, 0, 1);
      const am = ctx.createGain();
      am.gain.value = 1 - depth / 2;
      lfo = ctx.createOscillator();
      lfo.type = s.mod.type ?? 'sine';
      lfo.frequency.value = s.mod.f;
      const amt = ctx.createGain();
      amt.gain.value = depth / 2;
      lfo.connect(amt);
      amt.connect(am.gain);
      node.connect(am);
      node = am;
    }
    const e = ctx.createGain();
    e.gain.setValueAtTime(0, t);
    e.gain.linearRampToValueAtTime(s.g, t + a);
    e.gain.exponentialRampToValueAtTime(EPS, t + total);
    node.connect(e);
    e.connect(s.dest ?? v.out);
    const maxOff = Math.max(0, buf.duration - total - 0.1);
    src.start(t, Math.random() * maxOff);
    src.stop(t + total + 0.03);
    if (lfo) {
      lfo.start(t);
      lfo.stop(t + total + 0.03);
    }
  }

  /** Inharmonic bell: partials as [ratio, gain, decay]. */
  private bell(v: Voice, f: number, t: number, gain: number, parts: [number, number, number][], dest?: AudioNode): void {
    for (const [r, gn, d] of parts) {
      this.tone(v, { f: f * r, t, a: 0.002, d, g: gain * gn, dest });
    }
  }

  // ------------------------------------------------------------ public sfx

  sfx(name: Sfx, opts?: SfxOpts): void {
    try {
      const g = this.alive();
      if (!g || (g.ctx.state as string) !== 'running') return;
      const impl = this.sfxImpl[name];
      if (!impl) return;
      const now = g.ctx.currentTime;
      const last = this.lastPlayed.get(name);
      const gap = MIN_GAP[name] ?? DEFAULT_GAP;
      if (last !== undefined && now - last < gap && now >= last) return;
      if (this.activeVoices >= MAX_VOICES && name !== 'success') return;
      this.lastPlayed.set(name, now);
      impl(g, opts);
    } catch {
      /* ignore */
    }
  }

  private readonly sfxImpl: Record<Sfx, (g: Graph, o?: SfxOpts) => void> = {
    hammer: (g, o) => {
      const v = this.voice(g, o, 0.55, 0.14, 1.0);
      const f = 640 * v.p;
      const lp = this.filt(v, 'lowpass', 5200);
      this.bell(v, f, 0, 1, [
        [1, 0.42, 0.75],
        [2.32, 0.24, 0.5],
        [3.87, 0.13, 0.3],
        [5.41, 0.06, 0.16],
      ], lp);
      this.noise(v, g, { d: 0.035, g: 0.45, filters: [{ type: 'bandpass', f: 2600, q: 0.8 }], dest: lp });
      this.tone(v, { f: 150, fEnd: 70, d: 0.09, g: 0.45, fTime: 0.08 });
    },

    hammerPerfect: (g, o) => {
      const v = this.voice(g, o, 0.55, 0.3, 1.9);
      const f = 700 * v.p;
      const lp = this.filt(v, 'lowpass', 7000);
      this.bell(v, f, 0, 1, [
        [1, 0.42, 1.5],
        [2.0, 0.16, 1.2],
        [2.32, 0.2, 0.85],
        [3.87, 0.12, 0.5],
        [5.41, 0.06, 0.3],
        [6.9, 0.03, 0.2],
      ], lp);
      // Shimmer: a detuned octave pair that beats slowly.
      this.tone(v, { f: f * 2, detune: 9, d: 1.7, g: 0.09, a: 0.01, dest: lp });
      this.tone(v, { f: f * 3, detune: -7, d: 1.1, g: 0.035, a: 0.02, dest: lp });
      // Tiny glints on top.
      const glints = [86, 90, 93];
      glints.forEach((m, i) => {
        this.tone(v, { f: mtof(m) * Math.sqrt(v.p), t: 0.04 + i * 0.06, d: 0.35, g: 0.035, dest: lp });
      });
      this.noise(v, g, { d: 0.03, g: 0.4, filters: [{ type: 'bandpass', f: 3200, q: 0.8 }], dest: lp });
      this.tone(v, { f: 160, fEnd: 70, d: 0.1, g: 0.45, fTime: 0.09 });
    },

    hammerMiss: (g, o) => {
      const v = this.voice(g, o, 0.6, 0.05, 0.4);
      const lp = this.filt(v, 'lowpass', 600);
      this.tone(v, { f: 115 * v.p, fEnd: 55 * v.p, d: 0.18, g: 0.6, fTime: 0.15 });
      this.noise(v, g, { color: 'brown', d: 0.12, g: 0.7, filters: [{ type: 'lowpass', f: 380 }] });
      this.tone(v, { f: 310 * v.p, d: 0.08, g: 0.1, dest: lp });
    },

    sizzle: (g, o) => {
      const v = this.voice(g, o, 0.45, 0.1, 1.2);
      this.noise(v, g, {
        a: 0.015, d: 0.9, g: 0.32,
        filters: [{ type: 'bandpass', f: 7000 * v.p, fEnd: 1800 * v.p, q: 0.9 }, { type: 'highpass', f: 900 }],
      });
      this.noise(v, g, { color: 'pink', a: 0.03, d: 0.5, g: 0.12, filters: [{ type: 'lowpass', f: 1200 }] });
      for (let i = 0; i < 6; i++) {
        this.noise(v, g, {
          t: rand(0, 0.4), d: rand(0.005, 0.015), g: rand(0.1, 0.25),
          filters: [{ type: 'bandpass', f: rand(2500, 6000), q: 2 }],
        });
      }
    },

    bellows: (g, o) => {
      const v = this.voice(g, o, 0.5, 0.06, 0.9);
      this.noise(v, g, {
        color: 'pink', a: 0.18, d: 0.5, g: 0.35,
        filters: [{ type: 'bandpass', f: 500 * v.p, fEnd: 900 * v.p, fTime: 0.25, q: 0.7 }, { type: 'lowpass', f: 1400 }],
      });
      this.noise(v, g, { color: 'brown', a: 0.15, d: 0.45, g: 0.35, filters: [{ type: 'lowpass', f: 220 }] });
    },

    grind: (g, o) => {
      const v = this.voice(g, o, 0.42, 0.04, 0.45);
      this.noise(v, g, {
        a: 0.02, d: 0.26, g: 0.3,
        filters: [{ type: 'bandpass', f: 2800 * v.p, q: 2.5 }, { type: 'highpass', f: 900 }],
        mod: { f: 55, depth: 0.6, type: 'sawtooth' },
      });
      this.noise(v, g, {
        a: 0.02, d: 0.2, g: 0.1,
        filters: [{ type: 'bandpass', f: 5200 * v.p, q: 4 }],
        mod: { f: 83, depth: 0.7, type: 'square' },
      });
    },

    polish: (g, o) => {
      const v = this.voice(g, o, 0.4, 0.06, 0.5);
      this.noise(v, g, {
        color: 'pink', a: 0.08, d: 0.3, g: 0.28,
        filters: [{ type: 'bandpass', f: 1400 * v.p, fEnd: 2600 * v.p, fTime: 0.2, q: 0.8 }, { type: 'lowpass', f: 4000 }],
      });
    },

    engrave: (g, o) => {
      const v = this.voice(g, o, 0.35, 0.04, 0.3);
      this.noise(v, g, {
        a: 0.005, d: 0.14, g: 0.22,
        filters: [{ type: 'bandpass', f: 5500 * v.p, q: 6 }],
        mod: { f: 120, depth: 0.7, type: 'square' },
      });
      this.tone(v, { f: 3100 * v.p, fEnd: 2900 * v.p, d: 0.08, g: 0.025 });
    },

    click: (g, o) => {
      const v = this.voice(g, o, 0.3, 0, 0.1, 0.01);
      this.tone(v, { f: 1600 * v.p, fEnd: 1200 * v.p, a: 0.001, d: 0.035, g: 0.5 });
      this.noise(v, g, { a: 0.0005, d: 0.008, g: 0.12, filters: [{ type: 'highpass', f: 3000 }] });
    },

    hover: (g, o) => {
      const v = this.voice(g, o, 0.12, 0, 0.06, 0.02);
      this.tone(v, { f: 2200 * v.p, a: 0.001, d: 0.02, g: 0.3 });
    },

    place: (g, o) => {
      const v = this.voice(g, o, 0.55, 0.05, 0.3);
      const lp = this.filt(v, 'lowpass', 2200);
      this.tone(v, { f: 210 * v.p, fEnd: 140 * v.p, d: 0.14, g: 0.5, fTime: 0.1, dest: lp });
      this.tone(v, { type: 'triangle', f: 420 * v.p, fEnd: 300 * v.p, d: 0.07, g: 0.15, dest: lp });
      this.noise(v, g, { d: 0.04, g: 0.3, filters: [{ type: 'bandpass', f: 900 * v.p, q: 1.2 }], dest: lp });
    },

    snap: (g, o) => {
      const v = this.voice(g, o, 0.45, 0.06, 0.15);
      this.noise(v, g, { a: 0.0005, d: 0.012, g: 0.4, filters: [{ type: 'highpass', f: 2500 }] });
      this.tone(v, { f: 1900 * v.p, fEnd: 1500 * v.p, a: 0.001, d: 0.03, g: 0.18 });
      this.tone(v, { f: 950 * v.p, a: 0.001, d: 0.05, g: 0.1 });
    },

    chime: (g, o) => {
      const v = this.voice(g, o, 0.38, 0.35, 1.8);
      const deg = pick([0, 2, 4, 7, 9, 12, 14, 16]);
      const f = mtof(74 + deg) * v.p;
      this.bell(v, f, 0, 1, [
        [1, 0.4, 1.6],
        [2.0, 0.12, 1.0],
        [2.76, 0.07, 0.6],
        [5.4, 0.025, 0.3],
      ]);
    },

    success: (g, o) => {
      const v = this.voice(g, o, 0.38, 0.38, 2.3);
      const notes = [74, 78, 81];
      notes.forEach((m, i) => {
        const last = i === notes.length - 1;
        this.bell(v, mtof(m) * v.p, i * 0.11, last ? 1 : 0.85, [
          [1, 0.38, last ? 1.9 : 1.1],
          [2.0, 0.1, last ? 1.2 : 0.7],
          [2.76, 0.05, 0.5],
          [5.4, 0.02, 0.25],
        ]);
      });
      this.tone(v, { f: mtof(86) * v.p, t: 0.3, d: 0.6, g: 0.05 });
    },

    soft: (g, o) => {
      const v = this.voice(g, o, 0.4, 0.15, 0.8);
      const lp = this.filt(v, 'lowpass', 1100);
      this.tone(v, { type: 'triangle', f: 392 * v.p, a: 0.015, d: 0.16, g: 0.28, dest: lp });
      this.tone(v, { type: 'triangle', f: 330 * v.p, t: 0.13, a: 0.02, d: 0.45, g: 0.3, dest: lp });
      this.tone(v, { f: 165 * v.p, t: 0.13, a: 0.03, d: 0.5, g: 0.16, dest: lp });
    },

    pop: (g, o) => {
      const v = this.voice(g, o, 0.4, 0.05, 0.15);
      this.tone(v, { f: 620 * v.p, fEnd: 180 * v.p, a: 0.002, d: 0.07, g: 0.5, fTime: 0.05 });
      this.noise(v, g, { d: 0.01, g: 0.06, filters: [{ type: 'lowpass', f: 2000 }] });
    },

    sparkle: (g, o) => {
      const v = this.voice(g, o, 0.3, 0.45, 0.8);
      const pool = [86, 88, 90, 93, 95, 98, 100];
      for (let i = 0; i < 6; i++) {
        const f = mtof(pick(pool)) * v.p;
        const t = i * 0.035 + rand(0, 0.02);
        this.tone(v, { f, t, d: 0.25, g: 0.18 });
        this.tone(v, { f: f * 2.76, t, d: 0.08, g: 0.03 });
      }
    },

    stone: (g, o) => {
      const v = this.voice(g, o, 0.45, 0.08, 0.2);
      const lp = this.filt(v, 'lowpass', 3500);
      this.noise(v, g, { d: 0.03, g: 0.35, filters: [{ type: 'bandpass', f: 1600 * v.p, q: 1.5 }], dest: lp });
      this.tone(v, { f: 820 * v.p, d: 0.07, g: 0.12, dest: lp });
      this.tone(v, { f: 1290 * v.p, d: 0.05, g: 0.08, dest: lp });
      this.tone(v, { f: 2100 * v.p, d: 0.03, g: 0.04, dest: lp });
      this.tone(v, { f: 200 * v.p, d: 0.04, g: 0.15 });
    },

    glass: (g, o) => {
      const v = this.voice(g, o, 0.35, 0.25, 0.9);
      const f = 2400 * v.p;
      this.bell(v, f, 0, 1, [
        [1, 0.3, 0.7],
        [2.32, 0.17, 0.45],
        [4.25, 0.1, 0.25],
        [6.1, 0.04, 0.12],
      ]);
      this.noise(v, g, { a: 0.0005, d: 0.005, g: 0.15, filters: [{ type: 'highpass', f: 6000 }] });
    },

    coin: (g, o) => {
      const v = this.voice(g, o, 0.3, 0.2, 0.7);
      const offs = [0, 0.06, 0.11, 0.19];
      const n = 3 + (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const f = rand(2600, 3600) * v.p;
        const t = offs[i] + rand(-0.01, 0.015);
        const gn = i === 0 ? 1 : rand(0.5, 0.85);
        this.bell(v, f, t, gn, [
          [1, 0.3, 0.3],
          [1.47, 0.18, 0.22],
          [2.09, 0.1, 0.15],
          [2.56, 0.06, 0.1],
        ]);
      }
    },

    page: (g, o) => {
      const v = this.voice(g, o, 0.4, 0.05, 0.4);
      this.noise(v, g, {
        color: 'pink', a: 0.03, d: 0.22, g: 0.3,
        filters: [{ type: 'bandpass', f: 2200 * v.p, q: 0.6 }, { type: 'highpass', f: 700 }],
        mod: { f: 18, depth: 0.5 },
      });
      this.noise(v, g, { t: 0.12, a: 0.003, d: 0.05, g: 0.12, filters: [{ type: 'highpass', f: 3500 }] });
    },

    door: (g, o) => {
      const v = this.voice(g, o, 0.4, 0.3, 1.9);
      // Wood creak: a slow, wobbly sawtooth through wood-like resonances.
      const ctx = v.ctx;
      const t = v.t;
      const creak = ctx.createOscillator();
      creak.type = 'sawtooth';
      creak.frequency.setValueAtTime(70 * v.p, t);
      creak.frequency.linearRampToValueAtTime(95 * v.p, t + 0.5);
      const wob = ctx.createOscillator();
      wob.frequency.value = 7;
      const wobAmt = ctx.createGain();
      wobAmt.gain.value = 10 * v.p;
      wob.connect(wobAmt);
      wobAmt.connect(creak.frequency);
      const ce = ctx.createGain();
      ce.gain.setValueAtTime(0, t);
      ce.gain.linearRampToValueAtTime(0.14, t + 0.08);
      ce.gain.setValueAtTime(0.14, t + 0.35);
      ce.gain.exponentialRampToValueAtTime(EPS, t + 0.6);
      const lp = this.filt(v, 'lowpass', 2400);
      for (const [bf, q] of [[700, 6], [1400, 8]] as const) {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = bf * v.p;
        bp.Q.value = q;
        ce.connect(bp);
        bp.connect(lp);
      }
      creak.connect(ce);
      creak.start(t);
      wob.start(t);
      creak.stop(t + 0.65);
      wob.stop(t + 0.65);
      // Shop bell, struck a few times by the clapper.
      const bf = 1550 * v.p;
      const parts: [number, number, number][] = [
        [1, 0.2, 1.2],
        [2.42, 0.09, 0.7],
        [3.8, 0.05, 0.4],
        [5.1, 0.02, 0.25],
      ];
      this.bell(v, bf, 0.4, 1, parts);
      this.bell(v, bf * 1.004, 0.49, 0.6, parts);
      this.bell(v, bf, 0.62, 0.35, parts);
    },

    step: (g, o) => {
      const v = this.voice(g, o, 0.4, 0, 0.15, 0.06);
      this.noise(v, g, { color: 'brown', a: 0.004, d: 0.07, g: 0.6, filters: [{ type: 'lowpass', f: rand(250, 380) * v.p }] });
      this.tone(v, { f: 95 * v.p, fEnd: 60 * v.p, d: 0.07, g: 0.25 });
      if (Math.random() < 0.15) {
        this.tone(v, { type: 'triangle', f: rand(300, 420) * v.p, t: 0.02, a: 0.01, d: 0.06, g: 0.03 });
      }
    },

    fold: (g, o) => {
      const v = this.voice(g, o, 0.6, 0.12, 0.6);
      const lp = this.filt(v, 'lowpass', 900);
      this.tone(v, { f: 85 * v.p, fEnd: 42 * v.p, d: 0.4, g: 0.6, fTime: 0.3 });
      this.noise(v, g, { color: 'brown', a: 0.005, d: 0.3, g: 0.6, filters: [{ type: 'lowpass', f: 450 }] });
      this.tone(v, { f: 240 * v.p, d: 0.35, g: 0.08, dest: lp });
      this.tone(v, { f: 390 * v.p, d: 0.25, g: 0.05, dest: lp });
      this.tone(v, { f: 610 * v.p, d: 0.15, g: 0.03, dest: lp });
    },

    star: (g, o) => {
      const v = this.voice(g, o, 0.3, 0.5, 1.2);
      const ctx = v.ctx;
      const trem = ctx.createGain();
      trem.gain.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 14;
      const amt = ctx.createGain();
      amt.gain.value = 0.3;
      lfo.connect(amt);
      amt.connect(trem.gain);
      trem.connect(v.out);
      lfo.start(v.t);
      lfo.stop(v.t + 1.0);
      const a = mtof(pick([93, 95, 98])) * v.p;
      const b = a * 1.5;
      this.tone(v, { f: a, fEnd: a * 1.02, d: 0.6, g: 0.22, dest: trem });
      this.tone(v, { f: b, t: 0.06, fEnd: b * 1.02, d: 0.7, g: 0.16, dest: trem });
      this.tone(v, { f: b * 2, t: 0.06, d: 0.25, g: 0.03, dest: trem });
    },
  };

  // ------------------------------------------------------------ loops

  loop(name: LoopSfx, on: boolean, intensity = 1): void {
    try {
      const g = this.alive();
      if (!g) return;
      const i = clamp(intensity, 0, 1);
      const now = g.ctx.currentTime;
      const existing = this.loops.get(name);
      if (on) {
        if (!existing) {
          const lv = this.makeLoop(g, name);
          if (!lv) return;
          this.loops.set(name, lv);
          lv.intensity = i;
          lv.update(i, now);
        } else if (Math.abs(existing.intensity - i) > 0.005) {
          existing.intensity = i;
          existing.update(i, now);
        }
      } else if (existing) {
        this.loops.delete(name);
        const p = existing.level.gain;
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.setTargetAtTime(0, now, 0.08);
        for (const s of existing.srcs) {
          try {
            s.stop(now + 0.6);
          } catch {
            /* ignore */
          }
        }
        setTimeout(() => {
          try {
            existing.level.disconnect();
            for (const n of existing.nodes) n.disconnect();
          } catch {
            /* ignore */
          }
        }, 800);
      }
    } catch {
      /* ignore */
    }
  }

  /** Stop all held-action loops (e.g. when leaving a minigame). */
  stopAllLoops(): void {
    for (const k of Array.from(this.loops.keys())) this.loop(k, false);
  }

  private makeLoop(g: Graph, name: LoopSfx): LoopVoice | null {
    const ctx = g.ctx;
    const now = ctx.currentTime;
    const level = ctx.createGain();
    level.gain.value = 0;
    level.connect(g.sfxDry);
    const srcs: AudioScheduledSourceNode[] = [];
    const nodes: AudioNode[] = [];
    const noiseSrc = (buf: AudioBuffer): AudioBufferSourceNode => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.start(now, Math.random() * buf.duration * 0.9);
      srcs.push(s);
      nodes.push(s);
      return s;
    };
    const bq = (type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode => {
      const n = ctx.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      nodes.push(n);
      return n;
    };
    const lfoGain = (freq: number, depth: number, type: OscillatorType = 'sine'): { am: GainNode; lfo: OscillatorNode; amt: GainNode } => {
      const am = ctx.createGain();
      am.gain.value = 1 - depth / 2;
      const lfo = ctx.createOscillator();
      lfo.type = type;
      lfo.frequency.value = freq;
      const amt = ctx.createGain();
      amt.gain.value = depth / 2;
      lfo.connect(amt);
      amt.connect(am.gain);
      lfo.start(now);
      srcs.push(lfo);
      nodes.push(am, lfo, amt);
      return { am, lfo, amt };
    };
    const set = (p: AudioParam, v: number, t: number, tc = 0.06): void => {
      p.setTargetAtTime(v, t, tc);
    };

    switch (name) {
      case 'grind': {
        const src = noiseSrc(g.white);
        const bp = bq('bandpass', 2000, 2.2);
        const hp = bq('highpass', 800);
        const { am, lfo } = lfoGain(50, 0.6, 'sawtooth');
        const bp2 = bq('bandpass', 5000, 4);
        const g2 = ctx.createGain();
        g2.gain.value = 0.35;
        nodes.push(g2);
        src.connect(bp);
        bp.connect(hp);
        hp.connect(am);
        src.connect(bp2);
        bp2.connect(g2);
        g2.connect(am);
        am.connect(level);
        return {
          level, srcs, nodes, intensity: 0,
          update: (i, t) => {
            set(bp.frequency, 1300 + 2600 * i, t);
            set(bp2.frequency, 4000 + 2500 * i, t);
            set(lfo.frequency, 35 + 60 * i, t);
            set(level.gain, 0.08 + 0.2 * i, t);
          },
        };
      }
      case 'polish': {
        const src = noiseSrc(g.pink);
        const bp = bq('bandpass', 1600, 0.8);
        const lp = bq('lowpass', 3800);
        const { am, lfo } = lfoGain(2.5, 0.75);
        src.connect(bp);
        bp.connect(lp);
        lp.connect(am);
        am.connect(level);
        return {
          level, srcs, nodes, intensity: 0,
          update: (i, t) => {
            set(bp.frequency, 1200 + 1400 * i, t);
            set(lfo.frequency, 1.8 + 3 * i, t);
            set(level.gain, 0.07 + 0.14 * i, t);
          },
        };
      }
      case 'bellows': {
        const src = noiseSrc(g.pink);
        const lp = bq('lowpass', 600);
        const low = noiseSrc(g.brown);
        const lowF = bq('lowpass', 200);
        const { am, lfo } = lfoGain(0.8, 0.8);
        src.connect(lp);
        lp.connect(am);
        low.connect(lowF);
        lowF.connect(am);
        am.connect(level);
        return {
          level, srcs, nodes, intensity: 0,
          update: (i, t) => {
            set(lp.frequency, 400 + 900 * i, t, 0.1);
            set(lfo.frequency, 0.6 + 0.8 * i, t, 0.2);
            set(level.gain, 0.1 + 0.25 * i, t, 0.1);
          },
        };
      }
      case 'heat': {
        const src = noiseSrc(g.brown);
        const lp = bq('lowpass', 300);
        const roar = noiseSrc(g.pink);
        const roarF = bq('bandpass', 700, 0.6);
        const roarG = ctx.createGain();
        roarG.gain.value = 0.15;
        nodes.push(roarG);
        const { am } = lfoGain(3.3, 0.25);
        src.connect(lp);
        lp.connect(am);
        roar.connect(roarF);
        roarF.connect(roarG);
        roarG.connect(am);
        am.connect(level);
        return {
          level, srcs, nodes, intensity: 0,
          update: (i, t) => {
            set(lp.frequency, 220 + 900 * i, t, 0.12);
            set(roarF.frequency, 500 + 900 * i, t, 0.12);
            set(roarG.gain, 0.08 + 0.3 * i, t, 0.12);
            set(level.gain, 0.15 + 0.35 * i, t, 0.12);
          },
        };
      }
      default:
        return null;
    }
  }
}

export const audio = new AudioEngine();
