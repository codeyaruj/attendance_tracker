import { describe, expect, it } from "vitest";

import {
  planFullDaySkip,
  rankSafestClasses,
  selectRecurringWeekdaySessions,
  simulateAbsencesBySubject,
  simulateDateRange,
  simulateRecurringWeekday,
  simulateSessionOutcomesBySubject,
} from "@/lib/attendance";
import type {
  ResolvedSession,
  Subject,
  SubjectAttendanceSummary,
} from "@/types/domain";

const NOW = "2026-07-23T10:00:00.000Z";

function summary(
  subjectId: string,
  attended: number,
  held: number,
  minimumBasisPoints = 6_000,
  safetyBasisPoints = 6_500,
): SubjectAttendanceSummary {
  return {
    subjectId,
    attended,
    held,
    percentageBasisPoints:
      held === 0 ? null : Math.round((attended * 10_000) / held),
    minimumBasisPoints,
    safetyBasisPoints,
  };
}

function session(
  id: string,
  subjectId: string,
  date: string,
  startTime: string,
  overrides: Partial<ResolvedSession> = {},
): ResolvedSession {
  return {
    id,
    semesterId: "semester-1",
    subjectId,
    date,
    startTime,
    endTime: "10:00",
    status: "SCHEDULED",
    source: "TIMETABLE",
    faculty: [],
    attendanceStatus: "NOT_MARKED",
    ...overrides,
  };
}

function subject(id: string, overrides: Partial<Subject> = {}): Subject {
  return {
    id,
    semesterId: "semester-1",
    name: id,
    shortName: id,
    credits: 3,
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

describe("combined skip simulation", () => {
  it("marks an entire day safe when every affected subject remains safe", () => {
    const plan = planFullDaySkip({
      summaries: [summary("DSP", 16, 20)],
      sessions: [session("dsp-1", "DSP", "2026-07-24", "09:00")],
    });

    expect(plan.outcome).toBe("SAFE_TO_SKIP");
    expect(plan.meetsMinimum).toBe(true);
    expect(plan.meetsSafetyTarget).toBe(true);
    expect(plan.mustAttendSessions).toEqual([]);
  });

  it("marks an entire day unsafe because of one subject", () => {
    const plan = planFullDaySkip({
      summaries: [summary("SAFE", 18, 20), summary("RISK", 9, 15)],
      sessions: [
        session("safe-1", "SAFE", "2026-07-24", "09:00"),
        session("risk-1", "RISK", "2026-07-24", "10:00"),
      ],
    });

    expect(plan.meetsMinimum).toBe(false);
    expect(plan.overallClassification).toBe("UNSAFE");
    expect(plan.mustAttendSessions.map(({ id }) => id)).toEqual(["risk-1"]);
  });

  it("returns the deterministic minimum must-attend subset", () => {
    const plan = planFullDaySkip({
      summaries: [summary("A", 9, 15), summary("B", 13, 20)],
      sessions: [
        session("b-late", "B", "2026-07-24", "14:00"),
        session("a-late", "A", "2026-07-24", "11:00"),
        session("b-early", "B", "2026-07-24", "08:00"),
        session("a-early", "A", "2026-07-24", "09:00"),
      ],
    });

    expect(plan.outcome).toBe("ATTEND_SPECIFIC_CLASSES");
    expect(plan.feasible).toBe(true);
    expect(plan.mustAttendSessions.map(({ id }) => id)).toEqual([
      "a-early",
      "a-late",
      "b-early",
    ]);
    expect(plan.sessionsSafeToSkip.map(({ id }) => id)).toEqual(["b-late"]);
    expect(plan.adjustedSimulation.meetsMinimum).toBe(true);
    expect(plan.adjustedSimulation.subjectProjections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          subjectId: "A",
          projectedAttended: 11,
          projectedHeld: 17,
        }),
        expect.objectContaining({
          subjectId: "B",
          projectedAttended: 14,
          projectedHeld: 22,
        }),
      ]),
    );
  });

  it("breaks equal-risk recommendation ties chronologically", () => {
    const plan = planFullDaySkip({
      summaries: [summary("A", 9, 15), summary("B", 9, 15)],
      sessions: [
        session("a-late", "A", "2026-07-24", "11:00"),
        session("b-early", "B", "2026-07-24", "09:00"),
      ],
    });
    expect(plan.mustAttendSessions.map(({ id }) => id)).toEqual([
      "b-early",
      "a-late",
    ]);
  });

  it("aggregates all selected absences by subject", () => {
    const result = simulateAbsencesBySubject({
      summaries: [summary("DSP", 14, 20)],
      sessions: [
        session("dsp-1", "DSP", "2026-07-24", "09:00"),
        session("dsp-2", "DSP", "2026-07-24", "11:00"),
        session("dsp-3", "DSP", "2026-07-25", "09:00"),
        session("dsp-4", "DSP", "2026-07-27", "09:00"),
      ],
    });

    expect(result.subjectProjections).toHaveLength(1);
    expect(result.subjectProjections[0]).toMatchObject({
      missedSessions: 4,
      projectedAttended: 14,
      projectedHeld: 24,
      classification: "UNSAFE",
    });
  });

  it("counts two classes of the same subject on one day twice", () => {
    const result = simulateAbsencesBySubject({
      summaries: [summary("LAB", 18, 20)],
      sessions: [
        session("lab-1", "LAB", "2026-07-24", "09:00"),
        session("lab-2", "LAB", "2026-07-24", "10:00"),
      ],
    });
    expect(result.subjectProjections[0]).toMatchObject({
      missedSessions: 2,
      projectedHeld: 22,
    });
  });

  it("can project a mixed plan of attended and skipped sessions", () => {
    const attended = session("attend", "DSP", "2026-07-24", "09:00");
    const absent = session("skip", "DSP", "2026-07-24", "10:00");
    const result = simulateSessionOutcomesBySubject({
      summaries: [summary("DSP", 9, 15)],
      attendedSessions: [attended],
      absentSessions: [absent],
    });
    expect(result.subjectProjections[0]).toMatchObject({
      projectedAttended: 10,
      projectedHeld: 17,
      missedSessions: 1,
    });
  });
});

describe("date range and recurring weekday plans", () => {
  const sessions = [
    session("fri-1", "DSP", "2026-07-24", "09:00"),
    session("mon-1", "DSP", "2026-07-27", "09:00"),
    session("fri-2", "DSP", "2026-07-31", "09:00"),
    session("fri-3", "DSP", "2026-08-07", "09:00"),
    session("outside", "DSP", "2026-08-14", "09:00"),
  ];

  it("combines every absence inside a date range", () => {
    const result = simulateDateRange({
      summaries: [summary("DSP", 14, 20)],
      sessions,
      startDate: "2026-07-24",
      endDate: "2026-08-07",
    });
    expect(result.subjectProjections[0]).toMatchObject({
      missedSessions: 4,
      projectedHeld: 24,
      classification: "UNSAFE",
    });
  });

  it("selects and simulates only the requested recurring weekday", () => {
    expect(
      selectRecurringWeekdaySessions({
        sessions,
        startDate: "2026-07-24",
        endDate: "2026-08-07",
        weekday: "FRIDAY",
      }).map(({ id }) => id),
    ).toEqual(["fri-1", "fri-2", "fri-3"]);

    const result = simulateRecurringWeekday({
      summaries: [summary("DSP", 14, 20)],
      sessions,
      startDate: "2026-07-24",
      endDate: "2026-08-07",
      weekday: "FRIDAY",
    });
    expect(result.subjectProjections[0]).toMatchObject({
      missedSessions: 3,
      projectedHeld: 23,
      classification: "CAUTION",
    });
  });

  it("supports including only selected recurring classes", () => {
    const result = simulateRecurringWeekday({
      summaries: [summary("DSP", 14, 20)],
      sessions,
      startDate: "2026-07-24",
      endDate: "2026-08-07",
      weekday: "FRIDAY",
      includeSessionIds: ["fri-1", "fri-3"],
    });
    expect(result.subjectProjections[0].missedSessions).toBe(2);
  });
});

describe("future-session eligibility and safe rankings", () => {
  it("does not simulate a cancelled future class as an absence", () => {
    const cancelled = session("cancelled", "DSP", "2026-07-24", "09:00", {
      status: "CANCELLED",
    });
    const result = simulateAbsencesBySubject({
      summaries: [summary("DSP", 9, 15)],
      sessions: [cancelled],
    });
    expect(result.selectedSessions).toEqual([]);
    expect(result.ignoredSessions).toEqual([cancelled]);
    expect(result.subjectProjections).toEqual([]);
  });

  it("includes an extra class", () => {
    const extra = session("extra", "DSP", "2026-07-24", "09:00", {
      status: "EXTRA",
      source: "EXTRA",
    });
    const result = simulateAbsencesBySubject({
      summaries: [summary("DSP", 9, 15)],
      sessions: [extra],
    });
    expect(result.selectedSessions).toEqual([extra]);
    expect(result.subjectProjections[0]).toMatchObject({
      missedSessions: 1,
      projectedHeld: 16,
    });
  });

  it("never ranks a class whose absence drops the subject below minimum", () => {
    const ranked = rankSafestClasses({
      summaries: [summary("SAFE", 18, 20), summary("RISK", 9, 15)],
      sessions: [
        session("safe", "SAFE", "2026-07-24", "09:00"),
        session("risk", "RISK", "2026-07-24", "10:00"),
      ],
    });
    expect(
      ranked.map(({ session: rankedSession }) => rankedSession.id),
    ).toEqual(["safe"]);
  });

  it("ranks by safety margin and applies subject filters", () => {
    const ranked = rankSafestClasses({
      summaries: [summary("HIGH", 19, 20), summary("MEDIUM", 16, 20)],
      sessions: [
        session("medium", "MEDIUM", "2026-07-24", "09:00"),
        session("high", "HIGH", "2026-07-24", "10:00"),
        session("lab", "LAB", "2026-07-24", "11:00"),
      ],
      subjects: [
        subject("HIGH"),
        subject("MEDIUM"),
        subject("LAB", { classType: "LAB" }),
      ],
      filters: { excludeLabs: true },
    });
    expect(
      ranked.map(({ session: rankedSession }) => rankedSession.id),
    ).toEqual(["high", "medium"]);
    expect(ranked.map(({ rank }) => rank)).toEqual([1, 2]);
  });
});
