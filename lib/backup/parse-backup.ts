import {
  BACKUP_LIMITS,
  BACKUP_MAX_FILE_LABEL,
} from "@/lib/validation/backup-limits";
import { assertBoundedValue, parseBoundedJson } from "./bounded-json";
import { BackupError } from "./backup-errors";
import { migrateBackup } from "./migrate-backup";
import {
  createBackupPreview,
  type BackupImportPreview,
} from "./preview-backup";
import { validateBackupRelationships } from "./reference-validation";
import type { AttendSafeBackupFile } from "./schema";

export type BackupImportStage =
  | "VALIDATING_FILE"
  | "READING"
  | "PARSING"
  | "MIGRATING"
  | "VALIDATING_RECORDS"
  | "VALIDATING_RELATIONSHIPS"
  | "PREPARING_PREVIEW"
  | "IMPORTING";

export interface BackupImportProgress {
  stage: BackupImportStage;
  progress: number;
}

export interface PreparedBackupImport {
  backup: AttendSafeBackupFile;
  preview: BackupImportPreview;
}

export interface PrepareBackupOptions {
  signal?: AbortSignal;
  onProgress?: (progress: BackupImportProgress) => void;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new BackupError("IMPORT_CANCELLED", "Backup import was cancelled.");
  }
}

export function validateBackupFile(file: File): void {
  if (file.size === 0) {
    throw new BackupError("FILE_EMPTY", "The selected backup file is empty.");
  }
  if (file.size > BACKUP_LIMITS.maxFileBytes) {
    throw new BackupError(
      "FILE_TOO_LARGE",
      `Choose a backup no larger than ${BACKUP_MAX_FILE_LABEL}.`,
    );
  }
  if (!file.name.toLowerCase().endsWith(".json")) {
    throw new BackupError(
      "UNSUPPORTED_FILE",
      "Choose an AttendSafe backup with a .json extension.",
    );
  }
  if (
    file.type &&
    ![
      "application/json",
      "text/json",
      "text/plain",
      "application/octet-stream",
    ].includes(file.type)
  ) {
    throw new BackupError(
      "UNSUPPORTED_FILE",
      "The selected file is not identified as JSON.",
    );
  }
}

async function readFileText(file: File): Promise<string> {
  try {
    if (typeof file.text === "function") return await file.text();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error("Unexpected file reader result")),
      );
      reader.addEventListener("error", () => reject(reader.error));
      reader.readAsText(file);
    });
  } catch (cause) {
    throw new BackupError(
      "READ_FAILED",
      "The backup file could not be read on this device.",
      {},
      { cause },
    );
  }
}

export function prepareBackupValue(
  value: unknown,
  approximateBytes = 0,
  options: PrepareBackupOptions = {},
): PreparedBackupImport {
  throwIfCancelled(options.signal);
  assertBoundedValue(value);
  options.onProgress?.({ stage: "MIGRATING", progress: 0.55 });
  const migrated = migrateBackup(value);
  throwIfCancelled(options.signal);
  options.onProgress?.({ stage: "VALIDATING_RECORDS", progress: 0.7 });
  options.onProgress?.({
    stage: "VALIDATING_RELATIONSHIPS",
    progress: 0.8,
  });
  validateBackupRelationships(migrated.backup.data);
  throwIfCancelled(options.signal);
  options.onProgress?.({ stage: "PREPARING_PREVIEW", progress: 1 });
  return {
    backup: migrated.backup,
    preview: createBackupPreview(
      migrated.backup,
      migrated.sourceVersion,
      migrated.warnings,
      approximateBytes,
    ),
  };
}

export function prepareBackupText(
  json: string,
  options: PrepareBackupOptions = {},
): PreparedBackupImport {
  throwIfCancelled(options.signal);
  options.onProgress?.({ stage: "PARSING", progress: 0.4 });
  const value = parseBoundedJson(json);
  return prepareBackupValue(
    value,
    new TextEncoder().encode(json).byteLength,
    options,
  );
}

export async function prepareBackupFile(
  file: File,
  options: PrepareBackupOptions = {},
): Promise<PreparedBackupImport> {
  options.onProgress?.({ stage: "VALIDATING_FILE", progress: 0.05 });
  validateBackupFile(file);
  throwIfCancelled(options.signal);
  options.onProgress?.({ stage: "READING", progress: 0.2 });
  const json = await readFileText(file);
  throwIfCancelled(options.signal);
  return prepareBackupText(json, options);
}

export function parseBackupJson(json: string): AttendSafeBackupFile {
  return prepareBackupText(json).backup;
}
