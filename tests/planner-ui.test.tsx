import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlannerConfirmDialog } from "@/components/planner/planner-confirm-dialog";
import { PlannerModeTabs } from "@/components/planner/planner-mode-tabs";
import { buildPlannerSimulation } from "@/components/planner/planner-model";
import { PlannerProjectionPanel } from "@/components/planner/planner-projection-panel";
import type {
  ResolvedSession,
  Subject,
  SubjectAttendanceSummary,
} from "@/types/domain";

const plannedSession: ResolvedSession = {
  id: "session-1",
  semesterId: "semester",
  subjectId: "subject",
  date: "2026-07-24",
  startTime: "09:00",
  endTime: "10:00",
  status: "SCHEDULED",
  source: "TIMETABLE",
  faculty: [],
  attendanceStatus: "NOT_MARKED",
};
const summary: SubjectAttendanceSummary = {
  subjectId: "subject",
  attended: 16,
  held: 20,
  percentageBasisPoints: 8_000,
  minimumBasisPoints: 6_000,
  safetyBasisPoints: 6_500,
};
const subject: Subject = {
  id: "subject",
  semesterId: "semester",
  name: "Digital Signal Processing",
  shortName: "DSP",
  credits: 4,
  classType: "THEORY",
  isZeroCredit: false,
  isEnabled: true,
  countsCancelledSessions: false,
  exemptPolicy: "EXCLUDED",
  initialHeld: 0,
  initialAttended: 0,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

describe("planner mode navigation", () => {
  it("exposes every planner mode as an accessible tab", () => {
    const onChange = vi.fn();
    render(<PlannerModeTabs value="SINGLE" onChange={onChange} />);

    expect(screen.getAllByRole("tab")).toHaveLength(7);
    expect(screen.getByRole("tab", { name: /one/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: /whole day/i }));
    expect(onChange).toHaveBeenCalledWith("DAY");
  });
});

describe("planner confirmation boundary", () => {
  it("does not confirm when the user keeps simulating", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <PlannerConfirmDialog
        open
        sessions={[plannedSession]}
        busy={false}
        unsafe={false}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep simulating" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("invokes persistence intent only after the explicit confirm button", () => {
    const onConfirm = vi.fn();
    render(
      <PlannerConfirmDialog
        open
        sessions={[plannedSession]}
        busy={false}
        unsafe={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm planned absences" }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("opens the confirmation intent from a projection without writing directly", () => {
    const plan = buildPlannerSimulation({
      mode: "SINGLE",
      summaries: [summary],
      sessions: [plannedSession],
      singleSessionId: plannedSession.id,
    });
    const onPlan = vi.fn();
    render(
      <PlannerProjectionPanel
        simulation={plan.simulation}
        persistenceSessions={plan.persistenceSessions}
        subjectsById={new Map([[subject.id, subject]])}
        onPlanAbsences={onPlan}
      />,
    );

    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("76.2%")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("plan-absences"));
    expect(onPlan).toHaveBeenCalledOnce();
  });
});
