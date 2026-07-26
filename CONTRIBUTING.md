# Contributing

## Prerequisites and setup

- Node.js 22.18.0 (supported range `>=22.13 <23`)
- pnpm 11.9.0
- Playwright browsers for E2E work

Run `pnpm install --frozen-lockfile`, `pnpm dev`, and before opening a pull request, `pnpm verify`. Use a short-lived branch, focused commits, and a pull request into `main`; do not force-push shared branches.

## Standards and tests

Use strict TypeScript, existing components and repository operations, accessible controls, and Prettier/ESLint. Writes must be validated, awaited, and reported successful only after their transaction completes. New behavior needs deterministic unit/integration tests and focused Playwright coverage where browser APIs matter. Fixtures must be synthetic: never add real names, institutions, timetables, attendance, images, backups, email addresses, tokens, or device paths.

Run the smallest relevant tests during development and `pnpm verify:release` for release candidates. See `TESTING.md` for isolation, coverage, browser, offline, and manual-accessibility expectations.

pnpm 11 requires every dependency lifecycle script to be classified under `allowBuilds` in `pnpm-workspace.yaml`. `sharp` and `unrs-resolver` are allowed because their install steps prepare required binaries; `tesseract.js` is deliberately denied because its postinstall only displays an optional funding message and browser OCR uses the packaged worker, WASM, and language assets. Review every new lifecycle script before allowing it, then run `pnpm ignored-builds` after dependency changes.

## Durable format changes

- **IndexedDB:** never edit a released schema in place. Increment `DATABASE_SCHEMA_VERSION`, append `version(n).stores(...)`, use a transactional upgrade, preserve optional legacy fields, and add migration/reopen/failure tests.
- **Backups:** increment the backup version independently, update the canonical strict schema and migration path, retain rejection of unknown future versions, and test rollback plus legacy compatibility.
- **Service worker:** increment `CACHE_VERSION` when cached output changes materially. Keep positive allowlists, delete only obsolete owned caches, and run production PWA retention tests.

Pull requests must describe security, schema/migration, backup, service-worker, installation, mobile, and accessibility impact. Review generated output and dependency changes; `out/`, OCR copies, reports, traces, local databases, and user exports must not be committed.

## Recommended `main` protection

Configure this manually in GitHub: require pull requests and all CI jobs, require conversation resolution, block force pushes and branch deletion, and enable Dependabot alerts, secret scanning, and private vulnerability reporting where the repository plan supports them. Signed commits and linear history are optional. This repository configuration documents the recommendation; it does not assert that GitHub branch protection is already enabled.
