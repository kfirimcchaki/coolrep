#!/usr/bin/env node
/**
 * Publishes the static build to the repository root, which is where GitHub
 * Pages is configured to serve this branch from:
 *
 *   https://<user>.github.io/<repository>/
 *
 * Only the generated files are touched (index.html, 404.html, assets/, …);
 * sources, docs and tooling are left alone. The published root carries
 * `.nojekyll`, so Pages serves the files verbatim instead of running Jekyll.
 *
 *   node scripts/publish-pages.mjs
 */
import { cp, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'site-dist');

// Everything this script owns at the repository root.
const GENERATED = [
  'index.html',
  '404.html',
  'assets',
  'favicon.svg',
  'robots.txt',
  'manifest.webmanifest',
  'icons',
  'sw.js',
  '.nojekyll',
  'CNAME',
  // real documents for the static screens (so they answer 200, not 404).
  // /scripts stays a tooling folder, so it keeps using the 404.html fallback.
  'login',
  'register',
  'connect',
  'settings',
];

try {
  const info = await stat(source);
  if (!info.isDirectory()) throw new Error('not a directory');
} catch {
  console.error('site-dist/ is missing — run `npm run build:static` first');
  process.exit(1);
}

for (const entry of GENERATED) {
  await rm(path.join(root, entry), { recursive: true, force: true });
}

await cp(source, root, {
  recursive: true,
  force: true,
  filter: (file) => {
    const relative = path.relative(source, file);
    if (relative === '') return true;
    // /scripts is a source folder in this repository — its route shells stay out.
    return !relative.split(path.sep)[0].match(/^scripts$/);
  },
});

// Route shells live in site-dist/<route>/index.html; only root-level files and
// assets are copied above, so `/scripts` and friends fall through to 404.html,
// which boots the SPA and keeps the URL.
const staged = await readdir(root);
console.log(`published Pages artifact at the repository root (${staged.includes('index.html') ? 'index.html ✓' : 'missing'})`);
console.log('https://<user>.github.io/<repository>/ is served from here');
