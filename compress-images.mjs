import { readdir, stat, unlink, rename } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FULLS_DIR = join(__dirname, 'images/fulls');
const THUMBS_DIR = join(__dirname, 'images/thumbs');
const THUMB_WIDTH = 400;
const JPEG_QUALITY = 80;

const imageExtensions = new Set(['.jpg', '.jpeg', '.JPG', '.JPEG']);

async function compressImages() {
  const files = await readdir(FULLS_DIR);
  const imageFiles = files.filter(f => imageExtensions.has(extname(f)));

  if (imageFiles.length === 0) {
    console.log('No JPEG images found in', FULLS_DIR);
    return;
  }

  for (const file of imageFiles) {
    const inputPath = join(FULLS_DIR, file);
    const tmpPath = join(FULLS_DIR, `.tmp_${file}`);
    const thumbPath = join(THUMBS_DIR, file);

    try {
      const metadata = await sharp(inputPath).metadata();
      const inputSize = (await stat(inputPath)).size;

      // Compress full image: write to temp, then replace original
      await sharp(inputPath)
        .withMetadata()
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toFile(tmpPath);
      await unlink(inputPath);
      await rename(tmpPath, inputPath);
      const compressedSize = (await stat(inputPath)).size;

      // Generate thumbnail
      await sharp(inputPath)
        .withMetadata()
        .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
        .jpeg({ quality: 80, mozjpeg: true })
        .toFile(thumbPath);

      const thumbSize = (await stat(thumbPath)).size;

      console.log(
        `${file}: ${metadata.width}x${metadata.height} -> ` +
        `full: ${(inputSize / 1024).toFixed(1)}KB -> ${(compressedSize / 1024).toFixed(1)}KB, ` +
        `thumb: ${(thumbSize / 1024).toFixed(1)}KB`
      );
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }
}

compressImages().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
