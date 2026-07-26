import { describe, expect, it } from "vitest";

import {
  basisPointsToPercentage,
  calculateAttendance,
  calculateAttendanceBuffer,
  calculateRecoveryClasses,
  calculateRequiredAttendanceForRemainingSessions,
  calculateSkippableClasses,
  classifyAttendanceCounts,
  classifyProjection,
  compareAttendanceToThreshold,
  countAttendanceRecords,
  countResolvedSessions,
  formatBasisPoints,
  isAttendanceAtOrAbove,
  projectMultipleSessions,
  projectSingleAttendance,
  resolveSubjectThresholds,
  summarizeSubjectAttendance,
} from "@/lib/attendance";
import type {
  AttendanceRecord,
  ClassSession,
  ResolvedSession,
  Semester,
  Subject,
} from "@/types/domain";

const NOW = "2026-07-23T10:00:00.000Z";

function resolvedSession(
  overrides: Partial<ResolvedSession> = {},
): ResolvedSession {
  return {
    id: "session-1",
    semesterId: "semester-1",
    subjectId: "subject-1",
    date: "2026-07-23",
    startTime: "09:00",
    endTime: "10:00",
    status: "HELD",
    source: "TIMETABLE",
    faculty: [],
    attendanceStatus: "NOT_MARKED",
    ...overrides,
  };
}

function classSession(overrides: Partial<ClassSession> = {}): ClassSession {
  return {
    id: "session-1",
    semesterId: "semester-1",
    subjectId: "subject-1",
    date: "2026-07-23",
    startTime: "09:00",
    endTime: "10:00",
    status: "HELD",
    source: "TIMETABLE",
    faculty: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function attendanceRecord(
  overrides: Partial<AttendanceRecord> = {},
): AttendanceRecord {
  return {
    id: "record-1",
    classSessionId: "session-1",
    status: "PRESENT",
    markedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function semester(overrides: Partial<Semester> = {}): Semester {
  return {
    id: "semester-1",
    profileId: "profile-1",
    name: "Semester 5",
    startDate: "2026-07-01",
    endDate: "2026-12-01",
    minimumAttendanceBasisPoints: 6_000,
    safetyTargetBasisPoints: 6_500,
    teachingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function subject(overrides: Partial<Subject> = {}): Subject {
  return {
    id: "subject-1",
    semesterId: "semester-1",
    code: "DSP501",
    name: "Digital Signal Processing",
    shortName: "DSP",
    credits: 4,
    classType: "THEORY",
    isZeroCredit: false,
    isEnabled: true,
    countsCancelledSessions: false,
    exemptPolicy: "EXCLUDED",
    initialHeld: 0,
    initialAttended: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("exact attendance calculations", () => {
  it("allows three skips for 14 attended out of 20 at 60%", () => {
    expect(calculateSkippableClasses(14, 20, 6_000)).toBe(3);
    expect(calculateAttendanceBuffer(14, 20, 6_000)).toBe(3);
  });

  it("allows no skips for 9 attended out of 15 at 60%", () => {
    expect(calculateSkippableClasses(9, 15, 6_000)).toBe(0);
  });

  it("allows exact threshold equality", () => {
    expect(compareAttendanceToThreshold(9, 15, 6_000)).toBe(0);
    expect(isAttendanceAtOrAbove(9, 15, 6_000)).toBe(true);
    expect(classifyAttendanceCounts(9, 15, 6_000, 6_500)).toBe("BORDERLINE");
  });

  it("calculates the consecutive recovery count below threshold", () => {
    expect(calculateRecoveryClasses(8, 15, 6_000)).toBe(3);
    expect(isAttendanceAtOrAbove(11, 18, 6_000)).toBe(true);
  });

  it("supports decimal percentage thresholds represented as basis points", () => {
    expect(compareAttendanceToThreshold(27, 40, 6_750)).toBe(0);
    expect(calculateSkippableClasses(28, 40, 6_750)).toBe(1);
    expect(calculateRecoveryClasses(26, 40, 6_750)).toBe(4);
  });

  it("returns no percentage when no classes have been held", () => {
    expect(calculateAttendance(0, 0)).toBeNull();
    expect(formatBasisPoints(null)).toBe("No classes held");
    expect(classifyProjection(null, 6_000, 6_500)).toBe("NO_DATA");
  });

  it("handles a 100% threshold", () => {
    expect(calculateSkippableClasses(20, 20, 10_000)).toBe(0);
    expect(calculateRecoveryClasses(19, 20, 10_000)).toBe(
      Number.POSITIVE_INFINITY,
    );
    expect(calculateRecoveryClasses(20, 20, 10_000)).toBe(0);
  });

  it("uses integer-safe arithmetic for large counts", () => {
    const count = Number.MAX_SAFE_INTEGER;
    expect(calculateAttendance(count, count)).toBe(10_000);
    expect(compareAttendanceToThreshold(count, count, 10_000)).toBe(0);
    expect(calculateSkippableClasses(count, count, 10_000)).toBe(0);
  });

  it("rejects invalid counts and thresholds", () => {
    expect(() => calculateAttendance(-1, 2)).toThrow(RangeError);
    expect(() => calculateAttendance(3, 2)).toThrow(RangeError);
    expect(() => calculateSkippableClasses(1, 2, 6_000.5)).toThrow(RangeError);
    expect(() => classifyProjection(6_000, 6_500, 6_000)).toThrow(RangeError);
  });

  it("projects one present or absent session explicitly", () => {
    expect(projectSingleAttendance(14, 20, "PRESENT")).toMatchObject({
      projectedAttended: 15,
      projectedHeld: 21,
      additionalAttended: 1,
      missedSessions: 0,
    });
    expect(projectSingleAttendance(14, 20, "ABSENT")).toMatchObject({
      projectedAttended: 14,
      projectedHeld: 21,
      additionalAttended: 0,
      missedSessions: 1,
    });
  });

  it("aggregates multiple outcomes before calculating a projection", () => {
    expect(projectMultipleSessions(14, 20, 2, 3)).toMatchObject({
      projectedAttended: 16,
      projectedHeld: 25,
      additionalAttended: 2,
      additionalHeld: 5,
      missedSessions: 3,
      projectedPercentageBasisPoints: 6_400,
    });
  });

  it("calculates the minimum attendances needed from remaining sessions", () => {
    expect(
      calculateRequiredAttendanceForRemainingSessions(9, 15, 5, 6_000),
    ).toBe(3);
    expect(
      calculateRequiredAttendanceForRemainingSessions(5, 20, 2, 7_500),
    ).toBe(Number.POSITIVE_INFINITY);
  });

  it("converts and formats basis points without floating-point calculation", () => {
    expect(basisPointsToPercentage(6_750)).toBe(67.5);
    expect(formatBasisPoints(6_750)).toBe("67.5%");
    expect(formatBasisPoints(6_667, 1)).toBe("66.7%");
  });
});

describe("session and attendance-record policies", () => {
  it("does not count cancelled sessions by default", () => {
    expect(
      countResolvedSessions({
        sessions: [
          resolvedSession({ status: "CANCELLED", attendanceStatus: "PRESENT" }),
        ],
      }),
    ).toMatchObject({ attended: 0, held: 0 });
  });

  it("does not count holidays", () => {
    expect(
      countResolvedSessions({
        sessions: [
          resolvedSession({ status: "HOLIDAY", attendanceStatus: "PRESENT" }),
        ],
      }),
    ).toMatchObject({ attended: 0, held: 0 });
  });

  it("increments both held and attended for present", () => {
    expect(
      countResolvedSessions({
        sessions: [resolvedSession({ attendanceStatus: "PRESENT" })],
      }),
    ).toMatchObject({ attended: 1, held: 1 });
  });

  it("increments only held for absent", () => {
    expect(
      countResolvedSessions({
        sessions: [resolvedSession({ attendanceStatus: "ABSENT" })],
      }),
    ).toMatchObject({ attended: 0, held: 1 });
  });

  it("respects both exempt policies", () => {
    const exempt = resolvedSession({ attendanceStatus: "EXEMPT" });
    expect(countResolvedSessions({ sessions: [exempt] })).toMatchObject({
      attended: 0,
      held: 0,
    });
    expect(
      countResolvedSessions({
        sessions: [exempt],
        policy: { exemptPolicy: "ATTENDED" },
      }),
    ).toMatchObject({ attended: 1, held: 1 });
  });

  it("uses the latest attendance record for a session", () => {
    expect(
      countAttendanceRecords({
        sessions: [classSession()],
        records: [
          attendanceRecord({
            status: "ABSENT",
            markedAt: "2026-07-23T09:00:00Z",
          }),
          attendanceRecord({
            id: "record-2",
            status: "PRESENT",
            markedAt: "2026-07-23T10:00:00Z",
          }),
        ],
      }),
    ).toMatchObject({ attended: 1, held: 1, countedSessions: 1 });
  });

  it("leaves not-marked sessions out until attendance is confirmed", () => {
    expect(
      countAttendanceRecords({ sessions: [classSession()], records: [] }),
    ).toMatchObject({ attended: 0, held: 0, excludedSessions: 1 });
  });

  it("can count a cancelled session when the subject policy enables it", () => {
    expect(
      countAttendanceRecords({
        sessions: [classSession({ status: "CANCELLED" })],
        records: [attendanceRecord({ status: "ABSENT" })],
        policy: { countsCancelledSessions: true },
      }),
    ).toMatchObject({ attended: 0, held: 1 });
  });

  it("counts an explicitly cancelled session even without an attendance mark when configured", () => {
    expect(
      countResolvedSessions({
        sessions: [resolvedSession({ status: "CANCELLED" })],
        policy: { countsCancelledSessions: true },
      }),
    ).toMatchObject({ attended: 0, held: 1 });
  });

  it("still lets the exempt policy exclude a configured cancelled session", () => {
    expect(
      countResolvedSessions({
        sessions: [
          resolvedSession({
            status: "CANCELLED",
            attendanceStatus: "EXEMPT",
          }),
        ],
        policy: {
          countsCancelledSessions: true,
          exemptPolicy: "EXCLUDED",
        },
      }),
    ).toMatchObject({ attended: 0, held: 0 });
  });
});

describe("subject summaries", () => {
  it("gives a subject override precedence over semester thresholds", () => {
    expect(
      resolveSubjectThresholds(
        subject({
          minimumAttendanceBasisPointsOverride: 7_000,
          safetyTargetBasisPointsOverride: 7_500,
        }),
        semester(),
      ),
    ).toEqual({ minimumBasisPoints: 7_000, safetyBasisPoints: 7_500 });
  });

  it("combines mid-semester initial counts with marked sessions", () => {
    expect(
      summarizeSubjectAttendance({
        subject: subject({ initialAttended: 14, initialHeld: 20 }),
        semester: semester(),
        sessions: [resolvedSession({ attendanceStatus: "ABSENT" })],
      }),
    ).toEqual({
      subjectId: "subject-1",
      held: 21,
      attended: 14,
      percentageBasisPoints: 6_667,
      minimumBasisPoints: 6_000,
      safetyBasisPoints: 6_500,
    });
  });
});
