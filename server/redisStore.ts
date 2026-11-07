// Showcase store on Upstash Redis over its REST API. Also picks which store
// the deployment's environment variables point at (see storeFromEnv).

import { Redis } from '@upstash/redis';
import type { ShowcaseStore } from './showcaseCore.js';

export type RedisConfig = { kind: 'rest'; url: string; token: string } | { kind: 'tcp'; url: string };

/**
 * Which Redis the deployment is connected to:
 *  - Upstash REST: KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *  - any Redis connection string: REDIS_URL (or KV_URL), e.g. from Vercel's Redis integration
 */
export function redisConfig(env: Record<string, string | undefined>): RedisConfig | null {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return { kind: 'rest', url, token };
  const conn = env.REDIS_URL || env.KV_URL;
  if (conn && /^rediss?:\/\//.test(conn)) return { kind: 'tcp', url: conn };
  return null;
}

export class RedisStore implements ShowcaseStore {
  private r: Redis;
  constructor(cfg: { url: string; token: string }) {
    this.r = new Redis({ url: cfg.url, token: cfg.token, automaticDeserialization: false });
  }
  async get(key: string) { return (await this.r.get<string>(key)) ?? null; }
  async mget(keys: string[]) { return keys.length ? ((await this.r.mget<(string | null)[]>(...keys)) ?? []) : []; }
  async set(key: string, value: string, ttlSec?: number) { if (ttlSec) await this.r.set(key, value, { ex: ttlSec }); else await this.r.set(key, value); }
  async del(...keys: string[]) { if (keys.length) await this.r.del(...keys); }
  async incr(key: string, ttlSec: number) {
    const n = await this.r.incr(key);
    if (n === 1) await this.r.expire(key, ttlSec);
    return n;
  }
  async zadd(key: string, score: number, member: string) { await this.r.zadd(key, { score, member }); }
  async zrevrange(key: string, start: number, stop: number) { return (await this.r.zrange<string[]>(key, start, stop, { rev: true })).map(String); }
  async zrange(key: string, start: number, stop: number) { return (await this.r.zrange<string[]>(key, start, stop)).map(String); }
  async zrem(key: string, ...members: string[]) { if (members.length) await this.r.zrem(key, ...members); }
  async zcard(key: string) { return await this.r.zcard(key); }
}
