import {
  calculateAttendance,
  assertValidAttendanceCounts,
  assertValidBasisPoints,
} from "@/lib/attendance/engine";
import type {
  AttendanceRecord,
  AttendanceStatus,
  ClassSession,
  ResolvedSession,
  Semester,
  SessionStatus,
  Subject,
  SubjectAttendanceSummary,
} from "@/types/domain";

export interface AttendanceCountingPolicy {
  countsCancelledSessions?: boolean;
  exemptPolicy?: "EXCLUDED" | "ATTENDED";
}

export interface AttendanceDelta {
  attended: 0 | 1;
  held: 0 | 1;
}

export interface CountedAttendance {
  attended: number;
  held: number;
  countedSessions: number;
  excludedSessions: number;
}

export interface CountAttendanceRecordsInput {
  sessions: readonly ClassSession[];
  records: readonly AttendanceRecord[];
  policy?: AttendanceCountingPolicy;
  initialAttended?: number;
  initialHeld?: number;
}

export interface CountResolvedSessionsInput {
  sessions: readonly ResolvedSession[];
  policy?: AttendanceCountingPolicy;
  initialAttended?: number;
  initialHeld?: number;
}

export interface SummarizeSubjectAttendanceInput {
  subject: Subject;
  semester: Semester;
  sessions: readonly ResolvedSession[];
}

function isSessionStatusCountable(
  status: SessionStatus,
  policy: AttendanceCountingPolicy,
): boolean {
  switch (status) {
    case "HOLIDAY":
    case "NOT_CONDUCTED":
      return false;
    case "CANCELLED":
      return policy.countsCancelledSessions === true;
    case "SCHEDULED":
    case "HELD":
    case "RESCHEDULED":
    case "EXTRA":
      return true;
  }
}

export function attendanceStatusDelta(
  attendanceStatus: AttendanceStatus,
  exemptPolicy: "EXCLUDED" | "ATTENDED" = "EXCLUDED",
): AttendanceDelta {
  switch (attendanceStatus) {
    case "PRESENT":
      return { attended: 1, held: 1 };
    case "ABSENT":
      return { attended: 0, held: 1 };
    case "EXEMPT":
      return exemptPolicy === "ATTENDED"
        ? { attended: 1, held: 1 }
        : { attended: 0, held: 0 };
    case "NOT_MARKED":
      return { attended: 0, held: 0 };
  }
}

export function countSessionAttendance(
  sessionStatus: SessionStatus,
  attendanceStatus: AttendanceStatus,
  policy: AttendanceCountingPolicy = {},
): AttendanceDelta {
  if (!isSessionStatusCountable(sessionStatus, policy)) {
    return { attended: 0, held: 0 };
  }
  if (sessionStatus === "CANCELLED") {
    if (
      attendanceStatus === "EXEMPT" &&
      (policy.exemptPolicy ?? "EXCLUDED") === "EXCLUDED"
    ) {
      return { attended: 0, held: 0 };
    }
    const attended = attendanceStatusDelta(
      attendanceStatus,
      policy.exemptPolicy ?? "EXCLUDED",
    ).attended;
    return { attended, held: 1 };
  }
  return attendanceStatusDelta(
    attendanceStatus,
    policy.exemptPolicy ?? "EXCLUDED",
  );
}

function initializeCount(
  initialAttended = 0,
  initialHeld = 0,
): CountedAttendance {
  assertValidAttendanceCounts(initialAttended, initialHeld);
  return {
    attended: initialAttended,
    held: initialHeld,
    countedSessions: 0,
    excludedSessions: 0,
  };
}

function applyDelta(total: CountedAttendance, delta: AttendanceDelta): void {
  if (delta.held === 0) {
    total.excludedSessions += 1;
    return;
  }
  if (
    total.held === Number.MAX_SAFE_INTEGER ||
    (delta.attended === 1 && total.attended === Number.MAX_SAFE_INTEGER)
  ) {
    throw new RangeError("Attendance totals exceed the safe integer range.");
  }
  total.held += delta.held;
  total.attended += delta.attended;
  total.countedSessions += 1;
}

export function countResolvedSessions({
  sessions,
  policy = {},
  initialAttended = 0,
  initialHeld = 0,
}: CountResolvedSessionsInput): CountedAttendance {
  const total = initializeCount(initialAttended, initialHeld);
  for (const session of sessions) {
    applyDelta(
      total,
      countSessionAttendance(session.status, session.attendanceStatus, policy),
    );
  }
  return total;
}

function isRecordLater(
  candidate: AttendanceRecord,
  existing: AttendanceRecord,
): boolean {
  if (candidate.markedAt !== existing.markedAt) {
    return candidate.markedAt > existing.markedAt;
  }
  if (candidate.updatedAt !== existing.updatedAt) {
    return candidate.updatedAt > existing.updatedAt;
  }
  return candidate.id > existing.id;
}

export function countAttendanceRecords({
  sessions,
  records,
  policy = {},
  initialAttended = 0,
  initialHeld = 0,
}: CountAttendanceRecordsInput): CountedAttendance {
  const latestRecordBySessionId = new Map<string, AttendanceRecord>();
  for (const record of records) {
    const existing = latestRecordBySessionId.get(record.classSessionId);
    if (existing === undefined || isRecordLater(record, existing)) {
      latestRecordBySessionId.set(record.classSessionId, record);
    }
  }

  const total = initializeCount(initialAttended, initialHeld);
  for (const session of sessions) {
    const attendanceStatus =
      latestRecordBySessionId.get(session.id)?.status ?? "NOT_MARKED";
    applyDelta(
      total,
      countSessionAttendance(session.status, attendanceStatus, policy),
    );
  }
  return total;
}

export function resolveSubjectThresholds(
  subject: Subject,
  semester: Semester,
): { minimumBasisPoints: number; safetyBasisPoints: number } {
  const minimumBasisPoints =
    subject.minimumAttendanceBasisPointsOverride ??
    semester.minimumAttendanceBasisPoints;
  const safetyBasisPoints =
    subject.safetyTargetBasisPointsOverride ?? semester.safetyTargetBasisPoints;
  assertValidBasisPoints(minimumBasisPoints, "minimumBasisPoints");
  assertValidBasisPoints(safetyBasisPoints, "safetyBasisPoints");
  if (safetyBasisPoints < minimumBasisPoints) {
    throw new RangeError(
      `Safety target for subject ${subject.id} cannot be below its minimum.`,
    );
  }
  return { minimumBasisPoints, safetyBasisPoints };
}

export function summarizeSubjectAttendance({
  subject,
  semester,
  sessions,
}: SummarizeSubjectAttendanceInput): SubjectAttendanceSummary {
  const thresholds = resolveSubjectThresholds(subject, semester);
  const total = countResolvedSessions({
    sessions: sessions.filter((session) => session.subjectId === subject.id),
    policy: {
      countsCancelledSessions: subject.countsCancelledSessions,
      exemptPolicy: subject.exemptPolicy,
    },
    initialAttended: subject.initialAttended,
    initialHeld: subject.initialHeld,
  });

  return {
    subjectId: subject.id,
    held: total.held,
    attended: total.attended,
    percentageBasisPoints: calculateAttendance(total.attended, total.held),
    ...thresholds,
  };
}

export function buildSubjectAttendanceSummaries(
  semester: Semester,
  subjects: readonly Subject[],
  sessions: readonly ResolvedSession[],
): SubjectAttendanceSummary[] {
  return subjects
    .filter((subject) => subject.isEnabled)
    .map((subject) =>
      summarizeSubjectAttendance({ subject, semester, sessions }),
    );
}
