// Talks to the online market showcase (api/showcase). Everything degrades
// gracefully: offline, or on a deployment without a store, the game simply
// says the showcase is quiet.

import type { Item } from '../item/types';
import { sanitizeShowcaseItem, toShowcasePayload, type ShowcaseAuthor } from './sanitize';

const ENDPOINT = 'api/showcase';
const TIMEOUT_MS = 9000;

export interface ShowcasePost { id: string; at: number; author: ShowcaseAuthor; item: Item }
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

async function call<T>(method: 'GET' | 'POST' | 'DELETE', query = '', body?: unknown): Promise<Result<T>> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => ctrl?.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT + query, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl?.signal,
    });
    let data: any = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) return { ok: false, status: res.status, error: (data && typeof data.error === 'string' && data.error.slice(0, 200)) || `The showcase could not be reached (${res.status}).` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: 'The showcase could not be reached — are you offline?' };
  } finally {
    clearTimeout(timer);
  }
}

export async function listShowcase(sort: 'recent' | 'rarest', offset = 0, limit = 12): Promise<Result<{ posts: ShowcasePost[]; total: number }>> {
  const r = await call<{ posts: unknown[]; total: number }>('GET', `?sort=${sort}&offset=${offset}&limit=${limit}`);
  if (!r.ok) return r;
  const posts: ShowcasePost[] = [];
  for (const p of Array.isArray(r.data?.posts) ? r.data.posts : []) {
    if (!p || typeof p !== 'object') continue;
    const raw = p as Record<string, any>;
    const clean = sanitizeShowcaseItem(raw.item);
    if (!clean.ok) continue;
    const a = raw.author ?? {};
    posts.push({
      id: String(raw.id ?? '').slice(0, 40),
      at: Number(raw.at) || 0,
      author: { player: String(a.player ?? 'A smith').slice(0, 20), workshop: String(a.workshop ?? '').slice(0, 28) },
      item: clean.item,
    });
  }
  return { ok: true, data: { posts, total: Number(r.data?.total) || posts.length } };
}

export async function postToShowcase(item: Item, author: ShowcaseAuthor): Promise<Result<{ id: string; token: string; at: number }>> {
  return call('POST', '', { item: toShowcasePayload(item), author });
}

export async function withdrawFromShowcase(item: Item): Promise<Result<{ ok: true }>> {
  if (!item.showcase) return { ok: true, data: { ok: true } };
  return call('DELETE', '', { id: item.showcase.id, token: item.showcase.token });
}
