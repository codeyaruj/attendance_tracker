import type { AppSettings } from "@/types/domain";
import type { AttendSafeDatabase } from "@/db/database";
import { defaultAppSettings } from "@/db/schema";
import { BACKUP_LIMITS } from "@/lib/validation";
import { BackupError } from "./backup-errors";
import { serializeUploadReferences } from "./blob-serialization";
import { validateBackupRelationships } from "./reference-validation";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  attendSafeBackupSchema,
  type AttendSafeBackupFile,
} from "./schema";

export interface ExportBackupOptions {
  profileId?: string;
  includeRecentActions?: boolean;
  pretty?: boolean;
}

function sorted<T extends { id: string }>(values: readonly T[]): T[] {
  return [...values].sort((left, right) => left.id.localeCompare(right.id));
}

function scopedSettings(
  settings: AppSettings,
  profileId: string | undefined,
  semesterIds: ReadonlySet<string>,
): AppSettings {
  if (!profileId) return settings;
  return {
    ...settings,
    activeProfileId: profileId,
    activeSemesterId:
      settings.activeSemesterId && semesterIds.has(settings.activeSemesterId)
        ? settings.activeSemesterId
        : undefined,
  };
}

export async function createBackup(
  database: AttendSafeDatabase,
  options: ExportBackupOptions = {},
): Promise<AttendSafeBackupFile> {
  const allProfiles = await database.profiles.toArray();
  const profiles = options.profileId
    ? allProfiles.filter((profile) => profile.id === options.profileId)
    : allProfiles;
  if (options.profileId && profiles.length === 0) {
    throw new Error("The selected profile no longer exists.");
  }
  const profileIds = new Set(profiles.map((item) => item.id));
  const semesters = (await database.semesters.toArray()).filter((item) =>
    profileIds.has(item.profileId),
  );
  const semesterIds = new Set(semesters.map((item) => item.id));
  const timetables = (await database.timetables.toArray()).filter((item) =>
    semesterIds.has(item.semesterId),
  );
  const timetableIds = new Set(timetables.map((item) => item.id));
  const timetableVersions = (await database.timetableVersions.toArray()).filter(
    (item) =>
      semesterIds.has(item.semesterId) && timetableIds.has(item.timetableId),
  );
  const versionIds = new Set(timetableVersions.map((item) => item.id));
  const subjects = (await database.subjects.toArray()).filter((item) =>
    semesterIds.has(item.semesterId),
  );
  const electiveGroups = (await database.electiveGroups.toArray()).filter(
    (item) => semesterIds.has(item.semesterId),
  );
  const timetableSlots = (await database.timetableSlots.toArray()).filter(
    (item) => versionIds.has(item.timetableVersionId),
  );
  const academicExceptions = (
    await database.academicExceptions.toArray()
  ).filter((item) => semesterIds.has(item.semesterId));
  const classSessions = (await database.classSessions.toArray()).filter(
    (item) => semesterIds.has(item.semesterId),
  );
  const sessionIds = new Set(classSessions.map((item) => item.id));
  const attendanceRecords = (await database.attendanceRecords.toArray()).filter(
    (item) => sessionIds.has(item.classSessionId),
  );
  const uploadIds = new Set(
    timetableVersions.flatMap((item) =>
      item.uploadedReferenceId ? [item.uploadedReferenceId] : [],
    ),
  );
  const uploadReferences = (
    await database.uploadedTimetableReferences.toArray()
  ).filter(
    (item) =>
      uploadIds.has(item.id) ||
      (item.profileId ? profileIds.has(item.profileId) : false) ||
      (item.semesterId ? semesterIds.has(item.semesterId) : false),
  );
  const uploadedTimetableReferences = await serializeUploadReferences(
    sorted(uploadReferences),
  );
  const settings =
    (await database.appSettings.get("app")) ?? defaultAppSettings();
  const recentActions =
    options.includeRecentActions === false
      ? []
      : (await database.recentActions.toArray()).filter((item) =>
          profileIds.has(item.profileId),
        );

  const backup = attendSafeBackupSchema.parse({
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: "0.1.0",
    data: {
      profiles: sorted(profiles),
      semesters: sorted(semesters),
      timetables: sorted(timetables),
      timetableVersions: sorted(timetableVersions),
      subjects: sorted(subjects),
      electiveGroups: sorted(electiveGroups),
      timetableSlots: sorted(timetableSlots),
      academicExceptions: sorted(academicExceptions),
      classSessions: sorted(classSessions),
      attendanceRecords: sorted(attendanceRecords),
      appSettings: [scopedSettings(settings, options.profileId, semesterIds)],
      recentActions: sorted(recentActions),
      uploadedTimetableReferences,
    },
  });
  validateBackupRelationships(backup.data);
  return backup;
}

export async function exportBackupJson(
  database: AttendSafeDatabase,
  options: ExportBackupOptions = {},
): Promise<string> {
  const backup = await createBackup(database, options);
  const json = JSON.stringify(
    backup,
    null,
    options.pretty === false ? undefined : 2,
  );
  if (new TextEncoder().encode(json).byteLength > BACKUP_LIMITS.maxFileBytes) {
    throw new BackupError(
      "LIMIT_EXCEEDED",
      "The generated backup exceeds 5 MB. Remove large uploaded timetable sources or export a single profile.",
    );
  }
  return json;
}
