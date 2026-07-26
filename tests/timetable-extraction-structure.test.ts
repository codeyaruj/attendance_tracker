import { describe, expect, it } from "vitest";
import {
  analyzeTableImage,
  clusterLineCoordinates,
  mergeLineBands,
  reconstructTimetablePages,
  type OcrPageResult,
} from "@/lib/timetable-extraction";

function syntheticGrid() {
  const width = 320;
  const height = 240;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const dark = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    data[index] = 0;
    data[index + 1] = 0;
    data[index + 2] = 0;
  };
  for (const y of [20, 60, 100, 140, 180]) {
    for (let x = 20; x <= 300; x += 1) dark(x, y);
  }
  for (const x of [20, 90, 160, 230, 300]) {
    for (let y = 20; y <= 180; y += 1) {
      if (x === 160 && y > 100 && y < 140) continue;
      dark(x, y);
    }
  }
  return { data, width, height };
}

describe("table structure extraction", () => {
  it("clusters duplicate coordinates and keeps disconnected line segments separate", () => {
    expect(clusterLineCoordinates([10, 11, 12, 50], 3)).toEqual([11, 50]);
    expect(
      mergeLineBands(
        [
          {
            orientation: "vertical",
            coordinate: 10,
            start: 0,
            end: 30,
            thickness: 1,
            confidence: 1,
          },
          {
            orientation: "vertical",
            coordinate: 11,
            start: 0,
            end: 30,
            thickness: 1,
            confidence: 1,
          },
          {
            orientation: "vertical",
            coordinate: 10,
            start: 100,
            end: 130,
            thickness: 1,
            confidence: 1,
          },
        ],
        2,
      ),
    ).toHaveLength(2);
  });

  it("detects a primary grid and preserves a missing separator as a colspan", () => {
    const result = analyzeTableImage(syntheticGrid());

    expect(result.primaryGrid).toBeDefined();
    expect(result.diagnostics.horizontalLines.length).toBeGreaterThanOrEqual(5);
    expect(result.diagnostics.verticalLines.length).toBeGreaterThanOrEqual(5);
    expect(
      result.primaryGrid?.cells.some(
        (cell) => cell.rowStart === 2 && cell.columnSpan === 2,
      ),
    ).toBe(true);
  });

  it("reconstructs days, time ranges, and multiple cell alternatives", () => {
    const page: OcrPageResult = {
      pageIndex: 0,
      text: "Monday 09:00-10:00 BEC551 / BEC552",
      confidence: 91,
      width: 300,
      height: 160,
      words: [],
      diagnostics: {
        source: "IMAGE_GRID",
        width: 300,
        height: 160,
        transforms: [],
        horizontalLines: [],
        verticalLines: [],
        regions: [
          {
            id: "main",
            kind: "PRIMARY_TIMETABLE",
            bounds: { x0: 0, y0: 0, x1: 300, y1: 160 },
            horizontalLineCount: 3,
            verticalLineCount: 3,
            intersectionDensity: 0.9,
            confidence: 0.92,
          },
        ],
        grids: [
          {
            regionId: "main",
            rowBoundaries: [0, 80, 160],
            columnBoundaries: [0, 100, 200, 300],
            confidence: 0.9,
            cells: [
              {
                id: "header",
                rowStart: 0,
                rowSpan: 1,
                columnStart: 1,
                columnSpan: 1,
                bounds: { x0: 100, y0: 0, x1: 200, y1: 80 },
                rawText: "09:00 - 10:00",
                ocrConfidence: 95,
                structuralConfidence: 0.9,
              },
              {
                id: "day",
                rowStart: 1,
                rowSpan: 1,
                columnStart: 0,
                columnSpan: 1,
                bounds: { x0: 0, y0: 80, x1: 100, y1: 160 },
                rawText: "M0NDAY",
                ocrConfidence: 90,
                structuralConfidence: 0.9,
              },
              {
                id: "class",
                rowStart: 1,
                rowSpan: 1,
                columnStart: 1,
                columnSpan: 1,
                bounds: { x0: 100, y0: 80, x1: 200, y1: 160 },
                rawText: "BEC551 LAB C1 / BEC552 LAB C2",
                ocrConfidence: 88,
                structuralConfidence: 0.9,
              },
            ],
          },
        ],
        timings: [],
      },
    };

    const [extracted] = reconstructTimetablePages([page], "Asia/Kolkata");
    expect(extracted.draft.days).toEqual(["MONDAY"]);
    expect(extracted.draft.timetableSlots).toHaveLength(2);
    expect(extracted.draft.subjects.map((subject) => subject.code)).toEqual([
      "BEC551",
      "BEC552",
    ]);
  });
});
