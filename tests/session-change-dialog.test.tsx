import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SessionChangeDialog } from "@/components/attendance/session-change-dialog";
import type { ResolvedSession, Subject } from "@/types/domain";

const timestamp = "2026-07-23T08:00:00.000Z";
const subject: Subject = {
  id: "subject-dsp",
  semesterId: "semester-1",
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
  semesterId: "semester-1",
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

describe("SessionChangeDialog", () => {
  it("exposes one-off faculty and room changes for a dated class", () => {
    render(
      <SessionChangeDialog
        open
        date={session.date}
        subjects={[subject]}
        sessions={[session]}
        busy={false}
        onClose={vi.fn()}
        onSubmit={vi.fn(async () => undefined)}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Change type" }), {
      target: { value: "OVERRIDE" },
    });

    expect(screen.getByRole("combobox", { name: "Class" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /^Faculty/ })).toHaveAttribute(
      "placeholder",
      "Prof. Rao",
    );
    expect(screen.getByRole("textbox", { name: /^Room/ })).toHaveAttribute(
      "placeholder",
      "AB-304",
    );
    expect(
      screen.getByRole("button", { name: "Save class details" }),
    ).toBeEnabled();
  });
});
