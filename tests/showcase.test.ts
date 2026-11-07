import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../server/memoryStore';
import { handleShowcase, SHOWCASE_CONFIG } from '../server/showcaseCore';
import { simulateCraft } from '../src/crafting/simulate';
import { renderItem } from '../src/render/itemRenderer';
import { cleanText, sanitizeShowcaseItem, toShowcasePayload } from '../src/showcase/sanitize';
import type { Item } from '../src/item/types';
import { SAMPLES } from './render.test';

const damascusDagger = (seed = 321, primary = 'iron', secondary = 'silver') =>
  simulateCraft({ category: 'dagger', primary, secondary, skill: 0.9, seed, setup: (i) => { i.design.method = 'damascus'; i.decoration.engraving.pattern = 'vine'; } });

function client(store = new MemoryStore(), ip = '1.2.3.4') {
  return {
    store,
    post: (item: unknown, author = { player: 'Ash', workshop: 'The Quiet Forge' }, from = ip) =>
      handleShowcase({ method: 'POST', url: '/api/showcase', body: JSON.stringify({ item, author }), ip: from }, store),
    list: (sort = 'recent', offset = 0, limit = 12) => handleShowcase({ method: 'GET', url: `/api/showcase?sort=${sort}&offset=${offset}&limit=${limit}` }, store),
    del: (id: string, token: string) => handleShowcase({ method: 'DELETE', url: '/api/showcase', body: JSON.stringify({ id, token }) }, store),
  };
}

describe('showcase sanitizer', () => {
  it('round-trips every sample with identical sprites, minus private data', () => {
    for (const it of [...SAMPLES(), damascusDagger()]) {
      it.favorite = true;
      const r = sanitizeShowcaseItem(JSON.parse(JSON.stringify(toShowcasePayload(it))));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(renderItem(r.item, 'front').hash()).toBe(renderItem(it, 'front').hash());
      expect(renderItem(r.item, 'back').hash()).toBe(renderItem(it, 'back').hash());
      expect(r.item.history).toEqual([]);
      expect(r.item.favorite).toBeUndefined();
      expect(r.item.surface.damascus).toEqual(it.surface.damascus);
    }
  });

  it('cleans hostile text and clamps numbers', () => {
    expect(cleanText('  <b>hi</b>\u0000‮  there ', 48)).toBe('<b>hi</b> there');
    const it = toShowcasePayload(damascusDagger()) as any;
    it.name = 'x'.repeat(500);
    it.blade.length = 9999;
    it.blade.profile = 'not-a-profile';
    it.materials.grip = '__proto__';
    it.hilt.wrapColor = 'red;background:url(x)';
    const r = sanitizeShowcaseItem(it);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.item.name.length).toBe(48);
    expect(r.item.blade!.length).toBe(56);
    expect(r.item.blade!.profile).toBe('straight');
    expect(r.item.materials.grip).toBe('oak');
    expect(r.item.hilt!.wrapColor).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('rejects forged Damascus patterns and colours', () => {
    const base = toShowcasePayload(damascusDagger()) as any;
    const d = base.surface.damascus;
    const forged = (f: (x: any) => void) => { const x = JSON.parse(JSON.stringify(base)); f(x); return sanitizeShowcaseItem(x); };
    expect(forged((x) => { x.surface.damascus.index = (d.index % 1000) + 1; }).ok).toBe(false);
    expect(forged((x) => { x.surface.damascus.visibility = 0.985; }).ok).toBe(false);
    expect(forged((x) => { x.surface.damascus.color = d.color ? undefined : 'frostvein'; }).ok).toBe(false);
    expect(forged((x) => { x.surface.damascus.color = 'rainbow'; }).ok).toBe(false);
    expect(forged((x) => { x.category = 'sword'; }).ok).toBe(false);
    expect(forged((x) => { x.seed = 'abc'; }).ok).toBe(false);
  });
});

describe('showcase server', () => {
  it('posts, lists recent and rarest, and withdraws with the right token', async () => {
    const c = client();
    const a = damascusDagger(11), b = damascusDagger(12), plain = simulateCraft({ category: 'sword', primary: 'iron', skill: 0.8, seed: 5 });
    const ra = await c.post(toShowcasePayload(a));
    expect(ra.status).toBe(201);
    const { id, token } = ra.body as any;
    expect((await c.post(toShowcasePayload(b))).status).toBe(201);
    expect((await c.post(toShowcasePayload(plain))).status).toBe(201);
    const recent = (await c.list('recent')).body as any;
    expect(recent.total).toBe(3);
    expect(recent.posts[0].author).toEqual({ player: 'Ash', workshop: 'The Quiet Forge' });
    expect(recent.posts[0].tokenHash).toBeUndefined();
    const rarest = (await c.list('rarest')).body as any;
    expect(rarest.posts[rarest.posts.length - 1].item.surface.damascus).toBeUndefined();
    // duplicate
    expect((await c.post(toShowcasePayload(a))).status).toBe(409);
    // wrong token
    expect((await c.del(id, 'nope')).status).toBe(403);
    expect((await c.del(id, token)).status).toBe(200);
    expect(((await c.list()).body as any).total).toBe(2);
    // can post again after withdrawing
    expect((await c.post(toShowcasePayload(a), undefined, '9.9.9.9')).status).toBe(201);
  });

  it('rejects bad, oversized and forged posts', async () => {
    const c = client();
    expect((await handleShowcase({ method: 'POST', url: '/api/showcase', body: 'not json' }, c.store)).status).toBe(400);
    expect((await handleShowcase({ method: 'POST', url: '/api/showcase', body: 'x'.repeat(30000) }, c.store)).status).toBe(413);
    expect((await c.post({ category: 'spoon' })).status).toBe(422);
    const forged = toShowcasePayload(damascusDagger()) as any;
    forged.surface.damascus.index = (forged.surface.damascus.index % 1000) + 1;
    expect((await c.post(forged)).status).toBe(422);
    expect((await handleShowcase({ method: 'PUT', url: '/api/showcase' }, c.store)).status).toBe(405);
  });

  it('rate-limits posts per address', async () => {
    const c = client();
    for (let k = 0; k < SHOWCASE_CONFIG.ratePerHour; k++) expect((await c.post(toShowcasePayload(damascusDagger(100 + k)))).status).toBe(201);
    expect((await c.post(toShowcasePayload(damascusDagger(200)))).status).toBe(429);
    expect((await c.post(toShowcasePayload(damascusDagger(201)), undefined, '5.6.7.8')).status).toBe(201);
  });

  it('keeps only the newest posts', async () => {
    const store = new MemoryStore();
    const keep = SHOWCASE_CONFIG.maxPosts;
    SHOWCASE_CONFIG.maxPosts = 3;
    try {
      const c = client(store);
      const ids: string[] = [];
      for (let k = 0; k < 5; k++) {
        const it: Item = simulateCraft({ category: 'sword', primary: 'iron', skill: 0.7, seed: 900 + k });
        const r = await handleShowcase({ method: 'POST', url: '/api/showcase', body: JSON.stringify({ item: toShowcasePayload(it), author: {} }), ip: `10.0.0.${k}` }, store, 1000 + k);
        ids.push((r.body as any).id);
      }
      const l = (await c.list()).body as any;
      expect(l.total).toBe(3);
      expect(l.posts.map((p: any) => p.id)).toEqual(ids.slice(2).reverse());
      expect(await store.get(`sc:post:${ids[0]}`)).toBeNull();
    } finally {
      SHOWCASE_CONFIG.maxPosts = keep;
    }
  });
});

describe('vercel function', () => {
  it('uses explicit .js extensions throughout its import graph (Vercel runs it as plain Node ESM)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '..');
    const seen = new Set<string>();
    const bad: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const spec = m[1];
        if (!spec.endsWith('.js')) { bad.push(`${path.relative(root, file)} → ${spec}`); continue; }
        walk(path.resolve(path.dirname(file), spec.replace(/\.js$/, '.ts')));
      }
    };
    walk(path.join(root, 'api/showcase.ts'));
    expect(bad).toEqual([]);
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('store selection', () => {
  it('picks Upstash REST or a Redis connection string from the environment', async () => {
    const { redisConfig } = await import('../server/redisStore');
    expect(redisConfig({})).toBeNull();
    expect(redisConfig({ REDIS_URL: 'redis://default:pw@host:6379' })).toEqual({ kind: 'tcp', url: 'redis://default:pw@host:6379' });
    expect(redisConfig({ REDIS_URL: 'rediss://host:6380' })?.kind).toBe('tcp');
    expect(redisConfig({ REDIS_URL: 'https://not-redis' })).toBeNull();
    expect(redisConfig({ KV_REST_API_URL: 'https://x.upstash.io', KV_REST_API_TOKEN: 't', REDIS_URL: 'redis://h' })?.kind).toBe('rest');
    expect(redisConfig({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' })?.kind).toBe('rest');
  });
});

// Runs against a real server when REDIS_TEST_URL is set (e.g. redis://localhost:6379/15 — the database is flushed).
describe.skipIf(!process.env.REDIS_TEST_URL)('showcase on a real Redis (REDIS_URL)', () => {
  it('posts, lists, rejects forgeries and withdraws', async () => {
    const { createClient } = await import('redis');
    const { TcpRedisStore } = await import('../server/tcpRedisStore');
    const admin = createClient({ url: process.env.REDIS_TEST_URL });
    await admin.connect();
    await admin.flushDb();
    const store = new TcpRedisStore(process.env.REDIS_TEST_URL!);
    const c = client(store as any);
    const a = damascusDagger(41), b = damascusDagger(42);
    const ra = await c.post(toShowcasePayload(a));
    expect(ra.status).toBe(201);
    expect((await c.post(toShowcasePayload(b))).status).toBe(201);
    expect((await c.post(toShowcasePayload(a))).status).toBe(409);
    const forged = toShowcasePayload(damascusDagger(43)) as any;
    forged.surface.damascus.index = (forged.surface.damascus.index % 1000) + 1;
    expect((await c.post(forged)).status).toBe(422);
    const recent = (await c.list('recent')).body as any;
    expect(recent.total).toBe(2);
    expect(recent.posts.map((p: any) => p.item.seed)).toEqual([42, 41]);
    expect(((await c.list('rarest')).body as any).total).toBe(2);
    const { id, token } = ra.body as any;
    expect(await admin.ttl(`sc:post:${id}`)).toBeGreaterThan(80 * 24 * 3600);
    expect((await c.del(id, 'wrong')).status).toBe(403);
    expect((await c.del(id, token)).status).toBe(200);
    expect(((await c.list()).body as any).total).toBe(1);
    await admin.flushDb();
    await admin.quit();
  });
});
