# AttendSafe

AttendSafe is a private, local-first personal attendance tracker. It turns a weekly timetable into day-by-day attendance records, exact subject projections, and clear answers to “what can I safely skip?”

The application is mobile-first, installable as a PWA, works offline after the app shell has been cached, and stores profiles, timetables, attendance, exceptions, settings, and uploaded timetable references in IndexedDB on the current device.

## Product highlights

- Read a timetable image or multi-page PDF locally in the browser, paste schedule text, build a timetable manually, or install the included demo.
- Review uncertain extraction results, batch alternatives, electives, class types, zero-credit subjects, and prior attendance before activation.
- Mark present, absent, exempt, not conducted, or cancelled from Today; use guarded bulk day actions and undo recent changes.
- View subject-level percentages, required thresholds, safety targets, recovery classes, skippable classes, and next-absence impact.
- Resolve timetable sessions lazily across version boundaries, odd/even/custom weeks, holidays, closures, cancellations, extra classes, and reschedules.
- Simulate one class, a whole day, selected classes, ranges, recurring weekdays, safest days/weeks, and per-subject skip limits before committing anything.
- Maintain multiple local profiles and semesters, per-subject policy overrides, batch/elective selection, class-type tracking, exceptions, and timetable versions.
- Export/import a validated versioned JSON backup and export attendance as per-subject CSV.
- Use light, dark, and system appearance with keyboard-accessible controls and responsive mobile/desktop navigation.

## Tech stack

- Next.js App Router, React, TypeScript, Tailwind CSS
- Dexie/IndexedDB for device-local persistence
- Zod for extraction, backup, and form-domain validation
- Tesseract.js and a self-hosted English model for browser-only OCR
- PDF.js for local, worker-based PDF rendering
- React Hook Form for structured onboarding forms
- date-fns and exact basis-point/BigInt attendance arithmetic
- Vitest + Testing Library for unit/integration tests
- Playwright for Chromium desktop and mobile E2E flows
- vinext/Cloudflare runtime for local preview and Sites deployment

## Run locally

Requirements: Node.js 22.13+ and pnpm 11.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Useful commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm build
```

If Playwright has not downloaded Chromium on the machine yet:

```bash
pnpm exec playwright install chromium
```

## Free, local timetable extraction

Manual entry, pasted text, demo setup, and OCR work without secrets, accounts, APIs, or paid services. PNG, JPEG, WebP, and PDFs of up to 10 MB can be read entirely inside the browser. PDFs are limited to five pages and are rendered sequentially with PDF.js. Tesseract.js runs OCR in a reusable Web Worker, retaining word coordinates so AttendSafe can conservatively reconstruct rows and columns.

The local pipeline:

- checks the extension, MIME type, file size, and magic bytes before expensive processing;
- rejects corrupt, encrypted, empty, oversized, or excessive-page PDFs;
- corrects browser-supported image orientation, bounds canvas dimensions and pixels, then applies deterministic greyscale, contrast, and mild sharpening;
- processes only one rendered page and one OCR job at a time;
- enforces page, word, cell, per-page time, and total time limits;
- supports cancellation and releases workers, canvases, object URLs, and PDF resources;
- groups OCR words by coordinates and marks uncertain timetable cells for user review;
- always opens the existing editable confirmation flow before IndexedDB is changed.

No upload or extraction API exists. Timetable files, rendered pages, and OCR output are never sent to a server. The original source file is stored in IndexedDB only after the user explicitly confirms the timetable, matching AttendSafe’s existing backup and reference behavior.

`pnpm install`, `pnpm dev`, and `pnpm build` prepare self-hosted worker assets under `public/ocr-assets/`. The generated assets are approximately 17 MB: about 12 MB of Tesseract core variants, a 2.8 MB compressed English model, a 2.1 MB PDF.js worker, and a 128 KB Tesseract worker. They are fetched from the same application origin and cached by the production service worker. A first successful online production visit is therefore required before OCR is fully available offline.

## Local data model

The normalized schema is defined in `types/domain.ts` and persisted through `db/`:

- profile and semester
- timetable and immutable timetable versions
- subjects and elective groups
- recurring timetable slots
- academic exceptions
- materialized class sessions and attendance records
- app settings, uploaded source references, and recent undo actions

Recurring timetable entries are not pre-expanded for the semester. `lib/timetable/` resolves only the requested date/range, selecting the correct confirmed timetable version and applying user filters, week recurrence, persisted overrides, and academic exceptions.

Attendance calculations in `lib/attendance/` use integer counts and basis points. Threshold comparisons use exact fraction arithmetic, avoiding floating-point decisions at boundary values.

For a threshold `T` stored in basis points, the engine compares `attended × 10,000` with `held × T`. The current percentage is `attended / held`; no percentage is returned when `held` is zero. The maximum additional skips are `floor((attended × 10,000) / T − held)`, and recovery attendance is `ceil((T × held − attended × 10,000) / (10,000 − T))`, with explicit handling for zero and 100% thresholds.

## Backup and recovery

Settings provides:

- full or profile-scoped JSON export;
- schema-validated merge import in the UI, with transactional replacement support in the repository layer;
- upload Blob serialization in the backup format;
- per-subject CSV export;
- attendance-only reset, semester reset, profile deletion, and full app reset with typed confirmations.

Backups are the portability mechanism. Clearing browser storage, using private browsing, removing the site’s data, or losing the device can remove IndexedDB data, so export a JSON backup periodically.

## PWA and offline behavior

`app/manifest.ts`, `public/sw.js`, and generated icons provide installability and app-shell caching. Navigation, local OCR assets, and cached static assets remain available offline after the first successful production visit; IndexedDB-backed timetable and attendance features do not depend on a network connection. Uploaded user files are never placed in the service-worker cache.

Browser notification preparation is optional and requires an explicit user action. Notifications remain best-effort because delivery semantics vary by browser and operating system.

## Project map

```text
app/                    App Router pages, metadata, and manifest
components/             Product surfaces, timetable import, and reusable UI
db/                     Dexie schema, migrations, repositories, undo services
hooks/                  Reactive local-data hooks
lib/attendance/         Exact attendance and skip-planning engine
lib/timetable/          Filtering, recurrence, conflicts, session resolution
lib/timetable-extraction/ Browser validation, PDF rendering, OCR, and coordinate parsing
lib/validation/         Zod schemas and extraction normalization
lib/backup/             Versioned JSON and CSV import/export
tests/                   Unit, integration, UI, and Playwright coverage
types/                   Normalized domain and draft types
```

## Deployment notes

Create and inspect the production bundle locally with:

```bash
pnpm build
pnpm start
```

The repository includes `.openai/hosting.json`, vinext, and a Cloudflare Worker entry for Sites. Publish the validated bundle through Sites; the recorded project can be reused on later deployments. No D1 or R2 binding is declared because device-local IndexedDB is the source of truth by design. Set `NEXT_PUBLIC_SITE_URL` for canonical social metadata in a deployed environment. Timetable extraction has no secrets or runtime service configuration.

## Security boundaries

- There is no account system and no central attendance database.
- IndexedDB is isolated to the browser origin, not encrypted independently by the app.
- Do not treat browser storage as a substitute for a backup.
- Timetable OCR and PDF rendering use self-hosted browser assets and have no server extraction path.
- Destructive data operations require explicit confirmation and repository-level confirmation flags.

## Known limitations

- AttendSafe has no account or cloud-sync layer; profiles and attendance are scoped to one browser origin and device.
- OCR accuracy depends on image quality, table layout, fonts, and browser resources. Merged cells, handwriting, unusual rotations, dense electives, and ambiguous abbreviations may require substantial manual correction.
- Local OCR is CPU- and memory-intensive. Files are bounded to 10 MB, PDFs to five pages, rendered canvases to four million pixels, and extraction to one page/job at a time.
- Browsers may evict site storage under device pressure. JSON backups are the durable portability and recovery mechanism; backups containing source-image blobs can be comparatively large.
- Offline use is available after a successful production visit has warmed the service-worker cache. Browser notification delivery remains best-effort and platform-dependent.
- Future skip projections assume the confirmed timetable, future sessions, and attendance policy remain unchanged over the simulated period.
