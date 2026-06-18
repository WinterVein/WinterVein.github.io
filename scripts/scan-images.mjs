#!/usr/bin/env node
/**
 * scan-images.mjs
 * ---------------------------------------------------------------------------
 * Walks images/fulls/ and images/thumbs/ (which must already exist — run
 * compress-images.mjs first if you haven't yet), extracts EXIF from each
 * full-size photo, merges in any descriptions.json caption files, and writes
 * _data/gallery.json.
 *
 * This is the script that runs as part of `npm run build`. It never touches
 * the image files themselves.
 *
 * Description priority (highest wins):
 *   1. descriptions.json in the same folder as the photo in images/fulls/
 *   2. Previously saved description in _data/gallery.json (so hand-edits
 *      made directly in gallery.json survive a re-scan)
 *   3. Empty string
 * ---------------------------------------------------------------------------
 */

import { readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, relative, basename, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import exifr from 'exifr';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const ROOT       = join(__dirname, '..');
const FULLS_DIR  = join(ROOT, 'images', 'fulls');
const THUMBS_DIR = join(ROOT, 'images', 'thumbs');
const DATA_DIR   = join(ROOT, '_data');
const GALLERY_JSON = join(DATA_DIR, 'gallery.json');

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.JPG', '.JPEG']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

function titleCase(slug) {
  return slug.replace(/[-_]+/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatShutter(val) {
  if (!val) return null;
  return val >= 1 ? `${val}s` : `1/${Math.round(1 / val)}s`;
}

// ---------------------------------------------------------------------------
// EXIF extraction
// ---------------------------------------------------------------------------

async function extractExif(srcPath) {
  try {
    const data = await exifr.parse(srcPath, {
      pick: [
        'Make', 'Model', 'LensModel',
        'FNumber', 'ExposureTime', 'ISO',
        'FocalLength', 'FocalLengthIn35mmFormat',
        'DateTimeOriginal', 'CreateDate',
        'GPSLatitude', 'GPSLongitude',
      ],
    });
    if (!data) return null;
    return {
      camera:      [data.Make, data.Model].filter(Boolean).join(' ') || null,
      lens:        data.LensModel || null,
      aperture:    data.FNumber     ? `f/${data.FNumber}`                    : null,
      shutterSpeed: formatShutter(data.ExposureTime),
      iso:         data.ISO         ? `ISO ${data.ISO}`                      : null,
      focalLength: data.FocalLengthIn35mmFormat
                     ? `${data.FocalLengthIn35mmFormat}mm`
                     : data.FocalLength ? `${data.FocalLength}mm`            : null,
      dateTaken:   (data.DateTimeOriginal || data.CreateDate)
                     ? new Date(data.DateTimeOriginal || data.CreateDate).toISOString()
                     : null,
      gps: (data.GPSLatitude && data.GPSLongitude)
                     ? { lat: data.GPSLatitude, lon: data.GPSLongitude }
                     : null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Load descriptions.json files (cached per directory)
// ---------------------------------------------------------------------------

const descCache = new Map();

async function loadDescriptions(dir) {
  if (descCache.has(dir)) return descCache.get(dir);
  const file = join(dir, 'descriptions.json');
  let map = {};
  if (await exists(file)) {
    try {
      const raw = await readFile(file, 'utf8');
      map = JSON.parse(raw);
      // Strip the readme key if present
      delete map['_readme'];
    } catch (err) {
      console.warn(`  ⚠ Could not parse ${file}: ${err.message}`);
    }
  }
  descCache.set(dir, map);
  return map;
}

// ---------------------------------------------------------------------------
// Load previous gallery.json so we can preserve hand-written descriptions
// ---------------------------------------------------------------------------

function indexDescriptions(node, map = new Map()) {
  for (const p of (node.photos || [])) {
    if (p.description) map.set(p.relativePath, p.description);
  }
  for (const f of (node.folders || [])) indexDescriptions(f, map);
  return map;
}

// ---------------------------------------------------------------------------
// Recursive directory walker — builds tree
// ---------------------------------------------------------------------------

async function buildNode(absDir) {
  const relDir = relative(FULLS_DIR, absDir);
  const relDirNorm = relDir === '' ? '' : relDir.split(/[\\/]/).join('/');
  const name = relDir === '' ? 'Gallery' : titleCase(basename(absDir));

  const entries = await readdir(absDir, { withFileTypes: true });

  // Subfolders (recurse)
  const folders = [];
  for (const e of entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    folders.push(await buildNode(join(absDir, e.name)));
  }

  // Photos in this dir
  const imageEntries = entries
    .filter(e => e.isFile() && IMAGE_EXTS.has(extname(e.name)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const folderDescriptions = await loadDescriptions(absDir);

  const photos = [];
  for (const e of imageEntries) {
    const srcPath    = join(absDir, e.name);
    const relativePath = (relDirNorm ? relDirNorm + '/' : '') + e.name;

    // Dimensions from the full image
    let width = null, height = null;
    try {
      const meta = await sharp(srcPath).metadata();
      width  = meta.width;
      height = meta.height;
    } catch {}

    const exif = await extractExif(srcPath);

    // Description: descriptions.json wins, then previous gallery.json value
    const description = folderDescriptions[e.name] ?? previousDescriptions.get(relativePath) ?? '';

    photos.push({
      filename:     e.name,
      relativePath,
      fullUrl:  `/images/fulls/${relativePath}`,
      thumbUrl: `/images/thumbs/${relativePath}`,
      width,
      height,
      description,
      exif,
    });

    process.stdout.write(`  scanned ${relativePath}\n`);
  }

  function findCover(node) {
    if (node.photos.length) return node.photos[0].thumbUrl;
    for (const f of node.folders) { const c = findCover(f); if (c) return c; }
    return null;
  }

  const node = { name, slug: relDirNorm, path: relDirNorm, folders, photos,
                 photoCount: photos.length };
  node.totalPhotoCount = photos.length + folders.reduce((s, f) => s + f.totalPhotoCount, 0);
  node.cover = findCover(node);

  return node;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Module-level so buildNode closures can read it
let previousDescriptions = new Map();

async function main() {
  if (!(await exists(FULLS_DIR))) {
    console.error('images/fulls/ not found. Add photos and run compress-images.mjs first.');
    process.exit(1);
  }

  await mkdir(DATA_DIR, { recursive: true });

  // Load previous gallery.json for description preservation
  if (await exists(GALLERY_JSON)) {
    try {
      previousDescriptions = indexDescriptions(JSON.parse(await readFile(GALLERY_JSON, 'utf8')));
    } catch {}
  }

  console.log('\n🔍  scan-images — extracting EXIF and building gallery manifest\n');

  const tree = await buildNode(FULLS_DIR);

  await writeFile(GALLERY_JSON, JSON.stringify(tree, null, 2), 'utf8');

  console.log(`\n  ✓ gallery.json written  (${tree.totalPhotoCount} photos across all folders)`);
  console.log(`  Next step: node scripts/build-site.mjs\n`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
