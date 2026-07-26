import { describe, expect, it } from "vitest";

import { createDemoTimetable } from "@/lib/demo";
import {
  attendSafeBackupSchema,
  getLowConfidenceExtractionItems,
  parseAttendSafeBackup,
  requiresExtractionReview,
  subjectSchema,
  timetableExtractionResultSchema,
  timetableSlotSchema,
} from "@/lib/validation";
import type { AttendSafeBackup } from "@/types/domain";
import type { NormalizedTimetableDraft } from "@/types/draft";

function validExtraction(): NormalizedTimetableDraft {
  return {
    title: "ECE Semester 5",
    timezone: "Asia/Kolkata",
    days: ["MONDAY"],
    timeSlots: [{ startTime: "09:00", endTime: "10:00", label: "Period 1" }],
    subjects: [
      {
        temporaryId: "subject_1",
        code: "BEC501",
        name: "Integrated Circuits",
        shortName: "IC",
        credits: 3,
        classType: "THEORY",
        faculty: ["PJ"],
        isZeroCredit: false,
        confidence: 0.94,
      },
    ],
    timetableSlots: [
      {
        temporaryId: "slot_1",
        subjectTemporaryId: "subject_1",
        dayOfWeek: "MONDAY",
        startTime: "09:00",
        endTime: "10:00",
        faculty: ["PJ"],
        room: "AB-304",
        classType: "THEORY",
        batchOptions: [],
        weekPattern: "EVERY_WEEK",
        confidence: 0.91,
        isEnabled: true,
        isPlaceholder: false,
        isBreak: false,
      },
    ],
    detectedBatchOptions: [],
    detectedElectiveGroups: [],
    ambiguousItems: [],
    warnings: [],
    overallConfidence: 0.87,
  };
}

function validBackup(): AttendSafeBackup {
  const demo = createDemoTimetable();
  return {
    schemaVersion: 1,
    exportedAt: "2026-07-23T08:00:00.000Z",
    product: "AttendSafe",
    data: {
      profiles: [demo.profile],
      semesters: [demo.semester],
      timetables: [demo.timetable],
      timetableVersions: [demo.timetableVersion],
      subjects: demo.subjects,
      electiveGroups: demo.electiveGroups,
      timetableSlots: demo.timetableSlots,
      academicExceptions: demo.academicExceptions,
      classSessions: [],
      attendanceRecords: [],
      appSettings: [demo.appSettings],
      recentActions: [],
    },
  };
}

describe("strict normalized extraction validation", () => {
  it("accepts a complete normalized timetable draft", () => {
    const parsed = timetableExtractionResultSchema.parse(validExtraction());
    expect(parsed).toEqual(validExtraction());
  });

  it("rejects unknown model response fields instead of silently trusting them", () => {
    const extraction = {
      ...validExtraction(),
      inventedByModel: true,
    };
    expect(timetableExtractionResultSchema.safeParse(extraction).success).toBe(
      false,
    );
  });

  it("normalizes model nulls for optional draft fields", () => {
    const extraction = validExtraction();
    const modelPayload = {
      ...extraction,
      timetableSlots: [
        {
          ...extraction.timetableSlots[0],
          electiveGroupId: null,
          customWeekPattern: null,
          notes: null,
        },
      ],
    };
    const parsed = timetableExtractionResultSchema.parse(modelPayload);
    expect(parsed.timetableSlots[0].electiveGroupId).toBeUndefined();
    expect(parsed.timetableSlots[0].notes).toBeUndefined();
  });

  it("rejects dangling temporary subject references", () => {
    const extraction = validExtraction();
    extraction.timetableSlots[0].subjectTemporaryId = "missing_subject";
    const result = timetableExtractionResultSchema.safeParse(extraction);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) =>
          issue.path.join(".").includes("subjectTemporaryId"),
        ),
      ).toBe(true);
    }
  });

  it("reports every confidence item below the review threshold", () => {
    const extraction = validExtraction();
    extraction.subjects[0].confidence = 0.7;
    extraction.timetableSlots[0].confidence = 0.74;
    extraction.overallConfidence = 0.72;

    expect(getLowConfidenceExtractionItems(extraction)).toEqual([
      { kind: "SUBJECT", id: "subject_1", confidence: 0.7 },
      { kind: "TIMETABLE_SLOT", id: "slot_1", confidence: 0.74 },
      { kind: "OVERALL", id: "overall", confidence: 0.72 },
    ]);
    expect(requiresExtractionReview(extraction)).toBe(true);
  });
});

describe("domain and backup validation", () => {
  it("accepts a relationally complete AttendSafe backup", () => {
    const backup = validBackup();
    expect(parseAttendSafeBackup(backup)).toEqual(backup);
  });

  it("rejects a corrupt backup with a dangling profile relationship", () => {
    const backup = validBackup();
    backup.data.semesters[0].profileId = "00000000-0000-4000-8000-999999999999";
    const result = attendSafeBackupSchema.safeParse(backup);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) => issue.path.join(".") === "data.semesters.0.profileId",
        ),
      ).toBe(true);
    }
  });

  it("rejects mid-semester attendance where attended exceeds held", () => {
    const demo = createDemoTimetable();
    const result = subjectSchema.safeParse({
      ...demo.subjects[0],
      initialHeld: 5,
      initialAttended: 6,
    });
    expect(result.success).toBe(false);
  });

  it("requires slot end times to follow start times", () => {
    const demo = createDemoTimetable();
    const result = timetableSlotSchema.safeParse({
      ...demo.timetableSlots[0],
      startTime: "10:00",
      endTime: "09:00",
    });
    expect(result.success).toBe(false);
  });

  it("rejects extra keys throughout imported domain objects", () => {
    const backup = validBackup();
    const corrupt = {
      ...backup,
      data: {
        ...backup.data,
        profiles: [
          { ...backup.data.profiles[0], password: "should-not-exist" },
        ],
      },
    };
    expect(attendSafeBackupSchema.safeParse(corrupt).success).toBe(false);
  });
});
