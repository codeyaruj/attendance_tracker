import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SubjectAttendanceView } from "@/components/attendance/attendance-view-model";
import { TodaySessionCard } from "@/components/attendance/today-session-card";
import { sortSubjectViews } from "@/components/dashboard/dashboard-screen";
import { SubjectAttendanceCard } from "@/components/dashboard/subject-attendance-card";
import { HistoryCalendar } from "@/components/history/history-calendar";
import { HistoryEntryCard } from "@/components/history/history-entry-card";
import { buildHistoryEntries } from "@/components/history/history-view-model";
import type { AttendSafeSnapshot } from "@/db";
import type { ResolvedSession, Semester, Subject } from "@/types/domain";

const timestamp = "2026-07-23T08:00:00.000Z";

const semester: Semester = {
  id: "semester-1",
  profileId: "profile-1",
  name: "Semester 5",
  startDate: "2026-07-01",
  endDate: "2026-12-20",
  minimumAttendanceBasisPoints: 6000,
  safetyTargetBasisPoints: 6500,
  teachingDays: ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"],
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

const session: ResolvedSession = {
  id: "timetable:slot-1:2026-07-23",
  semesterId: semester.id,
  subjectId: subject.id,
  timetableSlotId: "slot-1",
  timetableVersionId: "version-1",
  date: "2026-07-23",
  startTime: "09:00",
  endTime: "10:00",
  status: "SCHEDULED",
  source: "TIMETABLE",
  faculty: ["Prof. Rao"],
  room: "AB-304",
  attendanceStatus: "NOT_MARKED",
};

const subjectView: SubjectAttendanceView = {
  subject,
  summary: {
    subjectId: subject.id,
    held: 4,
    attended: 3,
    percentageBasisPoints: 7500,
    minimumBasisPoints: 6000,
    safetyBasisPoints: 6500,
  },
  classification: "SAFE",
  skippable: 1,
  recovery: 0,
  nextAbsenceBasisPoints: 6000,
  nextAbsenceClassification: "BORDERLINE",
};

function snapshot(
  overrides: Partial<AttendSafeSnapshot> = {},
): AttendSafeSnapshot {
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
    settings: {
      id: "app",
      theme: "SYSTEM",
      trackedClassTypes: {
        THEORY: true,
        LAB: true,
        TUTORIAL: true,
        SEMINAR: true,
        PROJECT: true,
        OTHER: true,
      },
      offlineReady: true,
      notificationsPrepared: false,
      updatedAt: timestamp,
    },
    ...overrides,
  };
}

describe("core attendance pages", () => {
  it("renders every exact dashboard subject metric", () => {
    render(<SubjectAttendanceCard view={subjectView} />);

    expect(screen.getByText("Digital Signal Processing")).toBeInTheDocument();
    expect(
      screen.getByTestId("subject-percentage-subject-dsp"),
    ).toHaveTextContent("75%");
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "P" &&
          element.textContent === "3 attended of 4 held",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Skippable now")).toBeInTheDocument();
    expect(screen.getByText("60%", { selector: "span" })).toBeInTheDocument();
  });

  it("sorts subject cards by the requested risk metric", () => {
    const lower: SubjectAttendanceView = {
      ...subjectView,
      subject: { ...subject, id: "subject-control", name: "Control Systems" },
      summary: {
        ...subjectView.summary,
        subjectId: "subject-control",
        percentageBasisPoints: 5900,
      },
      classification: "UNSAFE",
    };

    expect(
      sortSubjectViews([subjectView, lower], "LOWEST").map(
        (view) => view.subject.id,
      ),
    ).toEqual(["subject-control", "subject-dsp"]);
  });

  it("offers one-tap attendance choices for a resolved class", () => {
    const onMark = vi.fn(async () => undefined);
    render(
      <TodaySessionCard
        session={session}
        subject={subject}
        subjectView={subjectView}
        pending={false}
        onMark={onMark}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Absent" }));
    expect(onMark).toHaveBeenCalledWith(session, "ABSENT");
    expect(screen.getByText("Prof. Rao")).toBeInTheDocument();
    expect(screen.getByText("AB-304")).toBeInTheDocument();
  });

  it("builds and renders the audit-style percentage delta", () => {
    const persisted = {
      id: session.id,
      semesterId: session.semesterId,
      subjectId: session.subjectId,
      timetableSlotId: session.timetableSlotId,
      timetableVersionId: session.timetableVersionId,
      date: session.date,
      startTime: session.startTime,
      endTime: session.endTime,
      status: session.status,
      source: session.source,
      faculty: session.faculty,
      room: session.room,
      createdAt: timestamp,
      updatedAt: timestamp,
    } as const;
    const attendanceRecord = {
      id: "record-1",
      classSessionId: session.id,
      status: "ABSENT" as const,
      markedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const entries = buildHistoryEntries(
      snapshot({
        classSessions: [persisted],
        attendanceRecords: [attendanceRecord],
      }),
      [{ ...session, attendanceStatus: "ABSENT" }],
    );

    render(
      <HistoryEntryCard
        entry={entries[0]!}
        onEdit={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByText("Absent")).toBeInTheDocument();
    expect(screen.getByTestId(`history-delta-${session.id}`)).toHaveTextContent(
      "Attendance changed from 75% to 60%.",
    );
  });

  it("shows an unmarked scheduled class without counting it or writing on open", () => {
    const onEdit = vi.fn();
    const entries = buildHistoryEntries(snapshot(), [session]);

    expect(entries[0]).toMatchObject({
      status: "NOT_MARKED",
      beforeBasisPoints: 7500,
      afterBasisPoints: 7500,
      isBackfillable: true,
    });
    render(
      <HistoryEntryCard
        entry={entries[0]!}
        onEdit={onEdit}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByText("Not marked")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Attendance is unknown and excluded from held and attended totals.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark attendance" }));
    expect(onEdit).toHaveBeenCalledWith(entries[0]);
  });

  it("uses the calendar as a date filter control", () => {
    const onSelectDate = vi.fn();
    render(
      <HistoryCalendar
        entries={[]}
        month={new Date("2026-07-15T12:00:00")}
        today="2026-07-23"
        selectedStart=""
        selectedEnd=""
        onMonthChange={vi.fn()}
        onSelectDate={onSelectDate}
      />,
    );

    fireEvent.click(screen.getByTestId("calendar-day-2026-07-23"));
    expect(onSelectDate).toHaveBeenCalledWith("2026-07-23");
  });

  it("prevents selecting dates after the local maximum backfill date", () => {
    const onSelectDate = vi.fn();
    render(
      <HistoryCalendar
        entries={[]}
        month={new Date("2026-07-15T12:00:00")}
        today="2026-07-23"
        selectedStart=""
        selectedEnd=""
        minimumDate="2026-07-01"
        maximumDate="2026-07-23"
        onMonthChange={vi.fn()}
        onSelectDate={onSelectDate}
      />,
    );

    expect(screen.getByTestId("calendar-day-2026-07-24")).toBeDisabled();
    fireEvent.click(screen.getByTestId("calendar-day-2026-07-24"));
    expect(onSelectDate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  });
});
