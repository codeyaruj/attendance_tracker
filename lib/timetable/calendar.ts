import type {
  DayOfWeek,
  TimetableSlot,
  TimetableVersion,
  WeekStartPreference,
} from "@/types/domain";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_IN_MILLISECONDS = 86_400_000;
const DAY_NAMES: readonly DayOfWeek[] = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

export function parseIsoDate(date: string): Date {
  if (!ISO_DATE_PATTERN.test(date)) {
    throw new RangeError(`Invalid ISO date: ${date}`);
  }
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid ISO date: ${date}`);
  }
  return parsed;
}

export function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getDayOfWeek(date: string): DayOfWeek {
  return DAY_NAMES[parseIsoDate(date).getUTCDay()];
}

function startOfAcademicWeek(
  date: string,
  weekStartsOn: WeekStartPreference,
): Date {
  const parsed = parseIsoDate(date);
  const firstDayIndex = weekStartsOn === "SUNDAY" ? 0 : 1;
  const offset = (parsed.getUTCDay() - firstDayIndex + 7) % 7;
  parsed.setUTCDate(parsed.getUTCDate() - offset);
  return parsed;
}

export function getAcademicWeekNumber(
  date: string,
  semesterStartDate: string,
  weekStartsOn: WeekStartPreference = "MONDAY",
): number {
  const week = startOfAcademicWeek(date, weekStartsOn);
  const firstWeek = startOfAcademicWeek(semesterStartDate, weekStartsOn);
  const difference = Math.floor(
    (week.getTime() - firstWeek.getTime()) / DAY_IN_MILLISECONDS,
  );
  return Math.floor(difference / 7) + 1;
}

function parsePositiveInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function matchesNumberList(pattern: string, academicWeek: number): boolean {
  const normalized = pattern.replace(/^WEEKS?\s*:?\s*/i, "").trim();
  if (!/^\d+(?:\s*-\s*\d+)?(?:\s*,\s*\d+(?:\s*-\s*\d+)?)*$/.test(normalized)) {
    return false;
  }
  return normalized.split(",").some((part) => {
    const [startValue, endValue] = part.trim().split(/\s*-\s*/);
    const start = parsePositiveInteger(startValue);
    const end = endValue ? parsePositiveInteger(endValue) : start;
    return (
      start !== undefined &&
      end !== undefined &&
      start <= academicWeek &&
      academicWeek <= end
    );
  });
}

function matchesCyclePattern(pattern: string, academicWeek: number): boolean {
  const fraction = pattern.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (fraction) {
    const phase = parsePositiveInteger(fraction[1]);
    const cycle = parsePositiveInteger(fraction[2]);
    return Boolean(
      phase &&
      cycle &&
      phase <= cycle &&
      ((academicWeek - 1) % cycle) + 1 === phase,
    );
  }

  const phases = pattern.match(/^(\d+(?:\s*,\s*\d+)*)\s+OF\s+(\d+)$/i);
  if (phases) {
    const cycle = parsePositiveInteger(phases[2]);
    if (!cycle) return false;
    const activePhases = phases[1]
      .split(",")
      .map((value) => parsePositiveInteger(value.trim()))
      .filter(
        (value): value is number => value !== undefined && value <= cycle,
      );
    return activePhases.includes(((academicWeek - 1) % cycle) + 1);
  }

  const every = pattern.match(/^EVERY\s+(\d+)\s+WEEKS?$/i);
  if (every) {
    const cycle = parsePositiveInteger(every[1]);
    return Boolean(cycle && (academicWeek - 1) % cycle === 0);
  }

  const mask = pattern.replace(/\s/g, "");
  if (/^[01]{2,}$/.test(mask)) {
    return mask[(academicWeek - 1) % mask.length] === "1";
  }
  return false;
}

export function matchesCustomWeekPattern(
  pattern: string,
  academicWeek: number,
): boolean {
  if (!Number.isSafeInteger(academicWeek) || academicWeek < 1) return false;
  const normalized = pattern.trim().toUpperCase();
  if (!normalized) return false;
  if (normalized === "EVERY_WEEK" || normalized === "EVERY WEEK") return true;
  if (
    normalized === "ODD" ||
    normalized === "ODD_WEEK" ||
    normalized === "ODD WEEK"
  ) {
    return academicWeek % 2 === 1;
  }
  if (
    normalized === "EVEN" ||
    normalized === "EVEN_WEEK" ||
    normalized === "EVEN WEEK"
  ) {
    return academicWeek % 2 === 0;
  }
  return (
    matchesCyclePattern(normalized, academicWeek) ||
    matchesNumberList(normalized, academicWeek)
  );
}

export function matchesWeekPattern(
  slot: Pick<TimetableSlot, "weekPattern" | "customWeekPattern">,
  date: string,
  semesterStartDate: string,
  weekStartsOn: WeekStartPreference = "MONDAY",
): boolean {
  const academicWeek = getAcademicWeekNumber(
    date,
    semesterStartDate,
    weekStartsOn,
  );
  if (academicWeek < 1) return false;

  switch (slot.weekPattern) {
    case "EVERY_WEEK":
      return true;
    case "ODD_WEEK":
      return academicWeek % 2 === 1;
    case "EVEN_WEEK":
      return academicWeek % 2 === 0;
    case "CUSTOM":
      return slot.customWeekPattern
        ? matchesCustomWeekPattern(slot.customWeekPattern, academicWeek)
        : false;
  }
}

export interface VersionResolutionOptions {
  includeUnconfirmed?: boolean;
}

export function resolveTimetableVersionForDate(
  versions: readonly TimetableVersion[],
  date: string,
  options: VersionResolutionOptions = {},
): TimetableVersion | undefined {
  parseIsoDate(date);
  const candidates = versions.filter(
    (version) =>
      (options.includeUnconfirmed || version.isConfirmed) &&
      version.effectiveStartDate <= date &&
      (version.effectiveEndDate === undefined ||
        version.effectiveEndDate >= date),
  );
  return candidates.sort((left, right) => {
    const startComparison = right.effectiveStartDate.localeCompare(
      left.effectiveStartDate,
    );
    if (startComparison !== 0) return startComparison;
    if (right.version !== left.version) return right.version - left.version;
    return right.updatedAt.localeCompare(left.updatedAt);
  })[0];
}

export function enumerateIsoDates(
  startDate: string,
  endDate: string,
): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (end < start) throw new RangeError("End date cannot precede start date");
  const count =
    Math.floor((end.getTime() - start.getTime()) / DAY_IN_MILLISECONDS) + 1;
  if (count > 3_660) {
    throw new RangeError("A timetable range cannot exceed 3,660 calendar days");
  }
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return formatIsoDate(date);
  });
}
