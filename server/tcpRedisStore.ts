// Showcase store over a standard Redis connection string (REDIS_URL), as
// provided by Vercel's Redis integration. The client is created once per
// function instance and reused while the instance stays warm.

import { createClient } from 'redis';
import type { ShowcaseStore } from './showcaseCore.js';

const makeClient = (url: string) =>
  createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: (n: number) => (n > 3 ? false : Math.min(n * 200, 1000)) } });
type Client = ReturnType<typeof makeClient>;

export class TcpRedisStore implements ShowcaseStore {
  private client: Promise<Client> | null = null;
  constructor(private url: string) {}

  private c(): Promise<Client> {
    let pending = this.client;
    if (!pending) {
      const client = makeClient(this.url);
      // Errors surface on the failing command; this keeps them from crashing the instance.
      client.on('error', () => {});
      pending = this.client = client.connect().then(() => client, (e) => { this.client = null; throw e; });
    }
    return pending.then((cl) => {
      if (!cl.isOpen) { this.client = null; return this.c(); }
      return cl;
    });
  }

  async get(key: string) { return (await (await this.c()).get(key)) ?? null; }
  async mget(keys: string[]) { return keys.length ? (await (await this.c()).mGet(keys)).map((v) => v ?? null) : []; }
  async set(key: string, value: string, ttlSec?: number) {
    const cl = await this.c();
    if (ttlSec) await cl.set(key, value, { expiration: { type: 'EX', value: ttlSec } });
    else await cl.set(key, value);
  }
  async del(...keys: string[]) { if (keys.length) await (await this.c()).del(keys); }
  async incr(key: string, ttlSec: number) {
    const cl = await this.c();
    const n = await cl.incr(key);
    if (n === 1) await cl.expire(key, ttlSec);
    return n;
  }
  async zadd(key: string, score: number, member: string) { await (await this.c()).zAdd(key, { score, value: member }); }
  async zrevrange(key: string, start: number, stop: number) { return (await (await this.c()).zRange(key, start, stop, { REV: true })).map(String); }
  async zrange(key: string, start: number, stop: number) { return (await (await this.c()).zRange(key, start, stop)).map(String); }
  async zrem(key: string, ...members: string[]) { if (members.length) await (await this.c()).zRem(key, members); }
  async zcard(key: string) { return await (await this.c()).zCard(key); }
}
