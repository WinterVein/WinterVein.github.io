#!/usr/bin/env node
/**
 * server.js  —  zero-dependency static file server
 * Serves everything inside _site/ at http://localhost:3000
 * No npm packages required beyond what's already installed.
 */

import http from "node:http";
import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR  = path.join(__dirname, "_site");
const PORT      = process.env.PORT || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png":  "image/png",
  ".webp": "image/webp",
  ".gif":  "image/gif",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".woff2":"font/woff2",
  ".woff": "font/woff",
};

const server = http.createServer((req, res) => {
  // Strip query strings
  let urlPath = req.url.split("?")[0];

  // Decode URI
  try { urlPath = decodeURIComponent(urlPath); } catch {}

  // Map to file path
  let filePath = path.join(SITE_DIR, urlPath);

  // Directory → try index.html
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  // 404 fallback
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`404 Not Found: ${urlPath}\n\nRun "npm run build" to generate the site first.`);
    return;
  }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";

  // Stream the file
  res.writeHead(200, { "Content-Type": mime });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`\n  Photo gallery running at http://localhost:${PORT}\n`);
  console.log(`  Press Ctrl+C to stop.\n`);
});
