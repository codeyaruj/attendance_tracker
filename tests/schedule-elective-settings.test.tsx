import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduleSettings } from "@/components/settings/schedule-settings";
import type { AttendSafeSnapshot } from "@/db";
import { defaultAppSettings } from "@/db/schema";
import type { ElectiveGroup, Semester } from "@/types/domain";

const updateElectiveGroup = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/db", async () => {
  const actual = await vi.importActual<typeof import("@/db")>("@/db");
  return {
    ...actual,
    createRepositories: () => ({
      electiveGroups: { update: updateElectiveGroup },
    }),
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
const subjectIds = ["subject-cmos", "subject-optical"];

function electiveGroup(
  allowMultiple: boolean,
  selectedSubjectIds: string[],
): ElectiveGroup {
  return {
    id: "elective-one",
    semesterId: semester.id,
    name: "Elective I",
    options: [
      { subjectId: subjectIds[0]!, label: "CMOS Design" },
      { subjectId: subjectIds[1]!, label: "Optical Communication" },
    ],
    selectedSubjectIds,
    allowMultiple,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function snapshot(group: ElectiveGroup): AttendSafeSnapshot {
  return {
    profiles: [],
    semesters: [semester],
    activeSemester: semester,
    timetables: [],
    timetableVersions: [],
    subjects: [],
    electiveGroups: [group],
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
  updateElectiveGroup.mockClear();
});

describe("ScheduleSettings elective selection mode", () => {
  it("persists mode changes and switches between radio and checkbox semantics", async () => {
    const { rerender } = render(
      <ScheduleSettings
        data={snapshot(electiveGroup(false, [subjectIds[0]!]))}
      />,
    );

    const modeToggle = screen.getByRole("checkbox", {
      name: /^Allow multiple subjects in Elective I/,
    });
    expect(modeToggle).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "CMOS Design" })).toBeChecked();
    expect(
      screen.getByRole("radio", { name: "Optical Communication" }),
    ).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "None" })).toBeInTheDocument();

    fireEvent.click(modeToggle);
    await waitFor(() =>
      expect(updateElectiveGroup).toHaveBeenLastCalledWith("elective-one", {
        allowMultiple: true,
        selectedSubjectIds: [subjectIds[0]],
      }),
    );

    rerender(
      <ScheduleSettings
        data={snapshot(electiveGroup(true, [subjectIds[0]!]))}
      />,
    );
    expect(
      screen.getByRole("checkbox", {
        name: /^Allow multiple subjects in Elective I/,
      }),
    ).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "CMOS Design" })).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Optical Communication" }),
    ).not.toBeChecked();
    expect(screen.queryByRole("radio", { name: "None" })).toBeNull();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Optical Communication" }),
    );
    await waitFor(() =>
      expect(updateElectiveGroup).toHaveBeenLastCalledWith("elective-one", {
        selectedSubjectIds: subjectIds,
      }),
    );

    rerender(
      <ScheduleSettings data={snapshot(electiveGroup(true, subjectIds))} />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /^Allow multiple subjects in Elective I/,
      }),
    );
    await waitFor(() =>
      expect(updateElectiveGroup).toHaveBeenLastCalledWith("elective-one", {
        allowMultiple: false,
        selectedSubjectIds: [subjectIds[0]],
      }),
    );

    rerender(
      <ScheduleSettings
        data={snapshot(electiveGroup(false, [subjectIds[0]!]))}
      />,
    );
    expect(screen.getByRole("radio", { name: "CMOS Design" })).toBeChecked();
    expect(
      screen.queryByRole("checkbox", { name: "Optical Communication" }),
    ).toBeNull();
  });
});
