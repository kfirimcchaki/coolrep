#!/usr/bin/env node
/**
 * Publishes the static build into ./docs so GitHub Pages can serve it straight
 * from a branch (`Settings → Pages → Deploy from a branch → main → /docs`),
 * which needs no Actions permissions at all.
 *
 * Markdown files inside docs/ are documentation and are left untouched.
 *
 *   node scripts/publish-docs.mjs
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'site-dist');
const target = path.join(root, 'docs');

try {
  const info = await stat(source);
  if (!info.isDirectory()) throw new Error('not a directory');
} catch {
  console.error('site-dist/ is missing — run `npm run build:static` first');
  process.exit(1);
}

await mkdir(target, { recursive: true });

// Remove only previously published site files; keep the documentation.
const existing = await readdir(target);
const generated = new Set(['index.html', '404.html', 'assets', 'favicon.svg', 'robots.txt', '.nojekyll', 'CNAME', 'login', 'register', 'connect', 'settings', 'scripts']);
for (const entry of existing) {
  if (generated.has(entry)) await rm(path.join(target, entry), { recursive: true, force: true });
}

await cp(source, target, {
  recursive: true,
  force: true,
  filter: (file) => !file.endsWith('.md'),
});

console.log(`published static build → ${path.relative(root, target)}/`);
console.log('GitHub Pages: Settings → Pages → Deploy from a branch → main → /docs');
