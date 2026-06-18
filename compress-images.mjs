import { readdir, stat, mkdir, unlink, rename, readFile, writeFile } from 'node:fs/promises';
import { join, extname, dirname, relative, sep } from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FULLS_DIR = join(__dirname, 'images/fulls');
const THUMBS_DIR = join(__dirname, 'images/thumbs');
const MANIFEST_PATH = join(__dirname, 'images/manifest.json');
const THUMB_WIDTH = 400;
const MIN_QUALITY = 30;
const MAX_QUALITY = 95;
const DEFAULT_MAX_SIZE_KB = 999;

const imageExtensions = new Set(['.jpg', '.jpeg', '.JPG', '.JPEG']);
const annotationExtensions = new Set(['.txt', '.md']);

function parseArgs() {
  const args = process.argv.slice(2);
  let maxSizeKB = DEFAULT_MAX_SIZE_KB;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-size' && args[i + 1]) {
      maxSizeKB = parseInt(args[i + 1], 10);
    }
  }
  return maxSizeKB * 1024;
}

async function findBestQuality(inputPath, maxSizeBytes) {
  let lo = MIN_QUALITY;
  let hi = MAX_QUALITY;
  let best = lo;

  while (lo <= hi) {
    const mid = Math.round((lo + hi) / 2);
    const buf = await sharp(inputPath)
      .withMetadata()
      .jpeg({ quality: mid, mozjpeg: true })
      .toBuffer();

    if (buf.length <= maxSizeBytes) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return best;
}

async function ensureDir(dirPath) {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch { }
}

async function scanDirectory(dirPath, relativePath = '') {
  const entries = [];
  const items = await readdir(dirPath, { withFileTypes: true });

  for (const item of items.sort((a, b) => a.name.localeCompare(b.name))) {
    const itemPath = join(dirPath, item.name);
    const itemRel = relativePath ? `${relativePath}/${item.name}` : item.name;

    if (item.isDirectory()) {
      const children = await scanDirectory(itemPath, itemRel);
      if (children.length > 0) {
        entries.push({
          type: 'folder',
          name: item.name,
          children,
        });
      }
    } else if (imageExtensions.has(extname(item.name))) {
      const baseName = item.name.replace(extname(item.name), '');
      const dirPathPart = dirname(itemRel);
      const annotationName = await findAnnotation(dirPath, baseName);

      let annotation = null;
      if (annotationName) {
        try {
          annotation = await readFile(join(dirPath, annotationName), 'utf-8');
        } catch { }
      }

      entries.push({
        type: 'image',
        name: item.name,
        annotation,
      });
    }
  }

  return entries;
}

async function findAnnotation(dirPath, baseName) {
  for (const ext of ['.txt', '.md']) {
    try {
      await stat(join(dirPath, baseName + ext));
      return baseName + ext;
    } catch { }
  }
  return null;
}

async function compressDir(fullsDir, thumbsDir, maxSizeBytes) {
  const items = await readdir(fullsDir, { withFileTypes: true });

  for (const item of items) {
    const fullItemPath = join(fullsDir, item.name);
    const thumbItemPath = join(thumbsDir, item.name);

    if (item.isDirectory()) {
      await ensureDir(thumbItemPath);
      await compressDir(fullItemPath, thumbItemPath, maxSizeBytes);
    } else if (imageExtensions.has(extname(item.name))) {
      try {
        const metadata = await sharp(fullItemPath).metadata();
        const inputSize = (await stat(fullItemPath)).size;
        const quality = await findBestQuality(fullItemPath, maxSizeBytes);

        // Compress full image
        const tmpPath = join(fullsDir, `.tmp_${item.name}`);
        await sharp(fullItemPath)
          .withMetadata()
          .jpeg({ quality, mozjpeg: true })
          .toFile(tmpPath);
        await unlink(fullItemPath);
        await rename(tmpPath, fullItemPath);
        const compressedSize = (await stat(fullItemPath)).size;

        // Generate thumbnail
        await ensureDir(thumbsDir);
        await sharp(fullItemPath)
          .withMetadata()
          .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(thumbItemPath);

        const thumbSize = (await stat(thumbItemPath)).size;
        const fitsTarget = compressedSize <= maxSizeBytes ? 'yes' : 'no';
        const showPath = relative(FULLS_DIR, fullItemPath);
        console.log(
          `${showPath}: ${metadata.width}x${metadata.height} -> ` +
          `q${quality}, full: ${(inputSize / 1024).toFixed(1)}KB -> ${(compressedSize / 1024).toFixed(1)}KB ` +
          `(under ${(maxSizeBytes / 1024).toFixed(0)}KB? ${fitsTarget}), ` +
          `thumb: ${(thumbSize / 1024).toFixed(1)}KB`
        );
      } catch (err) {
        console.error(`Error processing ${relative(FULLS_DIR, fullItemPath)}:`, err.message);
      }
    }
  }
}

async function main() {
  const maxSizeBytes = parseArgs();

  if (!(await stat(FULLS_DIR).catch(() => false))) {
    console.error('Directory not found:', FULLS_DIR);
    process.exit(1);
  }

  await ensureDir(THUMBS_DIR);

  // Compress images and generate thumbnails recursively
  await compressDir(FULLS_DIR, THUMBS_DIR, maxSizeBytes);

  // Generate manifest
  const tree = await scanDirectory(FULLS_DIR);
  await writeFile(MANIFEST_PATH, JSON.stringify({ children: tree }, null, 2));
  console.log(`\nManifest written to ${MANIFEST_PATH}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
