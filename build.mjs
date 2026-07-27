#!/usr/bin/env node
// build.mjs — builds the app for GitHub Pages.
//
// Usage:
//   node build.mjs                  → base "/", output to ./docs
//   BASE_PATH=/my-repo/ node build.mjs
//   OUT_DIR=dist node build.mjs
//
// In GitHub Actions, if BASE_PATH isn't set, this derives the base path
// from GITHUB_REPOSITORY automatically:
//   owner/my-repo          -> base "/my-repo/"
//   owner/owner.github.io  -> base "/"   (user/org root pages site)

import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveBase() {
  if (process.env.BASE_PATH) return process.env.BASE_PATH;

  const repo = process.env.GITHUB_REPOSITORY; // "owner/repo"
  if (repo) {
    const name = repo.split('/')[1] || '';
    if (name.endsWith('.github.io')) return '/';
    return `/${name}/`;
  }

  return '/';
}

const base = resolveBase();
// "docs" is a common choice since GitHub Pages can serve straight from
// a /docs folder on the main branch with no extra branch/workflow setup.
// Override with OUT_DIR=dist if you deploy differently (e.g. a
// gh-pages branch via an action that pushes ./dist).
const outDir = process.env.OUT_DIR || 'docs';

console.log('Building for GitHub Pages…');
console.log(`  base:   ${base}`);
console.log(`  outDir: ${outDir}`);

await build({
  root: __dirname,
  base,
  build: {
    outDir,
    emptyOutDir: true,
  },
});

// GitHub Pages (Jekyll processing) ignores files/folders starting with
// an underscore unless this marker file is present. Vite's default
// output doesn't use underscore-prefixed folders, but this is cheap
// insurance and standard practice for Vite + GitHub Pages.
fs.writeFileSync(path.join(__dirname, outDir, '.nojekyll'), '');

console.log(`\nDone. Static site is in ./${outDir}`);
