import { describe, expect, it } from "vitest";

import {
  parsePastedTimetableText,
  PastedTimetableParseError,
  tryParsePastedTimetableText,
} from "@/lib/timetable";

describe("basic pasted timetable parser", () => {
  it("normalizes common day, time, subject, faculty, room and batch text", () => {
    const result = parsePastedTimetableText(`
      Monday | 09:00-10:00 | BEC501 Digital Signal Processing | Faculty: AK | Room: AB-301 | Theory
      Tuesday, 14:00-16:00, BEC551 Digital Signal Processing Lab, Faculty: AK/MR, Room: DSP-1, Batch: A, Lab
      Wednesday 11:00-12:00 HSMC501 Professional Ethics 0-credit Seminar
    `);

    expect(result.days).toEqual(["MONDAY", "TUESDAY", "WEDNESDAY"]);
    expect(result.timetableSlots).toHaveLength(3);
    expect(result.subjects.some((subject) => subject.code === "BEC501")).toBe(
      true,
    );
    expect(result.subjects.some((subject) => subject.classType === "LAB")).toBe(
      true,
    );
    expect(result.subjects.some((subject) => subject.isZeroCredit)).toBe(true);
    expect(result.detectedBatchOptions).toContain("A");
    expect(result.warnings[0]).toContain("must be confirmed");
  });

  it("keeps odd/even recurrence information", () => {
    const result = parsePastedTimetableText(
      "Thursday 10:00-11:00 BEC501 Digital Signal Processing odd weeks",
    );
    expect(result.timetableSlots[0].weekPattern).toBe("ODD_WEEK");
  });

  it("surfaces partially parsed input in warnings", () => {
    const result = parsePastedTimetableText(`
      Monday 09:00-10:00 BEC501 Digital Signal Processing
      this line cannot be parsed
    `);
    expect(result.warnings).toContain("1 line(s) could not be parsed.");
  });

  it("fails clearly when no recognizable class exists", () => {
    expect(() => parsePastedTimetableText("not a timetable")).toThrow(
      PastedTimetableParseError,
    );
    const result = tryParsePastedTimetableText("not a timetable");
    expect(result.success).toBe(false);
  });
});
