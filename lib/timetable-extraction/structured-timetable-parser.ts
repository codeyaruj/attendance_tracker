import { timetableExtractionResultSchema } from "@/lib/validation";
import {
  DAYS_OF_WEEK,
  type ClassType,
  type DayOfWeek,
  type NormalizedTimetableDraft,
} from "@/types";
import {
  calculateExtractionConfidence,
  fuzzyWeekday,
  parseCellEntries,
  parseLegendRows,
  parseTimeRange,
} from "./semantic-parsing";
import type {
  DetectedCell,
  ExtractionConfidence,
  LogicalGrid,
  OcrPageResult,
} from "./types";

interface StructuredDraft {
  draft: NormalizedTimetableDraft;
  confidence: ExtractionConfidence;
}

function classType(type: string): ClassType {
  if (type === "lab") return "LAB";
  if (type === "project") return "PROJECT";
  if (type === "break") return "OTHER";
  return "THEORY";
}

function text(cell: DetectedCell): string {
  return cell.rawText?.replace(/\s+/g, " ").trim() ?? "";
}

function primaryGrid(page: OcrPageResult): LogicalGrid | undefined {
  const diagnostics = page.diagnostics;
  const region = diagnostics?.regions.find(
    (candidate) => candidate.kind === "PRIMARY_TIMETABLE",
  );
  return (
    diagnostics?.grids.find((grid) => grid.regionId === region?.id) ??
    diagnostics?.grids[0]
  );
}

export function parseStructuredPage(
  page: OcrPageResult,
  timezone: string,
): StructuredDraft | undefined {
  const grid = primaryGrid(page);
  if (!grid || !grid.cells.some((cell) => text(cell))) return undefined;
  const otherGrids =
    page.diagnostics?.grids.filter((candidate) => candidate !== grid) ?? [];
  const legend = parseLegendRows(
    otherGrids.flatMap((candidate) =>
      candidate.cells
        .filter((cell) => cell.columnStart === 0)
        .map((cell) => text(cell)),
    ),
  );
  const daysByRow = new Map<number, { day: DayOfWeek; confidence: number }>();
  const daysByColumn = new Map<
    number,
    { day: DayOfWeek; confidence: number }
  >();
  const timesByRow = new Map<
    number,
    { startTime: string; endTime: string; confidence: number }
  >();
  const timesByColumn = new Map<
    number,
    { startTime: string; endTime: string; confidence: number }
  >();
  for (const cell of grid.cells) {
    const cellText = text(cell);
    const day = fuzzyWeekday(cellText);
    const time = parseTimeRange(cellText);
    if (day) {
      daysByRow.set(cell.rowStart, day);
      daysByColumn.set(cell.columnStart, day);
    }
    if (time) {
      timesByRow.set(cell.rowStart, time);
      timesByColumn.set(cell.columnStart, time);
    }
  }
  const rowDays = daysByRow.size >= daysByColumn.size;
  const dayMap = rowDays ? daysByRow : daysByColumn;
  const timeMap = rowDays ? timesByColumn : timesByRow;
  if (!dayMap.size || !timeMap.size) return undefined;

  const subjects = new Map<
    string,
    NormalizedTimetableDraft["subjects"][number]
  >();
  const slots: NormalizedTimetableDraft["timetableSlots"] = [];
  const ambiguousItems: NormalizedTimetableDraft["ambiguousItems"] = [];
  const batches = new Set<string>();
  const warnings: string[] = [];
  for (const cell of grid.cells) {
    const dayMarker = dayMap.get(rowDays ? cell.rowStart : cell.columnStart);
    const timeIndex = rowDays ? cell.columnStart : cell.rowStart;
    const start = timeMap.get(timeIndex);
    if (!dayMarker || !start) continue;
    const endIndex = timeIndex + (rowDays ? cell.columnSpan : cell.rowSpan) - 1;
    const end = timeMap.get(endIndex) ?? start;
    const entries = parseCellEntries(cell.rawText ?? "", legend);
    cell.entries = entries;
    for (const entry of entries) {
      const isBreak = entry.type === "break";
      const code = entry.correctedSubjectCode ?? entry.subjectCode;
      const name = isBreak
        ? /lunch/i.test(entry.rawText)
          ? "Lunch"
          : "Break"
        : (entry.subjectName ?? code ?? entry.rawText.slice(0, 80));
      if (!name || /^[-–—]$/.test(name)) continue;
      const confidence = Math.max(
        0.2,
        Math.min(
          0.99,
          entry.confidence * 0.6 +
            ((cell.ocrConfidence ?? page.confidence) / 100) * 0.25 +
            cell.structuralConfidence * 0.15,
        ),
      );
      let subjectTemporaryId: string | undefined;
      const type = classType(entry.type);
      if (!isBreak) {
        const key = `${code ?? name.toLowerCase()}|${type}`;
        let subject = subjects.get(key);
        if (!subject) {
          subject = {
            temporaryId: `p${page.pageIndex + 1}_subject_${subjects.size + 1}`,
            ...(code ? { code } : {}),
            name,
            shortName: code ?? name.slice(0, 20),
            credits: 0,
            classType: type,
            faculty: [
              ...(entry.facultyNames ?? []),
              ...(entry.facultyInitials ?? []),
            ],
            isZeroCredit: false,
            confidence,
          };
          subjects.set(key, subject);
        }
        subjectTemporaryId = subject.temporaryId;
      }
      if (entry.batch) batches.add(entry.batch);
      const slotId = `p${page.pageIndex + 1}_slot_${slots.length + 1}`;
      slots.push({
        temporaryId: slotId,
        ...(subjectTemporaryId ? { subjectTemporaryId } : {}),
        dayOfWeek: dayMarker.day,
        startTime: start.startTime,
        endTime: end.endTime,
        faculty: [
          ...(entry.facultyNames ?? []),
          ...(entry.facultyInitials ?? []),
        ],
        ...(entry.room ? { room: entry.room } : {}),
        classType: type,
        batchOptions: entry.batch ? [entry.batch] : [],
        ...(entries.length > 1 ? { electiveGroupId: cell.id } : {}),
        weekPattern: "EVERY_WEEK",
        notes: `Detected from table cell: ${entry.rawText.slice(0, 300)}`,
        confidence,
        isEnabled: true,
        isPlaceholder: false,
        isBreak,
      });
      if (confidence < 0.72) {
        ambiguousItems.push({
          id: `${slotId}_review`,
          field: "timetableCell",
          possibleValues: [entry.rawText.slice(0, 200)],
          sourceDescription: `Page ${page.pageIndex + 1}, cell ${cell.id}`,
          confidence,
        });
      }
    }
  }
  if (!subjects.size || !slots.length) return undefined;
  if (ambiguousItems.length) {
    warnings.push(
      `${ambiguousItems.length} low-confidence table ${ambiguousItems.length === 1 ? "cell needs" : "cells need"} review.`,
    );
  }
  const headerScore =
    [...dayMap.values(), ...timeMap.values()].reduce(
      (sum, item) => sum + item.confidence,
      0,
    ) / Math.max(1, dayMap.size + timeMap.size);
  const cellScore =
    grid.cells.reduce(
      (sum, cell) => sum + (cell.ocrConfidence ?? page.confidence),
      0,
    ) /
    Math.max(1, grid.cells.length) /
    100;
  const confidence = calculateExtractionConfidence({
    inputQuality: Math.min(1, Math.min(page.width, page.height) / 900),
    tableDetection:
      page.diagnostics?.regions.find(
        (region) => region.kind === "PRIMARY_TIMETABLE",
      )?.confidence ?? grid.confidence,
    perspectiveCorrection:
      page.diagnostics?.transforms.find(
        (transform) => transform.type === "PERSPECTIVE",
      )?.confidence ?? 0.8,
    gridDetection: grid.confidence,
    headerParsing: headerScore,
    cellOCR: cellScore,
    legendMapping: legend.size ? 0.9 : 0.45,
    semanticParsing:
      slots.reduce((sum, slot) => sum + slot.confidence, 0) / slots.length,
  });
  const draft = timetableExtractionResultSchema.parse({
    title: `Imported timetable — page ${page.pageIndex + 1}`,
    timezone,
    days: DAYS_OF_WEEK.filter((day) =>
      [...dayMap.values()].some((marker) => marker.day === day),
    ),
    timeSlots: [
      ...new Map(
        [...timeMap.values()].map((time) => [
          `${time.startTime}-${time.endTime}`,
          { startTime: time.startTime, endTime: time.endTime },
        ]),
      ).values(),
    ],
    subjects: [...subjects.values()],
    timetableSlots: slots,
    detectedBatchOptions: [...batches].sort(),
    detectedElectiveGroups: [],
    ambiguousItems,
    warnings,
    overallConfidence: confidence.overall,
  });
  return { draft, confidence };
}
