import { describe, expect, it } from "vitest";

import {
  LOCAL_EXTRACTION_CONFIDENCE_THRESHOLD,
  evaluateLocalExtraction,
  type TimetableExtractionResult,
} from "@/lib/timetable-extraction";

function result(
  confidence: number,
  withSlot = true,
): TimetableExtractionResult {
  return {
    totalPageCount: 1,
    warnings: [],
    pages: [
      {
        pageIndex: 0,
        label: "Page 1",
        rawTextPreview: "Monday 09:00 Signals",
        detectedCellCount: 3,
        confidence: {
          inputQuality: 1,
          tableDetection: 1,
          perspectiveCorrection: 1,
          gridDetection: 1,
          headerParsing: 1,
          cellOCR: 1,
          legendMapping: 1,
          semanticParsing: 1,
          overall: confidence,
          warnings: [],
        },
        draft: {
          title: "Imported",
          timezone: "Asia/Kolkata",
          days: ["MONDAY"],
          timeSlots: [{ startTime: "09:00", endTime: "10:00" }],
          subjects: [],
          timetableSlots: withSlot
            ? [
                {
                  temporaryId: "slot",
                  subjectTemporaryId: "subject",
                  dayOfWeek: "MONDAY",
                  startTime: "09:00",
                  endTime: "10:00",
                  faculty: [],
                  classType: "THEORY",
                  batchOptions: [],
                  weekPattern: "EVERY_WEEK",
                  confidence,
                  isEnabled: true,
                  isPlaceholder: false,
                  isBreak: false,
                },
              ]
            : [],
          detectedBatchOptions: [],
          detectedElectiveGroups: [],
          ambiguousItems: [],
          warnings: [],
          overallConfidence: confidence,
        },
      },
    ],
  };
}

describe("local extraction reliability", () => {
  it("accepts the exact confidence boundary when structure is usable", () => {
    expect(
      evaluateLocalExtraction(result(LOCAL_EXTRACTION_CONFIDENCE_THRESHOLD))
        .status,
    ).toBe("success");
  });

  it("offers fallback below the boundary and includes bounded hints", () => {
    const outcome = evaluateLocalExtraction(
      result(LOCAL_EXTRACTION_CONFIDENCE_THRESHOLD - 0.001),
    );
    expect(outcome.status).toBe("low-confidence");
    if (outcome.status === "low-confidence") {
      expect(outcome.hints.rawText).toContain("Monday");
    }
  });

  it("rejects a confident result with no sessions", () => {
    expect(evaluateLocalExtraction(result(0.99, false)).status).toBe(
      "low-confidence",
    );
  });
});
