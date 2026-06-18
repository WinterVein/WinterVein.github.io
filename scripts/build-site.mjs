#!/usr/bin/env node
/**
 * build-site.mjs
 * ---------------------------------------------------------------------------
 * Reads _data/gallery.json (written by compress-images.mjs) and generates
 * a complete static site under _site/:
 *
 *   _site/index.html
 *   _site/gallery/index.html          <- root gallery grid
 *   _site/gallery/<folder>/index.html <- one per subfolder, any depth
 *   _site/assets/                     <- copied from assets/
 *   _site/images/thumbs/              <- symlinked / copied
 *   _site/images/fulls/               <- symlinked / copied
 *
 * No Ruby. No Jekyll. Just Node.
 * ---------------------------------------------------------------------------
 */

import fs   from "node:fs/promises";
import path from "node:path";
import { existsSync, cpSync } from "node:fs";

const ROOT      = process.cwd();
const DATA_FILE = path.join(ROOT, "_data", "gallery.json");
const SITE_DIR  = path.join(ROOT, "_site");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function ensureDir(d) { await fs.mkdir(d, { recursive: true }); }

async function copyDir(src, dest) {
  if (!existsSync(src)) return;
  await ensureDir(path.dirname(dest));
  cpSync(src, dest, { recursive: true });
}

function esc(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      year: "numeric", month: "long", day: "numeric",
    });
  } catch { return iso; }
}

// Find a node in the tree by its path string
function findNode(tree, targetPath) {
  if (!targetPath || targetPath === "") return tree;
  const segments = targetPath.split("/");
  let node = tree;
  for (const seg of segments) {
    const found = node.folders?.find(
      f => f.slug.split("/").pop() === seg
    );
    if (!found) return null;
    node = found;
  }
  return node;
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------

function htmlShell({ title, siteTitle, breadcrumbs, bodyContent, rootPath }) {
  const base = rootPath; // e.g. "../.." to reach _site root from nested pages
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} · ${esc(siteTitle)}</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="${base}/assets/css/main.css">
</head>
<body>
  <header class="site-header">
    <div class="site-header__inner">
      <a class="site-title" href="${base}/index.html">${esc(siteTitle)}</a>
    </div>
  </header>

  <main>
    <div class="gallery-page">
      <div class="gallery-breadcrumb">
        ${breadcrumbs}
      </div>
      ${bodyContent}
    </div>
  </main>

  <footer class="site-footer">
    <p>&copy; ${new Date().getFullYear()} ${esc(siteTitle)}</p>
  </footer>

  <!-- Lightbox markup -->
  <div id="lightbox" class="lightbox" aria-hidden="true">
    <button class="lightbox__close" type="button" aria-label="Close">&times;</button>
    <button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="Previous photo">&#8249;</button>
    <button class="lightbox__nav lightbox__nav--next" type="button" aria-label="Next photo">&#8250;</button>
    <div class="lightbox__stage">
      <div class="lightbox__zoom-wrap">
        <img class="lightbox__image" src="" alt="" draggable="false">
      </div>
      <p class="lightbox__hint">Click photo to zoom &middot; hover for details</p>
    </div>
    <div class="lightbox__info">
      <p class="lightbox__description"></p>
      <dl class="lightbox__exif">
        <div class="lightbox__exif-item" data-field="camera"><dt>Camera</dt><dd></dd></div>
        <div class="lightbox__exif-item" data-field="lens"><dt>Lens</dt><dd></dd></div>
        <div class="lightbox__exif-item" data-field="focal"><dt>Focal Length</dt><dd></dd></div>
        <div class="lightbox__exif-item" data-field="aperture"><dt>Aperture</dt><dd></dd></div>
        <div class="lightbox__exif-item" data-field="shutter"><dt>Shutter</dt><dd></dd></div>
        <div class="lightbox__exif-item" data-field="iso"><dt>ISO</dt><dd></dd></div>
        <div class="lightbox__exif-item" data-field="date"><dt>Date Taken</dt><dd></dd></div>
      </dl>
    </div>
  </div>

  <script src="${base}/assets/js/main.js"></script>
</body>
</html>`;
}

function buildBreadcrumbs(folderPath, rootPath) {
  const base = rootPath;
  let html = `<a href="${base}/gallery/index.html">Gallery</a>`;
  if (!folderPath) return html;

  const segments = folderPath.split("/");
  let accumulated = "";
  for (const seg of segments) {
    accumulated = accumulated ? `${accumulated}/${seg}` : seg;
    const label = seg.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    html += `<span class="gallery-breadcrumb__sep">/</span>`;
    html += `<a href="${base}/gallery/${accumulated}/index.html">${esc(label)}</a>`;
  }
  return html;
}

function buildGrid(node, rootPath) {
  const base = rootPath;
  let html = `<div class="square-grid">\n`;

  // Folder squares
  for (const folder of node.folders) {
    const label = folder.name;
    const href  = `${base}/gallery/${folder.path}/index.html`;
    const cover = folder.cover
      ? `<img src="${base}${esc(folder.cover)}" alt="${esc(label)}" loading="lazy">`
      : `<div class="square__empty-folder" aria-hidden="true">
           <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5">
             <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>
           </svg>
         </div>`;

    html += `
    <a class="square square--folder" href="${esc(href)}">
      <div class="square__inner">
        ${cover}
        <div class="square__overlay square__overlay--folder">
          <span class="square__folder-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>
            </svg>
          </span>
          <span class="square__label">${esc(label)}</span>
          <span class="square__sublabel">${folder.totalPhotoCount} photo${folder.totalPhotoCount !== 1 ? "s" : ""}</span>
        </div>
      </div>
    </a>`;
  }

  // Photo squares
  for (const photo of node.photos) {
    const exif = photo.exif || {};
    const exifPill = [exif.aperture, exif.shutterSpeed, exif.iso]
      .filter(Boolean).join(" · ");

    html += `
    <a class="square square--photo" href="#"
      data-lightbox-trigger
      data-full="${base}${esc(photo.fullUrl)}"
      data-thumb="${base}${esc(photo.thumbUrl)}"
      data-description="${esc(photo.description)}"
      data-camera="${esc(exif.camera)}"
      data-lens="${esc(exif.lens)}"
      data-aperture="${esc(exif.aperture)}"
      data-shutter="${esc(exif.shutterSpeed)}"
      data-iso="${esc(exif.iso)}"
      data-focal="${esc(exif.focalLength)}"
      data-date="${esc(formatDate(exif.dateTaken))}"
    >
      <div class="square__inner">
        <img src="${base}${esc(photo.thumbUrl)}" alt="${esc(photo.description || photo.filename)}" loading="lazy">
        <div class="square__overlay square__overlay--photo">
          ${exifPill ? `<span class="square__exif-pill">${esc(exifPill)}</span>` : ""}
        </div>
      </div>
    </a>`;
  }

  html += `\n</div>`;

  if (!node.folders.length && !node.photos.length) {
    html += `<p class="gallery-empty">This folder is empty. Add photos to <code>images/fulls/${esc(node.path)}</code> and run <code>npm run build</code>.</p>`;
  }

  return html;
}

// ---------------------------------------------------------------------------
// Page generators
// ---------------------------------------------------------------------------

async function writeGalleryPage(node, tree, siteTitle, isRoot) {
  // Depth of this node determines how many "../" we need to reach _site/
  const depth = isRoot ? 1 : node.path.split("/").length + 1;
  const rootPath = "../".repeat(depth).replace(/\/$/, "") || ".";

  const outDir = isRoot
    ? path.join(SITE_DIR, "gallery")
    : path.join(SITE_DIR, "gallery", node.path);

  await ensureDir(outDir);

  const breadcrumbs = buildBreadcrumbs(isRoot ? "" : node.path, rootPath);
  const grid        = buildGrid(node, rootPath);

  const bodyContent = `
    <h1 class="gallery-title">${esc(node.name)}</h1>
    <p class="gallery-count">${node.totalPhotoCount} photo${node.totalPhotoCount !== 1 ? "s" : ""}</p>
    ${grid}`;

  const html = htmlShell({
    title: node.name,
    siteTitle,
    breadcrumbs,
    bodyContent,
    rootPath,
  });

  await fs.writeFile(path.join(outDir, "index.html"), html, "utf8");

  // Recurse into subfolders
  for (const sub of node.folders) {
    await writeGalleryPage(sub, tree, siteTitle, false);
  }
}

async function writeIndexPage(siteTitle) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(siteTitle)}</title>
  <link rel="icon" href="data:,">
  <link rel="stylesheet" href="assets/css/main.css">
</head>
<body>
  <header class="site-header">
    <div class="site-header__inner">
      <a class="site-title" href="index.html">${esc(siteTitle)}</a>
    </div>
  </header>
  <main>
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;gap:24px;text-align:center;padding:48px 24px;">
      <h1 style="font-family:var(--font-display);font-size:clamp(32px,6vw,72px);font-weight:600;letter-spacing:0.04em;text-transform:uppercase;margin:0;">
        ${esc(siteTitle)}
      </h1>
      <a href="gallery/index.html" class="hero-btn">View Gallery &rarr;</a>
    </div>
  </main>
  <footer class="site-footer">
    <p>&copy; ${new Date().getFullYear()} ${esc(siteTitle)}</p>
  </footer>
  <script src="assets/js/main.js"></script>
</body>
</html>`;
  await fs.writeFile(path.join(SITE_DIR, "index.html"), html, "utf8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!existsSync(DATA_FILE)) {
    console.error(`_data/gallery.json not found. Run "npm run compress" first.`);
    process.exit(1);
  }

  const tree      = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const siteTitle = "My Photography";

  // Clean + recreate _site
  await fs.rm(SITE_DIR, { recursive: true, force: true });
  await ensureDir(SITE_DIR);

  // Copy static assets
  await copyDir(path.join(ROOT, "assets"), path.join(SITE_DIR, "assets"));

  // Copy images (thumbs for display, fulls for lightbox)
  await copyDir(path.join(ROOT, "images"), path.join(SITE_DIR, "images"));

  // Generate pages
  await writeIndexPage(siteTitle);
  await writeGalleryPage(tree, tree, siteTitle, true);

  // Count pages written
  let pageCount = 1; // index
  function countPages(node) { pageCount++; node.folders.forEach(countPages); }
  countPages(tree);

  console.log(`Built ${pageCount} pages → _site/`);
  console.log(`Run "npm start" to preview at http://localhost:3000`);
}

main().catch(err => { console.error(err); process.exit(1); });
