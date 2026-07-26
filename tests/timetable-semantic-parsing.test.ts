import { describe, expect, it } from "vitest";
import {
  correctCodeFromLegend,
  calculateExtractionConfidence,
  fuzzyWeekday,
  normalizeSubjectCode,
  parseCellEntries,
  parseLegendRows,
  parseTimeRange,
} from "@/lib/timetable-extraction";

describe("timetable semantic parsing", () => {
  it("tolerates bounded OCR errors in weekdays and times", () => {
    expect(fuzzyWeekday("M0NDAY")?.day).toBe("MONDAY");
    expect(parseTimeRange("09.00 — 10.00")).toMatchObject({
      startTime: "09:00",
      endTime: "10:00",
    });
  });

  it("normalizes subject-code confusions only inside code-shaped tokens", () => {
    expect(normalizeSubjectCode("BEC5S1")).toBe("BEC551");
    expect(normalizeSubjectCode("Digital Signal Processing")).toBeUndefined();
  });

  it("uses an unambiguous legend match and retains its reason", () => {
    const legend = parseLegendRows(["BEC551  Digital Signal Processing  AK"]);
    expect(correctCodeFromLegend("BEC5S1", legend)).toMatchObject({
      code: "BEC551",
    });
  });

  it("splits lab alternatives and recognizes non-destructive break cells", () => {
    expect(parseCellEntries("BEC551 LAB C1 / BEC552 LAB C2")).toHaveLength(2);
    expect(parseCellEntries("LUNCH BREAK")[0].type).toBe("break");
    expect(parseCellEntries("   ")).toEqual([]);
  });

  it("keeps confidence granular and weighted", () => {
    const confidence = calculateExtractionConfidence({
      inputQuality: 1,
      tableDetection: 0.9,
      perspectiveCorrection: 0.5,
      gridDetection: 0.8,
      headerParsing: 0.7,
      cellOCR: 0.6,
      legendMapping: 0.4,
      semanticParsing: 0.75,
    });
    expect(confidence.overall).toBeGreaterThan(0.6);
    expect(confidence.gridDetection).toBe(0.8);
  });
});
