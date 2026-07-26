import type { ExceptionType } from "@/types/domain";

export type SetupExceptionType = Extract<ExceptionType, "HOLIDAY" | "BREAK">;

export interface ParsedAcademicExceptionEntry {
  type: SetupExceptionType;
  startDate: string;
  endDate: string;
  notes: string;
}

export interface ParseAcademicExceptionEntriesOptions {
  type: SetupExceptionType;
  semesterStartDate: string;
  semesterEndDate: string;
}

export interface ParseAcademicExceptionEntriesResult {
  entries: ParsedAcademicExceptionEntry[];
  errors: string[];
}

const ISO_DATE_SOURCE = String.raw`\d{4}-\d{2}-\d{2}`;
const ENTRY_PATTERN = new RegExp(
  String.raw`^(${ISO_DATE_SOURCE})(?:\s+(?:to|through|-|–)\s+(${ISO_DATE_SOURCE}))?(?:\s+(?:—|--|-|\||:)\s*(.+))?$`,
  "i",
);

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function entryNote(type: SetupExceptionType, customNote?: string): string {
  const label = type === "HOLIDAY" ? "Holiday" : "Reading / exam period";
  const normalized = customNote?.trim().replace(/\s+/g, " ");
  return normalized
    ? `${label}: ${normalized}`
    : `${label} added during semester setup`;
}

/**
 * Parses one closure per line. Supported examples:
 * `2026-08-15` and `2026-10-20 to 2026-10-27 — Mid-semester exams`.
 */
export function parseAcademicExceptionEntries(
  input: string,
  options: ParseAcademicExceptionEntriesOptions,
): ParseAcademicExceptionEntriesResult {
  const entries: ParsedAcademicExceptionEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  input.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;
    const lineNumber = index + 1;
    const match = ENTRY_PATTERN.exec(line);
    if (!match) {
      errors.push(
        `Line ${lineNumber}: use YYYY-MM-DD or YYYY-MM-DD to YYYY-MM-DD, optionally followed by — a note.`,
      );
      return;
    }

    const [, startDate, explicitEndDate, customNote] = match;
    const endDate = explicitEndDate ?? startDate;
    if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) {
      errors.push(
        `Line ${lineNumber}: enter a valid calendar date in YYYY-MM-DD format.`,
      );
      return;
    }
    if (endDate < startDate) {
      errors.push(
        `Line ${lineNumber}: the range must end on or after it starts.`,
      );
      return;
    }
    if (
      startDate < options.semesterStartDate ||
      endDate > options.semesterEndDate
    ) {
      errors.push(
        `Line ${lineNumber}: dates must fall within ${options.semesterStartDate} to ${options.semesterEndDate}.`,
      );
      return;
    }
    if (customNote && customNote.trim().length > 450) {
      errors.push(
        `Line ${lineNumber}: keep the note to 450 characters or fewer.`,
      );
      return;
    }

    const key = `${options.type}:${startDate}:${endDate}`;
    if (seen.has(key)) {
      errors.push(`Line ${lineNumber}: this date or range is already listed.`);
      return;
    }
    seen.add(key);
    entries.push({
      type: options.type,
      startDate,
      endDate,
      notes: entryNote(options.type, customNote),
    });
  });

  return { entries, errors };
}

export function parseSemesterExceptionEntries(input: {
  holidayEntries: string;
  breakEntries: string;
  semesterStartDate: string;
  semesterEndDate: string;
}): ParseAcademicExceptionEntriesResult {
  const shared = {
    semesterStartDate: input.semesterStartDate,
    semesterEndDate: input.semesterEndDate,
  };
  const holidays = parseAcademicExceptionEntries(input.holidayEntries, {
    ...shared,
    type: "HOLIDAY",
  });
  const breaks = parseAcademicExceptionEntries(input.breakEntries, {
    ...shared,
    type: "BREAK",
  });
  return {
    entries: [...holidays.entries, ...breaks.entries],
    errors: [...holidays.errors, ...breaks.errors],
  };
}
