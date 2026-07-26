# AttendSafe architecture

AttendSafe is a static Next.js application exported to `out/`. Cloudflare Pages hosts only HTML, CSS, JavaScript, the manifest, icons, service worker, and self-hosted PDF.js/Tesseract.js resources. No application backend, account system, cloud database, server-side attendance storage, remote OCR, or paid runtime is present.

## Local data

The stable IndexedDB database is `attendsafe`. Dexie schema definitions and append-only migrations live in `db/schema.ts` and `db/database.ts`; UI code reaches them through the typed repository/service layer in `db/`. Profiles, semesters, timetables and versions, subjects, elective groups, slots, exceptions, sessions, attendance, settings, uploaded references, and undo metadata live in IndexedDB.

Small device-only presentation flags—theme, install-card dismissal, persistence-attempt state, and last generated-backup time—may use localStorage. They are not the primary database and losing them does not destroy attendance records.

Database failures produce a recovery state. Retry and readable-data export are non-destructive. Database deletion requires the user to type `RESET`; startup, migration, rendering, service-worker activation, and cache cleanup never reset IndexedDB.

## Data and processing flow

```text
Static Cloudflare Pages origin
        ↓ app files only
Browser / installed PWA
        ├─ Dexie → IndexedDB (personal records)
        ├─ backup validator → local JSON download/import
        ├─ Canvas table vision + PDF.js + Tesseract.js → local timetable review
        └─ service worker → Cache Storage (static files only)
```

Timetable extraction validates and bounds user files, then separates structural analysis from OCR. Selectable PDFs use positioned PDF.js text before raster work. Images and scanned PDFs become Canvas pixel buffers; adaptive thresholding, scale-relative horizontal/vertical line runs, intersection scoring, coordinate clustering, and separator continuity produce table regions, logical cells, and row/column spans. A single reusable Tesseract worker reads bounded cells with header/block page-segmentation modes. When no trustworthy grid exists, coordinate-aware full-page OCR remains an identified fallback.

The computer-vision implementation uses browser Canvas and typed arrays rather than OpenCV.js, so there is no additional WASM dependency or OpenCV asset setup. Detection metadata, transforms, timings, raw cell text, and granular confidence scores feed an optional diagnostic overlay/export. Files, pixels, text, and diagnostics stay in the browser. The user must review and explicitly confirm the draft before the existing repository transaction writes to IndexedDB.

Perspective handling is conservative: the outer grid is evaluated and an axis-aligned crop is retained when a safe projective warp cannot be established. Strong keystone distortion, curved pages, handwriting, borderless tables, rotated text, and dense nested legends can still require a straighter photo or manual correction; extraction is probabilistic, not authoritative.

## PWA and cache policy

The production client registers `/sw.js` once at root scope. Known navigation routes are network-first with shell fallback; immutable Next.js/icon assets are cache-first; OCR resources are cached on first use. Only caches with AttendSafe-owned prefixes are migrated or cleared. Non-GET, cross-origin, API-like, attachment, backup, blob/data URL, private, no-store, opaque, failed, and unknown responses are excluded.

Waiting workers require user approval. Activation can be delayed while OCR, backup, or recovery is active, and controller-change reloads are guarded against loops. Cache changes never touch IndexedDB.

## Installation and origin durability

Chromium uses the deferred `beforeinstallprompt` event. iPhone/iPad users receive Safari Share → Add to Home Screen instructions; embedded browsers direct users to the platform browser. Standalone display mode and iOS `navigator.standalone` hide install promotion.

IndexedDB is scoped to the exact origin and browser profile. Localhost, preview URLs, a permanent `pages.dev` URL, and a custom domain do not share data. Use one permanent production origin and JSON backup/export for every migration between domains, browsers, or devices.
