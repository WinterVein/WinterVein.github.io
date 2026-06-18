#!/usr/bin/env node
/**
 * compress-images.mjs
 * ---------------------------------------------------------------------------
 * Run this ONCE before uploading photos, not on every build.
 *
 * What it does:
 *   1. Walks images/fulls/ recursively (any depth of subfolders)
 *   2. For each JPEG, compresses it IN PLACE to <= 999 KB WITHOUT
 *      shrinking the resolution. Quality is estimated smartly then
 *      refined in at most one extra pass. EXIF is fully preserved.
 *   3. Mirrors the exact folder structure into images/thumbs/ and
 *      generates 500x500 square-cropped thumbnails (EXIF preserved).
 *   4. Skips files already under the target size (unless --force).
 *   5. Never touches _data/gallery.json — that's scan-images.mjs's job.
 *
 * Usage:
 *   node scripts/compress-images.mjs
 *   node scripts/compress-images.mjs --force        re-process everything
 *   node scripts/compress-images.mjs --max-kb=750   custom size target
 *   node scripts/compress-images.mjs --thumbs-only  only regenerate thumbs
 * ---------------------------------------------------------------------------
 */

import { readdir, stat, unlink, rename, writeFile, mkdir, access } from 'node:fs/promises';
import { join, extname, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, '..');
const FULLS_DIR  = join(ROOT, 'images', 'fulls');
const THUMBS_DIR = join(ROOT, 'images', 'thumbs');

// CLI flags
const args        = process.argv.slice(2);
const FORCE       = args.includes('--force');
const THUMBS_ONLY = args.includes('--thumbs-only');
const maxKbArg    = args.find(a => a.startsWith('--max-kb='));
const MAX_BYTES   = (maxKbArg ? Number(maxKbArg.split('=')[1]) : 999) * 1024;
const CONCURRENCY = Math.min(4, cpus().length);

const THUMB_SIZE    = 500;   // square edge px
const THUMB_QUALITY = 82;
const IMAGE_EXTS    = new Set(['.jpg', '.jpeg', '.JPG', '.JPEG']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kb(bytes) { return (bytes / 1024).toFixed(1) + ' KB'; }

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function ensureDir(d) { await mkdir(d, { recursive: true }); }

/** Recursively collect all jpeg paths under a directory. Returns relative paths. */
async function collectImages(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const results = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...await collectImages(full, base));
    } else if (IMAGE_EXTS.has(extname(e.name))) {
      results.push(relative(base, full));
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Compression — no resolution change, EXIF fully preserved
// ---------------------------------------------------------------------------

/**
 * Estimate a starting quality based on pixel count and how much we need
 * to compress. Mirrors the heuristic from the reference script.
 */
function estimateQuality(pixels, compressionRatio) {
  let q;
  if      (pixels > 25_000_000) q = 55;
  else if (pixels > 15_000_000) q = 65;
  else if (pixels > 8_000_000)  q = 75;
  else if (pixels > 4_000_000)  q = 82;
  else                           q = 88;

  if      (compressionRatio < 0.3) q = Math.max(30, q - 20);
  else if (compressionRatio < 0.5) q = Math.max(30, q - 12);
  else if (compressionRatio < 0.7) q = Math.max(30, q - 5);

  return q;
}

async function compressFull(srcPath) {
  const inputStat = await stat(srcPath);
  const inputSize = inputStat.size;

  if (!FORCE && inputSize <= MAX_BYTES) {
    return { skipped: true, inputSize, outputSize: inputSize };
  }

  const meta   = await sharp(srcPath).metadata();
  const pixels = meta.width * meta.height;
  const ratio  = MAX_BYTES / inputSize;

  let quality = estimateQuality(pixels, ratio);

  // First attempt
  let buffer = await sharp(srcPath)
    .keepMetadata()
    .jpeg({ quality, mozjpeg: true, progressive: true })
    .toBuffer();

  // One refinement pass — tighten if still over, loosen if well under
  if (buffer.length > MAX_BYTES && quality > 30) {
    quality = Math.max(30, quality - 15);
    buffer = await sharp(srcPath)
      .keepMetadata()
      .jpeg({ quality, mozjpeg: true, progressive: true })
      .toBuffer();
  } else if (buffer.length < MAX_BYTES * 0.7 && quality < 92) {
    const higherQ  = Math.min(92, quality + 10);
    const testBuf  = await sharp(srcPath)
      .keepMetadata()
      .jpeg({ quality: higherQ, mozjpeg: true, progressive: true })
      .toBuffer();
    if (testBuf.length <= MAX_BYTES) {
      buffer  = testBuf;
      quality = higherQ;
    }
  }

  // Write atomically via temp file
  const tmpPath = join(dirname(srcPath), `.tmp_${basename(srcPath)}`);
  await writeFile(tmpPath, buffer);
  await unlink(srcPath);
  await rename(tmpPath, srcPath);

  return { skipped: false, inputSize, outputSize: buffer.length, quality };
}

// ---------------------------------------------------------------------------
// Thumbnails — square crop, EXIF preserved
// ---------------------------------------------------------------------------

async function generateThumbnail(srcPath, thumbPath) {
  await ensureDir(dirname(thumbPath));
  await sharp(srcPath)
    .rotate()                          // honour orientation tag, then strip it
    .resize({
      width:  THUMB_SIZE,
      height: THUMB_SIZE,
      fit:    'cover',
      position: 'centre',
    })
    .keepMetadata()
    .jpeg({ quality: THUMB_QUALITY, mozjpeg: true, progressive: true })
    .toFile(thumbPath);
}

// ---------------------------------------------------------------------------
// Per-file worker
// ---------------------------------------------------------------------------

async function processFile(relPath) {
  const srcPath   = join(FULLS_DIR, relPath);
  const thumbPath = join(THUMBS_DIR, relPath);

  let compressResult = { skipped: true };

  if (!THUMBS_ONLY) {
    try {
      compressResult = await compressFull(srcPath);
    } catch (err) {
      console.error(`  ❌ compress failed: ${relPath} — ${err.message}`);
      return null;
    }
  }

  const thumbExists = await exists(thumbPath);
  if (FORCE || !thumbExists) {
    try {
      await generateThumbnail(srcPath, thumbPath);
    } catch (err) {
      console.error(`  ❌ thumbnail failed: ${relPath} — ${err.message}`);
    }
  }

  const { skipped, inputSize, outputSize, quality } = compressResult;
  if (skipped) {
    console.log(`  = ${relPath}  already ≤ target (${kb(inputSize)})`);
  } else {
    const saved   = inputSize - outputSize;
    const pct     = ((saved / inputSize) * 100).toFixed(1);
    const warning = outputSize > MAX_BYTES ? '  ⚠ still over target' : '';
    console.log(`  ✓ ${relPath}  ${kb(inputSize)} → ${kb(outputSize)}  q${quality}  −${pct}%${warning}`);
  }

  return { relPath, inputSize, outputSize: outputSize ?? inputSize, skipped };
}

// ---------------------------------------------------------------------------
// Concurrency pool
// ---------------------------------------------------------------------------

async function runPool(items, concurrency, fn) {
  const results = [];
  const queue   = [...items];
  async function worker() {
    while (queue.length) {
      const item   = queue.shift();
      const result = await fn(item);
      if (result) results.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!(await exists(FULLS_DIR))) {
    console.log(`images/fulls/ not found. Create it and add your photos.`);
    return;
  }
  await ensureDir(THUMBS_DIR);

  console.log(`\n📷  compress-images  (target ≤ ${MAX_BYTES / 1024} KB, ${CONCURRENCY} workers)\n`);
  if (THUMBS_ONLY) console.log('  --thumbs-only: skipping full-image compression\n');
  if (FORCE)       console.log('  --force: reprocessing all files\n');

  const images = await collectImages(FULLS_DIR);
  if (!images.length) {
    console.log('No JPEG files found under images/fulls/');
    return;
  }
  console.log(`  Found ${images.length} image(s)\n`);

  const t0      = Date.now();
  const results = await runPool(images, CONCURRENCY, processFile);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const compressed = results.filter(r => !r.skipped);
  const totalIn    = results.reduce((s, r) => s + r.inputSize, 0);
  const totalOut   = results.reduce((s, r) => s + r.outputSize, 0);

  console.log(`\n${'─'.repeat(52)}`);
  console.log(`  Processed : ${results.length} / ${images.length}`);
  console.log(`  Compressed: ${compressed.length}  |  Skipped: ${results.length - compressed.length}`);
  if (compressed.length) {
    console.log(`  Saved     : ${kb(totalIn - totalOut)} (${((1 - totalOut / totalIn) * 100).toFixed(1)}% overall)`);
  }
  console.log(`  Time      : ${elapsed}s`);
  console.log(`${'─'.repeat(52)}\n`);
  console.log(`  Next step: npm run build  (scans EXIF + generates site)\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
