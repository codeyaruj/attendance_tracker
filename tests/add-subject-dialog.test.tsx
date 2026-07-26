import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AddSubjectDialog } from "@/components/timetable/add-subject-dialog";

describe("Add Subject", () => {
  it("supports independent day timings, multiple same-day sessions, and preview", async () => {
    const onSave = vi.fn();
    render(
      <AddSubjectDialog
        open
        subjects={[]}
        existingSlots={[]}
        onClose={vi.fn()}
        onSave={onSave}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Subject name")).toBeVisible(),
    );
    fireEvent.change(screen.getByLabelText("Subject name"), {
      target: { value: "Digital Signal Processing" },
    });
    fireEvent.change(screen.getByLabelText(/^Subject code/), {
      target: { value: "BEC503" },
    });
    fireEvent.click(screen.getByLabelText("Wed"));
    fireEvent.click(
      screen.getAllByRole("button", { name: /add another session/i })[0],
    );

    const times = screen.getAllByDisplayValue(/^(09:00|10:00)$/);
    expect(times).toHaveLength(6);
    fireEvent.change(times[2], { target: { value: "15:45" } });
    fireEvent.change(times[3], { target: { value: "16:45" } });
    fireEvent.change(times[4], { target: { value: "13:45" } });
    fireEvent.change(times[5], { target: { value: "14:45" } });

    fireEvent.click(screen.getByTestId("preview-subject"));
    expect(await screen.findByTestId("subject-weekly-preview")).toBeVisible();
    fireEvent.click(screen.getByTestId("confirm-add-subject"));

    expect(onSave).toHaveBeenCalledOnce();
    const [subject, slots] = onSave.mock.calls[0];
    expect(subject).toMatchObject({
      name: "Digital Signal Processing",
      code: "BEC503",
    });
    expect(
      slots.map(
        ({
          dayOfWeek,
          startTime,
          endTime,
        }: {
          dayOfWeek: string;
          startTime: string;
          endTime: string;
        }) => ({ dayOfWeek, startTime, endTime }),
      ),
    ).toEqual([
      { dayOfWeek: "MONDAY", startTime: "09:00", endTime: "10:00" },
      { dayOfWeek: "WEDNESDAY", startTime: "13:45", endTime: "14:45" },
      { dayOfWeek: "MONDAY", startTime: "15:45", endTime: "16:45" },
    ]);
  });

  it("blocks a conflicting session before preview", async () => {
    render(
      <AddSubjectDialog
        open
        subjects={[]}
        existingSlots={[
          {
            temporaryId: "existing",
            subjectTemporaryId: "existing-subject",
            dayOfWeek: "MONDAY",
            startTime: "09:30",
            endTime: "10:30",
            faculty: [],
            classType: "THEORY",
            batchOptions: [],
            weekPattern: "EVERY_WEEK",
            confidence: 1,
            isEnabled: true,
            isPlaceholder: false,
            isBreak: false,
          },
        ]}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Subject name")).toBeVisible(),
    );
    fireEvent.change(screen.getByLabelText("Subject name"), {
      target: { value: "Signals" },
    });
    expect(screen.getByText(/overlap or duplicate/i)).toBeVisible();
    fireEvent.click(screen.getByTestId("preview-subject"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      /resolve the overlapping/i,
    );
    expect(
      screen.queryByTestId("subject-weekly-preview"),
    ).not.toBeInTheDocument();
  });
});
