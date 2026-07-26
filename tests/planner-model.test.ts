import { describe, expect, it } from "vitest";

import {
  addIsoDays,
  buildPlannerSimulation,
  buildSafestWeekRanking,
  findSafestDay,
  selectPlannerSessions,
} from "@/components/planner/planner-model";
import type {
  ResolvedSession,
  Subject,
  SubjectAttendanceSummary,
} from "@/types/domain";

const timestamp = "2026-07-23T10:00:00.000Z";

function summary(
  subjectId: string,
  attended: number,
  held: number,
): SubjectAttendanceSummary {
  return {
    subjectId,
    attended,
    held,
    percentageBasisPoints: Math.round((attended * 10_000) / held),
    minimumBasisPoints: 6_000,
    safetyBasisPoints: 6_500,
  };
}

function session(
  id: string,
  subjectId: string,
  date: string,
  startTime = "09:00",
): ResolvedSession {
  return {
    id,
    semesterId: "semester",
    subjectId,
    date,
    startTime,
    endTime: "10:00",
    status: "SCHEDULED",
    source: "TIMETABLE",
    faculty: [],
    attendanceStatus: "NOT_MARKED",
  };
}

function subject(id: string, overrides: Partial<Subject> = {}): Subject {
  return {
    id,
    semesterId: "semester",
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
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

const sessions = [
  session("fri-a", "A", "2026-07-24", "09:00"),
  session("fri-b", "B", "2026-07-24", "11:00"),
  session("mon-a", "A", "2026-07-27", "09:00"),
  session("fri-a-2", "A", "2026-07-31", "09:00"),
];

describe("planner mode selection", () => {
  it("selects one class, a whole day, and explicit classes", () => {
    expect(
      selectPlannerSessions({
        mode: "SINGLE",
        sessions,
        singleSessionId: "mon-a",
      }).map(({ id }) => id),
    ).toEqual(["mon-a"]);
    expect(
      selectPlannerSessions({
        mode: "DAY",
        sessions,
        selectedDate: "2026-07-24",
      }).map(({ id }) => id),
    ).toEqual(["fri-a", "fri-b"]);
    expect(
      selectPlannerSessions({
        mode: "SELECTED",
        sessions,
        selectedSessionIds: ["fri-b", "fri-a-2"],
      }).map(({ id }) => id),
    ).toEqual(["fri-b", "fri-a-2"]);
  });

  it("selects a date range and recurring weekday with subject exclusions", () => {
    expect(
      selectPlannerSessions({
        mode: "RANGE",
        sessions,
        startDate: "2026-07-24",
        endDate: "2026-07-27",
      }).map(({ id }) => id),
    ).toEqual(["fri-a", "fri-b", "mon-a"]);
    expect(
      selectPlannerSessions({
        mode: "WEEKDAY",
        sessions,
        startDate: "2026-07-24",
        endDate: "2026-07-31",
        weekday: "FRIDAY",
        includeSubjectIds: ["A"],
        excludeSessionIds: ["fri-a"],
      }).map(({ id }) => id),
    ).toEqual(["fri-a-2"]);
  });
});

describe("planner projections", () => {
  it("aggregates a selected set instead of treating each absence independently", () => {
    const plan = buildPlannerSimulation({
      mode: "SELECTED",
      summaries: [summary("A", 14, 20)],
      sessions,
      selectedSessionIds: ["fri-a", "mon-a", "fri-a-2"],
    });
    expect(plan.simulation.subjectProjections[0]).toMatchObject({
      missedSessions: 3,
      projectedAttended: 14,
      projectedHeld: 23,
      classification: "CAUTION",
    });
  });

  it("persists only the safe subset when a whole day needs must-attend classes", () => {
    const plan = buildPlannerSimulation({
      mode: "DAY",
      summaries: [summary("A", 18, 20), summary("B", 9, 15)],
      sessions,
      selectedDate: "2026-07-24",
    });
    expect(plan.fullDayPlan?.outcome).toBe("ATTEND_SPECIFIC_CLASSES");
    expect(plan.fullDayPlan?.mustAttendSessions.map(({ id }) => id)).toEqual([
      "fri-b",
    ]);
    expect(plan.persistenceSessions.map(({ id }) => id)).toEqual(["fri-a"]);
    expect(plan.simulation.meetsMinimum).toBe(true);
  });

  it("finds the safest class ranking and deterministic safest day", () => {
    const summaries = [summary("A", 18, 20), summary("B", 9, 15)];
    const subjects = [subject("A"), subject("B")];
    const ranking = buildSafestWeekRanking({
      summaries,
      sessions,
      subjects,
      filters: { selectedDays: ["FRIDAY"] },
    });
    expect(ranking.map((entry) => entry.session.id)).toEqual([
      "fri-a",
      "fri-a-2",
    ]);

    const safestDay = findSafestDay(summaries, sessions);
    expect(safestDay?.date).toBe("2026-07-27");
    expect(safestDay?.safeToSkipSessions).toBe(1);
  });

  it("handles calendar day arithmetic across month boundaries", () => {
    expect(addIsoDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addIsoDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
