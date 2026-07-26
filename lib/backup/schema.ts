import { z } from "zod";

import {
  ATTENDANCE_STATUSES,
  CLASS_TYPES,
  DAYS_OF_WEEK,
  SESSION_STATUSES,
  WEEK_PATTERNS,
} from "@/types/domain";
import { timeZoneSchema } from "@/lib/validation/schemas";

export const BACKUP_SCHEMA_VERSION = 2;

const idSchema = z.string().uuid();
const nonEmptyString = z.string().trim().min(1);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), {
    message: "Invalid calendar date",
  });
const timestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Invalid timestamp",
  });
const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const basisPointsSchema = z.number().int().min(0).max(10_000);
const timestampFields = {
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};

export const profileBackupSchema = z.object({
  id: idSchema,
  displayName: nonEmptyString,
  institution: z.string().optional(),
  course: z.string().optional(),
  section: z.string().optional(),
  batch: z.string().optional(),
  timezone: timeZoneSchema,
  weekStartsOn: z.enum(["MONDAY", "SUNDAY"]),
  ...timestampFields,
});

export const semesterBackupSchema = z
  .object({
    id: idSchema,
    profileId: idSchema,
    name: nonEmptyString,
    startDate: dateSchema,
    endDate: dateSchema,
    minimumAttendanceBasisPoints: basisPointsSchema,
    safetyTargetBasisPoints: basisPointsSchema,
    teachingDays: z.array(z.enum(DAYS_OF_WEEK)),
    activeTimetableVersionId: idSchema.optional(),
    ...timestampFields,
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "Semester end date must not precede start date",
    path: ["endDate"],
  })
  .refine(
    (value) =>
      value.safetyTargetBasisPoints >= value.minimumAttendanceBasisPoints,
    {
      message: "Safety target must be at least the minimum threshold",
      path: ["safetyTargetBasisPoints"],
    },
  );

export const timetableBackupSchema = z.object({
  id: idSchema,
  semesterId: idSchema,
  title: nonEmptyString,
  timezone: timeZoneSchema,
  ...timestampFields,
});

export const timetableVersionBackupSchema = z
  .object({
    id: idSchema,
    timetableId: idSchema,
    semesterId: idSchema,
    version: z.number().int().positive(),
    label: nonEmptyString,
    effectiveStartDate: dateSchema,
    effectiveEndDate: dateSchema.optional(),
    isConfirmed: z.boolean(),
    source: z.enum(["UPLOAD", "MANUAL", "DEMO", "IMPORT"]),
    uploadedReferenceId: idSchema.optional(),
    ...timestampFields,
  })
  .refine(
    (value) =>
      !value.effectiveEndDate ||
      value.effectiveEndDate >= value.effectiveStartDate,
    {
      message: "Timetable version end date must not precede start date",
      path: ["effectiveEndDate"],
    },
  );

export const subjectBackupSchema = z
  .object({
    id: idSchema,
    semesterId: idSchema,
    code: z.string().optional(),
    name: nonEmptyString,
    shortName: nonEmptyString,
    credits: z.number().finite().min(0),
    classType: z.enum(CLASS_TYPES),
    minimumAttendanceBasisPointsOverride: basisPointsSchema.optional(),
    safetyTargetBasisPointsOverride: basisPointsSchema.optional(),
    isZeroCredit: z.boolean(),
    isEnabled: z.boolean(),
    countsCancelledSessions: z.boolean(),
    exemptPolicy: z.enum(["EXCLUDED", "ATTENDED"]),
    initialHeld: z.number().int().nonnegative(),
    initialAttended: z.number().int().nonnegative(),
    ...timestampFields,
  })
  .refine((value) => value.initialAttended <= value.initialHeld, {
    message: "Initial attended classes cannot exceed initial held classes",
    path: ["initialAttended"],
  })
  .refine(
    (value) =>
      value.minimumAttendanceBasisPointsOverride === undefined ||
      value.safetyTargetBasisPointsOverride === undefined ||
      value.safetyTargetBasisPointsOverride >=
        value.minimumAttendanceBasisPointsOverride,
    {
      message: "Subject safety target cannot be below its minimum",
      path: ["safetyTargetBasisPointsOverride"],
    },
  );

export const electiveGroupBackupSchema = z
  .object({
    id: idSchema,
    semesterId: idSchema,
    name: nonEmptyString,
    options: z.array(z.object({ subjectId: idSchema, label: nonEmptyString })),
    selectedSubjectIds: z.array(idSchema),
    allowMultiple: z.boolean().optional().default(false),
    ...timestampFields,
  })
  .superRefine((group, context) => {
    if (!group.allowMultiple && group.selectedSubjectIds.length > 1) {
      context.addIssue({
        code: "custom",
        message: "This elective group allows only one selected subject",
        path: ["selectedSubjectIds"],
      });
    }
  });

export const timetableSlotBackupSchema = z
  .object({
    id: idSchema,
    timetableVersionId: idSchema,
    subjectId: idSchema.optional(),
    dayOfWeek: z.enum(DAYS_OF_WEEK),
    startTime: timeSchema,
    endTime: timeSchema,
    faculty: z.array(z.string()),
    room: z.string().optional(),
    batchRestriction: z.array(z.string()),
    electiveGroupId: idSchema.optional(),
    weekPattern: z.enum(WEEK_PATTERNS),
    customWeekPattern: z.string().optional(),
    notes: z.string().optional(),
    isEnabled: z.boolean(),
    isPlaceholder: z.boolean(),
    isBreak: z.boolean(),
    ...timestampFields,
  })
  .refine((value) => value.endTime > value.startTime, {
    message: "Timetable slot must end after it starts",
    path: ["endTime"],
  })
  .refine(
    (value) =>
      value.weekPattern !== "CUSTOM" || !!value.customWeekPattern?.trim(),
    {
      message: "Custom week pattern details are required",
      path: ["customWeekPattern"],
    },
  );

export const academicExceptionBackupSchema = z
  .object({
    id: idSchema,
    semesterId: idSchema,
    timetableSlotId: idSchema.optional(),
    classSessionId: idSchema.optional(),
    type: z.enum([
      "HOLIDAY",
      "BREAK",
      "CANCELLED_DAY",
      "CANCELLED_SESSION",
      "RESCHEDULED_SESSION",
      "EXTRA_SESSION",
      "SESSION_OVERRIDE",
    ]),
    startDate: dateSchema,
    endDate: dateSchema,
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
    subjectId: idSchema.optional(),
    replacementDate: dateSchema.optional(),
    faculty: z.array(z.string()).optional(),
    room: z.string().optional(),
    notes: z.string().optional(),
    ...timestampFields,
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: "Exception end date must not precede start date",
    path: ["endDate"],
  });

export const classSessionBackupSchema = z
  .object({
    id: idSchema,
    semesterId: idSchema,
    subjectId: idSchema,
    timetableSlotId: idSchema.optional(),
    timetableVersionId: idSchema.optional(),
    date: dateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    status: z.enum(SESSION_STATUSES),
    source: z.enum(["TIMETABLE", "EXTRA", "RESCHEDULED"]),
    faculty: z.array(z.string()),
    room: z.string().optional(),
    notes: z.string().optional(),
    ...timestampFields,
  })
  .refine((value) => value.endTime > value.startTime, {
    message: "Class session must end after it starts",
    path: ["endTime"],
  });

export const attendanceRecordBackupSchema = z.object({
  id: idSchema,
  classSessionId: idSchema,
  status: z.enum(ATTENDANCE_STATUSES),
  markedAt: timestampSchema,
  notes: z.string().optional(),
  ...timestampFields,
});

export const appSettingsBackupSchema = z.object({
  id: z.literal("app"),
  activeProfileId: idSchema.optional(),
  activeSemesterId: idSchema.optional(),
  theme: z.enum(["LIGHT", "DARK", "SYSTEM"]),
  selectedBatch: z.string().optional(),
  trackedClassTypes: z.object({
    THEORY: z.boolean(),
    LAB: z.boolean(),
    TUTORIAL: z.boolean(),
    SEMINAR: z.boolean(),
    PROJECT: z.boolean(),
    OTHER: z.boolean(),
  }),
  includeZeroCredit: z.boolean().optional().default(false),
  offlineReady: z.boolean(),
  notificationsPrepared: z.boolean(),
  updatedAt: timestampSchema,
});

export const recentActionBackupSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  semesterId: idSchema.optional(),
  kind: nonEmptyString,
  description: nonEmptyString,
  undoPayload: z.record(z.string(), z.unknown()).optional(),
  undoneAt: timestampSchema.optional(),
  ...timestampFields,
});

export const serializedUploadReferenceSchema = z.object({
  id: idSchema,
  profileId: idSchema.optional(),
  semesterId: idSchema.optional(),
  filename: nonEmptyString,
  mediaType: nonEmptyString,
  size: z.number().int().nonnegative(),
  blobBase64: z
    .string()
    .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  rotation: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
  zoom: z.number().finite().positive(),
  crop: z.object({
    top: z.number().finite().nonnegative(),
    right: z.number().finite().nonnegative(),
    bottom: z.number().finite().nonnegative(),
    left: z.number().finite().nonnegative(),
  }),
  ...timestampFields,
});

const backupDataV1Schema = z.object({
  profiles: z.array(profileBackupSchema),
  semesters: z.array(semesterBackupSchema),
  timetables: z.array(timetableBackupSchema),
  timetableVersions: z.array(timetableVersionBackupSchema),
  subjects: z.array(subjectBackupSchema),
  electiveGroups: z.array(electiveGroupBackupSchema),
  timetableSlots: z.array(timetableSlotBackupSchema),
  academicExceptions: z.array(academicExceptionBackupSchema),
  classSessions: z.array(classSessionBackupSchema),
  attendanceRecords: z.array(attendanceRecordBackupSchema),
  appSettings: z.array(appSettingsBackupSchema).max(1),
  recentActions: z.array(recentActionBackupSchema),
});

const backupDataV2Schema = backupDataV1Schema.extend({
  uploadedTimetableReferences: z.array(serializedUploadReferenceSchema),
});

const backupV1Schema = z.object({
  schemaVersion: z.literal(1),
  exportedAt: timestampSchema,
  product: z.literal("AttendSafe"),
  data: backupDataV1Schema,
});

function hasUniqueIds(items: readonly { id: string }[]): boolean {
  return new Set(items.map((item) => item.id)).size === items.length;
}

function addIntegrityIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

function validateIntegrity(
  backup: { data: z.infer<typeof backupDataV2Schema> },
  context: z.RefinementCtx,
): void {
  const data = backup.data;
  const collections = [
    ["profiles", data.profiles],
    ["semesters", data.semesters],
    ["timetables", data.timetables],
    ["timetableVersions", data.timetableVersions],
    ["subjects", data.subjects],
    ["electiveGroups", data.electiveGroups],
    ["timetableSlots", data.timetableSlots],
    ["academicExceptions", data.academicExceptions],
    ["classSessions", data.classSessions],
    ["attendanceRecords", data.attendanceRecords],
    ["uploadedTimetableReferences", data.uploadedTimetableReferences],
    ["recentActions", data.recentActions],
  ] as const;
  for (const [name, items] of collections) {
    if (!hasUniqueIds(items)) {
      addIntegrityIssue(
        context,
        ["data", name],
        `${name} contains duplicate IDs`,
      );
    }
  }

  const profileIds = new Set(data.profiles.map((profile) => profile.id));
  const semesterIds = new Set(data.semesters.map((semester) => semester.id));
  const timetableIds = new Set(
    data.timetables.map((timetable) => timetable.id),
  );
  const versionIds = new Set(
    data.timetableVersions.map((version) => version.id),
  );
  const subjectIds = new Set(data.subjects.map((subject) => subject.id));
  const electiveIds = new Set(data.electiveGroups.map((group) => group.id));
  const slotIds = new Set(data.timetableSlots.map((slot) => slot.id));
  const sessionIds = new Set(data.classSessions.map((session) => session.id));
  const uploadIds = new Set(
    data.uploadedTimetableReferences.map((reference) => reference.id),
  );
  const semestersById = new Map(
    data.semesters.map((semester) => [semester.id, semester]),
  );
  const timetablesById = new Map(
    data.timetables.map((timetable) => [timetable.id, timetable]),
  );
  const versionsById = new Map(
    data.timetableVersions.map((version) => [version.id, version]),
  );
  const subjectsById = new Map(
    data.subjects.map((subject) => [subject.id, subject]),
  );
  const electivesById = new Map(
    data.electiveGroups.map((group) => [group.id, group]),
  );
  const slotsById = new Map(data.timetableSlots.map((slot) => [slot.id, slot]));
  const sessionsById = new Map(
    data.classSessions.map((session) => [session.id, session]),
  );
  const seenVersionNumbers = new Set<string>();
  const seenAttendanceSessions = new Set<string>();

  data.semesters.forEach((semester, index) => {
    if (!profileIds.has(semester.profileId)) {
      addIntegrityIssue(
        context,
        ["data", "semesters", index, "profileId"],
        "Unknown profile",
      );
    }
    if (
      semester.activeTimetableVersionId &&
      !versionIds.has(semester.activeTimetableVersionId)
    ) {
      addIntegrityIssue(
        context,
        ["data", "semesters", index, "activeTimetableVersionId"],
        "Unknown active timetable version",
      );
    } else if (
      semester.activeTimetableVersionId &&
      versionsById.get(semester.activeTimetableVersionId)?.semesterId !==
        semester.id
    ) {
      addIntegrityIssue(
        context,
        ["data", "semesters", index, "activeTimetableVersionId"],
        "Active timetable version belongs to another semester",
      );
    }
  });
  data.timetables.forEach((timetable, index) => {
    if (!semesterIds.has(timetable.semesterId)) {
      addIntegrityIssue(
        context,
        ["data", "timetables", index, "semesterId"],
        "Unknown semester",
      );
    }
  });
  data.timetableVersions.forEach((version, index) => {
    const versionKey = `${version.timetableId}:${version.version}`;
    if (seenVersionNumbers.has(versionKey)) {
      addIntegrityIssue(
        context,
        ["data", "timetableVersions", index, "version"],
        "Timetable version number is duplicated",
      );
    }
    seenVersionNumbers.add(versionKey);
    if (!semesterIds.has(version.semesterId)) {
      addIntegrityIssue(
        context,
        ["data", "timetableVersions", index, "semesterId"],
        "Unknown semester",
      );
    }
    if (!timetableIds.has(version.timetableId)) {
      addIntegrityIssue(
        context,
        ["data", "timetableVersions", index, "timetableId"],
        "Unknown timetable",
      );
    } else if (
      timetablesById.get(version.timetableId)?.semesterId !== version.semesterId
    ) {
      addIntegrityIssue(
        context,
        ["data", "timetableVersions", index, "timetableId"],
        "Timetable and version belong to different semesters",
      );
    }
    if (
      version.uploadedReferenceId &&
      !uploadIds.has(version.uploadedReferenceId)
    ) {
      addIntegrityIssue(
        context,
        ["data", "timetableVersions", index, "uploadedReferenceId"],
        "Unknown upload reference",
      );
    }
  });
  data.subjects.forEach((subject, index) => {
    if (!semesterIds.has(subject.semesterId)) {
      addIntegrityIssue(
        context,
        ["data", "subjects", index, "semesterId"],
        "Unknown semester",
      );
    }
  });
  data.electiveGroups.forEach((group, index) => {
    if (!semesterIds.has(group.semesterId)) {
      addIntegrityIssue(
        context,
        ["data", "electiveGroups", index, "semesterId"],
        "Unknown semester",
      );
    }
    for (const subjectId of [
      ...group.options.map((option) => option.subjectId),
      ...group.selectedSubjectIds,
    ]) {
      if (!subjectIds.has(subjectId)) {
        addIntegrityIssue(
          context,
          ["data", "electiveGroups", index],
          "Unknown elective subject",
        );
      } else if (subjectsById.get(subjectId)?.semesterId !== group.semesterId) {
        addIntegrityIssue(
          context,
          ["data", "electiveGroups", index],
          "Elective subject belongs to another semester",
        );
      }
    }
    const optionIds = new Set(group.options.map((option) => option.subjectId));
    if (
      group.selectedSubjectIds.some((subjectId) => !optionIds.has(subjectId))
    ) {
      addIntegrityIssue(
        context,
        ["data", "electiveGroups", index, "selectedSubjectIds"],
        "Selected elective must be one of the group's options",
      );
    }
  });
  data.timetableSlots.forEach((slot, index) => {
    const versionSemesterId = versionsById.get(
      slot.timetableVersionId,
    )?.semesterId;
    if (!versionIds.has(slot.timetableVersionId)) {
      addIntegrityIssue(
        context,
        ["data", "timetableSlots", index, "timetableVersionId"],
        "Unknown timetable version",
      );
    }
    if (slot.subjectId && !subjectIds.has(slot.subjectId)) {
      addIntegrityIssue(
        context,
        ["data", "timetableSlots", index, "subjectId"],
        "Unknown subject",
      );
    } else if (
      slot.subjectId &&
      versionSemesterId &&
      subjectsById.get(slot.subjectId)?.semesterId !== versionSemesterId
    ) {
      addIntegrityIssue(
        context,
        ["data", "timetableSlots", index, "subjectId"],
        "Slot subject belongs to another semester",
      );
    }
    if (slot.electiveGroupId && !electiveIds.has(slot.electiveGroupId)) {
      addIntegrityIssue(
        context,
        ["data", "timetableSlots", index, "electiveGroupId"],
        "Unknown elective group",
      );
    } else if (
      slot.electiveGroupId &&
      versionSemesterId &&
      electivesById.get(slot.electiveGroupId)?.semesterId !== versionSemesterId
    ) {
      addIntegrityIssue(
        context,
        ["data", "timetableSlots", index, "electiveGroupId"],
        "Slot elective group belongs to another semester",
      );
    }
  });
  data.classSessions.forEach((session, index) => {
    if (!semesterIds.has(session.semesterId)) {
      addIntegrityIssue(
        context,
        ["data", "classSessions", index, "semesterId"],
        "Unknown semester",
      );
    }
    if (!subjectIds.has(session.subjectId)) {
      addIntegrityIssue(
        context,
        ["data", "classSessions", index, "subjectId"],
        "Unknown subject",
      );
    } else if (
      subjectsById.get(session.subjectId)?.semesterId !== session.semesterId
    ) {
      addIntegrityIssue(
        context,
        ["data", "classSessions", index, "subjectId"],
        "Session subject belongs to another semester",
      );
    }
    if (session.timetableSlotId && !slotIds.has(session.timetableSlotId)) {
      addIntegrityIssue(
        context,
        ["data", "classSessions", index, "timetableSlotId"],
        "Unknown timetable slot",
      );
    } else if (
      session.timetableSlotId &&
      session.timetableVersionId &&
      slotsById.get(session.timetableSlotId)?.timetableVersionId !==
        session.timetableVersionId
    ) {
      addIntegrityIssue(
        context,
        ["data", "classSessions", index, "timetableSlotId"],
        "Session slot and timetable version do not match",
      );
    }
    if (
      session.timetableVersionId &&
      versionsById.get(session.timetableVersionId)?.semesterId !==
        session.semesterId
    ) {
      addIntegrityIssue(
        context,
        ["data", "classSessions", index, "timetableVersionId"],
        "Session timetable version belongs to another semester",
      );
    }
  });
  data.attendanceRecords.forEach((record, index) => {
    if (seenAttendanceSessions.has(record.classSessionId)) {
      addIntegrityIssue(
        context,
        ["data", "attendanceRecords", index, "classSessionId"],
        "Only one attendance record is allowed per class session",
      );
    }
    seenAttendanceSessions.add(record.classSessionId);
    if (!sessionIds.has(record.classSessionId)) {
      addIntegrityIssue(
        context,
        ["data", "attendanceRecords", index, "classSessionId"],
        "Unknown class session",
      );
    }
  });
  data.academicExceptions.forEach((exception, index) => {
    if (!semesterIds.has(exception.semesterId)) {
      addIntegrityIssue(
        context,
        ["data", "academicExceptions", index, "semesterId"],
        "Unknown semester",
      );
    }
    if (exception.timetableSlotId && !slotIds.has(exception.timetableSlotId)) {
      addIntegrityIssue(
        context,
        ["data", "academicExceptions", index, "timetableSlotId"],
        "Unknown timetable slot",
      );
    }
    if (exception.classSessionId && !sessionIds.has(exception.classSessionId)) {
      addIntegrityIssue(
        context,
        ["data", "academicExceptions", index, "classSessionId"],
        "Unknown class session",
      );
    } else if (
      exception.classSessionId &&
      sessionsById.get(exception.classSessionId)?.semesterId !==
        exception.semesterId
    ) {
      addIntegrityIssue(
        context,
        ["data", "academicExceptions", index, "classSessionId"],
        "Exception session belongs to another semester",
      );
    }
    if (
      exception.subjectId &&
      subjectsById.get(exception.subjectId)?.semesterId !== exception.semesterId
    ) {
      addIntegrityIssue(
        context,
        ["data", "academicExceptions", index, "subjectId"],
        "Exception subject is unknown or belongs to another semester",
      );
    }
  });
  data.uploadedTimetableReferences.forEach((reference, index) => {
    if (reference.profileId && !profileIds.has(reference.profileId)) {
      addIntegrityIssue(
        context,
        ["data", "uploadedTimetableReferences", index, "profileId"],
        "Unknown profile",
      );
    }
    if (reference.semesterId && !semesterIds.has(reference.semesterId)) {
      addIntegrityIssue(
        context,
        ["data", "uploadedTimetableReferences", index, "semesterId"],
        "Unknown semester",
      );
    } else if (
      reference.profileId &&
      reference.semesterId &&
      semestersById.get(reference.semesterId)?.profileId !== reference.profileId
    ) {
      addIntegrityIssue(
        context,
        ["data", "uploadedTimetableReferences", index],
        "Upload profile and semester do not match",
      );
    }
  });
  data.recentActions.forEach((action, index) => {
    if (!profileIds.has(action.profileId)) {
      addIntegrityIssue(
        context,
        ["data", "recentActions", index, "profileId"],
        "Unknown profile",
      );
    }
    if (action.semesterId && !semesterIds.has(action.semesterId)) {
      addIntegrityIssue(
        context,
        ["data", "recentActions", index, "semesterId"],
        "Unknown semester",
      );
    } else if (
      action.semesterId &&
      semestersById.get(action.semesterId)?.profileId !== action.profileId
    ) {
      addIntegrityIssue(
        context,
        ["data", "recentActions", index, "semesterId"],
        "Recent action profile and semester do not match",
      );
    }
  });
  const settings = data.appSettings[0];
  if (settings?.activeProfileId && !profileIds.has(settings.activeProfileId)) {
    addIntegrityIssue(
      context,
      ["data", "appSettings", 0, "activeProfileId"],
      "Unknown active profile",
    );
  }
  if (
    settings?.activeSemesterId &&
    !semesterIds.has(settings.activeSemesterId)
  ) {
    addIntegrityIssue(
      context,
      ["data", "appSettings", 0, "activeSemesterId"],
      "Unknown active semester",
    );
  } else if (
    settings?.activeProfileId &&
    settings.activeSemesterId &&
    semestersById.get(settings.activeSemesterId)?.profileId !==
      settings.activeProfileId
  ) {
    addIntegrityIssue(
      context,
      ["data", "appSettings", 0],
      "Active profile and semester do not match",
    );
  }
}

export const attendSafeBackupSchema = z
  .object({
    schemaVersion: z.literal(BACKUP_SCHEMA_VERSION),
    exportedAt: timestampSchema,
    product: z.literal("AttendSafe"),
    data: backupDataV2Schema,
  })
  .superRefine(validateIntegrity);

export type SerializedUploadedTimetableReference = z.infer<
  typeof serializedUploadReferenceSchema
>;
export type AttendSafeBackupFile = z.infer<typeof attendSafeBackupSchema>;

const backupHeaderSchema = z.object({
  schemaVersion: z.number().int(),
  product: z.literal("AttendSafe"),
});

export class UnsupportedBackupVersionError extends Error {
  constructor(readonly version: number) {
    super(
      `Backup schema version ${version} is not supported by this version of AttendSafe.`,
    );
    this.name = "UnsupportedBackupVersionError";
  }
}

export function parseAndMigrateBackup(input: unknown): AttendSafeBackupFile {
  const header = backupHeaderSchema.parse(input);
  if (header.schemaVersion === 1) {
    const legacy = backupV1Schema.parse(input);
    const timetableVersions = legacy.data.timetableVersions.map((version) => {
      const migrated = { ...version };
      delete migrated.uploadedReferenceId;
      return migrated;
    });
    return attendSafeBackupSchema.parse({
      ...legacy,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      data: {
        ...legacy.data,
        timetableVersions,
        uploadedTimetableReferences: [],
      },
    });
  }
  if (header.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw new UnsupportedBackupVersionError(header.schemaVersion);
  }
  return attendSafeBackupSchema.parse(input);
}
