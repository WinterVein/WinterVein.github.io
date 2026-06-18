import { readdir, stat, unlink, rename, writeFile, mkdir } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { cpus } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FULLS_DIR = join(__dirname, 'images/fulls');
const THUMBS_DIR = join(__dirname, 'images/thumbs');
const THUMB_WIDTH = 400;
const MAX_FILE_SIZE = 999 * 1024; // 999KB in bytes
const JPEG_QUALITY = 80;
const CONCURRENCY = Math.min(4, cpus().length);

const imageExtensions = new Set(['.jpg', '.jpeg', '.JPG', '.JPEG']);

// Simple in-memory cache for quality settings
const qualityCache = new Map();

/**
 * Ultra-fast: Estimate quality based on image properties
 * Preserves ALL EXIF metadata using keepMetadata()
 */
async function compressImageFast(inputPath, targetSize) {
  const metadata = await sharp(inputPath).metadata();
  const inputSize = (await stat(inputPath)).size;
  
  // If already small enough, just copy with metadata preserved
  if (inputSize <= targetSize) {
    const buffer = await sharp(inputPath)
      .keepMetadata()  // Preserve all EXIF/IPTC/XMP metadata
      .jpeg({ quality: 92, mozjpeg: true, progressive: true })
      .toBuffer();
    return { buffer, quality: 92, size: buffer.length };
  }
  
  // Calculate pixel count for better estimation
  const pixels = metadata.width * metadata.height;
  
  // Heuristic: determine quality based on image size and pixel count
  let quality;
  const compressionNeeded = targetSize / inputSize;
  
  // Base quality on pixel density
  if (pixels > 25_000_000) { // > 25MP
    quality = 55;
  } else if (pixels > 15_000_000) { // > 15MP
    quality = 65;
  } else if (pixels > 8_000_000) { // > 8MP
    quality = 75;
  } else if (pixels > 4_000_000) { // > 4MP
    quality = 82;
  } else {
    quality = 88;
  }
  
  // Adjust based on needed compression
  if (compressionNeeded < 0.3) {
    quality = Math.max(30, quality - 20);
  } else if (compressionNeeded < 0.5) {
    quality = Math.max(30, quality - 12);
  } else if (compressionNeeded < 0.7) {
    quality = Math.max(30, quality - 5);
  }
  
  // Check cache
  const cacheKey = `${metadata.width}x${metadata.height}_${Math.round(compressionNeeded * 100)}`;
  if (qualityCache.has(cacheKey)) {
    quality = qualityCache.get(cacheKey);
  } else {
    qualityCache.set(cacheKey, quality);
  }
  
  // Single compression attempt with EXIF preservation
  let buffer = await sharp(inputPath)
    .keepMetadata()  // Preserve all EXIF/IPTC/XMP metadata
    .jpeg({ quality, mozjpeg: true, progressive: true })
    .toBuffer();
  
  // One refinement pass if needed
  if (buffer.length > targetSize && quality > 30) {
    // Reduce quality more aggressively
    const newQuality = Math.max(30, quality - 15);
    buffer = await sharp(inputPath)
      .keepMetadata()  // Preserve all EXIF/IPTC/XMP metadata
      .jpeg({ quality: newQuality, mozjpeg: true, progressive: true })
      .toBuffer();
    quality = newQuality;
  } else if (buffer.length < targetSize * 0.7 && quality < 92) {
    // Try increasing quality if we have room
    const newQuality = Math.min(92, quality + 10);
    const testBuffer = await sharp(inputPath)
      .keepMetadata()  // Preserve all EXIF/IPTC/XMP metadata
      .jpeg({ quality: newQuality, mozjpeg: true, progressive: true })
      .toBuffer();
    if (testBuffer.length <= targetSize) {
      buffer = testBuffer;
      quality = newQuality;
    }
  }
  
  return { buffer, quality, size: buffer.length };
}

/**
 * Generate thumbnail for an image with EXIF preservation
 */
async function generateThumbnail(inputPath, outputPath) {
  try {
    await sharp(inputPath)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true, fit: 'inside' })
      .keepMetadata()  // Preserve all EXIF/IPTC/XMP metadata in thumbnails
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true, progressive: true })
      .toFile(outputPath);
    return await stat(outputPath);
  } catch (err) {
    console.error(`  ⚠️ Thumbnail generation failed: ${err.message}`);
    return null;
  }
}

/**
 * Process a single file
 */
async function processFile(file) {
  const inputPath = join(FULLS_DIR, file);
  const tmpPath = join(FULLS_DIR, `.tmp_${file}`);
  const thumbPath = join(THUMBS_DIR, file);
  
  try {
    const metadata = await sharp(inputPath).metadata();
    const inputSize = (await stat(inputPath)).size;
    
    // Check if already under max size
    if (inputSize <= MAX_FILE_SIZE) {
      // Generate thumbnail with EXIF preservation
      const thumbStat = await generateThumbnail(inputPath, thumbPath);
      const thumbSize = thumbStat ? (thumbStat.size / 1024).toFixed(1) : 'failed';
      
      console.log(
        `✓ ${file}: ${(inputSize / 1024).toFixed(1)}KB - already optimal ` +
        `(${metadata.width}x${metadata.height}), thumb: ${thumbSize}KB`
      );
      
      return { 
        original: inputSize, 
        compressed: inputSize, 
        thumb: thumbStat ? thumbStat.size : 0, 
        file,
        status: 'already_optimal'
      };
    }
    
    // Start thumbnail generation in background (don't await yet)
    const thumbPromise = generateThumbnail(inputPath, thumbPath);
    
    // Fast compression with EXIF preservation
    const { buffer, quality, size: compressedSize } = await compressImageFast(inputPath, MAX_FILE_SIZE);
    
    // Write compressed file using fs/promises writeFile (imported)
    await writeFile(tmpPath, buffer);
    
    // Verify the compressed file
    const finalSize = (await stat(tmpPath)).size;
    
    // Replace original with compressed version
    await unlink(inputPath);
    await rename(tmpPath, inputPath);
    
    // Wait for thumbnail to complete
    const thumbStat = await thumbPromise;
    const thumbSize = thumbStat ? (thumbStat.size / 1024).toFixed(1) : 'failed';
    
    const reduction = ((1 - finalSize / inputSize) * 100).toFixed(1);
    const sizeStatus = finalSize <= MAX_FILE_SIZE ? '✅' : '⚠️';
    
    console.log(
      `${sizeStatus} ${file}: ${metadata.width}x${metadata.height} -> ` +
      `[Q:${quality}] ${(inputSize / 1024).toFixed(1)}KB → ${(finalSize / 1024).toFixed(1)}KB ` +
      `(${reduction}% reduction), thumb: ${thumbSize}KB`
    );
    
    if (finalSize > MAX_FILE_SIZE) {
      console.log(`  ⚠️  WARNING: Final size ${(finalSize / 1024).toFixed(1)}KB exceeds target!`);
    }
    
    return { 
      original: inputSize, 
      compressed: finalSize, 
      thumb: thumbStat ? thumbStat.size : 0, 
      file,
      quality,
      status: 'compressed'
    };
    
  } catch (err) {
    console.error(`❌ Error processing ${file}:`, err.message);
    return null;
  }
}

/**
 * Process files with manual concurrency control
 */
async function processWithConcurrency(files, concurrency) {
  const results = [];
  const queue = [...files];
  let activeWorkers = 0;
  
  return new Promise((resolve) => {
    async function worker() {
      while (queue.length > 0) {
        const file = queue.shift();
        const result = await processFile(file);
        if (result) results.push(result);
      }
      activeWorkers--;
      if (activeWorkers === 0) {
        resolve(results);
      }
    }
    
    // Start workers
    const workerCount = Math.min(concurrency, files.length);
    activeWorkers = workerCount;
    for (let i = 0; i < workerCount; i++) {
      worker();
    }
  });
}

/**
 * Main function
 */
async function compressImages() {
  console.log('🚀 Starting image optimization with EXIF preservation...');
  console.log(`📁 Using ${CONCURRENCY} concurrent workers`);
  console.log(`📁 Fulls directory: ${FULLS_DIR}`);
  console.log(`📁 Thumbs directory: ${THUMBS_DIR}`);
  console.log(`📷 EXIF data (make, model, exposure, etc.) will be preserved`);
  
  // Ensure thumbs directory exists
  try {
    await stat(THUMBS_DIR);
  } catch {
    console.log('📁 Creating thumbs directory...');
    await mkdir(THUMBS_DIR, { recursive: true });
  }
  
  const files = await readdir(FULLS_DIR);
  const imageFiles = files.filter(f => imageExtensions.has(extname(f)));
  
  if (imageFiles.length === 0) {
    console.log('No JPEG images found in', FULLS_DIR);
    return;
  }
  
  console.log(`📸 Found ${imageFiles.length} images to process`);
  console.log('='.repeat(55));
  
  const startTime = Date.now();
  
  // Process files with concurrency control
  const results = await processWithConcurrency(imageFiles, CONCURRENCY);
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  // Calculate summary
  let totalOriginal = 0;
  let totalCompressed = 0;
  let totalThumb = 0;
  let compressed = 0;
  let alreadyOptimal = 0;
  
  for (const result of results) {
    if (result) {
      totalOriginal += result.original;
      totalCompressed += result.compressed;
      totalThumb += result.thumb;
      if (result.status === 'compressed') compressed++;
      else alreadyOptimal++;
    }
  }
  
  console.log('\n' + '='.repeat(55));
  console.log('📊 SUMMARY:');
  console.log(`  Files processed: ${results.length}/${imageFiles.length}`);
  console.log(`  Compressed: ${compressed} files`);
  console.log(`  Already optimal: ${alreadyOptimal} files`);
  console.log(`  Time elapsed: ${elapsed}s`);
  console.log(`  Avg speed: ${(results.length / parseFloat(elapsed)).toFixed(2)} files/sec`);
  console.log(`  Total originals: ${(totalOriginal / 1024 / 1024).toFixed(2)}MB`);
  console.log(`  Total compressed: ${(totalCompressed / 1024 / 1024).toFixed(2)}MB`);
  console.log(`  Total thumbnails: ${(totalThumb / 1024 / 1024).toFixed(2)}MB`);
  if (totalOriginal > 0) {
    console.log(`  Overall saving: ${((1 - totalCompressed / totalOriginal) * 100).toFixed(1)}%`);
  }
  console.log(`  ✅ EXIF metadata preserved in all images`);
  console.log('='.repeat(55));
}

// Run the script
compressImages().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});