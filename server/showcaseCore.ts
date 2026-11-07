// The online market showcase: players post finished pieces, everyone can
// browse the most recent and the rarest. Framework-free — the Vercel function
// (api/showcase.ts) and the Vite dev/preview middleware both call
// handleShowcase() with their own store.

import { damascusPrestige } from '../src/item/damascus.js';
import type { Item } from '../src/item/types.js';
import { sanitizeAuthor, sanitizeShowcaseItem, SHOWCASE_LIMITS, type ShowcaseAuthor } from '../src/showcase/sanitize.js';

/** The small set of key/value + sorted-set primitives the showcase needs (Redis-shaped). */
export interface ShowcaseStore {
  get(key: string): Promise<string | null>;
  mget(keys: string[]): Promise<(string | null)[]>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  /** Increment a counter, starting its TTL on first increment. */
  incr(key: string, ttlSec: number): Promise<number>;
  zadd(key: string, score: number, member: string): Promise<void>;
  /** Members by descending score. */
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  /** Members by ascending score. */
  zrange(key: string, start: number, stop: number): Promise<string[]>;
  zrem(key: string, ...members: string[]): Promise<void>;
  zcard(key: string): Promise<number>;
}

export interface StoredPost {
  id: string;
  at: number;
  author: ShowcaseAuthor;
  item: Item;
  prestige: number;
  tokenHash: string;
}

export interface PublicPost { id: string; at: number; author: ShowcaseAuthor; item: Item }

export interface ShowcaseRequest {
  method: string;
  url: string;
  body?: string;
  ip?: string;
}

export interface ShowcaseResponse { status: number; body: unknown }

export const SHOWCASE_CONFIG = {
  maxPosts: 1000,
  postTtlSec: 90 * 24 * 3600,
  ratePerHour: 5,
  pageMax: 24,
};

const K = {
  post: (id: string) => `sc:post:${id}`,
  dupe: (h: string) => `sc:dupe:${h}`,
  rate: (h: string) => `sc:rl:${h}`,
  recent: 'sc:recent',
  rarest: 'sc:rarest',
};

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const err = (status: number, error: string): ShowcaseResponse => ({ status, body: { error } });

function rarestScore(p: { item: Item; at: number }) {
  // prestige first, newer breaks ties
  return Math.round(damascusPrestige(p.item.surface.damascus) * 100) * 1e4 + Math.floor(p.at / 1e9) % 1e4;
}

export async function handleShowcase(req: ShowcaseRequest, store: ShowcaseStore, now = Date.now()): Promise<ShowcaseResponse> {
  try {
    if (req.method === 'GET') return await list(req, store);
    if (req.method === 'POST') return await post(req, store, now);
    if (req.method === 'DELETE') return await withdraw(req, store);
    return err(405, 'Method not allowed.');
  } catch (e) {
    return err(500, 'The showcase is having a quiet moment. Try again soon.');
  }
}

function parseBody(body?: string): Record<string, any> | null {
  if (!body || body.length > SHOWCASE_LIMITS.bodyBytes) return null;
  try {
    const v = JSON.parse(body);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

async function list(req: ShowcaseRequest, store: ShowcaseStore): Promise<ShowcaseResponse> {
  const u = new URL(req.url, 'http://local');
  const sort = u.searchParams.get('sort') === 'rarest' ? 'rarest' : 'recent';
  const offset = Math.max(0, Math.min(5000, Number(u.searchParams.get('offset')) || 0));
  const limit = Math.max(1, Math.min(SHOWCASE_CONFIG.pageMax, Number(u.searchParams.get('limit')) || 12));
  const key = sort === 'rarest' ? K.rarest : K.recent;
  const ids = await store.zrevrange(key, offset, offset + limit - 1);
  const raws = ids.length ? await store.mget(ids.map(K.post)) : [];
  const posts: PublicPost[] = [];
  const stale: string[] = [];
  raws.forEach((r, i) => {
    if (!r) { stale.push(ids[i]); return; }
    try {
      const p = JSON.parse(r) as StoredPost;
      posts.push({ id: p.id, at: p.at, author: p.author, item: p.item });
    } catch {
      stale.push(ids[i]);
    }
  });
  if (stale.length) { await store.zrem(K.recent, ...stale); await store.zrem(K.rarest, ...stale); }
  const total = await store.zcard(key);
  return { status: 200, body: { sort, offset, posts, total } };
}

async function post(req: ShowcaseRequest, store: ShowcaseStore, now: number): Promise<ShowcaseResponse> {
  if (req.body && req.body.length > SHOWCASE_LIMITS.bodyBytes) return err(413, 'That piece is too large to post.');
  const body = parseBody(req.body);
  if (!body) return err(400, 'Could not read that post.');
  const clean = sanitizeShowcaseItem(body.item);
  if (!clean.ok) return err(422, clean.error);
  const author = sanitizeAuthor(body.author);
  const ipHash = await sha256(`ip:${req.ip ?? 'unknown'}`);
  const n = await store.incr(K.rate(ipHash), 3600);
  if (n > SHOWCASE_CONFIG.ratePerHour) return err(429, 'You have shown a lot of pieces this hour — give the market a little while.');
  const dupeKey = K.dupe(await sha256(`${clean.item.id}:${clean.item.seed}`));
  const existing = await store.get(dupeKey);
  if (existing && (await store.get(K.post(existing)))) return err(409, 'This piece is already on show.');
  const id = randomHex(6);
  const token = randomHex(16);
  const stored: StoredPost = { id, at: now, author, item: clean.item, prestige: damascusPrestige(clean.item.surface.damascus), tokenHash: await sha256(token) };
  await store.set(K.post(id), JSON.stringify(stored), SHOWCASE_CONFIG.postTtlSec);
  await store.set(dupeKey, id, SHOWCASE_CONFIG.postTtlSec);
  await store.zadd(K.recent, now, id);
  await store.zadd(K.rarest, rarestScore(stored), id);
  await trim(store);
  return { status: 201, body: { id, token, at: now } };
}

async function trim(store: ShowcaseStore) {
  const n = await store.zcard(K.recent);
  const excess = n - SHOWCASE_CONFIG.maxPosts;
  if (excess <= 0) return;
  const old = await store.zrange(K.recent, 0, excess - 1);
  if (!old.length) return;
  await store.zrem(K.recent, ...old);
  await store.zrem(K.rarest, ...old);
  await store.del(...old.map(K.post));
}

async function withdraw(req: ShowcaseRequest, store: ShowcaseStore): Promise<ShowcaseResponse> {
  const body = parseBody(req.body);
  const id = typeof body?.id === 'string' ? body.id.slice(0, 40) : '';
  const token = typeof body?.token === 'string' ? body.token.slice(0, 80) : '';
  if (!id || !token) return err(400, 'Missing post id or token.');
  const raw = await store.get(K.post(id));
  if (!raw) {
    await store.zrem(K.recent, id);
    await store.zrem(K.rarest, id);
    return { status: 200, body: { ok: true, gone: true } };
  }
  const p = JSON.parse(raw) as StoredPost;
  if (p.tokenHash !== (await sha256(token))) return err(403, 'Only the maker can withdraw this piece.');
  await store.del(K.post(id), K.dupe(await sha256(`${p.item.id}:${p.item.seed}`)));
  await store.zrem(K.recent, id);
  await store.zrem(K.rarest, id);
  return { status: 200, body: { ok: true } };
}
