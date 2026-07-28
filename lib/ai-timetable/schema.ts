import { z } from "zod";

export const AI_TIMETABLE_LIMITS = {
  maximumImageBytes: 8 * 1024 * 1024,
  maximumHintsBytes: 32 * 1024,
  maximumRawTextCharacters: 12_000,
  timeoutMs: 600_000,
} as const;

export const AI_TIMETABLE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const aiErrorCodeSchema = z.enum([
  "METHOD_NOT_ALLOWED",
  "INVALID_CONTENT_TYPE",
  "MISSING_IMAGE",
  "UNSUPPORTED_IMAGE_TYPE",
  "IMAGE_TOO_LARGE",
  "INVALID_HINTS",
  "AI_NOT_CONFIGURED",
  "AI_RATE_LIMITED",
  "AI_TIMEOUT",
  "AI_PROVIDER_ERROR",
  "AI_PROVIDER_UNAVAILABLE",
  "AI_INVALID_RESPONSE",
  "NO_TIMETABLE_DETECTED",
]);
export type AiErrorCode = z.infer<typeof aiErrorCodeSchema>;

const nullableText = (maximum: number) =>
  z.string().trim().min(1).max(maximum).nullable();
const textList = z.array(z.string().trim().min(1).max(100)).max(20);

export const aiTimetableSessionSchema = z
  .object({
    day: z.enum([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]),
    startTime: z.string().max(20),
    endTime: z.string().max(20),
    subjectCode: nullableText(60),
    subjectName: z.string().trim().min(1).max(200),
    facultyCodes: textList,
    facultyNames: textList,
    room: nullableText(100),
    type: z.enum([
      "lecture",
      "lab",
      "tutorial",
      "project",
      "assessment",
      "other",
    ]),
    batchTags: textList,
    electiveTags: textList,
    sectionTags: textList,
    sourceText: nullableText(300),
    confidence: z.number().finite().min(0).max(1),
    notes: nullableText(300),
  })
  .strict();

export const geminiTimetableResponseSchema = z
  .object({
    sessions: z.array(aiTimetableSessionSchema).max(500),
    warnings: z.array(z.string().trim().min(1).max(500)).max(100),
  })
  .strict();
export type GeminiTimetableResponse = z.infer<
  typeof geminiTimetableResponseSchema
>;

export const localExtractionHintsSchema = z
  .object({
    rawText: z
      .string()
      .max(AI_TIMETABLE_LIMITS.maximumRawTextCharacters)
      .optional(),
    detectedDays: z.array(z.string().max(20)).max(7).optional(),
    detectedTimes: z
      .array(
        z
          .object({
            startTime: z.string().max(20).optional(),
            endTime: z.string().max(20).optional(),
            rawText: z.string().max(120).optional(),
          })
          .strict(),
      )
      .max(40)
      .optional(),
    warnings: z.array(z.string().max(300)).max(30).optional(),
    section: nullableText(100).optional(),
    batch: nullableText(100).optional(),
    elective: nullableText(100).optional(),
  })
  .strict();
export type LocalExtractionHints = z.infer<typeof localExtractionHintsSchema>;

export const aiTimetableSchema = z
  .object({
    document: z
      .object({
        institution: nullableText(200),
        department: nullableText(200),
        programme: nullableText(200),
        semester: nullableText(100),
        section: nullableText(100),
        room: nullableText(100),
        academicYear: nullableText(50),
      })
      .strict(),
    timeSlots: z
      .array(
        z
          .object({
            startTime: z.string().max(20),
            endTime: z.string().max(20),
            sourceText: nullableText(200),
          })
          .strict(),
      )
      .max(80),
    subjects: z
      .array(
        z
          .object({
            code: nullableText(60),
            name: z.string().trim().min(1).max(200),
            facultyCodes: textList,
            facultyNames: textList,
            room: nullableText(100),
          })
          .strict(),
      )
      .max(150),
    sessions: z.array(aiTimetableSessionSchema).max(500),
    warnings: z.array(z.string().trim().min(1).max(500)).max(100),
  })
  .strict();

export type AiTimetable = z.infer<typeof aiTimetableSchema>;

export const aiSuccessResponseSchema = z
  .object({ ok: z.literal(true), data: aiTimetableSchema })
  .strict();
export const aiFailureResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: aiErrorCodeSchema,
        message: z.string().min(1).max(500),
        retryable: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();
export const aiResponseSchema = z.union([
  aiSuccessResponseSchema,
  aiFailureResponseSchema,
]);
export type AiTimetableResponse = z.infer<typeof aiResponseSchema>;
