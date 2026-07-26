import { describe, expect, it } from "vitest";

import { applySessionDetailsOverride } from "@/components/attendance/session-persistence";
import type { ClassSession } from "@/types/domain";

const session: ClassSession = {
  id: "session-1",
  semesterId: "semester-1",
  subjectId: "subject-1",
  timetableSlotId: "slot-1",
  date: "2026-07-23",
  startTime: "09:00",
  endTime: "10:00",
  status: "SCHEDULED",
  source: "TIMETABLE",
  faculty: ["Prof. Rao"],
  room: "AB-304",
  createdAt: "2026-07-01T08:00:00.000Z",
  updatedAt: "2026-07-01T08:00:00.000Z",
};

describe("one-off session details", () => {
  it("changes only the dated session's faculty, room, and optional note", () => {
    expect(
      applySessionDetailsOverride(
        session,
        {
          faculty: "Prof. Sen, Dr. Bose",
          room: " C-201 ",
          notes: "Guest lecture",
        },
        "2026-07-23T09:00:00.000Z",
      ),
    ).toEqual({
      ...session,
      faculty: ["Prof. Sen", "Dr. Bose"],
      room: "C-201",
      notes: "Guest lecture",
      updatedAt: "2026-07-23T09:00:00.000Z",
    });
  });

  it("keeps current faculty when only the room changes", () => {
    expect(
      applySessionDetailsOverride(session, {
        faculty: "",
        room: "Auditorium",
        notes: "",
      }),
    ).toMatchObject({ faculty: ["Prof. Rao"], room: "Auditorium" });
  });

  it("rejects a no-op override", () => {
    expect(() =>
      applySessionDetailsOverride(session, {
        faculty: "",
        room: "",
        notes: "Note alone is not a room or faculty change",
      }),
    ).toThrow("Enter a new room or faculty.");
  });
});
