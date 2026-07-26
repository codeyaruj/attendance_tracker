import type {
  AppSettings,
  Profile,
  Subject,
  TimetableSlot,
} from "@/types/domain";

/**
 * IndexedDB migrations are append-only. Never edit a released schema in place;
 * add a new entry and an upgrade function in `AttendSafeDatabase` instead.
 */
export const DATABASE_NAME = "attendsafe";
export const DATABASE_SCHEMA_VERSION = 3;

export const SCHEMA_V1 = {
  profiles: "id, displayName, createdAt, updatedAt",
  semesters:
    "id, profileId, [profileId+startDate], startDate, endDate, updatedAt",
  timetables: "id, semesterId, updatedAt",
  timetableVersions:
    "id, timetableId, semesterId, [semesterId+effectiveStartDate], effectiveStartDate, effectiveEndDate, isConfirmed, updatedAt",
  subjects:
    "id, semesterId, [semesterId+name], code, classType, isEnabled, updatedAt",
  electiveGroups: "id, semesterId, updatedAt",
  timetableSlots:
    "id, timetableVersionId, subjectId, electiveGroupId, [timetableVersionId+dayOfWeek], dayOfWeek, isEnabled, updatedAt",
  academicExceptions:
    "id, semesterId, timetableSlotId, classSessionId, [semesterId+startDate], startDate, endDate, type, updatedAt",
  classSessions:
    "id, semesterId, subjectId, timetableSlotId, timetableVersionId, [semesterId+date], [subjectId+date], date, status, source, updatedAt",
  attendanceRecords: "id, &classSessionId, status, markedAt, updatedAt",
  appSettings: "id, updatedAt",
} as const;

export const SCHEMA_V2 = {
  ...SCHEMA_V1,
  uploadedTimetableReferences:
    "id, profileId, semesterId, createdAt, updatedAt",
  recentActions:
    "id, profileId, semesterId, [profileId+createdAt], [semesterId+createdAt], createdAt, undoneAt",
} as const;

export const SCHEMA_V3 = {
  ...SCHEMA_V2,
  profiles: "id, displayName, timezone, createdAt, updatedAt",
  subjects:
    "id, semesterId, [semesterId+name], [semesterId+code], code, classType, isEnabled, isZeroCredit, updatedAt",
  timetableSlots:
    "id, timetableVersionId, subjectId, electiveGroupId, [timetableVersionId+dayOfWeek], [subjectId+dayOfWeek], dayOfWeek, isEnabled, isPlaceholder, isBreak, updatedAt",
  classSessions:
    "id, semesterId, subjectId, timetableSlotId, timetableVersionId, [semesterId+date], [subjectId+date], [timetableSlotId+date], date, status, source, updatedAt",
} as const;

export const TABLE_NAMES = [
  "profiles",
  "semesters",
  "timetables",
  "timetableVersions",
  "subjects",
  "electiveGroups",
  "timetableSlots",
  "academicExceptions",
  "classSessions",
  "attendanceRecords",
  "appSettings",
  "uploadedTimetableReferences",
  "recentActions",
] as const;

export type AttendSafeTableName = (typeof TABLE_NAMES)[number];

export const DEFAULT_TRACKED_CLASS_TYPES: AppSettings["trackedClassTypes"] = {
  THEORY: true,
  LAB: false,
  TUTORIAL: false,
  SEMINAR: false,
  PROJECT: false,
  OTHER: false,
};

export function defaultAppSettings(
  now = new Date().toISOString(),
): AppSettings {
  return {
    id: "app",
    theme: "SYSTEM",
    trackedClassTypes: { ...DEFAULT_TRACKED_CLASS_TYPES },
    includeZeroCredit: false,
    offlineReady: false,
    notificationsPrepared: true,
    updatedAt: now,
  };
}

export function migrateProfileDefaults(profile: Profile): void {
  profile.timezone ||= "Asia/Kolkata";
  profile.weekStartsOn ||= "MONDAY";
}

export function migrateSubjectDefaults(subject: Subject): void {
  subject.countsCancelledSessions ??= false;
  subject.exemptPolicy ??= "EXCLUDED";
  subject.initialHeld ??= 0;
  subject.initialAttended ??= 0;
  subject.isZeroCredit ??= false;
  subject.isEnabled ??= true;
}

export function migrateSlotDefaults(slot: TimetableSlot): void {
  slot.faculty ??= [];
  slot.batchRestriction ??= [];
  slot.weekPattern ??= "EVERY_WEEK";
  slot.isEnabled ??= true;
  slot.isPlaceholder ??= false;
  slot.isBreak ??= false;
}
