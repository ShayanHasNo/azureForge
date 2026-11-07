// Local stand-in for api/showcase during `vite dev` / `vite preview`, backed
// by an in-memory store (loaded lazily by vite.config.ts).

import { MemoryStore } from './memoryStore';
import { handleShowcase, type ShowcaseRequest } from './showcaseCore';

const store = new MemoryStore();

export function handleLocal(req: ShowcaseRequest) {
  return handleShowcase(req, store);
}
