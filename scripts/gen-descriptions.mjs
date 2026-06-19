#!/usr/bin/env node
/**
 * gen-descriptions.mjs
 * Finds GEN.PLZ files and generates descriptions.json in same directory,
 * then deletes GEN.PLZ
 */

import { readdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join, relative, dirname } from 'node:path';

const ROOT = process.cwd();
const IMAGES_DIR = join(ROOT, 'images');
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.JPG', '.JPEG']);

async function walk(dir, callback) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, callback);
    } else {
      await callback(full, e.name);
    }
  }
}

async function main() {
  let found = 0;
  
  await walk(IMAGES_DIR, async (fullPath, name) => {
    if (name === 'GEN.PLZ') {
      const dir = dirname(fullPath);
      found++;
      
      // Find all JPEG files in this directory
      const entries = await readdir(dir, { withFileTypes: true });
      const images = entries
        .filter(e => e.isFile() && IMAGE_EXTS.has(join('', e.name).slice(e.name.lastIndexOf('.'))))
        .map(e => e.name)
        .sort();
      
      // Create descriptions.json
      const descriptions = {};
      for (const img of images) {
        descriptions[img] = '';
      }
      
      const descPath = join(dir, 'descriptions.json');
      await writeFile(descPath, JSON.stringify(descriptions, null, 2), 'utf8');
      console.log(`Generated descriptions.json in ${relative(ROOT, dir)}`);
      
      // Delete GEN.PLZ
      await unlink(fullPath);
      console.log(`Deleted GEN.PLZ from ${relative(ROOT, dir)}`);
    }
  });
  
  if (found === 0) {
    console.log('No GEN.PLZ files found');
  } else {
    console.log(`Processed ${found} GEN.PLZ file(s)`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
