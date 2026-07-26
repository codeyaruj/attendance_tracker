import type { AttendSafeSnapshot } from "@/db";
import { calculateAttendance, countSessionAttendance } from "@/lib/attendance";
import type {
  AttendanceRecord,
  AttendanceStatus,
  ResolvedSession,
  SessionStatus,
  Subject,
} from "@/types/domain";

export type HistoryStatus =
  | AttendanceStatus
  | "CANCELLED"
  | "HOLIDAY"
  | "NOT_CONDUCTED"
  | "EXTRA"
  | "RESCHEDULED";

export interface HistoryEntry {
  id: string;
  session: ResolvedSession;
  subject: Subject;
  record?: AttendanceRecord;
  status: HistoryStatus;
  beforeBasisPoints: number | null;
  afterBasisPoints: number | null;
  isActivity: boolean;
}

function effectiveStatus(
  session: ResolvedSession,
  record?: AttendanceRecord,
): HistoryStatus {
  if (
    session.status === "CANCELLED" ||
    session.status === "HOLIDAY" ||
    session.status === "NOT_CONDUCTED"
  ) {
    return session.status;
  }
  if (record) return record.status;
  if (session.source === "EXTRA") return "EXTRA";
  if (session.source === "RESCHEDULED") return "RESCHEDULED";
  return "NOT_MARKED";
}

function latestRecords(
  records: readonly AttendanceRecord[],
): Map<string, AttendanceRecord> {
  const result = new Map<string, AttendanceRecord>();
  for (const record of records) {
    const current = result.get(record.classSessionId);
    if (
      !current ||
      record.markedAt > current.markedAt ||
      (record.markedAt === current.markedAt &&
        record.updatedAt > current.updatedAt)
    ) {
      result.set(record.classSessionId, record);
    }
  }
  return result;
}

function isExceptionalStatus(status: SessionStatus): boolean {
  return status !== "SCHEDULED" && status !== "HELD";
}

export function buildHistoryEntries(
  snapshot: AttendSafeSnapshot,
  sessions: readonly ResolvedSession[],
): HistoryEntry[] {
  const records = latestRecords(snapshot.attendanceRecords);
  const subjects = new Map(
    snapshot.subjects.map((subject) => [subject.id, subject]),
  );
  const totals = new Map(
    snapshot.subjects.map((subject) => [
      subject.id,
      { attended: subject.initialAttended, held: subject.initialHeld },
    ]),
  );

  return sessions
    .slice()
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.startTime.localeCompare(right.startTime) ||
        left.id.localeCompare(right.id),
    )
    .flatMap((session) => {
      const subject = subjects.get(session.subjectId);
      const total = totals.get(session.subjectId);
      if (!subject || !total) return [];
      const record = records.get(session.id);
      const beforeBasisPoints = calculateAttendance(total.attended, total.held);
      const delta = countSessionAttendance(
        session.status,
        record?.status ?? session.attendanceStatus,
        {
          countsCancelledSessions: subject.countsCancelledSessions,
          exemptPolicy: subject.exemptPolicy,
        },
      );
      total.attended += delta.attended;
      total.held += delta.held;
      const afterBasisPoints = calculateAttendance(total.attended, total.held);
      return [
        {
          id: session.id,
          session,
          subject,
          ...(record ? { record } : {}),
          status: effectiveStatus(session, record),
          beforeBasisPoints,
          afterBasisPoints,
          isActivity:
            Boolean(record) ||
            isExceptionalStatus(session.status) ||
            session.source !== "TIMETABLE",
        } satisfies HistoryEntry,
      ];
    });
}

export function historyStatusLabel(status: HistoryStatus): string {
  switch (status) {
    case "PRESENT":
      return "Present";
    case "ABSENT":
      return "Absent";
    case "EXEMPT":
      return "Exempt";
    case "NOT_MARKED":
      return "Not marked";
    case "CANCELLED":
      return "Cancelled";
    case "HOLIDAY":
      return "Holiday";
    case "NOT_CONDUCTED":
      return "Not conducted";
    case "EXTRA":
      return "Extra class";
    case "RESCHEDULED":
      return "Rescheduled";
  }
}
