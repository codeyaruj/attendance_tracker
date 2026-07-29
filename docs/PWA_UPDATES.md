# PWA application updates

AttendSafe uses two independent signals so an installed application does not remain on an old deployment:

1. every build embeds its build ID in the generated service worker, making the worker script revision unique; and
2. the running client compares its compiled build ID with the public, no-store `/version.json` manifest.

## Build identity and generated files

`pnpm generate:pwa` runs from both `predev` and `prebuild`. It reads `pwa/sw-template.js` and generates:

- `public/sw.js`;
- `public/version.json`; and
- `lib/pwa/build-info.ts`.

These small generated files are committed so a checkout remains inspectable and static-policy tests can validate them. Every local or Cloudflare build regenerates them, so they must not be edited directly. After a manual build-ID simulation, run `pnpm generate:pwa` without overrides to restore the checkout's Git-derived files.

Build-ID source order is:

1. `CF_PAGES_COMMIT_SHA`, [injected by Cloudflare Pages builds](https://developers.cloudflare.com/pages/configuration/build-configuration/#environment-variables);
2. `GITHUB_SHA`, `CI_COMMIT_SHA`, or `COMMIT_SHA` in other CI systems;
3. the current Git commit SHA; and
4. a deterministic SHA-256 digest of application source when Git metadata is unavailable.

The ID is sanitised and limited to 32 characters. `builtAt` is diagnostic metadata based on `SOURCE_DATE_EPOCH`, the Git commit date, or the current time; it is never the update identity.

## Detection and activation

The client registers `/sw.js` with `updateViaCache: "none"`. It checks the worker and `/version.json` on launch, on visible/foreground return, on the browser's `online` event, and every 45 minutes while open. Concurrent checks are deduplicated.

A waiting worker or manifest mismatch displays **A new version is available** on every route, including setup. **Later** hides the prompt until the next lifecycle check. **Update now** sends `SKIP_WAITING` only after critical attendance, timetable, OCR, backup, recovery, or unsaved-form work has finished. `controllerchange` reloads each tab once; a short session guard prevents loops if an edge cache briefly serves inconsistent release files.

The new worker installs a complete shell before it can wait. Its caches are named with the build ID. Activation removes only obsolete `attendsafe-shell-*`, `attendsafe-static-*`, and `attendsafe-ocr-*` caches. It never accesses IndexedDB, local storage, attendance, timetable, settings, or backup data.

Navigations are network-first with a cached route/shell fallback. Hashed Next.js chunks are cache-first in the current build cache. `/sw.js` and `/version.json` are never intercepted by the worker and receive `no-cache, no-store, must-revalidate` HTTP headers.

## Local two-build verification

Use Chromium in a clean test profile and two terminals:

1. Build version A:

   ```bash
   CF_PAGES_COMMIT_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa pnpm build
   pnpm start
   ```

2. Open `http://localhost:3000`, wait for service-worker control, optionally install the app, load the demo, and mark one class.
3. Without clearing site data or uninstalling, build version B in the same checkout from the second terminal:

   ```bash
   CF_PAGES_COMMIT_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb pnpm build
   ```

4. Return the installed app to the foreground, or switch away and back. Confirm the update prompt appears.
5. Select **Update now**. Confirm the app reloads once and the marked attendance still exists.
6. In DevTools → Application, confirm the active worker source contains the B ID and only B-namespaced AttendSafe caches remain.
7. Restore checkout-generated metadata:

   ```bash
   pnpm generate:pwa
   ```

The static server reads files from `out/` per request, so it does not need a restart after version B finishes building. Do not foreground the test app while the output directory is still being replaced.

The automated production-PWA suite uses a deterministic harness rather than mutating a live Cloudflare deployment: it supplies a build-B version manifest and installs an alternate same-scope worker revision, then exercises the real prompt, `SKIP_WAITING`, `controllerchange`, one reload, cache cleanup, offline shell, and IndexedDB retention. The compiled application bundle is not swapped inside that single test server; the two-build manual procedure above covers that final deployment boundary.

## Diagnosing a stale installed app

Check `/version.json?t=<timestamp>` and the active worker's source in browser DevTools. Their build IDs should match the deployed commit; the compiled build ID appears in the generated client module. Confirm `/sw.js` and `/version.json` responses have the no-store policy and that the browser is online long enough for the new worker to cache the complete shell. A failed update remains retryable and never requires clearing IndexedDB or reinstalling as the normal recovery path.
