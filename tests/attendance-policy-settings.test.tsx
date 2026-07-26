import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AttendancePolicySettings } from "@/components/settings/attendance-policy-settings";
import type { AttendSafeSnapshot } from "@/db";
import { defaultAppSettings } from "@/db/schema";
import type { Semester, Subject } from "@/types/domain";

const updateSubject = vi.hoisted(() => vi.fn(async () => undefined));
const updateSettings = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/db", async () => {
  const actual = await vi.importActual<typeof import("@/db")>("@/db");
  return {
    ...actual,
    attendSafeRepository: { updateSubject, updateSettings },
  };
});

const timestamp = "2026-07-23T08:00:00.000Z";
const semester: Semester = {
  id: "semester-1",
  profileId: "profile-1",
  name: "Semester 5",
  startDate: "2026-07-01",
  endDate: "2026-12-20",
  minimumAttendanceBasisPoints: 6000,
  safetyTargetBasisPoints: 6500,
  teachingDays: ["MONDAY", "TUESDAY", "WEDNESDAY"],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const subject: Subject = {
  id: "subject-dsp",
  semesterId: semester.id,
  code: "BEC501",
  name: "Digital Signal Processing",
  shortName: "DSP",
  credits: 3,
  classType: "THEORY",
  isZeroCredit: false,
  isEnabled: true,
  countsCancelledSessions: false,
  exemptPolicy: "EXCLUDED",
  initialHeld: 4,
  initialAttended: 3,
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
    subjects: [subject],
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
  updateSubject.mockClear();
  updateSettings.mockClear();
});

describe("AttendancePolicySettings", () => {
  it("edits the held and attended totals captured mid-semester", async () => {
    render(<AttendancePolicySettings data={snapshot()} />);
    fireEvent.click(screen.getByText("Digital Signal Processing"));

    const held = screen.getByRole("spinbutton", { name: "Classes held" });
    const attended = screen.getByRole("spinbutton", {
      name: "Classes attended",
    });
    expect(held).toHaveValue(4);
    expect(attended).toHaveValue(3);

    fireEvent.change(held, { target: { value: "12" } });
    fireEvent.change(attended, { target: { value: "9" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Save subject policy" }),
    );

    await waitFor(() =>
      expect(updateSubject).toHaveBeenCalledWith(
        subject.id,
        expect.objectContaining({ initialHeld: 12, initialAttended: 9 }),
      ),
    );
  });

  it("does not save totals where attended exceeds held", async () => {
    render(<AttendancePolicySettings data={snapshot()} />);
    fireEvent.click(screen.getByText("Digital Signal Processing"));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Classes held" }), {
      target: { value: "5" },
    });
    fireEvent.change(
      screen.getByRole("spinbutton", { name: "Classes attended" }),
      { target: { value: "6" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save subject policy" }),
    );

    await waitFor(() => expect(updateSubject).not.toHaveBeenCalled());
  });
});
