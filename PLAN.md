# AttendSafe implementation plan

1. **Foundation** — configure the Next.js App Router project for pnpm, strict TypeScript, Tailwind, linting, Vitest, Playwright, and PWA assets; define the normalized timetable and local-first IndexedDB schemas.
2. **Domain layer** — implement exact basis-point attendance calculations, timetable filtering/session generation, skip-plan simulation and optimization, Zod validation, backup/import, CSV export, and demo seed data.
3. **Local-first application** — add the Dexie repository, multi-profile/semester state, onboarding (upload, manual, demo), confirmation, daily marking, history, exceptions, settings, and timetable editing.
4. **Product UI** — build the responsive mobile bottom navigation and desktop sidebar, Today, Dashboard, Timetable, Skip Planner, History, and Settings experiences with accessible controls, dark mode, offline feedback, errors, and toasts.
5. **Extraction and PWA** — add validated browser-only PDF/image OCR, coordinate-based timetable reconstruction, local upload reference handling, manifest, icons, and offline worker/model caching.
6. **Verification** — add thorough unit/integration and essential Playwright coverage, run lint/tests/build/E2E, fix failures, inspect every route and primary action, and finish the README and environment documentation.
