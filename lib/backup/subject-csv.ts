import type { AttendanceRecord, ClassSession, Subject } from "@/types/domain";

import type { AttendSafeDatabase } from "@/db/database";

export interface SubjectCsvExportOptions {
  subjectIds?: readonly string[];
  includeDisabled?: boolean;
}

interface AttendanceCounts {
  held: number;
  attended: number;
}

function countAttendance(
  subject: Subject,
  sessions: readonly ClassSession[],
  recordsBySession: ReadonlyMap<string, AttendanceRecord>,
): AttendanceCounts {
  let held = subject.initialHeld;
  let attended = subject.initialAttended;
  for (const session of sessions) {
    if (session.status === "CANCELLED") {
      if (subject.countsCancelledSessions) held += 1;
      continue;
    }
    if (session.status === "HOLIDAY" || session.status === "NOT_CONDUCTED") {
      continue;
    }
    const record = recordsBySession.get(session.id);
    switch (record?.status ?? "NOT_MARKED") {
      case "PRESENT":
        held += 1;
        attended += 1;
        break;
      case "ABSENT":
        held += 1;
        break;
      case "EXEMPT":
        if (subject.exemptPolicy === "ATTENDED") {
          held += 1;
          attended += 1;
        }
        break;
      case "NOT_MARKED":
        break;
    }
  }
  return { held, attended };
}

function csvCell(value: string | number): string {
  let text = String(value);
  if (/^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function formatPercentage(held: number, attended: number): string {
  if (held === 0) return "No classes held";
  return `${((attended * 100) / held).toFixed(2)}%`;
}

export async function exportSubjectAttendanceCsv(
  database: AttendSafeDatabase,
  semesterId: string,
  options: SubjectCsvExportOptions = {},
): Promise<string> {
  const selectedIds = options.subjectIds
    ? new Set(options.subjectIds)
    : undefined;
  const subjects = (
    await database.subjects
      .where("semesterId")
      .equals(semesterId)
      .sortBy("name")
  ).filter(
    (subject) =>
      (!selectedIds || selectedIds.has(subject.id)) &&
      (options.includeDisabled === true || subject.isEnabled),
  );
  const sessions = await database.classSessions
    .where("semesterId")
    .equals(semesterId)
    .toArray();
  const attendanceRecords =
    sessions.length > 0
      ? await database.attendanceRecords
          .where("classSessionId")
          .anyOf(sessions.map((session) => session.id))
          .toArray()
      : [];
  const recordsBySession = new Map(
    attendanceRecords.map((record) => [record.classSessionId, record]),
  );
  const sessionsBySubject = new Map<string, ClassSession[]>();
  for (const session of sessions) {
    const bucket = sessionsBySubject.get(session.subjectId) ?? [];
    bucket.push(session);
    sessionsBySubject.set(session.subjectId, bucket);
  }
  const header = [
    "Subject code",
    "Subject name",
    "Class type",
    "Held",
    "Attended",
    "Attendance",
    "Minimum requirement",
    "Safety target",
  ];
  const semester = await database.semesters.get(semesterId);
  if (!semester) throw new Error(`Semester ${semesterId} does not exist.`);
  const rows = subjects.map((subject) => {
    const counts = countAttendance(
      subject,
      sessionsBySubject.get(subject.id) ?? [],
      recordsBySession,
    );
    const minimum =
      subject.minimumAttendanceBasisPointsOverride ??
      semester.minimumAttendanceBasisPoints;
    const safety =
      subject.safetyTargetBasisPointsOverride ??
      semester.safetyTargetBasisPoints;
    return [
      subject.code ?? "",
      subject.name,
      subject.classType,
      counts.held,
      counts.attended,
      formatPercentage(counts.held, counts.attended),
      `${(minimum / 100).toFixed(2)}%`,
      `${(safety / 100).toFixed(2)}%`,
    ];
  });
  return [header, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
