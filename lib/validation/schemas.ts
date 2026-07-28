import { z } from "zod";

import {
  ATTENDANCE_STATUSES,
  CLASS_TYPES,
  DAYS_OF_WEEK,
  SESSION_STATUSES,
  WEEK_PATTERNS,
  type AttendSafeBackup,
} from "@/types/domain";
import type { NormalizedTimetableDraft } from "@/types/draft";
import {
  isStrictIsoDate,
  isStrictLocalTime,
  isStrictTimestamp,
} from "./date-validation";

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export const idSchema = z.string().uuid();
export const isoDateSchema = z
  .string()
  .refine(
    isStrictIsoDate,
    "Expected a valid calendar date in YYYY-MM-DD format",
  );
export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true })
  .refine(isStrictTimestamp, "Expected a real ISO timestamp with an offset");
export const timeSchema = z
  .string()
  .refine(isStrictLocalTime, "Expected a 24-hour time in HH:mm format");
export const confidenceSchema = z.number().finite().min(0).max(1);
export const basisPointsSchema = z.number().int().min(0).max(10_000);
export const dayOfWeekSchema = z.enum(DAYS_OF_WEEK);
export const classTypeSchema = z.enum(CLASS_TYPES);
export const weekPatternSchema = z.enum(WEEK_PATTERNS);
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export const attendanceStatusSchema = z.enum(ATTENDANCE_STATUSES);
export const timeZoneSchema = z
  .string()
  .min(1)
  .refine((value) => value === value.trim(), "Unexpected surrounding spaces")
  .refine(isTimeZone, "Expected a valid IANA time zone");

const trimmedTextSchema = (maximumLength: number) =>
  z
    .string()
    .min(1)
    .max(maximumLength)
    .refine((value) => value === value.trim(), "Unexpected surrounding spaces");
const optionalTextSchema = trimmedTextSchema(500).optional();
const optionalModelTextSchema = (maximumLength: number) =>
  z.preprocess(
    (value) =>
      value === null || (typeof value === "string" && value.trim() === "")
        ? undefined
        : value,
    z.string().trim().min(1).max(maximumLength).optional(),
  );
const timestampShape = {
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};

export const profileSchema = z
  .object({
    id: idSchema,
    displayName: trimmedTextSchema(100),
    institution: optionalTextSchema,
    course: optionalTextSchema,
    section: optionalTextSchema,
    batch: optionalTextSchema,
    batches: z.array(trimmedTextSchema(500)).max(100).optional(),
    timezone: timeZoneSchema,
    weekStartsOn: z.enum(["MONDAY", "SUNDAY"]),
    ...timestampShape,
  })
  .strict();

export const semesterSchema = z
  .object({
    id: idSchema,
    profileId: idSchema,
    name: trimmedTextSchema(150),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    minimumAttendanceBasisPoints: basisPointsSchema,
    safetyTargetBasisPoints: basisPointsSchema,
    teachingDays: z.array(dayOfWeekSchema).min(1),
    activeTimetableVersionId: idSchema.optional(),
    ...timestampShape,
  })
  .strict()
  .superRefine((semester, context) => {
    if (semester.endDate < semester.startDate) {
      context.addIssue({
        code: "custom",
        message: "Semester end date cannot precede its start date",
        path: ["endDate"],
      });
    }
    if (
      semester.safetyTargetBasisPoints < semester.minimumAttendanceBasisPoints
    ) {
      context.addIssue({
        code: "custom",
        message: "Safety target must be at least the minimum requirement",
        path: ["safetyTargetBasisPoints"],
      });
    }
    if (new Set(semester.teachingDays).size !== semester.teachingDays.length) {
      context.addIssue({
        code: "custom",
        message: "Teaching days must be unique",
        path: ["teachingDays"],
      });
    }
  });

export const timetableSchema = z
  .object({
    id: idSchema,
    semesterId: idSchema,
    title: trimmedTextSchema(200),
    timezone: timeZoneSchema,
    ...timestampShape,
  })
  .strict();

export const timetableVersionSchema = z
  .object({
    id: idSchema,
    timetableId: idSchema,
    semesterId: idSchema,
    version: z.number().int().positive(),
    label: trimmedTextSchema(150),
    effectiveStartDate: isoDateSchema,
    effectiveEndDate: isoDateSchema.optional(),
    isConfirmed: z.boolean(),
    source: z.enum(["UPLOAD", "MANUAL", "DEMO", "IMPORT"]),
    uploadedReferenceId: idSchema.optional(),
    ...timestampShape,
  })
  .strict()
  .superRefine((version, context) => {
    if (
      version.effectiveEndDate !== undefined &&
      version.effectiveEndDate < version.effectiveStartDate
    ) {
      context.addIssue({
        code: "custom",
        message: "Timetable version end date cannot precede its start date",
        path: ["effectiveEndDate"],
      });
    }
  });

export const subjectSchema = z
  .object({
    id: idSchema,
    semesterId: idSchema,
    code: optionalTextSchema,
    name: trimmedTextSchema(200),
    shortName: trimmedTextSchema(40),
    credits: z.number().finite().min(0).max(100),
    classType: classTypeSchema,
    minimumAttendanceBasisPointsOverride: basisPointsSchema.optional(),
    safetyTargetBasisPointsOverride: basisPointsSchema.optional(),
    isZeroCredit: z.boolean(),
    isEnabled: z.boolean(),
    countsCancelledSessions: z.boolean(),
    exemptPolicy: z.enum(["EXCLUDED", "ATTENDED"]),
    initialHeld: z.number().int().nonnegative(),
    initialAttended: z.number().int().nonnegative(),
    ...timestampShape,
  })
  .strict()
  .superRefine((subject, context) => {
    if (subject.initialAttended > subject.initialHeld) {
      context.addIssue({
        code: "custom",
        message: "Initial attended classes cannot exceed classes held",
        path: ["initialAttended"],
      });
    }
    if (
      subject.minimumAttendanceBasisPointsOverride !== undefined &&
      subject.safetyTargetBasisPointsOverride !== undefined &&
      subject.safetyTargetBasisPointsOverride <
        subject.minimumAttendanceBasisPointsOverride
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Subject safety target must be at least its minimum requirement",
        path: ["safetyTargetBasisPointsOverride"],
      });
    }
  });

export const electiveOptionSchema = z
  .object({
    subjectId: idSchema,
    label: trimmedTextSchema(200),
  })
  .strict();

export const electiveGroupSchema = z
  .object({
    id: idSchema,
    semesterId: idSchema,
    name: trimmedTextSchema(150),
    options: z.array(electiveOptionSchema).min(1),
    selectedSubjectIds: z.array(idSchema),
    allowMultiple: z.boolean(),
    ...timestampShape,
  })
  .strict()
  .superRefine((group, context) => {
    const optionIds = new Set(group.options.map((option) => option.subjectId));
    group.selectedSubjectIds.forEach((subjectId, index) => {
      if (!optionIds.has(subjectId)) {
        context.addIssue({
          code: "custom",
          message: "Selected elective must be one of the group's options",
          path: ["selectedSubjectIds", index],
        });
      }
    });
    if (!group.allowMultiple && group.selectedSubjectIds.length > 1) {
      context.addIssue({
        code: "custom",
        message: "This elective group allows only one selected subject",
        path: ["selectedSubjectIds"],
      });
    }
  });

export const timetableSlotSchema = z
  .object({
    id: idSchema,
    timetableVersionId: idSchema,
    subjectId: idSchema.optional(),
    dayOfWeek: dayOfWeekSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    faculty: z.array(trimmedTextSchema(100)),
    room: optionalTextSchema,
    batchRestriction: z.array(trimmedTextSchema(100)),
    electiveGroupId: idSchema.optional(),
    weekPattern: weekPatternSchema,
    customWeekPattern: optionalTextSchema,
    notes: optionalTextSchema,
    isEnabled: z.boolean(),
    isPlaceholder: z.boolean(),
    isBreak: z.boolean(),
    ...timestampShape,
  })
  .strict()
  .superRefine((slot, context) => {
    if (slot.endTime <= slot.startTime) {
      context.addIssue({
        code: "custom",
        message: "Slot end time must be later than its start time",
        path: ["endTime"],
      });
    }
    if (!slot.subjectId && !slot.isBreak && !slot.isPlaceholder) {
      context.addIssue({
        code: "custom",
        message: "A class slot requires a subject",
        path: ["subjectId"],
      });
    }
    if (slot.weekPattern === "CUSTOM" && !slot.customWeekPattern) {
      context.addIssue({
        code: "custom",
        message: "Custom week slots require a custom week pattern",
        path: ["customWeekPattern"],
      });
    }
  });

export const academicExceptionSchema = z
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
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    startTime: timeSchema.optional(),
    endTime: timeSchema.optional(),
    subjectId: idSchema.optional(),
    replacementDate: isoDateSchema.optional(),
    faculty: z.array(trimmedTextSchema(100)).optional(),
    room: optionalTextSchema,
    notes: optionalTextSchema,
    ...timestampShape,
  })
  .strict()
  .superRefine((exception, context) => {
    if (exception.endDate < exception.startDate) {
      context.addIssue({
        code: "custom",
        message: "Exception end date cannot precede its start date",
        path: ["endDate"],
      });
    }
    if (
      exception.startTime !== undefined &&
      exception.endTime !== undefined &&
      exception.endTime <= exception.startTime
    ) {
      context.addIssue({
        code: "custom",
        message: "Exception end time must be later than its start time",
        path: ["endTime"],
      });
    }
    if (
      exception.type === "RESCHEDULED_SESSION" &&
      !exception.timetableSlotId &&
      !exception.classSessionId
    ) {
      context.addIssue({
        code: "custom",
        message: "A rescheduled session requires its original occurrence",
        path: ["classSessionId"],
      });
    }
    if (
      exception.type === "RESCHEDULED_SESSION" &&
      (!exception.replacementDate || !exception.startTime || !exception.endTime)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "A rescheduled session requires a replacement date, start time, and end time",
        path: ["replacementDate"],
      });
    }
    if (
      exception.type === "EXTRA_SESSION" &&
      (!exception.subjectId || !exception.startTime || !exception.endTime)
    ) {
      context.addIssue({
        code: "custom",
        message: "An extra session requires subject, start time, and end time",
        path: ["type"],
      });
    }
    if (
      (exception.type === "CANCELLED_SESSION" ||
        exception.type === "SESSION_OVERRIDE") &&
      !exception.timetableSlotId &&
      !exception.classSessionId
    ) {
      context.addIssue({
        code: "custom",
        message: "A session-specific exception requires an original occurrence",
        path: ["classSessionId"],
      });
    }
  });

export const classSessionSchema = z
  .object({
    id: idSchema,
    semesterId: idSchema,
    subjectId: idSchema,
    timetableSlotId: idSchema.optional(),
    timetableVersionId: idSchema.optional(),
    date: isoDateSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    status: sessionStatusSchema,
    source: z.enum(["TIMETABLE", "EXTRA", "RESCHEDULED"]),
    faculty: z.array(trimmedTextSchema(100)),
    room: optionalTextSchema,
    notes: optionalTextSchema,
    ...timestampShape,
  })
  .strict()
  .superRefine((session, context) => {
    if (session.endTime <= session.startTime) {
      context.addIssue({
        code: "custom",
        message: "Session end time must be later than its start time",
        path: ["endTime"],
      });
    }
  });

export const attendanceRecordSchema = z
  .object({
    id: idSchema,
    classSessionId: idSchema,
    status: attendanceStatusSchema,
    markedAt: isoDateTimeSchema,
    notes: optionalTextSchema,
    ...timestampShape,
  })
  .strict();

export const appSettingsSchema = z
  .object({
    id: z.literal("app"),
    activeProfileId: idSchema.optional(),
    activeSemesterId: idSchema.optional(),
    theme: z.enum(["LIGHT", "DARK", "SYSTEM"]),
    selectedBatch: optionalTextSchema,
    selectedBatches: z.array(trimmedTextSchema(500)).max(100).optional(),
    trackedClassTypes: z
      .object({
        THEORY: z.boolean(),
        LAB: z.boolean(),
        TUTORIAL: z.boolean(),
        SEMINAR: z.boolean(),
        PROJECT: z.boolean(),
        OTHER: z.boolean(),
      })
      .strict(),
    includeZeroCredit: z.boolean(),
    offlineReady: z.boolean(),
    notificationsPrepared: z.boolean(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const recentActionSchema = z
  .object({
    id: idSchema,
    profileId: idSchema,
    semesterId: idSchema.optional(),
    kind: trimmedTextSchema(100),
    description: trimmedTextSchema(500),
    undoPayload: z.record(z.string(), z.unknown()).optional(),
    undoneAt: isoDateTimeSchema.optional(),
    ...timestampShape,
  })
  .strict();

function addUnknownReference(
  context: z.RefinementCtx,
  path: (string | number)[],
  collection: string,
): void {
  context.addIssue({
    code: "custom",
    message: `References an unknown ${collection} record`,
    path,
  });
}

function checkUniqueIds(
  context: z.RefinementCtx,
  path: string,
  items: readonly { id: string }[],
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate id in ${path}`,
        path: ["data", path, index, "id"],
      });
    }
    seen.add(item.id);
  });
}

export const attendSafeBackupSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    exportedAt: isoDateTimeSchema,
    product: z.literal("AttendSafe"),
    data: z
      .object({
        profiles: z.array(profileSchema),
        semesters: z.array(semesterSchema),
        timetables: z.array(timetableSchema),
        timetableVersions: z.array(timetableVersionSchema),
        subjects: z.array(subjectSchema),
        electiveGroups: z.array(electiveGroupSchema),
        timetableSlots: z.array(timetableSlotSchema),
        academicExceptions: z.array(academicExceptionSchema),
        classSessions: z.array(classSessionSchema),
        attendanceRecords: z.array(attendanceRecordSchema),
        appSettings: z.array(appSettingsSchema),
        recentActions: z.array(recentActionSchema),
      })
      .strict(),
  })
  .strict()
  .superRefine((backup, context) => {
    const { data } = backup;
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
      ["recentActions", data.recentActions],
    ] as const;
    collections.forEach(([name, values]) =>
      checkUniqueIds(context, name, values),
    );

    const profileIds = new Set(data.profiles.map(({ id }) => id));
    const semesterIds = new Set(data.semesters.map(({ id }) => id));
    const timetableIds = new Set(data.timetables.map(({ id }) => id));
    const versionIds = new Set(data.timetableVersions.map(({ id }) => id));
    const subjectIds = new Set(data.subjects.map(({ id }) => id));
    const groupIds = new Set(data.electiveGroups.map(({ id }) => id));
    const slotIds = new Set(data.timetableSlots.map(({ id }) => id));
    const sessionIds = new Set(data.classSessions.map(({ id }) => id));

    data.semesters.forEach((semester, index) => {
      if (!profileIds.has(semester.profileId)) {
        addUnknownReference(
          context,
          ["data", "semesters", index, "profileId"],
          "profile",
        );
      }
      if (
        semester.activeTimetableVersionId &&
        !versionIds.has(semester.activeTimetableVersionId)
      ) {
        addUnknownReference(
          context,
          ["data", "semesters", index, "activeTimetableVersionId"],
          "timetable version",
        );
      }
    });
    data.timetables.forEach((timetable, index) => {
      if (!semesterIds.has(timetable.semesterId)) {
        addUnknownReference(
          context,
          ["data", "timetables", index, "semesterId"],
          "semester",
        );
      }
    });
    data.timetableVersions.forEach((version, index) => {
      if (!timetableIds.has(version.timetableId)) {
        addUnknownReference(
          context,
          ["data", "timetableVersions", index, "timetableId"],
          "timetable",
        );
      }
      if (!semesterIds.has(version.semesterId)) {
        addUnknownReference(
          context,
          ["data", "timetableVersions", index, "semesterId"],
          "semester",
        );
      }
    });
    data.subjects.forEach((subject, index) => {
      if (!semesterIds.has(subject.semesterId)) {
        addUnknownReference(
          context,
          ["data", "subjects", index, "semesterId"],
          "semester",
        );
      }
    });
    data.electiveGroups.forEach((group, groupIndex) => {
      if (!semesterIds.has(group.semesterId)) {
        addUnknownReference(
          context,
          ["data", "electiveGroups", groupIndex, "semesterId"],
          "semester",
        );
      }
      group.options.forEach((option, optionIndex) => {
        if (!subjectIds.has(option.subjectId)) {
          addUnknownReference(
            context,
            [
              "data",
              "electiveGroups",
              groupIndex,
              "options",
              optionIndex,
              "subjectId",
            ],
            "subject",
          );
        }
      });
    });
    data.timetableSlots.forEach((slot, index) => {
      if (!versionIds.has(slot.timetableVersionId)) {
        addUnknownReference(
          context,
          ["data", "timetableSlots", index, "timetableVersionId"],
          "timetable version",
        );
      }
      if (slot.subjectId && !subjectIds.has(slot.subjectId)) {
        addUnknownReference(
          context,
          ["data", "timetableSlots", index, "subjectId"],
          "subject",
        );
      }
      if (slot.electiveGroupId && !groupIds.has(slot.electiveGroupId)) {
        addUnknownReference(
          context,
          ["data", "timetableSlots", index, "electiveGroupId"],
          "elective group",
        );
      }
    });
    data.academicExceptions.forEach((exception, index) => {
      if (!semesterIds.has(exception.semesterId)) {
        addUnknownReference(
          context,
          ["data", "academicExceptions", index, "semesterId"],
          "semester",
        );
      }
      if (
        exception.timetableSlotId &&
        !slotIds.has(exception.timetableSlotId)
      ) {
        addUnknownReference(
          context,
          ["data", "academicExceptions", index, "timetableSlotId"],
          "timetable slot",
        );
      }
      if (
        exception.classSessionId &&
        !sessionIds.has(exception.classSessionId)
      ) {
        addUnknownReference(
          context,
          ["data", "academicExceptions", index, "classSessionId"],
          "class session",
        );
      }
      if (exception.subjectId && !subjectIds.has(exception.subjectId)) {
        addUnknownReference(
          context,
          ["data", "academicExceptions", index, "subjectId"],
          "subject",
        );
      }
    });
    data.classSessions.forEach((session, index) => {
      if (!semesterIds.has(session.semesterId)) {
        addUnknownReference(
          context,
          ["data", "classSessions", index, "semesterId"],
          "semester",
        );
      }
      if (!subjectIds.has(session.subjectId)) {
        addUnknownReference(
          context,
          ["data", "classSessions", index, "subjectId"],
          "subject",
        );
      }
      if (session.timetableSlotId && !slotIds.has(session.timetableSlotId)) {
        addUnknownReference(
          context,
          ["data", "classSessions", index, "timetableSlotId"],
          "timetable slot",
        );
      }
      if (
        session.timetableVersionId &&
        !versionIds.has(session.timetableVersionId)
      ) {
        addUnknownReference(
          context,
          ["data", "classSessions", index, "timetableVersionId"],
          "timetable version",
        );
      }
    });
    data.attendanceRecords.forEach((record, index) => {
      if (!sessionIds.has(record.classSessionId)) {
        addUnknownReference(
          context,
          ["data", "attendanceRecords", index, "classSessionId"],
          "class session",
        );
      }
    });
    data.appSettings.forEach((settings, index) => {
      if (
        settings.activeProfileId &&
        !profileIds.has(settings.activeProfileId)
      ) {
        addUnknownReference(
          context,
          ["data", "appSettings", index, "activeProfileId"],
          "profile",
        );
      }
      if (
        settings.activeSemesterId &&
        !semesterIds.has(settings.activeSemesterId)
      ) {
        addUnknownReference(
          context,
          ["data", "appSettings", index, "activeSemesterId"],
          "semester",
        );
      }
    });
    data.recentActions.forEach((action, index) => {
      if (!profileIds.has(action.profileId)) {
        addUnknownReference(
          context,
          ["data", "recentActions", index, "profileId"],
          "profile",
        );
      }
      if (action.semesterId && !semesterIds.has(action.semesterId)) {
        addUnknownReference(
          context,
          ["data", "recentActions", index, "semesterId"],
          "semester",
        );
      }
    });
  });

export function parseAttendSafeBackup(input: unknown): AttendSafeBackup {
  return attendSafeBackupSchema.parse(input);
}

export function validateAttendSafeBackup(input: unknown) {
  return attendSafeBackupSchema.safeParse(input);
}

export const extractionSubjectSchema = z
  .object({
    temporaryId: z.string().trim().min(1).max(100),
    code: optionalModelTextSchema(500),
    name: z.string().trim().min(1).max(200),
    shortName: z.string().trim().min(1).max(40),
    credits: z.number().finite().min(0).max(100),
    classType: classTypeSchema,
    faculty: z.array(z.string().trim().min(1).max(100)),
    isZeroCredit: z.boolean(),
    confidence: confidenceSchema,
  })
  .strict();

export const extractionTimeSlotSchema = z
  .object({
    startTime: timeSchema,
    endTime: timeSchema,
    label: optionalModelTextSchema(500),
  })
  .strict()
  .superRefine((slot, context) => {
    if (slot.endTime <= slot.startTime) {
      context.addIssue({
        code: "custom",
        message: "Time slot end must be later than its start",
        path: ["endTime"],
      });
    }
  });

export const extractionTimetableSlotSchema = z
  .object({
    temporaryId: z.string().trim().min(1).max(100),
    subjectTemporaryId: optionalModelTextSchema(100),
    dayOfWeek: dayOfWeekSchema,
    startTime: timeSchema,
    endTime: timeSchema,
    faculty: z.array(z.string().trim().min(1).max(100)),
    room: optionalModelTextSchema(500),
    classType: classTypeSchema,
    batchOptions: z.array(z.string().trim().min(1).max(100)),
    electiveGroupId: optionalModelTextSchema(100),
    weekPattern: weekPatternSchema,
    customWeekPattern: optionalModelTextSchema(500),
    notes: optionalModelTextSchema(500),
    confidence: confidenceSchema,
    isEnabled: z.boolean().optional().default(true),
    isPlaceholder: z.boolean().optional().default(false),
    isBreak: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((slot, context) => {
    if (slot.endTime <= slot.startTime) {
      context.addIssue({
        code: "custom",
        message: "Timetable slot end must be later than its start",
        path: ["endTime"],
      });
    }
    if (!slot.subjectTemporaryId && !slot.isBreak && !slot.isPlaceholder) {
      context.addIssue({
        code: "custom",
        message: "A recognized class requires a subject reference",
        path: ["subjectTemporaryId"],
      });
    }
    if (slot.weekPattern === "CUSTOM" && !slot.customWeekPattern) {
      context.addIssue({
        code: "custom",
        message: "A custom week slot requires its recurrence rule",
        path: ["customWeekPattern"],
      });
    }
  });

export const detectedElectiveGroupSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(150),
    options: z
      .array(
        z
          .object({
            subjectTemporaryId: z.string().trim().min(1).max(100),
            label: z.string().trim().min(1).max(200),
          })
          .strict(),
      )
      .min(1),
    allowMultiple: z.boolean().optional(),
  })
  .strict();

export const ambiguousExtractionItemSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    field: z.string().trim().min(1).max(100),
    possibleValues: z.array(z.string().max(500)).min(1),
    sourceDescription: z.string().trim().min(1).max(500),
    confidence: confidenceSchema,
    resolvedValue: optionalModelTextSchema(500),
  })
  .strict();

export const timetableExtractionResultSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    timezone: timeZoneSchema,
    days: z.array(dayOfWeekSchema).min(1),
    timeSlots: z.array(extractionTimeSlotSchema),
    subjects: z.array(extractionSubjectSchema).min(1),
    timetableSlots: z.array(extractionTimetableSlotSchema).min(1),
    detectedBatchOptions: z.array(z.string().trim().min(1).max(100)),
    detectedElectiveGroups: z.array(detectedElectiveGroupSchema),
    ambiguousItems: z.array(ambiguousExtractionItemSchema),
    warnings: z.array(z.string().trim().min(1).max(1_000)),
    overallConfidence: confidenceSchema,
  })
  .strict()
  .superRefine((result, context) => {
    const subjectIds = new Set<string>();
    result.subjects.forEach((subject, index) => {
      if (subjectIds.has(subject.temporaryId)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate temporary subject id",
          path: ["subjects", index, "temporaryId"],
        });
      }
      subjectIds.add(subject.temporaryId);
    });
    const slotIds = new Set<string>();
    result.timetableSlots.forEach((slot, index) => {
      if (slotIds.has(slot.temporaryId)) {
        context.addIssue({
          code: "custom",
          message: "Duplicate temporary timetable slot id",
          path: ["timetableSlots", index, "temporaryId"],
        });
      }
      slotIds.add(slot.temporaryId);
      if (slot.subjectTemporaryId && !subjectIds.has(slot.subjectTemporaryId)) {
        context.addIssue({
          code: "custom",
          message: "Timetable slot references an unknown extracted subject",
          path: ["timetableSlots", index, "subjectTemporaryId"],
        });
      }
      if (!result.days.includes(slot.dayOfWeek)) {
        context.addIssue({
          code: "custom",
          message: "Timetable slot day is missing from the extracted day list",
          path: ["timetableSlots", index, "dayOfWeek"],
        });
      }
    });
    result.detectedElectiveGroups.forEach((group, groupIndex) => {
      group.options.forEach((option, optionIndex) => {
        if (!subjectIds.has(option.subjectTemporaryId)) {
          context.addIssue({
            code: "custom",
            message: "Elective option references an unknown extracted subject",
            path: [
              "detectedElectiveGroups",
              groupIndex,
              "options",
              optionIndex,
              "subjectTemporaryId",
            ],
          });
        }
      });
    });
  });

export type TimetableExtractionResult = NormalizedTimetableDraft;

export interface LowConfidenceExtractionItem {
  kind: "SUBJECT" | "TIMETABLE_SLOT" | "AMBIGUITY" | "OVERALL";
  id: string;
  confidence: number;
}

export function getLowConfidenceExtractionItems(
  extraction: TimetableExtractionResult,
  threshold = 0.75,
): LowConfidenceExtractionItem[] {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("Confidence threshold must be between 0 and 1");
  }

  const items: LowConfidenceExtractionItem[] = [];
  extraction.subjects.forEach((subject) => {
    if (subject.confidence < threshold) {
      items.push({
        kind: "SUBJECT",
        id: subject.temporaryId,
        confidence: subject.confidence,
      });
    }
  });
  extraction.timetableSlots.forEach((slot) => {
    if (slot.confidence < threshold) {
      items.push({
        kind: "TIMETABLE_SLOT",
        id: slot.temporaryId,
        confidence: slot.confidence,
      });
    }
  });
  extraction.ambiguousItems.forEach((item) => {
    if (item.confidence < threshold) {
      items.push({
        kind: "AMBIGUITY",
        id: item.id,
        confidence: item.confidence,
      });
    }
  });
  if (extraction.overallConfidence < threshold) {
    items.push({
      kind: "OVERALL",
      id: "overall",
      confidence: extraction.overallConfidence,
    });
  }
  return items;
}

export function requiresExtractionReview(
  extraction: TimetableExtractionResult,
  threshold = 0.75,
): boolean {
  return getLowConfidenceExtractionItems(extraction, threshold).length > 0;
}
