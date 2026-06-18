import { readdir, stat } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FULLS_DIR = join(__dirname, 'images/fulls');
const JPEG_QUALITY = 90;

const imageExtensions = new Set(['.jpg', '.jpeg', '.JPG', '.JPEG']);

async function resizeHalf() {
  const files = await readdir(FULLS_DIR);
  const imageFiles = files.filter(f => imageExtensions.has(extname(f)));

  if (imageFiles.length === 0) {
    console.log('No JPEG images found in', FULLS_DIR);
    return;
  }

  for (const file of imageFiles) {
    const inputPath = join(FULLS_DIR, file);
    const tmpPath = join(FULLS_DIR, `.tmp_${file}`);

    try {
      const metadata = await sharp(inputPath).metadata();
      const inputSize = (await stat(inputPath)).size;
      const newWidth = Math.round((metadata.width ?? 0) / 2);
      const newHeight = Math.round((metadata.height ?? 0) / 2);

      await sharp(inputPath)
        .withMetadata()
        .resize(newWidth, newHeight)
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toFile(tmpPath);

      const { unlink, rename } = await import('node:fs/promises');
      await unlink(inputPath);
      await rename(tmpPath, inputPath);

      const newSize = (await stat(inputPath)).size;

      console.log(
        `${file}: ${metadata.width}x${metadata.height} -> ${newWidth}x${newHeight}, ` +
        `${(inputSize / 1024).toFixed(1)}KB -> ${(newSize / 1024).toFixed(1)}KB`
      );
    } catch (err) {
      console.error(`Error processing ${file}:`, err.message);
    }
  }
}

resizeHalf().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
