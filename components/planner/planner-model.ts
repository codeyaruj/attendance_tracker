import {
  planFullDaySkip,
  rankSafestClasses,
  selectRecurringWeekdaySessions,
  selectSessionsInDateRange,
  simulateDateRange,
  simulateRecurringWeekday,
  simulateSelectedClasses,
  type CombinedSkipSimulation,
  type FullDaySkipPlan,
  type RankedSafeSession,
  type SafestClassFilters,
} from "@/lib/attendance";
import type {
  DayOfWeek,
  ResolvedSession,
  Subject,
  SubjectAttendanceSummary,
} from "@/types/domain";

export const PLANNER_MODES = [
  "SINGLE",
  "DAY",
  "SELECTED",
  "RANGE",
  "WEEKDAY",
  "SAFEST",
  "BUFFERS",
] as const;

export type PlannerMode = (typeof PLANNER_MODES)[number];

export interface PlannerSelectionInput {
  mode: PlannerMode;
  sessions: readonly ResolvedSession[];
  singleSessionId?: string;
  selectedDate?: string;
  selectedSessionIds?: readonly string[];
  startDate?: string;
  endDate?: string;
  weekday?: DayOfWeek;
  includeSubjectIds?: readonly string[];
  excludeSessionIds?: readonly string[];
}

export interface PlannerSimulationInput extends PlannerSelectionInput {
  summaries: readonly SubjectAttendanceSummary[];
}

export interface PlannerSimulation {
  selectedSessions: ResolvedSession[];
  persistenceSessions: ResolvedSession[];
  simulation: CombinedSkipSimulation;
  fullDayPlan?: FullDaySkipPlan;
}

export interface SafestDayRecommendation {
  date: string;
  plan: FullDaySkipPlan;
  scheduledSessions: number;
  safeToSkipSessions: number;
}

function emptySimulation(
  summaries: readonly SubjectAttendanceSummary[],
): CombinedSkipSimulation {
  return simulateSelectedClasses({ summaries, sessions: [] });
}

export function selectPlannerSessions({
  mode,
  sessions,
  singleSessionId,
  selectedDate,
  selectedSessionIds = [],
  startDate,
  endDate,
  weekday,
  includeSubjectIds,
  excludeSessionIds,
}: PlannerSelectionInput): ResolvedSession[] {
  switch (mode) {
    case "SINGLE":
      return singleSessionId
        ? sessions.filter((session) => session.id === singleSessionId)
        : [];
    case "DAY":
      return selectedDate
        ? sessions.filter((session) => session.date === selectedDate)
        : [];
    case "SELECTED":
    case "SAFEST": {
      const ids = new Set(selectedSessionIds);
      return sessions.filter((session) => ids.has(session.id));
    }
    case "RANGE":
      return startDate && endDate && startDate <= endDate
        ? selectSessionsInDateRange(sessions, startDate, endDate)
        : [];
    case "WEEKDAY":
      return startDate && endDate && startDate <= endDate && weekday
        ? selectRecurringWeekdaySessions({
            sessions,
            startDate,
            endDate,
            weekday,
            includeSubjectIds,
            excludeSessionIds,
          })
        : [];
    case "BUFFERS":
      return [];
  }
}

export function buildPlannerSimulation(
  input: PlannerSimulationInput,
): PlannerSimulation {
  const selectedSessions = selectPlannerSessions(input);

  if (input.mode === "DAY") {
    const fullDayPlan = planFullDaySkip({
      summaries: input.summaries,
      sessions: selectedSessions,
    });
    const persistenceSessions = fullDayPlan.meetsMinimum
      ? fullDayPlan.selectedSessions
      : fullDayPlan.sessionsSafeToSkip;
    return {
      selectedSessions,
      persistenceSessions,
      simulation: fullDayPlan.meetsMinimum
        ? fullDayPlan
        : fullDayPlan.adjustedSimulation,
      fullDayPlan,
    };
  }

  let simulation: CombinedSkipSimulation;
  if (
    input.mode === "RANGE" &&
    input.startDate &&
    input.endDate &&
    input.startDate <= input.endDate
  ) {
    simulation = simulateDateRange({
      summaries: input.summaries,
      sessions: input.sessions,
      startDate: input.startDate,
      endDate: input.endDate,
    });
  } else if (
    input.mode === "WEEKDAY" &&
    input.startDate &&
    input.endDate &&
    input.startDate <= input.endDate &&
    input.weekday
  ) {
    simulation = simulateRecurringWeekday({
      summaries: input.summaries,
      sessions: input.sessions,
      startDate: input.startDate,
      endDate: input.endDate,
      weekday: input.weekday,
      includeSubjectIds: input.includeSubjectIds,
      excludeSessionIds: input.excludeSessionIds,
    });
  } else if (input.mode === "BUFFERS") {
    simulation = emptySimulation(input.summaries);
  } else {
    simulation = simulateSelectedClasses({
      summaries: input.summaries,
      sessions: selectedSessions,
    });
  }

  return {
    selectedSessions,
    persistenceSessions: simulation.selectedSessions,
    simulation,
  };
}

function dayOutcomePriority(plan: FullDaySkipPlan): number {
  switch (plan.outcome) {
    case "SAFE_TO_SKIP":
      return 5;
    case "SAFE_BELOW_SAFETY_TARGET":
      return 4;
    case "ATTEND_SPECIFIC_CLASSES":
      return 3;
    case "CANNOT_REACH_MINIMUM":
      return 2;
    case "NO_CLASSES":
      return 1;
  }
}

export function findSafestDay(
  summaries: readonly SubjectAttendanceSummary[],
  sessions: readonly ResolvedSession[],
): SafestDayRecommendation | undefined {
  const sessionsByDate = new Map<string, ResolvedSession[]>();
  sessions.forEach((session) => {
    const dateSessions = sessionsByDate.get(session.date) ?? [];
    dateSessions.push(session);
    sessionsByDate.set(session.date, dateSessions);
  });
  const recommendations = [...sessionsByDate.entries()].map(
    ([date, dateSessions]) => {
      const plan = planFullDaySkip({ summaries, sessions: dateSessions });
      return {
        date,
        plan,
        scheduledSessions: plan.selectedSessions.length,
        safeToSkipSessions: plan.meetsMinimum
          ? plan.selectedSessions.length
          : plan.sessionsSafeToSkip.length,
      } satisfies SafestDayRecommendation;
    },
  );
  return recommendations.sort((left, right) => {
    const outcomeDifference =
      dayOutcomePriority(right.plan) - dayOutcomePriority(left.plan);
    if (outcomeDifference !== 0) return outcomeDifference;
    const safeDifference = right.safeToSkipSessions - left.safeToSkipSessions;
    if (safeDifference !== 0) return safeDifference;
    const attendDifference =
      left.plan.mustAttendSessions.length -
      right.plan.mustAttendSessions.length;
    if (attendDifference !== 0) return attendDifference;
    return left.date.localeCompare(right.date);
  })[0];
}

export function buildSafestWeekRanking({
  summaries,
  sessions,
  subjects,
  filters,
}: {
  summaries: readonly SubjectAttendanceSummary[];
  sessions: readonly ResolvedSession[];
  subjects: readonly Subject[];
  filters?: SafestClassFilters;
}): RankedSafeSession[] {
  return rankSafestClasses({ summaries, sessions, subjects, filters });
}

export function addIsoDays(date: string, days: number): string {
  if (!Number.isSafeInteger(days)) {
    throw new RangeError("Day offset must be a safe integer");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new RangeError("Date must use YYYY-MM-DD format");
  const parsed = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  if (
    parsed.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() !== Number(match[2]) - 1 ||
    parsed.getUTCDate() !== Number(match[3])
  ) {
    throw new RangeError("Date must be a real calendar date");
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function formatPlannerDate(date: string, includeWeekday = true): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    ...(includeWeekday ? { weekday: "short" } : {}),
    day: "numeric",
    month: "short",
  }).format(parsed);
}
