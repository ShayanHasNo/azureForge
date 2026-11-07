// Deterministic seeded randomness. Every procedural decision in the game flows
// through these helpers so that items can be reproduced exactly from their seed.

/** FNV-1a 32-bit hash of a string. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mix several integers into one 32-bit hash. */
export function hash32(...ns: number[]): number {
  let h = 0x9e3779b9;
  for (const n of ns) {
    h ^= (n | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/** Deterministic noise in [0,1) for integer lattice coordinates. */
export function noise2(seed: number, x: number, y: number): number {
  return hash32(seed, x, y) / 4294967296;
}

/** Smooth value noise in [0,1) for real coordinates. */
export function valueNoise(seed: number, x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = noise2(seed, xi, yi), b = noise2(seed, xi + 1, yi);
  const c = noise2(seed, xi, yi + 1), d = noise2(seed, xi + 1, yi + 1);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x12345678;
  }
  /** mulberry32 */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
  /** Gaussian-ish value (mean 0, sd ~1). */
  normal(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }
  /** Independent child stream for a named purpose. */
  fork(label: string): Rng {
    return new Rng(hash32(this.s, hashString(label)));
  }
}

export function seededRng(seed: number, label = ''): Rng {
  return new Rng(hash32(seed, hashString(label)));
}

export function newSeed(): number {
  // Real entropy only for brand-new seeds; everything downstream is deterministic.
  const a = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
  else a[0] = (Math.random() * 4294967296) >>> 0;
  return a[0] >>> 0;
}

export function newId(prefix = 'it'): string {
  return `${prefix}_${newSeed().toString(36)}${Date.now().toString(36).slice(-4)}`;
}
