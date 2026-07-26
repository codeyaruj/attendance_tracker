# Security policy

## Supported versions

Security fixes are applied to the current `main` branch and latest deployed static build. Older deployments and preview origins are not supported once replaced.

## Reporting a vulnerability

Do not open a public issue containing exploit details or personal data. Use GitHub private vulnerability reporting if it is enabled for this repository.

**Private reporting channel placeholder:** the maintainer must configure GitHub private vulnerability reporting before public launch. No security email address is currently published.

Include the affected commit/deployment, browser and operating system, reproduction steps using synthetic data, expected/actual behavior, and impact. Never attach a real timetable, attendance record, uploaded source, database export, backup, token, or identifying screenshot.

Security-sensitive areas include IndexedDB migrations and recovery, backup parsing/transactions, timetable file validation and OCR workers, service-worker/cache/update policy, install lifecycle, static export, production headers/CSP, dependencies, and secret handling.

## Dependency exception

`pnpm audit` currently reports `GHSA-mh99-v99m-4gvg` through the latest Next.js ESLint plugins (`minimatch@3` → `brace-expansion@1`). It is development-only, consumes repository-controlled lint globs, and is absent from `out/`. Forcing the incompatible v5 API breaks ESLint. The time-bounded exception is machine-readable in `security/dependency-audit-exceptions.json`; production dependencies must remain clean and every other high/critical finding fails `pnpm audit:dependencies`.
