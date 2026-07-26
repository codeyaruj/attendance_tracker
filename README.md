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
- Next.js static export for free static hosting, including Cloudflare Pages

## Run locally

Requirements: Node.js 22.13+ and pnpm 11.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

To test the responsive interface from a phone on the same local network:

```bash
pnpm dev:mobile
```

Open the computer's local-network address from the phone, such as `http://192.168.x.x:3000`. Do not hardcode or publicly expose this address. Both devices must use the same network, and the computer firewall may need to permit local incoming connections. Local HTTP is useful for responsive testing; installation, service workers, offline behavior, and production headers should be verified on the deployed HTTPS build.

Useful commands:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm test:e2e
pnpm test:e2e:responsive
pnpm test:e2e:cross-browser
pnpm test:pwa
pnpm build
pnpm verify
pnpm verify:release
```

The supported toolchain is Node.js 22.18 (22.13 or newer, but below 23) and pnpm 11.9.0. `pnpm verify` is the deterministic local quality/build gate; `pnpm verify:release` also performs frozen installation, audits, browser E2E, responsive, and production PWA checks. See [TESTING.md](TESTING.md) for scope and [CONTRIBUTING.md](CONTRIBUTING.md) before changing schemas, backups, or cache versions.

If Playwright has not downloaded Chromium on the machine yet:

```bash
pnpm exec playwright install chromium
```

## Free, local timetable extraction

Manual entry, pasted text, demo setup, and table-aware extraction work without secrets, accounts, APIs, or paid services. PNG, JPEG, WebP, and PDFs of up to 10 MB are read entirely inside the browser. Selectable PDFs use positioned PDF.js text first; scanned pages and images use local Canvas/typed-array grid detection before a reusable Tesseract.js worker reads individual cells. OCR recognizes text, while structural parsing independently detects table regions, boundaries, merged spans, headers, and legends.

The local pipeline:

- checks the extension, MIME type, file size, and magic bytes before expensive processing;
- rejects corrupt, encrypted, empty, oversized, or excessive-page PDFs;
- corrects browser-supported image orientation, bounds canvas dimensions and pixels, then applies deterministic greyscale, contrast, and mild sharpening;
- processes only one rendered page and one cell OCR job at a time;
- enforces page, word, cell, per-page time, and total time limits;
- supports cancellation and releases workers, canvases, object URLs, and PDF resources;
- detects horizontal and vertical grid structure before OCR, preserves raw cell text, and marks uncertain fields for user review;
- exposes a collapsible region/cell overlay, granular confidence, and a local JSON diagnostics download that omits image data;
- always opens the existing editable confirmation flow before IndexedDB is changed.

Local extraction is always attempted first. If it fails or produces an unusable result, the user may explicitly consent to send only the selected timetable image and bounded extraction hints to the same-origin AI fallback. Profiles, attendance, saved timetables, backups, and skip-planner data are never included. The original source file is stored in IndexedDB only after the user explicitly confirms the timetable, matching AttendSafe’s existing backup and reference behavior.

## Gemini timetable fallback

The optional fallback is a Cloudflare Pages Function at `POST /api/timetable/analyse`. It uses `@google/genai` only inside the Function, requests schema-constrained JSON, validates and normalises the response independently, and maps it into the existing editable timetable confirmation flow. No AI result is saved before confirmation, and builds, tests, local extraction, and manual entry do not require a Gemini key.

Create an ignored `.dev.vars` file in the repository root for local Pages development:

```text
GEMINI_API_KEY=PASTE_THE_REAL_KEY_HERE
GEMINI_MODEL=gemini-2.5-flash
```

`GEMINI_MODEL` is optional; the server defaults to `gemini-2.5-flash`. Run the static app and Pages Function together with:

```bash
pnpm dev:pages
```

Ordinary `pnpm dev` serves the Next.js client but does not execute the root Pages Function. Automated tests inject or route mocked provider responses and never contact Google. Function error codes include `AI_NOT_CONFIGURED`, `AI_RATE_LIMITED`, `AI_TIMEOUT`, `AI_PROVIDER_ERROR`, `AI_INVALID_RESPONSE`, `IMAGE_TOO_LARGE`, and `NO_TIMETABLE_DETECTED`.

Common fallback errors:

- `AI_NOT_CONFIGURED`: add `GEMINI_API_KEY` to `.dev.vars`, or add it as an encrypted Cloudflare Pages secret for the relevant Production/Preview environment and redeploy.
- `AI_RATE_LIMITED`: inspect Gemini usage and Cloudflare request volume, then wait or adjust the applicable quota/protection.
- `AI_TIMEOUT` or `AI_PROVIDER_ERROR`: check the Pages Function logs and provider status, then retry manually; AttendSafe never retries automatically.
- `AI_INVALID_RESPONSE`: the provider returned data that failed the shared schema or logical validation; retry or use manual entry.
- `IMAGE_TOO_LARGE`: choose a JPEG, PNG, or WebP image no larger than 8 MiB.
- `NO_TIMETABLE_DETECTED`: use a clearer crop/image or enter the schedule manually.

`pnpm install`, `pnpm dev`, and `pnpm build` prepare self-hosted worker assets under `public/ocr-assets/`. The generated assets are approximately 17 MB: about 12 MB of Tesseract core variants, a 2.8 MB compressed English model, a 2.1 MB PDF.js worker, and a 128 KB Tesseract worker. They are fetched from the same application origin and cached only when extraction first needs them. No OpenCV dependency was added: structural vision is compiled application code using Canvas and typed arrays. The first timetable scan therefore requires internet access; later scans can work offline after every required OCR/PDF asset has downloaded successfully.

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

Manual creation adds one subject at a time. Every chosen weekday owns one or more independent start/end ranges, so a subject can meet at different times across the week or twice on one day. A weekly preview and conflict check run before the sessions enter the draft. Saved edits create an immutable effective-dated timetable version; one-off extras, cancellations, reschedules, and room/faculty changes remain dated academic exceptions. Existing attendance therefore stays attached to the session and version against which it was recorded.

Attendance calculations in `lib/attendance/` use integer counts and basis points. Threshold comparisons use exact fraction arithmetic, avoiding floating-point decisions at boundary values.

For a threshold `T` stored in basis points, the engine compares `attended × 10,000` with `held × T`. The current percentage is `attended / held`; no percentage is returned when `held` is zero. The maximum additional skips are `floor((attended × 10,000) / T − held)`, and recovery attendance is `ceil((T × held − attended × 10,000) / (10,000 − T))`, with explicit handling for zero and 100% thresholds.

## Backup and recovery

Settings provides:

- full or profile-scoped, version 3 JSON export;
- strict import of current version 3 backups and explicit migration of legacy versions 1 and 2;
- a bounded 5 MB local import pipeline with record, nesting, string, array, and embedded-file limits;
- a preview showing record counts and migration warnings before any write;
- replace-only import after typing `REPLACE`, applied across every table in one rollback-safe Dexie transaction;
- upload Blob serialization in the backup format;
- per-subject CSV export;
- attendance-only reset, semester reset, profile deletion, and full app reset with typed confirmations.

Backups are created and imported entirely in the browser and are never uploaded. They may contain sensitive attendance information and confirmed original timetable images/PDFs, so store them securely. Embedded sources are limited to 2 MB each and 5 MB decoded in total; the complete JSON backup must fit within 5 MB.

Import replaces all existing AttendSafe data on the current origin; merge is intentionally unsupported because ambiguous record conflicts could corrupt attendance history. Export current data before replacement. Validation and migration finish before confirmation, and a failed database write rolls the entire transaction back without leaving partial imported data.

If IndexedDB cannot open, the recovery screen can retry safely, export readable tables as a clearly labelled raw recovery file, or reset the database after typing `RESET`. Reset permanently deletes local data and is never automatic. See [the backup architecture guide](docs/backup-format.md) for schema and migration maintenance.

Backups are the portability mechanism. Clearing browser storage, using private browsing, removing the site’s data, or losing the device can remove IndexedDB data, so export a JSON backup periodically.

## PWA and offline behavior

`app/manifest.ts`, `public/sw.js`, and purpose-built icons provide installability and app-shell caching. The worker uses versioned, positive allowlists:

- known navigation routes use network-first with a cached shell fallback;
- immutable Next.js and icon assets use cache-first;
- locally hosted OCR/PDF worker, WASM, and language files cache on first use;
- API paths, unknown routes, backups, attachments, non-GET requests, failed/opaque responses, and responses marked `private` or `no-store` are never cached.

Uploaded images, PDFs, object URLs, data URLs, backups, and other user-generated files never enter Cache Storage. IndexedDB is not cleared during worker installation, activation, updates, or offline-cache clearing. Waiting updates show an explicit **Update now / Later** notice and will not activate while OCR, backup import/export, or database recovery is active.

After the application shell has been cached, timetable viewing/editing, attendance marking, calculations, and JSON backup generation continue offline. A first visit and the first OCR asset download still need a connection. If a required resource was not cached completely, reconnect and retry.

### Install on Android or desktop Chromium

Open the deployed HTTPS site and use AttendSafe's **Install app** action when the browser offers it, or use the browser menu's installation command. The action is hidden in an installed standalone window and can be dismissed.

### Install on iPhone or iPad

Open the deployed HTTPS site in Safari, choose **Share**, then **Add to Home Screen**. iOS does not consistently provide the same install-prompt event as Chromium, so AttendSafe displays concise dismissible guidance when appropriate.

Installation does not create an account, enable cloud sync, or copy records from another browser/device.

## Storage, transfer, and notifications

Settings reports approximate origin usage/quota and whether the browser granted persistent storage. Persistence is requested only after the user selects **Protect local data**, never on initial load. A grant only reduces automatic eviction risk; it cannot protect against clearing browser data, browser removal, private-browsing cleanup, hardware loss, or device failure.

Data is isolated per browser profile and device. To transfer it for free:

```text
Old device: export a JSON backup
        ↓
Store or transfer that sensitive file securely
        ↓
New device: open AttendSafe and import the backup
```

There is no automatic cloud sync. The app cannot verify that a downloaded backup was retained. **Clear downloaded app files** removes only AttendSafe's service-worker caches; it does not remove IndexedDB attendance, timetable, settings, or backup metadata.

Attendance reminders have been removed because there is no reliable scheduler, push subscription, or closed-browser delivery. AttendSafe never requests notification permission on startup and does not claim that notifications work after the browser is closed.

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

## Static export and Cloudflare Pages

`next.config.ts` enables `output: "export"`, trailing slashes, and unoptimized images. Create and independently serve the deployable output with:

```bash
NEXT_PUBLIC_SITE_URL=https://your-project.pages.dev pnpm build
pnpm start
```

The complete static site is written to `out/`; Cloudflare Pages serves it together with the root `functions/` route. There are no Next.js API routes, server actions, sessions, or cloud database bindings. The optional Function is invoked only after explicit AI consent.

Cloudflare Pages configuration:

1. Push this repository to GitHub.
2. Create a free Cloudflare Pages project and connect the repository.
3. Set the build command to `pnpm build`.
4. Set the output directory to `out`.
5. Set `NEXT_PUBLIC_SITE_URL` to the project's public HTTPS URL, including a generated `pages.dev` URL when no custom domain is used.
6. Add the encrypted `GEMINI_API_KEY` secret to Production (and separately to Preview if desired). Optionally set the non-secret `GEMINI_MODEL` variable.
7. Deploy and verify route refreshes, `/api/timetable/analyse`, installability, offline loading, OCR/PDF workers, and headers at the generated HTTPS address.

The application remains usable without the optional Gemini secret; the Function returns `AI_NOT_CONFIGURED` while every local feature continues working. `NEXT_PUBLIC_SITE_URL` is build-time metadata only. If it is missing from a production build, AttendSafe omits the metadata base instead of embedding localhost.

Use one permanent origin for real records. `localhost`, preview deployments, the permanent `pages.dev` hostname, a custom domain, different browsers, and different devices each have separate IndexedDB storage. Changing any of them does not migrate data; export a backup before moving.

Repository and operational details are documented in [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), and the [release checklist](docs/RELEASE_CHECKLIST.md).

Architecture:

```text
GitHub repository
        ↓
Static Next.js build
        ↓
Cloudflare Pages over HTTPS
        ↓
Mobile or desktop browser
        ↓
Installed PWA
        ↓
Local OCR + IndexedDB
        ↓
JSON export/import for device transfer
```

## Production security headers

Cloudflare Pages copies `public/_headers` into `out/_headers`. It defines CSP, clickjacking protection, MIME-sniffing protection, referrer and permissions policies, HSTS, cross-origin opener isolation, and a no-cache policy for `sw.js`.

The CSP is intentionally same-origin. Next.js currently requires `'unsafe-inline'` for its generated inline bootstrap scripts and styles. Tesseract's local WASM requires the narrower `'wasm-unsafe-eval'`; ordinary `'unsafe-eval'`, wildcard sources, arbitrary HTTPS sources, and third-party script providers are not allowed. `worker-src 'self' blob:` is needed by Tesseract's local worker, while `img-src 'self' data: blob:` supports local previews without uploading them.

Inspect a production build locally with:

```bash
pnpm build
pnpm start
```

## Security boundaries

- There is no account system and no central attendance database.
- IndexedDB is isolated to the browser origin, not encrypted independently by the app.
- Do not treat browser storage as a substitute for a backup.
- Timetable OCR and PDF rendering use self-hosted browser assets and have no server extraction path.
- Backup parsing, migration, validation, preview, and import are local-only; backups are never sent to a server.
- Destructive data operations require explicit confirmation and repository-level confirmation flags.

## Known limitations

- AttendSafe has no account or cloud-sync layer; profiles and attendance are scoped to one browser origin and device.
- Extraction accuracy depends on image quality, table layout, fonts, and browser resources. Strong perspective distortion, handwriting, borderless layouts, rotated cell text, dense electives, and ambiguous abbreviations may require substantial manual correction. The diagnostic overlay helps distinguish grid-detection, OCR, and parsing errors; it is not a claim of certainty.
- Local OCR is CPU- and memory-intensive. Files are bounded to 10 MB, PDFs to five pages, rendered canvases to four million pixels, and extraction to one page/job at a time.
- Browsers may evict site storage under device pressure. JSON backups are the durable portability and recovery mechanism; backups containing source-image blobs can be comparatively large.
- Offline use is available after a successful production visit has warmed the application shell. OCR works offline only after its first complete asset download.
- Safari/WebKit, Firefox, Chromium, Android PWAs, and iOS home-screen apps differ in install prompting, storage quotas, persistence decisions, and service-worker lifecycle timing. Feature detection is used, but identical behavior cannot be guaranteed.
- Persistent storage is never guaranteed. iOS may remove home-screen site data under platform-specific conditions, and private browsing is unsuitable for durable records.
- Future skip projections assume the confirmed timetable, future sessions, and attendance policy remain unchanged over the simulated period.
