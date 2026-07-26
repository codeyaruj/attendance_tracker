import { describe, expect, it } from "vitest";
import {
  mergeExtractedPages,
  reconstructTimetablePages,
  type OcrPageResult,
  type OcrWord,
} from "@/lib/timetable-extraction";

function word(
  text: string,
  x: number,
  y: number,
  confidence = 94,
  pageIndex = 0,
): OcrWord {
  return {
    text,
    confidence,
    pageIndex,
    bbox: { x0: x, y0: y, x1: x + Math.max(28, text.length * 8), y1: y + 18 },
  };
}

function page(words: OcrWord[], pageIndex = 0): OcrPageResult {
  return {
    pageIndex,
    text: words.map((item) => item.text).join(" "),
    confidence: 90,
    width: 800,
    height: 600,
    words: words.map((item) => ({ ...item, pageIndex })),
  };
}

function weeklyWords(): OcrWord[] {
  return [
    word("09:00-10:00", 130, 20),
    word("10:00-11:00", 300, 20),
    word("Monday", 10, 110),
    word("Tuesday", 10, 210),
    word("Wednesday", 10, 310),
    word("CS101", 130, 110),
    word("Programming", 185, 110),
    word("ROOM", 130, 130),
    word("A-201", 180, 130),
    word("Engineering", 300, 110),
    word("Mathematics", 380, 110),
    word("Physics", 130, 210),
    word("Elective", 300, 210),
    word("Communication", 370, 210),
    word("Lunch", 130, 310),
    word("FREE", 300, 310),
  ];
}

describe("coordinate timetable reconstruction", () => {
  it("reconstructs a clean weekly timetable with code, room, multi-word names, electives, and empty cells", () => {
    const [result] = reconstructTimetablePages(
      [page(weeklyWords())],
      "Asia/Kolkata",
    );
    expect(result.detectedCellCount).toBe(5);
    expect(result.draft.days).toEqual(["MONDAY", "TUESDAY", "WEDNESDAY"]);
    expect(result.draft.subjects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "CS101" }),
        expect.objectContaining({
          name: expect.stringMatching(/Engineering Mathematics/),
        }),
      ]),
    );
    expect(result.draft.timetableSlots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ room: "A-201", dayOfWeek: "MONDAY" }),
        expect.objectContaining({
          notes: expect.stringMatching(/Elective Communication/),
        }),
        expect.objectContaining({ isBreak: true }),
      ]),
    );
  });

  it("remains useful when one weekday is missing", () => {
    const words = weeklyWords().filter(
      (item) => item.text !== "Wednesday" && item.text !== "Lunch",
    );
    const [result] = reconstructTimetablePages([page(words)], "Asia/Kolkata");
    expect(result.draft.days).toEqual(["MONDAY", "TUESDAY"]);
  });

  it("joins a split merged lab label and repeats it across adjacent periods", () => {
    const words = [
      word("09:00-10:00", 130, 20),
      word("10:00-11:00", 300, 20),
      word("Monday", 10, 110),
      word("Tuesday", 10, 210),
      word("Electronics", 130, 110),
      word("Lab", 300, 110),
      word("Chemistry", 130, 210),
    ];
    const [result] = reconstructTimetablePages([page(words)], "Asia/Kolkata");
    const monday = result.draft.timetableSlots.filter(
      (slot) => slot.dayOfWeek === "MONDAY",
    );
    expect(monday).toHaveLength(2);
    expect(monday.every((slot) => slot.classType === "LAB")).toBe(true);
    expect(new Set(monday.map((slot) => slot.subjectTemporaryId)).size).toBe(1);
  });

  it("detects batch-specific labs", () => {
    const words = weeklyWords().concat(
      word("Networks", 300, 310),
      word("LAB", 370, 310),
      word("BATCH", 430, 310),
      word("B2", 490, 310),
    );
    const [result] = reconstructTimetablePages([page(words)], "Asia/Kolkata");
    expect(result.draft.detectedBatchOptions).toContain("B2");
    expect(result.draft.timetableSlots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ batchOptions: ["B2"], classType: "LAB" }),
      ]),
    );
  });

  it("marks low-confidence OCR for review instead of silently trusting it", () => {
    const words = weeklyWords().map((item) => ({ ...item, confidence: 45 }));
    const [result] = reconstructTimetablePages([page(words)], "Asia/Kolkata");
    expect(result.draft.ambiguousItems.length).toBeGreaterThan(0);
    expect(result.draft.warnings.join(" ")).toMatch(/low-confidence/i);
  });

  it("handles transposed day columns and time rows", () => {
    const words = [
      word("Monday", 140, 20),
      word("Tuesday", 320, 20),
      word("09:00-10:00", 10, 120),
      word("10:00-11:00", 10, 240),
      word("Signals", 140, 120),
      word("Control", 320, 120),
      word("Lab", 140, 240),
    ];
    const [result] = reconstructTimetablePages([page(words)], "Asia/Kolkata");
    expect(result.draft.timetableSlots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dayOfWeek: "MONDAY", startTime: "09:00" }),
        expect.objectContaining({ dayOfWeek: "TUESDAY", startTime: "09:00" }),
      ]),
    );
  });

  it("reconstructs a timetable whose OCR coordinates are offset on the page", () => {
    const shifted = weeklyWords().map((item) => ({
      ...item,
      bbox: {
        x0: item.bbox.x0 + 420,
        y0: item.bbox.y0 + 275,
        x1: item.bbox.x1 + 420,
        y1: item.bbox.y1 + 275,
      },
    }));
    const [result] = reconstructTimetablePages([page(shifted)], "Asia/Kolkata");
    expect(result.detectedCellCount).toBe(5);
    expect(result.draft.timetableSlots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dayOfWeek: "MONDAY", startTime: "09:00" }),
      ]),
    );
  });

  it("infers period ranges from consecutive single time labels", () => {
    const words = [
      word("09:00", 130, 20),
      word("10:00", 300, 20),
      word("11:00", 470, 20),
      word("Monday", 10, 110),
      word("Tuesday", 10, 210),
      word("Signals", 130, 110),
      word("Control", 300, 110),
      word("Physics", 130, 210),
    ];
    const [result] = reconstructTimetablePages([page(words)], "Asia/Kolkata");
    expect(result.draft.timeSlots).toEqual([
      { startTime: "09:00", endTime: "10:00" },
      { startTime: "10:00", endTime: "11:00" },
    ]);
  });

  it("deduplicates overlapping OCR words", () => {
    const words = weeklyWords();
    words.push({ ...words.find((item) => item.text === "CS101")! });
    const [result] = reconstructTimetablePages([page(words)], "Asia/Kolkata");
    expect(
      result.draft.timetableSlots.find((slot) => slot.dayOfWeek === "MONDAY")
        ?.notes,
    ).not.toMatch(/CS101 CS101/);
  });

  it("returns separate candidates for multiple possible page tables and merges selected pages", () => {
    const first = page(weeklyWords(), 0);
    const secondWords = weeklyWords().map((item) => ({
      ...item,
      pageIndex: 1,
    }));
    const candidates = reconstructTimetablePages(
      [first, page(secondWords, 1)],
      "Asia/Kolkata",
    );
    expect(candidates).toHaveLength(2);
    const merged = mergeExtractedPages([candidates[1]], "Asia/Kolkata");
    expect(
      merged.timetableSlots.every((slot) => slot.temporaryId.startsWith("p2_")),
    ).toBe(true);
  });

  it("rejects OCR with no timetable-like structure", () => {
    expect(
      reconstructTimetablePages(
        [page([word("Welcome", 20, 20), word("Student", 100, 20)])],
        "Asia/Kolkata",
      ),
    ).toEqual([]);
  });
});
