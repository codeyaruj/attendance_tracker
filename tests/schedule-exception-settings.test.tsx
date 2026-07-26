import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduleSettings } from "@/components/settings/schedule-settings";
import type { AttendSafeSnapshot } from "@/db";
import { defaultAppSettings } from "@/db/schema";
import type { Semester } from "@/types/domain";

const saveException = vi.hoisted(() => vi.fn(async () => undefined));
const toastError = vi.hoisted(() => vi.fn());

vi.mock("@/db", async () => {
  const actual = await vi.importActual<typeof import("@/db")>("@/db");
  return {
    ...actual,
    attendSafeRepository: {
      saveException,
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
    success: vi.fn(),
  },
}));

const timestamp = "2026-07-23T08:00:00.000Z";
const semester: Semester = {
  id: "semester-1",
  profileId: "profile-1",
  name: "Semester 5",
  startDate: "2026-07-01",
  endDate: "2026-12-15",
  minimumAttendanceBasisPoints: 6000,
  safetyTargetBasisPoints: 6500,
  teachingDays: ["MONDAY", "TUESDAY", "WEDNESDAY"],
  createdAt: timestamp,
  updatedAt: timestamp,
};

function snapshot(): AttendSafeSnapshot {
  return {
    profiles: [],
    semesters: [semester],
    activeSemester: semester,
    timetables: [],
    timetableVersions: [],
    subjects: [],
    electiveGroups: [],
    timetableSlots: [],
    academicExceptions: [],
    classSessions: [],
    attendanceRecords: [],
    uploadedTimetableReferences: [],
    recentActions: [],
    settings: defaultAppSettings(timestamp),
  };
}

beforeEach(() => {
  saveException.mockClear();
  toastError.mockClear();
});

describe("ScheduleSettings academic exception bounds", () => {
  it("keeps closure dates inside the active semester", () => {
    render(<ScheduleSettings data={snapshot()} />);

    const starts = screen.getByLabelText(/^Starts/);
    const ends = screen.getByLabelText(/^Ends/);
    expect(starts).toHaveAttribute("min", semester.startDate);
    expect(starts).toHaveAttribute("max", semester.endDate);
    expect(ends).toHaveAttribute("min", semester.startDate);
    expect(ends).toHaveAttribute("max", semester.endDate);

    fireEvent.change(starts, { target: { value: "2026-06-30" } });
    const submit = screen.getByRole("button", { name: "Add exception" });
    fireEvent.submit(submit.closest("form")!);

    expect(saveException).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Closure dates must stay inside the semester (2026-07-01 to 2026-12-15).",
    );
  });
});
