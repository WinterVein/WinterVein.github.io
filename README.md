# PHOTOLOGUE

Recursive folder photo gallery. Pure Node.js — no Ruby, no Jekyll.

---

## Setup

```bash
npm install
```

---

## Workflow

There are three scripts, each with a distinct job:

### Step 1 — Compress (run once, before uploading)

```bash
npm run compress
```

Walks `images/fulls/` recursively, compresses every JPEG to ≤ 999 KB
**without changing the resolution** (quality is reduced only as much as
needed), generates 500×500 square thumbnails into `images/thumbs/`
mirroring the same folder structure, and preserves all EXIF metadata
in both fulls and thumbs.

Skips files already under the target. Re-run with `--force` to reprocess.

```bash
node scripts/compress-images.mjs --force
node scripts/compress-images.mjs --max-kb=750
node scripts/compress-images.mjs --thumbs-only
```

### Step 2 — Build (run whenever you add/change photos)

```bash
npm run build
```

Runs `scan-images.mjs` (reads EXIF from every full, merges descriptions,
writes `_data/gallery.json`) then `build-site.mjs` (generates static HTML
into `_site/`). Does not touch the image files.

### Step 3 — Preview

```bash
npm start
```

Serves `_site/` at **http://localhost:3000**

---

## One-liner (scan + build + serve)

```bash
npm run dev
```

---

## Adding photos

1. Drop JPEGs into `images/fulls/` in any folder structure you like:
   ```
   images/fulls/
     ├── 2024/
     │   ├── Iceland/
     │   │   └── IMG_001.jpg
     │   └── Japan/
     │       └── DSC_002.jpg
     └── Street/
         └── portrait.jpg
   ```

2. Run `npm run compress` (first time / new photos only)
3. Run `npm run build`
4. Run `npm start`

---

## Captions / descriptions

Drop a `descriptions.json` file in any subfolder inside `images/fulls/`:

```json
{
  "IMG_001.jpg": "Golden hour over the Vatnajökull glacier.",
  "DSC_002.jpg": "Neon reflections, Shinjuku at 2am."
}
```

Re-running `npm run build` picks these up automatically. Hand-edits
made directly in `_data/gallery.json` are also preserved across rebuilds.

---

## Script responsibilities at a glance

| Script | Touches images? | Touches gallery.json? | When to run |
|---|---|---|---|
| `compress-images.mjs` | ✅ yes (in place) | ❌ no | Once, before upload |
| `scan-images.mjs` | ❌ no | ✅ yes (writes) | Every build |
| `build-site.mjs` | ❌ no | ❌ no (reads only) | Every build |

