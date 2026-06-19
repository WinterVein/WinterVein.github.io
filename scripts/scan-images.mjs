#!/usr/bin/env node
/**
 * scan-images.mjs (incremental)
 * ---------------------------------------------------------------------------
 * Walks images/fulls/ and images/thumbs/, extracts EXIF from NEW images only,
 * merges descriptions.json captions, and writes per-folder JSON files into
 * _data/gallery/. Previously processed images are skipped — no redundant EXIF
 * extraction.
 *
 * Output:
 *   _data/gallery/index.json       <- folder tree (names, covers, counts)
 *   _data/gallery/<folder>.json    <- per-folder photo data (self-contained)
 *   _data/gallery/<a>/<b>.json     <- nested subfolder data
 *
 * Description priority (highest wins):
 *   1. descriptions.json in the same folder as the photo
 *   2. Previously saved description in the per-folder JSON
 *   3. Previously saved description from any other folder (handles moves)
 *   4. Empty string
 * ---------------------------------------------------------------------------
 */

import { readdir, readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { join, relative, basename, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import exifr from 'exifr';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const ROOT         = join(__dirname, '..');
const FULLS_DIR    = join(ROOT, 'images', 'fulls');
const THUMBS_DIR   = join(ROOT, 'images', 'thumbs');
const DATA_DIR     = join(ROOT, '_data');
const GALLERY_DIR  = join(DATA_DIR, 'gallery');
const INDEX_FILE   = join(GALLERY_DIR, 'index.json');

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
      camera:       [data.Make, data.Model].filter(Boolean).join(' ') || null,
      lens:         data.LensModel || null,
      aperture:     data.FNumber     ? `f/${data.FNumber}`                    : null,
      shutterSpeed: formatShutter(data.ExposureTime),
      iso:          data.ISO         ? `ISO ${data.ISO}`                      : null,
      focalLength:  data.FocalLengthIn35mmFormat
                      ? `${data.FocalLengthIn35mmFormat}mm`
                      : data.FocalLength ? `${data.FocalLength}mm`            : null,
      dateTaken:    (data.DateTimeOriginal || data.CreateDate)
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
      delete map['_readme'];
    } catch (err) {
      console.warn(`  ⚠ Could not parse ${file}: ${err.message}`);
    }
  }
  
  // Auto-generate descriptions.json if GEN.PLZ exists
  const genFile = join(dir, 'GEN.PLZ');
  if (await exists(genFile)) {
    // Only generate descriptions.json if the folder has images
    const entries = await readdir(dir, { withFileTypes: true });
    const hasImages = entries.some(e => e.isFile() && IMAGE_EXTS.has(extname(e.name)));
    
    if (hasImages) {
      // Ensure all photos have a description entry (blank if not present)
      const imageEntries = entries
        .filter(e => e.isFile() && IMAGE_EXTS.has(extname(e.name)))
        .sort((a, b) => a.name.localeCompare(b.name));
      
      let changed = false;
      for (const e of imageEntries) {
        if (!(e.name in map)) {
          map[e.name] = '';
          changed = true;
        }
      }
      
      if (changed) {
        await writeFile(file, JSON.stringify(map, null, 2), 'utf8');
        console.log(`  📝 Generated descriptions.json (GEN.PLZ detected)`);
      }
    }
  }
  
  descCache.set(dir, map);
  return map;
}

// ---------------------------------------------------------------------------
// Load ALL existing per-folder JSON files for description preservation
// ---------------------------------------------------------------------------

async function loadAllDescriptions() {
  const map = new Map();

  async function walk(dir) {
    if (!(await exists(dir))) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.name.endsWith('.json') && e.name !== 'index.json') {
        try {
          const data = JSON.parse(await readFile(full, 'utf8'));
          for (const p of (data.photos || [])) {
            if (p.description) map.set(p.relativePath, p.description);
          }
        } catch {}
      }
    }
  }

  await walk(GALLERY_DIR);
  return map;
}

// ---------------------------------------------------------------------------
// Load a single per-folder JSON (returns null if not found)
// ---------------------------------------------------------------------------

async function loadExistingNode(relDir) {
  if (!relDir) {
    // Root: photos live in index.json
    if (!(await exists(INDEX_FILE))) return null;
    try {
      const index = JSON.parse(await readFile(INDEX_FILE, 'utf8'));
      return { photos: index.photos || [] };
    } catch { return null; }
  }
  const filePath = join(GALLERY_DIR, relDir + '.json');
  if (!(await exists(filePath))) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Recursive directory walker — incremental per-folder processing
// ---------------------------------------------------------------------------

async function buildNode(absDir, previousDescriptions) {
  const relDir     = relative(FULLS_DIR, absDir);
  const relDirNorm = relDir === '' ? '' : relDir.split(/[\\/]/).join('/');
  const name       = relDir === '' ? 'Gallery' : titleCase(basename(absDir));

  // Load existing per-folder data for incremental processing
  const existing      = await loadExistingNode(relDirNorm);
  const existingMap   = new Map((existing?.photos || []).map(p => [p.filename, p]));

  const entries = await readdir(absDir, { withFileTypes: true });

  // Photos in this dir
  const imageEntries = entries
    .filter(e => e.isFile() && IMAGE_EXTS.has(extname(e.name)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const folderDescriptions = await loadDescriptions(absDir);

  const photos = [];
  let newCount = 0, reusedCount = 0;

  for (const e of imageEntries) {
    const cached = existingMap.get(e.name);

    if (cached) {
      // Reuse — no EXIF extraction needed
      const desc = folderDescriptions[e.name] ?? cached.description ?? '';
      photos.push(desc !== cached.description ? { ...cached, description: desc } : cached);
      reusedCount++;
      continue;
    }

    // New image — extract EXIF + dimensions
    const srcPath      = join(absDir, e.name);
    const relativePath = (relDirNorm ? relDirNorm + '/' : '') + e.name;

    let width = null, height = null;
    try {
      const meta = await sharp(srcPath).metadata();
      width  = meta.width;
      height = meta.height;
    } catch {}

    const exif        = await extractExif(srcPath);
    const description = folderDescriptions[e.name]
                     ?? previousDescriptions.get(relativePath)
                     ?? '';

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

    process.stdout.write(`  + ${relativePath}\n`);
    newCount++;
  }

  // Detect removals (in cached data but not on disk)
  const onDisk = new Set(imageEntries.map(e => e.name));
  for (const fn of existingMap.keys()) {
    if (!onDisk.has(fn)) {
      process.stdout.write(`  - ${relDirNorm ? relDirNorm + '/' : ''}${fn} (removed)\n`);
    }
  }

  if (reusedCount && !newCount) {
    process.stdout.write(`  ${relDirNorm || '.'}: ${reusedCount} cached\n`);
  }

  // Subfolders (recurse)
  const subfolders = [];
  for (const e of entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    subfolders.push(await buildNode(join(absDir, e.name), previousDescriptions));
  }

  function findCover(photos, subfolders) {
    if (photos.length) return photos[0].thumbUrl;
    for (const f of subfolders) { const c = findCover(f.photos, f.subfolders); if (c) return c; }
    return null;
  }

  const totalPhotoCount = photos.length + subfolders.reduce((s, f) => s + f.totalPhotoCount, 0);

  return {
    name,
    slug:    relDirNorm,
    path:    relDirNorm,
    subfolders,
    photos,
    photoCount:       photos.length,
    totalPhotoCount,
    cover:            findCover(photos, subfolders),
  };
}

// ---------------------------------------------------------------------------
// Write per-folder JSON files (walks tree, writes each node's photos)
// ---------------------------------------------------------------------------

async function writeFolderFiles(node) {
  if (node.path) {
    const filePath = join(GALLERY_DIR, node.path + '.json');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({
      name:             node.name,
      slug:             node.slug,
      path:             node.path,
      subfolders:       node.subfolders.map(f => ({ name: f.name, path: f.path, cover: f.cover, totalPhotoCount: f.totalPhotoCount })),
      photos:           node.photos,
      photoCount:       node.photoCount,
      totalPhotoCount:  node.totalPhotoCount,
      cover:            node.cover,
    }, null, 2), 'utf8');
  }

  for (const sub of node.subfolders) {
    await writeFolderFiles(sub);
  }
}

// ---------------------------------------------------------------------------
// Write index.json — tree structure only (no photo data)
// ---------------------------------------------------------------------------

function buildIndexTree(node) {
  return {
    name:             node.name,
    path:             node.path,
    cover:            node.cover,
    photoCount:       node.photoCount,
    totalPhotoCount:  node.totalPhotoCount,
    subfolders:       node.subfolders.map(buildIndexTree),
  };
}

async function writeIndex(node) {
  const index = buildIndexTree(node);

  // Root-level photos go in index.json (they have no per-folder file)
  if (node.photos.length) {
    index.photos = node.photos;
  }

  await mkdir(GALLERY_DIR, { recursive: true });
  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!(await exists(FULLS_DIR))) {
    console.error('images/fulls/ not found. Add photos and run compress-images.mjs first.');
    process.exit(1);
  }

  await mkdir(GALLERY_DIR, { recursive: true });

  // Load ALL existing per-folder data for description preservation
  const previousDescriptions = await loadAllDescriptions();

  console.log('\n🔍  scan-images — incremental scan\n');

  const tree = await buildNode(FULLS_DIR, previousDescriptions);

  // Write per-folder files + index
  await writeFolderFiles(tree);
  await writeIndex(tree);

  // Clean up old monolithic gallery.json if it exists
  const oldFile = join(DATA_DIR, 'gallery.json');
  if (await exists(oldFile)) {
    await rm(oldFile);
    console.log('  (removed old gallery.json)');
  }

  console.log(`\n  ✓ ${tree.totalPhotoCount} photos across ${countFolders(tree) - 1} folders → _data/gallery/`);
  console.log(`  Next step: node scripts/build-site.mjs\n`);
}

function countFolders(node) {
  return 1 + node.subfolders.reduce((s, f) => s + countFolders(f), 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
