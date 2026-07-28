import { DAYS_OF_WEEK, type DayOfWeek } from "@/types";

export interface WeeklyGridSession {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
}

export interface WeeklyGridTimeColumn {
  startTime: string;
  endTime: string;
}

export interface WeeklyGridPlacement<T extends WeeklyGridSession> {
  session: T;
  startColumn: number;
  columnSpan: number;
  lane: number;
  overlaps: boolean;
}

export interface WeeklyGridDay<T extends WeeklyGridSession> {
  dayOfWeek: DayOfWeek;
  laneCount: number;
  placements: WeeklyGridPlacement<T>[];
}

export interface WeeklyGridMatrix<T extends WeeklyGridSession> {
  columns: WeeklyGridTimeColumn[];
  days: WeeklyGridDay<T>[];
  warnings: string[];
}

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function weeklyGridTimeToMinutes(value: string): number | undefined {
  if (!TIME_PATTERN.test(value)) return undefined;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function chronological(left: string, right: string): number {
  return (
    (weeklyGridTimeToMinutes(left) ?? Number.MAX_SAFE_INTEGER) -
    (weeklyGridTimeToMinutes(right) ?? Number.MAX_SAFE_INTEGER)
  );
}

export function buildWeeklyTimetableMatrix<T extends WeeklyGridSession>(
  sessions: readonly T[],
  options: {
    days?: readonly DayOfWeek[];
    timeSlots?: readonly WeeklyGridTimeColumn[];
  } = {},
): WeeklyGridMatrix<T> {
  const warnings: string[] = [];
  const validSessions = sessions.filter((session) => {
    const start = weeklyGridTimeToMinutes(session.startTime);
    const end = weeklyGridTimeToMinutes(session.endTime);
    if (start === undefined || end === undefined || start >= end) {
      warnings.push(
        `${session.dayOfWeek} session ${session.id} has an invalid time range.`,
      );
      return false;
    }
    return true;
  });

  const boundaries = new Set<string>();
  for (const slot of options.timeSlots ?? []) {
    if (
      weeklyGridTimeToMinutes(slot.startTime) !== undefined &&
      weeklyGridTimeToMinutes(slot.endTime) !== undefined
    ) {
      boundaries.add(slot.startTime);
      boundaries.add(slot.endTime);
    }
  }
  for (const session of validSessions) {
    boundaries.add(session.startTime);
    boundaries.add(session.endTime);
  }
  const seededBoundaries = [...boundaries].sort(chronological);
  const durations = [...(options.timeSlots ?? []), ...validSessions]
    .map((item) => {
      const start = weeklyGridTimeToMinutes(item.startTime);
      const end = weeklyGridTimeToMinutes(item.endTime);
      return start === undefined || end === undefined ? 0 : end - start;
    })
    .filter((duration) => duration > 0);
  const shortestDuration = durations.length ? Math.min(...durations) : 0;
  const periodDuration =
    shortestDuration >= 120 && shortestDuration % 60 === 0
      ? 60
      : shortestDuration;
  if (periodDuration > 0) {
    for (let index = 0; index < seededBoundaries.length - 1; index += 1) {
      const start = weeklyGridTimeToMinutes(seededBoundaries[index]);
      const end = weeklyGridTimeToMinutes(seededBoundaries[index + 1]);
      if (start === undefined || end === undefined) continue;
      for (
        let boundary = start + periodDuration;
        boundary < end && (end - start) % periodDuration === 0;
        boundary += periodDuration
      ) {
        boundaries.add(
          `${String(Math.floor(boundary / 60)).padStart(2, "0")}:${String(boundary % 60).padStart(2, "0")}`,
        );
      }
    }
  }
  const sortedBoundaries = [...boundaries].sort(chronological);
  const columns = sortedBoundaries.slice(0, -1).map((startTime, index) => ({
    startTime,
    endTime: sortedBoundaries[index + 1],
  }));

  const requestedDays = new Set(
    options.days ?? validSessions.map((session) => session.dayOfWeek),
  );
  const days = DAYS_OF_WEEK.filter((day) => requestedDays.has(day)).map(
    (dayOfWeek): WeeklyGridDay<T> => {
      const daySessions = validSessions
        .filter((session) => session.dayOfWeek === dayOfWeek)
        .sort(
          (left, right) =>
            chronological(left.startTime, right.startTime) ||
            chronological(left.endTime, right.endTime) ||
            left.id.localeCompare(right.id),
        );
      const laneEndColumns: number[] = [];
      const placements = daySessions.flatMap((session) => {
        const startColumn = sortedBoundaries.indexOf(session.startTime);
        const endColumn = sortedBoundaries.indexOf(session.endTime);
        if (startColumn < 0 || endColumn <= startColumn) {
          warnings.push(
            `${dayOfWeek} session ${session.id} does not align with the time header.`,
          );
          return [];
        }
        let lane = laneEndColumns.findIndex((end) => end <= startColumn);
        if (lane === -1) {
          lane = laneEndColumns.length;
          laneEndColumns.push(endColumn);
        } else {
          laneEndColumns[lane] = endColumn;
        }
        return [
          {
            session,
            startColumn,
            columnSpan: endColumn - startColumn,
            lane,
            overlaps: daySessions.some(
              (candidate) =>
                candidate.id !== session.id &&
                candidate.startTime < session.endTime &&
                session.startTime < candidate.endTime,
            ),
          },
        ];
      });
      return {
        dayOfWeek,
        laneCount: Math.max(1, laneEndColumns.length),
        placements,
      };
    },
  );

  return { columns, days, warnings };
}
