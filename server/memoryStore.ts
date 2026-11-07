// In-memory showcase store for local development, previews and tests.

import type { ShowcaseStore } from './showcaseCore';

export class MemoryStore implements ShowcaseStore {
  private kv = new Map<string, { v: string; exp: number }>();
  private z = new Map<string, Map<string, number>>();
  constructor(private clock: () => number = Date.now) {}

  private live(key: string) {
    const e = this.kv.get(key);
    if (!e) return null;
    if (e.exp && e.exp <= this.clock()) { this.kv.delete(key); return null; }
    return e;
  }
  async get(key: string) { return this.live(key)?.v ?? null; }
  async mget(keys: string[]) { return keys.map((k) => this.live(k)?.v ?? null); }
  async set(key: string, value: string, ttlSec?: number) { this.kv.set(key, { v: value, exp: ttlSec ? this.clock() + ttlSec * 1000 : 0 }); }
  async del(...keys: string[]) { for (const k of keys) this.kv.delete(k); }
  async incr(key: string, ttlSec: number) {
    const e = this.live(key);
    const n = (e ? Number(e.v) : 0) + 1;
    this.kv.set(key, { v: String(n), exp: e?.exp || this.clock() + ttlSec * 1000 });
    return n;
  }
  private zset(key: string) {
    let s = this.z.get(key);
    if (!s) this.z.set(key, (s = new Map()));
    return s;
  }
  private sorted(key: string) {
    return [...this.zset(key).entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(([m]) => m);
  }
  async zadd(key: string, score: number, member: string) { this.zset(key).set(member, score); }
  async zrevrange(key: string, start: number, stop: number) { return this.sorted(key).reverse().slice(start, stop + 1); }
  async zrange(key: string, start: number, stop: number) { return this.sorted(key).slice(start, stop + 1); }
  async zrem(key: string, ...members: string[]) { const s = this.zset(key); for (const m of members) s.delete(m); }
  async zcard(key: string) { return this.zset(key).size; }
}
