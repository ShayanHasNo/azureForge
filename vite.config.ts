import { defineConfig, runnerImport, type Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Serves /api/showcase from an in-memory store during `vite dev` and
 * `vite preview`, so the market showcase works locally without Redis.
 * On Vercel the real function in api/showcase.ts takes over.
 */
function localShowcase(): Plugin {
  // Loaded through Vite's module runner on first use, so the server code can
  // share the game's own TypeScript modules.
  let local: Promise<typeof import('./server/devShowcase')> | null = null;
  const load = () => (local ??= runnerImport<typeof import('./server/devShowcase')>('./server/devShowcase.ts', { configFile: false, logLevel: 'error' }).then((r) => r.module));
  const mw = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/showcase')) return next();
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 64_000) break;
    }
    const { handleLocal } = await load();
    const out = await handleLocal({ method: req.method ?? 'GET', url: req.url, body: body || undefined, ip: req.socket.remoteAddress ?? 'local' });
    res.statusCode = out.status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(out.body));
  };
  return {
    name: 'local-showcase',
    configureServer(server) { server.middlewares.use(mw); },
    configurePreviewServer(server) { server.middlewares.use(mw); },
  };
}

export default defineConfig({
  base: './',
  plugins: [localShowcase()],
  build: { target: 'es2022', outDir: 'dist', assetsInlineLimit: 0 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
