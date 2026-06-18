#!/usr/bin/env node
/**
 * patch-lightbox.mjs
 * Run once from your photo-gallery folder, then delete.
 *   node patch-lightbox.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const patches = [
  {
    file: join(ROOT, 'assets/css/main.css'),
    description: 'Make lightbox image fill the viewport and shrink the info panel',
    replacements: [
      // Image height — was leaving 220px for the info panel, now only 130px
      {
        from: 'max-height: calc(100vh - 220px);',
        to:   'max-height: calc(100vh - 130px);',
      },
      // Info panel max-height — give more room to the image
      {
        from: 'max-height: 38vh;',
        to:   'max-height: 22vh;',
      },
      // Lightbox stage padding — tighter so image sits closer to edges
      {
        from: `  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 24px;
  min-height: 0;`,
        to: `  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 8px 8px 4px;
  min-height: 0;`,
      },
      // Zoom scale — was 2.2, now 4x for a genuinely radical zoom
      {
        from: '  transform: scale(2.2);',
        to:   '  transform: scale(4);',
      },
    ],
  },
  {
    file: join(ROOT, 'assets/js/main.js'),
    description: 'No JS changes needed — pan logic already tracks mouse position correctly at any scale',
    replacements: [],
  },
];

let anyFailed = false;

for (const { file, description, replacements } of patches) {
  if (!replacements.length) continue;

  let src;
  try {
    src = await readFile(file, 'utf8');
  } catch (err) {
    console.error(`✗ Could not read ${file}: ${err.message}`);
    anyFailed = true;
    continue;
  }

  let patched = src;
  let allOk = true;

  for (const { from, to } of replacements) {
    if (!patched.includes(from)) {
      console.error(`✗ Could not find patch target in ${file}:\n  "${from.slice(0, 60)}..."`);
      allOk = false;
      anyFailed = true;
      continue;
    }
    patched = patched.replace(from, to);
  }

  if (allOk) {
    await writeFile(file, patched, 'utf8');
    console.log(`✓ ${file.split('/').slice(-2).join('/')}  — ${description}`);
  }
}

if (anyFailed) {
  console.log('\nSome patches failed — the file may have already been patched or was edited.');
} else {
  console.log('\nDone. Run "npm run build && npm start" to see the changes.');
  console.log('You can delete patch-lightbox.mjs now.');
}
