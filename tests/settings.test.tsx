import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsConfirmDialog } from "@/components/settings/settings-confirm-dialog";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { defaultAppSettings, type AttendSafeSnapshot } from "@/db";
import { AppInstallProvider } from "@/hooks/use-app-install";
import type { Profile, Semester } from "@/types/domain";

const mockUseAttendSafeData = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-attendsafe-data", () => ({
  useAttendSafeData: mockUseAttendSafeData,
}));

const now = "2026-07-23T10:00:00.000Z";
const profileId = "00000000-0000-4000-8000-000000000001";
const semesterId = "00000000-0000-4000-8000-000000000002";

function snapshot(): AttendSafeSnapshot {
  const profile: Profile = {
    id: profileId,
    displayName: "Asha",
    institution: "AttendSafe Institute",
    timezone: "Asia/Kolkata",
    weekStartsOn: "MONDAY",
    createdAt: now,
    updatedAt: now,
  };
  const semester: Semester = {
    id: semesterId,
    profileId,
    name: "Semester 5",
    startDate: "2026-07-01",
    endDate: "2026-12-15",
    minimumAttendanceBasisPoints: 6000,
    safetyTargetBasisPoints: 6500,
    teachingDays: ["MONDAY", "TUESDAY", "WEDNESDAY"],
    createdAt: now,
    updatedAt: now,
  };
  return {
    profiles: [profile],
    activeProfile: profile,
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
    settings: {
      ...defaultAppSettings(now),
      activeProfileId: profileId,
      activeSemesterId: semesterId,
    },
  };
}

beforeEach(() => {
  mockUseAttendSafeData.mockReturnValue({
    data: snapshot(),
    loading: false,
    availability: "READY",
    refresh: vi.fn(),
  });
});

describe("SettingsScreen", () => {
  it("renders every production settings area from the active local snapshot", () => {
    render(
      <AppInstallProvider>
        <SettingsScreen />
      </AppInstallProvider>,
    );

    expect(screen.getByTestId("settings-page")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Profiles and semester" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Attendance policy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Schedule rules" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "App preferences" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Local data and backups" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Install application" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Display name" })).toHaveValue(
      "Asha",
    );
    expect(screen.getByRole("textbox", { name: "Semester name" })).toHaveValue(
      "Semester 5",
    );
  });
});

describe("SettingsConfirmDialog", () => {
  it("requires the exact phrase before enabling a destructive action", () => {
    const onConfirm = vi.fn();
    render(
      <SettingsConfirmDialog
        action={{
          id: "APP",
          title: "Reset the entire app?",
          description: "All local data will be removed.",
          confirmLabel: "Reset AttendSafe",
          confirmationText: "RESET APP",
        }}
        busy={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const submit = screen.getByTestId("destructive-confirmation-submit");
    const input = screen.getByTestId("destructive-confirmation-input");
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: "reset app" } });
    expect(submit).toBeDisabled();

    fireEvent.change(input, { target: { value: "RESET APP" } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
