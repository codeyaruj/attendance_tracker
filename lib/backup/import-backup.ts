import type { AttendSafeDatabase } from "@/db/database";
import { normalizeDatabaseError } from "@/db/database";
import { TABLE_NAMES } from "@/db/schema";
import { BackupError } from "./backup-errors";
import { deserializeUploadReferences } from "./blob-serialization";
import {
  prepareBackupText,
  prepareBackupValue,
  type PreparedBackupImport,
} from "./parse-backup";

export interface ImportBackupOptions {
  mode?: "REPLACE";
  onProgress?: (stage: "IMPORTING") => void;
}

export async function importPreparedBackup(
  database: AttendSafeDatabase,
  prepared: PreparedBackupImport,
  options: ImportBackupOptions = {},
): Promise<void> {
  if (options.mode && options.mode !== "REPLACE") {
    throw new BackupError(
      "CONFLICT_DETECTED",
      "Only transactional full replacement is supported.",
    );
  }
  options.onProgress?.("IMPORTING");
  const data = prepared.backup.data;
  const uploads = deserializeUploadReferences(data.uploadedTimetableReferences);
  try {
    await database.transaction("rw", TABLE_NAMES, async () => {
      for (const tableName of [...TABLE_NAMES].reverse()) {
        await database.table(tableName).clear();
      }
      await database.profiles.bulkAdd(data.profiles);
      await database.semesters.bulkAdd(data.semesters);
      await database.timetables.bulkAdd(data.timetables);
      await database.timetableVersions.bulkAdd(data.timetableVersions);
      await database.subjects.bulkAdd(data.subjects);
      await database.electiveGroups.bulkAdd(data.electiveGroups);
      await database.timetableSlots.bulkAdd(data.timetableSlots);
      await database.academicExceptions.bulkAdd(data.academicExceptions);
      await database.classSessions.bulkAdd(data.classSessions);
      await database.attendanceRecords.bulkAdd(data.attendanceRecords);
      await database.uploadedTimetableReferences.bulkAdd(uploads);
      await database.recentActions.bulkAdd(data.recentActions);
      await database.appSettings.add(data.appSettings[0]);
    });
  } catch (cause) {
    const normalized = normalizeDatabaseError(cause);
    throw new BackupError(
      "TRANSACTION_FAILED",
      "The backup could not be applied. Your existing local data was preserved.",
      {},
      { cause: normalized },
    );
  }
}

export async function importBackup(
  database: AttendSafeDatabase,
  input: string | unknown,
  options: ImportBackupOptions = {},
): Promise<PreparedBackupImport["backup"]> {
  const prepared =
    typeof input === "string"
      ? prepareBackupText(input)
      : prepareBackupValue(input);
  await importPreparedBackup(database, prepared, options);
  return prepared.backup;
}
