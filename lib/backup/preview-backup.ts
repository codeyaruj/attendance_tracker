import type { AttendSafeBackupFile } from "./schema";

export interface BackupImportPreview {
  version: number;
  sourceVersion: number;
  exportedAt: string;
  profiles: number;
  semesters: number;
  subjects: number;
  timetableSlots: number;
  attendanceRecords: number;
  extraSessions: number;
  cancelledSessions: number;
  rescheduledSessions: number;
  holidays: number;
  settingsIncluded: boolean;
  embeddedFiles: number;
  approximateBytes: number;
  migrationWarnings: string[];
  compatibilityWarnings: string[];
}

export function createBackupPreview(
  backup: AttendSafeBackupFile,
  sourceVersion: number,
  migrationWarnings: readonly string[],
  approximateBytes: number,
): BackupImportPreview {
  const { data } = backup;
  return {
    version: backup.version,
    sourceVersion,
    exportedAt: backup.exportedAt,
    profiles: data.profiles.length,
    semesters: data.semesters.length,
    subjects: data.subjects.length,
    timetableSlots: data.timetableSlots.length,
    attendanceRecords: data.attendanceRecords.length,
    extraSessions:
      data.classSessions.filter((session) => session.source === "EXTRA")
        .length +
      data.academicExceptions.filter(
        (exception) => exception.type === "EXTRA_SESSION",
      ).length,
    cancelledSessions:
      data.classSessions.filter((session) => session.status === "CANCELLED")
        .length +
      data.academicExceptions.filter(
        (exception) => exception.type === "CANCELLED_SESSION",
      ).length,
    rescheduledSessions:
      data.classSessions.filter((session) => session.source === "RESCHEDULED")
        .length +
      data.academicExceptions.filter(
        (exception) => exception.type === "RESCHEDULED_SESSION",
      ).length,
    holidays: data.academicExceptions.filter(
      (exception) => exception.type === "HOLIDAY",
    ).length,
    settingsIncluded: data.appSettings.length === 1,
    embeddedFiles: data.uploadedTimetableReferences.length,
    approximateBytes,
    migrationWarnings: [...migrationWarnings],
    compatibilityWarnings: [
      "Import uses replace mode: every current local AttendSafe record will be replaced.",
      "Recent undo history from the backup is imported, but browser and service-worker caches are not.",
    ],
  };
}
