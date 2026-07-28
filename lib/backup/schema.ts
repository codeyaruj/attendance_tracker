import { z } from "zod";
import {
  academicExceptionSchema,
  appSettingsSchema,
  attendanceRecordSchema,
  classSessionSchema,
  electiveGroupSchema,
  idSchema,
  isoDateTimeSchema,
  profileSchema,
  recentActionSchema,
  semesterSchema,
  subjectSchema,
  timetableSchema,
  timetableSlotSchema,
  timetableVersionSchema,
} from "@/lib/validation";
import { BACKUP_LIMITS } from "@/lib/validation/backup-limits";

export const BACKUP_FORMAT = "attendance-tracker-backup" as const;
export const BACKUP_FORMAT_VERSION = 3;
export const BACKUP_SCHEMA_VERSION = BACKUP_FORMAT_VERSION;
export const SUPPORTED_LEGACY_BACKUP_VERSIONS = [1, 2] as const;

const backupText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value === value.trim(), "Unexpected surrounding spaces");

export const serializedUploadReferenceSchema = z
  .object({
    id: idSchema,
    profileId: idSchema.optional(),
    semesterId: idSchema.optional(),
    filename: backupText(BACKUP_LIMITS.maxShortStringLength),
    mediaType: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "application/pdf",
    ]),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(BACKUP_LIMITS.maxEmbeddedBlobBytes),
    blobBase64: z
      .string()
      .max(Math.ceil((BACKUP_LIMITS.maxEmbeddedBlobBytes * 4) / 3) + 4)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
        "Invalid base64 data",
      ),
    rotation: z.union([
      z.literal(0),
      z.literal(90),
      z.literal(180),
      z.literal(270),
    ]),
    zoom: z.number().finite().min(0.25).max(4),
    crop: z
      .object({
        top: z.number().finite().min(0).max(50),
        right: z.number().finite().min(0).max(50),
        bottom: z.number().finite().min(0).max(50),
        left: z.number().finite().min(0).max(50),
      })
      .strict(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export const canonicalBackupDataSchema = z
  .object({
    profiles: z.array(profileSchema).max(BACKUP_LIMITS.maxProfiles),
    semesters: z.array(semesterSchema).max(BACKUP_LIMITS.maxSemesters),
    timetables: z.array(timetableSchema).max(BACKUP_LIMITS.maxTimetables),
    timetableVersions: z
      .array(timetableVersionSchema)
      .max(BACKUP_LIMITS.maxTimetableVersions),
    subjects: z.array(subjectSchema).max(BACKUP_LIMITS.maxSubjects),
    electiveGroups: z
      .array(electiveGroupSchema)
      .max(BACKUP_LIMITS.maxElectiveGroups),
    timetableSlots: z
      .array(timetableSlotSchema)
      .max(BACKUP_LIMITS.maxTimetableSlots),
    academicExceptions: z
      .array(academicExceptionSchema)
      .max(BACKUP_LIMITS.maxAcademicExceptions),
    classSessions: z
      .array(classSessionSchema)
      .max(BACKUP_LIMITS.maxClassSessions),
    attendanceRecords: z
      .array(attendanceRecordSchema)
      .max(BACKUP_LIMITS.maxAttendanceRecords),
    appSettings: z.array(appSettingsSchema).length(1),
    recentActions: z
      .array(recentActionSchema)
      .max(BACKUP_LIMITS.maxRecentActions),
    uploadedTimetableReferences: z
      .array(serializedUploadReferenceSchema)
      .max(BACKUP_LIMITS.maxUploadReferences),
  })
  .strict();

export const attendSafeBackupSchema = z
  .object({
    format: z.literal(BACKUP_FORMAT),
    version: z.literal(BACKUP_FORMAT_VERSION),
    exportedAt: isoDateTimeSchema,
    appVersion: backupText(50),
    data: canonicalBackupDataSchema,
  })
  .strict();

const legacyElectiveGroupSchema = z
  .object({
    id: idSchema,
    semesterId: idSchema,
    name: z.string().min(1).max(150),
    options: z.array(
      z
        .object({ subjectId: idSchema, label: z.string().min(1).max(200) })
        .strict(),
    ),
    selectedSubjectIds: z.array(idSchema),
    allowMultiple: z.boolean().optional(),
    createdAt: isoDateTimeSchema,
    updatedAt: isoDateTimeSchema,
  })
  .strict();

const legacySettingsSchema = z
  .object({
    id: z.literal("app"),
    activeProfileId: idSchema.optional(),
    activeSemesterId: idSchema.optional(),
    theme: z.enum(["LIGHT", "DARK", "SYSTEM"]),
    selectedBatch: z.string().min(1).max(500).optional(),
    selectedBatches: z.array(z.string().min(1).max(500)).max(100).optional(),
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
    includeZeroCredit: z.boolean().optional(),
    offlineReady: z.boolean(),
    notificationsPrepared: z.boolean(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

const legacyDataShape = {
  profiles: z.array(profileSchema).max(BACKUP_LIMITS.maxProfiles),
  semesters: z.array(semesterSchema).max(BACKUP_LIMITS.maxSemesters),
  timetables: z.array(timetableSchema).max(BACKUP_LIMITS.maxTimetables),
  timetableVersions: z
    .array(timetableVersionSchema)
    .max(BACKUP_LIMITS.maxTimetableVersions),
  subjects: z.array(subjectSchema).max(BACKUP_LIMITS.maxSubjects),
  electiveGroups: z
    .array(legacyElectiveGroupSchema)
    .max(BACKUP_LIMITS.maxElectiveGroups),
  timetableSlots: z
    .array(timetableSlotSchema)
    .max(BACKUP_LIMITS.maxTimetableSlots),
  academicExceptions: z
    .array(academicExceptionSchema)
    .max(BACKUP_LIMITS.maxAcademicExceptions),
  classSessions: z
    .array(classSessionSchema)
    .max(BACKUP_LIMITS.maxClassSessions),
  attendanceRecords: z
    .array(attendanceRecordSchema)
    .max(BACKUP_LIMITS.maxAttendanceRecords),
  appSettings: z.array(legacySettingsSchema).length(1),
  recentActions: z
    .array(recentActionSchema)
    .max(BACKUP_LIMITS.maxRecentActions),
};

export const legacyBackupV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: isoDateTimeSchema,
    product: z.literal("AttendSafe"),
    data: z.object(legacyDataShape).strict(),
  })
  .strict();

export const legacyBackupV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    exportedAt: isoDateTimeSchema,
    product: z.literal("AttendSafe"),
    data: z
      .object({
        ...legacyDataShape,
        uploadedTimetableReferences: z
          .array(serializedUploadReferenceSchema)
          .max(BACKUP_LIMITS.maxUploadReferences),
      })
      .strict(),
  })
  .strict();

export const backupHeaderSchema = z.union([
  z
    .object({ format: z.literal(BACKUP_FORMAT), version: z.number().int() })
    .passthrough(),
  z
    .object({
      product: z.literal("AttendSafe"),
      schemaVersion: z.number().int(),
    })
    .passthrough(),
]);

export type SerializedUploadedTimetableReference = z.infer<
  typeof serializedUploadReferenceSchema
>;
export type CanonicalBackupData = z.infer<typeof canonicalBackupDataSchema>;
export type AttendSafeBackupFile = z.infer<typeof attendSafeBackupSchema>;
