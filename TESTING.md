# Testing AttendSafe

## Test layers

- `pnpm test`: Vitest unit, UI integration, real fake-IndexedDB schema/migration, repository, backup security/rollback, timetable, attendance, and OCR orchestration/parser tests.
- `pnpm test:coverage`: the same suite with enforced global thresholds. Security-critical files remain included.
- `pnpm test:e2e`: isolated desktop and mobile Chromium flows using real browser IndexedDB.
- `pnpm test:e2e:responsive`: focused 320, 375, 390, 412, and 768 CSS-pixel checks.
- `pnpm test:e2e:cross-browser`: Chromium, Firefox, and WebKit core flows.
- `pnpm test:accessibility`: Axe checks plus existing keyboard/dialog assertions. Manual screen-reader, zoom, motion, touch, and real-device contrast checks remain required.
- `pnpm test:pwa`: a production static build, real service worker, offline shell/data writes, cache isolation, retention, backup, manifest, icon, and header checks.

`pnpm verify` runs formatting, lint, type checking, unit tests, coverage, static build, output validation, security regression checks, and asset budgets. `pnpm verify:release` adds frozen installation, dependency/secret scans, all Playwright projects, responsive checks, and production PWA tests.

## Isolation and determinism

Tests use synthetic stable IDs/names, fixed dates, controlled browser clocks, fresh contexts, reset IndexedDB/Cache Storage/localStorage where appropriate, and no remote OCR/network dependency. Avoid arbitrary sleeps, shared profiles, current-locale assertions, and unstable CSS selectors. Browser tests should fail on unexpected page/console/service-worker errors; document any narrowly allowed browser message.

Date logic must cover month/year boundaries, leap day, local midnight, and a DST-sensitive timezone when that behavior changes. Object URLs, workers, timers, database connections, and mocks must be released after each test.

## Coverage policy

Global minimums are 70% statements, 61% branches, 72% functions, and 71% lines, based on the measured baseline. Database, migrations, backup validation/transactions, OCR orchestration, service-worker policy, persistence, installation, recovery, and release-verification code should trend toward 80% statements/functions/lines and 75% branches; new uncovered high-risk paths require justification.

Playwright emulation does not prove native Android installation or iOS Add to Home Screen. Those, storage persistence grants, Safari private-mode behavior, physical camera capture, screen readers, and deployed Cloudflare header behavior require the manual release checklist.
