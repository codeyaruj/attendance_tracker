import { describe, expect, it } from "vitest";

import {
  parseAcademicExceptionEntries,
  parseSemesterExceptionEntries,
} from "@/lib/academic-exception-input";

const semester = {
  semesterStartDate: "2026-07-01",
  semesterEndDate: "2026-12-15",
};

describe("academic exception setup parser", () => {
  it("parses dated holidays and reading or exam ranges with clear notes", () => {
    const result = parseSemesterExceptionEntries({
      holidayEntries: "2026-08-15 — Independence Day\n2026-10-02",
      breakEntries:
        "2026-09-21 to 2026-09-27 — Reading week\n2026-12-01 - 2026-12-10 — Exams",
      ...semester,
    });

    expect(result.errors).toEqual([]);
    expect(result.entries).toEqual([
      {
        type: "HOLIDAY",
        startDate: "2026-08-15",
        endDate: "2026-08-15",
        notes: "Holiday: Independence Day",
      },
      {
        type: "HOLIDAY",
        startDate: "2026-10-02",
        endDate: "2026-10-02",
        notes: "Holiday added during semester setup",
      },
      {
        type: "BREAK",
        startDate: "2026-09-21",
        endDate: "2026-09-27",
        notes: "Reading / exam period: Reading week",
      },
      {
        type: "BREAK",
        startDate: "2026-12-01",
        endDate: "2026-12-10",
        notes: "Reading / exam period: Exams",
      },
    ]);
  });

  it("rejects malformed, impossible, reversed, duplicate, and out-of-semester entries", () => {
    const result = parseAcademicExceptionEntries(
      [
        "15 August 2026",
        "2026-02-30",
        "2026-09-10 to 2026-09-01",
        "2026-08-15",
        "2026-08-15",
        "2027-01-01",
      ].join("\n"),
      { type: "HOLIDAY", ...semester },
    );

    expect(result.entries).toHaveLength(1);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Line 1: use YYYY-MM-DD"),
        expect.stringContaining("Line 2: enter a valid calendar date"),
        expect.stringContaining("Line 3: the range must end"),
        expect.stringContaining("Line 5: this date or range is already listed"),
        expect.stringContaining("Line 6: dates must fall within"),
      ]),
    );
  });
});
