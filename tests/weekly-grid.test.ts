import { describe, expect, it } from "vitest";
import { buildWeeklyTimetableMatrix } from "@/lib/timetable";
import type { DayOfWeek } from "@/types";

type TestSession = {
  id: string;
  dayOfWeek: DayOfWeek;
  startTime: string;
  endTime: string;
  qualifier?: string;
};

const periods = [
  { startTime: "08:45", endTime: "09:45" },
  { startTime: "09:45", endTime: "10:45" },
  { startTime: "10:45", endTime: "11:45" },
  { startTime: "11:45", endTime: "12:45" },
];

function session(
  id: string,
  dayOfWeek: DayOfWeek,
  startTime: string,
  endTime: string,
  qualifier?: string,
): TestSession {
  return { id, dayOfWeek, startTime, endTime, qualifier };
}

describe("weekly timetable matrix", () => {
  it("renders weekdays as Monday-to-Sunday rows and times as chronological columns", () => {
    const matrix = buildWeeklyTimetableMatrix(
      [
        session("sat", "SATURDAY", "10:45", "11:45"),
        session("wed", "WEDNESDAY", "08:45", "09:45"),
        session("mon", "MONDAY", "09:45", "10:45"),
      ],
      { days: ["SATURDAY", "WEDNESDAY", "MONDAY"], timeSlots: periods },
    );

    expect(matrix.days.map((day) => day.dayOfWeek)).toEqual([
      "MONDAY",
      "WEDNESDAY",
      "SATURDAY",
    ]);
    expect(matrix.columns).toEqual(periods);
  });

  it("places single-, two-, and three-period sessions without duplicating them", () => {
    const matrix = buildWeeklyTimetableMatrix(
      [
        session("single", "MONDAY", "08:45", "09:45"),
        session("lab", "TUESDAY", "08:45", "10:45"),
        session("project", "WEDNESDAY", "09:45", "12:45"),
      ],
      { timeSlots: periods },
    );

    const placements = matrix.days.flatMap((day) => day.placements);
    expect(placements).toHaveLength(3);
    expect(
      placements.find(({ session }) => session.id === "single"),
    ).toMatchObject({ startColumn: 0, columnSpan: 1 });
    expect(
      placements.find(({ session }) => session.id === "lab"),
    ).toMatchObject({ startColumn: 0, columnSpan: 2 });
    expect(
      placements.find(({ session }) => session.id === "project"),
    ).toMatchObject({ startColumn: 1, columnSpan: 3 });
  });

  it("infers hourly boundaries for a standalone multi-hour class", () => {
    const matrix = buildWeeklyTimetableMatrix([
      session("lab", "THURSDAY", "14:00", "16:00"),
    ]);

    expect(matrix.columns).toEqual([
      { startTime: "14:00", endTime: "15:00" },
      { startTime: "15:00", endTime: "16:00" },
    ]);
    expect(matrix.days[0].placements[0].columnSpan).toBe(2);
  });

  it("leaves empty periods empty and stacks overlapping qualified alternatives", () => {
    const matrix = buildWeeklyTimetableMatrix(
      [
        session("batch-a", "MONDAY", "08:45", "10:45", "Batch A"),
        session("batch-b", "MONDAY", "08:45", "10:45", "Batch B"),
      ],
      { days: ["MONDAY", "TUESDAY"], timeSlots: periods },
    );
    const monday = matrix.days[0];
    const tuesday = matrix.days[1];

    expect(monday.laneCount).toBe(2);
    expect(monday.placements.map((placement) => placement.lane)).toEqual([
      0, 1,
    ]);
    expect(monday.placements.every((placement) => placement.overlaps)).toBe(
      true,
    );
    expect(tuesday.placements).toEqual([]);
    expect(tuesday.laneCount).toBe(1);
  });

  it("repositions an edited session from its updated domain values", () => {
    const original = session("editable", "MONDAY", "08:45", "09:45");
    const edited = {
      ...original,
      dayOfWeek: "SATURDAY" as const,
      startTime: "10:45",
      endTime: "11:45",
    };
    const matrix = buildWeeklyTimetableMatrix([edited], {
      days: ["MONDAY", "SATURDAY"],
      timeSlots: periods,
    });

    expect(matrix.days[0].placements).toEqual([]);
    expect(matrix.days[1].placements[0]).toMatchObject({
      session: edited,
      startColumn: 2,
      columnSpan: 1,
    });
  });

  it("preserves AI and local OCR session metadata while mapping", () => {
    const extracted = [
      {
        ...session("ai", "THURSDAY", "08:45", "09:45"),
        source: "AI" as const,
        confidence: 0.72,
      },
      {
        ...session("ocr", "FRIDAY", "09:45", "10:45"),
        source: "LOCAL_OCR" as const,
        confidence: 0.88,
      },
    ];
    const matrix = buildWeeklyTimetableMatrix(extracted, {
      timeSlots: periods,
    });

    expect(
      matrix.days.flatMap((day) =>
        day.placements.map((placement) => placement.session),
      ),
    ).toEqual(extracted);
  });

  it("warns instead of misplacing invalid times", () => {
    const matrix = buildWeeklyTimetableMatrix([
      session("invalid", "MONDAY", "11:45", "10:45"),
    ]);

    expect(matrix.days).toEqual([]);
    expect(matrix.warnings).toHaveLength(1);
  });
});
