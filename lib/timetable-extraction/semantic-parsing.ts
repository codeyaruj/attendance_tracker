import { DAYS_OF_WEEK, type DayOfWeek } from "@/types";
import type {
  ExtractionConfidence,
  ExtractionWarning,
  ParsedCellEntry,
} from "./types";

const DAY_ALIASES: Record<DayOfWeek, string[]> = {
  MONDAY: ["MON", "MONDAY"],
  TUESDAY: ["TUE", "TUES", "TUESDAY"],
  WEDNESDAY: ["WED", "WEDNESDAY"],
  THURSDAY: ["THU", "THUR", "THURS", "THURSDAY"],
  FRIDAY: ["FRI", "FRIDAY"],
  SATURDAY: ["SAT", "SATURDAY"],
  SUNDAY: ["SUN", "SUNDAY"],
};

export function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

export function fuzzyWeekday(
  value: string,
): { day: DayOfWeek; confidence: number } | undefined {
  const normalized = value.toUpperCase().replace(/[^A-Z]/g, "");
  if (normalized.length < 3) return undefined;
  let best: { day: DayOfWeek; distance: number; length: number } | undefined;
  for (const day of DAYS_OF_WEEK) {
    for (const alias of DAY_ALIASES[day]) {
      const distance = editDistance(normalized, alias);
      if (!best || distance < best.distance) {
        best = {
          day,
          distance,
          length: Math.max(normalized.length, alias.length),
        };
      }
    }
  }
  if (!best || best.distance > Math.max(1, Math.floor(best.length * 0.3))) {
    return undefined;
  }
  return { day: best.day, confidence: 1 - best.distance / best.length };
}

function normalizedClock(
  hourText: string,
  minuteText: string,
): string | undefined {
  const hour = Number(hourText.replace(/[O]/gi, "0").replace(/[IL]/gi, "1"));
  const minute = Number(minuteText.replace(/[O]/gi, "0").replace(/S/gi, "5"));
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour > 23 ||
    minute > 59
  ) {
    return undefined;
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseTimeRange(
  value: string,
): { startTime: string; endTime: string; confidence: number } | undefined {
  const normalized = value
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\bTO\b/g, "-")
    .replace(/[.]/g, ":")
    .replace(/\s+/g, " ");
  const match = normalized.match(
    /([0-2OIL]?[0-9OIL]):([0-5OILS][0-9OILS])\s*-\s*([0-2OIL]?[0-9OIL]):([0-5OILS][0-9OILS])/,
  );
  if (!match) return undefined;
  const startTime = normalizedClock(match[1], match[2]);
  let endTime = normalizedClock(match[3], match[4]);
  if (!startTime || !endTime) return undefined;
  if (endTime <= startTime && Number(endTime.slice(0, 2)) < 8) {
    endTime = `${String(Number(endTime.slice(0, 2)) + 12).padStart(2, "0")}:${endTime.slice(3)}`;
  }
  return {
    startTime,
    endTime,
    confidence: endTime > startTime ? 0.95 : 0.55,
  };
}

export function normalizeSubjectCode(value: string): string | undefined {
  const compact = value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
  if (!/^(?=.*[A-Z])(?=.*\d)[A-Z0-9-]{4,15}$/.test(compact)) return undefined;
  const firstDigit = compact.search(/\d/);
  if (firstDigit < 1) return compact;
  return (
    compact.slice(0, firstDigit).replace(/0/g, "O").replace(/1/g, "I") +
    compact
      .slice(firstDigit)
      .replace(/O/g, "0")
      .replace(/[IL]/g, "1")
      .replace(/S/g, "5")
      .replace(/B/g, "8")
      .replace(/G/g, "6")
      .replace(/Z/g, "2")
  );
}

export interface LegendEntry {
  code: string;
  name?: string;
  facultyText?: string;
}

export function parseLegendRows(
  rows: readonly string[],
): Map<string, LegendEntry> {
  const result = new Map<string, LegendEntry>();
  for (const row of rows) {
    const tokens = row
      .trim()
      .split(/\s{2,}|\t|\|/)
      .filter(Boolean);
    const rawCode = row.match(/\b[A-Z0-9-]{4,15}\b/i)?.[0];
    const code = rawCode ? normalizeSubjectCode(rawCode) : undefined;
    if (!code) continue;
    const remaining = tokens.filter((token) => !token.includes(rawCode ?? ""));
    result.set(code, {
      code,
      name: remaining[0]?.trim() || undefined,
      facultyText: remaining.slice(1).join(" ").trim() || undefined,
    });
  }
  return result;
}

export function correctCodeFromLegend(
  rawCode: string,
  legend: ReadonlyMap<string, LegendEntry>,
): { code: string; reason?: string; confidence: number } {
  const normalized = normalizeSubjectCode(rawCode) ?? rawCode.toUpperCase();
  if (legend.has(normalized)) return { code: normalized, confidence: 0.98 };
  const matches = [...legend.keys()]
    .map((code) => ({ code, distance: editDistance(normalized, code) }))
    .filter((candidate) => candidate.distance <= 1)
    .sort((left, right) => left.distance - right.distance);
  if (matches.length === 1) {
    return {
      code: matches[0].code,
      reason: `Matched ${rawCode} to the parsed legend entry ${matches[0].code}`,
      confidence: 0.9,
    };
  }
  return { code: normalized, confidence: 0.62 };
}

export function parseCellEntries(
  rawText: string,
  legend: ReadonlyMap<string, LegendEntry> = new Map(),
): ParsedCellEntry[] {
  const text = rawText.replace(/\r/g, "").trim();
  if (!text) return [];
  if (/\b(?:LUNCH|BREAK|RECESS)\b/i.test(text)) {
    return [{ rawText, type: "break", confidence: 0.98 }];
  }
  const lines = text.split(/\n|;|\s*\/\s*/).filter((line) => line.trim());
  const entries: ParsedCellEntry[] = [];
  for (const line of lines) {
    const rawCode = line.match(/\b[A-Z0-9-]{4,15}\b/i)?.[0];
    const correction = rawCode
      ? correctCodeFromLegend(rawCode, legend)
      : undefined;
    const legendEntry = correction ? legend.get(correction.code) : undefined;
    const facultyInitials = [
      ...line.matchAll(/\(([A-Z]{1,6}(?:\s*[,/&]\s*[A-Z]{1,6})*)\)/g),
    ]
      .flatMap((match) => match[1].split(/[,/&]/))
      .map((item) => item.trim())
      .filter(Boolean);
    const batch = line.match(/\b(?:BATCH\s*)?([A-Z]\d|C\d(?:C\d)*)\b/i)?.[1];
    const room = line.match(
      /\b(?:ROOM|RM)\s*[:#-]?\s*([A-Z0-9-]{2,15})\b/i,
    )?.[1];
    const isLab = /\bLAB(?:ORATORY)?\b/i.test(line) || /\bC\dC\d\b/i.test(line);
    const isProject = /\b(?:PROJECT|INTERNSHIP|ASSESSMENT)\b/i.test(line);
    entries.push({
      rawText: line.trim(),
      subjectCode: rawCode ? normalizeSubjectCode(rawCode) : undefined,
      correctedSubjectCode: correction?.code,
      correctionReason: correction?.reason,
      subjectName: legendEntry?.name,
      facultyInitials,
      facultyNames: legendEntry?.facultyText ? [legendEntry.facultyText] : [],
      room,
      batch,
      group: batch,
      type: isLab ? "lab" : isProject ? "project" : "lecture",
      confidence: correction?.confidence ?? (rawCode ? 0.72 : 0.48),
    });
  }
  return entries;
}

export function calculateExtractionConfidence(values: {
  inputQuality: number;
  tableDetection: number;
  perspectiveCorrection: number;
  gridDetection: number;
  headerParsing: number;
  cellOCR: number;
  legendMapping: number;
  semanticParsing: number;
  warnings?: ExtractionWarning[];
}): ExtractionConfidence {
  const weights = [0.08, 0.17, 0.07, 0.18, 0.14, 0.16, 0.08, 0.12];
  const scores = [
    values.inputQuality,
    values.tableDetection,
    values.perspectiveCorrection,
    values.gridDetection,
    values.headerParsing,
    values.cellOCR,
    values.legendMapping,
    values.semanticParsing,
  ].map((score) => Math.max(0, Math.min(1, score)));
  return {
    ...values,
    warnings: values.warnings ?? [],
    overall: scores.reduce(
      (sum, score, index) => sum + score * weights[index],
      0,
    ),
  };
}
