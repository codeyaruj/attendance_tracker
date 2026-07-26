import {
  calculateAttendance,
  calculateAttendanceBuffer,
  calculateRequiredAttendanceForRemainingSessions,
  classifyAttendanceCounts,
  compareAttendanceToThreshold,
  isAttendanceAtOrAbove,
  projectMultipleSessions,
  projectSingleAttendance,
  type AttendanceProjection,
  type ProjectionClassification,
} from "@/lib/attendance/engine";
import type {
  ClassType,
  DayOfWeek,
  ResolvedSession,
  Subject,
  SubjectAttendanceSummary,
} from "@/types/domain";

export interface SubjectSkipProjection extends AttendanceProjection {
  subjectId: string;
  minimumBasisPoints: number;
  safetyBasisPoints: number;
  classification: ProjectionClassification;
  remainingSkipBuffer: number;
  selectedSessionIds: string[];
}

export interface CombinedSkipSimulation {
  subjectProjections: SubjectSkipProjection[];
  selectedSessions: ResolvedSession[];
  ignoredSessions: ResolvedSession[];
  overallClassification: ProjectionClassification;
  meetsMinimum: boolean;
  meetsSafetyTarget: boolean;
}

export interface SimulateAbsencesInput {
  summaries: readonly SubjectAttendanceSummary[];
  sessions: readonly ResolvedSession[];
}

export interface SimulateSessionOutcomesInput {
  summaries: readonly SubjectAttendanceSummary[];
  absentSessions: readonly ResolvedSession[];
  attendedSessions: readonly ResolvedSession[];
}

export type FullDaySkipOutcome =
  | "SAFE_TO_SKIP"
  | "SAFE_BELOW_SAFETY_TARGET"
  | "ATTEND_SPECIFIC_CLASSES"
  | "CANNOT_REACH_MINIMUM"
  | "NO_CLASSES";

export interface FullDaySkipPlan extends CombinedSkipSimulation {
  outcome: FullDaySkipOutcome;
  mustAttendSessions: ResolvedSession[];
  sessionsSafeToSkip: ResolvedSession[];
  adjustedSimulation: CombinedSkipSimulation;
  feasible: boolean;
}

export interface DateRangeSimulationInput extends SimulateAbsencesInput {
  startDate: string;
  endDate: string;
  includeSessionIds?: readonly string[];
  excludeSessionIds?: readonly string[];
}

export interface RecurringWeekdaySimulationInput extends DateRangeSimulationInput {
  weekday: DayOfWeek;
  includeSubjectIds?: readonly string[];
}

export interface SafestClassFilters {
  classTypes?: readonly ClassType[];
  excludeLabs?: boolean;
  excludeZeroCredit?: boolean;
  selectedDays?: readonly DayOfWeek[];
  selectedSubjectIds?: readonly string[];
}

export interface RankSafestClassesInput extends SimulateAbsencesInput {
  subjects?: readonly Subject[];
  filters?: SafestClassFilters;
}

export interface RankedSafeSession {
  rank: number;
  session: ResolvedSession;
  projection: AttendanceProjection;
  classification: ProjectionClassification;
  distanceAboveSafetyBasisPoints: number;
  futureSessionsRemaining: number;
  currentAttendanceBuffer: number;
}

const JS_DAY_TO_DOMAIN_DAY: readonly DayOfWeek[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

function validateIsoDate(date: string, label: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) {
    throw new RangeError(`${label} must use YYYY-MM-DD format.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError(`${label} must be a real calendar date.`);
  }
}

export function dayOfWeekForDate(date: string): DayOfWeek {
  validateIsoDate(date, "date");
  return JS_DAY_TO_DOMAIN_DAY[
    new Date(`${date}T00:00:00.000Z`).getUTCDay()
  ] as DayOfWeek;
}

function sessionChronologyKey(session: ResolvedSession): string {
  return `${session.date}T${session.startTime}|${session.endTime}|${session.id}`;
}

function compareSessionsChronologically(
  left: ResolvedSession,
  right: ResolvedSession,
): number {
  return sessionChronologyKey(left).localeCompare(sessionChronologyKey(right));
}

export function isSessionEligibleForSkip(session: ResolvedSession): boolean {
  return (
    session.attendanceStatus === "NOT_MARKED" &&
    (session.status === "SCHEDULED" ||
      session.status === "EXTRA" ||
      session.status === "RESCHEDULED")
  );
}

function projectionPriority(classification: ProjectionClassification): number {
  switch (classification) {
    case "UNSAFE":
      return 4;
    case "BORDERLINE":
      return 3;
    case "CAUTION":
      return 2;
    case "SAFE":
      return 1;
    case "NO_DATA":
      return 0;
  }
}

function aggregateClassification(
  projections: readonly SubjectSkipProjection[],
): ProjectionClassification {
  if (projections.length === 0) {
    return "NO_DATA";
  }
  return projections.reduce<ProjectionClassification>(
    (worst, projection) =>
      projectionPriority(projection.classification) > projectionPriority(worst)
        ? projection.classification
        : worst,
    "SAFE",
  );
}

export function simulateAbsencesBySubject({
  summaries,
  sessions,
}: SimulateAbsencesInput): CombinedSkipSimulation {
  return simulateSessionOutcomesBySubject({
    summaries,
    absentSessions: sessions,
    attendedSessions: [],
  });
}

/**
 * Aggregates a mixed future plan. A session must appear in at most one outcome
 * list; every threshold decision is made after all outcomes for a subject have
 * been combined.
 */
export function simulateSessionOutcomesBySubject({
  summaries,
  absentSessions,
  attendedSessions,
}: SimulateSessionOutcomesInput): CombinedSkipSimulation {
  const summaryBySubjectId = new Map(
    summaries.map((summary) => [summary.subjectId, summary]),
  );
  if (summaryBySubjectId.size !== summaries.length) {
    throw new RangeError("Attendance summaries must have unique subject IDs.");
  }
  const eligibleAbsentSessions = absentSessions
    .filter(isSessionEligibleForSkip)
    .slice()
    .sort(compareSessionsChronologically);
  const eligibleAttendedSessions = attendedSessions
    .filter(isSessionEligibleForSkip)
    .slice()
    .sort(compareSessionsChronologically);
  if (
    new Set(eligibleAbsentSessions.map((session) => session.id)).size !==
    eligibleAbsentSessions.length
  ) {
    throw new RangeError("Absent sessions must have unique IDs.");
  }
  if (
    new Set(eligibleAttendedSessions.map((session) => session.id)).size !==
    eligibleAttendedSessions.length
  ) {
    throw new RangeError("Attended sessions must have unique IDs.");
  }
  const absentIds = new Set(
    eligibleAbsentSessions.map((session) => session.id),
  );
  for (const session of eligibleAttendedSessions) {
    if (absentIds.has(session.id)) {
      throw new RangeError(
        `Session ${session.id} cannot be both attended and absent.`,
      );
    }
  }
  const selectedSessions = [
    ...eligibleAbsentSessions,
    ...eligibleAttendedSessions,
  ]
    .slice()
    .sort(compareSessionsChronologically);
  const ignoredSessions = [...absentSessions, ...attendedSessions].filter(
    (session) => !isSessionEligibleForSkip(session),
  );
  const outcomesBySubjectId = new Map<
    string,
    { absentIds: string[]; attendedIds: string[] }
  >();

  for (const session of selectedSessions) {
    if (!summaryBySubjectId.has(session.subjectId)) {
      throw new RangeError(
        `No attendance summary was supplied for subject ${session.subjectId}.`,
      );
    }
    const outcomes = outcomesBySubjectId.get(session.subjectId) ?? {
      absentIds: [],
      attendedIds: [],
    };
    if (absentIds.has(session.id)) {
      outcomes.absentIds.push(session.id);
    } else {
      outcomes.attendedIds.push(session.id);
    }
    outcomesBySubjectId.set(session.subjectId, outcomes);
  }

  const subjectProjections = summaries.flatMap((summary) => {
    const outcomes = outcomesBySubjectId.get(summary.subjectId);
    if (outcomes === undefined) {
      return [];
    }
    const selectedSessionIds = [...outcomes.absentIds, ...outcomes.attendedIds];
    const projection = projectMultipleSessions(
      summary.attended,
      summary.held,
      outcomes.attendedIds.length,
      outcomes.absentIds.length,
    );
    return [
      {
        subjectId: summary.subjectId,
        ...projection,
        minimumBasisPoints: summary.minimumBasisPoints,
        safetyBasisPoints: summary.safetyBasisPoints,
        classification: classifyAttendanceCounts(
          projection.projectedAttended,
          projection.projectedHeld,
          summary.minimumBasisPoints,
          summary.safetyBasisPoints,
        ),
        remainingSkipBuffer: calculateAttendanceBuffer(
          projection.projectedAttended,
          projection.projectedHeld,
          summary.minimumBasisPoints,
        ),
        selectedSessionIds,
      },
    ];
  });

  const meetsMinimum = subjectProjections.every((projection) =>
    isAttendanceAtOrAbove(
      projection.projectedAttended,
      projection.projectedHeld,
      projection.minimumBasisPoints,
    ),
  );
  const meetsSafetyTarget = subjectProjections.every((projection) =>
    isAttendanceAtOrAbove(
      projection.projectedAttended,
      projection.projectedHeld,
      projection.safetyBasisPoints,
    ),
  );

  return {
    subjectProjections,
    selectedSessions,
    ignoredSessions,
    overallClassification: aggregateClassification(subjectProjections),
    meetsMinimum,
    meetsSafetyTarget,
  };
}

export const simulateSelectedClasses = simulateAbsencesBySubject;

function riskCompare(
  left: SubjectSkipProjection,
  right: SubjectSkipProjection,
): number {
  const crossProduct =
    BigInt(left.projectedAttended) * BigInt(right.projectedHeld) -
    BigInt(right.projectedAttended) * BigInt(left.projectedHeld);
  if (crossProduct !== 0n) {
    return crossProduct < 0n ? -1 : 1;
  }
  return 0;
}

export function planFullDaySkip({
  summaries,
  sessions,
}: SimulateAbsencesInput): FullDaySkipPlan {
  const wholeDaySimulation = simulateAbsencesBySubject({ summaries, sessions });
  if (wholeDaySimulation.selectedSessions.length === 0) {
    return {
      ...wholeDaySimulation,
      outcome: "NO_CLASSES",
      mustAttendSessions: [],
      sessionsSafeToSkip: [],
      adjustedSimulation: wholeDaySimulation,
      feasible: true,
    };
  }

  if (wholeDaySimulation.meetsMinimum) {
    return {
      ...wholeDaySimulation,
      outcome: wholeDaySimulation.meetsSafetyTarget
        ? "SAFE_TO_SKIP"
        : "SAFE_BELOW_SAFETY_TARGET",
      mustAttendSessions: [],
      sessionsSafeToSkip: wholeDaySimulation.selectedSessions,
      adjustedSimulation: wholeDaySimulation,
      feasible: true,
    };
  }

  const summaryBySubjectId = new Map(
    summaries.map((summary) => [summary.subjectId, summary]),
  );
  const projectionBySubjectId = new Map(
    wholeDaySimulation.subjectProjections.map((projection) => [
      projection.subjectId,
      projection,
    ]),
  );
  const sessionsBySubjectId = new Map<string, ResolvedSession[]>();
  for (const session of wholeDaySimulation.selectedSessions) {
    const grouped = sessionsBySubjectId.get(session.subjectId) ?? [];
    grouped.push(session);
    sessionsBySubjectId.set(session.subjectId, grouped);
  }

  let feasible = true;
  const recommendations: Array<{
    session: ResolvedSession;
    risk: SubjectSkipProjection;
  }> = [];
  for (const [subjectId, subjectSessions] of sessionsBySubjectId) {
    const summary = summaryBySubjectId.get(
      subjectId,
    ) as SubjectAttendanceSummary;
    const risk = projectionBySubjectId.get(subjectId) as SubjectSkipProjection;
    const required = calculateRequiredAttendanceForRemainingSessions(
      summary.attended,
      summary.held,
      subjectSessions.length,
      summary.minimumBasisPoints,
    );
    const numberToAttend = Number.isFinite(required)
      ? required
      : subjectSessions.length;
    if (!Number.isFinite(required)) {
      feasible = false;
    }
    const chronological = subjectSessions
      .slice()
      .sort(compareSessionsChronologically);
    for (const session of chronological.slice(0, numberToAttend)) {
      recommendations.push({ session, risk });
    }
  }

  recommendations.sort((left, right) => {
    const byRisk = riskCompare(left.risk, right.risk);
    return byRisk !== 0
      ? byRisk
      : compareSessionsChronologically(left.session, right.session);
  });
  const mustAttendSessions = recommendations.map(({ session }) => session);
  const mustAttendIds = new Set(
    mustAttendSessions.map((session) => session.id),
  );
  const sessionsSafeToSkip = wholeDaySimulation.selectedSessions.filter(
    (session) => !mustAttendIds.has(session.id),
  );
  const adjustedSimulation = simulateSessionOutcomesBySubject({
    summaries,
    absentSessions: sessionsSafeToSkip,
    attendedSessions: mustAttendSessions,
  });

  return {
    ...wholeDaySimulation,
    outcome: feasible ? "ATTEND_SPECIFIC_CLASSES" : "CANNOT_REACH_MINIMUM",
    mustAttendSessions,
    sessionsSafeToSkip,
    adjustedSimulation,
    feasible,
  };
}

export const simulateFullDaySkip = planFullDaySkip;

export function selectSessionsInDateRange(
  sessions: readonly ResolvedSession[],
  startDate: string,
  endDate: string,
): ResolvedSession[] {
  validateIsoDate(startDate, "startDate");
  validateIsoDate(endDate, "endDate");
  if (endDate < startDate) {
    throw new RangeError("endDate cannot be before startDate.");
  }
  return sessions
    .filter((session) => session.date >= startDate && session.date <= endDate)
    .slice()
    .sort(compareSessionsChronologically);
}

export function simulateDateRange({
  summaries,
  sessions,
  startDate,
  endDate,
  includeSessionIds,
  excludeSessionIds = [],
}: DateRangeSimulationInput): CombinedSkipSimulation {
  const included =
    includeSessionIds === undefined ? null : new Set(includeSessionIds);
  const excluded = new Set(excludeSessionIds);
  const rangeSessions = selectSessionsInDateRange(
    sessions,
    startDate,
    endDate,
  ).filter(
    (session) =>
      (included === null || included.has(session.id)) &&
      !excluded.has(session.id),
  );
  return simulateAbsencesBySubject({ summaries, sessions: rangeSessions });
}

export const simulateDateRangeSkip = simulateDateRange;

export function selectRecurringWeekdaySessions({
  sessions,
  startDate,
  endDate,
  weekday,
  includeSessionIds,
  excludeSessionIds = [],
  includeSubjectIds,
}: Omit<RecurringWeekdaySimulationInput, "summaries">): ResolvedSession[] {
  const subjectIds =
    includeSubjectIds === undefined ? null : new Set(includeSubjectIds);
  const sessionIds =
    includeSessionIds === undefined ? null : new Set(includeSessionIds);
  const excluded = new Set(excludeSessionIds);
  return selectSessionsInDateRange(sessions, startDate, endDate).filter(
    (session) =>
      dayOfWeekForDate(session.date) === weekday &&
      (subjectIds === null || subjectIds.has(session.subjectId)) &&
      (sessionIds === null || sessionIds.has(session.id)) &&
      !excluded.has(session.id),
  );
}

export function simulateRecurringWeekday(
  input: RecurringWeekdaySimulationInput,
): CombinedSkipSimulation {
  return simulateAbsencesBySubject({
    summaries: input.summaries,
    sessions: selectRecurringWeekdaySessions(input),
  });
}

export const simulateRecurringWeekdaySkip = simulateRecurringWeekday;

function passesSafestClassFilters(
  session: ResolvedSession,
  subjectById: ReadonlyMap<string, Subject>,
  filters: SafestClassFilters,
): boolean {
  const subject = subjectById.get(session.subjectId);
  if (
    filters.selectedDays !== undefined &&
    !filters.selectedDays.includes(dayOfWeekForDate(session.date))
  ) {
    return false;
  }
  if (
    filters.selectedSubjectIds !== undefined &&
    !filters.selectedSubjectIds.includes(session.subjectId)
  ) {
    return false;
  }
  if (subject === undefined) {
    return (
      filters.classTypes === undefined &&
      filters.excludeLabs !== true &&
      filters.excludeZeroCredit !== true
    );
  }
  if (!subject.isEnabled) {
    return false;
  }
  if (
    filters.classTypes !== undefined &&
    !filters.classTypes.includes(subject.classType)
  ) {
    return false;
  }
  if (filters.excludeLabs === true && subject.classType === "LAB") {
    return false;
  }
  return !(filters.excludeZeroCredit === true && subject.isZeroCredit);
}

export function rankSafestClasses({
  summaries,
  sessions,
  subjects = [],
  filters = {},
}: RankSafestClassesInput): RankedSafeSession[] {
  const summaryBySubjectId = new Map(
    summaries.map((summary) => [summary.subjectId, summary]),
  );
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const eligible = sessions
    .filter(isSessionEligibleForSkip)
    .filter((session) =>
      passesSafestClassFilters(session, subjectById, filters),
    )
    .slice()
    .sort(compareSessionsChronologically);

  const ranked = eligible.flatMap((session, index) => {
    const summary = summaryBySubjectId.get(session.subjectId);
    if (summary === undefined) {
      return [];
    }
    const projection = projectSingleAttendance(
      summary.attended,
      summary.held,
      "ABSENT",
    );
    if (
      !isAttendanceAtOrAbove(
        projection.projectedAttended,
        projection.projectedHeld,
        summary.minimumBasisPoints,
      )
    ) {
      return [];
    }
    const classification = classifyAttendanceCounts(
      projection.projectedAttended,
      projection.projectedHeld,
      summary.minimumBasisPoints,
      summary.safetyBasisPoints,
    );
    const futureSessionsRemaining = eligible
      .slice(index + 1)
      .filter((future) => future.subjectId === session.subjectId).length;
    return [
      {
        rank: 0,
        session,
        projection,
        classification,
        distanceAboveSafetyBasisPoints:
          (projection.projectedPercentageBasisPoints as number) -
          summary.safetyBasisPoints,
        futureSessionsRemaining,
        currentAttendanceBuffer: calculateAttendanceBuffer(
          summary.attended,
          summary.held,
          summary.minimumBasisPoints,
        ),
      },
    ];
  });

  ranked.sort((left, right) => {
    const bySafetyDistance =
      right.distanceAboveSafetyBasisPoints -
      left.distanceAboveSafetyBasisPoints;
    if (bySafetyDistance !== 0) {
      return bySafetyDistance;
    }
    const leftPercentage = left.projection.projectedPercentageBasisPoints ?? -1;
    const rightPercentage =
      right.projection.projectedPercentageBasisPoints ?? -1;
    if (leftPercentage !== rightPercentage) {
      return rightPercentage - leftPercentage;
    }
    if (left.currentAttendanceBuffer !== right.currentAttendanceBuffer) {
      return right.currentAttendanceBuffer - left.currentAttendanceBuffer;
    }
    if (left.futureSessionsRemaining !== right.futureSessionsRemaining) {
      return right.futureSessionsRemaining - left.futureSessionsRemaining;
    }
    return compareSessionsChronologically(left.session, right.session);
  });

  return ranked.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export const rankSafestSessions = rankSafestClasses;

export function projectSubjectAfterAbsence(
  summary: SubjectAttendanceSummary,
): SubjectSkipProjection {
  const projection = projectSingleAttendance(
    summary.attended,
    summary.held,
    "ABSENT",
  );
  return {
    subjectId: summary.subjectId,
    ...projection,
    minimumBasisPoints: summary.minimumBasisPoints,
    safetyBasisPoints: summary.safetyBasisPoints,
    classification: classifyAttendanceCounts(
      projection.projectedAttended,
      projection.projectedHeld,
      summary.minimumBasisPoints,
      summary.safetyBasisPoints,
    ),
    remainingSkipBuffer: calculateAttendanceBuffer(
      projection.projectedAttended,
      projection.projectedHeld,
      summary.minimumBasisPoints,
    ),
    selectedSessionIds: [],
  };
}

export function compareProjectedAttendance(
  left: SubjectSkipProjection,
  right: SubjectSkipProjection,
): number {
  return riskCompare(left, right);
}

export function exactDistanceFromMinimum(
  projection: SubjectSkipProjection,
): -1 | 0 | 1 | null {
  return compareAttendanceToThreshold(
    projection.projectedAttended,
    projection.projectedHeld,
    projection.minimumBasisPoints,
  );
}

export function projectedPercentageForAbsences(
  summary: SubjectAttendanceSummary,
  absences: number,
): number | null {
  if (!Number.isSafeInteger(absences) || absences < 0) {
    throw new RangeError("absences must be a non-negative safe integer.");
  }
  return calculateAttendance(summary.attended, summary.held + absences);
}
