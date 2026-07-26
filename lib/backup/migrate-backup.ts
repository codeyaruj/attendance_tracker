import { z } from "zod";
import { BackupError } from "./backup-errors";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  attendSafeBackupSchema,
  backupHeaderSchema,
  legacyBackupV1Schema,
  legacyBackupV2Schema,
  type AttendSafeBackupFile,
} from "./schema";

export interface MigratedBackup {
  backup: AttendSafeBackupFile;
  sourceVersion: number;
  warnings: string[];
}

function schemaFailure(error: z.ZodError): BackupError {
  const issues = error.issues.slice(0, 100);
  const first = issues[0];
  return new BackupError(
    "SCHEMA_INVALID",
    first
      ? `Invalid backup field ${first.path.join(".") || "$"}: ${first.message}`
      : "The backup does not match the required schema.",
    {
      path: first?.path.join("."),
      details: issues
        .map((issue) => `${issue.path.join(".") || "$"}: ${issue.message}`)
        .join("\n"),
    },
    { cause: error },
  );
}

function finalizeMigration(
  data: z.infer<typeof legacyBackupV2Schema>["data"],
  exportedAt: string,
): AttendSafeBackupFile {
  const migrated = {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt,
    appVersion: "0.1.0",
    data: {
      ...data,
      electiveGroups: data.electiveGroups.map((group) => ({
        ...group,
        allowMultiple: group.allowMultiple ?? false,
      })),
      appSettings: data.appSettings.map((settings) => ({
        ...settings,
        includeZeroCredit: settings.includeZeroCredit ?? false,
        notificationsPrepared: false,
      })),
    },
  };
  const result = attendSafeBackupSchema.safeParse(migrated);
  if (!result.success) throw schemaFailure(result.error);
  return result.data;
}

export function migrateBackup(input: unknown): MigratedBackup {
  const header = backupHeaderSchema.safeParse(input);
  if (!header.success) {
    throw new BackupError(
      "INVALID_FORMAT",
      "This is not a recognized AttendSafe backup file.",
      {},
      { cause: header.error },
    );
  }

  if ("version" in header.data) {
    if (header.data.version !== BACKUP_FORMAT_VERSION) {
      throw new BackupError(
        "UNSUPPORTED_VERSION",
        `Backup version ${header.data.version} is not supported.`,
      );
    }
    const current = attendSafeBackupSchema.safeParse(input);
    if (!current.success) throw schemaFailure(current.error);
    const retiredNotifications = current.data.data.appSettings.some(
      (settings) => settings.notificationsPrepared,
    );
    return {
      backup: {
        ...current.data,
        data: {
          ...current.data.data,
          appSettings: current.data.data.appSettings.map((settings) => ({
            ...settings,
            notificationsPrepared: false,
          })),
        },
      },
      sourceVersion: BACKUP_FORMAT_VERSION,
      warnings: retiredNotifications
        ? [
            "Retired an obsolete reminder-preparation setting; no attendance data was changed.",
          ]
        : [],
    };
  }

  const sourceVersion = header.data.schemaVersion;
  if (sourceVersion === 1) {
    const legacy = legacyBackupV1Schema.safeParse(input);
    if (!legacy.success) throw schemaFailure(legacy.error);
    const timetableVersions = legacy.data.data.timetableVersions.map(
      (version) => {
        const copy = { ...version };
        delete copy.uploadedReferenceId;
        return copy;
      },
    );
    return {
      backup: finalizeMigration(
        {
          ...legacy.data.data,
          timetableVersions,
          uploadedTimetableReferences: [],
        },
        legacy.data.exportedAt,
      ),
      sourceVersion,
      warnings: [
        "Migrated legacy backup version 1. Original timetable source files were not part of that format.",
      ],
    };
  }
  if (sourceVersion === 2) {
    const legacy = legacyBackupV2Schema.safeParse(input);
    if (!legacy.success) throw schemaFailure(legacy.error);
    return {
      backup: finalizeMigration(legacy.data.data, legacy.data.exportedAt),
      sourceVersion,
      warnings: ["Migrated legacy backup version 2 to the current format."],
    };
  }
  throw new BackupError(
    "UNSUPPORTED_VERSION",
    `Backup version ${sourceVersion} is not supported.`,
  );
}

export function parseAndMigrateBackup(input: unknown): AttendSafeBackupFile {
  return migrateBackup(input).backup;
}
