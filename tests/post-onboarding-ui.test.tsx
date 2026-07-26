import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/app/app-shell";
import { DashboardScreen } from "@/components/dashboard/dashboard-screen";
import { defaultAppSettings, type AttendSafeSnapshot } from "@/db";
import { DEMO_IDS } from "@/lib/demo";
import type { Profile, Semester, Subject } from "@/types/domain";

const mockUseAttendSafeData = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-attendsafe-data", () => ({
  useAttendSafeData: mockUseAttendSafeData,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

const now = "2026-07-23T10:00:00.000Z";
const profile: Profile = {
  id: "00000000-0000-4000-8000-000000000001",
  displayName: "Asha",
  institution: "AttendSafe Institute",
  timezone: "Asia/Kolkata",
  weekStartsOn: "MONDAY",
  createdAt: now,
  updatedAt: now,
};
const semester: Semester = {
  id: "00000000-0000-4000-8000-000000000002",
  profileId: profile.id,
  name: "Semester 5",
  startDate: "2026-07-01",
  endDate: "2026-12-15",
  minimumAttendanceBasisPoints: 6000,
  safetyTargetBasisPoints: 6500,
  teachingDays: ["MONDAY", "TUESDAY", "WEDNESDAY"],
  createdAt: now,
  updatedAt: now,
};
const subject: Subject = {
  id: "00000000-0000-4000-8000-000000000003",
  semesterId: semester.id,
  code: "DSP",
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
  createdAt: now,
  updatedAt: now,
};

function snapshot(activeProfile = profile): AttendSafeSnapshot {
  return {
    profiles: [activeProfile],
    activeProfile,
    semesters: [{ ...semester, profileId: activeProfile.id }],
    activeSemester: { ...semester, profileId: activeProfile.id },
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
    settings: {
      ...defaultAppSettings(now),
      activeProfileId: activeProfile.id,
      activeSemesterId: semester.id,
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

describe("post-onboarding surfaces", () => {
  it("shows configured attendance data without feature promotion", () => {
    render(<DashboardScreen />);

    expect(
      screen.getByRole("heading", { name: "Attendance overview" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Digital Signal Processing")).toBeInTheDocument();
    expect(screen.getByText("Subject health")).toBeInTheDocument();
    expect(screen.queryByText(/Every subject has its own margin/)).toBeNull();
    expect(
      screen.queryByText(/works offline|scan timetable|private by default/i),
    ).toBeNull();
  });

  it("keeps one compact demo indicator and an exit action in the app shell", () => {
    const demoProfile = {
      ...profile,
      id: DEMO_IDS.profile,
      displayName: "Demo student",
    };
    mockUseAttendSafeData.mockReturnValue({
      data: snapshot(demoProfile),
      loading: false,
      availability: "READY",
      refresh: vi.fn(),
    });

    render(
      <AppShell>
        <div>Configured dashboard</div>
      </AppShell>,
    );

    expect(
      screen.getByText("You are exploring demo data."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("exit-demo")).toBeInTheDocument();
    expect(screen.queryByText("Ready to use your own timetable?")).toBeNull();
  });
});
