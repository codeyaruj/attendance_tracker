import { timetableExtractionResultSchema } from "@/lib/validation";
import {
  DAYS_OF_WEEK,
  type ClassType,
  type DayOfWeek,
  type NormalizedTimetableDraft,
} from "@/types";
import { groupWordsIntoLines, normalizeOcrWords } from "./text-grouping";
import { parseStructuredPage } from "./structured-timetable-parser";
import {
  EXTRACTION_LIMITS,
  TimetableExtractionError,
  type BoundingBox,
  type ExtractedPage,
  type OcrPageResult,
  type OcrWord,
} from "./types";

const DAY_PATTERNS: ReadonlyArray<[RegExp, DayOfWeek]> = [
  [/^(?:MON|MONDAY)$/i, "MONDAY"],
  [/^(?:TUE|TUES|TUESDAY)$/i, "TUESDAY"],
  [/^(?:WED|WEDNESDAY)$/i, "WEDNESDAY"],
  [/^(?:THU|THUR|THURS|THURSDAY)$/i, "THURSDAY"],
  [/^(?:FRI|FRIDAY)$/i, "FRIDAY"],
  [/^(?:SAT|SATURDAY)$/i, "SATURDAY"],
  [/^(?:SUN|SUNDAY)$/i, "SUNDAY"],
];
const TIME_RANGE =
  /\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(?:-|–|—|TO)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/i;
const SINGLE_TIME = /^([01]?\d|2[0-3])[:.]([0-5]\d)$/;
const SUBJECT_CODE =
  /\b(?=[A-Z0-9-]{4,15}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z]{1,8}[- ]?\d{2,5}[A-Z]?\b/i;
const BATCH_PATTERN = /\b(?:BATCH\s*)?([A-Z]{1,2}\d{1,2})\b/gi;
const GENERIC_HEADER =
  /^(?:TIME|DAY|PERIOD|SLOT|HOUR|TIMING|NO\.?|SR\.?\s*NO\.?)$/i;

interface DayMarker {
  day: DayOfWeek;
  bbox: BoundingBox;
}

interface TimeMarker {
  startTime: string;
  endTime: string;
  bbox: BoundingBox;
}

function centerX(box: BoundingBox): number {
  return (box.x0 + box.x1) / 2;
}

function centerY(box: BoundingBox): number {
  return (box.y0 + box.y1) / 2;
}

function normalizeTime(hour: string, minute: string): string {
  return `${hour.padStart(2, "0")}:${minute}`;
}

function dayForText(text: string): DayOfWeek | undefined {
  const normalized = text.replace(/[^A-Za-z]/g, "");
  return DAY_PATTERNS.find(([pattern]) => pattern.test(normalized))?.[1];
}

function detectDayMarkers(words: readonly OcrWord[]): DayMarker[] {
  const markers: DayMarker[] = [];
  for (const word of words) {
    const day = dayForText(word.text);
    if (day && !markers.some((marker) => marker.day === day)) {
      markers.push({ day, bbox: word.bbox });
    }
  }
  return markers;
}

function detectTimeMarkers(words: readonly OcrWord[]): TimeMarker[] {
  const lines = groupWordsIntoLines(words);
  const markers: TimeMarker[] = [];
  for (const word of words) {
    const match = word.text.match(TIME_RANGE);
    if (!match) continue;
    const startTime = normalizeTime(match[1], match[2]);
    const endTime = normalizeTime(match[3], match[4]);
    if (endTime > startTime) {
      markers.push({ startTime, endTime, bbox: word.bbox });
    }
  }
  for (const line of lines) {
    if (line.words.some((word) => TIME_RANGE.test(word.text))) continue;
    const match = line.text.match(TIME_RANGE);
    if (!match) continue;
    const startTime = normalizeTime(match[1], match[2]);
    const endTime = normalizeTime(match[3], match[4]);
    if (endTime <= startTime) continue;
    markers.push({ startTime, endTime, bbox: line.bbox });
  }
  if (markers.length === 0) {
    const singleTimes = words.flatMap((word) => {
      const match = word.text.match(SINGLE_TIME);
      return match
        ? [{ time: normalizeTime(match[1], match[2]), bbox: word.bbox }]
        : [];
    });
    const horizontal =
      span(singleTimes.map((marker) => centerX(marker.bbox))) >=
      span(singleTimes.map((marker) => centerY(marker.bbox)));
    singleTimes.sort((left, right) =>
      horizontal
        ? centerX(left.bbox) - centerX(right.bbox)
        : centerY(left.bbox) - centerY(right.bbox),
    );
    for (let index = 0; index < singleTimes.length - 1; index += 1) {
      const current = singleTimes[index];
      const next = singleTimes[index + 1];
      if (next.time > current.time) {
        markers.push({
          startTime: current.time,
          endTime: next.time,
          bbox: current.bbox,
        });
      }
    }
  }
  return markers;
}

function span(values: readonly number[]): number {
  return values.length ? Math.max(...values) - Math.min(...values) : 0;
}

function nearestIndex(value: number, candidates: readonly number[]): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  candidates.forEach((candidate, index) => {
    const distance = Math.abs(value - candidate);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}

function isMarkerWord(word: OcrWord): boolean {
  return Boolean(
    dayForText(word.text) ||
    TIME_RANGE.test(word.text) ||
    GENERIC_HEADER.test(word.text),
  );
}

function classTypeFor(text: string): ClassType {
  if (/\bLAB(?:ORATORY)?\b/i.test(text)) return "LAB";
  if (/\bTUT(?:ORIAL)?\b/i.test(text)) return "TUTORIAL";
  if (/\bSEMINAR\b/i.test(text)) return "SEMINAR";
  if (/\bPROJECT\b/i.test(text)) return "PROJECT";
  return "THEORY";
}

function parseRoom(text: string, code?: string): string | undefined {
  const candidate =
    text.match(/\b(?:ROOM|RM)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{1,14})\b/i)?.[1] ??
    text.match(/\b([A-Z]{1,3}-?\d{2,4})\b(?!.*[A-Z0-9])/i)?.[1];
  return candidate && candidate.replace(/\s/g, "").toUpperCase() !== code
    ? candidate
    : undefined;
}

function parseFaculty(text: string): string[] {
  const explicit = text.match(
    /\b(?:PROF(?:ESSOR)?|DR|FAC(?:ULTY)?)\.?\s*[:#-]?\s*([A-Z][A-Za-z .]{1,50})/i,
  )?.[1];
  return explicit ? [explicit.trim()] : [];
}

function parseBatches(text: string): string[] {
  return [...text.matchAll(BATCH_PATTERN)]
    .map((match) => match[1].toUpperCase())
    .filter((value, index, values) => values.indexOf(value) === index);
}

function cleanSubjectName(text: string, code?: string): string {
  let value = text;
  if (code) value = value.replace(code, " ");
  return value
    .replace(/\b(?:ROOM|RM)\s*[:#-]?\s*[A-Z0-9-]+\b/gi, " ")
    .replace(
      /\b(?:PROF(?:ESSOR)?|DR|FAC(?:ULTY)?)\.?\s*[:#-]?\s*[A-Z][A-Za-z .]{1,50}/gi,
      " ",
    )
    .replace(/\b(?:BATCH\s*)?[A-Z]{1,2}\d{1,2}\b/gi, " ")
    .replace(
      /\b(?:LECTURE|THEORY|LAB(?:ORATORY)?|TUT(?:ORIAL)?|SEMINAR)\b/gi,
      " ",
    )
    .replace(/[|;,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function shortName(name: string, code?: string): string {
  if (code) return code.replace(/\s/g, "").slice(0, 12).toUpperCase();
  return (
    name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .toUpperCase()
      .slice(0, 12) || "CLASS"
  );
}

function parsePageDraft(
  page: OcrPageResult,
  timezone: string,
): NormalizedTimetableDraft | undefined {
  const words = normalizeOcrWords(page.words);
  const dayMarkers = detectDayMarkers(words);
  const timeMarkers = detectTimeMarkers(words);
  if (dayMarkers.length < 2 || timeMarkers.length < 1) return undefined;

  const daysAreRows =
    span(dayMarkers.map((marker) => centerY(marker.bbox))) >=
    span(dayMarkers.map((marker) => centerX(marker.bbox)));
  const sortedDays = [...dayMarkers].sort((left, right) =>
    daysAreRows
      ? centerY(left.bbox) - centerY(right.bbox)
      : centerX(left.bbox) - centerX(right.bbox),
  );
  const sortedTimes = [...timeMarkers].sort((left, right) =>
    daysAreRows
      ? centerX(left.bbox) - centerX(right.bbox)
      : centerY(left.bbox) - centerY(right.bbox),
  );
  const dayAxes = sortedDays.map((marker) =>
    daysAreRows ? centerY(marker.bbox) : centerX(marker.bbox),
  );
  const timeAxes = sortedTimes.map((marker) =>
    daysAreRows ? centerX(marker.bbox) : centerY(marker.bbox),
  );
  const buckets = new Map<string, OcrWord[]>();
  for (const word of words) {
    if (isMarkerWord(word)) continue;
    const dayAxis = daysAreRows ? centerY(word.bbox) : centerX(word.bbox);
    const timeAxis = daysAreRows ? centerX(word.bbox) : centerY(word.bbox);
    const dayIndex = nearestIndex(dayAxis, dayAxes);
    const timeIndex = nearestIndex(timeAxis, timeAxes);
    const marker = sortedDays[dayIndex];
    if (
      daysAreRows
        ? centerX(word.bbox) <= centerX(marker.bbox)
        : centerY(word.bbox) <= centerY(marker.bbox)
    ) {
      continue;
    }
    const key = `${dayIndex}:${timeIndex}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(word);
    buckets.set(key, bucket);
  }

  for (let dayIndex = 0; dayIndex < sortedDays.length; dayIndex += 1) {
    for (
      let timeIndex = 0;
      timeIndex < sortedTimes.length - 1;
      timeIndex += 1
    ) {
      const leftKey = `${dayIndex}:${timeIndex}`;
      const rightKey = `${dayIndex}:${timeIndex + 1}`;
      const left = buckets.get(leftKey);
      const right = buckets.get(rightKey);
      if (!left?.length || !right?.length) continue;
      const leftText = left.map((word) => word.text).join(" ");
      const rightText = right.map((word) => word.text).join(" ");
      if (
        /^(?:LAB|LABORATORY|TUT|TUTORIAL)$/i.test(leftText) ||
        /^(?:LAB|LABORATORY|TUT|TUTORIAL)$/i.test(rightText)
      ) {
        const merged = [...left, ...right];
        buckets.set(leftKey, merged);
        buckets.set(rightKey, merged);
      }
    }
  }

  const subjects = new Map<
    string,
    NormalizedTimetableDraft["subjects"][number]
  >();
  const slots: NormalizedTimetableDraft["timetableSlots"] = [];
  const ambiguousItems: NormalizedTimetableDraft["ambiguousItems"] = [];
  const warnings: string[] = [];
  const detectedBatches = new Set<string>();

  for (const [key, cellWords] of buckets) {
    if (slots.length >= EXTRACTION_LIMITS.maximumCandidateCells) {
      warnings.push(
        "Only the first 350 candidate cells were retained for review.",
      );
      break;
    }
    const [dayIndex, timeIndex] = key.split(":").map(Number);
    const text = [...cellWords]
      .sort(
        (left, right) =>
          left.bbox.y0 - right.bbox.y0 || left.bbox.x0 - right.bbox.x0,
      )
      .map((word) => word.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text || GENERIC_HEADER.test(text)) continue;
    const isBreak = /\b(?:BREAK|LUNCH|RECESS)\b/i.test(text);
    const isEmpty = /^(?:EMPTY|FREE|[-–—])$/i.test(text);
    if (isEmpty) continue;
    const codeMatch = text.match(SUBJECT_CODE)?.[0];
    const code = codeMatch?.replace(/\s/g, "").toUpperCase();
    const classType = isBreak ? "OTHER" : classTypeFor(text);
    const batches = parseBatches(text);
    batches.forEach((batch) => detectedBatches.add(batch));
    const faculty = parseFaculty(text);
    const room = parseRoom(text, code);
    const name = isBreak
      ? /\bLUNCH\b/i.test(text)
        ? "Lunch"
        : "Break"
      : cleanSubjectName(text, code) || code || text.slice(0, 80);
    const confidence = Math.max(
      0.2,
      Math.min(
        0.98,
        cellWords.reduce((total, word) => total + word.confidence, 0) /
          cellWords.length /
          100 -
          (code || isBreak ? 0 : 0.08),
      ),
    );
    let subjectTemporaryId: string | undefined;
    if (!isBreak) {
      const subjectKey = `${code ?? name.toLowerCase()}|${classType}`;
      let subject = subjects.get(subjectKey);
      if (!subject) {
        subject = {
          temporaryId: `p${page.pageIndex + 1}_subject_${subjects.size + 1}`,
          ...(code ? { code } : {}),
          name,
          shortName: shortName(name, code),
          credits: 0,
          classType,
          faculty,
          isZeroCredit: false,
          confidence,
        };
        subjects.set(subjectKey, subject);
      }
      subjectTemporaryId = subject.temporaryId;
    }
    const slotId = `p${page.pageIndex + 1}_slot_${slots.length + 1}`;
    slots.push({
      temporaryId: slotId,
      ...(subjectTemporaryId ? { subjectTemporaryId } : {}),
      dayOfWeek: sortedDays[dayIndex].day,
      startTime: sortedTimes[timeIndex].startTime,
      endTime: sortedTimes[timeIndex].endTime,
      faculty,
      ...(room ? { room } : {}),
      classType,
      batchOptions: batches,
      weekPattern: "EVERY_WEEK",
      notes: `Local OCR source: ${text.slice(0, 300)}`,
      confidence,
      isEnabled: true,
      isPlaceholder: false,
      isBreak,
    });
    if (confidence < 0.68) {
      ambiguousItems.push({
        id: `${slotId}_review`,
        field: "timetableCell",
        possibleValues: [text.slice(0, 200)],
        sourceDescription: `Page ${page.pageIndex + 1}, ${sortedDays[dayIndex].day.toLowerCase()} ${sortedTimes[timeIndex].startTime}`,
        confidence,
      });
    }
  }

  if (slots.length === 0) return undefined;
  if (ambiguousItems.length) {
    warnings.push(
      `${ambiguousItems.length} low-confidence ${ambiguousItems.length === 1 ? "cell needs" : "cells need"} review.`,
    );
  }
  const overallConfidence =
    slots.reduce((total, slot) => total + slot.confidence, 0) / slots.length;
  return timetableExtractionResultSchema.parse({
    title: `Imported timetable — page ${page.pageIndex + 1}`,
    timezone,
    days: DAYS_OF_WEEK.filter((day) =>
      sortedDays.some((marker) => marker.day === day),
    ),
    timeSlots: sortedTimes.map(({ startTime, endTime }) => ({
      startTime,
      endTime,
    })),
    subjects: [...subjects.values()],
    timetableSlots: slots,
    detectedBatchOptions: [...detectedBatches].sort(),
    detectedElectiveGroups: [],
    ambiguousItems,
    warnings,
    overallConfidence,
  });
}

export function reconstructTimetablePages(
  pages: readonly OcrPageResult[],
  timezone: string,
): ExtractedPage[] {
  return pages.flatMap((page) => {
    const structured = parseStructuredPage(page, timezone);
    const draft = structured?.draft ?? parsePageDraft(page, timezone);
    return draft
      ? [
          {
            pageIndex: page.pageIndex,
            label: `Page ${page.pageIndex + 1}`,
            draft,
            rawTextPreview: page.text.replace(/\s+/g, " ").trim().slice(0, 300),
            detectedCellCount: draft.timetableSlots.length,
            diagnostics: page.diagnostics,
            confidence: structured?.confidence ?? page.confidenceBreakdown,
            previewDataUrl: page.previewDataUrl,
          },
        ]
      : [];
  });
}

export function mergeExtractedPages(
  pages: readonly ExtractedPage[],
  timezone: string,
): NormalizedTimetableDraft {
  if (pages.length === 0) {
    throw new TimetableExtractionError(
      "NO_TIMETABLE",
      "No timetable page was selected for review.",
    );
  }
  const selected = [...pages].sort(
    (left, right) => left.pageIndex - right.pageIndex,
  );
  const draft = timetableExtractionResultSchema.parse({
    title: "Imported timetable",
    timezone,
    days: DAYS_OF_WEEK.filter((day) =>
      selected.some((page) => page.draft.days.includes(day)),
    ),
    timeSlots: selected
      .flatMap((page) => page.draft.timeSlots)
      .filter(
        (slot, index, slots) =>
          slots.findIndex(
            (candidate) =>
              candidate.startTime === slot.startTime &&
              candidate.endTime === slot.endTime,
          ) === index,
      ),
    subjects: selected.flatMap((page) => page.draft.subjects),
    timetableSlots: selected.flatMap((page) => page.draft.timetableSlots),
    detectedBatchOptions: [
      ...new Set(selected.flatMap((page) => page.draft.detectedBatchOptions)),
    ],
    detectedElectiveGroups: selected.flatMap(
      (page) => page.draft.detectedElectiveGroups,
    ),
    ambiguousItems: selected.flatMap((page) => page.draft.ambiguousItems),
    warnings: selected.flatMap((page) => page.draft.warnings),
    overallConfidence:
      selected.reduce(
        (total, page) => total + page.draft.overallConfidence,
        0,
      ) / selected.length,
  });
  return draft;
}

export function assertUsefulExtraction(pages: readonly ExtractedPage[]): void {
  if (pages.length === 0) {
    throw new TimetableExtractionError(
      "NO_TIMETABLE",
      "OCR finished, but no timetable-like rows and columns were detected. Try a clearer image or enter it manually.",
    );
  }
}
