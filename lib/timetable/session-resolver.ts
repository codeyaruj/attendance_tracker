import type {
  AcademicException,
  AttendanceRecord,
  ClassSession,
  ClassType,
  ElectiveGroup,
  ResolvedSession,
  Semester,
  Subject,
  TimetableSlot,
  TimetableVersion,
  WeekStartPreference,
} from "@/types/domain";

import {
  enumerateIsoDates,
  getDayOfWeek,
  matchesWeekPattern,
  parseIsoDate,
  resolveTimetableVersionForDate,
} from "./calendar";
import { filterSubjectsForTracking, filterTimetableSlots } from "./filter";
import { createOccurrenceId } from "./occurrence-id";

export interface SessionResolutionContext {
  semester: Semester;
  timetableVersions: readonly TimetableVersion[];
  slots: readonly TimetableSlot[];
  subjects: readonly Subject[];
  electiveGroups?: readonly ElectiveGroup[];
  academicExceptions?: readonly AcademicException[];
  persistedSessions?: readonly ClassSession[];
  attendanceRecords?: readonly AttendanceRecord[];
  selectedBatch?: string | null;
  selectedBatches?: readonly string[];
  selectedElectiveSubjectIds?: readonly string[];
  trackedClassTypes?: Partial<Record<ClassType, boolean>>;
  includeZeroCredit?: boolean;
  includeDisabled?: boolean;
  includeMissingSubjects?: boolean;
  weekStartsOn?: WeekStartPreference;
}

export interface ResolveSessionsForDateInput extends SessionResolutionContext {
  date: string;
}

export interface ResolveSessionsInRangeInput extends SessionResolutionContext {
  startDate: string;
  endDate: string;
}

function dateIsWithin(
  date: string,
  startDate: string,
  endDate: string,
): boolean {
  return startDate <= date && date <= endDate;
}

function makeGeneratedSession(
  semester: Semester,
  version: TimetableVersion,
  slot: TimetableSlot,
  date: string,
): ResolvedSession | undefined {
  if (!slot.subjectId) return undefined;
  return {
    id: createOccurrenceId("TIMETABLE", slot.id, date),
    semesterId: semester.id,
    subjectId: slot.subjectId,
    timetableSlotId: slot.id,
    timetableVersionId: version.id,
    date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    status: "SCHEDULED",
    source: "TIMETABLE",
    faculty: [...slot.faculty],
    ...(slot.room ? { room: slot.room } : {}),
    ...(slot.notes ? { notes: slot.notes } : {}),
    attendanceStatus: "NOT_MARKED",
  };
}

function fromPersistedSession(session: ClassSession): ResolvedSession {
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
    attendanceStatus: "NOT_MARKED",
  };
}

function mergePersistedSessions(
  generated: ResolvedSession[],
  persisted: readonly ClassSession[],
): ResolvedSession[] {
  const sessions = [...generated];
  persisted.forEach((storedSession) => {
    const resolved = fromPersistedSession(storedSession);
    const recurringIndex = storedSession.timetableSlotId
      ? sessions.findIndex(
          (session) =>
            session.timetableSlotId === storedSession.timetableSlotId,
        )
      : -1;
    if (recurringIndex >= 0) sessions[recurringIndex] = resolved;
    else if (!sessions.some((session) => session.id === resolved.id)) {
      sessions.push(resolved);
    }
  });
  return sessions;
}

function exceptionTargetsSession(
  exception: AcademicException,
  session: ResolvedSession,
): boolean {
  if (!dateIsWithin(session.date, exception.startDate, exception.endDate)) {
    return false;
  }
  if (
    exception.timetableSlotId &&
    session.timetableSlotId !== exception.timetableSlotId
  ) {
    return false;
  }
  if (exception.classSessionId && session.id !== exception.classSessionId) {
    return false;
  }
  if (exception.subjectId && session.subjectId !== exception.subjectId) {
    return false;
  }
  const hasIdentityFilter = Boolean(
    exception.timetableSlotId ||
    exception.classSessionId ||
    exception.subjectId,
  );
  if (
    !hasIdentityFilter &&
    exception.startTime &&
    session.startTime !== exception.startTime
  ) {
    return false;
  }
  return true;
}

function applyTargetedExceptions(
  sessions: ResolvedSession[],
  exceptions: readonly AcademicException[],
): ResolvedSession[] {
  return sessions.map((session) => {
    let next = session;
    exceptions.forEach((exception) => {
      if (!exceptionTargetsSession(exception, next)) return;
      switch (exception.type) {
        case "CANCELLED_SESSION":
          next = {
            ...next,
            status: "CANCELLED",
            ...(exception.notes ? { notes: exception.notes } : {}),
          };
          return;
        case "RESCHEDULED_SESSION":
          next = {
            ...next,
            status: "CANCELLED",
            ...(exception.notes ? { notes: exception.notes } : {}),
          };
          return;
        case "SESSION_OVERRIDE":
          next = {
            ...next,
            ...(exception.startTime ? { startTime: exception.startTime } : {}),
            ...(exception.endTime ? { endTime: exception.endTime } : {}),
            ...(exception.faculty ? { faculty: [...exception.faculty] } : {}),
            ...(exception.room ? { room: exception.room } : {}),
            ...(exception.notes ? { notes: exception.notes } : {}),
          };
          return;
        case "HOLIDAY":
        case "BREAK":
        case "CANCELLED_DAY":
        case "EXTRA_SESSION":
          return;
      }
    });
    return next;
  });
}

function findRescheduleSource(
  exception: AcademicException,
  slotsById: ReadonlyMap<string, TimetableSlot>,
  sessionsById: ReadonlyMap<string, ClassSession>,
):
  | {
      subjectId: string;
      timetableSlotId?: string;
      timetableVersionId?: string;
      startTime: string;
      endTime: string;
      faculty: string[];
      room?: string;
      notes?: string;
    }
  | undefined {
  const stored = exception.classSessionId
    ? sessionsById.get(exception.classSessionId)
    : undefined;
  if (stored) {
    return {
      subjectId: exception.subjectId ?? stored.subjectId,
      ...(stored.timetableSlotId
        ? { timetableSlotId: stored.timetableSlotId }
        : {}),
      ...(stored.timetableVersionId
        ? { timetableVersionId: stored.timetableVersionId }
        : {}),
      startTime: exception.startTime ?? stored.startTime,
      endTime: exception.endTime ?? stored.endTime,
      faculty: exception.faculty ? [...exception.faculty] : [...stored.faculty],
      ...((exception.room ?? stored.room)
        ? { room: exception.room ?? stored.room }
        : {}),
      ...((exception.notes ?? stored.notes)
        ? { notes: exception.notes ?? stored.notes }
        : {}),
    };
  }

  const slot = exception.timetableSlotId
    ? slotsById.get(exception.timetableSlotId)
    : undefined;
  const subjectId = exception.subjectId ?? slot?.subjectId;
  const startTime = exception.startTime ?? slot?.startTime;
  const endTime = exception.endTime ?? slot?.endTime;
  if (!subjectId || !startTime || !endTime) return undefined;
  return {
    subjectId,
    ...(slot ? { timetableSlotId: slot.id } : {}),
    ...(slot ? { timetableVersionId: slot.timetableVersionId } : {}),
    startTime,
    endTime,
    faculty: exception.faculty
      ? [...exception.faculty]
      : [...(slot?.faculty ?? [])],
    ...((exception.room ?? slot?.room)
      ? { room: exception.room ?? slot?.room }
      : {}),
    ...((exception.notes ?? slot?.notes)
      ? { notes: exception.notes ?? slot?.notes }
      : {}),
  };
}

function createExceptionSessions(
  date: string,
  semester: Semester,
  exceptions: readonly AcademicException[],
  slotsById: ReadonlyMap<string, TimetableSlot>,
  persistedSessions: readonly ClassSession[],
  eligibleSubjectIds: ReadonlySet<string>,
  eligibleSlotIds: ReadonlySet<string>,
): ResolvedSession[] {
  const sessionsById = new Map(
    persistedSessions.map((session) => [session.id, session]),
  );
  const generated: ResolvedSession[] = [];

  exceptions.forEach((exception) => {
    if (exception.type === "EXTRA_SESSION") {
      if (
        !dateIsWithin(date, exception.startDate, exception.endDate) ||
        !exception.subjectId ||
        !exception.startTime ||
        !exception.endTime ||
        !eligibleSubjectIds.has(exception.subjectId)
      ) {
        return;
      }
      generated.push({
        id: createOccurrenceId("EXTRA", exception.id, date),
        semesterId: semester.id,
        subjectId: exception.subjectId,
        date,
        startTime: exception.startTime,
        endTime: exception.endTime,
        status: "EXTRA",
        source: "EXTRA",
        faculty: [...(exception.faculty ?? [])],
        ...(exception.room ? { room: exception.room } : {}),
        ...(exception.notes ? { notes: exception.notes } : {}),
        attendanceStatus: "NOT_MARKED",
      });
      return;
    }

    if (
      exception.type !== "RESCHEDULED_SESSION" ||
      exception.replacementDate !== date
    ) {
      return;
    }
    const source = findRescheduleSource(exception, slotsById, sessionsById);
    if (
      !source ||
      !eligibleSubjectIds.has(source.subjectId) ||
      (source.timetableSlotId && !eligibleSlotIds.has(source.timetableSlotId))
    ) {
      return;
    }
    generated.push({
      id: createOccurrenceId("RESCHEDULED", exception.id, date),
      semesterId: semester.id,
      subjectId: source.subjectId,
      ...(source.timetableSlotId
        ? { timetableSlotId: source.timetableSlotId }
        : {}),
      ...(source.timetableVersionId
        ? { timetableVersionId: source.timetableVersionId }
        : {}),
      date,
      startTime: source.startTime,
      endTime: source.endTime,
      status: "RESCHEDULED",
      source: "RESCHEDULED",
      faculty: [...source.faculty],
      ...(source.room ? { room: source.room } : {}),
      ...(source.notes ? { notes: source.notes } : {}),
      attendanceStatus: "NOT_MARKED",
    });
  });
  return generated;
}

function sessionsAreEquivalent(
  first: ResolvedSession,
  second: ResolvedSession,
): boolean {
  return (
    first.date === second.date &&
    first.subjectId === second.subjectId &&
    first.startTime === second.startTime &&
    first.endTime === second.endTime &&
    first.source === second.source
  );
}

function mergeExceptionSessions(
  sessions: ResolvedSession[],
  additions: ResolvedSession[],
): ResolvedSession[] {
  const result = [...sessions];
  additions.forEach((addition) => {
    if (!result.some((session) => sessionsAreEquivalent(session, addition))) {
      result.push(addition);
    }
  });
  return result;
}

function applyDayExceptions(
  date: string,
  sessions: ResolvedSession[],
  exceptions: readonly AcademicException[],
): ResolvedSession[] {
  const dayExceptions = exceptions.filter(
    (exception) =>
      dateIsWithin(date, exception.startDate, exception.endDate) &&
      (exception.type === "HOLIDAY" ||
        exception.type === "BREAK" ||
        exception.type === "CANCELLED_DAY"),
  );
  if (dayExceptions.length === 0) return sessions;
  const isHoliday = dayExceptions.some(
    (exception) => exception.type === "HOLIDAY" || exception.type === "BREAK",
  );
  const latestNotes = dayExceptions
    .map((exception) => exception.notes)
    .filter((value): value is string => Boolean(value))
    .at(-1);
  return sessions.map((session) => ({
    ...session,
    status: isHoliday ? "HOLIDAY" : "CANCELLED",
    ...(latestNotes ? { notes: latestNotes } : {}),
  }));
}

function applyAttendanceRecords(
  sessions: ResolvedSession[],
  attendanceRecords: readonly AttendanceRecord[],
): ResolvedSession[] {
  const latestBySession = new Map<string, AttendanceRecord>();
  attendanceRecords.forEach((record) => {
    const current = latestBySession.get(record.classSessionId);
    if (
      !current ||
      record.markedAt > current.markedAt ||
      (record.markedAt === current.markedAt &&
        record.updatedAt > current.updatedAt)
    ) {
      latestBySession.set(record.classSessionId, record);
    }
  });
  return sessions.map((session) => ({
    ...session,
    attendanceStatus:
      latestBySession.get(session.id)?.status ?? session.attendanceStatus,
  }));
}

function sortSessions(sessions: ResolvedSession[]): ResolvedSession[] {
  return sessions.sort((left, right) => {
    const dateComparison = left.date.localeCompare(right.date);
    if (dateComparison !== 0) return dateComparison;
    const startComparison = left.startTime.localeCompare(right.startTime);
    if (startComparison !== 0) return startComparison;
    const endComparison = left.endTime.localeCompare(right.endTime);
    if (endComparison !== 0) return endComparison;
    const subjectComparison = left.subjectId.localeCompare(right.subjectId);
    if (subjectComparison !== 0) return subjectComparison;
    return left.id.localeCompare(right.id);
  });
}

export function resolveSessionsForDate({
  date,
  semester,
  timetableVersions,
  slots,
  subjects,
  electiveGroups = [],
  academicExceptions = [],
  persistedSessions = [],
  attendanceRecords = [],
  selectedBatch,
  selectedBatches,
  selectedElectiveSubjectIds,
  trackedClassTypes,
  includeZeroCredit = true,
  includeDisabled = false,
  includeMissingSubjects = false,
  weekStartsOn = "MONDAY",
}: ResolveSessionsForDateInput): ResolvedSession[] {
  parseIsoDate(date);
  if (date < semester.startDate || date > semester.endDate) return [];
  const dayOfWeek = getDayOfWeek(date);
  const isTeachingDay = semester.teachingDays.includes(dayOfWeek);
  const semesterExceptions = academicExceptions.filter(
    (exception) => exception.semesterId === semester.id,
  );

  const commonFilters = {
    subjects,
    electiveGroups,
    selectedBatch,
    selectedBatches,
    selectedElectiveSubjectIds,
    trackedClassTypes,
    includeZeroCredit,
    includeDisabled,
    includeMissingSubjects,
  };
  const eligibleSubjects = filterSubjectsForTracking(commonFilters);
  const eligibleSlots = filterTimetableSlots({ slots, ...commonFilters });
  const eligibleSubjectIds = new Set([
    ...eligibleSubjects.map(({ id }) => id),
    ...(includeMissingSubjects
      ? eligibleSlots.flatMap((slot) =>
          slot.subjectId ? [slot.subjectId] : [],
        )
      : []),
  ]);
  const eligibleSlotIds = new Set(eligibleSlots.map(({ id }) => id));

  const version = resolveTimetableVersionForDate(
    timetableVersions.filter(
      (candidate) => candidate.semesterId === semester.id,
    ),
    date,
  );
  const generated: ResolvedSession[] = [];
  if (version && isTeachingDay) {
    eligibleSlots
      .filter(
        (slot) =>
          slot.timetableVersionId === version.id &&
          slot.dayOfWeek === dayOfWeek &&
          matchesWeekPattern(slot, date, semester.startDate, weekStartsOn),
      )
      .forEach((slot) => {
        const session = makeGeneratedSession(semester, version, slot, date);
        if (session) generated.push(session);
      });
  }

  const persistedForDate = persistedSessions.filter((session) => {
    if (session.semesterId !== semester.id || session.date !== date)
      return false;
    // Persisted recurring sessions still belong to the timetable calendar. Explicit
    // EXTRA and RESCHEDULED sessions remain eligible on non-teaching days.
    if (!isTeachingDay && session.source === "TIMETABLE") return false;
    if (!eligibleSubjectIds.has(session.subjectId)) return false;
    return (
      !session.timetableSlotId || eligibleSlotIds.has(session.timetableSlotId)
    );
  });
  let resolved = mergePersistedSessions(generated, persistedForDate);
  resolved = applyTargetedExceptions(resolved, semesterExceptions);

  const slotsById = new Map(slots.map((slot) => [slot.id, slot]));
  const exceptionSessions = createExceptionSessions(
    date,
    semester,
    semesterExceptions,
    slotsById,
    persistedSessions,
    eligibleSubjectIds,
    eligibleSlotIds,
  );
  resolved = mergeExceptionSessions(resolved, exceptionSessions);
  resolved = applyTargetedExceptions(resolved, semesterExceptions);
  resolved = applyDayExceptions(date, resolved, semesterExceptions);
  resolved = applyAttendanceRecords(resolved, attendanceRecords);
  return sortSessions(resolved);
}

export function resolveSessionsInRange({
  startDate,
  endDate,
  ...context
}: ResolveSessionsInRangeInput): ResolvedSession[] {
  const boundedStart =
    startDate < context.semester.startDate
      ? context.semester.startDate
      : startDate;
  const boundedEnd =
    endDate > context.semester.endDate ? context.semester.endDate : endDate;
  if (boundedEnd < boundedStart) {
    parseIsoDate(startDate);
    parseIsoDate(endDate);
    return [];
  }
  return enumerateIsoDates(boundedStart, boundedEnd).flatMap((date) =>
    resolveSessionsForDate({ ...context, date }),
  );
}

export function isSessionEligibleForAbsence(
  session: Pick<ResolvedSession, "status">,
): boolean {
  switch (session.status) {
    case "SCHEDULED":
    case "RESCHEDULED":
    case "EXTRA":
      return true;
    case "HELD":
    case "CANCELLED":
    case "HOLIDAY":
    case "NOT_CONDUCTED":
      return false;
  }
}
