import type { AttendSafeSnapshot } from "@/db";
import {
  buildSubjectAttendanceSummaries,
  calculateRecoveryClasses,
  calculateSkippableClasses,
  classifyAttendanceCounts,
  formatBasisPoints,
  projectSingleAttendance,
  type ProjectionClassification,
} from "@/lib/attendance";
import {
  filterSubjectsForTracking,
  resolveSessionsForDate,
  resolveSessionsInRange,
} from "@/lib/timetable";
import type {
  ClassSession,
  ResolvedSession,
  Subject,
  SubjectAttendanceSummary,
} from "@/types/domain";

export type RiskTone = "safe" | "caution" | "danger" | "neutral" | "info";

export interface SubjectAttendanceView {
  subject: Subject;
  summary: SubjectAttendanceSummary;
  classification: ProjectionClassification;
  skippable: number;
  recovery: number;
  nextAbsenceBasisPoints: number | null;
  nextAbsenceClassification: ProjectionClassification;
}

export function isoDateInTimeZone(
  date = new Date(),
  timeZone?: string,
): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function resolutionContext(snapshot: AttendSafeSnapshot) {
  const semester = snapshot.activeSemester;
  if (!semester) return undefined;
  return {
    semester,
    timetableVersions: snapshot.timetableVersions,
    slots: snapshot.timetableSlots,
    subjects: snapshot.subjects,
    electiveGroups: snapshot.electiveGroups,
    academicExceptions: snapshot.academicExceptions,
    persistedSessions: snapshot.classSessions,
    attendanceRecords: snapshot.attendanceRecords,
    selectedBatch: snapshot.settings.selectedBatch,
    trackedClassTypes: snapshot.settings.trackedClassTypes,
    includeZeroCredit: snapshot.settings.includeZeroCredit ?? false,
    weekStartsOn: snapshot.activeProfile?.weekStartsOn,
  } as const;
}

export function resolveSnapshotSessionsForDate(
  snapshot: AttendSafeSnapshot,
  date: string,
): ResolvedSession[] {
  const context = resolutionContext(snapshot);
  return context ? resolveSessionsForDate({ ...context, date }) : [];
}

export function resolveSnapshotSessionsInRange(
  snapshot: AttendSafeSnapshot,
  startDate: string,
  endDate: string,
): ResolvedSession[] {
  const context = resolutionContext(snapshot);
  return context
    ? resolveSessionsInRange({ ...context, startDate, endDate })
    : [];
}

export function currentAttendanceSessions(
  snapshot: AttendSafeSnapshot,
  today = isoDateInTimeZone(new Date(), snapshot.activeProfile?.timezone),
): ResolvedSession[] {
  const semester = snapshot.activeSemester;
  if (!semester || today < semester.startDate) return [];
  const endDate = today > semester.endDate ? semester.endDate : today;
  return resolveSnapshotSessionsInRange(snapshot, semester.startDate, endDate);
}

export function buildSubjectViews(
  snapshot: AttendSafeSnapshot,
  sessions = currentAttendanceSessions(snapshot),
): SubjectAttendanceView[] {
  const semester = snapshot.activeSemester;
  if (!semester) return [];
  const subjects = filterSubjectsForTracking({
    subjects: snapshot.subjects,
    electiveGroups: snapshot.electiveGroups,
    trackedClassTypes: snapshot.settings.trackedClassTypes,
    includeZeroCredit: snapshot.settings.includeZeroCredit ?? false,
  });
  const summaries = buildSubjectAttendanceSummaries(
    semester,
    subjects,
    sessions,
  );
  const subjectsById = new Map(
    subjects.map((subject) => [subject.id, subject]),
  );

  return summaries.flatMap((summary) => {
    const subject = subjectsById.get(summary.subjectId);
    if (!subject) return [];
    const nextAbsence = projectSingleAttendance(
      summary.attended,
      summary.held,
      "ABSENT",
    );
    return [
      {
        subject,
        summary,
        classification: classifyAttendanceCounts(
          summary.attended,
          summary.held,
          summary.minimumBasisPoints,
          summary.safetyBasisPoints,
        ),
        skippable: calculateSkippableClasses(
          summary.attended,
          summary.held,
          summary.minimumBasisPoints,
        ),
        recovery: calculateRecoveryClasses(
          summary.attended,
          summary.held,
          summary.minimumBasisPoints,
        ),
        nextAbsenceBasisPoints: nextAbsence.projectedPercentageBasisPoints,
        nextAbsenceClassification: classifyAttendanceCounts(
          nextAbsence.projectedAttended,
          nextAbsence.projectedHeld,
          summary.minimumBasisPoints,
          summary.safetyBasisPoints,
        ),
      },
    ];
  });
}

export function viewForSubject(
  views: readonly SubjectAttendanceView[],
  subjectId: string,
): SubjectAttendanceView | undefined {
  return views.find((view) => view.subject.id === subjectId);
}

export function riskLabel(classification: ProjectionClassification): string {
  switch (classification) {
    case "SAFE":
      return "Safe";
    case "CAUTION":
      return "Caution";
    case "BORDERLINE":
      return "Borderline";
    case "UNSAFE":
      return "Below minimum";
    case "NO_DATA":
      return "No data";
  }
}

export function riskTone(classification: ProjectionClassification): RiskTone {
  switch (classification) {
    case "SAFE":
      return "safe";
    case "CAUTION":
    case "BORDERLINE":
      return "caution";
    case "UNSAFE":
      return "danger";
    case "NO_DATA":
      return "neutral";
  }
}

export function displayPercentage(value: number | null): string {
  return formatBasisPoints(value, 1, "No classes held");
}

export function formatClockTime(value: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${match[2]} ${suffix}`;
}

export function toClassSession(session: ResolvedSession): ClassSession {
  const now = new Date().toISOString();
  return {
    id: session.id,
    semesterId: session.semesterId,
    subjectId: session.subjectId,
    ...(session.timetableSlotId
      ? { timetableSlotId: session.timetableSlotId }
      : {}),
    ...(session.timetableVersionId
      ? { timetableVersionId: session.timetableVersionId }
      : {}),
    date: session.date,
    startTime: session.startTime,
    endTime: session.endTime,
    status: session.status,
    source: session.source,
    faculty: [...session.faculty],
    ...(session.room ? { room: session.room } : {}),
    ...(session.notes ? { notes: session.notes } : {}),
    createdAt: now,
    updatedAt: now,
  };
}
