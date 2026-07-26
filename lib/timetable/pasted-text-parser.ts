import type { ClassType, DayOfWeek, WeekPattern } from "@/types/domain";
import type {
  DraftAmbiguousItem,
  DraftSlot,
  DraftSubject,
  NormalizedTimetableDraft,
} from "@/types/draft";

import { timetableExtractionResultSchema } from "@/lib/validation";

const DAY_ALIASES: ReadonlyArray<[RegExp, DayOfWeek]> = [
  [/^(?:MON|MONDAY)\b/i, "MONDAY"],
  [/^(?:TUE|TUES|TUESDAY)\b/i, "TUESDAY"],
  [/^(?:WED|WEDNESDAY)\b/i, "WEDNESDAY"],
  [/^(?:THU|THUR|THURS|THURSDAY)\b/i, "THURSDAY"],
  [/^(?:FRI|FRIDAY)\b/i, "FRIDAY"],
  [/^(?:SAT|SATURDAY)\b/i, "SATURDAY"],
  [/^(?:SUN|SUNDAY)\b/i, "SUNDAY"],
];
const TIME_RANGE_PATTERN =
  /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:-|–|—|TO|UNTIL|\||,)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/i;
const CODE_PATTERN =
  /\b(?=[A-Z0-9-]{4,15}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z]{1,8}[- ]?\d{2,5}[A-Z]?\b/i;

export interface PastedTimetableParserOptions {
  title?: string;
  timezone?: string;
  defaultClassType?: ClassType;
}

interface ParsedLine {
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  code?: string;
  name: string;
  classType: ClassType;
  faculty: string[];
  room?: string;
  batchOptions: string[];
  weekPattern: WeekPattern;
  customWeekPattern?: string;
  isZeroCredit: boolean;
  isPlaceholder: boolean;
  isBreak: boolean;
  confidence: number;
  ambiguity?: DraftAmbiguousItem;
}

export class PastedTimetableParseError extends Error {
  public readonly unparsedLines: string[];

  public constructor(message: string, unparsedLines: string[]) {
    super(message);
    this.name = "PastedTimetableParseError";
    this.unparsedLines = unparsedLines;
  }
}

function normalizeTime(hour: string, minute: string): string {
  return `${hour.padStart(2, "0")}:${minute}`;
}

function detectDay(
  line: string,
): { day: DayOfWeek; remainder: string } | undefined {
  const trimmed = line.trim();
  for (const [pattern, day] of DAY_ALIASES) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        day,
        remainder: trimmed.slice(match[0].length).replace(/^[\s,:;|–—-]+/, ""),
      };
    }
  }
  return undefined;
}

function detectClassType(value: string, fallback: ClassType): ClassType {
  if (/\bLAB(?:ORATORY)?\b/i.test(value)) return "LAB";
  if (/\bTUTORIAL\b|\bTUT\b/i.test(value)) return "TUTORIAL";
  if (/\bSEMINAR\b/i.test(value)) return "SEMINAR";
  if (/\bPROJECT\b/i.test(value)) return "PROJECT";
  if (/\bTHEORY\b|\bLECTURE\b/i.test(value)) return "THEORY";
  return fallback;
}

function detectWeekPattern(value: string): {
  weekPattern: WeekPattern;
  customWeekPattern?: string;
} {
  if (/\bODD(?:\s+WEEK)?S?\b/i.test(value)) return { weekPattern: "ODD_WEEK" };
  if (/\bEVEN(?:\s+WEEK)?S?\b/i.test(value))
    return { weekPattern: "EVEN_WEEK" };
  const custom = value.match(/\bWEEKS?\s*[:#]?\s*(\d+(?:\s*[-,]\s*\d+)*)/i);
  if (custom) {
    return { weekPattern: "CUSTOM", customWeekPattern: custom[1] };
  }
  return { weekPattern: "EVERY_WEEK" };
}

function extractNamedValue(value: string, label: string): string | undefined {
  const expression = new RegExp(
    `\\b${label}\\s*[:#-]?\\s*([A-Za-z0-9][A-Za-z0-9 ._/-]*?)(?=\\s*(?:[|;,]|\\b(?:ROOM|RM|FACULTY|FAC|BATCH|ODD|EVEN|WEEKS?|THEORY|LAB|TUTORIAL|TUT|SEMINAR|PROJECT)\\b|$))`,
    "i",
  );
  return value.match(expression)?.[1]?.trim();
}

function createShortName(name: string, code?: string): string {
  if (code) return code.replace(/\s/g, "").slice(0, 12).toUpperCase();
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  return (initials || name).slice(0, 12);
}

function cleanSubjectName(value: string, code?: string): string {
  let cleaned = value;
  if (code) cleaned = cleaned.replace(code, " ");
  cleaned = cleaned
    .replace(
      /\b(?:THEORY|LECTURE|LAB(?:ORATORY)?|TUTORIAL|TUT|SEMINAR)\b/gi,
      " ",
    )
    .replace(/\b(?:ODD|EVEN)(?:\s+WEEK)?S?\b/gi, " ")
    .replace(/\bWEEKS?\s*[:#]?\s*\d+(?:\s*[-,]\s*\d+)*/gi, " ")
    .replace(/\b(?:ZERO|0)\s*[- ]?CREDIT\b/gi, " ")
    .replace(
      /\b(?:ROOM|RM|FACULTY|FAC|BATCH)\s*[:#-]?\s*[A-Za-z0-9][A-Za-z0-9 ._/-]*?(?=\s*(?:[|;,]|$))/gi,
      " ",
    )
    .replace(/[\[\](){}]/g, " ")
    .replace(/[|;,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned;
}

function parseLine(
  line: string,
  lineIndex: number,
  defaultClassType: ClassType,
): ParsedLine | undefined {
  const day = detectDay(line);
  if (!day) return undefined;
  const time = day.remainder.match(TIME_RANGE_PATTERN);
  if (!time) return undefined;

  const startTime = normalizeTime(time[1], time[2]);
  const endTime = normalizeTime(time[3], time[4]);
  if (endTime <= startTime) return undefined;
  const withoutTime = day.remainder.replace(time[0], " ").trim();
  const isBreak = /\b(?:LUNCH|BREAK|RECESS)\b/i.test(withoutTime);
  const isPlaceholder = /\b(?:PLACEHOLDER|TBA|MINI\s+PROJECT)\b/i.test(
    withoutTime,
  );
  const classType = detectClassType(withoutTime, defaultClassType);
  const codeMatch = withoutTime.match(CODE_PATTERN);
  const code = codeMatch?.[0].replace(/\s/g, "").toUpperCase();
  const room =
    extractNamedValue(withoutTime, "(?:ROOM|RM)") ??
    withoutTime.match(/\b(?:ROOM|RM)\s*[:#-]?\s*([A-Za-z0-9-]+)/i)?.[1];
  const facultyValue = extractNamedValue(withoutTime, "(?:FACULTY|FAC)");
  const faculty = facultyValue
    ? facultyValue
        .split(/[+/&]/)
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const batchValue = extractNamedValue(withoutTime, "BATCH");
  const batchOptions = batchValue
    ? batchValue
        .split(/[+/&]/)
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
  const { weekPattern, customWeekPattern } = detectWeekPattern(withoutTime);
  const rawName = cleanSubjectName(withoutTime, codeMatch?.[0]);
  const name = isBreak
    ? /\bLUNCH\b/i.test(withoutTime)
      ? "Lunch"
      : "Break"
    : rawName || code || `Unresolved class ${lineIndex + 1}`;
  const inferredName = !isBreak && !rawName;
  const confidence = inferredName ? 0.58 : code ? 0.86 : 0.76;
  return {
    dayOfWeek: day.day,
    startTime,
    endTime,
    code,
    name,
    classType: isBreak ? "OTHER" : classType,
    faculty,
    room,
    batchOptions,
    weekPattern,
    customWeekPattern,
    isZeroCredit: /\b(?:ZERO|0)\s*[- ]?CREDIT\b/i.test(withoutTime),
    isPlaceholder,
    isBreak,
    confidence,
    ambiguity: inferredName
      ? {
          id: `ambiguity_${lineIndex + 1}`,
          field: "subjectName",
          possibleValues: [code ?? "Unknown subject"],
          sourceDescription: `Pasted line ${lineIndex + 1}`,
          confidence,
        }
      : undefined,
  };
}

function subjectKey(line: ParsedLine): string {
  return `${line.code?.toLocaleLowerCase() ?? line.name.toLocaleLowerCase()}|${line.classType}`;
}

export function parsePastedTimetableText(
  text: string,
  options: PastedTimetableParserOptions = {},
): NormalizedTimetableDraft {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    throw new PastedTimetableParseError("No timetable text was provided", []);
  }

  const parsedLines: ParsedLine[] = [];
  const unparsedLines: string[] = [];
  lines.forEach((line, index) => {
    const parsed = parseLine(line, index, options.defaultClassType ?? "THEORY");
    if (parsed) parsedLines.push(parsed);
    else unparsedLines.push(line);
  });
  if (parsedLines.length === 0) {
    throw new PastedTimetableParseError(
      "No lines contained a recognizable day and time range",
      unparsedLines,
    );
  }

  const subjectByKey = new Map<string, DraftSubject>();
  const timetableSlots: DraftSlot[] = [];
  const ambiguousItems: DraftAmbiguousItem[] = [];
  parsedLines.forEach((line, index) => {
    let subjectTemporaryId: string | undefined;
    if (!line.isBreak) {
      const key = subjectKey(line);
      let subject = subjectByKey.get(key);
      if (!subject) {
        subject = {
          temporaryId: `subject_${subjectByKey.size + 1}`,
          ...(line.code ? { code: line.code } : {}),
          name: line.name,
          shortName: createShortName(line.name, line.code),
          credits: line.isZeroCredit ? 0 : 3,
          classType: line.classType,
          faculty: line.faculty,
          isZeroCredit: line.isZeroCredit,
          confidence: line.confidence,
        };
        subjectByKey.set(key, subject);
      } else {
        subject.faculty = [...new Set([...subject.faculty, ...line.faculty])];
        subject.confidence = Math.min(subject.confidence, line.confidence);
      }
      subjectTemporaryId = subject.temporaryId;
    }
    if (line.ambiguity) ambiguousItems.push(line.ambiguity);
    timetableSlots.push({
      temporaryId: `slot_${index + 1}`,
      ...(subjectTemporaryId ? { subjectTemporaryId } : {}),
      dayOfWeek: line.dayOfWeek,
      startTime: line.startTime,
      endTime: line.endTime,
      faculty: line.faculty,
      ...(line.room ? { room: line.room } : {}),
      classType: line.classType,
      batchOptions: line.batchOptions,
      weekPattern: line.weekPattern,
      ...(line.customWeekPattern
        ? { customWeekPattern: line.customWeekPattern }
        : {}),
      confidence: line.confidence,
      isEnabled: !line.isBreak,
      isPlaceholder: line.isPlaceholder,
      isBreak: line.isBreak,
    });
  });

  const days = [...new Set(parsedLines.map((line) => line.dayOfWeek))];
  const timeSlotKeys = [
    ...new Set(parsedLines.map((line) => `${line.startTime}|${line.endTime}`)),
  ];
  const detectedBatchOptions = [
    ...new Set(parsedLines.flatMap((line) => line.batchOptions)),
  ];
  const confidenceTotal = parsedLines.reduce(
    (total, line) => total + line.confidence,
    0,
  );
  const warnings = [
    "Pasted text is an automated draft and must be confirmed before activation.",
    ...(unparsedLines.length > 0
      ? [`${unparsedLines.length} line(s) could not be parsed.`]
      : []),
  ];

  return timetableExtractionResultSchema.parse({
    title: options.title?.trim() || "Pasted timetable",
    timezone: options.timezone ?? "Asia/Kolkata",
    days,
    timeSlots: timeSlotKeys.map((key) => {
      const [startTime, endTime] = key.split("|");
      return { startTime, endTime };
    }),
    subjects: [...subjectByKey.values()],
    timetableSlots,
    detectedBatchOptions,
    detectedElectiveGroups: [],
    ambiguousItems,
    warnings,
    overallConfidence: Math.max(
      0,
      Math.min(
        1,
        confidenceTotal / parsedLines.length - unparsedLines.length * 0.03,
      ),
    ),
  });
}

export function tryParsePastedTimetableText(
  text: string,
  options: PastedTimetableParserOptions = {},
):
  | { success: true; data: NormalizedTimetableDraft }
  | { success: false; error: PastedTimetableParseError } {
  try {
    return { success: true, data: parsePastedTimetableText(text, options) };
  } catch (error) {
    if (error instanceof PastedTimetableParseError) {
      return { success: false, error };
    }
    throw error;
  }
}
