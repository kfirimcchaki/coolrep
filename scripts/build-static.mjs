#!/usr/bin/env node
/**
 * Builds the GitHub Pages bundle: a fully client-side version of the platform
 * that ships the same 21 endpoints as an in-browser backend.
 *
 *   node scripts/build-static.mjs                 → ./site-dist
 *   STATIC_OUT_DIR=docs node scripts/build-static.mjs
 *
 * The artifact is deployment-root independent: it resolves its own base path at
 * runtime, so it works on project pages (/<repo>/), user pages and custom
 * domains without rebuilding.
 */
import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const outDir = path.resolve(root, process.env.STATIC_OUT_DIR || 'site-dist');
const repository =
  process.env.GITHUB_REPOSITORY?.split('/')[1] || path.basename(root) || 'coolrep';

if (process.env.NT_API) console.log(`  default API baked in: ${process.env.NT_API}`);

console.log(`building static site → ${path.relative(root, outDir) || '.'} (repository: ${repository})`);

await rm(outDir, { recursive: true, force: true });
await mkdir(path.join(outDir, 'assets'), { recursive: true });

const result = await build({
  entryPoints: [path.join(root, 'spa/main.tsx')],
  bundle: true,
  write: false,
  outdir: path.join(outDir, 'assets'),
  entryNames: 'app',
  assetNames: 'app',
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'none',
  jsx: 'automatic',
  define: {
    'process.env.NEXT_PUBLIC_STATIC_MODE': '"1"',
    'process.env.NODE_ENV': '"production"',
    // Optional default backend baked into the bundle: NT_API=https://host npm run build:static
    'process.env.NT_API': JSON.stringify(process.env.NT_API || ''),
  },
  loader: { '.css': 'css', '.svg': 'dataurl' },
  logLevel: 'warning',
});

for (const file of result.outputFiles) {
  await writeFile(file.path, file.contents, 'utf8');
  console.log(`  ${path.relative(outDir, file.path).padEnd(20)} ${(file.contents.byteLength / 1024).toFixed(1)} KiB`);
}

for (const page of ['index.html', '404.html']) {
  const template = await readFile(path.join(root, 'spa', page), 'utf8');
  await writeFile(path.join(outDir, page), template.replaceAll('__REPO__', repository), 'utf8');
}

// Static routes get a real document so they answer 200 on GitHub Pages;
// dynamic routes keep their pretty URL through 404.html (the SPA boots there).
const shell = await readFile(path.join(outDir, 'index.html'), 'utf8');
for (const route of ['login', 'register', 'connect', 'settings', 'scripts', 'scripts/new']) {
  const dir = path.join(outDir, route);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'index.html'), shell, 'utf8');
}

await cp(path.join(root, 'app/icon.svg'), path.join(outDir, 'favicon.svg'));

// Progressive web app: offline shell + installable manifest.
const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const sw = await readFile(path.join(root, 'spa/sw.js'), 'utf8');
await writeFile(path.join(outDir, 'sw.js'), sw.replaceAll('__VERSION__', stamp), 'utf8');
await cp(path.join(root, 'spa/manifest.webmanifest'), path.join(outDir, 'manifest.webmanifest'));
await cp(path.join(root, 'spa/icons'), path.join(outDir, 'icons'), { recursive: true });
await writeFile(path.join(outDir, '.nojekyll'), '', 'utf8');
await writeFile(path.join(outDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n', 'utf8');

// Custom domain: GitHub stores it in a CNAME file — carry it into the artifact.
try {
  await cp(path.join(root, 'CNAME'), path.join(outDir, 'CNAME'));
  console.log('  CNAME copied (custom domain)');
} catch {
  /* no custom domain configured */
}

const total = (await stat(path.join(outDir, 'assets/app.js'))).size;
if (total > 8 * 1024 * 1024) console.warn('warning: bundle is larger than 8 MiB');

console.log('\nstatic build ready — preview it with: node scripts/serve-static.mjs 4173');
