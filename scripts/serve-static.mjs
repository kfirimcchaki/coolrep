#!/usr/bin/env node
/**
 * Serves `site-dist` the way GitHub Pages does: static files when they exist,
 * `404.html` (which boots the SPA) for every other path.
 *
 *   node scripts/serve-static.mjs [port]
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.argv[2] ?? process.env.PORT ?? 4173);
const root = path.join(process.cwd(), process.env.STATIC_DIR || 'site-dist');
const base = (process.env.PAGES_BASE_PATH ?? '').replace(/\/$/, '');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

async function send(response, file, status = 200) {
  const body = await readFile(file);
  response.writeHead(status, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

createServer(async (request, response) => {
  let pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  if (base && pathname.startsWith(base)) pathname = pathname.slice(base.length) || '/';

  const candidates = [
    path.join(root, pathname),
    path.join(root, `${pathname}.html`),
    path.join(root, pathname, 'index.html'),
  ];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        await send(response, candidate === candidates[0] && pathname === '/' ? path.join(root, 'index.html') : candidate);
        return;
      }
    } catch {
      /* try the next candidate */
    }
  }

  // GitHub Pages behaviour: unknown paths → 404.html, which boots the SPA.
  await send(response, path.join(root, '404.html'), 404);
}).listen(port, '0.0.0.0', () => {
  console.log(`static build on http://0.0.0.0:${port}  (serving ${path.relative(process.cwd(), root)})`);
});
