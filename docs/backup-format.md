# AttendSafe backup and recovery architecture

## Canonical validation

Persisted domain records are defined once in `lib/validation/schemas.ts`. The backup envelope in `lib/backup/schema.ts` composes those exact schemas; it does not redefine profiles, semesters, subjects, timetable slots, exceptions, sessions, attendance, settings, or undo records.

All canonical objects are strict. Unknown keys, missing required fields, unexpected nulls, invalid enums, impossible calendar dates, invalid local times, invalid ranges, subject-less ordinary slots, incomplete extra/rescheduled sessions, and invalid attendance records are rejected.

When adding a persisted entity:

1. Add its domain type and strict canonical schema.
2. Add the IndexedDB table through a new append-only database version.
3. Add the collection to `canonicalBackupDataSchema` with a realistic limit.
4. Export and import it in dependency order inside the existing transaction.
5. Extend `validateBackupRelationships` with duplicate and foreign-key checks.
6. Add current-format, migration, relationship, rollback, and recovery tests.

## Current format

The current format is version 3:

```json
{
  "format": "attendance-tracker-backup",
  "version": 3,
  "exportedAt": "2026-07-26T10:00:00.000Z",
  "appVersion": "0.1.0",
  "data": {}
}
```

Versions 1 and 2 remain supported through explicit sequential migration to version 3. Source-version data is never written directly. Each migration must validate its source schema, apply deterministic defaults, produce warnings, then pass the current canonical and relationship validation again. Increment `BACKUP_FORMAT_VERSION`, add a strict source schema and migration branch, and retain supported older migration tests when changing the format.

## Import pipeline

The browser-only import sequence is:

1. Check extension, MIME, emptiness, and the 5 MB file limit before reading.
2. Bound JSON text length before parsing.
3. Traverse parsed data iteratively to bound depth, object count, array sizes, and string sizes.
4. Validate the source envelope and version.
5. Migrate legacy data to the current format.
6. Run current canonical record validation.
7. Validate duplicate identifiers, ownership, foreign keys, occurrence uniqueness, semester dates, settings references, and embedded file sizes/signatures.
8. Show a user-readable preview and require the exact phrase `REPLACE`.
9. Decode bounded source files before writing.
10. Clear and insert all tables inside one Dexie transaction.

Only replace and cancel are supported. There is no ambiguous merge mode. Dexie rolls the transaction back if any clear or insertion fails, preserving the previous database.

## Embedded source files

Confirmed original timetable images/PDFs remain included for compatibility. Each source is limited to 2 MB and all decoded sources together to 5 MB. Base64 size is checked before allocation, allowed MIME types and magic bytes are validated, and the complete JSON export must still fit within 5 MB.

## Recovery

Database initialisation failures show a persistent recovery screen. Retry closes and reopens the connection without deleting data. Recoverable export reads tables independently and clearly labels an export as partial if any table fails. Destructive reset is never automatic and requires typing `RESET`; after deletion, AttendSafe returns to onboarding.

Raw recovery exports are diagnostic salvage files, not normal importable backups. Binary timetable sources are omitted from raw recovery files to keep recovery bounded and avoid representing incomplete blobs as valid backups.
