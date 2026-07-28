import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WeeklyTimetableGrid } from "@/components/timetable/weekly-timetable-grid";

const timeSlots = [
  { startTime: "08:45", endTime: "09:45" },
  { startTime: "09:45", endTime: "10:45" },
];

describe("WeeklyTimetableGrid", () => {
  it("exposes day rows, time headers, spanning sessions, and sticky scrolling", () => {
    render(
      <WeeklyTimetableGrid
        days={["MONDAY", "SATURDAY"]}
        timeSlots={timeSlots}
        entries={[
          {
            id: "lab",
            dayOfWeek: "MONDAY",
            startTime: "08:45",
            endTime: "10:45",
            title: "BEC551 Lab",
            qualifiers: ["Batch A"],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("weekly-grid-corner")).toHaveTextContent(
      "Day / Time",
    );
    expect(screen.getByRole("rowheader", { name: "Monday" })).toBeVisible();
    expect(screen.getByRole("rowheader", { name: "Saturday" })).toBeVisible();
    expect(screen.getByText("8:45 AM–9:45 AM")).toBeVisible();
    expect(screen.getByText("9:45 AM–10:45 AM")).toBeVisible();
    expect(screen.getByTestId("weekly-timetable-scroll")).toHaveClass(
      "overflow-auto",
    );
    expect(screen.getByRole("rowheader", { name: "Monday" })).toHaveClass(
      "sticky",
    );
    expect(screen.getByTestId("timetable-slot-lab")).toHaveStyle({
      gridColumn: "2 / span 2",
    });
    expect(screen.getAllByText("BEC551 Lab")).toHaveLength(1);
  });

  it("keeps editable sessions keyboard-focusable and selectable", () => {
    const onSessionSelect = vi.fn();
    render(
      <WeeklyTimetableGrid
        timeSlots={timeSlots}
        entries={[
          {
            id: "ai-session",
            dayOfWeek: "MONDAY",
            startTime: "08:45",
            endTime: "09:45",
            title: "BEC503",
            lowConfidence: true,
          },
        ]}
        onSessionSelect={onSessionSelect}
      />,
    );

    const sessionButton = screen.getByRole("button", {
      name: /BEC503, Monday, 8:45 AM to 9:45 AM/,
    });
    expect(sessionButton).toHaveAttribute("type", "button");
    expect(
      screen.getByLabelText("Low-confidence timetable entry"),
    ).toBeVisible();
    fireEvent.click(sessionButton);
    expect(onSessionSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ai-session" }),
    );
  });
});
