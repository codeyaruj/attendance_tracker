import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProfileSemesterForm } from "@/components/onboarding/profile-semester-form";

function fillRequiredProfileFields() {
  fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), {
    target: { value: "Asha" },
  });
  fireEvent.change(screen.getByLabelText("Starts"), {
    target: { value: "2026-07-01" },
  });
  fireEvent.change(screen.getByLabelText("Ends"), {
    target: { value: "2026-12-15" },
  });
}

describe("ProfileSemesterForm academic exceptions", () => {
  it("accepts holiday and reading or exam entries during profile setup", async () => {
    const onContinue = vi.fn();
    render(<ProfileSemesterForm onBack={vi.fn()} onContinue={onContinue} />);
    fillRequiredProfileFields();
    fireEvent.change(
      screen.getByRole("textbox", { name: /^Holiday dates \(optional\)/ }),
      { target: { value: "2026-08-15 — Independence Day" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", {
        name: /^Reading and exam periods \(optional\)/,
      }),
      {
        target: {
          value: "2026-11-20 to 2026-11-27 — Reading week",
        },
      },
    );

    fireEvent.click(
      screen.getByRole("button", { name: /continue to timetable/i }),
    );

    await waitFor(() => expect(onContinue).toHaveBeenCalledOnce());
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        holidayEntries: "2026-08-15 — Independence Day",
        breakEntries: "2026-11-20 to 2026-11-27 — Reading week",
      }),
      expect.anything(),
    );
  });

  it("shows a line-specific error when an entry is outside semester bounds", async () => {
    const onContinue = vi.fn();
    render(<ProfileSemesterForm onBack={vi.fn()} onContinue={onContinue} />);
    fillRequiredProfileFields();
    fireEvent.change(
      screen.getByRole("textbox", { name: /^Holiday dates \(optional\)/ }),
      { target: { value: "2026-12-20 — After semester" } },
    );

    fireEvent.click(
      screen.getByRole("button", { name: /continue to timetable/i }),
    );

    expect(
      await screen.findByText(
        /Line 1: dates must fall within 2026-07-01 to 2026-12-15/,
      ),
    ).toBeInTheDocument();
    expect(onContinue).not.toHaveBeenCalled();
  });
});
