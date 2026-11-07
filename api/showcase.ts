// Vercel function: the online market showcase.
//   GET    /api/showcase?sort=recent|rarest&offset=0&limit=12
//   POST   /api/showcase   { item, author: { player, workshop } }  → { id, token }
//   DELETE /api/showcase   { id, token }

import { handleShowcase } from '../server/showcaseCore.js';
import { RedisStore, redisConfig } from '../server/redisStore.js';
import { TcpRedisStore } from '../server/tcpRedisStore.js';
import type { ShowcaseStore } from '../server/showcaseCore.js';

let store: ShowcaseStore | null = null;

async function handle(request: Request): Promise<Response> {
  const cfg = redisConfig(process.env);
  if (!cfg) return json(503, { error: 'The market showcase is not set up yet (no Redis store is connected to this deployment).' });
  store ??= cfg.kind === 'rest' ? new RedisStore(cfg) : new TcpRedisStore(cfg.url);
  const body = request.method === 'GET' ? undefined : await request.text();
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown';
  const res = await handleShowcase({ method: request.method, url: request.url, body, ip }, store);
  return json(res.status, res.body);
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
