import Dexie, {
  type DexieOptions,
  type Table,
  type TransactionMode,
} from "dexie";

import type {
  AcademicException,
  AppSettings,
  AttendanceRecord,
  ClassSession,
  ElectiveGroup,
  Profile,
  RecentAction,
  Semester,
  Subject,
  Timetable,
  TimetableSlot,
  TimetableVersion,
  UploadedTimetableReference,
} from "@/types/domain";

import {
  DATABASE_NAME,
  SCHEMA_V1,
  SCHEMA_V2,
  SCHEMA_V3,
  TABLE_NAMES,
  defaultAppSettings,
  migrateProfileDefaults,
  migrateSlotDefaults,
  migrateSubjectDefaults,
  type AttendSafeTableName,
} from "./schema";

export class IndexedDBUnavailableError extends Error {
  readonly code = "INDEXEDDB_UNAVAILABLE";

  constructor(message = "This browser does not provide IndexedDB storage.") {
    super(message);
    this.name = "IndexedDBUnavailableError";
  }
}

export class IndexedDBCorruptionError extends Error {
  readonly code = "INDEXEDDB_CORRUPT";
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(
      "AttendSafe could not open its local database. The stored data may be corrupt or inaccessible.",
    );
    this.name = "IndexedDBCorruptionError";
    this.cause = cause;
  }
}

export class IndexedDBQuotaError extends Error {
  readonly code = "INDEXEDDB_QUOTA_EXCEEDED";
  readonly cause: unknown;

  constructor(cause: unknown) {
    super("The device does not have enough storage space to save this change.");
    this.name = "IndexedDBQuotaError";
    this.cause = cause;
  }
}

export interface DatabaseHealth {
  status: "READY" | "UNAVAILABLE" | "CORRUPT" | "QUOTA_EXCEEDED";
  error?: Error;
}

export class AttendSafeDatabase extends Dexie {
  profiles!: Table<Profile, string>;
  semesters!: Table<Semester, string>;
  timetables!: Table<Timetable, string>;
  timetableVersions!: Table<TimetableVersion, string>;
  subjects!: Table<Subject, string>;
  electiveGroups!: Table<ElectiveGroup, string>;
  timetableSlots!: Table<TimetableSlot, string>;
  academicExceptions!: Table<AcademicException, string>;
  classSessions!: Table<ClassSession, string>;
  attendanceRecords!: Table<AttendanceRecord, string>;
  appSettings!: Table<AppSettings, AppSettings["id"]>;
  uploadedTimetableReferences!: Table<UploadedTimetableReference, string>;
  recentActions!: Table<RecentAction, string>;

  constructor(name = DATABASE_NAME, options?: DexieOptions) {
    super(name, options);

    this.version(1).stores(SCHEMA_V1);

    this.version(2)
      .stores(SCHEMA_V2)
      .upgrade(async (transaction) => {
        const now = new Date().toISOString();
        await transaction
          .table<Profile, string>("profiles")
          .toCollection()
          .modify(migrateProfileDefaults);
        await transaction
          .table<Subject, string>("subjects")
          .toCollection()
          .modify(migrateSubjectDefaults);
        const settings = transaction.table<AppSettings, AppSettings["id"]>(
          "appSettings",
        );
        const existing = await settings.get("app");
        if (existing) {
          const defaults = defaultAppSettings(now);
          await settings.put({
            ...defaults,
            ...existing,
            trackedClassTypes: {
              ...defaults.trackedClassTypes,
              ...existing.trackedClassTypes,
            },
            updatedAt: existing.updatedAt || now,
          });
        }
      });

    this.version(3)
      .stores(SCHEMA_V3)
      .upgrade(async (transaction) => {
        await transaction
          .table<TimetableSlot, string>("timetableSlots")
          .toCollection()
          .modify(migrateSlotDefaults);
        await transaction
          .table<ElectiveGroup, string>("electiveGroups")
          .toCollection()
          .modify((group) => {
            group.options ??= [];
            group.selectedSubjectIds ??= [];
          });
      });
  }
}

export function isIndexedDBSupported(): boolean {
  return (
    typeof globalThis !== "undefined" &&
    typeof globalThis.indexedDB !== "undefined" &&
    typeof globalThis.IDBKeyRange !== "undefined"
  );
}

let databaseSingleton: AttendSafeDatabase | undefined;

/** Lazily creates the browser database; importing this module during SSR is safe. */
export function getAttendSafeDatabase(): AttendSafeDatabase {
  if (!isIndexedDBSupported()) {
    throw new IndexedDBUnavailableError();
  }
  databaseSingleton ??= new AttendSafeDatabase();
  return databaseSingleton;
}

export function setDatabaseForTesting(
  database: AttendSafeDatabase | undefined,
): void {
  databaseSingleton?.close();
  databaseSingleton = database;
}

function errorName(error: unknown): string | undefined {
  if (error instanceof Error) return error.name;
  if (typeof error === "object" && error !== null && "name" in error) {
    const name = Reflect.get(error, "name");
    return typeof name === "string" ? name : undefined;
  }
  return undefined;
}

export function normalizeDatabaseError(error: unknown): Error {
  if (
    error instanceof IndexedDBUnavailableError ||
    error instanceof IndexedDBCorruptionError ||
    error instanceof IndexedDBQuotaError
  ) {
    return error;
  }

  const name = errorName(error);
  if (name === "QuotaExceededError") return new IndexedDBQuotaError(error);
  if (
    name === "DatabaseClosedError" ||
    name === "InvalidStateError" ||
    name === "UnknownError" ||
    name === "UpgradeError" ||
    name === "VersionError"
  ) {
    return new IndexedDBCorruptionError(error);
  }
  return error instanceof Error ? error : new Error("Unknown database error");
}

export async function checkDatabaseHealth(
  database?: AttendSafeDatabase,
): Promise<DatabaseHealth> {
  if (!database && !isIndexedDBSupported()) {
    return { status: "UNAVAILABLE", error: new IndexedDBUnavailableError() };
  }

  try {
    const db = database ?? getAttendSafeDatabase();
    await db.open();
    await db.profiles.limit(1).count();
    return { status: "READY" };
  } catch (cause) {
    const error = normalizeDatabaseError(cause);
    if (error instanceof IndexedDBQuotaError) {
      return { status: "QUOTA_EXCEEDED", error };
    }
    if (error instanceof IndexedDBUnavailableError) {
      return { status: "UNAVAILABLE", error };
    }
    return {
      status: "CORRUPT",
      error:
        error instanceof IndexedDBCorruptionError
          ? error
          : new IndexedDBCorruptionError(error),
    };
  }
}

/**
 * Recovery is intentionally explicit because deleting a corrupt database loses
 * local data. UI callers must obtain confirmation before invoking this helper.
 */
export async function deleteLocalDatabaseAfterConfirmation(
  database: AttendSafeDatabase,
  confirmed: boolean,
): Promise<void> {
  if (!confirmed) {
    throw new Error("Database deletion requires explicit confirmation.");
  }
  database.close();
  await database.delete();
  if (databaseSingleton === database) databaseSingleton = undefined;
}

export async function retryDatabaseConnection(): Promise<DatabaseHealth> {
  databaseSingleton?.close();
  databaseSingleton = undefined;
  return checkDatabaseHealth();
}

export async function resetCorruptDatabase(
  confirmationText: string,
): Promise<void> {
  if (confirmationText !== "RESET") {
    throw new Error('Type "RESET" to confirm deletion of all local data.');
  }
  const database = databaseSingleton ?? getAttendSafeDatabase();
  await deleteLocalDatabaseAfterConfirmation(database, true);
}

export async function runDatabaseTransaction<T>(
  database: AttendSafeDatabase,
  mode: TransactionMode,
  tableNames: readonly AttendSafeTableName[],
  operation: () => T | PromiseLike<T>,
): Promise<T> {
  const invalidName = tableNames.find((name) => !TABLE_NAMES.includes(name));
  if (invalidName) throw new Error(`Unknown database table: ${invalidName}`);
  try {
    return await database.transaction(mode, tableNames, operation);
  } catch (error) {
    throw normalizeDatabaseError(error);
  }
}
