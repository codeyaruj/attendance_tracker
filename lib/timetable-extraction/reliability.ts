import type { LocalExtractionHints } from "@/lib/ai-timetable/schema";
import type { NormalizedTimetableDraft } from "@/types";
import type { TimetableExtractionResult } from "./types";

export const LOCAL_EXTRACTION_CONFIDENCE_THRESHOLD = 0.68;

export type LocalExtractionOutcome =
  | {
      status: "success";
      confidence: number;
      warnings: string[];
    }
  | {
      status: "low-confidence";
      confidence: number;
      hints: LocalExtractionHints;
      warnings: string[];
    };

function hintsFromDraft(
  draft: NormalizedTimetableDraft,
  warnings: string[],
  rawText: string,
): LocalExtractionHints {
  return {
    rawText: rawText.slice(0, 12_000),
    detectedDays: draft.days,
    detectedTimes: draft.timeSlots.slice(0, 40),
    warnings: warnings.slice(0, 30),
  };
}

export function evaluateLocalExtraction(
  result: TimetableExtractionResult,
): LocalExtractionOutcome {
  const pages = result.pages;
  const slots = pages.flatMap((page) => page.draft.timetableSlots);
  const invalidSlots = slots.filter(
    (slot) =>
      !/^\d{2}:\d{2}$/.test(slot.startTime) ||
      !/^\d{2}:\d{2}$/.test(slot.endTime) ||
      slot.startTime >= slot.endTime ||
      !slot.subjectTemporaryId,
  );
  const confidence =
    pages.length === 0
      ? 0
      : pages.reduce(
          (sum, page) =>
            sum + (page.confidence?.overall ?? page.draft.overallConfidence),
          0,
        ) / pages.length;
  const warnings = [
    ...result.warnings,
    ...pages.flatMap((page) => page.draft.warnings),
  ];
  const usable =
    slots.length > 0 &&
    invalidSlots.length / slots.length <= 0.25 &&
    pages.some(
      (page) => page.draft.days.length > 0 && page.draft.timeSlots.length > 0,
    );

  if (usable && confidence >= LOCAL_EXTRACTION_CONFIDENCE_THRESHOLD) {
    return { status: "success", confidence, warnings };
  }
  const combined: NormalizedTimetableDraft = pages[0]?.draft ?? {
    title: "Timetable",
    timezone: "Asia/Kolkata",
    days: [],
    timeSlots: [],
    subjects: [],
    timetableSlots: [],
    detectedBatchOptions: [],
    detectedElectiveGroups: [],
    ambiguousItems: [],
    warnings: [],
    overallConfidence: 0,
  };
  return {
    status: "low-confidence",
    confidence,
    hints: hintsFromDraft(
      combined,
      [
        ...warnings,
        ...(usable
          ? []
          : ["Local extraction did not produce a usable timetable structure."]),
      ],
      pages.map((page) => page.rawTextPreview).join("\n"),
    ),
    warnings,
  };
}
