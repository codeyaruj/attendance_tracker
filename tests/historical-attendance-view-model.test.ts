import { describe, expect, it } from "vitest";

import {
  resolveSnapshotHistoricalSessionsInRange,
  unmarkedHistoricalSessions,
} from "@/components/attendance/attendance-view-model";
import type { AttendSafeSnapshot } from "@/db";
import { createDemoTimetable } from "@/lib/demo";

function demoSnapshot(): AttendSafeSnapshot {
  const demo = createDemoTimetable();
  return {
    profiles: [demo.profile],
    activeProfile: demo.profile,
    semesters: [demo.semester],
    activeSemester: demo.semester,
    timetables: [demo.timetable],
    timetableVersions: [demo.timetableVersion],
    subjects: demo.subjects,
    electiveGroups: demo.electiveGroups,
    timetableSlots: demo.timetableSlots,
    academicExceptions: demo.academicExceptions,
    classSessions: [],
    attendanceRecords: [],
    uploadedTimetableReferences: [],
    recentActions: [],
    settings: demo.appSettings,
  };
}

describe("historical attendance completeness", () => {
  it("warns for past unknown sessions and clears once every one is resolved", () => {
    const snapshot = demoSnapshot();
    const today = "2026-07-23";
    const historicalSessions = resolveSnapshotHistoricalSessionsInRange(
      snapshot,
      snapshot.activeSemester!.startDate,
      "2026-07-22",
    ).filter(
      (session) =>
        session.status !== "CANCELLED" &&
        session.status !== "HOLIDAY" &&
        session.status !== "NOT_CONDUCTED",
    );

    expect(unmarkedHistoricalSessions(snapshot, today)).toHaveLength(
      historicalSessions.length,
    );
    expect(historicalSessions.length).toBeGreaterThan(0);

    const markedSnapshot: AttendSafeSnapshot = {
      ...snapshot,
      attendanceRecords: historicalSessions.map((session, index) => ({
        id: `attendance-${index}`,
        classSessionId: session.id,
        status: "PRESENT",
        markedAt: "2026-07-23T00:00:00.000Z",
        createdAt: "2026-07-23T00:00:00.000Z",
        updatedAt: "2026-07-23T00:00:00.000Z",
      })),
    };

    expect(unmarkedHistoricalSessions(markedSnapshot, today)).toHaveLength(0);
  });
});
