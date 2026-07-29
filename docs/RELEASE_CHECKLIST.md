# Release checklist

## Repository and quality

- [ ] Worktree contains only intended source/configuration changes.
- [ ] `pnpm install --frozen-lockfile` succeeds on Node 22/pnpm 11.9.
- [ ] `pnpm verify:release` succeeds; coverage does not regress.
- [ ] Dependency audit completed; every exception is current and documented.
- [ ] Tracked source and reachable Git history passed the redacted secret scan.
- [ ] No personal data, backups, uploads, local database, report, trace, or environment file is tracked.

## Data integrity and privacy

- [ ] Schema migrations preserve profiles, timetable, attendance, and settings.
- [ ] Database failure shows recovery without automatic reset.
- [ ] Every reset requires its exact destructive confirmation.
- [ ] Valid backup export/import succeeds; invalid and failed imports preserve current data.
- [ ] Attendance, timetable, upload, OCR output, and backups make no remote write.
- [ ] Persistence denial is explained and does not block normal use.

## Mobile, accessibility, and browsers

- [ ] Chromium desktop/mobile, Firefox, WebKit, and responsive projects pass.
- [ ] Axe checks pass; keyboard, focus, zoom, contrast, safe areas, and screen reader behavior receive manual review.
- [ ] Camera/image/PDF flows are checked on a physical phone with synthetic material.
- [ ] Android/desktop install is checked on a real supported device/browser.
- [ ] Safari Share → Add to Home Screen is checked on an iPhone and iPad.
- [ ] Embedded-browser and unsupported-browser guidance is accurate.

## PWA and offline

- [ ] Manifest/icons resolve from the permanent HTTPS origin.
- [ ] First online load becomes service-worker controlled.
- [ ] `out/sw.js`, `out/version.json`, and the compiled client share the deployed commit build ID.
- [ ] Subjects, timetable, attendance viewing/writes, settings, and backup export work offline.
- [ ] Reload, close/reopen, cache deletion, and a real two-deployment worker update preserve IndexedDB.
- [ ] Waiting-worker and version-mismatch updates prompt on setup and local-data routes; Later resurfaces on a later check.
- [ ] Critical attendance/timetable/OCR/backup/recovery work delays activation and reload.
- [ ] Cache Storage contains static assets only; unrelated caches survive migration.
- [ ] First-use OCR asset/network limitation is communicated.

## Cloudflare Pages deployment

- [ ] Production build command is `pnpm build`; output is `out`.
- [ ] `NEXT_PUBLIC_SITE_URL` is the permanent HTTPS origin, never a preview URL.
- [ ] `pnpm verify:static`, `verify:security`, and `verify:assets` pass.
- [ ] Deployed CSP, framing, MIME, referrer, permissions, and HSTS headers are inspected.
- [ ] Direct refresh of every route succeeds; no Node server/API/backend/paid service is required.
- [ ] Branch protection is enabled manually with required CI checks, resolved conversations, and no force pushes.
